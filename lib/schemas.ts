/**
 * Zod schemas (TS equivalent of Pydantic) for runtime validation of LLM output.
 * Used inside the extraction route for strong guarantees.
 */
import { z } from "zod";
import { COVERAGE_CODES } from "./taxonomy";

// Enum schema from canonical COVERAGE_CODES list (single source; .catch for robustness).
export const CoverageCodeSchema = z.enum(COVERAGE_CODES as [string, ...string[]]).catch("OTHER");

// Schema for one coverage (preprocess normalizes null/""/strings -> int|null).
export const ExtractedCoverageSchema = z.object({
  code: CoverageCodeSchema,
  rawLabel: z.string().min(1),
  limit: z.preprocess((v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(Math.max(0, n)) : null;
  }, z.number().nullable()),
  deductible: z.preprocess((v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(Math.max(0, n)) : null;
  }, z.number().nullable()),
  premium: z.preprocess((v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(Math.max(0, n)) : null;
  }, z.number().nullable()),
});

// Top level policy schema (mirrors Python Pydantic; used for LLM JSON + sample).
export const PolicyDataSchema = z.object({
  namedInsured: z.string().nullable(),
  carrier: z.string().nullable(),
  policyNumber: z.string().nullable(),
  effectiveDate: z.preprocess((v) => (v == null || v === "" ? null : String(v)), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()),
  expirationDate: z.preprocess((v) => (v == null || v === "" ? null : String(v)), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()),
  annualPremiumTotal: z.preprocess((v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(Math.max(0, n)) : null;
  }, z.number().nullable()),
  coverages: z.array(ExtractedCoverageSchema),
  isInsuranceDocument: z.boolean(),
});

export type ValidatedPolicyData = z.infer<typeof PolicyDataSchema>;

/**
 * MLOps quality gate run after Zod parse (see extract/route.ts).
 * Matches logic in Python _quality_gate.
 * Failures -> DLQ, never surface partial bad data to UI.
 */
export function passesQualityGate(data: ValidatedPolicyData): { ok: boolean; reason?: string } {
  if (!data.isInsuranceDocument) return { ok: true };
  if (data.coverages.length === 0) {
    return { ok: false, reason: "is_insurance_true_but_zero_coverages" };
  }
  const hasHeader = data.namedInsured || data.policyNumber || data.carrier;
  if (!hasHeader) {
    return { ok: false, reason: "missing_key_header_fields" };
  }
  return { ok: true };
}
