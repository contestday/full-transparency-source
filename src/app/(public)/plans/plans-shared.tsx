import Link from "next/link";
import { Badge, Button, Select } from "@/components/ui";
import { Icon, Segmented, type IconName } from "@/components/design";
import { PLAN_CATEGORIES, PLAN_STATUSES, PRIVATE_LOCATION_LABEL, STATUS_LABELS, categoryLabel, type PlanStatus } from "@/lib/plans";
import { fmtDate, fmtDateTime, fmtTime, londonDayKey } from "@/lib/format";
import type { PublicPlan } from "@/lib/public-data";
import { needsOutcome } from "@/lib/plan-outcome";
import { ZoneCard } from "@/components/zone-card";
import type { BaseZone } from "@/lib/geofence/tiers";
import { PlanMapButton } from "./plan-map-button";
import { WishButtons } from "./wish-buttons";

/** Past plan with no outcome yet (rendered per request, so "now" is the request time). */
function awaitingOutcome(p: PublicPlan): boolean {
  return needsOutcome(p, Date.now());
}

export function PlansTabs({ active, query }: { active: "list" | "calendar" | "map"; query: string }) {
  return (
    <Segmented
      items={[
        { href: `/plans${query}`, label: "Schedule", icon: "layers", current: active === "list" },
        { href: `/plans/calendar${query}`, label: "Calendar", icon: "calendar", current: active === "calendar" },
        { href: `/plans/map${query}`, label: "Map", icon: "pin", current: active === "map" },
      ]}
    />
  );
}

