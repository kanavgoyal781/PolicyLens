"use client";

// Carrier ranking table (sorted, BEST badge on #1).
// Inline match color uses 70/55 cutoffs (different than score 75/50 or exposure 70/40 — intentional).
// savingsMessage passed from computeSavings.

import React from "react";
import { CarrierMatch } from "../lib/types";

interface CarrierTableProps {
  matches: CarrierMatch[];
  savingsMessage: string;
}

export default function CarrierTable({ matches, savingsMessage }: CarrierTableProps) {
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-sm font-semibold tracking-tight">Carrier Match</div>
        <div className="text-sm text-[#16a34a] font-medium">{savingsMessage}</div>
      </div>

      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr>
              <th style={{width: "28px"}}>#</th>
              <th>Carrier</th>
              <th>Premium (annual)</th>
              <th>Match</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m, idx) => (
              <tr key={`${m.name}-${idx}`} className={idx === 0 ? "bg-[#f8fafc]" : ""}>
                <td className="tabular-nums text-[#64748b]">{idx + 1}</td>
                <td>
                  <span className="font-medium">{m.name}</span>
                  {m.isBest && <span className="best-badge">BEST</span>}
                </td>
                <td className="tabular-nums font-medium">${m.premium.toLocaleString()}</td>
                <td>
                  {/* carrier match color thresholds are distinct from score/exposure (intentionally different cutoffs; see scoring.ts getScoreColor comment) */}
                  <span className="font-semibold tabular-nums" style={{ color: m.match >= 70 ? "#16a34a" : m.match >= 55 ? "#d97706" : "#16223b" }}>{m.match}%</span>
                </td>
              </tr>
            ))}
            {matches.length === 0 && (
              <tr><td colSpan={4} className="text-[#64748b]">No matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] mt-2 text-[#64748b]">Premiums are simulated estimates. Match incorporates industry appetite + coverage fit + small deterministic variance.</div>
    </div>
  );
}
