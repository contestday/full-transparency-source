"use client";

import { useMemo, useState, type FormEvent } from "react";
import { LazyMap, type MapFeature } from "@/components/map-lazy";
import { AddressSearch } from "@/components/address-search";
import { Button, Card, Field, Input, Notice, Select } from "@/components/ui";
import { api } from "@/lib/client-api";
import { PLAN_CATEGORIES, categoryLabel } from "@/lib/plans";

export interface Venue {
  id: string;
  name: string;
  category: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  public_area_label: string | null;
  is_public: boolean;
  /** Private location: shown to others only as "Private location". */
  is_hidden?: boolean;
}

const blank = { name: "", category: "restaurant", address: "", lat: null as number | null, lng: null as number | null, public_area_label: "", is_public: false, is_hidden: false };

export function VenuesManager({ initial }: { initial: Venue[] }) {
  const [venues, setVenues] = useState(initial);
  const [form, setForm] = useState<typeof blank & { id?: string }>(blank);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => venues.filter((v) => v.name.toLowerCase().includes(q.toLowerCase())), [venues, q]);
  const draft = useMemo<MapFeature[]>(
    () => (form.lat != null && form.lng != null ? [{ type: "Feature", geometry: { type: "Point", coordinates: [form.lng, form.lat] }, properties: { color: "#b45309", size: 8 } }] : []),
    [form.lat, form.lng],
  );
  const features = useMemo<MapFeature[]>(
    () =>
      venues
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => ({ type: "Feature", geometry: { type: "Point", coordinates: [v.lng!, v.lat!] }, properties: { color: "#1d4ed8", size: 5, label: `${v.name}\n${categoryLabel(v.category)}` } })),
    [venues],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ venue: Venue }>("/api/admin/venues", {
        method: "POST",
        json: { ...form, address: form.address || null, public_area_label: form.public_area_label || null },
      });
      setVenues((vs) => [...vs.filter((v) => v.id !== res.venue.id), res.venue].sort((a, b) => a.name.localeCompare(b.name)));
      setForm(blank);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={onSubmit} className="space-y-4">
        <Card className="space-y-4">
          <h2 className="font-semibold">{form.id ? "Edit venue" : "Add venue"}</h2>
          <AddressSearch
            id="venue-search"
            label="Find the venue (name and town, postcode or address)"
            placeholder="e.g. The Crown, Anytown, or SW1A 1AA"
            onSelect={(r) =>
              setForm((f) => ({
                ...f,
                name: f.name || r.name,
                address: r.label,
                lat: Math.round(r.lat * 1e6) / 1e6,
                lng: Math.round(r.lng * 1e6) / 1e6,
              }))
            }
          />
          <Field label="Name" htmlFor="v-name">
            <Input id="v-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={200} />
          </Field>
          <Field label="Category" htmlFor="v-cat">
            <Select id="v-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {Object.entries(PLAN_CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5"
              checked={form.is_hidden}
              onChange={(e) => setForm({ ...form, is_hidden: e.target.checked, is_public: e.target.checked ? false : form.is_public })}
            />
            <span>
              <strong>Private location</strong>: others see only &quot;Private location&quot;, with no name, area or map position. You still see it.
              <span className="block text-xs text-muted">For the safety of the people there, not to hide the visit.</span>
            </span>
          </label>
          <label className={`flex items-start gap-2 rounded-md border border-border p-3 text-sm ${form.is_hidden ? "opacity-50" : ""}`}>
            <input type="checkbox" className="mt-0.5 h-5 w-5" disabled={form.is_hidden} checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} />
            <span>
              <strong>Public venue</strong> (pub, hotel, restaurant, shop…): name and exact location are shown publicly.
              <span className="block text-xs text-muted">Leave unticked for private addresses. Only the area label below is shown.</span>
            </span>
          </label>
          <Field label="Address (private)" htmlFor="v-addr">
            <Input id="v-addr" value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} maxLength={500} />
          </Field>
          <Field
            label={form.is_public ? "Public area label" : "Public area or road"}
            htmlFor="v-area"
            hint={form.is_public ? "e.g. Leeds city centre" : "The only location detail shown for this private address, e.g. Mill Lane area"}
          >
            <Input id="v-area" value={form.public_area_label ?? ""} onChange={(e) => setForm({ ...form, public_area_label: e.target.value })} maxLength={120} />
          </Field>
          <div>
            <p className="mb-1 text-sm font-medium">Location</p>
            <LazyMap
              features={features}
              draft={draft}
              fitDraft
              onMapClick={(p) => setForm((f) => ({ ...f, lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 }))}
              className="h-72 w-full"
              ariaLabel="Venue location"
            />
            <p className="mt-1 text-xs text-muted">Set by the search above. Tap the map only if you need to nudge it.</p>
            <p className="mt-1 text-xs text-muted">
              {form.lat != null ? `${form.lat}, ${form.lng}` : "No location set"}
              {form.lat != null && (
                <button type="button" className="ml-2 underline" onClick={() => setForm({ ...form, lat: null, lng: null })}>
                  clear
                </button>
              )}
            </p>
          </div>
          {error && <Notice tone="red">{error}</Notice>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {form.id ? "Save venue" : "Add venue"}
            </Button>
            {form.id && (
              <Button type="button" variant="ghost" onClick={() => setForm(blank)}>
                Cancel
              </Button>
            )}
          </div>
        </Card>
      </form>
      <div className="space-y-2">
        <Input placeholder="Search venues…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {filtered.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 p-3 text-sm">
              <div>
                <p className="font-medium">{v.name}</p>
                <p className="text-xs text-muted">
                  {v.is_hidden ? "Private location (hidden from others)" : v.is_public ? "Public venue" : "Private address"} · {categoryLabel(v.category)}
                  {v.public_area_label ? ` · ${v.public_area_label}` : ""}
                  {v.lat == null ? " · no location" : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setForm({ id: v.id, name: v.name, category: v.category, address: v.address ?? "", lat: v.lat, lng: v.lng, public_area_label: v.public_area_label ?? "", is_public: v.is_public, is_hidden: Boolean(v.is_hidden) })
                }
              >
                Edit
              </Button>
            </li>
          ))}
          {!filtered.length && <li className="p-3 text-sm text-muted">No venues.</li>}
        </ul>
      </div>
    </div>
  );
}
