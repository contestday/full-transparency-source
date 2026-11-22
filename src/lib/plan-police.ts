// Report a plan to the police: anyone who thinks one of my plans is illegal
// can send the police the plan's published facts with their concern, in
// their own words. The site never adds an allegation, a crime or a sanction:
// those are the reporter's own statement. They send it themselves.

import type { PublicPlan } from "@/lib/public-data";

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

/** The text a person sends to the police: the plan's published facts, then their concern. */
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
    "MY CONCERN (in my own words)",
    input.concern.trim(),
    "",
    "FROM",
    input.name?.trim() ? `Name: ${input.name.trim()}` : "Name: not given",
    input.contact?.trim() ? `Contact: ${input.contact.trim()}` : "Contact: not given",
  ];
  return lines.join("\n");
}

export function planStops(p: PublicPlan, privateLabel: string): string[] {
  return p.extra_locations.map((l) =>
    l.private_location ? privateLabel : (l.venue_name ?? (l.area_label ? `${l.area_label} (general area)` : "Location not published")),
  );
}
