"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/client-api";
import { ConfirmButton } from "@/components/confirm-button";
import { AddressSearch } from "@/components/address-search";
import {
  PLAN_CATEGORIES,
  PLAN_STATUSES,
  PUBLICATION_MODES,
  PUBLICATION_MODE_LABELS,
  SENSITIVE_CATEGORIES,
  STATUS_LABELS,
  categoryLabel,
  defaultModeForVenue,
  venuePrecisionError,
  windowPlans,
  latestFirstWithinDay,
  planListOrder,
  PLAN_WINDOW_DAYS,
  isPublished,
  type PlanRow,
  type PlanStatus,
  type PublicationMode,
} from "@/lib/plans";
import { fmtDate, fmtDateTime, fmtTime, londonDayKey } from "@/lib/format";
import { needsOutcome } from "@/lib/plan-outcome";
import { useNow } from "@/lib/use-now";

export interface VenueOption {
  id: string;
  name: string;
  category: string;
  public_area_label: string | null;
  lat: number | null;
  lng: number | null;
  is_public: boolean;
}

type Draft = {
  id?: string;
  title: string;
  category: string;
  venue_id: string;
  description: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  all_day: boolean;
  status: PlanStatus;
  publication_mode: PublicationMode;
  public_area_label: string;
  confirm_sensitive_exact: boolean;
  confirm_private_exact: boolean;
  extra_venue_ids: string[];
};

export type PlanWithLocations = PlanRow & { plan_locations?: { venue_id: string; position: number }[] | null };

