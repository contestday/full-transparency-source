"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@/components/design";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { REPORT_CATEGORIES } from "@/lib/reports";

const GUIDANCE: Partial<Record<keyof typeof REPORT_CATEGORIES, string>> = {
  question: "Ask anything about the site, my plans or how it works.",
  plans: "Which plan or date? You can mention a place in general terms.",
  inaccuracy: "Tell me what looks wrong and roughly when. I'll check it against the GPS record and correct it if needed.",
  watch: "Describe what isn't working. Please don't paste your watch link here, as it is private to you.",
  feedback: "Ideas to make the site clearer or more useful are welcome.",
  privacy: "If something shown here affects your privacy, let me know and I'll review it.",
};

/** A short private note to the site owner. Anonymous unless the sender adds contact details. */
export function ReportForm() {
  const [startedAt] = useState(() => Date.now());
  const [topic, setTopic] = useState<keyof typeof REPORT_CATEGORIES>("question");
  const [state, setState] = useState<{ kind: "idle" | "sending" } | { kind: "sent"; copy: string } | { kind: "error"; message: string }>({ kind: "idle" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = String(form.get("description") ?? "");
    form.set("form_started_at", String(startedAt));
    form.set("category", topic);
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/reports", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ kind: "error", message: body.details?.[0]?.message ?? body.error ?? "Could not send" });
        return;
      }
      setState({
        kind: "sent",
        copy: `My private note to Full Transparency${body.reference ? ` (reference ${body.reference})` : ""}, sent ${new Date().toLocaleString("en-GB")}:\n\nTopic: ${REPORT_CATEGORIES[topic]}\n\n${text}`,
      });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  if (state.kind === "sent") {
    return (
      <div className="space-y-4">
        <Notice tone="green">Thank you. Your note has been sent privately. If you left contact details, I&apos;ll reply when I can.</Notice>
        <KeepACopy text={state.copy} />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 [&_label]:text-[15px] [&_p]:text-[14px]" noValidate>
      <Field label="What is it about?" htmlFor="topic" hint={GUIDANCE[topic]}>
        <Select id="topic" className="h-12 sm:text-base!" value={topic} onChange={(e) => setTopic(e.target.value as keyof typeof REPORT_CATEGORIES)}>
          {Object.entries(REPORT_CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Your message" htmlFor="description">
        <Textarea id="description" name="description" required minLength={10} maxLength={5000} rows={6} className="sm:text-base!" />
      </Field>
      <Field label="Contact details (optional)" htmlFor="contact_info" hint="Only if you'd like a private reply.">
        <Input id="contact_info" name="contact_info" maxLength={300} autoComplete="off" className="h-12 sm:text-base!" />
      </Field>
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      {state.kind === "error" && <Notice tone="red">{state.message}</Notice>}
      <Button type="submit" size="lg" disabled={state.kind === "sending"}>
        {state.kind === "sending" ? "Sending…" : "Send"}
      </Button>
      <p className="text-sm text-muted">Only I can read it. Your IP address is not stored.</p>
    </form>
  );
}

/**
 * Keep a copy of the note: email it to yourself, send it to yourself on
 * WhatsApp, or share it. All on this device: nothing more is sent to the site.
 */
function KeepACopy({ text }: { text: string }) {
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanShare(typeof navigator.share === "function");
  }, []);
  const mailto = `mailto:?subject=${encodeURIComponent("My private note to Full Transparency")}&body=${encodeURIComponent(text)}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const btn = "inline-flex h-11 items-center gap-2 rounded-[var(--ft-radius-control)] px-4 text-sm font-semibold";
  return (
    <div className="space-y-2">
      <p className="font-semibold">Keep a copy for yourself</p>
      <div className="flex flex-wrap gap-2">
        <a href={mailto} className={`${btn} bg-accent text-white hover:bg-accent-hover`}>
          <Icon name="chat" className="h-4 w-4" /> Email it to myself
        </a>
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#1F8F4E] text-white hover:brightness-95`}>
          WhatsApp it to myself<span className="sr-only"> (opens WhatsApp)</span>
        </a>
        {canShare ? (
          <Button type="button" variant="secondary" onClick={() => navigator.share({ title: "My private note", text }).catch(() => {})}>
            Save or share…
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard?.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">These open your own email or WhatsApp with the note filled in. I never see your email address or number.</p>
    </div>
  );
}
