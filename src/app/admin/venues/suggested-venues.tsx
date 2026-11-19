"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Notice, Select } from "@/components/ui";
import { api } from "@/lib/client-api";
import { PLAN_CATEGORIES, categoryLabel } from "@/lib/plans";
import { fmtDate } from "@/lib/format";

export interface SuggestedVenue {
  id: string;
  name: string;
  category: string;
  address: string | null;
  public_area_label: string | null;
  metadata: {
    visit_count?: number;
    total_minutes?: number;
    last_visit?: string;
    match_distance_m?: number;
  } | null;
}

/**
 * Venues suggested automatically from recorded stays. Nothing here is public
 * until confirmed as a public venue.
 */
export function SuggestedVenues({ initial }: { initial: SuggestedVenue[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [edits, setEdits] = useState<Record<string, { name: string; category: string }>>({});
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!items.length) return null;

  async function review(v: SuggestedVenue, decision: "public" | "private" | "reject") {
    setBusy(v.id);
    setMsg(null);
    const e = edits[v.id];
    try {
      const r = await api<{ published_updated?: number }>(`/api/admin/venues/${v.id}/review`, {
        method: "POST",
        json: { decision, ...(e ? { name: e.name, category: e.category } : {}) },
      });
      setItems((xs) => xs.filter((x) => x.id !== v.id));
      setMsg({
        tone: "green",
        text:
          decision === "reject"
            ? `Removed "${v.name}".`
            : `${e?.name ?? v.name} confirmed as ${decision === "public" ? "a public venue" : "a private place"}${r.published_updated ? `; ${r.published_updated} published stay(s) updated` : ""}.`,
      });
      router.refresh();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Suggested venues ({items.length})</h2>
          <p className="text-sm text-muted">
            Found automatically from places you stayed, matched to OpenStreetMap. Home and residential addresses are never
            suggested. Nothing here is public until you choose <strong>Public venue</strong>.
          </p>
        </div>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <ul className="divide-y divide-border">
        {items.map((v) => {
          const e = edits[v.id] ?? { name: v.name, category: v.category };
          const m = v.metadata ?? {};
          return (
            <li key={v.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="Venue name"
                  value={e.name}
                  onChange={(ev) => setEdits({ ...edits, [v.id]: { ...e, name: ev.target.value } })}
                  className="max-w-xs"
                />
                <Select
                  aria-label="Category"
                  value={e.category}
                  onChange={(ev) => setEdits({ ...edits, [v.id]: { ...e, category: ev.target.value } })}
                  className="w-auto"
                >
                  {Object.entries(PLAN_CATEGORIES).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Badge tone="amber">Pending</Badge>
              </div>
              <p className="text-xs text-muted">
                {v.address ?? v.public_area_label ?? categoryLabel(v.category)}
                {m.visit_count != null && ` · ${m.visit_count} stay(s)`}
                {m.total_minutes != null && ` · ${Math.round(m.total_minutes / 60)} h in total`}
                {m.last_visit && ` · last ${fmtDate(m.last_visit)}`}
                {m.match_distance_m != null && ` · matched ${Math.round(m.match_distance_m)} m away`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy === v.id} onClick={() => review(v, "public")}>
                  Public venue (show name)
                </Button>
                <Button size="sm" variant="secondary" disabled={busy === v.id} onClick={() => review(v, "private")}>
                  Private place (area only)
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === v.id} onClick={() => review(v, "reject")}>
                  Not right, remove
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
