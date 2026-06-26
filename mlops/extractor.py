"""
MLOps-grade LLM document extractor.

Features:
- Pydantic schema validation (strict)
- Dead letter queue on any failure or low quality
- Structured logging
- Prompt + schema versioning
- Simple retry for transient LLM errors

See app/api/extract/route.ts for Node parity; both use same DLQ reasons + quality gate contract + temp=0.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional, Tuple

import httpx
from pydantic import ValidationError

from .dlq import dlq
from .schemas import ExtractionResult, PolicyData, SCHEMA_VERSION

SYSTEM_PROMPT = """You are an insurance document parser. You convert the raw text of a commercial insurance Certificate of Insurance (COI) or policy declarations page into strict JSON. Map every coverage you find to one of these codes: GENERAL_LIABILITY, COMMERCIAL_PROPERTY, BUSINESS_OWNERS_POLICY, PRODUCT_LIABILITY, PROFESSIONAL_LIABILITY, COMMERCIAL_AUTO, UMBRELLA, WORKERS_COMP, CYBER_LIABILITY, BUSINESS_INTERRUPTION, OTHER. Parse dollar limits and premiums as plain integers (no symbols or commas). Use null for anything not present. If the text is not an insurance document, set isInsuranceDocument to false and return empty coverages. Respond with ONLY the JSON object, no prose, no markdown fences."""

USER_PROMPT_TEMPLATE = """Extract this document into the schema:
{{namedInsured, carrier, policyNumber, effectiveDate (yyyy-mm-dd), expirationDate (yyyy-mm-dd), annualPremiumTotal, coverages: [{{code, rawLabel, limit, deductible, premium}}], isInsuranceDocument }}
DOCUMENT TEXT:
\"\"\"
{raw_text}
\"\"\""""

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
LLM_API_KEY = os.getenv("LLM_API_KEY")

MAX_RETRIES = 2


# Internal; mirrors TS callLLM + retry.
def _call_llm(raw_text: str) -> Optional[Dict[str, Any]]:
    if not LLM_API_KEY:
        return None

    url = f"{LLM_BASE_URL.rstrip('/')}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LLM_API_KEY}",
    }
    body = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_PROMPT_TEMPLATE.format(raw_text=raw_text)},
        ],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with httpx.Client(timeout=60) as client:
                resp = client.post(url, headers=headers, json=body)
            if resp.status_code == 200:
                data = resp.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content")
                if content:
                    try:
                        return json.loads(content)
                    except json.JSONDecodeError:
                        # try cleanup
                        cleaned = content.replace("```json", "").replace("```", "").strip()
                        return json.loads(cleaned)
            else:
                print(f"[extractor] LLM status {resp.status_code} attempt {attempt}")
        except Exception as exc:
            print(f"[extractor] LLM error attempt {attempt}: {exc}")
        if attempt < MAX_RETRIES:
            import time; time.sleep(0.8 * attempt)
    return None


def _quality_gate(data: PolicyData) -> Tuple[bool, Optional[str]]:
    """Return (ok, reason_if_bad). Mirrors TS passesQualityGate + route logic."""
    if not data.isInsuranceDocument:
        return True, None
    if len(data.coverages) == 0:
        return False, "is_insurance_true_but_zero_coverages"
    # Require at least one of namedInsured or policyNumber or carrier for a "real" doc
    if not (data.namedInsured or data.policyNumber or data.carrier):
        return False, "missing_key_header_fields"
    return True, None


def extract_policy(raw_text: str, filename: Optional[str] = None) -> ExtractionResult:
    """
    Main entrypoint for MLOps extraction.
    LLM -> Pydantic -> quality gate -> (DLQ on bad). Mirrors extract/route.ts flow.
    """
    metadata = {"filename": filename, "text_len": len(raw_text), "schema_version": SCHEMA_VERSION}

    if len(raw_text.strip()) < 40:
        # Not worth DLQ, it's a clear non-doc
        return ExtractionResult(is_fallback=True)

    # 1. Call LLM (with retries)
    llm_json = _call_llm(raw_text)

    if llm_json is None:
        dlq_id = dlq.write(
            reason="llm_unavailable_or_failed",
            raw_text=raw_text,
            attempted=None,
            metadata=metadata,
            original_filename=filename,
        )
        return ExtractionResult(is_fallback=True, dlq_id=dlq_id, error="llm_failed")

    # 2. Strict Pydantic validation
    try:
        policy = PolicyData.model_validate(llm_json)
    except ValidationError as ve:
        dlq_id = dlq.write(
            reason="pydantic_validation_failed",
            raw_text=raw_text,
            attempted=llm_json,
            metadata={**metadata, "validation_errors": ve.errors()},
            original_filename=filename,
        )
        return ExtractionResult(is_fallback=True, dlq_id=dlq_id, error=str(ve))

    # 3. Quality / business rule gate (MLOps observability)
    ok, bad_reason = _quality_gate(policy)
    if not ok:
        dlq_id = dlq.write(
            reason=f"quality_gate_{bad_reason}",
            raw_text=raw_text,
            attempted=llm_json,
            metadata=metadata,
            original_filename=filename,
        )
        # Still return the (potentially partial) data but flag as dlq'd for caller awareness
        return ExtractionResult(data=policy, is_fallback=True, dlq_id=dlq_id, error=bad_reason)

    return ExtractionResult(data=policy)
