// Report a plan to the police: anyone who thinks one of my plans is illegal
// can send the police the plan's published facts with their concern, in
// their own words. The site never adds an allegation, a crime or a sanction:
// those are the reporter's own statement. They send it themselves.

import type { PublicPlan } from "@/lib/public-data";
import { fmtDate, fmtTime } from "@/lib/format";
import { PRIVATE_LOCATION_LABEL, STATUS_LABELS, categoryLabel, type PlanStatus } from "@/lib/plans";

export const PLAN_REPORT_RULES = {
  concernMin: 20,
  concernMax: 4000,
  nameMax: 120,
  contactMax: 200,
};

export interface PlanReportInput {
  concern: string;
  name?: string;
  contact?: string;
  /** Going to Crimestoppers: no name or contact in it. */
  anonymous?: boolean;
  /** Further published facts for a period (other plans, places visited), already as lines. */
  extra?: string[];
}

export interface PlanFacts {
  title: string;
  category: string;
  when: string;
  where: string;
  stops: string[];
  status: string;
  description: string | null;
  link: string;
}

/** The text a person sends to the police or Crimestoppers: the plan's published facts, then their concern. */
export function planReportText(facts: PlanFacts, input: PlanReportInput): string {
  const lines = [
    "Report about a published plan",
    "",
    "THE PLAN (as published on the Full Transparency site)",
    `Plan: ${facts.title}`,
    `Category: ${facts.category}`,
    `When: ${facts.when}`,
    `Where: ${facts.where}`,
    ...facts.stops.map((s, i) => `Stop ${i + 2}: ${s}`),
    `Status: ${facts.status}`,
    ...(facts.description ? [`Details: ${facts.description}`] : []),
    `Link: ${facts.link}`,
    "",
    ...(input.extra?.length ? [...input.extra, ""] : []),
    "MY CONCERN (in my own words)",
    input.concern.trim(),
    "",
    "FROM",
    ...(input.anonymous
      ? ["Anonymous (given to Crimestoppers)"]
      : [
          input.name?.trim() ? `Name: ${input.name.trim()}` : "Name: not given",
          input.contact?.trim() ? `Contact: ${input.contact.trim()}` : "Contact: not given",
        ]),
  ];
  return lines.join("\n");
}

export function planStops(p: PublicPlan, privateLabel: string): string[] {
  return p.extra_locations.map((l) =>
    l.private_location ? privateLabel : (l.venue_name ?? (l.area_label ? `${l.area_label} (general area)` : "Location not published")),
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

/** A published plan's facts, as they go in a report. */
export function planFactsOf(p: PublicPlan): PlanFacts {
  return {
    title: p.title,
    category: categoryLabel(p.category),
    when: planWhen(p),
    where: planWhere(p),
    stops: planStops(p, PRIVATE_LOCATION_LABEL),
    status: STATUS_LABELS[p.status as PlanStatus] ?? p.status,
    description: p.description,
    link: "/plans?past=1",
  };
}

/** One line per plan, for a list of plans in a date range. */
export function planLine(f: PlanFacts): string {
  const stops = f.stops.length ? `; then ${f.stops.join("; ")}` : "";
  return `${f.when} · ${f.title} (${f.category}) · ${f.where}${stops} · ${f.status}`;
}
