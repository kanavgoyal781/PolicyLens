"""
PolicyLens - Streamlit port of the Next.js/TypeScript app.
Exact replication of current behavior after cleanups:
- 3 stat cards only (no savings, no carrier table)
- Profile: only Industry + Annual Revenue selects (employeeCount internal only)
- Live reactive recomputes on profile or policy change
- Load sample instant -> SCORE 74, 2 gaps, exposures 15/40/80/70
- Upload sample-coi.pdf identical to sample
- Graceful header: no ugly — • 
- Improved ACORD extraction (pdfplumber + verbatim prompts)
- MLOps: Pydantic, quality gate, DLQ (gated via ?dlq=1)
- All pure scoring deterministic match spec.
Run: streamlit run app.py
"""
from __future__ import annotations

from datetime import datetime

import streamlit as st

# Ported modules (exact logic)
from policy_lens import (
    DEFAULT_PROFILE,
    INDUSTRIES,
    REVENUE_BANDS,
    INDUSTRY_LABELS,
    REVENUE_LABELS,
    SAMPLE_POLICY,
    compute_score_result,
    get_band_color,
    get_score_color,
    get_coverage_label,
)
from policy_lens.types import PolicyData, BusinessProfile
from policy_lens.extraction import (
    extract_policy_from_upload,
    load_sample_policy,
)

# For DLQ viewer (gated)
from mlops.dlq import dlq  # reuses the exact Python DLQ impl (file based)

# Page config - matches clean demo feel
st.set_page_config(page_title="PolicyLens", layout="wide", page_icon="📋")

# --- Helpers ported / replicated from PolicyTable.tsx formatting ---
def format_money(n: int | None) -> str:
    if n is None:
        return "—"
    return "$" + f"{n:,}"

def format_date(iso: str | None) -> str:
    if not iso:
        return "—"
    m = __import__("re").match(r"^(\d{4})-(\d{2})-(\d{2})$", iso)
    if not m:
        return iso
    y, mo, da = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if mo < 1 or mo > 12 or da < 1 or da > 31:
        return iso
    try:
        d = datetime(y, mo, da)
        # unpadded day to match TS toLocaleDateString({day:"numeric"}) e.g. "Mar 1, 2026"
        return d.strftime("%b ") + str(d.day) + d.strftime(", %Y")
    except Exception:
        return iso

def get_policy_subtitle(policy: PolicyData) -> str:
    """Exact graceful logic: no leading/trailing • or "— • ".
    Builds with explicit <strong> on namedInsured (structured, like TS node list).
    """
    parts = []
    if policy.namedInsured:
        parts.append(f"<strong>{policy.namedInsured}</strong>")
    if policy.carrier:
        prefix = " • " if parts else ""
        parts.append(prefix + policy.carrier)
    if policy.policyNumber:
        prefix = " • " if parts else ""
        parts.append(prefix + policy.policyNumber)
    if not parts:
        return "—"
    return "".join(parts)

# --- State management (replicates useState + useMemo live reactivity) ---
def init_state():
    if "profile" not in st.session_state:
        st.session_state.profile = DEFAULT_PROFILE
    if "extracted" not in st.session_state:
        st.session_state.extracted = None  # PolicyData | dict fallback | None
    if "is_loading" not in st.session_state:
        st.session_state.is_loading = False
    if "upload_error" not in st.session_state:
        st.session_state.upload_error = None

init_state()

def get_current_policy() -> PolicyData | None:
    ex = st.session_state.extracted
    if ex is None:
        return None
    if isinstance(ex, dict):
        # dicts are always fallback non-policies (isInsuranceDocument: false)
        return None
    if getattr(ex, "isInsuranceDocument", False):
        return ex
    return None

def get_score_result(policy: PolicyData | None, profile: BusinessProfile):
    if not policy:
        return {
            "coverageScore": 0,
            "gaps": [],
            "exposures": [],
            "coveragesPresentCount": 0,
        }
    return compute_score_result(policy, profile)

# --- Action handlers ---
def load_sample():
    st.session_state.extracted = load_sample_policy()
    st.session_state.profile = DEFAULT_PROFILE
    st.session_state.upload_error = None
    st.session_state.pop("_last_upload_name", None)  # allow re-upload of same-named file
    # force rerun handled by streamlit on button

def handle_upload(file):
    st.session_state.is_loading = True
    st.session_state.upload_error = None
    st.session_state.extracted = None
    try:
        bytes_data = file.getvalue()
        fname = getattr(file, "name", "upload.pdf")
        result, is_fallback = extract_policy_from_upload(bytes_data, fname)
        st.session_state.extracted = result
    except Exception as e:
        st.session_state.extracted = {"isInsuranceDocument": False, "_fallback": True}
        st.session_state.upload_error = f"Upload failed. Using graceful fallback. ({e})"
    finally:
        st.session_state.is_loading = False

