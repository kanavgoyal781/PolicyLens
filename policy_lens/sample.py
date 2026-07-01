"""
Port of lib/sample.ts
SAMPLE_POLICY verbatim. Used for instant load + bypass detection on upload of sample-coi.pdf.
"""
from __future__ import annotations

from .types import PolicyData, ExtractedCoverage

SAMPLE_POLICY: PolicyData = PolicyData(
    namedInsured="Northwind Goods Co.",
    carrier="The Hartford",
    policyNumber="HFD-CGL-2026-558031",
    effectiveDate="2026-03-01",
    expirationDate="2027-03-01",
    annualPremiumTotal=6400,
    isInsuranceDocument=True,
    coverages=[
        ExtractedCoverage(code="GENERAL_LIABILITY", rawLabel="Commercial General Liability", limit=1000000, deductible=2500, premium=3150),
        ExtractedCoverage(code="PRODUCT_LIABILITY", rawLabel="Products / Completed Operations", limit=2000000, deductible=None, premium=1900),
        ExtractedCoverage(code="COMMERCIAL_PROPERTY", rawLabel="Commercial Property", limit=350000, deductible=5000, premium=1350),
        ExtractedCoverage(code="WORKERS_COMP", rawLabel="Workers' Compensation", limit=None, deductible=None, premium=0),
    ],
)
