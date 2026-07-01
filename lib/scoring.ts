import {
  PolicyData,
  BusinessProfile,
  ScoreResult,
  Exposure,
  Gap,
  CoverageCode,
} from "./types";
import {
  ESSENTIAL_COVERAGES,
  RECOMMENDED_COVERAGES,
  MIN_LIMITS,
  EXPOSURE_BASES,
  hasWorkersCompRequirement,
  satisfiesCoverage,
  getCoverageLabel,
} from "./taxonomy";

/**
 * Scoring engine (pure functions, deterministic, spec §7).
 * computeCoverageScore, computeExposures, computeGaps are the core.
 * computeScoreResult wires them for UI.
 * Thresholds/colors are here (used by StatCards/ExposureBars).
 */

// Internal clamp (no export).
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Coverage score 0-100 (sample yields exactly 74).
 * -18 per missing essential, -8 per missing recommended, -5 per under-limit present.
 * WC filtered per profile. Non-insurance => 0.
 * Duplicated list build vs getRequiredCoverages is intentional (different weights + exact match to prior audits).
 */
export function computeCoverageScore(
  policy: PolicyData,
  profile: BusinessProfile,
): number {
  // Note: list construction duplicated (see getRequiredCoverages in taxonomy + computeGaps here); carriers uses shared version. Kept for minimal diff + exact sample behavior.
  if (!policy.isInsuranceDocument) return 0;

  const present = policy.coverages;
  let score = 100;

  const industry = profile.industry;
  const essentials = [...ESSENTIAL_COVERAGES[industry]];
  const recommended = [...RECOMMENDED_COVERAGES[industry]];

  // WORKERS_COMP only essential if employees >=1
  if (!hasWorkersCompRequirement(profile)) {
    const idx = essentials.indexOf("WORKERS_COMP");
    if (idx >= 0) essentials.splice(idx, 1);
  }

  // Check missing essentials
  for (const req of essentials) {
    const has = present.some((c) => satisfiesCoverage(c, req));
    if (!has) {
      score -= 18;
    }
  }

  // Check missing recommended
  for (const req of recommended) {
    const has = present.some((c) => satisfiesCoverage(c, req));
    if (!has) {
      score -= 8;
    }
  }

  // Under-limit penalties for present coverages (per §7.2: any present with defined min limit below threshold)
  for (const cov of present) {
    if (cov.limit !== null) {
      const min = MIN_LIMITS[cov.code];
      if (min !== undefined && cov.limit < min) {
        score -= 5;
      }
    }
  }

  return clamp(Math.round(score), 0, 100);
}

/**
 * Compute post-mitigation exposure % + band per category (§7.6).
 * Reductions are hardcoded per spec; clamped 5-100.
 * hasCoverage helper reuses satisfiesCoverage (BOP etc).
 * Output order: Property, Liability, Cyber, BI (matches UI).
 */
export function computeExposures(
  policy: PolicyData,
  profile: BusinessProfile,
): Exposure[] {
  const bases = EXPOSURE_BASES[profile.industry];
  const present = policy.coverages;

  const hasCoverage = (code: CoverageCode) =>
    present.some((c) => satisfiesCoverage(c, code));

  // Property Damage
  let property = bases.property;
  if (
    hasCoverage("COMMERCIAL_PROPERTY") ||
    hasCoverage("BUSINESS_OWNERS_POLICY")
  ) {
    property -= 45;
  }
  property = clamp(property, 5, 100);

  // Liability
  let liability = bases.liability;
  if (hasCoverage("GENERAL_LIABILITY")) liability -= 25;
  if (hasCoverage("PRODUCT_LIABILITY")) liability -= 20;
  if (hasCoverage("UMBRELLA")) liability -= 15;
  liability = clamp(liability, 5, 100);

  // Cyber
  let cyber = bases.cyber;
  if (hasCoverage("CYBER_LIABILITY")) cyber -= 55;
  cyber = clamp(cyber, 5, 100);

  // Business Interruption
  let bi = bases.businessInterruption;
  if (hasCoverage("BUSINESS_INTERRUPTION")) {
    bi -= 50;
  } else if (hasCoverage("BUSINESS_OWNERS_POLICY")) {
    bi -= 15;
  }
  bi = clamp(bi, 5, 100);

  const toBand = (v: number): "Low" | "Medium" | "High" => getExposureBand(v);

  return [
    {
      category: "Property Damage",
      value: Math.round(property),
      band: toBand(property),
    },
    {
      category: "Liability",
      value: Math.round(liability),
      band: toBand(liability),
    },
    { category: "Cyber", value: Math.round(cyber), band: toBand(cyber) },
    {
      category: "Business Interruption",
      value: Math.round(bi),
      band: toBand(bi),
    },
  ];
}

