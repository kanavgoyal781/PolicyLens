/**
 * Dead Letter Queue (MLOps) for extraction failures on the Node side.
 *
 * Failures that go here:
 * - LLM JSON parse errors
 * - Zod validation failures
 * - Quality gates (insurance doc declared but empty or garbage data)
 * - Unreadable / corrupt uploads that we want to keep for later analysis
 *
 * Storage: append-only JSONL under data/dlq/node-dead-letter.jsonl + individual files.
 * This mirrors the Python DLQ for unified observability.
 */
import fs from "fs";
import path from "path";

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

const DLQ_DIR = path.join(process.cwd(), "data", "dlq");
const DLQ_JSONL = path.join(DLQ_DIR, "node-dead-letter.jsonl");

// Ensure dir once (sync ok for demo; called on every write/list).
function ensureDir() {
  if (!fs.existsSync(DLQ_DIR)) {
    fs.mkdirSync(DLQ_DIR, { recursive: true });
  }
}

/**
 * Write failure to both per-id .json and append-only .jsonl.
 * Returns id for attaching to responses (_dlqId).
 * Called from extract route on all bad paths (never on happy sample path).
 * Never called on SAMPLE_POLICY happy path (see extract/route bypass).
 */
export function writeToDLQ(params: {
  reason: DLQReason;
  rawText: string;
  attempted?: unknown;
  error?: string | Error;
  filename?: string;
  metadata?: Record<string, unknown>;
}): string {
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

  // Append to jsonl (great for tail -f, batch jobs). Sync ok for demo (MLOps not on sample paths); prod would use async/queue.
  fs.appendFileSync(DLQ_JSONL, JSON.stringify(entry) + "\n", "utf8");

  console.warn(`[DLQ] ${id} reason=${params.reason}`);
  return id;
}

/**
 * List recent DLQ (newest first). Used by ?dlq=1 UI and /api/dlq.
 * Truncates to limit; tolerates malformed lines.
 */
export function listDLQ(limit = 30): DLQEntry[] {
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
}

/** Fetch one entry by id (for /api/dlq?id=...). */
export function getDLQEntry(id: string): DLQEntry | null {
  const file = path.join(DLQ_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as DLQEntry;
}