const pad = (n: number) => String(n).padStart(2, "0");
function localDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localTime(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toIso(date: string, time: string) {
  return new Date(`${date}T${time || "00:00"}`).toISOString();
}

function emptyDraft(): Draft {
  const t = new Date(Date.now() + 86_400_000);
  return {
    title: "",
    category: "other",
    venue_id: "",
    description: "",
    start_date: localDate(t.toISOString()),
    start_time: "",
    end_date: "",
    end_time: "",
    all_day: true,
    status: "planned",
    publication_mode: "general_area",
    public_area_label: "",
    confirm_sensitive_exact: false,
    confirm_private_exact: false,
    extra_venue_ids: [],
  };
}

function fromRow(p: PlanWithLocations): Draft {
  return {
    id: p.id,
    title: p.title,
    category: p.category,
    venue_id: p.venue_id ?? "",
    description: p.description ?? "",
    start_date: localDate(p.starts_at),
    start_time: p.all_day ? "" : localTime(p.starts_at),
    end_date: p.ends_at ? localDate(p.ends_at) : "",
    end_time: p.ends_at && !p.all_day ? localTime(p.ends_at) : "",
    all_day: p.all_day,
    status: p.status,
    publication_mode: p.publication_mode,
    public_area_label: p.public_area_label ?? "",
    confirm_sensitive_exact: p.publication_mode === "exact_venue",
    confirm_private_exact: p.publication_mode === "exact_venue" || p.publication_mode === "retrospective",
    extra_venue_ids: [...(p.plan_locations ?? [])].sort((a, b) => a.position - b.position).map((l) => l.venue_id),
  };
}

function toPayload(d: Draft) {
  const startsAt = toIso(d.start_date, d.all_day ? "00:00" : d.start_time);
  const endsAt = d.end_date ? toIso(d.end_date, d.all_day ? "23:59" : d.end_time || "23:59") : !d.all_day && d.end_time ? toIso(d.start_date, d.end_time) : null;
  return {
    title: d.title,
    category: d.category,
    venue_id: d.venue_id || null,
    description: d.description || null,
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: d.all_day,
    status: d.status,
    publication_mode: d.publication_mode,
    public_area_label: d.public_area_label || null,
    confirm_sensitive_exact: d.confirm_sensitive_exact,
    confirm_private_exact: d.confirm_private_exact,
    extra_venue_ids: d.extra_venue_ids.filter(Boolean),
  };
}

export function PlansEditor({
  initialPlans,
  venues: initialVenues,
  visitsByPlan,
}: {
  initialPlans: PlanWithLocations[];
  venues: VenueOption[];
  visitsByPlan: Record<string, { started_at: string; ended_at: string }[]>;
}) {
  const router = useRouter();
  const [plans, setPlans] = useState(initialPlans);
  const now = useNow();
  const unanswered = useMemo(() => (now ? plans.filter((p) => needsOutcome(p, now)).sort((x, y) => x.starts_at.localeCompare(y.starts_at)) : []), [plans, now]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"upcoming" | "past" | "all">("upcoming");
  const [venueQuery, setVenueQuery] = useState("");
  const [venues, setVenues] = useState(initialVenues);
  const [newVenueFor, setNewVenueFor] = useState<"main" | number | null>(null);
  const [recurFor, setRecurFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [days, setDays] = useState(PLAN_WINDOW_DAYS);

  // A week at a time; "Show the next 7 days" extends it.
  const { shown, beyond } = useMemo(() => {
    if (filter === "all") return { shown: latestFirstWithinDay(plans, londonDayKey, "ascending"), beyond: [] as PlanWithLocations[] };
    const w = windowPlans(plans, londonDayKey(new Date().toISOString()), days, filter, londonDayKey, now || undefined);
    // Within a day, latest time first.
    return { shown: planListOrder(w.shown, londonDayKey, filter), beyond: w.beyond };
  }, [plans, filter, days, now]);

  const venueMatches = useMemo(() => {
    const q = venueQuery.trim().toLowerCase();
    return q ? venues.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 30) : venues.slice(0, 30);
  }, [venueQuery, venues]);

  function update<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, [k]: v };
      // Choosing a venue sets the default visibility: public venues in full,
      // private addresses by area only.
      if (k === "venue_id") {
        const ven = venues.find((x) => x.id === v) ?? null;
        if (next.publication_mode !== "private") next.publication_mode = defaultModeForVenue(ven);
        next.confirm_private_exact = false;
        if (ven && !next.public_area_label) next.public_area_label = ven.public_area_label ?? "";
      }
      if ((k === "start_time" || k === "end_time") && v) next.all_day = false;
      if (k === "all_day" && v) {
        next.start_time = "";
        next.end_time = "";
      }
      // Changing to a sensitive category drops exact-venue publication.
      if (k === "category" && SENSITIVE_CATEGORIES.has(v as string) && next.publication_mode === "exact_venue") {
        next.publication_mode = "general_area";
        next.confirm_sensitive_exact = false;
      }
      return next;
    });
  }

  async function save(d: Draft, overrides: Partial<Draft> = {}) {
    const merged = { ...d, ...overrides };
    if (!merged.title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = toPayload(merged);
      const res = merged.id
        ? await api<{ plan: PlanRow }>(`/api/admin/plans/${merged.id}`, { method: "PATCH", json: payload })
        : await api<{ plan: PlanRow }>("/api/admin/plans", { method: "POST", json: payload });
      const withLocs: PlanWithLocations = {
        ...res.plan,
        plan_locations: payload.extra_venue_ids.map((venue_id, i) => ({ venue_id, position: i + 1 })),
      };
      setPlans((ps) => {
        const others = ps.filter((p) => p.id !== res.plan.id);
        return [...others, withLocs].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      });
      setDraft(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function quickStatus(p: PlanRow, status: PlanStatus, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ plan: PlanRow }>(`/api/admin/plans/${p.id}`, { method: "PATCH", json: { status, ...extra } });
      setPlans((ps) => ps.map((x) => (x.id === p.id ? res.plan : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function archive(p: PlanRow) {
    setBusy(true);
    try {
      await api(`/api/admin/plans/${p.id}`, { method: "DELETE" });
      setPlans((ps) => ps.filter((x) => x.id !== p.id));
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Archive failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteForever(p: PlanRow) {
    setBusy(true);
    try {
      await api(`/api/admin/plans/${p.id}?permanent=1`, { method: "DELETE" });
      setPlans((ps) => ps.filter((x) => x.id !== p.id));
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function recur(p: PlanRow, every: string, count: number) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ created: number }>(`/api/admin/plans/${p.id}/recur`, { method: "POST", json: { every, count } });
      setRecurFor(null);
      setError(null);
      router.refresh();
      setNotice(`${r.created} repeat(s) created.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create repeats");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (draft) void save(draft);
  }

  if (draft) {
    const sensitive = SENSITIVE_CATEGORIES.has(draft.category);
    const selectedVenue = venues.find((v) => v.id === draft.venue_id);
    const privateExactNeedsConfirm =
      Boolean(selectedVenue) && venuePrecisionError(draft.publication_mode, selectedVenue ?? null, false, false) !== null;
    return (
      <form onSubmit={onSubmit} className="mx-auto max-w-xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{draft.id ? "Edit plan" : "New plan"}</h2>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
            ← Back
          </Button>
        </div>
        <Card className="space-y-4">
          <Field label="Title" htmlFor="title">
            <Input id="title" value={draft.title} onChange={(e) => update("title", e.target.value)} required maxLength={200} autoFocus />
          </Field>
          <Field label="Category" htmlFor="category">
            <Select id="category" value={draft.category} onChange={(e) => update("category", e.target.value)}>
              {Object.entries(PLAN_CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                  {SENSITIVE_CATEGORIES.has(k) ? " (sensitive)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <div className="space-y-2">
            <p className="text-sm font-medium">Locations</p>
            <Input placeholder="Filter saved venues…" value={venueQuery} onChange={(e) => setVenueQuery(e.target.value)} aria-label="Filter venues" />
            {[draft.venue_id, ...draft.extra_venue_ids].map((vid, idx) => {
              const ven = venues.find((v) => v.id === vid);
              const isMain = idx === 0;
              return (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-5 text-xs text-muted">{idx + 1}.</span>
                  <Select
                    aria-label={isMain ? "Main location" : `Location ${idx + 1}`}
                    value={vid}
                    onChange={(e) => {
                      if (isMain) update("venue_id", e.target.value);
                      else update("extra_venue_ids", draft.extra_venue_ids.map((x, k) => (k === idx - 1 ? e.target.value : x)));
                    }}
                  >
                    <option value="">{isMain ? "No location" : "Choose…"}</option>
                    {ven && !venueMatches.includes(ven) && <option value={ven.id}>{ven.name}</option>}
                    {venueMatches.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} · {v.is_public ? "public" : "private"} · {categoryLabel(v.category)}
                      </option>
                    ))}
                  </Select>
                  {!isMain && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => update("extra_venue_ids", draft.extra_venue_ids.filter((_, k) => k !== idx - 1))}>
                      Remove
                    </Button>
                  )}
                </div>
              );
            })}
            {selectedVenue && (
              <p className="text-xs text-muted">
                Main: {selectedVenue.name} ({selectedVenue.is_public ? "public venue, shown in full" : "private address, area only"})
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {draft.venue_id && draft.extra_venue_ids.length < 9 && (
                <Button type="button" size="sm" variant="secondary" onClick={() => update("extra_venue_ids", [...draft.extra_venue_ids, ""])}>
                  + Add another location
                </Button>
              )}
              <Button type="button" size="sm" variant="secondary" onClick={() => setNewVenueFor(draft.venue_id ? draft.extra_venue_ids.length : "main")}>
                + New venue
              </Button>
            </div>
            {newVenueFor !== null && (
              <NewVenuePanel
                onCancel={() => setNewVenueFor(null)}
                onCreated={(v) => {
                  setVenues((vs) => [...vs, v].sort((a, b) => a.name.localeCompare(b.name)));
                  if (newVenueFor === "main") update("venue_id", v.id);
                  else update("extra_venue_ids", [...draft.extra_venue_ids.filter(Boolean), v.id]);
                  setNewVenueFor(null);
                }}
              />
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.all_day} onChange={(e) => update("all_day", e.target.checked)} className="h-5 w-5" />
            All day (no fixed time)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date" htmlFor="start_date">
              <Input id="start_date" type="date" value={draft.start_date} onChange={(e) => update("start_date", e.target.value)} required />
            </Field>
            <Field label="Start time" htmlFor="start_time">
              <Input id="start_time" type="time" step={300} value={draft.start_time} onChange={(e) => update("start_time", e.target.value)} />
            </Field>
            <Field label="End date (optional)" htmlFor="end_date">
              <Input id="end_date" type="date" value={draft.end_date} min={draft.start_date} onChange={(e) => update("end_date", e.target.value)} />
            </Field>
            <Field label="End time" htmlFor="end_time">
              <Input id="end_time" type="time" step={300} value={draft.end_time} onChange={(e) => update("end_time", e.target.value)} />
            </Field>
          </div>
          <Field label="Notes (public when published)" htmlFor="description">
            <Textarea id="description" value={draft.description} onChange={(e) => update("description", e.target.value)} maxLength={2000} rows={3} />
          </Field>
        </Card>

        <Card className="space-y-4">
          <h3 className="font-semibold">Publication</h3>
          <Field label="Status" htmlFor="status">
            <Select id="status" value={draft.status} onChange={(e) => update("status", e.target.value as PlanStatus)}>
              {PLAN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Public visibility"
            htmlFor="publication_mode"
            hint={sensitive ? "Sensitive category: by default only a general area or a retrospective entry is published." : undefined}
          >
            <Select id="publication_mode" value={draft.publication_mode} onChange={(e) => update("publication_mode", e.target.value as PublicationMode)}>
              {PUBLICATION_MODES.map((m) => (
                <option key={m} value={m}>
                  {PUBLICATION_MODE_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          {sensitive && draft.publication_mode === "exact_venue" && (
            <Notice tone="amber">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5"
                  checked={draft.confirm_sensitive_exact}
                  onChange={(e) => update("confirm_sensitive_exact", e.target.checked)}
                />
                <span>I understand this publishes the exact venue of a future {categoryLabel(draft.category).toLowerCase()} activity.</span>
              </label>
            </Notice>
          )}
          {privateExactNeedsConfirm && (
            <Notice tone="amber">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5"
                  checked={draft.confirm_private_exact}
                  onChange={(e) => update("confirm_private_exact", e.target.checked)}
                />
                <span>{selectedVenue?.name} is a private address. Tick to show its name and exact location publicly anyway.</span>
              </label>
            </Notice>
          )}
          {draft.publication_mode !== "private" && draft.publication_mode !== "exact_venue" && (
            <Field label="Public area or road (optional)" htmlFor="public_area_label" hint='e.g. "Central Manchester". Shown instead of the venue.'>
              <Input id="public_area_label" value={draft.public_area_label} onChange={(e) => update("public_area_label", e.target.value)} maxLength={120} />
            </Field>
          )}
          <p className="text-xs text-muted">
            {isPublished(draft.status, draft.publication_mode)
              ? draft.publication_mode === "retrospective"
                ? "Will appear on the public board after it ends."
                : "Will appear on the public board when saved."
              : "Will NOT appear publicly (draft or private)."}
          </p>
        </Card>

        {error && <Notice tone="red">{error}</Notice>}
        <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
          <Button type="button" variant="secondary" size="lg" disabled={busy} onClick={() => save(draft, { status: "draft" })}>
            Save draft
          </Button>
          <Button type="submit" size="lg" disabled={busy} className="flex-1">
            {draft.status === "draft" ? "Save" : isPublished(draft.status, draft.publication_mode) ? "Save & publish" : "Save"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="lg" onClick={() => setDraft(emptyDraft())}>
          + New plan
        </Button>
        <Select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as typeof filter);
            setDays(PLAN_WINDOW_DAYS);
          }}
          className="w-auto"
          aria-label="Show"
        >
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
          <option value="all">All</option>
        </Select>
      </div>
      {error && <Notice tone="red">{error}</Notice>}
      {notice && <Notice tone="green">{notice}</Notice>}
      {unanswered.length > 0 && (
        <Card className="space-y-3 border-amber-300 bg-amber-50 p-4">
          <div>
            <p className="font-semibold">Did these happen?</p>
            <p className="text-sm text-muted">
              Their time has passed and GPS didn&apos;t place you there. Answer so they don&apos;t stay in the past as unknown.
            </p>
          </div>
          <ul className="space-y-2">
            {unanswered.map((p) => (
              <OutcomeRow key={p.id} plan={p} busy={busy} onAnswer={(status, extra) => quickStatus(p, status, extra)} />
            ))}
          </ul>
        </Card>
      )}
      {filter !== "all" && (
        <p className="text-sm font-semibold">{filter === "upcoming" ? `Next ${days} days` : `Last ${days} days`}</p>
      )}
      {!shown.length && (
        <p className="text-sm text-muted">
          {filter === "all" ? "No plans." : `No plans in ${filter === "upcoming" ? "the next" : "the last"} ${days} days.`}
          {beyond.length > 0 && filter === "upcoming" ? ` Next one: ${fmtDate(beyond[0].starts_at)}.` : ""}
        </p>
      )}
      <ul className="space-y-2">
        {shown.map((p) => {
          const published = isPublished(p.status, p.publication_mode);
          const matched = visitsByPlan[p.id];
          return (
            <li key={p.id}>
              <Card className="space-y-2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button type="button" className="text-left" onClick={() => setDraft(fromRow(p))}>
                    <span className="block font-semibold text-accent underline-offset-2 hover:underline">{p.title}</span>
                    <span className="block text-sm text-muted">
                      {fmtDate(p.starts_at)}
                      {!p.all_day ? ` ${fmtTime(p.starts_at)}` : ""}
                      {p.ends_at && fmtDate(p.ends_at) !== fmtDate(p.starts_at) ? ` – ${fmtDate(p.ends_at)}` : ""} · {categoryLabel(p.category)}
                    </span>
                  </button>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={p.status === "cancelled" ? "red" : p.status === "completed" ? "purple" : p.status === "draft" ? "neutral" : "blue"}>
                      {STATUS_LABELS[p.status]}
                    </Badge>
                    <Badge tone={published ? "green" : "neutral"}>{published ? PUBLICATION_MODE_LABELS[p.publication_mode].split(" (")[0] : "Not public"}</Badge>
                  </div>
                </div>
                {matched?.length ? (
                  <p className="text-xs text-green-800">
                    Recorded GPS visit nearby: {fmtDateTime(matched[0].started_at)}–{fmtTime(matched[0].ended_at)}
                  </p>
                ) : p.status === "completed" ? (
                  <p className="text-xs text-muted">
                    {p.completion_source === "gps" ? "Completed: confirmed by GPS" : "Completed: confirmed by you (no matching GPS visit)"}
                    {p.actual_started_at ? ` · actually ${fmtDateTime(p.actual_started_at)}${p.actual_ended_at ? `–${fmtTime(p.actual_ended_at)}` : ""}` : ""}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setDraft(fromRow(p))}>
                    Edit
                  </Button>
                  {p.status === "draft" && (
                    <Button size="sm" disabled={busy} onClick={() => quickStatus(p, "planned")}>
                      Publish
                    </Button>
                  )}
                  {p.status !== "cancelled" && p.status !== "completed" && (
                    <>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => quickStatus(p, "completed")}>
                        Mark completed
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => quickStatus(p, "cancelled")}>
                        Cancel plan
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraft({ ...fromRow(p), id: undefined, title: `${p.title} (copy)`, status: "draft" })}
                  >
                    Duplicate
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRecurFor(recurFor === p.id ? null : p.id)}>
                    Repeat…
                  </Button>
                  <ConfirmButton disabled={busy} prompt="Remove from the public board?" confirmLabel="Archive" onConfirm={() => archive(p)}>
                    Archive
                  </ConfirmButton>
                  <ConfirmButton disabled={busy} prompt="Delete permanently? This cannot be undone." confirmLabel="Delete" onConfirm={() => deleteForever(p)}>
                    Delete
                  </ConfirmButton>
                </div>
                {recurFor === p.id && <RecurPanel busy={busy} onCreate={(every, count) => recur(p, every, count)} />}
              </Card>
            </li>
          );
        })}
      </ul>
      {beyond.length > 0 && (
        <div className="flex flex-col items-center gap-1 pt-2">
          <Button variant="secondary" onClick={() => setDays((d) => d + PLAN_WINDOW_DAYS)}>
            {filter === "past" ? `Show the previous ${PLAN_WINDOW_DAYS} days` : `Show the next ${PLAN_WINDOW_DAYS} days`}
          </Button>
          <span className="text-xs text-muted">
            {beyond.length} more plan{beyond.length === 1 ? "" : "s"} {filter === "past" ? "earlier" : "later"}
          </span>
        </div>
      )}
    </div>
  );
}

function RecurPanel({ busy, onCreate }: { busy: boolean; onCreate: (every: string, count: number) => void }) {
  const [every, setEvery] = useState("weekly");
  const [count, setCount] = useState(4);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-2">
      <Field label="Repeat" htmlFor="recur-every">
        <Select id="recur-every" value={every} onChange={(e) => setEvery(e.target.value)} className="w-auto">
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
          <option value="fortnightly">Every fortnight</option>
          <option value="monthly">Every month</option>
        </Select>
      </Field>
      <Field label="How many more times" htmlFor="recur-count">
        <Input id="recur-count" type="number" min={1} max={52} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-24" />
      </Field>
      <Button size="sm" disabled={busy || count < 1 || count > 52} onClick={() => onCreate(every, count)}>
        Create repeats
      </Button>
      <p className="w-full text-xs text-muted">Each repeat is a separate plan you can edit, cancel or delete on its own.</p>
    </div>
  );
}

function NewVenuePanel({ onCreated, onCancel }: { onCreated: (v: VenueOption) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: "", category: "restaurant", address: "", lat: null as number | null, lng: null as number | null, public_area_label: "", is_public: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ venue: VenueOption }>("/api/admin/venues", {
        method: "POST",
        json: { ...form, address: form.address || null, public_area_label: form.public_area_label || null },
      });
      onCreated(res.venue);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save venue");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded-md border border-border bg-slate-50 p-3">
      <AddressSearch
        id="plan-venue-search"
        label="Find the venue (name and town, postcode or address)"
        onSelect={(r) => setForm((f) => ({ ...f, name: f.name || r.name, address: r.label, lat: r.lat, lng: r.lng }))}
      />
      <Field label="Venue name" htmlFor="nv-name">
        <Input id="nv-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={200} />
      </Field>
      <Field label="Category" htmlFor="nv-cat">
        <Select id="nv-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {Object.entries(PLAN_CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-5 w-5" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} />
        <span>Public venue (pub, hotel, restaurant…). Untick for a private address, which is shown by area only.</span>
      </label>
      <Field label={form.is_public ? "Area label (optional)" : "Public area or road"} htmlFor="nv-area">
        <Input id="nv-area" value={form.public_area_label} onChange={(e) => setForm({ ...form, public_area_label: e.target.value })} maxLength={120} />
      </Field>
      {form.lat == null && <p className="text-xs text-muted">Search above to set the location.</p>}
      {error && <Notice tone="red">{error}</Notice>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy || !form.name.trim() || form.lat == null} onClick={create}>
          Save venue
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** One "Did this happen?" answer: confirm with the real times, or cancel. */
function OutcomeRow({
  plan,
  busy,
  onAnswer,
}: {
  plan: PlanRow;
  busy: boolean;
  onAnswer: (status: PlanStatus, extra?: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const plannedEnd = plan.ends_at ?? new Date(Date.parse(plan.starts_at) + 2 * 3600_000).toISOString();
  const [t, setT] = useState({
    sd: localDate(plan.starts_at),
    st: plan.all_day ? "" : localTime(plan.starts_at),
    ed: localDate(plannedEnd),
    et: plan.all_day ? "" : localTime(plannedEnd),
  });
  const set = (k: keyof typeof t) => (e: React.ChangeEvent<HTMLInputElement>) => setT((x) => ({ ...x, [k]: e.target.value }));
  return (
    <li className="space-y-3 rounded-lg bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="block font-semibold">{plan.title}</span>
          <span className="block text-sm text-muted">
            Planned {fmtDate(plan.starts_at)}
            {!plan.all_day ? ` ${fmtTime(plan.starts_at)}` : ""}
            {plan.ends_at && !plan.all_day ? `–${fmtTime(plan.ends_at)}` : ""}
          </span>
        </span>
        <span className="flex flex-wrap gap-1">
          <Button size="sm" disabled={busy} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Yes, it happened
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAnswer("cancelled")}>
            No, cancel it
          </Button>
        </span>
      </div>
      {open && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-sm font-medium">When did it actually happen?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Started" htmlFor={`as-${plan.id}`}>
              <span className="flex gap-1">
                <Input id={`as-${plan.id}`} type="date" value={t.sd} onChange={set("sd")} />
                <Input type="time" step={300} value={t.st} onChange={set("st")} aria-label="Start time" />
              </span>
            </Field>
            <Field label="Finished" htmlFor={`ae-${plan.id}`}>
              <span className="flex gap-1">
                <Input id={`ae-${plan.id}`} type="date" value={t.ed} min={t.sd} onChange={set("ed")} />
                <Input type="time" step={300} value={t.et} onChange={set("et")} aria-label="End time" />
              </span>
            </Field>
          </div>
          <Button
            size="sm"
            disabled={busy || !t.sd}
            onClick={() =>
              onAnswer("completed", {
                actual_started_at: toIso(t.sd, t.st),
                actual_ended_at: t.ed ? toIso(t.ed, t.et || (t.st ? "" : "23:59")) : null,
              })
            }
          >
            Save as completed
          </Button>
        </div>
      )}
    </li>
  );
}
