"""
Port of lib/types.ts - core domain types.
Use dataclasses for immutability + clarity. Pydantic used only for extraction validation (see mlops.schemas + local).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Literal

CoverageCode = Literal[
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

@dataclass(frozen=True)
class ExtractedCoverage:
    code: CoverageCode
    rawLabel: str
    limit: Optional[int] = None
    deductible: Optional[int] = None
    premium: Optional[int] = None

@dataclass(frozen=True)
class PolicyData:
    namedInsured: Optional[str]
    carrier: Optional[str]
    policyNumber: Optional[str]
    effectiveDate: Optional[str]
    expirationDate: Optional[str]
    annualPremiumTotal: Optional[int]
    coverages: List[ExtractedCoverage]
    isInsuranceDocument: bool = True

# Profile: employeeCount kept for internal WC logic (even if not exposed in UI selects)
@dataclass(frozen=True)
class BusinessProfile:
    industry: Literal[
        "ECOMMERCE_CPG",
        "RESTAURANTS",
        "CONTRACTORS",
        "TRUCKING",
        "PROPERTY_MANAGEMENT",
        "RETAIL",
        "OTHER",
    ]
    annualRevenueBand: Literal["LT_250K", "B250K_1M", "B1M_5M", "B5M_10M", "GT_10M"]
    employeeCount: int = 25

@dataclass(frozen=True)
class Exposure:
    category: str
    value: int
    band: Literal["Low", "Medium", "High"]

@dataclass(frozen=True)
class Gap:
    code: CoverageCode
    label: str
    severity: Literal["High", "Medium"]
    why: str

@dataclass(frozen=True)
class ScoreResult:
    coverageScore: int
    gaps: List[Gap]
    exposures: List[Exposure]
    coveragesPresentCount: int
