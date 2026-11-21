"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { AddressSearch } from "@/components/address-search";
import { LazyMap, type MapFeature } from "@/components/map-lazy";
import { Button, Card, cn, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { SaveWatchLink } from "@/components/save-watch-link";
import { venueGeometry } from "@/components/event-card";
import { loadWatchLinks, saveWatchLink } from "@/lib/watch-links";
import type { AreaGeometry } from "@/lib/geofence/area-geometry";
import { EVENT_COLOR, EVENT_LEVEL_META, EVENT_LEVELS, EVENT_RULES, VENUE_RADII, type EventLevel } from "@/lib/events/rules";
import { draftToPayload, draftWindow, newRepeat, RepeatPicker, type RepeatDraft } from "./repeat-picker";

type PlaceDraft =
  | { kind: "venue"; name: string; center: { lat: number; lng: number }; radius_m: number }
  | { kind: "place"; name: string; geojson: AreaGeometry };

const geometryOf = (p: PlaceDraft): AreaGeometry => (p.kind === "venue" ? venueGeometry(p.center, p.radius_m) : p.geojson);

/** The earliest start allowed (48 hours from now), as a datetime-local value. */
function localValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Set an event: somewhere you'd rather I wasn't, for that time only.
 * Optionally on a watch link already saved in this browser.
 */
export function EventForm({
  watchToken,
  onAdded,
  owner = false,
}: {
  watchToken?: string;
  onAdded?: () => void;
  /** Admin: one of my own bans (public, no level, no notice, no watch link). */
  owner?: boolean;
} = {}) {
  const [startedAt] = useState(() => Date.now());
  const [level, setLevel] = useState<EventLevel>("want");
  const [places, setPlaces] = useState<PlaceDraft[]>([]);
  const [radius, setRadius] = useState(VENUE_RADII[2].m);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [useExisting, setUseExisting] = useState(true);
  const [done, setDone] = useState<{ reference: string; token: string; homeNote: string | null } | null>(null);
  const [minStart, setMinStart] = useState("");
  const [repeat, setRepeat] = useState<RepeatDraft | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!owner) setMinStart(localValue(Date.now() + EVENT_RULES.minNoticeMs + 5 * 60_000));
    if (!watchToken && !owner) setExisting(loadWatchLinks()[0]?.token ?? null);
  }, [watchToken, owner]);

  const features = useMemo<MapFeature[]>(
    () =>
      places.map((p) => ({
        type: "Feature" as const,
        geometry: geometryOf(p),
        properties: { color: EVENT_COLOR, opacity: 0.3, label: p.name },
      })),
    [places],
  );

  function setVenueRadius(i: number, m: number) {
    setRadius(m);
    setPlaces((ps) => ps.map((p, j) => (j === i && p.kind === "venue" ? { ...p, radius_m: m } : p)));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Only the Save button saves (Enter in the place search mustn't).
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    if (submitter?.dataset.save !== "1") return;
    setError(null);
    const f = new FormData(e.currentTarget);
    if (!places.length) return setError("Add at least one place.");
    let when: Record<string, unknown>;
    if (repeat) {
      const w = draftWindow(repeat);
      if (typeof w === "string") return setError(w);
      if (!owner && w.startsAt < Date.now() + EVENT_RULES.minNoticeMs) return setError("The first time must be at least 48 hours from now.");
      when = { recurrence: draftToPayload(repeat) };
    } else {
      const starts = String(f.get("starts_at") || "");
      const ends = String(f.get("ends_at") || "");
      if (!starts || !ends) return setError("Choose when the event starts and ends.");
      const startsAt = new Date(starts);
      const endsAt = new Date(ends);
      if (endsAt <= startsAt) return setError("The event must end after it starts.");
      if (!owner && startsAt.getTime() < Date.now() + EVENT_RULES.minNoticeMs) return setError("An event must be set at least 48 hours before it starts.");
      when = { starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() };
    }
    const token = watchToken ?? (existing && useExisting ? existing : null);
    setBusy(true);
    if (owner) {
      try {
        const res = await fetch("/api/admin/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: f.get("title"), details: f.get("details") || null, ...when, places }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return setError(body.details?.[0]?.message ?? body.error ?? "Could not save the event");
        setPlaces([]);
        setRepeat(null);
        (e.target as HTMLFormElement).reset();
        onAdded?.();
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const res = await fetch("/api/watch-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          watch_token: token,
          title: f.get("title"),
          details: f.get("details") || null,
          level,
          ...when,
          places,
          form_started_at: startedAt,
          website: f.get("website") || "",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.details?.[0]?.message ?? body.error ?? "Could not save the event");
        return;
      }
      const finalToken = (body.watch_token as string | null) ?? token!;
      saveWatchLink(finalToken);
      if (watchToken) {
        setPlaces([]);
        (e.target as HTMLFormElement).reset();
        onAdded?.();
      }
      setDone({ reference: body.reference, token: finalToken, homeNote: body.home_note ?? null });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const url = typeof window === "undefined" ? `/watch/${done.token}` : `${window.location.origin}/watch/${done.token}`;
    return (
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Event saved ({done.reference})</h2>
        <p>I&apos;m told about it now. It shows in black on your watch page, and counts only while it&apos;s on.</p>
        {done.homeNote && <Notice tone="blue" title="It includes my home">{done.homeNote}</Notice>}
        {!watchToken && (
          <>
            <p>Your private watch link:</p>
            <p className="break-all rounded bg-slate-100 p-3 font-mono text-sm">{url}</p>
            <SaveWatchLink href={url} />
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href={`/watch/${done.token}`} className="inline-flex h-11 items-center rounded-[var(--ft-radius-control)] border border-border bg-surface px-4 text-sm font-semibold hover:bg-sky">
            Open my watch page →
          </Link>
          <Button variant="secondary" onClick={() => setDone(null)}>
            Add another event
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && <Notice tone="red">{error}</Notice>}

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">The event</h2>
        <Field label="Name of the event" htmlFor="ev-title">
          <Input id="ev-title" name="title" required maxLength={120} placeholder="e.g. Saturday concert" />
        </Field>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How often">
          <button
            type="button"
            role="radio"
            aria-checked={!repeat}
            onClick={() => setRepeat(null)}
            className={cn("h-10 rounded-xl border px-4 text-sm font-semibold", !repeat ? "border-neutral-900 bg-neutral-900 text-white" : "border-border bg-white hover:bg-sky")}
          >
            Once
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={Boolean(repeat)}
            onClick={() => setRepeat((r) => r ?? newRepeat())}
            className={cn("h-10 rounded-xl border px-4 text-sm font-semibold", repeat ? "border-neutral-900 bg-neutral-900 text-white" : "border-border bg-white hover:bg-sky")}
          >
            Repeats
          </button>
        </div>
        {!repeat ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts" htmlFor="ev-start" hint="At least 48 hours from now.">
              <Input id="ev-start" name="starts_at" type="datetime-local" required min={minStart} />
            </Field>
            <Field label="Ends" htmlFor="ev-end">
              <Input id="ev-end" name="ends_at" type="datetime-local" required min={minStart} />
            </Field>
          </div>
        ) : (
          <RepeatPicker value={repeat} onChange={setRepeat} minDate={minStart.slice(0, 10)} />
        )}
        <Field label="Details (optional)" htmlFor="ev-details">
          <Textarea id="ev-details" name="details" maxLength={2000} rows={3} />
        </Field>
      </Card>

      {!owner && (
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">How strongly?</h2>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Level">
          {EVENT_LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={level === l}
              onClick={() => setLevel(l)}
              className={cn(
                "rounded-xl border p-3 text-left",
                level === l ? "border-neutral-900 bg-neutral-900 text-white" : "border-border bg-white hover:bg-sky",
              )}
            >
              <span className="block font-semibold">{EVENT_LEVEL_META[l].label}</span>
              <span className={cn("block text-sm", level === l ? "text-white/85" : "text-muted")}>{EVENT_LEVEL_META[l].description}</span>
            </button>
          ))}
        </div>
      </Card>
      )}

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Where</h2>
        <p className="text-sm text-muted">A venue (with a distance around it), or a town or city. Add more than one if the event moves around.</p>
        {places.length < EVENT_RULES.maxPlaces && (
          <AddressSearch
            id="event-place"
            label="Find a venue, town or city"
            placeholder="e.g. a venue name, a postcode, or a town"
            onSelect={(r) => {
              setError(null);
              if (r.boundary) setPlaces((ps) => [...ps, { kind: "place", name: r.name, geojson: r.boundary as AreaGeometry }]);
              else setPlaces((ps) => [...ps, { kind: "venue", name: r.name, center: { lat: r.lat, lng: r.lng }, radius_m: radius }]);
            }}
          />
        )}
        {places.length > 0 && (
          <ul className="space-y-2">
            {places.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-sm">
                <span className="font-semibold">{p.name}</span>
                <span className="text-muted">{p.kind === "place" ? "Town or city" : "Venue"}</span>
                {p.kind === "venue" && (
                  <Select aria-label={`Distance around ${p.name}`} className="w-auto" value={p.radius_m} onChange={(e) => setVenueRadius(i, Number(e.target.value))}>
                    {VENUE_RADII.map((o) => (
                      <option key={o.m} value={o.m}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                )}
                <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => setPlaces((ps) => ps.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <LazyMap features={features} fit className="h-72 w-full rounded-lg" ariaLabel="Event places" />
      </Card>

      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

      {!watchToken && !owner && existing && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={useExisting} onChange={(e) => setUseExisting(e.target.checked)} />
          <span>Add it to the watch link saved in this browser</span>
        </label>
      )}
      <p className="text-sm text-muted">
        {owner
          ? "Shown to everyone, in red, like plans. While you're in it, everyone sees red."
          : "I'll see the event, its places and times. Nobody else will. It's a wish, not a legal order."}
      </p>
      <Button type="submit" data-save="1" disabled={busy}>
        {busy ? "Saving…" : owner ? "Save ban" : "Save event"}
      </Button>
    </form>
  );
}
