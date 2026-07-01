"use client";

// Profile dropdowns (industry + revenue). Changing triggers live recompute everywhere via parent useMemo.

import React from "react";
import { BusinessProfile } from "../lib/types";
import { INDUSTRIES, REVENUE_BANDS, INDUSTRY_LABELS, REVENUE_LABELS } from "../lib/taxonomy";

interface ProfileControlsProps {
  profile: BusinessProfile;
  onChange: (p: BusinessProfile) => void;
}

export default function ProfileControls({ profile, onChange }: ProfileControlsProps) {
  // Local patch helper keeps parent state immutable.
  const update = (patch: Partial<BusinessProfile>) => {
    onChange({ ...profile, ...patch });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-xs uppercase tracking-widest text-[#64748b]">Industry</label>
      <select
        className="select"
        value={profile.industry}
        onChange={(e) => update({ industry: e.target.value as BusinessProfile["industry"] })}
      >
        {INDUSTRIES.map((ind) => (
          <option key={ind} value={ind}>{INDUSTRY_LABELS[ind]}</option>
        ))}
      </select>

      <label className="text-xs uppercase tracking-widest text-[#64748b] ml-2">Annual Revenue</label>
      <select
        className="select"
        value={profile.annualRevenueBand}
        onChange={(e) => update({ annualRevenueBand: e.target.value as BusinessProfile["annualRevenueBand"] })}
      >
        {REVENUE_BANDS.map((b) => (
          <option key={b} value={b}>{REVENUE_LABELS[b]}</option>
        ))}
      </select>
    </div>
  );
}
