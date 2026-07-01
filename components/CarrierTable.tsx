"use client";

// Carrier ranking table (sorted, BEST badge on #1).
// Internal match logic untouched for sorting/BEST; display of "Carrier Match" title + Match column removed.

import React from "react";
import { CarrierMatch } from "../lib/types";

interface CarrierTableProps {
  matches: CarrierMatch[];
}

export default function CarrierTable({ matches }: CarrierTableProps) {
  return (
    <div className="card p-5">
      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr>
              <th style={{ width: "28px" }}>#</th>
              <th>Carrier</th>
              <th>Premium (annual)</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m, idx) => (
              <tr
                key={`${m.name}-${idx}`}
                className={idx === 0 ? "bg-[#f8fafc]" : ""}
              >
                <td className="tabular-nums text-[#64748b]">{idx + 1}</td>
                <td>
                  <span className="font-medium">{m.name}</span>
                  {m.isBest && <span className="best-badge">BEST</span>}
                </td>
                <td className="tabular-nums font-medium">
                  ${m.premium.toLocaleString()}
                </td>
              </tr>
            ))}
            {matches.length === 0 && (
              <tr>
                <td colSpan={3} className="text-[#64748b]">
                  No matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] mt-2 text-[#64748b]">
        Premiums are simulated estimates. Values incorporate industry appetite +
        coverage fit + small deterministic variance.
      </div>
    </div>
  );
}