/**
 * Gaps list (High severity = essential missing; Medium = recommended).
 * whyMap provides spec-aligned human reasons.
 * Dupe list logic same reason as in computeCoverageScore.
 * Empty if !isInsuranceDocument.
 */
export function computeGaps(
  policy: PolicyData,
  profile: BusinessProfile,
): Gap[] {
  if (!policy.isInsuranceDocument) return [];

  const present = policy.coverages;
  const industry = profile.industry;
  const gaps: Gap[] = [];

  const essentials = [...ESSENTIAL_COVERAGES[industry]];
  const recommended = [...RECOMMENDED_COVERAGES[industry]];
  // Note: list construction duplicated (see getRequiredCoverages in taxonomy + computeGaps here); carriers uses shared version. Kept for minimal diff + exact sample behavior. (cross-check computeCoverageScore and computeScoreResult)

  if (!hasWorkersCompRequirement(profile)) {
    const idx = essentials.indexOf("WORKERS_COMP");
    if (idx >= 0) essentials.splice(idx, 1);
  }

  const whyMap: Partial<Record<CoverageCode, string>> = {
    CYBER_LIABILITY:
      "Handles customer data and online payments; a breach is uninsured without this.",
    BUSINESS_INTERRUPTION:
      "No income protection if operations stop after a covered loss.",
    GENERAL_LIABILITY:
      "Third-party injury and property-damage claims would be paid out of pocket.",
    PRODUCT_LIABILITY: "Product-related claims would be paid out of pocket.",
    COMMERCIAL_PROPERTY:
      "Physical assets and premises are unprotected without this.",
    COMMERCIAL_AUTO:
      "Vehicle-related liability and physical damage claims are uninsured.",
    WORKERS_COMP: "Employee injury claims would be paid out of pocket.",
    PROFESSIONAL_LIABILITY: "Errors and omissions claims would be uninsured.",
    UMBRELLA: "Excess liability beyond primary policy limits is uncovered.",
  };

  for (const req of essentials) {
    const has = present.some((c) => satisfiesCoverage(c, req));
    if (!has) {
      gaps.push({
        code: req,
        label: getCoverageLabel(req),
        severity: "High",
        why:
          whyMap[req] ||
          "This coverage is essential for the selected industry.",
      });
    }
  }

  for (const req of recommended) {
    const has = present.some((c) => satisfiesCoverage(c, req));
    if (!has) {
      gaps.push({
        code: req,
        label: getCoverageLabel(req),
        severity: "Medium",
        why:
          whyMap[req] ||
          "This coverage is recommended for the selected industry.",
      });
    }
  }

  return gaps;
}

/**
 * Convenience aggregator (used by page.tsx useMemo).
 * Always calls the three pure fns; count is raw extracted len.
 */
export function computeScoreResult(
  policy: PolicyData,
  profile: BusinessProfile,
): ScoreResult {
  const coverageScore = computeCoverageScore(policy, profile);
  const exposures = computeExposures(policy, profile);
  const gaps = computeGaps(policy, profile);
  const coveragesPresentCount = policy.coverages.length;

  return {
    coverageScore,
    gaps,
    exposures,
    coveragesPresentCount,
  };
}

/**
 * Band -> color for ExposureBars (High=red etc). Centralized here.
 * NOTE: carrier % colors and score colors use similar but intentionally different cutoffs (70/55 and 75/50).
 */
export function getBandColor(band: "Low" | "Medium" | "High"): string {
  if (band === "High") return "#dc2626";
  if (band === "Medium") return "#d97706";
  return "#16a34a";
}

/**
 * Exposure value -> band (High exposure risk if >=70 after mitigation).
 * Used inside computeExposures and UI.
 */
export function getExposureBand(value: number): "Low" | "Medium" | "High" {
  if (value >= 70) return "High";
  if (value >= 40) return "Medium";
  return "Low";
}

/**
 * Score gauge color (used by StatCards). >=75 good (green).
 * Different thresholds than exposure bands (70/40). Carrier match % colors were for removed UI display.
 */
export function getScoreColor(score: number): string {
  if (score >= 75) return "#16a34a";
  if (score >= 50) return "#d97706";
  return "#dc2626";
}
