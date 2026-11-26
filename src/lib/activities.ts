// Banned activities: things to do, not places to be. Pure: used by the server
// and the browser.
//   * Mine (is_owner): activities I'm banned from. Public, in red.
//   * A watcher's: an activity they'd rather I didn't do, as a Wish, Want or
//     Demand. Only they and I see it. None is a legal order.

import { z } from "zod";
import type { EventLevel } from "@/lib/events/rules";

/** One choice in the list (the list itself is kept in system_state, not in code). */
export interface ActivityOption {
  key: string;
  label: string;
}

/** The free-text choice. */
export const OTHER_ACTIVITY = "other";

export interface ActivityView {
  reference: string;
  label: string;
  details: string | null;
  level: EventLevel | null;
  is_owner: boolean;
  status: "active" | "ended";
  created_at: string;
  ended_at: string | null;
}

export const ACTIVITY_LEVEL_META: Record<EventLevel, { label: string; description: string }> = {
  wish: { label: "Wish", description: "You'd rather I didn't." },
  want: { label: "Want", description: "You're asking me not to." },
  demand: { label: "Demand", description: "You're firmly telling me not to. Still not a legal order." },
};

export const activityInputSchema = z.object({
  /** An option key, or "other" with `other` written out. */
  choice: z.string().trim().min(1).max(40),
  other: z.string().trim().max(120).optional(),
  details: z.string().trim().max(1000).optional(),
  level: z.enum(["wish", "want", "demand"]).optional(),
});
export type ActivityInput = z.infer<typeof activityInputSchema>;

/** The label to store for a choice, or an error message. */
export function resolveActivity(input: ActivityInput, options: ActivityOption[]): { key: string | null; label: string } | { error: string } {
  if (input.choice === OTHER_ACTIVITY) {
    const text = input.other?.trim();
    if (!text) return { error: "Write the activity." };
    return { key: null, label: text };
  }
  const o = options.find((x) => x.key === input.choice);
  if (!o) return { error: "Choose an activity from the list, or write your own." };
  return { key: o.key, label: o.label };
}
