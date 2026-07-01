"""
Extraction logic for the Python/Streamlit port.
Mirrors app/api/extract/route.ts behavior EXACTLY for fidelity:
- pdfplumber (unpdf equivalent) for text
- robust sample bypass (filename primary + COI header guard on content markers) to guarantee identical numbers and avoid false positives on quoting docs
- EXACT SYSTEM_PROMPT + USER_PROMPT_TEMPLATE (improved ACORD 25 disambiguation from TS route: INSURED box for namedInsured, placeholder carrier=null, ignore blanks, etc.)
  Note: Streamlit extraction uses the full improved ACORD prompts; mlops/ sidecar retains its simpler generic prompt (left untouched per port rules).
- temp=0, json mode
- post-parse monetary filter on coverages (drop blank template rows)
- Pydantic via mlops.schemas + quality gate (passesQualityGate parity)
- DLQ writes on failures using mlops.dlq (same file format)
- Graceful {isInsuranceDocument: false, _fallback: true} on any problem
"""
from __future__ import annotations

import json
import os
from io import BytesIO
from typing import Any, Optional

import pdfplumber
import httpx
from pydantic import ValidationError

# Reuse mlops models (as-is, no modification to mlops dir)
from mlops.schemas import PolicyData as MLPyPolicyData, ExtractionResult  # type: ignore
from mlops.dlq import dlq  # type: ignore

from .sample import SAMPLE_POLICY
from .types import PolicyData, ExtractedCoverage

# === EXACT prompts copied from app/api/extract/route.ts (with ACORD rules) ===
SYSTEM_PROMPT = """You are an insurance document parser specialized in ACORD 25 Certificates of Liability Insurance. Convert raw COI text into strict JSON.

ACORD 25 DISAMBIGUATION (critical):
- namedInsured: the "INSURED" box (party policies issued to). NEVER the CERTIFICATE HOLDER, PRODUCER, or additional insured text (e.g. never "Cornell University"). In templates, take the name directly under/after the INSURED label (e.g. "SAMPLE VENDOR").
- carrier: primary insurer name from INSURER A / INSURER(S) section. Avoid mixing INSURED name with placeholder "INSURANCE COMPANY NAME". If insurer field is only generic placeholder ("INSURANCE COMPANY NAME", "INSUARNCE COMPANY NAME", etc.), set carrier to null.
- Dates: yyyy-mm-dd; read MM/DD/YYYY literally.
- coverages: ONLY emit if at least one of limit/deductible/premium is not null (enforceable filter safety net). When inspecting raw text, use a POLICY NUMBER on the row as a signal of a real filled coverage (not blank template); associate values best-effort. Ignore blank pre-printed template rows (e.g. UMBRELLA, WORKERS_COMP with no filled values). 
- Flattened grid: do best-effort association of numbers (limits/premiums/policy nums appear near coverage types).

Map to codes: GENERAL_LIABILITY, COMMERCIAL_PROPERTY, BUSINESS_OWNERS_POLICY, PRODUCT_LIABILITY, PROFESSIONAL_LIABILITY, COMMERCIAL_AUTO, UMBRELLA, WORKERS_COMP, CYBER_LIABILITY, BUSINESS_INTERRUPTION, OTHER. Parse $ as integers (null if absent). isInsuranceDocument false + empty coverages if not a COI.
Respond ONLY with the JSON object, no prose. Schema: {namedInsured, carrier, policyNumber, effectiveDate (yyyy-mm-dd), expirationDate (yyyy-mm-dd), annualPremiumTotal, coverages: [{ code, rawLabel, limit, deductible, premium }], isInsuranceDocument }"""

USER_PROMPT_TEMPLATE = lambda raw_text: f"""Extract per ACORD rules above (INSURED box for namedInsured — use value after INSURED label e.g. SAMPLE VENDOR not placeholders or holder; only real filled coverages that have monetary values (limit/ded/prem); use POLICY NUMBER signals from text; best-effort on flattened numbers; carrier=null on pure placeholder insurer text).
{{namedInsured, carrier, policyNumber, effectiveDate (yyyy-mm-dd),
  expirationDate (yyyy-mm-dd), annualPremiumTotal,
  coverages: [{{ code, rawLabel, limit, deductible, premium }}],
  isInsuranceDocument }}
DOCUMENT TEXT:
\"\"\"
{raw_text}
\"\"\""""

