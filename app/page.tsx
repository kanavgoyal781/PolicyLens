"use client";

// Main UI for PolicyLens (client component).
// State machine: empty -> loading (upload) -> hasData (dashboard) or not-insurance notice.
// All recomputes (score/gaps/exposures) are live via useMemo on profile+policy change.
// Sample load is instant (no net). Upload goes to /api/extract (unpdf+LLM+Zod+DLQ).
// Profile dropdowns drive reactive everything (spec requirement).

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { PolicyData, BusinessProfile, ScoreResult } from "../lib/types";
import { DEFAULT_PROFILE } from "../lib/taxonomy";
import { SAMPLE_POLICY } from "../lib/sample";
import { computeScoreResult } from "../lib/scoring";
import { computeCarrierMatches, computeSavings } from "../lib/carriers";

import ProfileControls from "../components/ProfileControls";
import UploadDropzone from "../components/UploadDropzone";
import StatCards from "../components/StatCards";
import ExposureBars from "../components/ExposureBars";
import GapList from "../components/GapList";
import PolicyTable from "../components/PolicyTable";
import CarrierTable from "../components/CarrierTable";

// Stable default (no fresh object on renders for savings fallback)
const NO_SAVINGS = { avgSavingsPct: 0 };

// MLOps dev helper gated via ?dlq=1 (avoids direct process.env.NODE_ENV in client bundle for hygiene)

interface FallbackDoc {
  isInsuranceDocument: false;
  _fallback?: boolean;
}

type ExtractedState = PolicyData | FallbackDoc | null;

