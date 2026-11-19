"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, Card, cn, Field, Input, Notice, Textarea } from "@/components/ui";
import { GeofenceDrawer, type DrawnShape } from "@/components/geofence-drawer";
import type { MapFeature } from "@/components/map-lazy";
import { loadWatchLinks, saveWatchLink } from "@/lib/watch-links";
import { SaveWatchLink } from "@/components/save-watch-link";
import { InfoButton } from "@/components/info-button";
import { Icon } from "@/components/design";
import { fmtSqMiles, TIER_META, TIER_RULES, type Tier, type WideMode } from "@/lib/geofence/tiers";
import { destination } from "@/lib/geo";

/** A drawn circle's centre is moved by this much, in the browser, before it's sent. */
const OFFSET_MIN_M = 25;
const OFFSET_MAX_M = 250;
const randomUnit = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const suggestOffset = () => OFFSET_MIN_M + Math.floor(randomUnit() * (OFFSET_MAX_M - OFFSET_MIN_M + 1));

/** An existing area being edited (from the watch view). */
export interface EditableArea {
  reference: string;
  tier: Tier;
  mode: WideMode | null;
  kind: "shape" | "beyond_home" | "location";
  name: string;
  note: string;
  shape: DrawnShape | null;
  distance_m: number | null;
}

/** One short line per kind, on its card. */
const TIER_HINT: Record<Tier, string> = {
  wide: "Somewhere you'd rather I didn't go. A big area.",
  local: "Somewhere you'd ask me not to go.",
  location: "A private warning: home, work. Only you see it.",
};
const STEPS = ["Kind of place", "Where", "Name and save"] as const;

const TIER_HELP: Record<Tier, string> = {
  wide: `At least a 7.5-mile radius, or a named town, city, county or larger (from ${fmtSqMiles(TIER_RULES.wideMinPlaceM2)}). Not inside another Wish area.`,
  local: `At least ${fmtSqMiles(TIER_RULES.localMinM2)} (a 1.5 km radius circle), whether drawn, a circle or a named place, so it never pinpoints one place. It can be on its own, inside a Wish area or across its edge. Not inside another Want area. A circle grows if needed so your Locations inside it are at least 250 m from its edge.`,
  location: `Any size, from a single building (25 m) to a 50-mile radius. I'm never shown it. Not inside another Location.`,
};

/**
 * Add a watch area (and get a private watch link), or change one. Used on
 * /geofences/submit (first area), and on a watch page to add (`watchToken`)
 * or edit (`editing`) areas.
 */
