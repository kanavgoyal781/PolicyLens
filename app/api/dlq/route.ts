import { NextRequest, NextResponse } from "next/server";
import { listDLQ, getDLQEntry } from "../../../lib/dlq";

/**
 * /api/dlq GET (and dev DELETE).
 * Supports ?id=... for single, ?limit=N .
 * Gated in UI behind ?dlq=1 to avoid prod exposure.
 * Data lives in lib/dlq (shared with Python via file format).
 */

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const limit = Math.min(parseInt(searchParams.get("limit") || "30", 10), 100);

  if (id) {
    const entry = getDLQEntry(id);
    if (!entry) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ entry });
  }

  const items = listDLQ(limit);
  return NextResponse.json({
    items,
    count: items.length,
    note: "MLOps dead letter queue. Failures during PDF/LLM extraction are recorded here for debugging, reprocessing, and model improvement.",
  });
}

// Optional: allow clearing in dev (not for prod). Read-only in demo to preserve history for review.
export async function DELETE() {
  // In real MLOps you would have auth + proper retention policy.
  // For this demo we simply report (do not delete files).
  return NextResponse.json({ message: "DLQ clear not implemented in demo. Delete files under data/dlq manually if needed." });
}
