"use client";

// Extracted policy header + coverage table.
// Uses getCoverageLabel from taxonomy (BOP special not shown here; rawLabel always shown).
// Formatting helpers for money/date (spec style).

import React from "react";
import { PolicyData } from "../lib/types";
import { getCoverageLabel } from "../lib/taxonomy";

interface PolicyTableProps {
  policy: PolicyData;
}

function formatMoney(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return "$" + n.toLocaleString("en-US");
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function PolicyTable({ policy }: PolicyTableProps) {
  const { namedInsured, carrier, policyNumber, effectiveDate, expirationDate, coverages } = policy;

  return (
    <div className="card p-5">
      <div className="mb-3">
        <div className="text-sm font-semibold tracking-tight mb-0.5">Extracted Policy</div>
        <div className="text-sm">
          <span className="font-semibold">{namedInsured || "—"}</span>
          {carrier && <span className="text-[#64748b]"> • {carrier}</span>}
          {policyNumber && <span className="text-[#64748b]"> • {policyNumber}</span>}
        </div>
        <div className="text-xs text-[#64748b] mt-0.5">
          {formatDate(effectiveDate)} – {formatDate(expirationDate)}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table w-full text-sm">
          <thead>
            <tr>
              <th>Coverage</th>
              <th>Limit</th>
              <th>Deductible</th>
              <th>Premium</th>
            </tr>
          </thead>
          <tbody>
            {coverages.length === 0 && (
              <tr><td colSpan={4} className="text-[#64748b] py-3">No coverages extracted.</td></tr>
            )}
            {coverages.map((c, i) => (
              <tr key={c.code || `cov-${i}`}>
                <td className="font-medium">{getCoverageLabel(c.code)} <span className="text-[#64748b] text-xs">({c.rawLabel})</span></td>
                <td className="tabular-nums">{formatMoney(c.limit)}</td>
                <td className="tabular-nums">{formatMoney(c.deductible)}</td>
                <td className="tabular-nums">{formatMoney(c.premium)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-[#64748b] mt-2">All values in USD. Limits shown per occurrence or aggregate as extracted.</div>
    </div>
  );
}
