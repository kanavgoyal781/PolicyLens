"""
Port of lib/taxonomy.ts exactly.
Single source of truth: codes, industries, matrices, labels, helpers.
"""
from __future__ import annotations

from .types import BusinessProfile, CoverageCode, ExtractedCoverage

COVERAGE_CODES: list[CoverageCode] = [
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
]

INDUSTRIES: list[BusinessProfile.__annotations__["industry"]] = [
    "ECOMMERCE_CPG",
    "RESTAURANTS",
    "CONTRACTORS",
    "TRUCKING",
    "PROPERTY_MANAGEMENT",
    "RETAIL",
    "OTHER",
]

REVENUE_BANDS = ["LT_250K", "B250K_1M", "B1M_5M", "B5M_10M", "GT_10M"]

INDUSTRY_LABELS = {
    "ECOMMERCE_CPG": "E-commerce / CPG",
    "RESTAURANTS": "Restaurants",
    "CONTRACTORS": "Contractors",
    "TRUCKING": "Trucking",
    "PROPERTY_MANAGEMENT": "Property Management",
    "RETAIL": "Retail",
    "OTHER": "Other",
}

REVENUE_LABELS = {
    "LT_250K": "< $250K",
    "B250K_1M": "$250K – $1M",
    "B1M_5M": "$1M – $5M",
    "B5M_10M": "$5M – $10M",
    "GT_10M": "> $10M",
}

DEFAULT_PROFILE = BusinessProfile(
    industry="ECOMMERCE_CPG",
    annualRevenueBand="B1M_5M",
    employeeCount=25,
)

# 7.1 matrices
ESSENTIAL_COVERAGES: dict[str, list[CoverageCode]] = {
    "ECOMMERCE_CPG": ["GENERAL_LIABILITY", "PRODUCT_LIABILITY", "CYBER_LIABILITY", "WORKERS_COMP", "COMMERCIAL_PROPERTY"],
    "RESTAURANTS": ["GENERAL_LIABILITY", "COMMERCIAL_PROPERTY", "WORKERS_COMP"],
    "CONTRACTORS": ["GENERAL_LIABILITY", "WORKERS_COMP", "COMMERCIAL_AUTO"],
    "TRUCKING": ["COMMERCIAL_AUTO", "GENERAL_LIABILITY", "WORKERS_COMP"],
    "PROPERTY_MANAGEMENT": ["GENERAL_LIABILITY", "COMMERCIAL_PROPERTY", "PROFESSIONAL_LIABILITY", "WORKERS_COMP"],
    "RETAIL": ["GENERAL_LIABILITY", "COMMERCIAL_PROPERTY", "WORKERS_COMP"],
    "OTHER": ["GENERAL_LIABILITY", "COMMERCIAL_PROPERTY", "WORKERS_COMP"],
}

RECOMMENDED_COVERAGES: dict[str, list[CoverageCode]] = {
    "ECOMMERCE_CPG": ["BUSINESS_INTERRUPTION"],
    "RESTAURANTS": ["BUSINESS_INTERRUPTION", "COMMERCIAL_AUTO", "CYBER_LIABILITY"],
    "CONTRACTORS": ["COMMERCIAL_PROPERTY", "UMBRELLA", "PROFESSIONAL_LIABILITY"],
    "TRUCKING": ["UMBRELLA", "COMMERCIAL_PROPERTY"],
    "PROPERTY_MANAGEMENT": ["CYBER_LIABILITY", "UMBRELLA"],
    "RETAIL": ["BUSINESS_INTERRUPTION", "CYBER_LIABILITY"],
    "OTHER": ["BUSINESS_INTERRUPTION", "CYBER_LIABILITY"],
}

MIN_LIMITS: dict[CoverageCode, int] = {
    "GENERAL_LIABILITY": 1000000,
    "PRODUCT_LIABILITY": 1000000,
    "COMMERCIAL_PROPERTY": 100000,
    "CYBER_LIABILITY": 500000,
    "COMMERCIAL_AUTO": 1000000,
    "UMBRELLA": 1000000,
}

EXPOSURE_BASES = {
    "ECOMMERCE_CPG": {"property": 60, "liability": 85, "cyber": 80, "businessInterruption": 70},
    "RESTAURANTS": {"property": 80, "liability": 80, "cyber": 45, "businessInterruption": 75},
    "CONTRACTORS": {"property": 65, "liability": 88, "cyber": 40, "businessInterruption": 55},
    "TRUCKING": {"property": 70, "liability": 85, "cyber": 35, "businessInterruption": 60},
    "PROPERTY_MANAGEMENT": {"property": 75, "liability": 78, "cyber": 55, "businessInterruption": 60},
    "RETAIL": {"property": 70, "liability": 75, "cyber": 55, "businessInterruption": 65},
    "OTHER": {"property": 70, "liability": 75, "cyber": 55, "businessInterruption": 65},
}

def get_coverage_label(code: CoverageCode) -> str:
    return {
        "GENERAL_LIABILITY": "General Liability",
        "COMMERCIAL_PROPERTY": "Commercial Property",
        "BUSINESS_OWNERS_POLICY": "Business Owners Policy (BOP)",
        "PRODUCT_LIABILITY": "Product Liability",
        "PROFESSIONAL_LIABILITY": "Professional Liability",
        "COMMERCIAL_AUTO": "Commercial Auto",
        "UMBRELLA": "Umbrella",
        "WORKERS_COMP": "Workers' Compensation",
        "CYBER_LIABILITY": "Cyber Liability",
        "BUSINESS_INTERRUPTION": "Business Interruption",
        "OTHER": "Other",
    }[code]

def satisfies_coverage(coverage: ExtractedCoverage | CoverageCode, required: CoverageCode) -> bool:
    code = coverage if isinstance(coverage, str) else coverage.code
    if code == required:
        return True
    if code == "BUSINESS_OWNERS_POLICY" and required in ("GENERAL_LIABILITY", "COMMERCIAL_PROPERTY"):
        return True
    return False

def has_workers_comp_requirement(profile: BusinessProfile) -> bool:
    return profile.employeeCount >= 1

def get_required_coverages(profile: BusinessProfile) -> list[CoverageCode]:
    industry = profile.industry
    required = list(ESSENTIAL_COVERAGES[industry]) + list(RECOMMENDED_COVERAGES[industry])
    if not has_workers_comp_requirement(profile):
        required = [c for c in required if c != "WORKERS_COMP"]
    # dedupe preserving order
    seen = set()
    out = []
    for c in required:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out
