"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LazyMap, type MapFeature } from "@/components/map-lazy";
import { Button, Card, cn, Notice } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { Container, EmptyState, Icon, MapFrame, OnTheMove, StatusDisk, STATUS_TONE } from "@/components/design";
import { InfoButton } from "@/components/info-button";
import { InstallAppButton } from "@/components/pwa";
import { SaveWatchLink } from "@/components/save-watch-link";
import { NotifyPrompt } from "@/components/notify-prompt";
import { AlertPopup } from "./alert-popup";
import { SampleAlerts } from "./sample-alerts";
import { AreaVisits } from "./area-visits";
import { GeofenceSubmitForm, type EditableArea } from "../../geofences/submit/submit-form";
import type { DrawnShape } from "@/components/geofence-drawer";
import { LIVE_STATUS_META, WATCH_LABELS } from "@/lib/live-status";
import { fmtSqMiles, TIER_META, ZONE_COLOR, ZONE_LABEL, type Tier, type WideMode, type Zone } from "@/lib/geofence/tiers";
import { gridCellRing } from "@/lib/geo";
import { fmtDateTime, fmtTime, londonDayKey, relativeAge } from "@/lib/format";
import { formatDistance } from "@/components/address-search";
import { useNow } from "@/lib/use-now";
import { quickRanges } from "@/lib/history-range";
import { forgetWatchLink, saveWatchLink } from "@/lib/watch-links";
import { atHome, homeAreaFeatures, type HomeAreaShape } from "@/lib/home-area";

type Geo = { type: "Polygon"; coordinates: [number, number][][] } | { type: "MultiPolygon"; coordinates: [number, number][][][] };

interface Area {
  reference: string;
  tier: Tier;
  mode: WideMode | null;
  kind: "shape" | "beyond_home" | "location";
  name: string;
  note: string;
  /** Null for "beyond home" areas (never drawn: it would point to home). */
  geojson: Geo | null;
  shape: DrawnShape | null;
  distance_m: number | null;
  blurred_radius_m: number | null;
  area_m2: number;
  sealed: boolean;
  submitted_at: string;
  effective_from?: string;
}

interface View {
  display_code: string | null;
  moving: boolean;
  enabled: boolean;
  status: keyof typeof LIVE_STATUS_META;
  label: string;
  public_lat: number | null;
  public_lng: number | null;
  cell_size_m: number | null;
  observed_at: string | null;
  sealed_alerts: boolean;
  is_sample?: boolean;
  reminder_minutes?: number;
  reminder_location_minutes?: number;
  owner_name?: string;
  owner_first?: string;
  areas: Area[];
  home_area?: HomeAreaShape | null;
}

interface Journey {
  day: string;
  /** False for long periods: stays only, no routes. */
  routes?: boolean;
  segments: { zone: Zone; coords: [number, number][] }[];
  stops: { lat: number; lng: number; name: string; from: string; until: string | null; zone: Zone }[];
}

const letter = (i: number) => String.fromCharCode(65 + i);
const ZONES: Zone[] = ["purple", "red", "amber", "yellow", "green"];

/** One line describing an area: its rule and size. */
interface AreaStat {
  reference: string;
  visits: number;
  minutes: number;
  perDay: number[];
  inside_now: boolean;
  watched_days: number;
}

const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} m` : ""}` : `${m} m`);

/** The last 30 days as small bars (one per day, today outlined), with a text description. */
function AreaSparkline({ perDay, color }: { perDay: number[]; color: string }) {
  const max = Math.max(1, ...perDay);
  const busy = perDay.filter((m) => m > 0).length;
  return (
    <div className="flex h-9 items-end gap-[3px] border-b border-hairline" role="img" aria-label={`Last 30 days: in this area on ${busy} ${busy === 1 ? "day" : "days"}`}>
      {perDay.map((m, i) => (
        <span
          key={i}
          className={cn("flex-1 rounded-t-sm", i === perDay.length - 1 && "outline outline-1 outline-ink")}
          style={{ height: m ? `${Math.max(12, (m / max) * 100)}%` : "2px", background: m ? color : "#E3ECF4" }}
        />
      ))}
    </div>
  );
}

