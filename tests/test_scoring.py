"""Core scoring unit tests. Verifies exact sample numbers and determinism / profile reactivity."""
import pytest
from policy_lens import SAMPLE_POLICY, DEFAULT_PROFILE, compute_score_result
from policy_lens.scoring import compute_coverage_score, compute_gaps, compute_exposures
from policy_lens.types import BusinessProfile

def test_sample_exact_numbers():
    res = compute_score_result(SAMPLE_POLICY, DEFAULT_PROFILE)
    assert res.coverageScore == 74
    assert len(res.gaps) == 2
    assert [g.severity for g in res.gaps] == ["High", "Medium"]
    assert [g.label for g in res.gaps] == ["Cyber Liability", "Business Interruption"]
    assert [e.value for e in res.exposures] == [15, 40, 80, 70]
    assert res.coveragesPresentCount == 4

def test_profile_change_recomputes_live():
    p_ec = compute_score_result(SAMPLE_POLICY, DEFAULT_PROFILE)
    p_rest = BusinessProfile(industry="RESTAURANTS", annualRevenueBand="B1M_5M", employeeCount=25)
    p_r = compute_score_result(SAMPLE_POLICY, p_rest)
    # Must differ
    assert p_r.coverageScore != p_ec.coverageScore or len(p_r.gaps) != len(p_ec.gaps)

def test_wc_excluded_when_zero_employees():
    # Build a variant of sample without WC coverage to demonstrate WC conditional
    from policy_lens.types import PolicyData, ExtractedCoverage
    no_wc_covs = [c for c in SAMPLE_POLICY.coverages if c.code != "WORKERS_COMP"]
    policy_no_wc = PolicyData(
        namedInsured=SAMPLE_POLICY.namedInsured,
        carrier=SAMPLE_POLICY.carrier,
        policyNumber=SAMPLE_POLICY.policyNumber,
        effectiveDate=SAMPLE_POLICY.effectiveDate,
        expirationDate=SAMPLE_POLICY.expirationDate,
        annualPremiumTotal=SAMPLE_POLICY.annualPremiumTotal,
        coverages=no_wc_covs,
        isInsuranceDocument=True,
    )
    prof_with = BusinessProfile(industry="ECOMMERCE_CPG", annualRevenueBand="B1M_5M", employeeCount=10)
    prof_zero = BusinessProfile(industry="ECOMMERCE_CPG", annualRevenueBand="B1M_5M", employeeCount=0)
    res_with = compute_score_result(policy_no_wc, prof_with)
    res_zero = compute_score_result(policy_no_wc, prof_zero)
    # With employees: missing WC is essential -> +1 High gap +18pt penalty
    codes_with = [g.code for g in res_with.gaps]
    codes_zero = [g.code for g in res_zero.gaps]
    assert "WORKERS_COMP" in codes_with
    assert "WORKERS_COMP" not in codes_zero
    assert res_with.coverageScore == res_zero.coverageScore - 18  # penalty applies only when required

def test_pure_deterministic():
    r1 = compute_score_result(SAMPLE_POLICY, DEFAULT_PROFILE)
    r2 = compute_score_result(SAMPLE_POLICY, DEFAULT_PROFILE)
    assert r1.coverageScore == r2.coverageScore
    assert len(r1.gaps) == len(r2.gaps)


# --- Extraction robustness tests (bypass edge + monetary filter) added per review ---
def test_bypass_does_not_trigger_on_quoting_non_sample_doc():
    """Spec PDF (and similar) quotes sample literals; after robust predicate must fallback."""
    from policy_lens.extraction import extract_policy_from_upload
    with open("PolicyLens_Build_Spec.pdf", "rb") as f:
        b = f.read()
    res, is_fb = extract_policy_from_upload(b, "PolicyLens_Build_Spec.pdf")
    assert is_fb is True
    if hasattr(res, "namedInsured"):
        assert res.namedInsured != "Northwind Goods Co."
    else:
        assert res.get("isInsuranceDocument") is False


def test_monetary_filter_drops_blank_template_rows():
    """LLM may return blank rows (e.g. Umbrella/WC templates); filter must drop them before gate/return."""
    from mlops.schemas import PolicyData as MLPyPolicyData
    from policy_lens.extraction import validate_and_gate
    # Simulate LLM output containing one real + one blank template row (no monetary)
    llm_json = {
        "namedInsured": "Test Co",
        "carrier": "Test Ins",
        "policyNumber": "P-123",
        "effectiveDate": "2026-01-01",
        "expirationDate": "2027-01-01",
        "annualPremiumTotal": 1000,
        "coverages": [
            {"code": "GENERAL_LIABILITY", "rawLabel": "GL", "limit": 1000000, "deductible": 0, "premium": 500},
            {"code": "UMBRELLA", "rawLabel": "Umbrella", "limit": None, "deductible": None, "premium": None},
        ],
        "isInsuranceDocument": True,
    }
    validated, dlq_id, err = validate_and_gate(llm_json, "sample text with ACORD", "test-coi.pdf")
    assert validated is not None
    assert err is None
    assert len(validated.coverages) == 1
    assert validated.coverages[0].code == "GENERAL_LIABILITY"
