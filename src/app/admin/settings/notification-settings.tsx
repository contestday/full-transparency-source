"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input, Notice } from "@/components/ui";
import { api } from "@/lib/client-api";
import { fmtDateTime } from "@/lib/format";

interface Sub {
  id: string;
  channel: string;
  endpoint: string;
  enabled: boolean;
  created_at: string;
}
interface Delivery {
  id: string;
  event_type: string;
  title: string;
  status: string;
  error: string | null;
  created_at: string;
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function NotificationSettings({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [msg, setMsg] = useState<{ tone: "green" | "red" | "amber"; text: string } | null>(null);
  const [email, setEmail] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ subscriptions: Sub[]; deliveries: Delivery[] }>("/api/admin/notifications/subscribe");
      setSubs(r.subscriptions);
      setDeliveries(r.deliveries ?? []);
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Load failed" });
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function enablePush() {
    setMsg(null);
    if (!vapidPublicKey) return setMsg({ tone: "amber", text: "VAPID keys are not configured on the server." });
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return setMsg({ tone: "amber", text: "This browser does not support Web Push. On iPhone, add the site to the Home Screen first." });
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setMsg({ tone: "amber", text: "Notification permission was not granted." });
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
      const json = sub.toJSON();
      await api("/api/admin/notifications/subscribe", { method: "POST", json: { channel: "web_push", endpoint: json.endpoint, keys: json.keys } });
      setMsg({ tone: "green", text: "Push notifications enabled on this device." });
      await load();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Could not enable push" });
    }
  }

  async function addEmail() {
    try {
      await api("/api/admin/notifications/subscribe", { method: "POST", json: { channel: "email", endpoint: email } });
      setEmail("");
      await load();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Could not add email" });
    }
  }

  async function test() {
    try {
      const r = await api<{ sent: number; failed: number }>("/api/admin/notifications/test", { method: "POST" });
      setMsg({ tone: r.sent ? "green" : "amber", text: `Test sent to ${r.sent} subscription(s), ${r.failed} failed/skipped.` });
      await load();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : "Test failed" });
    }
  }

  async function remove(id: string) {
    await api(`/api/admin/notifications/subscribe?id=${id}`, { method: "DELETE" }).catch(() => {});
    await load();
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold">Private notifications</h2>
      <p className="text-sm text-muted">
        Alerts for new submissions, geofence entry and exit, new reports, and ingestion, import or publication
        failures. Alerts never contain coordinates.
      </p>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={enablePush}>Enable push on this device</Button>
        <Button variant="secondary" onClick={test}>
          Send test notification
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="email" placeholder="Fallback email address" value={email} onChange={(e) => setEmail(e.target.value)} className="w-64" />
        <Button variant="secondary" disabled={!email} onClick={addEmail}>
          Add email
        </Button>
      </div>
      <ul className="divide-y divide-border text-sm">
        {subs.map((s) => (
          <li key={s.id} className="flex items-center justify-between py-1.5">
            <span>
              <Badge tone={s.enabled ? "green" : "neutral"}>{s.channel}</Badge> {s.endpoint}
            </span>
            <Button size="sm" variant="ghost" onClick={() => remove(s.id)}>
              Remove
            </Button>
          </li>
        ))}
        {!subs.length && <li className="py-1.5 text-muted">No subscriptions. You will not receive alerts.</li>}
      </ul>
      {deliveries.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">Recent deliveries</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {deliveries.map((d) => (
              <li key={d.id}>
                <Badge tone={d.status === "sent" ? "green" : d.status === "failed" ? "red" : "neutral"}>{d.status}</Badge> {fmtDateTime(d.created_at)} · {d.title}
                {d.error ? ` · ${d.error}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