def _to_policy_data(py_model: MLPyPolicyData) -> PolicyData:
    """Convert mlops pydantic model to our dataclass PolicyData (for scoring compatibility)."""
    covs = [
        ExtractedCoverage(
            code=(c.code.value if hasattr(c.code, "value") else str(c.code).split(".")[-1]),
            rawLabel=c.rawLabel,
            limit=c.limit,
            deductible=c.deductible,
            premium=c.premium,
        )
        for c in py_model.coverages
    ]
    return PolicyData(
        namedInsured=py_model.namedInsured,
        carrier=py_model.carrier,
        policyNumber=py_model.policyNumber,
        effectiveDate=py_model.effectiveDate,
        expirationDate=py_model.expirationDate,
        annualPremiumTotal=py_model.annualPremiumTotal,
        coverages=covs,
        isInsuranceDocument=py_model.isInsuranceDocument,
    )


def extract_text_from_pdf(uploaded_file: bytes, filename: Optional[str] = None) -> str:
    """pdfplumber (unpdf equivalent) merge pages text."""
    try:
        with pdfplumber.open(BytesIO(uploaded_file)) as pdf:
            texts = []
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    texts.append(t)
            return "\n\n".join(texts)
    except Exception as e:
        # Do not re-raise raw: let caller DLQ uniformly (unpdf_failed reason preserved for TS DLQ parity)
        raise RuntimeError(f"pdfplumber (unpdf equivalent) failed: {e}") from e


def passes_quality_gate(data: MLPyPolicyData) -> tuple[bool, Optional[str]]:
    """Exact port of lib/schemas.ts passesQualityGate + TS route post filter intent."""
    if not data.isInsuranceDocument:
        return True, None
    if len(data.coverages) == 0:
        return False, "is_insurance_true_but_zero_coverages"
    has_header = bool(data.namedInsured or data.policyNumber or data.carrier)
    if not has_header:
        return False, "missing_key_header_fields"
    return True, None


def validate_and_gate(llm_json: Any, raw_text: str, filename: Optional[str]) -> tuple[Optional[PolicyData], Optional[str], Optional[str]]:
    """
    Zod + monetary filter + quality gate.
    Returns (validated_dataclass or None, dlq_id or None, error_reason)
    """
    # 1. Strict Pydantic (reuse mlops)
    try:
        # The mlops PolicyData may have schema_version etc; model_validate
        policy = MLPyPolicyData.model_validate(llm_json)
    except ValidationError as ve:
        dlq_id = dlq.write(
            reason="pydantic_validation_failed",
            raw_text=raw_text,
            attempted=llm_json if isinstance(llm_json, dict) else {"raw": str(llm_json)},
            metadata={"filename": filename, "validation_errors": ve.errors()},
            original_filename=filename,
        )
        return None, dlq_id, "pydantic_validation_failed"

    # 2. Post validation monetary filter (exact match to TS route behavior; always applied, no leak of blanks)
    filtered_coverages = [
        c for c in policy.coverages
        if (c.limit is not None or c.deductible is not None or c.premium is not None)
    ]
    # Rebuild using filtered list (robust; direct like TS .filter, no silent pass)
    policy_dict = policy.model_dump()
    policy_dict["coverages"] = [c.model_dump() for c in filtered_coverages]
    # Remove internal fields that may cause extra=forbid issues on roundtrip
    policy_dict.pop("schema_version", None)
    policy = MLPyPolicyData.model_validate(policy_dict)

    # 3. Quality gate
    ok, reason = passes_quality_gate(policy)
    if not ok:
        dlq_id = dlq.write(
            reason=f"quality_gate_{reason}",
            raw_text=raw_text,
            attempted=policy.model_dump(),
            metadata={"gateReason": reason, "filename": filename},
            original_filename=filename,
        )
        return None, dlq_id, reason or "quality_gate_failed"

    return _to_policy_data(policy), None, None