export default function PolicyLens() {
  // Core state
  const [profile, setProfile] = useState<BusinessProfile>(DEFAULT_PROFILE);
  const [extracted, setExtracted] = useState<ExtractedState>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // MLOps: Dead Letter Queue viewer state (only visible with ?dlq=1)
  const [showDlq, setShowDlq] = useState(false);
  const [dlqItems, setDlqItems] = useState<Record<string, unknown>[]>([]);
  const [dlqLoading, setDlqLoading] = useState(false);

  // Client-only dlq mode flag (avoids window access during SSR/hydration which could cause console errors or mismatch).
  // useEffect + setState is required pattern here (useMemo on query would mismatch server/client HTML); disable silences strict react-hooks rule for safe one-time post-mount init.
  const [isDlqEnabled, setIsDlqEnabled] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsDlqEnabled(
        new URLSearchParams(window.location.search).get("dlq") === "1",
      );
    }
  }, []);

  // Derived: only real policies (isInsuranceDocument true) produce dashboard.
  const currentPolicy: PolicyData | null = useMemo(() => {
    if (
      extracted &&
      "isInsuranceDocument" in extracted &&
      extracted.isInsuranceDocument
    ) {
      return extracted as PolicyData;
    }
    return null;
  }, [extracted]);

  // Live recompute (key UX: profile changes instantly update score/gaps/exposures + carriers/savings).
  // Pure fns from lib/ guarantee determinism + exact sample numbers.
  const scoreResult: ScoreResult = useMemo(() => {
    if (!currentPolicy) {
      return {
        coverageScore: 0,
        gaps: [],
        exposures: [],
        coveragesPresentCount: 0,
      };
    }
    return computeScoreResult(currentPolicy, profile);
  }, [currentPolicy, profile]);

  const carrierMatches = useMemo(() => {
    if (!currentPolicy) return [];
    return computeCarrierMatches(currentPolicy, profile);
  }, [currentPolicy, profile]);

  // savings depends on carrierMatches (which depends on profile+policy) for
  // live recompute; we intentionally omit profile here to avoid redundant
  // memos (carrierMatches already reflects profile changes).
  const savings = useMemo(() => {
    if (!currentPolicy) return NO_SAVINGS;
    return computeSavings(carrierMatches, currentPolicy.annualPremiumTotal);
  }, [currentPolicy, carrierMatches]);

  // UI conditionals (drive the 4 top-level render branches: hero, not-ins, loading, dashboard).
  const hasData = currentPolicy !== null;
  const isNotInsurance =
    extracted &&
    "isInsuranceDocument" in extracted &&
    !extracted.isInsuranceDocument;
  const isFallback =
    isNotInsurance && !!(extracted as Partial<FallbackDoc>)._fallback;

  // States: !has && !load && !notins => hero; isNotIns => yellow; isLoading => spinner; hasData && !load => full dashboard + subcomponents (reactive via useMemo)

  // Load sample instantly, no network
  // Also resets profile so sample always shows known 74/2gaps + exposures 15/40/80/70.
  const loadSample = useCallback(() => {
    setExtracted(SAMPLE_POLICY);
    setProfile(DEFAULT_PROFILE);
    setUploadError(null);
  }, []);

  // Upload handler: loading state machine, form post to extract, set extracted (or fallback).
  // Note: setIsLoading(false) ONLY in finally (no redundant sets).
  const handleUpload = useCallback(async (file: File) => {
    setIsLoading(true);
    setUploadError(null);
    setExtracted(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/extract", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        throw new Error("Upload failed");
      }

      const json = await res.json();
      if (json && typeof json === "object") {
        setExtracted(json);
      } else {
        setExtracted({ isInsuranceDocument: false, _fallback: true });
      }
    } catch {
      setExtracted({ isInsuranceDocument: false, _fallback: true });
      setUploadError("Upload failed. Using graceful fallback.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Clear returns to hero (does not affect profile).
  const clearData = () => {
    setExtracted(null);
    setUploadError(null);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-[#e2e8f0]">
        <div className="max-w-[1100px] mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold tracking-[-0.5px] text-[#16223b]">
                PolicyLens
              </span>
            </div>
            <div className="text-xs text-[#64748b] mt-0.5">
              Coverage intelligence for commercial insurance.
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <span className="text-[#64748b] hidden sm:inline">
              Transparent • Deterministic • No data leaves for demo
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 pt-8 pb-16">
        {/* Toolbar */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <ProfileControls profile={profile} onChange={setProfile} />

          <div className="flex items-center gap-2">
            <UploadDropzone
              onFile={handleUpload}
              disabled={isLoading}
              onError={setUploadError}
            />
            <button
              onClick={loadSample}
              className="btn btn-secondary"
              disabled={isLoading}
            >
              Load sample policy
            </button>
            {hasData && (
              <button
                onClick={clearData}
                className="btn btn-secondary text-xs px-3"
              >
                Clear
              </button>
            )}

            {/* MLOps: Dead Letter Queue inspector (gated ?dlq=1 for client hygiene, no direct process.env.NODE_ENV) */}
            {isDlqEnabled && (
              <button
                onClick={async () => {
                  const nextShown = !showDlq;
                  setShowDlq(nextShown);
                  if (nextShown) {
                    setDlqLoading(true);
                    try {
                      const r = await fetch("/api/dlq?limit=8");
                      const j = await r.json();
                      setDlqItems(j.items || []);
                    } catch (e) {
                      console.error("DLQ fetch failed", e);
                    } finally {
                      setDlqLoading(false);
                    }
                  }
                }}
                className="text-xs px-2.5 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50"
                title="MLOps Dead Letter Queue (dev)"
              >
                {showDlq ? "Hide DLQ" : "DLQ"}
              </button>
            )}
          </div>
        </div>

        {/* Empty hero state (initial or after clear) */}
        {!hasData && !isLoading && !isNotInsurance && (
          <div className="card p-12 text-center mt-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-[#f7f9fc] flex items-center justify-center mb-4">
              📋
            </div>
            <h2 className="text-xl font-semibold tracking-tight mb-2">
              Upload a policy or load the sample
            </h2>
            <p className="max-w-md mx-auto text-[#64748b] mb-6">
              PolicyLens extracts coverages from a commercial COI or
              declarations page, scores risk posture, flags gaps.
            </p>
            <div className="flex justify-center gap-3">
              <button onClick={loadSample} className="btn btn-primary">
                Load sample policy
              </button>
              <label className="btn btn-secondary cursor-pointer">
                Upload PDF
                <input
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(_e) => {
                    const f = (_e.target as HTMLInputElement).files?.[0];
                    if (f) handleUpload(f);
                  }}
                />
              </label>
            </div>
            <div className="text-[11px] text-[#64748b] mt-6">
              Sample data is bundled. Real uploads use server-side LLM
              extraction (key stays private).
            </div>
          </div>
        )}

        {/* Not an insurance document friendly notice (yellow banner for bad PDF or LLM fail) */}
        {isNotInsurance && (
          <div className="card border-[#f59e0b] bg-[#fefce8] p-6 mb-6">
            <div className="font-semibold mb-1">
              We couldn&apos;t find policy data in that PDF.
            </div>
            <div className="text-sm text-[#475569]">
              Try a Certificate of Insurance or a declarations page, or load the
              sample.
              {isFallback && " (LLM not configured — demo using sample path.)"}
            </div>
            <button
              onClick={loadSample}
              className="mt-3 btn btn-primary text-sm"
            >
              Load sample policy
            </button>
          </div>
        )}

        {/* Loading state (upload) — overlays while waiting for /api/extract */}
        {isLoading && (
          <div className="card p-6 mb-6 flex items-center gap-3 text-[#64748b]">
            <div className="animate-spin h-4 w-4 border-2 border-[#2563eb] border-t-transparent rounded-full" />
            Extracting text and analyzing policy with LLM…
          </div>
        )}

        {/* Main dashboard when we have valid policy data (reactive to profile) */}
        {hasData && !isLoading && (
          <>
            {/* Stat cards */}
            <StatCards scoreResult={scoreResult} savings={savings} />

            <div className="h-6" />

            {/* Two column: exposures + gaps */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ExposureBars exposures={scoreResult.exposures} />
              <GapList gaps={scoreResult.gaps} />
            </div>

            <div className="h-6" />

            {/* Extracted Policy */}
            {currentPolicy && <PolicyTable policy={currentPolicy} />}

            <div className="h-6" />

            <CarrierTable matches={carrierMatches} />

            <div className="h-6" />

            {/* Footer note */}
            <div className="text-[11px] text-[#64748b] mt-8 px-1">
              Changing industry or revenue instantly recomputes the score, gaps,
              exposures, and carriers. All scoring logic is pure functions in{" "}
              <code className="font-mono text-xs">lib/scoring.ts</code>.
            </div>
          </>
        )}

        {/* Upload error inline (shown for transport errors; logical not-ins use the yellow notice instead) */}
        {uploadError && (
          <div className="mt-4 text-xs text-[#dc2626]">{uploadError}</div>
        )}

        {/* MLOps Dead Letter Queue panel (dev only, gated) */}
        {isDlqEnabled && showDlq && (
          <div className="mt-8 p-4 border border-amber-200 bg-amber-50/60 rounded text-xs">
            <div className="font-semibold mb-2 text-amber-800 flex items-center justify-between">
              MLOps Dead Letter Queue (recent failures)
              <button
                onClick={() => setShowDlq(false)}
                className="text-amber-600"
              >
                ×
              </button>
            </div>
            {dlqLoading && <div>Loading DLQ…</div>}
            {!dlqLoading && dlqItems.length === 0 && (
              <div className="text-amber-700">
                No entries yet. Failures during uploads/LLM/validation will
                appear here.
              </div>
            )}
            <ul className="space-y-2">
              {dlqItems.map((item, idx) => {
                const r = item as {
                  id?: string;
                  reason?: string;
                  timestamp?: string;
                  filename?: string;
                  rawTextSnippet?: string;
                  error?: string;
                };
                return (
                  <li
                    key={r.id || idx}
                    className="bg-white/70 p-2 rounded border border-amber-100 font-mono break-all"
                  >
                    <div>
                      <strong>{r.reason}</strong> @ {r.timestamp}
                    </div>
                    {r.filename && <div>file: {r.filename}</div>}
                    <div className="text-[10px] text-amber-700 mt-0.5">
                      snippet: {r.rawTextSnippet?.slice(0, 160)}…
                    </div>
                    {r.error && (
                      <div className="text-red-600">err: {r.error}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 text-[10px] text-amber-600">
              Full data also at <code>/api/dlq</code> and in{" "}
              <code>data/dlq/</code> (dev-gated by ?dlq=1; JSONL append-only)
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-[#e2e8f0] py-4 text-center text-[11px] text-[#64748b]">
        PolicyLens demo • Deterministic rules • LLM key never leaves server •
        Sample produces score 74, 2 gaps, exact exposures
      </footer>
    </div>
  );
}
