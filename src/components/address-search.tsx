"use client";

import { useState, type KeyboardEvent } from "react";
import { Button, Input } from "@/components/ui";
import type { GeocodeResult } from "@/lib/geocode";

const KIND_LABEL: Record<GeocodeResult["kind"], string> = {
  postcode: "Postcode",
  address: "Address",
  place: "Place",
  area: "Area",
};

/**
 * Search by postcode, address, venue or place name. Searches run on submit
 * (Enter or the button), not as you type, per OpenStreetMap's usage policy.
 */
export function AddressSearch({
  onSelect,
  placeholder = "Postcode, address, venue or place",
  id = "address-search",
  label = "Find by postcode or address",
}: {
  onSelect: (r: GeocodeResult) => void;
  placeholder?: string;
  id?: string;
  label?: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (q.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Search failed");
      setResults(body.results ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault(); // don't submit the surrounding form
      void search();
    }
  }

  return (
    <div data-private className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={placeholder} autoComplete="off" />
        <Button type="button" onClick={search} disabled={busy || q.trim().length < 2}>
          {busy ? "Searching…" : "Search"}
        </Button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {results && results.length === 0 && <p className="text-xs text-muted">No matches. Try a postcode or add the town name.</p>}
      {results && results.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-white text-sm" role="listbox" aria-label="Search results">
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50"
                onClick={() => {
                  onSelect(r);
                  setResults(null);
                  setQ(r.name);
                }}
              >
                <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 text-[10px] font-semibold uppercase text-slate-700">{KIND_LABEL[r.kind]}</span>
                <span>
                  {r.label}
                  {r.enclosingRadiusM != null && (
                    <span className="block text-xs text-muted">Circle from the middle to the furthest point: {formatDistance(r.enclosingRadiusM)}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted">Search by postcodes.io and © OpenStreetMap contributors.</p>
    </div>
  );
}

export function formatDistance(m: number): string {
  const miles = m / 1609.344;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km (${miles.toFixed(1)} mi)` : `${Math.round(m)} m`;
}