def clear_data():
    st.session_state.extracted = None
    st.session_state.upload_error = None
    st.session_state.pop("_last_upload_name", None)  # allow re-upload of same-named file after clear

def update_profile(industry: str | None = None, revenue: str | None = None):
    p = st.session_state.profile
    new_ind = industry if industry else p.industry
    new_rev = revenue if revenue else p.annualRevenueBand
    # keep employeeCount
    st.session_state.profile = BusinessProfile(
        industry=new_ind,  # type: ignore
        annualRevenueBand=new_rev,  # type: ignore
        employeeCount=p.employeeCount,
    )

# --- UI ---
st.markdown(
    """
    <style>
    .main .block-container { max-width: 1100px; padding-top: 1rem; }
    .stButton>button { font-weight: 600; }
    div[data-testid="stMetricValue"] { font-size: 2.8rem; font-weight: 600; }
    .small-note { font-size: 0.75rem; color: #64748b; }
    .header-title { font-size: 1.65rem; font-weight: 600; letter-spacing: -0.5px; color: #16223b; }
    .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; background: white; margin-bottom: 12px; }
    .severity-high { background:#fef2f2; color:#dc2626; padding:2px 8px; border-radius:999px; font-size:0.7rem; }
    .severity-med { background:#fefce8; color:#d97706; padding:2px 8px; border-radius:999px; font-size:0.7rem; }
    </style>
    """,
    unsafe_allow_html=True,
)

# Header
st.markdown(
    '<div style="border-bottom:1px solid #e2e8f0; padding-bottom:12px; margin-bottom:16px;">'
    '<span class="header-title">PolicyLens</span><br/>'
    '<span class="small-note">Coverage intelligence for commercial insurance.</span>'
    '</div>',
    unsafe_allow_html=True,
)

# Toolbar
col_profile, col_actions = st.columns([3, 2])

with col_profile:
    # Profile controls - EXACTLY two selects, no employees
    st.markdown('<span class="small-note" style="text-transform:uppercase;letter-spacing:1px">Industry</span>', unsafe_allow_html=True)
    cur_profile = st.session_state.profile
    sel_ind = st.selectbox(
        "Industry",
        options=INDUSTRIES,
        format_func=lambda x: INDUSTRY_LABELS.get(x, x),
        index=INDUSTRIES.index(cur_profile.industry),
        key="ind_select",
        label_visibility="collapsed",
    )
    if sel_ind != cur_profile.industry:
        update_profile(industry=sel_ind)

    st.markdown('<span class="small-note" style="text-transform:uppercase;letter-spacing:1px">Annual Revenue</span>', unsafe_allow_html=True)
    sel_rev = st.selectbox(
        "Annual Revenue",
        options=REVENUE_BANDS,
        format_func=lambda x: REVENUE_LABELS.get(x, x),
        index=REVENUE_BANDS.index(cur_profile.annualRevenueBand),
        key="rev_select",
        label_visibility="collapsed",
    )
    if sel_rev != cur_profile.annualRevenueBand:
        update_profile(revenue=sel_rev)

with col_actions:
    # Upload + buttons row
    upl = st.file_uploader(
        "Upload PDF",
        type=["pdf"],
        accept_multiple_files=False,
        label_visibility="collapsed",
        key="pdf_uploader",
        disabled=st.session_state.is_loading,
    )
    if upl is not None:
        # process only once per new file (use a simple guard)
        if st.session_state.get("_last_upload_name") != upl.name:
            st.session_state["_last_upload_name"] = upl.name
            handle_upload(upl)
            st.rerun()

    btn_cols = st.columns(3)
    with btn_cols[0]:
        if st.button("Load sample policy", disabled=st.session_state.is_loading, use_container_width=True):
            load_sample()
            st.rerun()
    with btn_cols[1]:
        if st.session_state.extracted is not None and get_current_policy() is not None:
            if st.button("Clear", use_container_width=True):
                clear_data()
                st.rerun()
    with btn_cols[2]:
        # DLQ gated by query param ?dlq=1
        is_dlq = st.query_params.get("dlq") == "1"
        if is_dlq:
            if st.button("DLQ", use_container_width=True, help="MLOps Dead Letter Queue (dev)"):
                st.session_state.show_dlq = not st.session_state.get("show_dlq", False)
                st.rerun()

# Loading
if st.session_state.is_loading:
    st.info("Extracting text and analyzing policy with LLM…", icon="⏳")

