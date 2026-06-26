import { CoverageCode, BusinessProfile, ExtractedCoverage } from "./types";

// Taxonomy + constants (spec §7.1 recommended matrix, §7.3 min limits, §7.6 exposures, §8).
// Single source of truth for coverage codes, industries, required lists, labels, thresholds.
// Used by scoring, carriers, schemas (Zod), UI dropdowns, and sample.
// getRequiredCoverages is the shared impl for carriers fit-bonus (scoring duplicates list split for 18/8 penalties).
// Call sites: scoring (dupe internal), carriers (fit), page (indirect via compute), UI dropdowns (via labels).

export const COVERAGE_CODES: CoverageCode[] = [
  "GENERAL_LIABILITY",
  "COMMERCIAL_PROPERTY",
  "BUSINESS_OWNERS_POLICY",
  "PRODUCT_LIABILITY",
  "PROFESSIONAL_LIABILITY",
  "COMMERCIAL_AUTO",
  "UMBRELLA",
  "WORKERS_COMP",
  "CYBER_LIABILITY",
  "BUSINESS_INTERRUPTION",
  "OTHER",
];

/** Union of allowed industries (profile drives all scoring/carrier logic). */
export type Industry = BusinessProfile["industry"];

/** Ordered list for <select> and iteration (matches spec profile options). */
export const INDUSTRIES: Industry[] = [
  "ECOMMERCE_CPG",
  "RESTAURANTS",
  "CONTRACTORS",
  "TRUCKING",
  "PROPERTY_MANAGEMENT",
  "RETAIL",
  "OTHER",
];

/** Revenue bands for profile + premium base calc (spec §8.3). */
export const REVENUE_BANDS = [
  "LT_250K",
  "B250K_1M",
  "B1M_5M",
  "B5M_10M",
  "GT_10M",
] as const;

export type RevenueBand = (typeof REVENUE_BANDS)[number];

/** Human labels for UI selects (spec §7.1). */
export const INDUSTRY_LABELS: Record<Industry, string> = {
  ECOMMERCE_CPG: "E-commerce / CPG",
  RESTAURANTS: "Restaurants",
  CONTRACTORS: "Contractors",
  TRUCKING: "Trucking",
  PROPERTY_MANAGEMENT: "Property Management",
  RETAIL: "Retail",
  OTHER: "Other",
};

/** Human labels for revenue selects. */
export const REVENUE_LABELS: Record<RevenueBand, string> = {
  LT_250K: "< $250K",
  B250K_1M: "$250K – $1M",
  B1M_5M: "$1M – $5M",
  B5M_10M: "$5M – $10M",
  GT_10M: "> $10M",
};

/** Default starting profile (used by sample + initial UI state). */
export const DEFAULT_PROFILE: BusinessProfile = {
  industry: "ECOMMERCE_CPG",
  annualRevenueBand: "B1M_5M",
  employeeCount: 25,
};

// 7.1 Industry recommended-coverage matrix
// BOP satisfies GL + Property (see satisfiesCoverage).
// ESSENTIAL drive -18 pts + High gaps; RECOMMENDED drive -8 + Medium.
export const ESSENTIAL_COVERAGES: Record<Industry, CoverageCode[]> = {
  ECOMMERCE_CPG: ["GENERAL_LIABILITY", "PRODUCT_LIABILITY", "CYBER_LIABILITY", "WORKERS_COMP", "COMMERCIAL_PROPERTY"],
  RESTAURANTS: ["GENERAL_LIABILITY", "COMMERCIAL_PROPERTY", "WORKERS_COMP"],
  CONTRACTORS: ["GENERAL_LIABILITY", "WORKERS_COMP", "COMMERCIAL_AUTO"],
  TRUCKING: ["COMMERCIAL_AUTO", "GENERAL_LIABILITY", "WORKERS_COMP"],
  PROPERTY_MANAGEMENT: ["GENERAL_LIABILITY", "COMMERCIAL_PROPERTY", "PROFESSIONAL_LIABILITY", "WORKERS_COMP"],
  RETAIL: ["GENERAL_LIABILITY", "COMMERCIAL_PROPERTY", "WORKERS_COMP"],
  OTHER: ["GENERAL_LIABILITY", "COMMERCIAL_PROPERTY", "WORKERS_COMP"],
};

 /** Recommended (lower weight) per industry. */