export function PlanFilters({
  category,
  status,
  extra,
}: {
  category?: string;
  status?: string;
  extra?: Record<string, string | undefined>;
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      {Object.entries(extra ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="text-sm">
        <span className="block font-semibold">Category</span>
        <Select name="category" defaultValue={category ?? ""} className="w-auto bg-white">
          <option value="">All categories</option>
          {Object.entries(PLAN_CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </label>
      <label className="text-sm">
        <span className="block font-semibold">Status</span>
        <Select name="status" defaultValue={status ?? ""} className="w-auto bg-white">
          <option value="">All statuses</option>
          {PLAN_STATUSES.filter((s) => s !== "draft").map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" variant="secondary">
        Filter
      </Button>
    </form>
  );
}

const STATUS_TONE: Record<PlanStatus, "neutral" | "blue" | "green" | "amber" | "red" | "purple"> = {
  draft: "neutral",
  planned: "blue",
  confirmed: "green",
  changed: "amber",
  cancelled: "red",
  completed: "purple",
};

const STATUS_ICON: Partial<Record<PlanStatus, IconName>> = {
  planned: "clock",
  confirmed: "check",
  changed: "swap",
  cancelled: "close",
  completed: "check",
};

export function StatusBadge({ status }: { status: string }) {
  const s = status as PlanStatus;
  const icon = STATUS_ICON[s];
  return (
    <Badge tone={STATUS_TONE[s] ?? "neutral"}>
      {icon && <Icon name={icon} className="h-3.5 w-3.5" />}
      {STATUS_LABELS[s] ?? status}
    </Badge>
  );
}

export function planWhen(p: PublicPlan): string {
  const start = p.all_day ? fmtDate(p.starts_at) : `${fmtDate(p.starts_at)}, ${fmtTime(p.starts_at)}`;
  if (!p.ends_at) return start;
  const sameDay = fmtDate(p.starts_at) === fmtDate(p.ends_at);
  if (p.all_day) return sameDay ? start : `${start} – ${fmtDate(p.ends_at)}`;
  return sameDay ? `${start}–${fmtTime(p.ends_at)}` : `${start} – ${fmtDate(p.ends_at)}, ${fmtTime(p.ends_at)}`;
}

export function planWhere(p: PublicPlan): string {
  if (p.private_location) return PRIVATE_LOCATION_LABEL;
  if (p.venue_name) {
    // Avoid "The Crown, The Crown, Riverside" when the area label repeats the name.
    let area = p.public_area_label?.trim() ?? "";
    if (area.toLowerCase().startsWith(p.venue_name.toLowerCase())) {
      area = area.slice(p.venue_name.length).replace(/^[,\s]+/, "");
    }
    return p.venue_name + (area ? `, ${area}` : "");
  }
  if (p.public_area_label) return `${p.public_area_label} (general area)`;
  return "Location not published";
}

/** Where a plan is on the map (its main place, or its first located stop), if published. */
export function planPoint(p: PublicPlan): { lat: number; lng: number } | null {
  if (p.public_lat != null && p.public_lng != null) return { lat: p.public_lat, lng: p.public_lng };
  const l = p.extra_locations.find((x) => x.public_lat != null && x.public_lng != null);
  return l ? { lat: l.public_lat!, lng: l.public_lng! } : null;
}

/**
 * A plan, shaded by where it is (green / yellow / red for everyone). A
 * watcher whose own area it is sees their colour instead (one colour per card).
 */
export function PlanCard({ p, zone = null }: { p: PublicPlan; zone?: BaseZone | null }) {
  const cancelled = p.status === "cancelled";
  const d = new Date(p.starts_at);
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...o }).format(d);
  return (
    <ZoneCard
      zone={zone}
      watchId={p.id}
      muted={cancelled}
      title={<h3 className={`text-[18px] font-bold leading-snug ${cancelled ? "line-through" : ""}`}>{p.title}</h3>}
      aside={<StatusBadge status={p.status} />}
    >
     <div className="flex gap-4">
      <div className="flex h-[68px] w-[68px] shrink-0 flex-col items-center justify-center rounded-[14px] bg-white/80 text-center" aria-hidden="true">
        <span className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">{fmt({ weekday: "short" })}</span>
        <span className="text-2xl font-bold leading-none tabular-nums">{fmt({ day: "numeric" })}</span>
        <span className="text-[11px] font-semibold uppercase text-muted">{fmt({ month: "short" })}</span>
      </div>
      <div className="min-w-0 flex-1">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink/80">
          <li className="inline-flex items-center gap-1.5 tabular-nums">
            <Icon name="clock" className="h-4 w-4" />
            {planWhen(p)}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <Icon name="pin" className="h-4 w-4" />
            {planPoint(p) ? (
              <PlanMapButton plan={p} className="text-left font-semibold text-accent underline underline-offset-2">
                {planWhere(p)}
              </PlanMapButton>
            ) : (
              planWhere(p)
            )}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <Icon name="layers" className="h-4 w-4" />
            {categoryLabel(p.category)}
          </li>
        </ul>
        {p.extra_locations.length > 0 && (
          <ol className="mt-2 space-y-0.5 text-sm text-muted">
            {p.extra_locations.map((l) => (
              <li key={l.position} className="flex items-center gap-1.5">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky text-[11px] font-bold text-ink">{l.position + 1}</span>
                {l.private_location ? PRIVATE_LOCATION_LABEL : (l.venue_name ?? (l.area_label ? `${l.area_label} (general area)` : "Location not published"))}
              </li>
            ))}
          </ol>
        )}
        {p.description && <p className="mt-2 whitespace-pre-line text-[15px]">{p.description}</p>}
        {planPoint(p) && (
          <PlanMapButton
            plan={p}
            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-[var(--ft-radius-control)] border border-border bg-white px-3 text-sm font-semibold hover:bg-sky"
          >
            <Icon name="pin" className="h-4 w-4 text-accent" /> Show on map
          </PlanMapButton>
        )}
        {p.status === "changed" && (
          <p className="mt-2 rounded-lg bg-[#FFF7E6] px-3 py-2 text-sm text-[#6B4500]">This plan has changed since it was first published.</p>
        )}
        {p.status === "completed" &&
          (p.completion_source === "gps" ? (
            <p className="mt-2 text-xs font-medium text-jade">Confirmed by GPS: I was recorded at this location at the time.</p>
          ) : (
            <p className="mt-2 text-xs text-muted">Marked completed by me. This is not a GPS-verified visit.</p>
          ))}
        {p.status === "completed" && p.actual_started_at && (
          <p className="mt-1 text-xs text-muted">
            Actually there: {fmtDateTime(p.actual_started_at)}
            {p.actual_ended_at ? ` to ${londonDayKey(p.actual_ended_at) === londonDayKey(p.actual_started_at) ? fmtTime(p.actual_ended_at) : fmtDateTime(p.actual_ended_at)}` : ""}
          </p>
        )}
        {awaitingOutcome(p) && (
          <p className="mt-2 rounded-lg bg-[#F1F4F8] px-3 py-2 text-sm text-muted">This plan&apos;s time has passed. Its outcome is awaiting confirmation.</p>
        )}
        {p.publication_mode === "retrospective" && <p className="mt-2 text-xs text-muted">Published after the event.</p>}
        {p.private_location && (
          <p className="mt-2 text-xs text-muted">The place is kept private to protect the people there, not to hide the visit.</p>
        )}
        {!cancelled && p.status !== "completed" && <WishButtons planId={p.id} />}
        <Link
          href={`/plans/${p.id}/police`}
          prefetch={false}
          className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-[var(--ft-radius-control)] border border-border bg-white px-3 text-sm font-semibold hover:bg-sky"
        >
          Report to police
        </Link>
      </div>
     </div>
    </ZoneCard>
  );
}

export function filterQuery(sp: Record<string, string | string[] | undefined>, keys: string[]): string {
  const params = new URLSearchParams();
  for (const k of keys) {
    const v = sp[k];
    if (typeof v === "string" && v) params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}
