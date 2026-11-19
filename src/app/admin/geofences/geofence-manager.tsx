"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LazyMap, type MapFeature } from "@/components/map-lazy";
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { GeofenceDrawer, type DrawnShape } from "@/components/geofence-drawer";
import { api } from "@/lib/client-api";
import { ConfirmButton } from "@/components/confirm-button";
import { GEOFENCE_CATEGORIES } from "@/lib/geofence/submission";
import { fmtDate, fmtDateTime } from "@/lib/format";

export interface AdminFence {
  id: string;
  reference: string;
  shape_type: string;
  radius_m: number | null;
  description: string | null;
  category: string | null;
  origin: "anonymous" | "admin";
  verification_status: "unverified" | "verified" | "disputed";
  moderation_status: string;
  status: "active" | "withdrawn" | "archived";
  submitted_at: string;
  geojson: { type: "Polygon"; coordinates: [number, number][][] };
  currently_inside: boolean;
  watcher_id: string | null;
  tier?: "wide" | "local" | "location" | null;
  wide_mode?: "inside" | "outside" | null;
  effective_from?: string | null;
}

/** Mine navy, Wish amber, Want red (same as the private map). */
const kindOf = (f: AdminFence) => (f.origin === "admin" || !f.tier ? "mine" : f.tier === "local" ? "want" : "wish");
const KIND = {
  mine: { label: "My noted area", color: "#142B49", tone: "blue" as const },
  wish: { label: "Wish", color: "#F08C00", tone: "amber" as const },
  want: { label: "Want", color: "#C62828", tone: "red" as const },
};

export interface LegalRestriction {
  id: string;
  title: string;
  issuing_authority: string;
  authority_reference: string | null;
  description: string | null;
  valid_from: string | null;
  valid_until: string | null;
  verified_at: string | null;
  verification_notes: string | null;
}

type Ev = { id: string; geofence_id: string; event_type: string; observed_at: string; accuracy_m: number | null };