def call_llm(raw_text: str, filename: Optional[str] = None) -> tuple[Optional[PolicyData], Optional[str], Optional[str]]:
    """LLM call with retry, exact prompts, temp=0, json. Mirrors TS callLLM."""
    api_key = os.getenv("LLM_API_KEY")
    base_url = os.getenv("LLM_BASE_URL", "https://api.x.ai/v1")
    model = os.getenv("LLM_MODEL", "grok-2-latest")

    if not api_key:
        return None, None, "no_llm_key"

    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_PROMPT_TEMPLATE(raw_text)},
        ],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }

    for attempt in range(1, 3):
        try:
            with httpx.Client(timeout=60.0) as client:
                resp = client.post(url, headers=headers, json=body)
            if resp.status_code != 200:
                print(f"[extract] LLM HTTP {resp.status_code} attempt {attempt}")
                if attempt == 2:
                    dlq_id = dlq.write(reason="llm_call_failed", raw_text=raw_text, attempted=None,
                                       metadata={"status": resp.status_code, "filename": filename, "error": "http"}, original_filename=filename)
                    return None, dlq_id, "llm_http_error"
                continue
            data = resp.json()
            content = (data.get("choices") or [{}])[0].get("message", {}).get("content")
            if not content:
                dlq_id = dlq.write(reason="llm_json_parse_failed", raw_text=raw_text, attempted={"error_hint": "empty_content"}, original_filename=filename)
                return None, dlq_id, "empty_llm_content"
            try:
                parsed = json.loads(content)
            except Exception:
                cleaned = content.replace("```json", "").replace("```", "").strip()
                parsed = json.loads(cleaned)
            if not isinstance(parsed, dict):
                dlq_id = dlq.write(reason="llm_json_parse_failed", raw_text=raw_text, attempted={"error_hint": "not_object"}, original_filename=filename)
                return None, dlq_id, "invalid_llm_json"
            validated, dlq_id, err = validate_and_gate(parsed, raw_text, filename)
            return validated, dlq_id, err
        except Exception as exc:
            print(f"[extract] LLM exception attempt {attempt}: {exc}")
            if attempt == 2:
                dlq_id = dlq.write(reason="llm_call_failed", raw_text=raw_text, attempted={"error": str(exc)}, original_filename=filename)
                return None, dlq_id, "llm_exception"
    return None, None, "llm_failed"


def extract_policy_from_upload(file_bytes: bytes, filename: Optional[str] = None) -> tuple[PolicyData | dict, bool]:
    """
    Main entry: returns (policy_or_fallback_dict, is_fallback)
    Exact behavior parity with /api/extract + page.tsx handle.
    """
    fname = filename or "upload.pdf"

    # size check approx
    if len(file_bytes) > 10 * 1024 * 1024:
        dlq.write(reason="unpdf_failed", raw_text="", metadata={"error": "file_too_large"}, original_filename=fname)
        return {"isInsuranceDocument": False, "_fallback": True}, True

    # extract text
    try:
        raw_text = extract_text_from_pdf(file_bytes, fname)
    except Exception as e:
        dlq.write(reason="unpdf_failed", raw_text="", metadata={"error": str(e)}, original_filename=fname)
        return {"isInsuranceDocument": False, "_fallback": True}, True

    if len(raw_text.strip()) < 40:
        return {"isInsuranceDocument": False, "_fallback": True}, True

    # Robust sample bypass (filename primary + filename-gated content markers).
    # Content check only for sample/coi-like names (or no filename) to prevent false positive
    # on docs quoting sample (e.g. PolicyLens_Build_Spec.pdf). Matches intent of TS route.
    fname_lower = (filename or "").lower()
    is_sample = "sample-coi" in fname_lower
    if not is_sample and (not filename or "sample" in fname_lower or "coi" in fname_lower):
        has_markers = (
            "Northwind Goods Co." in raw_text and
            "HFD-CGL-2026-558031" in raw_text and
            "CERTIFICATE OF LIABILITY" in raw_text.upper()
        )
        if has_markers:
            is_sample = True
    if is_sample:
        # return the exact dataclass converted? but sample is already PolicyData
        return SAMPLE_POLICY, False

    # LLM path
    result, dlq_id, err = call_llm(raw_text, filename)
    if result is not None:
        return result, False

    # record if not already
    if not dlq_id:
        dlq.write(reason="llm_call_failed", raw_text=raw_text, metadata={"error": err or "no_result"}, original_filename=filename)

    return {"isInsuranceDocument": False, "_fallback": True}, True


# For direct testing of sample path without file
def load_sample_policy() -> PolicyData:
    return SAMPLE_POLICY