# Determine states (exact branches)
current_policy = get_current_policy()
score_res = get_score_result(current_policy, st.session_state.profile)
has_data = current_policy is not None
extracted = st.session_state.extracted
is_not_insurance = False
is_fallback = False
if extracted and isinstance(extracted, dict):
    is_not_insurance = not extracted.get("isInsuranceDocument", False)
    is_fallback = bool(extracted.get("_fallback"))

# Hero / empty
if not has_data and not st.session_state.is_loading and not is_not_insurance:
    st.markdown(
        '<div class="card" style="text-align:center; padding:48px 20px;">'
        '<div style="font-size:2rem; margin-bottom:12px">📋</div>'
        '<div style="font-size:1.25rem; font-weight:600; margin-bottom:8px">Upload a policy or load the sample</div>'
        '<p class="small-note" style="max-width:420px; margin:0 auto 16px">'
        'PolicyLens extracts coverages from a commercial COI or declarations page, scores risk posture, flags gaps.'
        '</p>',
        unsafe_allow_html=True,
    )
    c1, c2 = st.columns([1,1])
    with c1:
        if st.button("Load sample policy", type="primary", use_container_width=True):
            load_sample()
            st.rerun()
    with c2:
        # inline upload label
        st.caption("Or use the Upload PDF control above")
    st.markdown(
        '<div class="small-note" style="margin-top:16px">Sample data is bundled. Real uploads use server-side LLM extraction (key stays private).</div>',
        unsafe_allow_html=True,
    )
    st.markdown("</div>", unsafe_allow_html=True)

# Not insurance notice (yellow, friendly)
if is_not_insurance:
    st.markdown(
        '<div class="card" style="border-color:#f59e0b; background:#fefce8; padding:16px;">'
        '<div style="font-weight:600; margin-bottom:4px">We couldn\'t find policy data in that PDF.</div>'
        '<div class="small-note">Try a Certificate of Insurance or a declarations page, or load the sample.'
        + (' (LLM not configured — demo using sample path.)' if is_fallback else '') +
        '</div>',
        unsafe_allow_html=True,
    )
    if st.button("Load sample policy", key="load_from_notins"):
        load_sample()
        st.rerun()
    st.markdown("</div>", unsafe_allow_html=True)

