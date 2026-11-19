"use client";

import { useEffect, useMemo, useState } from "react";
import { Overlay } from "@/components/overlay";
import { Button, Notice } from "@/components/ui";
import { coverageSections, durationText, flaggedPeriods, periodMeaning, sectionIndex, type Coverage, type EvidenceEvent, type EvidencePeriod, type Section } from "@/lib/area-visits";
import { quickRanges } from "@/lib/history-range";
import { fmtDateTime, fmtTime, londonDayKey } from "@/lib/format";
import { TIER_META, type Tier } from "@/lib/geofence/tiers";
import { useNow } from "@/lib/use-now";

/**
 * The evidence log (a dated, printable list of these times) is built but not
 * launched yet: set true to offer "Download evidence log (PDF)".
 */
export const EVIDENCE_LOG_ENABLED = false;

interface Visits {
  generated_at: string;
  from: string;
  to: string;
  owner_name: string;
  area: { reference: string; tier: Tier; outside: boolean; name: string; effective_from: string };
  coverage: Coverage[];
  events: EvidenceEvent[];
  inside_now: boolean;
  stays: { name: string; from: string; until: string | null }[];
}

const sameDayTime = (from: string, until: string | null) =>
  until ? (londonDayKey(from) === londonDayKey(until) ? `${fmtDateTime(from)} – ${fmtTime(until)}` : `${fmtDateTime(from)} – ${fmtDateTime(until)}`) : fmtDateTime(from);

