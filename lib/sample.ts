import { PolicyData } from "./types";

// SAMPLE_POLICY (PRE-PARSED JSON — verbatim from spec).
// Used by UI "Load sample" (instant path) + extract route bypass (guarantees identical output).
// Default profile is taken from taxonomy to keep one source of truth.
// No SAMPLE_PROFILE (dead) or `export default`; only named SAMPLE_POLICY used (traced via grep).
export const SAMPLE_POLICY: PolicyData = {
  namedInsured: "Northwind Goods Co.",
  carrier: "The Hartford",
  policyNumber: "HFD-CGL-2026-558031",
  effectiveDate: "2026-03-01",
  expirationDate: "2027-03-01",
  annualPremiumTotal: 6400,
  isInsuranceDocument: true,
  coverages: [
    { code: "GENERAL_LIABILITY", rawLabel: "Commercial General Liability", limit: 1000000, deductible: 2500, premium: 3150 },
    { code: "PRODUCT_LIABILITY", rawLabel: "Products / Completed Operations", limit: 2000000, deductible: null, premium: 1900 },
    { code: "COMMERCIAL_PROPERTY", rawLabel: "Commercial Property", limit: 350000, deductible: 5000, premium: 1350 },
    { code: "WORKERS_COMP", rawLabel: "Workers' Compensation", limit: null, deductible: null, premium: 0 },
  ],
};