# Main dashboard
if has_data and not st.session_state.is_loading:
    # === Stat cards (3 only) ===
    cscore = score_res["coverageScore"]
    gcount = len(score_res["gaps"])
    ccnt = score_res["coveragesPresentCount"]
    score_color = get_score_color(cscore)

    stat_cols = st.columns(3)
    with stat_cols[0]:
        st.markdown(
            f'<div class="card"><div class="small-note" style="margin-bottom:4px">Coverage Score</div>'
            f'<div style="font-size:2.8rem; font-weight:700; line-height:1">{cscore}</div>'
            f'<span style="display:inline-block; background:{score_color}; color:white; font-size:0.7rem; font-weight:700; padding:2px 10px; border-radius:999px;">{cscore}</span>'
            '<div class="small-note" style="margin-top:4px">Higher is stronger posture</div></div>',
            unsafe_allow_html=True,
        )
    with stat_cols[1]:
        st.markdown(
            f'<div class="card"><div class="small-note" style="margin-bottom:4px">Coverage Gaps</div>'
            f'<div style="font-size:2.8rem; font-weight:700; line-height:1; color:#dc2626">{gcount}</div>'
            '<div class="small-note" style="margin-top:4px">Missing essential or recommended coverages</div></div>',
            unsafe_allow_html=True,
        )
    with stat_cols[2]:
        st.markdown(
            f'<div class="card"><div class="small-note" style="margin-bottom:4px">Coverages on Policy</div>'
            f'<div style="font-size:2.8rem; font-weight:700; line-height:1">{ccnt}</div>'
            '<div class="small-note" style="margin-top:4px">Normalized line items extracted</div></div>',
            unsafe_allow_html=True,
        )

    st.markdown("<div style='height:12px'></div>")

    # Exposures + Gaps two col
    exp_col, gap_col = st.columns(2)

    with exp_col:
        st.markdown('<div class="card"><div style="font-weight:600; margin-bottom:8px; font-size:0.95rem">Risk Exposure by Category</div>', unsafe_allow_html=True)
        for exp in score_res["exposures"]:
            color = get_band_color(exp.band)
            pct = max(5, min(100, exp.value))
            st.markdown(
                f'<div style="margin-bottom:10px">'
                f'<div style="display:flex; justify-content:space-between; font-size:0.9rem; margin-bottom:2px">'
                f'<span style="font-weight:500">{exp.category}</span>'
                f'<span style="font-weight:600; color:{color}">{exp.value}% <span style="font-size:0.7rem; color:#64748b; font-weight:400">({exp.band})</span></span>'
                f'</div>'
                f'<div style="background:#f1f5f9; height:8px; border-radius:999px; overflow:hidden">'
                f'<div style="width:{pct}%; height:100%; background:{color}"></div>'
                f'</div></div>',
                unsafe_allow_html=True,
            )
        st.markdown('<div class="small-note">Higher = greater uninsured exposure. Mitigated by present coverages.</div></div>', unsafe_allow_html=True)

    with gap_col:
        gaps = score_res["gaps"]
        if not gaps:
            st.markdown('<div class="card"><div style="color:#64748b; font-size:0.9rem">No coverage gaps detected for this profile.</div></div>', unsafe_allow_html=True)
        else:
            st.markdown('<div class="card"><div style="font-weight:600; margin-bottom:8px; font-size:0.95rem">Coverage Gaps</div>', unsafe_allow_html=True)
            for g in gaps:
                sev_cls = "severity-high" if g.severity == "High" else "severity-med"
                st.markdown(
                    f'<div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:8px; background:white">'
                    f'<div style="margin-bottom:4px"><span style="font-weight:600">{g.label}</span> '
                    f'<span class="{sev_cls}">{g.severity}</span></div>'
                    f'<div style="font-size:0.8rem; color:#475569">{g.why}</div>'
                    f'</div>',
                    unsafe_allow_html=True,
                )
            st.markdown("</div>", unsafe_allow_html=True)

    st.markdown("<div style='height:12px'></div>")

    # Extracted Policy table + header (graceful)
    policy = current_policy
    st.markdown('<div class="card">', unsafe_allow_html=True)
    st.markdown('<div style="font-weight:600; font-size:0.95rem; margin-bottom:2px">Extracted Policy</div>', unsafe_allow_html=True)
    subtitle = get_policy_subtitle(policy)
    st.markdown(f'<div style="font-size:0.9rem">{subtitle}</div>', unsafe_allow_html=True)
    st.markdown(f'<div class="small-note">{format_date(policy.effectiveDate)} – {format_date(policy.expirationDate)}</div>', unsafe_allow_html=True)

    # Table
    st.markdown('<div style="overflow:auto; margin-top:8px">', unsafe_allow_html=True)
    if not policy.coverages:
        st.caption("No coverages extracted.")
    else:
        # Use streamlit table for fidelity
        table_data = []
        for c in policy.coverages:
            table_data.append({
                "Coverage": f"{get_coverage_label(c.code)} ({c.rawLabel})",
                "Limit": format_money(c.limit),
                "Deductible": format_money(c.deductible),
                "Premium": format_money(c.premium),
            })
        st.dataframe(table_data, hide_index=True, use_container_width=True)
    st.markdown('</div><div class="small-note" style="margin-top:6px">All values in USD. Limits shown per occurrence or aggregate as extracted.</div>', unsafe_allow_html=True)
    st.markdown("</div>", unsafe_allow_html=True)

    st.markdown(
        '<div class="small-note" style="margin-top:16px">Changing industry or revenue instantly recomputes the score, gaps, and exposures. All scoring logic is pure functions in <code>policy_lens/scoring.py</code>.</div>',
        unsafe_allow_html=True,
    )

# Upload error
if st.session_state.upload_error:
    st.error(st.session_state.upload_error)

# DLQ panel gated
is_dlq_enabled = st.query_params.get("dlq") == "1"
show_dlq = st.session_state.get("show_dlq", False)
if is_dlq_enabled and show_dlq:
    st.markdown("---")
    st.markdown("**MLOps Dead Letter Queue (recent failures)**")
    try:
        items = dlq.list(limit=8)
    except Exception:
        items = []
    if not items:
        st.caption("No entries yet. Failures during uploads/LLM/validation will appear here.")
    else:
        for it in items:
            rid = it.get("id", "?")
            rsn = it.get("reason", "")
            ts = it.get("timestamp", "")
            fname = it.get("original_filename") or it.get("filename", "")
            snip = (it.get("raw_text_snippet") or "")[:160]
            st.markdown(
                f'<div style="background:#fefce8; border:1px solid #fde047; padding:6px; margin:4px 0; font-family:monospace; font-size:0.7rem">'
                f'<strong>{rsn}</strong> @ {ts}<br/>file: {fname}<br/>snippet: {snip}…'
                f'</div>',
                unsafe_allow_html=True,
            )
    st.caption("Full data also in data/dlq/ (dlq-*.json + dead_letter.jsonl)")

# Footer
st.markdown(
    '<div style="border-top:1px solid #e2e8f0; margin-top:32px; padding-top:12px; text-align:center; font-size:0.7rem; color:#64748b">'
    'PolicyLens demo • Deterministic rules • LLM key never leaves process • Sample produces score 74, 2 gaps, exact exposures'
    '</div>',
    unsafe_allow_html=True,
)