/** Every time I entered, left or stayed in one of the watcher's areas, for a chosen period. */
export function AreaVisits({ token, reference, name, tier, onClose }: { token: string; reference: string; name: string; tier: Tier; onClose: () => void }) {
  const now = useNow();
  const today = now ? londonDayKey(new Date(now).toISOString()) : null;
  const [rangeKey, setRangeKey] = useState("all");
  const [data, setData] = useState<Visits | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!today) return;
    const r = quickRanges(today).find((x) => x.key === rangeKey);
    if (!r) return;
    let cancelled = false;
    fetch(`/api/watch/${token}/areas/${encodeURIComponent(reference)}/visits?from=${r.from}&to=${r.to}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((d: Visits) => {
        if (cancelled) return;
        setData(d);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [token, reference, rangeKey, today]);

  const meaning = periodMeaning(tier, data?.area.outside ?? false);
  // Periods in the area, newest first. An exit with no entry in the period: already there when it began.
  const periods = useMemo(() => (data ? flaggedPeriods(data.events, data.inside_now).reverse() : []), [data]);
  // The summary counts only times while the place was watched.
  const watched = useMemo(() => {
    if (!data) return [];
    const sections = coverageSections(data.coverage);
    return periods.filter((p) => ["since", "watched"].includes(sections[sectionIndex(sections, p.from ?? p.until ?? data.generated_at)].kind));
  }, [data, periods]);
  const total = useMemo(() => watched.reduce((ms, p) => ms + (p.from ? (p.until ? Date.parse(p.until) : now) - Date.parse(p.from) : 0), 0), [watched, now]);
  const label = name || TIER_META[tier].label;
  const color = TIER_META[tier].color;

  // Everything in one list (entries/exits and stays), split by whether the place was being watched then.
  type Item = { at: string; period?: EvidencePeriod; stay?: Visits["stays"][number] };
  const grouped = useMemo(() => {
    if (!data) return [];
    const sections = coverageSections(data.coverage);
    const items: Item[] = [
      ...periods.map((p) => ({ at: p.from ?? p.until ?? data.generated_at, period: p })),
      ...data.stays.map((st) => ({ at: st.from, stay: st })),
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const buckets = sections.map((sec) => ({ sec, items: [] as Item[] }));
    for (const it of items) buckets[sectionIndex(sections, it.at)].items.push(it);
    // Always show the current watched stretch; others only when something happened in them.
    return buckets.filter((b) => b.items.length || b.sec.kind === "since");
  }, [data, periods]);

  const heading = (sec: Section) => {
    const range = (a: string | null, b: string | null) => `${a ? fmtDateTime(a) : "the start"} to ${b ? fmtDateTime(b) : "now"}`;
    if (sec.kind === "since") return { text: `Since geofenced · from ${fmtDateTime(sec.from)}`, color };
    if (sec.kind === "watched") return { text: `Geofenced · ${range(sec.from, sec.until)}`, color };
    if (sec.kind === "gap") return { text: `Not tracked: geofence paused or removed · ${range(sec.from, sec.until)}`, color: "#64748B" };
    return { text: sec.until ? `Prior to geofence · before ${fmtDateTime(sec.until)}` : "Prior to geofence", color: "#64748B" };
  };

  return (
    <Overlay title={`Times in “${label}”`} onClose={onClose} wide id="area-visits">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 print:hidden" role="group" aria-label="Which period">
          {(today ? quickRanges(today) : []).map((r) => (
            <Button
              key={r.key}
              type="button"
              size="sm"
              variant={rangeKey === r.key ? "primary" : "secondary"}
              aria-pressed={rangeKey === r.key}
              onClick={() => {
                setState("loading");
                setRangeKey(r.key);
              }}
            >
              {r.label}
            </Button>
          ))}
        </div>

        {state === "error" && <Notice tone="red">These times could not be loaded. Please try again.</Notice>}
        {state === "loading" && <p className="text-sm text-muted">Loading…</p>}
        {state === "ready" && data && (
          <div id="evidence-log" className="space-y-4">
            <div className="hidden print:block">
              <h1 className="text-xl font-bold">Evidence log</h1>
              <p className="text-sm">
                Area {data.area.reference} ({TIER_META[tier].label}
                {label !== TIER_META[tier].label ? `, “${label}”` : ""}), in effect from {fmtDateTime(data.area.effective_from)}. Prepared{" "}
                {fmtDateTime(data.generated_at)} with Full Transparency (full-transparency.vercel.app).
              </p>
            </div>

            <p className="text-sm">
              While geofenced: <strong>{watched.length}</strong> {watched.length === 1 ? "time" : "times"} recorded as “{meaning.state.toLowerCase()}”
              {total > 0 ? `, ${durationText(new Date(0).toISOString(), new Date(total).toISOString(), 0)} in all` : ""}.
              {data.inside_now && " In it now."}
            </p>

            {grouped.map(({ sec, items }) => {
              const h = heading(sec);
              return (
                <section key={`${sec.kind}-${sec.from}`} className="space-y-1">
                  <h3 className="border-l-4 pl-2 text-sm font-bold" style={{ borderColor: h.color, color: h.color }}>
                    {h.text}
                  </h3>
                  {items.length === 0 ? (
                    <p className="pl-3 text-sm text-muted">Nothing recorded in this period.</p>
                  ) : (
                    <ol className="divide-y divide-hairline rounded-xl border border-hairline">
                      {items.map((it, i) => (
                        <li key={`${it.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm">
                          {it.period ? (
                            <>
                              <span>
                                <span className="font-semibold">{meaning.started}</span> {it.period.from ? fmtDateTime(it.period.from) : "(before this period)"}
                                {" · "}
                                {it.period.until ? (
                                  <>
                                    <span className="font-semibold">{meaning.ended}</span>{" "}
                                    {it.period.from && londonDayKey(it.period.from) === londonDayKey(it.period.until) ? fmtTime(it.period.until) : fmtDateTime(it.period.until)}
                                  </>
                                ) : it.period.ongoing ? (
                                  <strong>still there</strong>
                                ) : (
                                  "no exit recorded"
                                )}
                              </span>
                              <span className="tabular-nums text-muted">{it.period.from ? durationText(it.period.from, it.period.until, now) : ""}</span>
                            </>
                          ) : it.stay ? (
                            <>
                              <span className="[overflow-wrap:anywhere]">
                                <span className="font-semibold">Stayed</span> · {it.stay.name}
                              </span>
                              <span className="tabular-nums text-muted">{sameDayTime(it.stay.from, it.stay.until)}</span>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              );
            })}

            {data.events.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold">Every reading ({data.events.length})</summary>
                <ul className="mt-1 space-y-0.5 text-xs text-muted">
                  {data.events.map((e, i) => (
                    <li key={`${e.at}-${i}`} className="tabular-nums">
                      {fmtDateTime(e.at)} · {e.type === "enter" ? meaning.started : meaning.ended}
                      {e.accuracy_m != null ? ` · GPS ±${e.accuracy_m} m` : ""} · area {e.reference}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <p className="text-xs text-muted">
              Times are UK time, from GPS readings recorded automatically. They show what the phone reported, not who carried it. Facts only: not a finding
              about anything that happened.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-border bg-sky/40 p-3 text-sm print:hidden">
          <p className="font-semibold">Evidence log (PDF)</p>
          {EVIDENCE_LOG_ENABLED ? (
            <>
              <p className="text-muted">A dated, printable log of these times for this area and period, to keep or share.</p>
              <Button type="button" size="sm" className="mt-2" disabled={state !== "ready"} onClick={() => window.print()}>
                Download evidence log (PDF)
              </Button>
              <style>{`@media print{html,body{background:#fff!important}body *:not(:has(#evidence-log)):not(#evidence-log):not(#evidence-log *){display:none!important}body *:has(#evidence-log){position:static!important;overflow:visible!important;max-height:none!important;background:#fff!important;box-shadow:none!important;padding:0!important;border:0!important}}`}</style>
            </>
          ) : (
            <p className="text-muted">
              Available soon: you&apos;ll be able to download these times as a dated evidence log, ready to keep or share.
            </p>
          )}
        </div>
      </div>
    </Overlay>
  );
}