export function GeofenceSubmitForm({
  watchToken,
  onAdded,
  editing,
  onCancel,
  context,
}: {
  watchToken?: string;
  onAdded?: (message?: string | null) => void;
  editing?: EditableArea;
  onCancel?: () => void;
  /** The watcher's other areas, drawn faintly for reference. */
  context?: MapFeature[];
} = {}) {
  const [startedAt] = useState(() => Date.now());
  const [tier, setTier] = useState<Tier>(editing?.tier ?? "wide");
  const [mode, setMode] = useState<WideMode>(editing?.mode ?? "inside");
  const [shape, setShape] = useState<DrawnShape | null>(
    editing ? (editing.kind === "beyond_home" ? { type: "beyond_home", distance_m: editing.distance_m ?? 3219 } : editing.shape) : null,
  );
  const [busy, setBusy] = useState(false);
  // Three steps: what kind, where, then name and save (editing starts on "where").
  const [step, setStep] = useState(editing ? 2 : 1);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [useExisting, setUseExisting] = useState(true);
  const [done, setDone] = useState<{ reference: string; token: string } | null>(null);
  // The centre offset: suggested at random, the watcher can change it. Never sent.
  const [offset, setOffset] = useState(() => String(suggestOffset()));
  // A new or moved circle gets the offset; a circle whose centre hasn't changed was offset already.
  const oldCentre = editing?.shape?.type === "circle" ? editing.shape.center : null;
  const needsOffset = shape?.type === "circle" && !(oldCentre && oldCentre.lat === shape.center.lat && oldCentre.lng === shape.center.lng);

  // On its own page, show the areas already on this device's watch link for reference.
  const [savedAreas, setSavedAreas] = useState<MapFeature[]>([]);
  useEffect(() => {
    if (context || !existing || !useExisting) return;
    let live = true;
    fetch(`/api/watch/${existing}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: { areas?: { tier: Tier; name: string; geojson: MapFeature["geometry"] | null }[] } | null) => {
        if (!live || !v?.areas) return;
        setSavedAreas(
          v.areas.flatMap((a) =>
            a.geojson ? [{ type: "Feature" as const, geometry: a.geojson, properties: { color: TIER_META[a.tier].color, opacity: 0.12, label: `Your ${TIER_META[a.tier].label} area${a.name ? `: ${a.name}` : ""}` } }] : [],
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [context, existing, useExisting]);

  useEffect(() => {
    // Offer to add to the watch link already saved on this device.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!watchToken) setExisting(loadWatchLinks()[0]?.token ?? null);
  }, [watchToken]);

  function chooseTier(t: Tier) {
    if (t === tier) return;
    setTier(t);
    // A drawn shape can move between wide and local; a location can't.
    if (t === "location" || tier === "location" || shape?.type === "beyond_home") setShape(null);
  }

  function next() {
    setError(null);
    if (step === 2 && (!shape || (shape.type === "polygon" && shape.vertices.length < 3))) {
      setError(tier === "location" ? "Search for the place or tap the map first." : "Search for a place or draw an area on the map first.");
      return;
    }
    setStep((x) => Math.min(3, x + 1));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    // Enter on an earlier step moves on rather than saving.
    if (step < 3) return next();
    if (!shape || (shape.type === "polygon" && shape.vertices.length < 3)) {
      setError(tier === "location" ? "Search for the place or tap the map first." : "Search for a place or draw an area on the map first.");
      return;
    }
    let sendShape = shape;
    if (needsOffset && shape.type === "circle") {
      const m = Number(offset);
      if (!Number.isInteger(m) || m < OFFSET_MIN_M || m > OFFSET_MAX_M) {
        setError(`Choose how far to move the centre: a whole number from ${OFFSET_MIN_M} to ${OFFSET_MAX_M} metres.`);
        return;
      }
      // Moved here, in a random direction, so the exact point never leaves this device.
      sendShape = { ...shape, center: destination(shape.center, randomUnit() * 360, m) };
    }
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") || "");
    const note = String(f.get("note") || "");
    const token = watchToken ?? (existing && useExisting ? existing : undefined);
    setBusy(true);
    try {
      const res = editing
        ? await fetch(`/api/watch/${watchToken}/areas/${editing.reference}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tier, wide_mode: tier === "wide" ? mode : undefined, shape: sendShape, name, note }),
          })
        : await fetch("/api/geofences", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              tier,
              wide_mode: tier === "wide" ? mode : undefined,
              shape: sendShape,
              approximate_location: name,
              description: note,
              website: f.get("website") || "",
              form_started_at: startedAt,
              watch_token: token,
            }),
          });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.details?.[0]?.message ?? body.error ?? "Could not save the area");
        return;
      }
      if (editing) {
        onAdded?.(body.message);
        return;
      }
      const finalToken = (body.watch_token as string | null) ?? token!;
      saveWatchLink(finalToken);
      if (watchToken) {
        setShape(null);
        (e.target as HTMLFormElement).reset();
        onAdded?.(body.message);
        return;
      }
      setDone({ reference: body.reference, token: finalToken });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const url = `${window.location.origin}/watch/${done.token}`;
    return (
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Area saved ({done.reference})</h2>
        <p>This is your private watch link. It shows the marker coloured against your areas only:</p>
        <p className="break-all rounded bg-slate-100 p-3 font-mono text-sm">{url}</p>
        <h3 className="pt-1 font-semibold">Keep a copy somewhere safe</h3>
        <SaveWatchLink href={url} />
        <Link href={`/watch/${done.token}`} className="inline-flex h-11 items-center rounded-[var(--ft-radius-control)] border border-border bg-surface px-4 text-sm font-semibold hover:bg-sky">
          Open my watch page →
        </Link>
        <Notice tone="amber">
          Keep this link private: anyone who has it can see your view. This browser remembers it for you, but it isn&apos;t
          linked to your name, so if you lose it and clear this browser, it can&apos;t be recovered.
        </Notice>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2" aria-live="polite">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-bold">
            Step {step} of 3 · {STEPS[step - 1]}
          </span>
          {step > 1 && (
            <button type="button" onClick={() => setStep((x) => Math.max(1, x - 1))} className="font-semibold text-accent">
              Back
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">
          {STEPS.map((label, i) => (
            <span key={label} className={cn("h-1.5 rounded-full", i < step ? "bg-accent" : "bg-blue-100")} />
          ))}
        </div>
      </div>

      <Card className={cn("space-y-4", step !== 1 && "hidden")}>
        <fieldset className="space-y-2">
          <legend className="mb-2 font-semibold">What kind of place?</legend>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {(Object.keys(TIER_META) as Tier[]).map((t) => {
              const tone = { wide: { bg: "var(--amber-bg)", ink: "var(--amber-ink)" }, local: { bg: "var(--red-bg)", ink: "var(--red-ink)" }, location: { bg: "var(--purple-bg)", ink: "var(--purple-ink)" } }[t];
              return (
                <label
                  key={t}
                  className={cn("flex cursor-pointer gap-3 rounded-2xl border-2 p-4 text-sm transition", tier === t ? "shadow-[0_8px_24px_rgb(20_43_73/10%)]" : "border-transparent")}
                  style={{ background: tone.bg, color: tone.ink, borderColor: tier === t ? TIER_META[t].color : "transparent" }}
                >
                  <input type="radio" name="tier" className="sr-only" checked={tier === t} onChange={() => chooseTier(t)} />
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-white" style={{ background: TIER_META[t].color }} aria-hidden="true">
                    {tier === t && <span className="h-2 w-2 rounded-full bg-white" />}
                  </span>
                  <span>
                    <span className="block text-base font-bold text-ink">
                      {TIER_META[t].label} <span className="text-sm font-semibold" style={{ color: tone.ink }}>({t === "wide" ? "amber" : t === "local" ? "red" : "purple"})</span>
                    </span>
                    <span className="block">{TIER_HINT[t]}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <InfoButton label="Which should I choose?">
            {(Object.keys(TIER_META) as Tier[]).map((t) => (
              <p key={t}>
                <strong>{TIER_META[t].label}:</strong> {TIER_META[t].description} {TIER_HELP[t]}
              </p>
            ))}
          </InfoButton>
        </fieldset>

        {tier === "wide" && (
          <fieldset className="space-y-2">
            <legend className="mb-1 font-semibold">Which way round?</legend>
            {(
              [
                ["inside", "I'd rather you didn't go into this area", ""],
                ["outside", "I'd rather you didn't leave this area", ""],
              ] as const
            ).map(([m, label, hint]) => (
              <label key={m} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="wide-mode"
                  className="mt-1 h-4 w-4"
                  checked={mode === m}
                  onChange={() => {
                    setMode(m);
                    if (m === "inside" && shape?.type === "beyond_home") setShape(null);
                  }}
                />
                <span className="font-medium">
                  {label}
                  {hint}
                </span>
              </label>
            ))}
            <InfoButton>
              <p>
                <strong>Didn&apos;t go into</strong> (e.g. South Yorkshire): amber when I&apos;m inside it. <strong>Didn&apos;t
                leave</strong> (e.g. the UK, or within 2 miles of my home): amber when I&apos;m outside it.
              </p>
            </InfoButton>
          </fieldset>
        )}
      </Card>

      {step === 2 && (
      <Card>
        <GeofenceDrawer key={tier} value={shape} onChange={setShape} tier={tier} wideMode={mode} context={context ?? (useExisting ? savedAreas : undefined)} />
        {needsOffset && (
          <div className="mt-4 space-y-2 rounded-lg border border-border bg-sky/40 p-3">
            <Field label={`Move the centre by (metres, ${OFFSET_MIN_M} to ${OFFSET_MAX_M})`} htmlFor="centre-offset">
              <Input
                id="centre-offset"
                type="number"
                inputMode="numeric"
                min={OFFSET_MIN_M}
                max={OFFSET_MAX_M}
                step={1}
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
                className="max-w-32"
              />
            </Field>
            <p className="text-sm text-muted">Only you see this figure. It never leaves your device.</p>
            <InfoButton label="Why move the centre?">
              <p>
                A random suggestion; type over it if you like. When you save, the centre moves this far in a random direction, in your browser,
                before anything is sent. Nobody else, including me and the site, ever sees the exact point or the figure.
              </p>
            </InfoButton>
          </div>
        )}
      </Card>
      )}
      <Card className={cn("space-y-4", step !== 3 && "hidden")}>
        <Field label="Name for this area (optional, only you see it)" htmlFor="name">
          <Input id="name" name="name" maxLength={200} placeholder="e.g. My street" defaultValue={editing?.name} />
        </Field>
        <Field label="Note (optional)" htmlFor="note">
          <Textarea id="note" name="note" maxLength={1000} rows={2} defaultValue={editing?.note} />
        </Field>
        {!watchToken && existing && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={useExisting} onChange={(e) => setUseExisting(e.target.checked)} />
            <span>Add to the watch link already saved in this browser, so all my areas are in one view</span>
          </label>
        )}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="gf-website">Website</label>
          <input id="gf-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>
      </Card>
      {error && <Notice tone="red">{error}</Notice>}
      {editing && (
        <p className="text-sm text-muted">
          Renaming keeps this area as it is. Changing its shape, size or kind saves it as a <strong>new area from now</strong>, and
          this one ends at the same moment: both are kept in the dated record.
        </p>
      )}
      <div className="sticky bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-wrap gap-2 border-t border-hairline bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 lg:bottom-0">
        {step < 3 ? (
          <Button type="button" size="lg" className="flex-1 sm:flex-none" onClick={next}>
            Next <Icon name="chevron" className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="submit" size="lg" className="flex-1 sm:flex-none" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : watchToken ? "Add area" : "Save and get my watch link"}
          </Button>
        )}
        {onCancel && (
          <Button type="button" size="lg" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
