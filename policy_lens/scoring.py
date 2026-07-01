"""
Port of lib/scoring.ts EXACTLY.
Pure, deterministic functions. Sample must yield coverageScore=74, gaps=2, exposures=[15,40,80,70].
All math, clamps, conditionals, WC filter, BOP satisfies, etc. match verbatim.
"""
from __future__ import annotations

from .types import BusinessProfile, Exposure, Gap, PolicyData, ScoreResult, CoverageCode
from .taxonomy import (
    ESSENTIAL_COVERAGES,
    RECOMMENDED_COVERAGES,
    MIN_LIMITS,
    EXPOSURE_BASES,
    has_workers_comp_requirement,
    satisfies_coverage,
    get_coverage_label,
)


def _clamp(value: float, min_v: float, max_v: float) -> float:
    return max(min_v, min(max_v, value))


def compute_coverage_score(policy: PolicyData, profile: BusinessProfile) -> int:
    if not policy.isInsuranceDocument:
        return 0

    present = policy.coverages
    score = 100

    industry = profile.industry
    essentials = list(ESSENTIAL_COVERAGES[industry])
    recommended = list(RECOMMENDED_COVERAGES[industry])

    if not has_workers_comp_requirement(profile):
        if "WORKERS_COMP" in essentials:
            essentials.remove("WORKERS_COMP")

    for req in essentials:
        has = any(satisfies_coverage(c, req) for c in present)
        if not has:
            score -= 18

    for req in recommended:
        has = any(satisfies_coverage(c, req) for c in present)
        if not has:
            score -= 8

    for cov in present:
        if cov.limit is not None:
            min_l = MIN_LIMITS.get(cov.code)
            if min_l is not None and cov.limit < min_l:
                score -= 5

    return int(_clamp(round(score), 0, 100))


def compute_exposures(policy: PolicyData, profile: BusinessProfile) -> list[Exposure]:
    bases = EXPOSURE_BASES[profile.industry]
    present = policy.coverages

    def has_coverage(code: CoverageCode) -> bool:
        return any(satisfies_coverage(c, code) for c in present)

    # Property
    prop = bases["property"]
    if has_coverage("COMMERCIAL_PROPERTY") or has_coverage("BUSINESS_OWNERS_POLICY"):
        prop -= 45
    prop = _clamp(prop, 5, 100)

    # Liability
    liab = bases["liability"]
    if has_coverage("GENERAL_LIABILITY"):
        liab -= 25
    if has_coverage("PRODUCT_LIABILITY"):
        liab -= 20
    if has_coverage("UMBRELLA"):
        liab -= 15
    liab = _clamp(liab, 5, 100)

    # Cyber
    cyb = bases["cyber"]
    if has_coverage("CYBER_LIABILITY"):
        cyb -= 55
    cyb = _clamp(cyb, 5, 100)

    # BI
    bi = bases["businessInterruption"]
    if has_coverage("BUSINESS_INTERRUPTION"):
        bi -= 50
    elif has_coverage("BUSINESS_OWNERS_POLICY"):
        bi -= 15
    bi = _clamp(bi, 5, 100)

    return [
        Exposure(category="Property Damage", value=round(prop), band=get_exposure_band(round(prop))),
        Exposure(category="Liability", value=round(liab), band=get_exposure_band(round(liab))),
        Exposure(category="Cyber", value=round(cyb), band=get_exposure_band(round(cyb))),
        Exposure(category="Business Interruption", value=round(bi), band=get_exposure_band(round(bi))),
    ]


def compute_gaps(policy: PolicyData, profile: BusinessProfile) -> list[Gap]:
    if not policy.isInsuranceDocument:
        return []

    present = policy.coverages
    industry = profile.industry
    gaps: list[Gap] = []

    essentials = list(ESSENTIAL_COVERAGES[industry])
    recommended = list(RECOMMENDED_COVERAGES[industry])

    if not has_workers_comp_requirement(profile):
        if "WORKERS_COMP" in essentials:
            essentials.remove("WORKERS_COMP")

    why_map: dict[CoverageCode, str] = {
        "CYBER_LIABILITY": "Handles customer data and online payments; a breach is uninsured without this.",
        "BUSINESS_INTERRUPTION": "No income protection if operations stop after a covered loss.",
        "GENERAL_LIABILITY": "Third-party injury and property-damage claims would be paid out of pocket.",
        "PRODUCT_LIABILITY": "Product-related claims would be paid out of pocket.",
        "COMMERCIAL_PROPERTY": "Physical assets and premises are unprotected without this.",
        "COMMERCIAL_AUTO": "Vehicle-related liability and physical damage claims are uninsured.",
        "WORKERS_COMP": "Employee injury claims would be paid out of pocket.",
        "PROFESSIONAL_LIABILITY": "Errors and omissions claims would be uninsured.",
        "UMBRELLA": "Excess liability beyond primary policy limits is uncovered.",
    }

    for req in essentials:
        has = any(satisfies_coverage(c, req) for c in present)
        if not has:
            gaps.append(Gap(
                code=req,
                label=get_coverage_label(req),
                severity="High",
                why=why_map.get(req, "This coverage is essential for the selected industry."),
            ))

    for req in recommended:
        has = any(satisfies_coverage(c, req) for c in present)
        if not has:
            gaps.append(Gap(
                code=req,
                label=get_coverage_label(req),
                severity="Medium",
                why=why_map.get(req, "This coverage is recommended for the selected industry."),
            ))

    return gaps


def compute_score_result(policy: PolicyData, profile: BusinessProfile) -> ScoreResult:
    return ScoreResult(
        coverageScore=compute_coverage_score(policy, profile),
        gaps=compute_gaps(policy, profile),
        exposures=compute_exposures(policy, profile),
        coveragesPresentCount=len(policy.coverages),
    )


def get_band_color(band: str) -> str:
    if band == "High":
        return "#dc2626"
    if band == "Medium":
        return "#d97706"
    return "#16a34a"


def get_exposure_band(value: int) -> str:
    if value >= 70:
        return "High"
    if value >= 40:
        return "Medium"
    return "Low"


def get_score_color(score: int) -> str:
    if score >= 75:
        return "#16a34a"
    if score >= 50:
        return "#d97706"
    return "#dc2626"