function areaSummary(a: Area): string {
  if (a.kind === "beyond_home") return `Anywhere more than about ${formatDistance(a.distance_m ?? 0)} from home`;
  if (a.kind === "location") {
    return `Within ${formatDistance(a.distance_m ?? 0)} · saved blurred as a ${formatDistance(a.blurred_radius_m ?? 0)} circle`;
  }
  const size = fmtSqMiles(a.area_m2);
  if (a.tier === "wide") return `${a.mode === "outside" ? "Rather I didn't leave" : "Rather I didn't go in"} · ${size}`;
  return size;
}

export function WatchView({ token, vapidPublicKey, sample = false }: { token: string; vapidPublicKey: string | null; /** The public, read-only sample view. */ sample?: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ key: number; features: MapFeature[] } | null>(null);
  const [copied, setCopied] = useState(false);
  // Which period's journey: Today, Yesterday, This week, This month, This year or All time.
  const [rangeKey, setRangeKey] = useState("week");
  const [journeyTick, setJourneyTick] = useState(0);
  // Each area's last 30 days (visits, time, minutes per day).
  const [stats, setStats] = useState<Record<string, AreaStat>>({});
  useEffect(() => {
    let live = true;
    fetch(`/api/watch/${token}/area-stats`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { areas: AreaStat[] } | null) => live && d && setStats(Object.fromEntries(d.areas.map((a) => [a.reference, a]))))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [token, view?.areas.length]);
  // The area whose entries and exits are open in the overlay.
  const [visitsFor, setVisitsFor] = useState<Area | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [journey, setJourney] = useState<Journey | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/watch/${token}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "This watch link could not be loaded");
      setView(body);
      setError(null);
      // Remember real watch links on this device, never the public sample.
      if (body.is_sample) forgetWatchLink(token);
      else if (!sample) saveWatchLink(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [token, sample]);

  const loadJourney = useCallback(
    async (r: { from: string; to: string } | null) => {
      try {
        const res = await fetch(`/api/watch/${token}/journey${r ? `?from=${r.from}&to=${r.to}` : ""}`, { cache: "no-store" });
        if (res.ok) setJourney(await res.json());
      } catch {
        /* keep the last one */
      }
    },
    [token],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [token, load]);

  useEffect(() => {
    const r = rangeKey === "today" ? null : (quickRanges(londonDayKey(new Date().toISOString())).find((x) => x.key === rangeKey) ?? null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadJourney(r);
    if (r && rangeKey !== "week") return;
    const t = setInterval(() => loadJourney(r), 120_000); // today and this week: keep it fresh
    return () => clearInterval(t);
  }, [rangeKey, journeyTick, loadJourney]);

  const status = view ? (view.enabled ? view.status : "disabled") : "unknown";
  const meta = LIVE_STATUS_META[status] ?? LIVE_STATUS_META.unknown;

  const areaFeature = useCallback(
    (a: Area, i: number, on: boolean): MapFeature | null =>
      a.geojson
        ? {
            type: "Feature",
            geometry: a.geojson,
            properties: {
              color: TIER_META[a.tier].color,
              // "Don't go outside" areas: outline only (the amber part is outside them).
              opacity: a.mode === "outside" ? 0 : on ? 0.3 : a.tier === "wide" ? 0.08 : 0.16,
              // Your own areas always have solid outlines (dashed outlines are only ever my noted areas).
              dashed: false,
              label: `${letter(i)} · ${a.name || TIER_META[a.tier].label}\n${areaSummary(a)}`,
            },
          }
        : null,
    [],
  );

  const features = useMemo<MapFeature[]>(() => {
    if (!view) return [];
    // The live position (or the home marker) belongs with periods that include now.
    const today = rangeKey !== "yesterday";
    // My home area (where movement is never shown), with a large marker when I'm in it now.
    const here = today && atHome(view.status, view.public_lat);
    const f: MapFeature[] = homeAreaFeatures(view.home_area, { here, color: meta.color, hereLabel: `${meta.label}
In my home area: movement inside it is never shown.` });
    f.push(...view.areas.flatMap((a, i) => areaFeature(a, i, a.reference === selected) ?? []));
    for (const s of journey?.segments ?? []) {
      f.push({ type: "Feature", geometry: { type: "LineString", coordinates: s.coords }, properties: { color: ZONE_COLOR[s.zone] } });
    }
    for (const s of journey?.stops ?? []) {
      f.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        properties: { color: ZONE_COLOR[s.zone], size: 6, label: `${s.name}\n${fmtTime(s.from)}${s.until ? `–${fmtTime(s.until)}` : ""}` },
      });
    }
    if (view.public_lat != null && view.public_lng != null && today) {
      const c = { lat: view.public_lat, lng: view.public_lng };
      f.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [gridCellRing(c, view.cell_size_m ?? 1000)] }, properties: { color: meta.color, opacity: 0.25 } });
      f.push({ type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: { color: meta.color, size: 11, label: `${meta.label}\nApproximate area` } });
    }
    return f;
  }, [view, meta, journey, selected, rangeKey, areaFeature]);

  /** Tap an area: highlight it and zoom the map to it. */
  function showArea(a: Area, i: number) {
    setSelected(a.reference);
    const feat = areaFeature(a, i, true);
    if (feat) setFocus((f) => ({ key: (f?.key ?? 0) + 1, features: [feat] }));
    mapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function setReminders(kind: "want" | "location", minutes: number) {
    await fetch(`/api/watch/${token}/reminders`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, minutes }) });
    await load();
  }

  async function setSealedAlerts(enabled: boolean) {
    await fetch(`/api/watch/${token}/alerts`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
    await load();
  }

  async function removeArea(reference: string) {
    await fetch(`/api/watch/${token}/areas/${reference}`, { method: "DELETE" });
    if (selected === reference) setSelected(null);
    await load();
  }

  if (error && !view) {
    return (
      <Container className="max-w-3xl space-y-4 py-10">
        <h1 className="text-[32px] font-bold">Your watched places</h1>
        <Notice tone="red">{error}</Notice>
        <Button
          variant="secondary"
          onClick={() => {
            forgetWatchLink(token);
            router.push("/watch");
          }}
        >
          Remove this link from this browser
        </Button>
      </Container>
    );
  }

  const today = now ? londonDayKey(new Date(now).toISOString()) : undefined;
  const editingArea = view?.areas.find((a) => a.reference === editing) ?? null;
  const context = (except: string | null) => (view?.areas ?? []).flatMap((a, i) => (a.reference === except ? [] : (areaFeature(a, i, false) ?? [])));
  const hasSealed = view?.areas.some((a) => a.tier !== "wide");

  /** Sample view: anything that would change or leave it shows the pop-up instead. */
  function guard(e: ReactMouseEvent) {
    if (!sample) return;
    const t = e.target as HTMLElement;
    if (t.closest("[data-sample-ok]") || t.closest("[data-sample-dialog]")) return;
    if (t.closest("button, a, input, select, textarea, label, form")) {
      e.preventDefault();
      e.stopPropagation();
      setBlocked(true);
    }
  }

  return (
    <div onClickCapture={guard}>
      {sample && (
        <div className="border-b-4 border-[#B45309] bg-[#FFE7A3] text-[#142B49]">
          <Container className="py-4">
            <p className="text-lg font-bold sm:text-xl">Sample watch view: read-only</p>
            <p className="text-sm">What a watcher sees: my real status and history, in this sample&apos;s colours.</p>
          </Container>
        </div>
      )}
      {sample && (
        <Container className="pt-4">
          <SampleAlerts token={token} vapidPublicKey={vapidPublicKey} />
        </Container>
      )}
      {view && (
        <AlertPopup
          token={token}
          sample={sample}
          ownerName={view.owner_name ?? "the person this site tracks"}
          ownerFirst={view.owner_first ?? "They"}
          areaNames={Object.fromEntries(view.areas.map((a) => [a.reference, a.name]).filter(([, n]) => n))}
          reminders={{ want: view.reminder_minutes ?? 30, location: view.reminder_location_minutes ?? 30 }}
          onReminders={setReminders}
          onClose={() => mapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
        />
      )}
      {blocked && (
        <div data-sample-dialog role="dialog" aria-modal="true" aria-labelledby="sample-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 text-center shadow-xl">
            <h2 id="sample-title" className="text-xl font-bold">This is a dummy account</h2>
            <p className="text-sm text-muted">Nothing on the sample can be added, changed or removed. Please return to the main app.</p>
            <div className="flex flex-col gap-2">
              <Link href="/" className="inline-flex h-12 items-center justify-center rounded-[var(--ft-radius-control)] bg-accent px-5 font-semibold text-white hover:bg-accent-hover">
                Return to the main app
              </Link>
              <button type="button" className="h-11 rounded-[var(--ft-radius-control)] border border-border font-semibold" onClick={() => setBlocked(false)}>
                Keep looking at the sample
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="bg-navy text-[#DCE7F3]">
        <Container className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 text-sm">
          <Icon name="lock" className="shrink-0 text-signal" />
          <span className="min-w-0 flex-1 basis-40">Private to your link</span>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard?.writeText(window.location.href);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Link href="/watch?manage=1" className="font-semibold text-white underline-offset-2 hover:underline">
              Use another link
            </Link>
          </div>
        </Container>
      </div>

      {!sample && <NotifyPrompt compact target="watch" token={token} vapidPublicKey={vapidPublicKey} />}

      <div className="bg-sky">
        <Container className="py-4 sm:py-7">
          <h1 className="text-[28px] font-bold sm:text-[40px]">{sample ? "Try a watcher's view" : "Your watched places"}</h1>
          <p className="mt-0.5">Your areas, in your colours.</p>
        </Container>
      </div>
      <Container className="space-y-6 pb-20 pt-4 sm:pt-6">
        <div>
          {view?.is_sample && !sample && (
            <Notice tone="amber" title="This is the public sample watch link">
              You&apos;re setting it up. It isn&apos;t saved as your own watch link on this device. Lock it in Admin → Settings when
              it&apos;s ready.
            </Notice>
          )}
          {view?.display_code && (
            <p className="mt-1 text-sm text-muted">
              <strong className="text-ink">Watcher #{view.display_code}</strong> (a random label, not linked to you)
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-6">
          <section aria-live="polite" className="min-w-0 grow-[7] basis-[520px] space-y-4 overflow-hidden rounded-[var(--ft-radius-card)] border border-border bg-surface shadow-[0_8px_24px_rgb(20_43_73/8%)]">
            <div className="flex flex-wrap items-center gap-3 p-4 sm:gap-4 sm:p-6" style={{ background: STATUS_TONE[status]?.bg, color: STATUS_TONE[status]?.ink }}>
              <StatusDisk status={status} size={52} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[.08em]">Status for your areas</p>
                <h2 className="text-[22px] font-bold leading-tight text-ink sm:text-[32px]">
                  {view ? (WATCH_LABELS[status as keyof typeof WATCH_LABELS] ?? meta.label) : "Loading…"}
                </h2>
                <p className="text-[13px] tabular-nums">
                  {view?.observed_at && !view.moving && status !== "unknown" && now && now - Date.parse(view.observed_at) > 10 * 60_000
                    ? `Not moved since ${fmtDateTime(view.observed_at)} (${relativeAge(view.observed_at)})`
                    : view?.observed_at
                      ? `Last GPS update ${relativeAge(view.observed_at)} · ${fmtDateTime(view.observed_at)}`
                      : view && !view.enabled
                        ? "The live marker is switched off at the moment."
                        : ""}
                </p>
              </div>
              {view?.moving && status !== "unknown" && status !== "disabled" && <OnTheMove status={status} />}
            </div>

            <div data-sample-ok className="ft-scroll-x flex gap-2 px-4 sm:px-6" role="group" aria-label="Which period's journey">
              {(today ? quickRanges(today) : []).map((r) => (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={rangeKey === r.key}
                  onClick={() => setRangeKey(r.key)}
                  className={cn(
                    "inline-flex h-[38px] shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold",
                    rangeKey === r.key ? "border-ink bg-ink text-white" : "border-border bg-white text-ink",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {journey && journey.routes === false && <p className="px-4 text-sm text-muted sm:px-6">Showing the places I stayed. Routes are drawn for up to 21 days.</p>}

            <div ref={mapRef} data-sample-ok className="px-4 sm:px-6">
              <MapFrame className="border-0 p-0 shadow-none">
                <LazyMap features={features} fit="once" focus={focus} className="h-[320px] w-full sm:h-[480px]" ariaLabel="Map of my areas, the day's journey and the approximate live position" />
              </MapFrame>
            </div>
            {journey && !journey.segments.length && !journey.stops.length && (
              <p className="px-4 text-sm text-muted sm:px-6">Nothing published for this period yet.</p>
            )}
            <InfoButton label="What the colours mean" className="px-4 pb-4 sm:px-6 sm:pb-6">
              <ul className="space-y-1.5">
                {ZONES.map((z) => (
                  <li key={z} className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: ZONE_COLOR[z] }} aria-hidden="true" />
                    {ZONE_LABEL[z]}
                  </li>
                ))}
              </ul>
              <p className="text-muted">The status, the route and the stops all use these colours. Only you see purple, red and amber.</p>
            </InfoButton>
          </section>

          <div className="min-w-0 grow-[5] basis-[340px] space-y-6">
            <Card className="space-y-3 p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-bold">My areas</h2>
                <span className="text-sm text-muted tabular-nums">{view?.areas.length ?? 0} area{(view?.areas.length ?? 0) === 1 ? "" : "s"}</span>
              </div>
              {view && !view.areas.length && <EmptyState icon="pin" title="No areas yet.">Add one below to start watching.</EmptyState>}
              <ul data-private className="space-y-2">
                {view?.areas.map((a, i) => {
                  const on = a.reference === selected;
                  const st = stats[a.reference];
                  const tierTone = STATUS_TONE[a.tier === "wide" ? "amber" : a.tier === "local" ? "red" : "purple"];
                  return (
                    <li key={a.reference} className={cn("space-y-2.5 rounded-2xl border bg-white p-3.5", on ? "border-2 border-ink" : "border-hairline")}>
                      <button type="button" data-sample-ok className="flex w-full items-center gap-3 text-left" onClick={() => showArea(a, i)} aria-pressed={on}>
                        <span
                          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-bold"
                          style={{ background: tierTone.bg, color: tierTone.ink, boxShadow: `inset 0 0 0 2px ${TIER_META[a.tier].color}` }}
                        >
                          {letter(i)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-bold [overflow-wrap:anywhere]">{a.name || TIER_META[a.tier].label}</span>
                          <span className="mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: tierTone.bg, color: tierTone.ink }}>
                            <span className="h-2 w-2 rounded-full" style={{ background: TIER_META[a.tier].color }} aria-hidden="true" />
                            {TIER_META[a.tier].label}
                            {a.tier === "location" ? " · only you see it" : a.mode === "outside" ? " · didn't leave" : ""}
                          </span>
                          <span className="block text-xs text-muted">{areaSummary(a)}</span>
                        </span>
                        {st && (
                          <span className="shrink-0 text-right">
                            <span className={cn("block font-display text-lg font-bold leading-tight tabular-nums", !st.visits && "text-green-ink")}>{st.visits ? hm(st.minutes) : "0"}</span>
                            <span className="block text-xs text-muted">{st.visits === 1 ? "1 visit" : `${st.visits} visits`}</span>
                          </span>
                        )}
                      </button>
                      {st && st.visits > 0 && <AreaSparkline perDay={st.perDay} color={TIER_META[a.tier].color} />}
                      {st && st.visits === 0 && st.watched_days > 0 && (
                        <p className="flex items-center gap-2 rounded-lg bg-ice px-2.5 py-2 text-[13px]">
                          <Icon name="check" className="h-4 w-4 text-jade" />
                          <span>
                            <b>{Math.min(30, st.watched_days)} {st.watched_days === 1 ? "day" : "days"}</b> with no visits{st.watched_days < 30 ? " since you set it" : ""}
                          </span>
                        </p>
                      )}
                      {a.kind === "beyond_home" && <p className="text-xs text-muted">Not drawn (it would point to my home).</p>}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          data-sample-ok
                          onClick={() => setVisitsFor(a)}
                          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ice px-3 text-sm font-semibold text-[#1947B5]"
                        >
                          <Icon name="clock" className="h-4 w-4" /> Times in this area
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setAdding(false);
                            setEditing(a.reference);
                            setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                          }}
                        >
                          Edit
                        </Button>
                        <ConfirmButton prompt="Remove?" confirmLabel="Remove" onConfirm={() => removeArea(a.reference)}>
                          Remove
                        </ConfirmButton>
                        <span className="ml-auto text-xs text-muted">{a.effective_from ? `From ${fmtDateTime(a.effective_from)}` : a.reference}</span>
                      </div>                    </li>
                  );
                })}
              </ul>
              <Button
                variant={adding ? "secondary" : "primary"}
                className="w-full"
                onClick={() => {
                  setEditing(null);
                  setAdding((x) => !x);
                  setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                }}
              >
                {adding ? (
                  "Close"
                ) : (
                  <>
                    <Icon name="plus" /> Add an area
                  </>
                )}
              </Button>
            </Card>

            <Card className="space-y-3 p-4 sm:p-6">
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <Icon name="bell" className="text-accent" /> Notifications
              </h2>
              <InfoButton label="How alerts work">
                <p>Each device you turn notifications on for (the yellow bar at the top) gets an alert when I enter or leave your Wish and Want areas.</p>
              </InfoButton>
              {view && (
                <div className="space-y-2 border-t border-hairline pt-3 text-sm">
                  <p className="font-semibold">While I&apos;m still there, remind me</p>
                  {(
                    [
                      ["want", "In a Want area (red)", view.reminder_minutes ?? 30],
                      ["location", "At a Location (purple)", view.reminder_location_minutes ?? 30],
                    ] as const
                  ).map(([kind, label, value]) => (
                    <label key={kind} className="flex flex-wrap items-center justify-between gap-2">
                      <span>{label}</span>
                      <select
                        className="h-10 rounded-lg border border-border bg-surface px-2"
                        value={value}
                        onChange={(e) => setReminders(kind, Number(e.target.value))}
                      >
                        <option value={10}>every 10 minutes</option>
                        <option value={20}>every 20 minutes</option>
                        <option value={30}>every 30 minutes</option>
                        <option value={60}>every hour</option>
                        <option value={0}>not at all</option>
                      </select>
                    </label>
                  ))}
                </div>
              )}
              {view && (
                <div className="space-y-2 border-t border-hairline pt-3">
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={view.sealed_alerts} onChange={(e) => setSealedAlerts(e.target.checked)} />
                    <span className="font-semibold">
                      Also alert me for my Locations{!hasSealed && <span className="font-normal text-muted"> (you have none yet)</span>}
                    </span>
                  </label>
                  <InfoButton>
                    <p>
                      Locations are locked to your link, so normally the site can only check them while this page is open. Ticking this lets
                      the site keep your key (encrypted) and check them as I move, so it can send alerts. Untick to lock them again.
                    </p>
                  </InfoButton>
                </div>
              )}
            </Card>

            <Card className="space-y-3 p-4 sm:p-6">
              <h2 className="text-xl font-bold">Keep your link</h2>
              <SaveWatchLink href={`/watch/${token}`} />
            </Card>

            <Card className="space-y-3 p-4 sm:p-6">
              <h2 className="text-xl font-bold">Keep this on your phone</h2>
              <InstallAppButton label="Install my watch view" />
            </Card>
          </div>
        </div>

        <div ref={formRef} className="scroll-mt-4">
          {savedNote && (
            <Notice tone="amber" title="Want area made bigger">
              {savedNote}{" "}
              <button type="button" className="font-semibold underline" onClick={() => setSavedNote(null)}>
                OK
              </button>
            </Notice>
          )}
          {editingArea && (
            <Card className="p-4 sm:p-6">
              <h2 className="mb-4 text-xl font-bold">Edit {editingArea.name || editingArea.reference}</h2>
              <GeofenceSubmitForm
                key={editingArea.reference}
                watchToken={token}
                editing={editingArea as EditableArea}
                context={context(editingArea.reference)}
                onCancel={() => setEditing(null)}
                onAdded={(message) => {
                  setSavedNote(message ?? null);
                  setEditing(null);
                  void load();
                  setJourneyTick((t) => t + 1);
                }}
              />
            </Card>
          )}
          {adding && !editingArea && (
            <Card className="p-4 sm:p-6">
              <h2 className="mb-4 text-xl font-bold">Add an area</h2>
              <GeofenceSubmitForm
                watchToken={token}
                context={context(null)}
                onCancel={() => setAdding(false)}
                onAdded={(message) => {
                  setSavedNote(message ?? null);
                  setAdding(false);
                  void load();
                  setJourneyTick((t) => t + 1);
                }}
              />
            </Card>
          )}
        </div>

        {visitsFor && <AreaVisits token={token} reference={visitsFor.reference} name={visitsFor.name} tier={visitsFor.tier} geojson={visitsFor.geojson ?? null} onClose={() => setVisitsFor(null)} />}

        <p className="text-xs text-muted">Keep this link private. Areas are not legal restrictions.</p>
      </Container>
    </div>
  );
}
