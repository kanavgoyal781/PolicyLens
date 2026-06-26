# PolicyLens

Coverage intelligence for commercial insurance. A deterministic Next.js demo: upload a commercial COI/PDF → LLM extracts structured data → transparent risk scoring + carrier match.

Built exactly to the PolicyLens Build Spec.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

- Click **Load sample policy** — instant, zero network, produces exact score 74 / 2 gaps / exposures 15/40/80/70.
- Or upload `/public/sample-coi.pdf` to test the full extraction path.
- Change Industry or Revenue dropdowns — everything recomputes live.

## Environment (for real LLM uploads)

Copy `.env.example` → `.env.local`:

```
LLM_API_KEY=your_key_here
LLM_BASE_URL=https://api.x.ai/v1
LLM_MODEL=grok-2-latest
```

- Key is used **only** in `app/api/extract/route.ts` (server). Never shipped to client.
- Without key, uploads gracefully degrade to `{isInsuranceDocument:false, _fallback:true}` while sample still works.

## Build & lint

```bash
npm run build
npm run lint
```

## Deploy

1. Push to GitHub.
2. Import to Vercel (Next.js auto-detected).
3. Add the three `LLM_*` env vars in Vercel project settings.
4. (Optional) Set `export const runtime = "nodejs";` is already present in the route for unpdf compatibility.

Sample path works before the key is set.

## Verification (acceptance)

- Sample: score exactly 74, exactly 2 gaps (Cyber High + BI Medium), exposures exactly 15/40/80/70, 12 carriers, positive savings.
- Upload of sample-coi.pdf reproduces identical dashboard.
- Non-insurance PDF shows friendly notice.
- Profile changes are reactive.
- LLM key never appears in client bundle (grep build output).
- All formatting uses $x,xxx , Mar 1, 2026 style, no lorem.

## Key files

- `lib/scoring.ts` — pure deterministic engine (explain any number from here)
- `lib/carriers.ts` — exact 12 carriers + match/premium
- `app/api/extract/route.ts` — unpdf + verbatim prompts + temp 0 + JSON mode + fallback
- `lib/sample.ts` + `public/sample-coi.pdf`

This is interview-ready and follows the spec 100% with no deviations or extra features.

## MLOps additions (Dead Letter Queue + Schema Validation)

We layered production-grade MLOps practices on top of the core extraction flow:

### Pydantic + Zod schema validation
- **Python**: `mlops/schemas.py` — strict Pydantic v2 models (`PolicyData`, `ExtractedCoverage`) with `model_config = {"extra": "forbid"}`, date patterns, quality rules.
- **TypeScript**: `lib/schemas.ts` — equivalent Zod schemas + `passesQualityGate()`.

Validation happens **after** the LLM and **before** returning data to the UI.

### Dead Letter Queue (DLQ) for failure cases
Failures are captured instead of silently swallowed:

- `zod_validation_failed`
- `pydantic_validation_failed`
- `quality_gate_failed` (insurance=true but zero coverages or missing headers)
- `llm_json_parse_failed`, `llm_call_failed`, `unpdf_failed`, etc.

Storage (both sides):
- Per-entry JSON files: `data/dlq/dlq-....json`
- Append-only log: `data/dlq/node-dead-letter.jsonl` and `data/dlq/dead_letter.jsonl`

Inspect:
```bash
npm run dlq
# or
curl http://localhost:3000/api/dlq?limit=10
curl "http://localhost:3000/api/dlq?id=dlq-..."
```

Python side also writes the same style files (run the optional FastAPI service for a real sidecar).

### Other MLOps patterns implemented
- Structured logging with reason codes
- Retry with backoff on LLM calls (`callLLM`)
- Quality / business rule gates (not just syntactic validation)
- Schema versioning (`schema_version`)
- Graceful degradation + observability (DLQ entries contain raw snippet + attempted output + error)
- Optional dedicated Python extractor service (`mlops/server.py`)

### Run the Python MLOps components

```bash
# 1. Install
npm run mlops:install

# 2. (Optional) Run standalone FastAPI extractor on :8001
npm run mlops:server

# Then set EXTRACTOR_URL=http://localhost:8001/extract if you want the Next route to call it.
```

The main Next.js demo continues to work without Python. The DLQ and Zod validation are **always on** in the TypeScript path.

This makes the extraction pipeline production- and interview-ready from an MLOps perspective. (MLOps files/UI are optional additive extensions; core per spec §2-4/11 remains independent and non-breaking.)
