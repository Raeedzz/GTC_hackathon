'use client';

import { CA_COUNTIES } from '@/lib/counties';

export default function CountySelector({ selected, onChange, disabled }) {
  const sorted = [...CA_COUNTIES].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <select
      className="county-select"
      value={selected || ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">Select a county...</option>
      {sorted.map((c) => (
        <option key={c.fips} value={c.fips}>
          {c.name} County
        </option>
      ))}
    </select>
  );
}
