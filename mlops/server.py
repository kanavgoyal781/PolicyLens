"""
Optional FastAPI MLOps extraction service.
Run with: uvicorn mlops.server:app --port 8001 --reload

This allows the Next.js route to call a dedicated Python service (sidecar pattern common in MLOps).
"""
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
from typing import Optional
import os

from .extractor import extract_policy
from .dlq import dlq
from .schemas import ExtractionResult

app = FastAPI(title="PolicyLens MLOps Extractor", version="1.0")

@app.post("/extract")
async def extract(file: Optional[UploadFile] = File(None), raw_text: Optional[str] = Form(None)):
    # Optional sidecar; main Next route uses its own unpdf+LLM path.
    text = raw_text
    fname = None
    if file:
        fname = file.filename
        content = await file.read()
        # For simplicity in demo we assume caller already did unpdf. 
        # In real: integrate unpdf or pdfplumber here too.
        text = content.decode("utf-8", errors="ignore")[:100_000]
    if not text:
        return JSONResponse({"is_fallback": True, "error": "no_text"}, status_code=200)

    result: ExtractionResult = extract_policy(text, fname)
    if result.data:
        return result.data.model_dump()
    return {"isInsuranceDocument": False, "_fallback": True, "dlq_id": result.dlq_id, "error": result.error}

@app.get("/dlq")
def list_dlq(limit: int = 20):
    return {"items": dlq.list(limit), "count": len(dlq.list(limit))}

@app.get("/health")
def health():
    return {"status": "ok", "schema_version": "1.0.0"}
