"use client";

import { useMemo, useState } from "react";
import { LazyMap, type MapFeature } from "@/components/map-lazy";
import { AddressSearch } from "@/components/address-search";
import { ConfirmButton } from "@/components/confirm-button";
import { Badge, Button, Card, Field, Input, Notice } from "@/components/ui";
import { api } from "@/lib/client-api";
import { circleRing } from "@/lib/geo";
import { PLAN_CATEGORIES } from "@/lib/plans";
import type { PublicationRuleRow } from "@/lib/publication";

type Rule = PublicationRuleRow & { id: string };

export function PublicationSettings({ initialRules }: { initialRules: Rule[] }) {
  const [rules, setRules] = useState(initialRules);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [zoneDraft, setZoneDraft] = useState<{ kind: "exclusion_zone" | "area_label"; lat?: number; lng?: number; radius: number; label: string } | null>(null);
  const [withdrawForm, setWithdrawForm] = useState({ from: "", to: "", reason: "" });

  const one = (t: string) => rules.find((r) => r.rule_type === t);
  const pause = one("pause");
  const paused = !pause || pause.enabled;
  const delayMinutes = Math.round(Number(one("delay")?.configuration.hours ?? 24) * 60);
  const grid = Number(one("grid")?.configuration.meters ?? 1000);
  const tracks = one("publish_tracks");
  const zones = rules.filter((r) => r.rule_type === "exclusion_zone");
  const labels = rules.filter((r) => r.rule_type === "area_label");
  const excludedCats = new Set(rules.filter((r) => r.rule_type === "excluded_category" && r.enabled).map((r) => String(r.configuration.category)));

  async function save(rule: { rule_type: string; configuration: Record<string, unknown> }, enabled = true, id?: string) {
    setMsg(null);
    try {
      const res = await api<{ rule: Rule }>("/api/admin/publication/rules", { method: "POST", json: { id, enabled, rule } });
      setRules((rs) => [...rs.filter((r) => r.id !== res.rule.id), res.rule]);
      setMsg({ tone: "green", text: "Saved." });
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Save failed" });
    }
  }

  async function remove(id: string) {
    setMsg(null);
    try {
      await api(`/api/admin/publication/rules?id=${id}`, { method: "DELETE" });
      setRules((rs) => rs.filter((r) => r.id !== id));
      setMsg({ tone: "green", text: "Deleted." });
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Delete failed" });
    }
  }

  async function toggleCategory(cat: string, on: boolean) {
    const existing = rules.find((r) => r.rule_type === "excluded_category" && r.configuration.category === cat);
    await save({ rule_type: "excluded_category", configuration: { category: cat } }, on, existing?.id);
  }

  async function withdrawRange() {
    const { from, to, reason } = withdrawForm;
    if (!from || !to) return setMsg({ tone: "red", text: "Choose both dates first." });
    try {
      const res = await api<{ updated: number }>("/api/admin/publication/withdraw", {
        method: "POST",
        json: { from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59`).toISOString(), reason: reason || undefined },
      });
      setMsg({ tone: "green", text: `${res.updated} record(s) withdrawn.` });
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Withdraw failed" });
    }
  }

  const zoneFeatures = useMemo<MapFeature[]>(() => {
    const f: MapFeature[] = [];
    for (const z of [...zones, ...labels]) {
      const c = z.configuration as { lat: number; lng: number; radius_m: number; label: string };
      f.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [circleRing(c, c.radius_m, 48)] },
        properties: { color: z.rule_type === "exclusion_zone" ? "#dc2626" : "#1d4ed8", label: `${z.rule_type === "exclusion_zone" ? "Hidden zone" : "Area label"}: ${c.label}` },
      });
    }
    return f;
  }, [zones, labels]);

  const draftFeatures = useMemo<MapFeature[]>(
    () =>
      zoneDraft?.lat != null
        ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: [circleRing({ lat: zoneDraft.lat, lng: zoneDraft.lng! }, zoneDraft.radius, 48)] }, properties: { color: "#b45309", opacity: 0.3 } }]
        : [],
    [zoneDraft],
  );

  return (
    <Card className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Publication controls</h2>
        <div className="flex items-center gap-2">
          <Badge tone={paused ? "amber" : "green"}>{paused ? "Paused" : "Publishing"}</Badge>
          <Button size="sm" variant={paused ? "primary" : "danger"} onClick={() => save({ rule_type: "pause", configuration: {} }, !paused)}>
            {paused ? "Resume publication" : "Pause publication"}
          </Button>
        </div>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {!zones.length && (
        <Notice tone="amber">Save your home above (which creates its hidden zone). Nothing is published until at least one hidden zone exists.</Notice>
      )}

      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void save({ rule_type: "delay", configuration: { hours: Number(f.get("delay")) / 60 } });
          void save({ rule_type: "grid", configuration: { meters: Number(f.get("grid")) } });
          void save({ rule_type: "publish_tracks", configuration: { interval_minutes: Number(f.get("interval")) } }, f.get("tracks") === "on");
        }}
      >
        <Field label="History delay (minutes)" htmlFor="delay" hint="How long after a stay ends before it appears in public history. 0 = as soon as the next publication run.">
          <Input id="delay" name="delay" type="number" min={0} max={525600} step={1} defaultValue={delayMinutes} />
        </Field>
        <Field label="Generalisation grid (metres)" htmlFor="grid" hint="Minimum 250 m. Positions snap to cell centres.">
          <Input id="grid" name="grid" type="number" min={250} max={50000} step={50} defaultValue={grid} />
        </Field>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="tracks" defaultChecked={Boolean(tracks?.enabled)} /> Publish route samples
          </label>
          <Input name="interval" type="number" min={3} max={1440} defaultValue={Number(tracks?.configuration.interval_minutes ?? 60)} aria-label="Route sample interval (minutes)" />
          <p className="text-xs text-muted">One sample per interval (minutes). Visits are always published.</p>
        </div>
        <Button type="submit" className="sm:col-span-3 sm:w-fit">
          Save publication settings
        </Button>
      </form>

      <div>
        <h3 className="mb-1 font-semibold">Excluded categories</h3>
        <p className="mb-2 text-xs text-muted">
          A recorded visit to a venue in a ticked category is left out of the public history entirely. For example,
          ticking Hospitals &amp; healthcare means visits to a hospital or GP never appear. It affects history only, not
          plans or the live marker.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          {Object.entries(PLAN_CATEGORIES).map(([k, v]) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" checked={excludedCats.has(k)} onChange={(e) => toggleCategory(k, e.target.checked)} />
              {v}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold">Hidden zones and area labels</h3>
        <p className="text-xs text-muted">
          <strong>Hidden zones</strong> are private places (your home is added automatically from the Home section) that
          never appear publicly, in history or on the live marker. They are your own privacy settings and are separate
          from areas of concern submitted by others. <strong>Area labels</strong> give published records a readable
          name, e.g. &quot;Leeds city centre&quot;.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setZoneDraft({ kind: "exclusion_zone", radius: 250, label: "" })}>
            + Hidden zone
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setZoneDraft({ kind: "area_label", radius: 2000, label: "" })}>
            + Area label
          </Button>
        </div>
        {zoneDraft && (
          <div className="grid gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <AddressSearch
                id="zone-search"
                label={zoneDraft.kind === "exclusion_zone" ? "Find the place to hide" : "Find the area to label"}
                onSelect={(r) =>
                  setZoneDraft((z) =>
                    z
                      ? {
                          ...z,
                          lat: r.lat,
                          lng: r.lng,
                          label: z.label || r.name,
                          radius: r.enclosingRadiusM ? Math.min(50_000, r.enclosingRadiusM) : z.radius,
                        }
                      : z,
                  )
                }
              />
            </div>
            <Field label="Label" htmlFor="z-label">
              <Input id="z-label" value={zoneDraft.label} onChange={(e) => setZoneDraft({ ...zoneDraft, label: e.target.value })} />
            </Field>
            <Field label={`Radius: ${zoneDraft.radius} m`} htmlFor="z-radius">
              <input id="z-radius" type="range" min={50} max={Math.max(10000, zoneDraft.radius)} step={50} value={zoneDraft.radius} onChange={(e) => setZoneDraft({ ...zoneDraft, radius: Number(e.target.value) })} className="w-full" />
            </Field>
            <div className="flex items-end gap-2">
              <Button
                size="sm"
                disabled={zoneDraft.lat == null || !zoneDraft.label.trim()}
                onClick={async () => {
                  await save({ rule_type: zoneDraft.kind, configuration: { lat: zoneDraft.lat, lng: zoneDraft.lng, radius_m: zoneDraft.radius, label: zoneDraft.label.trim() } });
                  setZoneDraft(null);
                }}
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setZoneDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <LazyMap features={zoneFeatures} draft={draftFeatures} fitDraft className="h-80 w-full" ariaLabel="Hidden zones map" />
        <ul className="divide-y divide-border text-sm">
          {[...zones, ...labels].map((z) => (
            <li key={z.id} className="flex items-center justify-between py-1.5">
              <span>
                <Badge tone={z.rule_type === "exclusion_zone" ? "red" : "blue"}>{z.rule_type === "exclusion_zone" ? "Hidden" : "Label"}</Badge>{" "}
                {String(z.configuration.label)} · {String(z.configuration.radius_m)} m
              </span>
              <ConfirmButton prompt={`Delete "${String(z.configuration.label)}"?`} confirmLabel="Delete" onConfirm={() => remove(z.id)}>
                Delete
              </ConfirmButton>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Withdraw published history</h3>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From" htmlFor="w-from">
            <Input id="w-from" type="date" value={withdrawForm.from} onChange={(e) => setWithdrawForm({ ...withdrawForm, from: e.target.value })} className="w-auto" />
          </Field>
          <Field label="To" htmlFor="w-to">
            <Input id="w-to" type="date" value={withdrawForm.to} onChange={(e) => setWithdrawForm({ ...withdrawForm, to: e.target.value })} className="w-auto" />
          </Field>
          <Field label="Reason (private)" htmlFor="w-reason">
            <Input id="w-reason" value={withdrawForm.reason} onChange={(e) => setWithdrawForm({ ...withdrawForm, reason: e.target.value })} className="w-56" />
          </Field>
          <ConfirmButton
            variant="danger"
            size="md"
            disabled={!withdrawForm.from || !withdrawForm.to}
            prompt={`Withdraw everything from ${withdrawForm.from} to ${withdrawForm.to}?`}
            confirmLabel="Withdraw"
            onConfirm={withdrawRange}
          >
            Withdraw
          </ConfirmButton>
        </div>
      </div>
    </Card>
  );
}
