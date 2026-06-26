"use client";

// Horizontal bars for the 4 exposure categories (from computeExposures).
// Uses getBandColor + getExposureBand logic (centralized in scoring).

import React from "react";
import { Exposure } from "../lib/types";
import { getBandColor } from "../lib/scoring";

interface ExposureBarsProps {
  exposures: Exposure[];
}

export default function ExposureBars({ exposures }: ExposureBarsProps) {
  return (
    <div className="card p-5">
      <div className="text-sm font-semibold mb-3 tracking-tight">Risk Exposure by Category</div>
      <div className="space-y-4">
        {exposures.map((exp) => {
          const color = getBandColor(exp.band);
          const width = Math.max(5, Math.min(100, exp.value));
          return (
            <div key={exp.category}>
              <div className="flex justify-between text-sm mb-1.5">
                <div className="font-medium">{exp.category}</div>
                <div className="tabular-nums font-semibold" style={{ color }}>
                  {exp.value}% <span className="text-xs text-[#64748b] font-normal">({exp.band})</span>
                </div>
              </div>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${width}%`, background: color }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-[#64748b] mt-3">Higher = greater uninsured exposure. Mitigated by present coverages.</div>
    </div>
  );
}
