"""
Pydantic schemas for MLOps extraction pipeline.
Strict validation + versioned schema for the PolicyLens extraction contract.
"""
from __future__ import annotations

from datetime import date
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

# Keep in sync with TS lib/schemas.ts + lib/types.ts + taxonomy.ts COVERAGE_CODES.
SCHEMA_VERSION = "1.0.0"

class CoverageCode(str, Enum):
    GENERAL_LIABILITY = "GENERAL_LIABILITY"
    COMMERCIAL_PROPERTY = "COMMERCIAL_PROPERTY"
    BUSINESS_OWNERS_POLICY = "BUSINESS_OWNERS_POLICY"
    PRODUCT_LIABILITY = "PRODUCT_LIABILITY"
    PROFESSIONAL_LIABILITY = "PROFESSIONAL_LIABILITY"
    COMMERCIAL_AUTO = "COMMERCIAL_AUTO"
    UMBRELLA = "UMBRELLA"
    WORKERS_COMP = "WORKERS_COMP"
    CYBER_LIABILITY = "CYBER_LIABILITY"
    BUSINESS_INTERRUPTION = "BUSINESS_INTERRUPTION"
    OTHER = "OTHER"


class ExtractedCoverage(BaseModel):
    code: CoverageCode
    rawLabel: str = Field(..., min_length=1)
    limit: Optional[int] = Field(None, ge=0)
    deductible: Optional[int] = Field(None, ge=0)
    premium: Optional[int] = Field(None, ge=0)

    @field_validator("rawLabel")
    @classmethod
    def strip_raw_label(cls, v: str) -> str:
        return v.strip()


class PolicyData(BaseModel):
    # Mirrors TS PolicyData + Zod; extra=forbid strict.
    namedInsured: Optional[str] = None
    carrier: Optional[str] = None
    policyNumber: Optional[str] = None
    effectiveDate: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    expirationDate: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    annualPremiumTotal: Optional[int] = Field(None, ge=0)
    coverages: List[ExtractedCoverage] = Field(default_factory=list)
    isInsuranceDocument: bool = True

    schema_version: str = Field(default=SCHEMA_VERSION, frozen=True)

    @field_validator("coverages")
    @classmethod
    def at_least_one_if_insurance(cls, v: List[ExtractedCoverage], info):
        # Only enforce if we think it's an insurance doc
        if info.data.get("isInsuranceDocument", True) and len(v) == 0:
            # Allow empty for now; higher level can decide to DLQ
            pass
        return v

    @model_validator(mode="after")
    def normalize_dates_and_totals(self) -> "PolicyData":
        # Additional business rules can go here (e.g. exp > eff); quality gate is in extractor.
        return self

    model_config = {
        "extra": "forbid",  # strict like Pydantic good practice
        "populate_by_name": True,
    }


class ExtractionResult(BaseModel):
    """Wrapper returned by the extractor."""
    data: Optional[PolicyData] = None
    is_fallback: bool = False
    dlq_id: Optional[str] = None  # if sent to dead letter queue
    error: Optional[str] = None
