// The wording of watcher alerts: the same text in the push notification and in
// the popup on the site. Pure (used by the server and the browser).

export type AlertEvent = "enter" | "exit" | "still";

export interface AlertInput {
  /** e.g. "Dave Keighley" / "Dave". */
  ownerName: string;
  ownerFirst: string;
  event: AlertEvent;
  tier: string | null;
  /** A "rather I didn't leave" Wish area: entering it means leaving the place. */
  outside: boolean;
  /** The watcher's own name for the area, if any. */
  areaName: string | null;
  reference: string;
  /** When they arrived (for "still there"). */
  since?: string | null;
  /** From the public sample, not the person's own watch list. */
  sample: boolean;
}

const KIND: Record<string, string> = { wide: "Wish", local: "Want", location: "Location" };
const ukTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

export function alertText(a: AlertInput): { title: string; body: string } {
  const kind = KIND[a.tier ?? "wide"] ?? "Wish";
  const place = a.areaName ? `“${a.areaName}”` : a.reference;
  const who = a.ownerFirst;
  // For "rather I didn't leave" Wish areas the meaning is reversed.
  const leftPlace = a.outside ? a.event === "enter" : a.event === "exit";
  const status =
    a.event === "still"
      ? `${who} is still in a place ${a.sample ? "the sample" : "you"} marked as ${kind}, named ${place}${a.since ? ` (there since ${ukTime(a.since)})` : ""}`
      : leftPlace
        ? `${who} may have left a place ${a.sample ? "the sample" : "you"} marked as ${kind}, named ${place}`
        : `${who} may be in a place ${a.sample ? "the sample" : "you"} marked as ${kind}, named ${place}`;
  const short =
    a.event === "still" ? `${who} is still in ${a.sample ? "the sample's" : "your"} ${kind}: ${a.areaName ?? a.reference}` : leftPlace ? `${who} may have left ${a.sample ? "the sample's" : "your"} ${kind}: ${a.areaName ?? a.reference}` : `${who} may be in ${a.sample ? "the sample's" : "your"} ${kind}: ${a.areaName ?? a.reference}`;
  if (a.sample) {
    return {
      title: `SAMPLE ALERT, not your watch list. ${short}`,
      body:
        `THIS IS FROM THE PUBLIC SAMPLE, NOT YOUR OWN WATCH LIST. You turned on sample alerts on Full Transparency to see how alerts work. ` +
        `Our records indicate ${status}. Turn sample alerts off any time from the notification or the sample page.`,
    };
  }
  return {
    title: short,
    body:
      `You are receiving this because you asked to be notified of ${a.ownerName}'s movements through the Full Transparency app. ` +
      `Our records indicate ${status}. We will continue to send updates on the schedule you set. For more details, open the site.`,
  };
}
