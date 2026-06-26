// Core domain types for PolicyLens (see spec sections 2-8, 11).
// These model the extracted policy, business profile inputs, scoring outputs,
// and carrier matching. All pure data; no behavior here.

export type CoverageCode =
  | "GENERAL_LIABILITY"
  | "COMMERCIAL_PROPERTY"
  | "BUSINESS_OWNERS_POLICY"
  | "PRODUCT_LIABILITY"
  | "PROFESSIONAL_LIABILITY"
  | "COMMERCIAL_AUTO"
  | "UMBRELLA"
  | "WORKERS_COMP"
  | "CYBER_LIABILITY"
  | "BUSINESS_INTERRUPTION"
  | "OTHER";

// One normalized coverage line from extraction (Zod/Pydantic validated).
export interface ExtractedCoverage {
  code: CoverageCode;
  rawLabel: string;
  limit: number | null;
  deductible: number | null;
  premium: number | null;
}

// The full structured policy output after extraction + validation.
export interface PolicyData {
  namedInsured: string | null;
  carrier: string | null;
  policyNumber: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  annualPremiumTotal: number | null;
  coverages: ExtractedCoverage[];
  isInsuranceDocument: boolean;
}

// User-selected profile that drives required coverages, exposures, gaps, carrier appetite.
export interface BusinessProfile {
  industry:
    | "ECOMMERCE_CPG"
    | "RESTAURANTS"
    | "CONTRACTORS"
    | "TRUCKING"
    | "PROPERTY_MANAGEMENT"
    | "RETAIL"
    | "OTHER";
  annualRevenueBand: "LT_250K" | "B250K_1M" | "B1M_5M" | "B5M_10M" | "GT_10M";
  employeeCount: number;
}

// Derived risk exposure % and band after mitigation by present coverages (§7.6).
export interface Exposure {
  category: string;
  value: number;
  band: "Low" | "Medium" | "High";
}

// Missing coverage flagged for the profile (High for essential, Medium for recommended).
export interface Gap {
  code: CoverageCode;
  label: string;
  severity: "High" | "Medium";
  why: string;
}

// Aggregated output of all scoring (used by UI dashboard).
export interface ScoreResult {
  coverageScore: number;
  gaps: Gap[];
  exposures: Exposure[];
  coveragesPresentCount: number;
}

// Static carrier definition: base rate + industry appetite list (spec §8.1 exactly 12).
export interface Carrier {
  name: string;
  rate: number;
  appetite: string[];
}

// Computed per-carrier result after appetite + fit bonus + jitter + premium formula.
export interface CarrierMatch {
  name: string;
  match: number;
  premium: number;
  isBest: boolean;
}
