"use client";

// Renders High/Med gaps from computeGaps. Inline color for severity (no Low for gaps).
// Empty state friendly.

import React from "react";
import { Gap } from "../lib/types";

interface GapListProps {
  gaps: Gap[];
}

export default function GapList({ gaps }: GapListProps) {
  if (gaps.length === 0) {
    return (
      <div className="card p-5 text-sm text-[#64748b]">
        No coverage gaps detected for this profile.
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="text-sm font-semibold mb-3 tracking-tight">Coverage Gaps</div>
      <div className="space-y-3">
        {gaps.map((gap, idx) => {
          const isHigh = gap.severity === "High";
          const chipColor = isHigh ? "#dc2626" : "#d97706";
          const bg = isHigh ? "#fef2f2" : "#fefce8";
          // gap colors differ from exposure bands (scoring getBandColor) and score thresholds; only High/Med apply

          return (
            <div key={`${gap.code}-${idx}`} className="border border-[#e2e8f0] rounded-lg p-3" style={{ background: "#fff" }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-sm">{gap.label}</span>
                <span className="severity-chip" style={{ background: bg, color: chipColor }}>{gap.severity}</span>
              </div>
              <div className="text-xs text-[#475569] leading-snug">{gap.why}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
