"use client";

import { useState, type FormEvent } from "react";
import { Button, cn, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { fmtDate } from "@/lib/format";
import { EVENT_COLOR, EVENT_LEVELS, type EventLevel } from "@/lib/events/rules";
import { ACTIVITY_LEVEL_META, OTHER_ACTIVITY, type ActivityInput, type ActivityOption, type ActivityView } from "@/lib/activities";
import { RESTRICTION_COLOR } from "@/components/restrictions";

/**
 * A list of activities. Mine (bans) are red; a watcher's are black with their
 * level. `onEnd` adds an End button to each one still in force.
 */
export function ActivityList({ items, onEnd, empty }: { items: ActivityView[]; onEnd?: (reference: string) => void; empty?: string }) {
  if (!items.length) return empty ? <p className="text-sm text-muted">{empty}</p> : null;
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li
          key={a.reference}
          className={cn("rounded-xl border border-l-4 border-border bg-white p-3", a.status === "ended" && "opacity-70")}
          style={{ borderLeftColor: a.is_owner ? RESTRICTION_COLOR : EVENT_COLOR }}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold">{a.label}</p>
              {a.details && <p className="whitespace-pre-line text-sm text-muted">{a.details}</p>}
              <p className="mt-1 text-xs text-muted">
                {a.level && <span className="font-semibold text-ink">{ACTIVITY_LEVEL_META[a.level].label} · </span>}
                Since {fmtDate(a.created_at)}
                {a.ended_at && ` · ended ${fmtDate(a.ended_at)}`}
              </p>
            </div>
            {onEnd && a.status === "active" && (
              <ConfirmButton size="sm" variant="secondary" confirmLabel="Yes, end it" onConfirm={() => onEnd(a.reference)}>
                End
              </ConfirmButton>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Add an activity: one from the list, or "Something else" written out.
 * `withLevel`: a watcher's (Wish, Want or Demand). `submit` returns an error message or null.
 */
export function ActivityForm({
  options,
  withLevel,
  submitLabel,
  submit,
}: {
  options: ActivityOption[];
  withLevel: boolean;
  submitLabel: string;
  submit: (input: ActivityInput) => Promise<string | null>;
}) {
  const [choice, setChoice] = useState(options[0]?.key ?? OTHER_ACTIVITY);
  const [other, setOther] = useState("");
  const [details, setDetails] = useState("");
  const [level, setLevel] = useState<EventLevel>("want");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (choice === OTHER_ACTIVITY && !other.trim()) return setError("Write the activity.");
    setBusy(true);
    const err = await submit({
      choice,
      other: choice === OTHER_ACTIVITY ? other.trim() : undefined,
      details: details.trim() || undefined,
      level: withLevel ? level : undefined,
    }).catch(() => "Could not save. Please try again.");
    setBusy(false);
    if (err) return setError(err);
    setOther("");
    setDetails("");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Activity" htmlFor="activity-choice">
        <Select id="activity-choice" value={choice} onChange={(e) => setChoice(e.target.value)}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
          <option value={OTHER_ACTIVITY}>Something else (write it)</option>
        </Select>
      </Field>
      {choice === OTHER_ACTIVITY && (
        <Field label="The activity" htmlFor="activity-other">
          <Input id="activity-other" value={other} maxLength={120} onChange={(e) => setOther(e.target.value)} placeholder="In a few words" />
        </Field>
      )}
      <Field label="Details (optional)" htmlFor="activity-details">
        <Textarea id="activity-details" value={details} maxLength={1000} rows={3} onChange={(e) => setDetails(e.target.value)} />
      </Field>
      {withLevel && (
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="How strongly">
          {EVENT_LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={level === l}
              onClick={() => setLevel(l)}
              className={cn("rounded-xl border p-3 text-left", level === l ? "border-neutral-900 bg-neutral-900 text-white" : "border-border bg-white hover:bg-sky")}
            >
              <span className="block font-semibold">{ACTIVITY_LEVEL_META[l].label}</span>
              <span className={cn("block text-sm", level === l ? "text-white/85" : "text-muted")}>{ACTIVITY_LEVEL_META[l].description}</span>
            </button>
          ))}
        </div>
      )}
      {error && <Notice tone="red">{error}</Notice>}
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
