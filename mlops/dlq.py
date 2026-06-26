"""
Dead Letter Queue for MLOps extraction failures.

Stores failed extractions (bad LLM output, validation errors, low quality docs)
as JSON files under data/dlq/ for later inspection, reprocessing, or model improvement.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

# On serverless / Vercel the Python sidecar (if used) should also use /tmp if DLQ_DIR not provided.
_default = "data/dlq"
if not os.environ.get("DLQ_DIR") and (os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")):
    _default = os.path.join("/tmp", "policylens-dlq")
DLQ_DIR = Path(os.environ.get("DLQ_DIR", _default))

try:
    DLQ_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass  # non-fatal for demo sidecar


@dataclass
class DLQEntry:
    id: str
    timestamp: str
    reason: str  # e.g. "pydantic_validation_failed", "llm_parse_error", "low_quality_extraction", "unreadable_pdf"
    raw_text_snippet: str
    attempted_output: Optional[Dict[str, Any]]
    metadata: Dict[str, Any]  # filename, size, profile hints etc.
    original_filename: Optional[str] = None


class DeadLetterQueue:
    """File-backed DLQ (JSON + JSONL). Singleton below. Mirrors lib/dlq.ts."""
    def __init__(self, base_dir: Path = DLQ_DIR):
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def write(
        self,
        reason: str,
        raw_text: str,
        attempted: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        original_filename: Optional[str] = None,
    ) -> str:
        entry_id = f"dlq-{int(time.time())}-{uuid.uuid4().hex[:8]}"
        entry = DLQEntry(
            id=entry_id,
            timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            reason=reason,
            raw_text_snippet=raw_text[:2000] + ("..." if len(raw_text) > 2000 else ""),
            attempted_output=attempted,
            metadata=metadata or {},
            original_filename=original_filename,
        )

        path = self.base_dir / f"{entry_id}.json"
        with path.open("w", encoding="utf-8") as f:
            json.dump(asdict(entry), f, indent=2, ensure_ascii=False)

        # Also append to a rolling jsonl for easy tailing / Spark etc.
        jsonl = self.base_dir / "dead_letter.jsonl"
        with jsonl.open("a", encoding="utf-8") as f:
            f.write(json.dumps(asdict(entry), ensure_ascii=False) + "\n")

        print(f"[DLQ] Wrote failure {entry_id} reason={reason}")
        return entry_id

    def list(self, limit: int = 50) -> List[Dict[str, Any]]:
        files = sorted(self.base_dir.glob("dlq-*.json"), reverse=True)[:limit]
        results: List[Dict[str, Any]] = []
        for p in files:
            try:
                results.append(json.loads(p.read_text(encoding="utf-8")))
            except Exception:
                continue
        return results

    def get(self, entry_id: str) -> Optional[Dict[str, Any]]:
        path = self.base_dir / f"{entry_id}.json"
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))


# Singleton for convenience
dlq = DeadLetterQueue()
