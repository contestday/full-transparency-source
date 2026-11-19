// Times a person was recorded in one of a watcher's areas: entries, exits and
// the periods between them. Facts only (times from GPS readings), never the
// positions. Pure: used by the server and the browser.

export interface EvidenceEvent {
  type: "enter" | "exit";
  at: string;
  accuracy_m: number | null;
  /** The area reference the event was recorded against (an earlier drawing of the area keeps its own). */
  reference: string;
}

export interface EvidenceVersion {
  reference: string;
  effective_from: string;
  effective_until: string | null;
  recorded_at: string;
  replaces_reference: string | null;
}

export interface EvidencePeriod {
  /** When the person was recorded entering the flagged state. Null: already so when the record starts. */
  from: string | null;
  /** When they were recorded leaving it. Null: no exit recorded. */
  until: string | null;
  /** Still so at the time of the pack. */
  ongoing: boolean;
  reference: string;
}

/**
 * Times the area applied: inside it, or (for a "rather I didn't leave" Wish
 * area, whose stored shape is everywhere outside the place) away from the place.
 * Events must be oldest first.
 */
export function flaggedPeriods(events: EvidenceEvent[], insideNow: boolean): EvidencePeriod[] {
  const out: EvidencePeriod[] = [];
  let open: EvidencePeriod | null = null;
  for (const e of events) {
    if (e.type === "enter") {
      if (!open) open = { from: e.at, until: null, ongoing: false, reference: e.reference };
    } else if (open) {
      open.until = e.at;
      out.push(open);
      open = null;
    } else {
      // An exit with no recorded entry: they were already there when recording began.
      out.push({ from: null, until: e.at, ongoing: false, reference: e.reference });
    }
  }
  if (open) {
    open.ongoing = insideNow;
    out.push(open);
  }
  return out;
}

/** Keep periods that overlap [from, to]. */
export function periodsWithin(periods: EvidencePeriod[], from: string, to: string): EvidencePeriod[] {
  const f = Date.parse(from);
  const t = Date.parse(to);
  return periods.filter((p) => (p.from ? Date.parse(p.from) : -Infinity) <= t && (p.until ? Date.parse(p.until) : Infinity) >= f);
}

export function durationText(fromIso: string | null, untilIso: string | null, nowMs: number): string {
  if (!fromIso) return "";
  const ms = (untilIso ? Date.parse(untilIso) : nowMs) - Date.parse(fromIso);
  if (!(ms >= 0)) return "";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.floor(h / 24)} days ${h % 24} h`;
}

/** Plain words for what being in the area's stored shape means. */
export function periodMeaning(tier: string, outside: boolean): { state: string; started: string; ended: string } {
  if (tier === "wide" && outside) return { state: "Away from the place (outside the area)", started: "Left the area", ended: "Came back" };
  return { state: "Inside the area", started: "Entered", ended: "Left" };
}

/** A stretch of time when the place was watched (an area for it was in effect). */
export interface Coverage {
  from: string;
  /** Null: still in effect. */
  until: string | null;
}

/** Join coverage that overlaps or touches (a redraw ends one area as the next begins). Oldest first. */
export function mergeCoverage(list: Coverage[]): Coverage[] {
  const sorted = [...list].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  const out: Coverage[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    const lastEnd = last ? (last.until ? Date.parse(last.until) : Infinity) : -Infinity;
    if (last && Date.parse(c.from) <= lastEnd + 60_000) {
      if (last.until && (!c.until || Date.parse(c.until) > lastEnd)) last.until = c.until;
    } else out.push({ ...c });
  }
  return out;
}

export type SectionKind = "since" | "watched" | "gap" | "prior";
export interface Section {
  kind: SectionKind;
  /** Null: from the start of the record. */
  from: string | null;
  /** Null: up to now. */
  until: string | null;
}

/**
 * The list's sections, newest first: watched stretches ("since" for the one in
 * effect now), the gaps between them (removed or paused) and, last, everything
 * before the place was first watched.
 */
export function coverageSections(coverage: Coverage[]): Section[] {
  const c = mergeCoverage(coverage);
  if (!c.length) return [{ kind: "prior", from: null, until: null }];
  const out: Section[] = [{ kind: "prior", from: null, until: c[0].from }];
  c.forEach((x, i) => {
    out.push({ kind: x.until ? "watched" : "since", from: x.from, until: x.until });
    const next = c[i + 1];
    if (x.until) out.push({ kind: "gap", from: x.until, until: next?.from ?? null });
  });
  return out.reverse();
}

/** Which section a moment falls in. */
export function sectionIndex(sections: Section[], at: string): number {
  const t = Date.parse(at);
  const i = sections.findIndex((s) => (s.from == null || Date.parse(s.from) <= t) && (s.until == null || t < Date.parse(s.until)));
  return i < 0 ? sections.length - 1 : i;
}