export function GeofenceManager({
  isAdmin,
  initialFences,
  events,
  restrictions,
}: {
  isAdmin: boolean;
  initialFences: AdminFence[];
  events: Ev[];
  restrictions: LegalRestriction[];
}) {
  const router = useRouter();
  const [fences, setFences] = useState(initialFences);
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [shape, setShape] = useState<DrawnShape | null>(null);

  const shown = fences.filter((f) => statusFilter === "all" || f.status === "active");
  const features = useMemo<MapFeature[]>(
    () =>
      shown.map((f) => ({
        type: "Feature",
        geometry: f.geojson,
        properties: {
          color: f.id === selected ? "#1d4ed8" : KIND[kindOf(f)].color,
          // My own noted areas are dashed; watchers' areas are solid.
          dashed: kindOf(f) === "mine",
          opacity: f.id === selected ? 0.35 : 0.15,
          label: `${KIND[kindOf(f)].label} · ${f.reference}\n${f.description?.slice(0, 200) ?? ""}`,
        },
      })),
    [shown, selected],
  );

  async function patch(f: AdminFence, body: Partial<Pick<AdminFence, "verification_status" | "status">> & { moderation_status?: "private" | "rejected" }) {
    setError(null);
    try {
      await api(`/api/admin/geofences/${f.id}`, { method: "PATCH", json: body });
      setFences((fs) => fs.map((x) => (x.id === f.id ? { ...x, ...body } as AdminFence : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function createAdminFence(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!shape) return setError("Draw an area first.");
    const f = new FormData(e.currentTarget);
    try {
      await api("/api/admin/geofences", {
        method: "POST",
        json: { shape, description: f.get("description") || undefined, category: f.get("category") || undefined },
      });
      setCreating(false);
      setShape(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  }

  const eventsFor = (id: string) => events.filter((e) => e.geofence_id === id).slice(0, 5);

  return (
    <div className="space-y-6">
      {error && <Notice tone="red">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "active" | "all")} className="w-auto" aria-label="Status filter">
          <option value="active">Active</option>
          <option value="all">All (incl. withdrawn)</option>
        </Select>
        {isAdmin && (
          <Button variant="secondary" onClick={() => setCreating((c) => !c)}>
            {creating ? "Cancel" : "Add my own area"}
          </Button>
        )}
      </div>

      {creating && (
        <form onSubmit={createAdminFence}>
          <Card className="space-y-3">
            <GeofenceDrawer value={shape} onChange={setShape} context={features} />
            <Field label="Description" htmlFor="af-desc">
              <Input id="af-desc" name="description" maxLength={1000} />
            </Field>
            <Field label="Category" htmlFor="af-cat">
              <Select id="af-cat" name="category" defaultValue="">
                <option value="">—</option>
                {Object.entries(GEOFENCE_CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit">Save area</Button>
          </Card>
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <LazyMap features={features} className="h-[65vh] min-h-80 w-full" ariaLabel="Geofences map" />
        <ul className="max-h-[65vh] space-y-2 overflow-y-auto">
          {!shown.length && <li className="text-sm text-muted">No areas.</li>}
          {shown.map((f) => (
            <li key={f.id}>
              <Card className={`space-y-2 p-3 text-sm ${f.id === selected ? "ring-2 ring-accent" : ""}`}>
                <button type="button" className="w-full text-left" onClick={() => setSelected(f.id === selected ? null : f.id)}>
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-mono font-semibold">{f.reference}</span>
                    <span className="text-xs text-muted">{fmtDateTime(f.submitted_at)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {f.origin === "anonymous" && f.verification_status === "unverified" ? (
                      <Badge tone="amber">Unverified — third-party submission</Badge>
                    ) : (
                      <Badge tone={f.verification_status === "verified" ? "green" : f.verification_status === "disputed" ? "red" : "neutral"}>{f.verification_status}</Badge>
                    )}
                    <Badge tone={KIND[kindOf(f)].tone}>
                      {KIND[kindOf(f)].label}
                      {f.tier === "wide" && f.wide_mode === "outside" ? " (rather I didn't leave)" : ""}
                    </Badge>
                    {f.effective_from && <span className="text-xs text-muted">in effect from {fmtDateTime(f.effective_from)}</span>}
                    {f.watcher_id && <Badge tone="purple">Watch link …{f.watcher_id.slice(-4)}</Badge>}
                    {f.status !== "active" && <Badge tone="neutral">{f.status}</Badge>}
                    {f.currently_inside && <Badge tone="red">Currently inside</Badge>}
                    {f.category && <Badge>{GEOFENCE_CATEGORIES[f.category as keyof typeof GEOFENCE_CATEGORIES] ?? f.category}</Badge>}
                  </div>
                  {f.description && <p className="mt-1 whitespace-pre-line text-muted">{f.description}</p>}
                </button>
                {isAdmin && (
                  <>
                    {eventsFor(f.id).length > 0 && (
                      <ul className="text-xs text-muted">
                        {eventsFor(f.id).map((e) => (
                          <li key={e.id}>
                            {e.event_type} · {fmtDateTime(e.observed_at)}
                            {e.accuracy_m != null ? ` · ±${Math.round(e.accuracy_m)} m` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {f.verification_status !== "verified" && (
                        <Button size="sm" variant="secondary" onClick={() => patch(f, { verification_status: "verified" })}>
                          Mark verified
                        </Button>
                      )}
                      {f.verification_status !== "disputed" && (
                        <Button size="sm" variant="secondary" onClick={() => patch(f, { verification_status: "disputed" })}>
                          Dispute
                        </Button>
                      )}
                      {f.watcher_id && (
                        <ConfirmButton
                          prompt="Revoke this watch link? It stops working and all its areas are archived."
                          confirmLabel="Revoke"
                          onConfirm={async () => {
                            try {
                              await api(`/api/admin/watchers/${f.watcher_id}`, { method: "DELETE" });
                              setFences((fs) => fs.map((x) => (x.watcher_id === f.watcher_id ? { ...x, status: "archived" } : x)));
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "Revoke failed");
                            }
                          }}
                        >
                          Revoke watch link
                        </ConfirmButton>
                      )}
                      {f.status === "active" ? (
                        <Button size="sm" variant="ghost" onClick={() => patch(f, { status: "archived" })}>
                          Archive
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => patch(f, { status: "active" })}>
                          Reactivate
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </div>

      {isAdmin && <LegalRestrictions initial={restrictions} />}
    </div>
  );
}

function LegalRestrictions({ initial }: { initial: LegalRestriction[] }) {
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => (f.get(k) ? String(f.get(k)) : null);
    try {
      const res = await api<{ restriction: LegalRestriction }>("/api/admin/legal-restrictions", {
        method: "POST",
        json: {
          title: get("title"),
          issuing_authority: get("issuing_authority"),
          authority_reference: get("authority_reference"),
          description: get("description"),
          valid_from: get("valid_from"),
          valid_until: get("valid_until"),
          verification_notes: get("verification_notes"),
        },
      });
      setItems((i) => [res.restriction, ...i]);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Verified legal restrictions</h2>
          <p className="text-xs text-muted">
            Kept separate from anonymous concerns. Record only restrictions you have verified, such as an order you have
            seen.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setOpen((o) => !o)}>
          {open ? "Cancel" : "Record restriction"}
        </Button>
      </div>
      {open && (
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" htmlFor="lr-title">
            <Input id="lr-title" name="title" required />
          </Field>
          <Field label="Issuing authority" htmlFor="lr-auth">
            <Input id="lr-auth" name="issuing_authority" required placeholder="e.g. a named court" />
          </Field>
          <Field label="Authority reference" htmlFor="lr-ref">
            <Input id="lr-ref" name="authority_reference" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Valid from" htmlFor="lr-from">
              <Input id="lr-from" name="valid_from" type="date" />
            </Field>
            <Field label="Valid until" htmlFor="lr-until">
              <Input id="lr-until" name="valid_until" type="date" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Terms / description" htmlFor="lr-desc">
              <Textarea id="lr-desc" name="description" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="How was this verified?" htmlFor="lr-ver">
              <Textarea id="lr-ver" name="verification_notes" required />
            </Field>
          </div>
          {error && <Notice tone="red" className="sm:col-span-2">{error}</Notice>}
          <Button type="submit" className="sm:col-span-2">
            Save
          </Button>
        </form>
      )}
      <ul className="divide-y divide-border text-sm">
        {items.map((r) => (
          <li key={r.id} className="py-2">
            <p className="font-medium">
              {r.title} <span className="text-muted">· {r.issuing_authority}</span>
            </p>
            <p className="text-xs text-muted">
              {r.authority_reference ?? "No reference"} · {fmtDate(r.valid_from)} – {fmtDate(r.valid_until)} · verified {fmtDate(r.verified_at)}
            </p>
          </li>
        ))}
        {!items.length && <li className="py-2 text-muted">None recorded.</li>}
      </ul>
    </Card>
  );
}
