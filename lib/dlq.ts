/**
 * Dead Letter Queue (MLOps) for extraction failures on the Node side.
 *
 * Failures that go here:
 * - LLM JSON parse errors
 * - Zod validation failures
 * - Quality gates (insurance doc declared but empty or garbage data)
 * - Unreadable / corrupt uploads that we want to keep for later analysis
 *
 * Storage: append-only JSONL + per-id .json files.
 * On Vercel (read-only fs except /tmp): we write to os.tmpdir() so writes never crash an extraction.
 * /tmp is per-invocation (ephemeral) which is acceptable for a demo; local dev still prefers data/dlq.
 * This mirrors the Python DLQ for unified observability.
 */
import fs from "fs";
import path from "path";
import os from "os";

// Discriminated failure reasons (used by API + logs + Python parity).
export type DLQReason =
  | "zod_validation_failed"
  | "llm_json_parse_failed"
  | "quality_gate_failed"
  | "unpdf_failed"
  | "llm_call_failed"
  | "unknown_error";

// Persisted entry shape (mirrors mlops/dlq.py dataclass).
export interface DLQEntry {
  id: string;
  timestamp: string;
  reason: DLQReason;
  filename?: string;
  rawTextSnippet: string;
  attempted?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

// Choose a writable dir:
// - Respect explicit DLQ_DIR env
// - On Vercel / serverless (read-only except /tmp) → use tmpdir
// - Local dev → use data/dlq (persists for inspection)
const DLQ_DIR = process.env.DLQ_DIR
  ? process.env.DLQ_DIR
  : (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
    ? path.join(os.tmpdir(), "policylens-dlq")
    : path.join(process.cwd(), "data", "dlq");

const DLQ_JSONL = path.join(DLQ_DIR, "node-dead-letter.jsonl");

// Ensure dir (best-effort; never throw from here).
function ensureDir() {
  try {
    if (!fs.existsSync(DLQ_DIR)) {
      fs.mkdirSync(DLQ_DIR, { recursive: true });
    }
  } catch {
    // Will be caught in writeToDLQ
  }
}

/**
 * Write failure to both per-id .json and append-only .jsonl.
 * Returns id for attaching to responses (_dlqId).
 * Called from extract route on all bad paths (never on happy sample path).
 * Never called on SAMPLE_POLICY happy path (see extract/route bypass).
 *
 * CRITICAL: Entire body is wrapped so EROFS / permission errors on Vercel never
 * propagate and turn a graceful fallback into a 500. On read-only fs we just log
 * and return "" (caller in extract/route already handles missing dlqId).
 */
export function writeToDLQ(params: {
  reason: DLQReason;
  rawText: string;
  attempted?: unknown;
  error?: string | Error;
  filename?: string;
  metadata?: Record<string, unknown>;
}): string {
  try {
    ensureDir();

    const id = `dlq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const entry: DLQEntry = {
      id,
      timestamp: new Date().toISOString(),
      reason: params.reason,
      filename: params.filename,
      rawTextSnippet: params.rawText.slice(0, 1800) + (params.rawText.length > 1800 ? "..." : ""),
      attempted: params.attempted,
      error: params.error instanceof Error ? params.error.message : params.error,
      metadata: params.metadata,
    };

    // Write individual file (easy to inspect)
    const filePath = path.join(DLQ_DIR, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf8");

    // Append to jsonl.
    fs.appendFileSync(DLQ_JSONL, JSON.stringify(entry) + "\n", "utf8");

    console.warn(`[DLQ] ${id} reason=${params.reason}`);
    return id;
  } catch (e) {
    // Non-fatal on serverless / read-only environments. Extraction still succeeds with fallback.
    console.warn("[DLQ] write skipped (non-fatal):", (e as Error).message || e);
    return "";
  }
}

/**
 * List recent DLQ (newest first). Used by ?dlq=1 UI and /api/dlq.
 * Truncates to limit; tolerates malformed lines.
 * Defensive: never throws (important on Vercel where previous writes may not be visible).
 */
export function listDLQ(limit = 30): DLQEntry[] {
  try {
    ensureDir();
    if (!fs.existsSync(DLQ_JSONL)) return [];

    const lines = fs.readFileSync(DLQ_JSONL, "utf8").trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as DLQEntry;
        } catch {
          console.warn("[DLQ] skipping malformed line in JSONL");
          return null;
        }
      })
      .filter((e): e is DLQEntry => e !== null)
      .reverse();
  } catch (e) {
    console.warn("[DLQ] list failed (non-fatal):", (e as Error).message || e);
    return [];
  }
}

/** Fetch one entry by id (for /api/dlq?id=...). Defensive on serverless. */
export function getDLQEntry(id: string): DLQEntry | null {
  try {
    const file = path.join(DLQ_DIR, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as DLQEntry;
  } catch {
    return null;
  }
}
