"use client";

// 4 stat cards at top of dashboard.
// Score uses getScoreColor (centralized in scoring).
// Gaps and savings derive from parent memos.

import React from "react";
import { ScoreResult } from "../lib/types";
import { getScoreColor } from "../lib/scoring";

interface StatCardsProps {
  scoreResult: ScoreResult;
  savingsPct: number | null;
  savingsMessage: string;
}

function formatSavings(pct: number | null, msg: string): string {
  if (!pct || pct <= 0) return msg || "Competitively priced";
  return msg;
}

export default function StatCards({ scoreResult, savingsPct, savingsMessage }: StatCardsProps) {
  const { coverageScore, gaps, coveragesPresentCount } = scoreResult;

  // Use shared helper (centralized, matches Sec 9.2 thresholds for score gauge)
  const gaugeColor = getScoreColor(coverageScore);

  const gapsCount = gaps.length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="stat-card">
        <div className="text-xs uppercase tracking-[1px] text-[#64748b] mb-1">Coverage Score</div>
        <div className="flex items-end gap-3">
          <div className="text-5xl font-semibold tabular-nums tracking-tighter">{coverageScore}</div>
          <div className="gauge text-xs" style={{ background: gaugeColor }}>{coverageScore}</div>
        </div>
        <div className="text-[11px] text-[#64748b] mt-1">Higher is stronger posture</div>
      </div>

      <div className="stat-card">
        <div className="text-xs uppercase tracking-[1px] text-[#64748b] mb-1">Coverage Gaps</div>
        <div className="text-5xl font-semibold tabular-nums tracking-tighter text-[#dc2626]">{gapsCount}</div>
        <div className="text-[11px] text-[#64748b] mt-1">Missing essential or recommended coverages</div>
      </div>

      <div className="stat-card">
        <div className="text-xs uppercase tracking-[1px] text-[#64748b] mb-1">Coverages on Policy</div>
        <div className="text-5xl font-semibold tabular-nums tracking-tighter">{coveragesPresentCount}</div>
        <div className="text-[11px] text-[#64748b] mt-1">Normalized line items extracted</div>
      </div>

      <div className="stat-card">
        <div className="text-xs uppercase tracking-[1px] text-[#64748b] mb-1">Est. Savings</div>
        <div className="text-5xl font-semibold tabular-nums tracking-tighter text-[#16a34a]">
          {savingsPct && savingsPct > 0 ? `${savingsPct}%` : "—"}
        </div>
        <div className="text-[11px] text-[#64748b] mt-1">{formatSavings(savingsPct, savingsMessage)}</div>
      </div>
    </div>
  );
}
