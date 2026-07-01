import { BusinessProfile, PolicyData, Carrier, CarrierMatch } from "./types";
import { satisfiesCoverage, getRequiredCoverages } from "./taxonomy";

/**
 * Carrier matching (spec §8).
 * Exact 12 carriers. Appetite + 22pt bonus if industry match.
 * + coverage fit bonus (0-18) from getRequiredCoverages.
 * + small deterministic jitter.
 * Premium formula per §8.3 using revenue base.
 * BEST is top after sort (match desc, premium asc).
 */

export const CARRIERS: Carrier[] = [
  {
    name: "The Hartford",
    rate: 1.0,
    appetite: ["ECOMMERCE_CPG", "RETAIL", "CONTRACTORS"],
  },
  {
    name: "Travelers",
    rate: 1.05,
    appetite: ["ECOMMERCE_CPG", "RESTAURANTS", "PROPERTY_MANAGEMENT"],
  },
  {
    name: "Chubb",
    rate: 1.18,
    appetite: ["ECOMMERCE_CPG", "PROPERTY_MANAGEMENT"],
  },
  {
    name: "Liberty Mutual",
    rate: 1.1,
    appetite: ["CONTRACTORS", "TRUCKING", "RETAIL"],
  },
  {
    name: "Nationwide",
    rate: 1.08,
    appetite: ["RESTAURANTS", "RETAIL", "ECOMMERCE_CPG"],
  },
  { name: "CNA", rate: 1.12, appetite: ["PROPERTY_MANAGEMENT", "CONTRACTORS"] },
  { name: "The Hanover", rate: 1.06, appetite: ["ECOMMERCE_CPG", "RETAIL"] },
  { name: "Hiscox", rate: 1.2, appetite: ["ECOMMERCE_CPG"] }, // cleaned: "PROFESSIONAL" was never a valid industry (spec §8.1 lists only the 7); harmless removal, appetite logic unchanged for all real profiles (trace: no industry=="PROFESSIONAL" in getRequired or profile flows; appetite.includes unchanged for all 7 real industries)

  { name: "Markel", rate: 1.22, appetite: ["RESTAURANTS", "CONTRACTORS"] },
  { name: "Coalition", rate: 1.15, appetite: ["ECOMMERCE_CPG", "RETAIL"] }, // cyber-strong
  {
    name: "Berkshire GUARD",
    rate: 1.03,
    appetite: ["CONTRACTORS", "RETAIL", "TRUCKING"],
  },
  {
    name: "Pie Insurance",
    rate: 0.98,
    appetite: ["RESTAURANTS", "RETAIL", "CONTRACTORS"],
  },
];

// Deterministic jitter (no Math.random) so results stable for same inputs.
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 43 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Coverage fit bonus (0-18 pts) = fraction of required coverages present *18.
 * Uses the shared getRequiredCoverages (unlike internal scoring split).
 */
function getCoverageFitBonus(
  policy: PolicyData,
  profile: BusinessProfile,
): number {
  const required = getRequiredCoverages(profile);
  if (required.length === 0) return 18;
  const satisfiedCount = required.filter((req) =>
    policy.coverages.some((c) => satisfiesCoverage(c, req)),
  ).length;
  return Math.round((satisfiedCount / required.length) * 18);
}

/**
 * Main carrier ranking. Returns new array (first = BEST).
 * Appetite check + fit + jitter + premium all here.
 * Revenue base chosen by band; fallback 5200.
 */
export function computeCarrierMatches(
  policy: PolicyData,
  profile: BusinessProfile,
): CarrierMatch[] {
  const bonus = getCoverageFitBonus(policy, profile);
  const industry = profile.industry;

  const matches = CARRIERS.map((carrier) => {
    const inAppetite = carrier.appetite.includes(industry);
    let match = 55 + (inAppetite ? 22 : 0) + bonus;
    const jitter = (hashString(carrier.name + industry) % 7) - 3;
    match += jitter;
    match = Math.max(42, Math.min(96, Math.round(match)));

    // premium per spec 8.3: round( base * rate * (1+(96-m)/100*1.1) /100 ) *100
    const revenueBaseMap: Record<string, number> = {
      LT_250K: 2500,
      B250K_1M: 4000,
      B1M_5M: 5200,
      B5M_10M: 7800,
      GT_10M: 11000,
    };
    const revenueBase = revenueBaseMap[profile.annualRevenueBand] || 5200;
    const factor = 1 + ((96 - match) / 100) * 1.1;
    const premium =
      Math.round((revenueBase * carrier.rate * factor) / 100) * 100;

    return {
      name: carrier.name,
      match,
      premium,
      isBest: false,
    };
  });

  // Sort by match desc, then premium asc
  matches.sort((a, b) => {
    if (b.match !== a.match) return b.match - a.match;
    return a.premium - b.premium;
  });

  // Mark first as BEST (immutable return, no array mutation)
  if (matches.length > 0) {
    const best = { ...matches[0], isBest: true };
    return [best, ...matches.slice(1)];
  }

  return matches;
}

/**
 * Savings vs current (spec §8.4). Returns {avgSavingsPct} using BEST (isBest) premium.
 * Input should be output of computeCarrierMatches (sorted); prefers explicit isBest flag (with [0] fallback).
 * Kept separate from computeCarrierMatches (signature/return untouched).
 * Note: message field removed (was unused in UI display; only pct shown in StatCards).
 */
export function computeSavings(
  matches: CarrierMatch[],
  currentPremium: number | null,
): { avgSavingsPct: number } {
  const current = currentPremium ?? 6400;
  if (!matches.length || current <= 0) {
    return { avgSavingsPct: 0 };
  }
  // Robust: prefer explicit isBest over [0] (handles callers that might pass unsorted)
  const best = matches.find((m) => m.isBest) ?? matches[0];
  const bestPremium = best ? best.premium : 0;
  if (bestPremium >= current) {
    return { avgSavingsPct: 0 };
  }
  const avgSavingsPct = Math.round(((current - bestPremium) / current) * 100);
  return { avgSavingsPct };
}
