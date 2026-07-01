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

// Number of columns in the coverages table (Coverage, Limit, Deductible, Premium).
const NUM_COVERAGE_COLS = 4;

function formatMoney(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return "$" + n.toLocaleString("en-US");
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  // TZ-safe: parse y-m-d manually + UTC to avoid off-by-one (e.g. Oct 1 becoming Sep 30 in some zones).
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const y = +m[1], mo = +m[2], da = +m[3];
  // Simple range guard (per review): reject invalid month/day before Date.UTC normalizes them.
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return iso;
  const d = new Date(Date.UTC(y, mo - 1, da));
  if (isNaN(d.getTime())) return iso;
  // Post-construction UTC field check: catches normalized invalids (e.g. 2020-02-30 -> Mar 1) and falls back to raw iso.
  if (d.getUTCFullYear() !== y || (d.getUTCMonth() + 1) !== mo || d.getUTCDate() !== da) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Pure helper to render the extracted policy subtitle (namedInsured bold if present).
 * Joins only present values with " • " (no leading "—"). Keeps exact prior classes/output.
 * Centralizes the previous inline truthy logic for clarity/maintainability.
 */
function getPolicySubtitle(policy: PolicyData): React.ReactNode {
  const { namedInsured, carrier, policyNumber } = policy;
  const nodes: React.ReactNode[] = [];
  if (namedInsured) {
    nodes.push(<span key="ni" className="font-semibold">{namedInsured}</span>);
  }
  if (carrier) {
    nodes.push(<span key="ca" className="text-[#64748b]">{(namedInsured ? " • " : "") + carrier}</span>);
  }
  if (policyNumber) {
    nodes.push(<span key="pn" className="text-[#64748b]">{(namedInsured || carrier ? " • " : "") + policyNumber}</span>);
  }
  if (nodes.length === 0) {
    return "—";
  }
  return <>{nodes}</>;
}

export default function PolicyTable({ policy }: PolicyTableProps) {
  const { effectiveDate, expirationDate, coverages } = policy;

  return (
    <div className="card p-5">
      <div className="mb-3">
        <div className="text-sm font-semibold tracking-tight mb-0.5">Extracted Policy</div>
        <div className="text-sm">
          {getPolicySubtitle(policy)}
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
              <tr><td colSpan={NUM_COVERAGE_COLS} className="text-[#64748b] py-3">No coverages extracted.</td></tr>
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