export const RECOMMENDED_COVERAGES: Record<Industry, CoverageCode[]> = {
  ECOMMERCE_CPG: ["BUSINESS_INTERRUPTION"],
  RESTAURANTS: ["BUSINESS_INTERRUPTION", "COMMERCIAL_AUTO", "CYBER_LIABILITY"],
  CONTRACTORS: ["COMMERCIAL_PROPERTY", "UMBRELLA", "PROFESSIONAL_LIABILITY"],
  TRUCKING: ["UMBRELLA", "COMMERCIAL_PROPERTY"],
  PROPERTY_MANAGEMENT: ["CYBER_LIABILITY", "UMBRELLA"],
  RETAIL: ["BUSINESS_INTERRUPTION", "CYBER_LIABILITY"],
  OTHER: ["BUSINESS_INTERRUPTION", "CYBER_LIABILITY"],
};

// 7.3 Min limits (under-limit = -5pt penalty if present but below).
export const MIN_LIMITS: Partial<Record<CoverageCode, number>> = {
  GENERAL_LIABILITY: 1000000,
  PRODUCT_LIABILITY: 1000000,
  COMMERCIAL_PROPERTY: 100000,
  CYBER_LIABILITY: 500000,
  COMMERCIAL_AUTO: 1000000,
  UMBRELLA: 1000000,
};

// 7.6 Base exposure table (pre-mitigation %; coverages subtract to produce final).
export const EXPOSURE_BASES: Record<Industry, { property: number; liability: number; cyber: number; businessInterruption: number }> = {
  ECOMMERCE_CPG: { property: 60, liability: 85, cyber: 80, businessInterruption: 70 },
  RESTAURANTS: { property: 80, liability: 80, cyber: 45, businessInterruption: 75 },
  CONTRACTORS: { property: 65, liability: 88, cyber: 40, businessInterruption: 55 },
  TRUCKING: { property: 70, liability: 85, cyber: 35, businessInterruption: 60 },
  PROPERTY_MANAGEMENT: { property: 75, liability: 78, cyber: 55, businessInterruption: 60 },
  RETAIL: { property: 70, liability: 75, cyber: 55, businessInterruption: 65 },
  OTHER: { property: 70, liability: 75, cyber: 55, businessInterruption: 65 },
};

/**
 * Human label for a coverage code (used in tables/gaps).
 * Ties directly to spec coverage names.
 */
export function getCoverageLabel(code: CoverageCode): string {
  switch (code) {
    case "GENERAL_LIABILITY": return "General Liability";
    case "COMMERCIAL_PROPERTY": return "Commercial Property";
    case "BUSINESS_OWNERS_POLICY": return "Business Owners Policy (BOP)";
    case "PRODUCT_LIABILITY": return "Product Liability";
    case "PROFESSIONAL_LIABILITY": return "Professional Liability";
    case "COMMERCIAL_AUTO": return "Commercial Auto";
    case "UMBRELLA": return "Umbrella";
    case "WORKERS_COMP": return "Workers' Compensation";
    case "CYBER_LIABILITY": return "Cyber Liability";
    case "BUSINESS_INTERRUPTION": return "Business Interruption";
    case "OTHER": return "Other";
  }
}

/**
 * Does the present coverage satisfy the required one?
 * Special case: BOP satisfies GL + COMMERCIAL_PROPERTY (spec §7.1).
 */
export function satisfiesCoverage(coverage: ExtractedCoverage | CoverageCode, required: CoverageCode): boolean {
  const code = typeof coverage === "string" ? coverage : coverage.code;
  if (code === required) return true;
  if (code === "BUSINESS_OWNERS_POLICY" && (required === "GENERAL_LIABILITY" || required === "COMMERCIAL_PROPERTY")) {
    return true;
  }
  return false;
}

/**
 * WC is only required (essential) when >=1 employee (spec rule).
 * Affects required list + scoring + gaps.
 */
export function hasWorkersCompRequirement(profile: BusinessProfile): boolean {
  return profile.employeeCount >= 1;
}

/**
 * Shared required list builder (essentials + recommended, WC conditional, deduped).
 * Used by carriers for fit-bonus. Scoring recomputes split lists for different weights.
 * This is the canonical "required" for an industry+profile.
 */
export function getRequiredCoverages(profile: BusinessProfile): CoverageCode[] {
  const industry = profile.industry;
  let required: CoverageCode[] = [
    ...ESSENTIAL_COVERAGES[industry],
    ...RECOMMENDED_COVERAGES[industry],
  ];
  if (!hasWorkersCompRequirement(profile)) {
    required = required.filter((c) => c !== "WORKERS_COMP");
  }
  return Array.from(new Set(required));
}
