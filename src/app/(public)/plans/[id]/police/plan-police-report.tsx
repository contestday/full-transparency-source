"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Field, Input, Notice, Textarea } from "@/components/ui";
import { ReportDownloads } from "@/components/report-downloads";
import { api } from "@/lib/client-api";
import { CRIMESTOPPERS, type SendTo } from "@/lib/crimestoppers";
import { PLAN_REPORT_RULES, planReportText, type PlanFacts } from "@/lib/plan-police";
import { usePoliceWatchToken } from "@/lib/police-client";
import { SendToChoice } from "@/components/send-to-choice";
import { ReportPeriod } from "@/components/report-period";
import { periodLines, RANGE_PRESETS, readingsCsv, readingsFileBase, useRangeFacts, type PeriodChoice } from "@/lib/report-range";

interface Contact {
  label: string;
  tel: string;
  web: string | null;
}

const card = "rounded-[var(--ft-radius-card)] border border-border bg-surface p-5 sm:p-6";
const callBtn = "inline-flex h-12 items-center justify-center gap-2 rounded-[var(--ft-radius-control)] px-4 text-base font-bold";
const outlineBtn = `${callBtn} border border-border bg-white hover:bg-sky`;

/**
 * Report one of my plans, to the police or (anonymously) to Crimestoppers.
 * The plan's published facts are filled in; the concern is the reporter's own
 * words. They send it themselves: by email, by pasting it into an online
 * form, by phone, or as a file they download. I'm told a report was prepared
 * (with their concern, never their name or contact).
 */
export function PlanPoliceReport({ planId, facts, contact }: { planId: string; facts: PlanFacts; contact: Contact | null }) {
  const token = usePoliceWatchToken();
  if (token === undefined) return <p className="text-sm text-muted">Checking…</p>;
  if (!token) {
    return (
      <Notice>Reporting is only available on a device with a watch link that has reporting turned on. Open your watch page and turn it on there first.</Notice>
    );
  }
  return <PlanPoliceReportForm planId={planId} facts={facts} contact={contact} token={token} />;
}

function PlanPoliceReportForm({ planId, facts, contact, token }: { planId: string; facts: PlanFacts; contact: Contact | null; token: string }) {
  const [to, setTo] = useState<SendTo>("police");
  const [widen, setWiden] = useState(false);
  const [period, setPeriod] = useState<PeriodChoice>(() => ({ range: RANGE_PRESETS[4].range(), plans: true, visits: true }));
  const periodFacts = useRangeFacts(period.range, { plans: widen && period.plans, visits: widen && period.visits }, token);
  const [concern, setConcern] = useState("");
  const [name, setName] = useState("");
  const [reach, setReach] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [declare, setDeclare] = useState(false);
  const [website, setWebsite] = useState("");
  const [startedAt] = useState(() => Date.now());
  const [told, setTold] = useState(false);
  const [msg, setMsg] = useState<{
    tone: "green" | "red";
    text: string;
  } | null>(null);

  const anonymous = to === "crimestoppers";
  const ready = concern.trim().length >= PLAN_REPORT_RULES.concernMin && declare && !(widen && periodFacts.loading);
  const text = () => {
    const extra = widen ? periodLines(period, periodFacts, { skipPlanId: planId }) : [];
    return planReportText(
      { ...facts, link: `${window.location.origin}${facts.link}` },
      anonymous ? { concern, anonymous: true, extra } : { concern, name, contact: reach, extra },
    );
  };

  async function tellOwner() {
    if (told) return;
    setTold(true);
    await api(`/api/plans/${planId}/police-report`, {
      method: "POST",
      json: {
        concern: concern.trim(),
        named: !anonymous && Boolean(name.trim()),
        to,
        form_started_at: startedAt,
        website,
        token,
      },
    }).catch(() => setTold(false));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text());
      setMsg({
        tone: "green",
        text: anonymous
          ? "Copied. Paste it into the Crimestoppers online form, or read it out on the phone."
          : "Copied. Paste it into the police online form, or read it out on the phone.",
      });
      void tellOwner();
    } catch {
      setMsg({
        tone: "red",
        text: "Couldn't copy. Select the text below and copy it yourself.",
      });
    }
  }

  function email() {
    const addr = emailTo.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setMsg({
        tone: "red",
        text: "Enter the police email address to send it to.",
      });
      return;
    }
    void tellOwner();
    location.href = `mailto:${encodeURIComponent(addr)}?subject=${encodeURIComponent(`Report about a published plan: ${facts.title}`)}&body=${encodeURIComponent(text())}`;
  }

  return (
    <>
      <section className="space-y-2 rounded-[var(--ft-radius-card)] bg-red-bg p-5 text-red-ink sm:p-6">
        <h2 className="text-lg font-bold">Is someone in danger right now?</h2>
        <p>Don&apos;t use this form. Call 999.</p>
        <a href="tel:999" className={`${callBtn} w-full bg-[#B42318] text-white hover:bg-[#912018] sm:w-auto`}>
          Call 999
        </a>
      </section>

      <section className={`${card} space-y-2`}>
        <h2 className="text-lg font-bold">1. The plan</h2>
        <p className="text-sm text-muted">Filled in from what&apos;s published. You can&apos;t change it.</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
          <dt className="font-semibold">Plan</dt>
          <dd>{facts.title}</dd>
          <dt className="font-semibold">When</dt>
          <dd className="tabular-nums">{facts.when}</dd>
          <dt className="font-semibold">Where</dt>
          <dd>{facts.where}</dd>
          {facts.stops.map((s, i) => (
            <div key={i} className="contents">
              <dt className="font-semibold">Stop {i + 2}</dt>
              <dd>{s}</dd>
            </div>
          ))}
          <dt className="font-semibold">Type</dt>
          <dd>{facts.category}</dd>
          <dt className="font-semibold">Status</dt>
          <dd>{facts.status}</dd>
          {facts.description && (
            <>
              <dt className="font-semibold">Details</dt>
              <dd className="whitespace-pre-line">{facts.description}</dd>
            </>
          )}
        </dl>
      </section>

      <section className={`${card} space-y-3`}>
        <h2 className="text-lg font-bold">2. Over a period (optional)</h2>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={widen} onChange={(e) => setWiden(e.target.checked)} />
          <span>
            <span className="font-semibold">Add other plans and the full movement record over a period</span>
            <span className="block text-muted">For example the last month, the next 6 weeks, or any dates you choose.</span>
          </span>
        </label>
        {widen && <ReportPeriod value={period} onChange={setPeriod} facts={periodFacts} skipPlanId={planId} />}
      </section>

      <section className={`${card} space-y-3`}>
        <h2 className="text-lg font-bold">3. Who it goes to</h2>
        <SendToChoice value={to} onChange={setTo} />
      </section>

      <section className={`${card} space-y-4`}>
        <h2 className="text-lg font-bold">4. Your concern</h2>
        <Field
          label="Why do you think this plan is illegal, or should be stopped?"
          htmlFor="concern"
          hint="In your own words. Say what you know and how you know it. If you're unsure of something, say so."
        >
          <Textarea id="concern" rows={7} value={concern} onChange={(e) => setConcern(e.target.value)} maxLength={PLAN_REPORT_RULES.concernMax} />
        </Field>
        {anonymous ? (
          <p className="text-sm text-muted">Crimestoppers don&apos;t ask who you are, so your name and contact details are left out of this report.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name (optional)" htmlFor="rname" hint="Leave blank to stay anonymous.">
              <Input id="rname" value={name} onChange={(e) => setName(e.target.value)} maxLength={PLAN_REPORT_RULES.nameMax} autoComplete="name" />
            </Field>
            <Field label="How the police can reach you (optional)" htmlFor="rreach" hint="Phone or email. Only goes in your report.">
              <Input id="rreach" value={reach} onChange={(e) => setReach(e.target.value)} maxLength={PLAN_REPORT_RULES.contactMax} />
            </Field>
          </div>
        )}
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="hidden"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={declare} onChange={(e) => setDeclare(e.target.checked)} />
          <span>What I&apos;ve written is true to the best of my knowledge. I know a false report is an offence.</span>
        </label>
      </section>

      <section className={`${card} space-y-4`}>
        <h2 className="text-lg font-bold">5. Send it {anonymous ? "to Crimestoppers" : "to the police"}</h2>
        <p className="text-sm text-muted">
          You send it. Nothing goes {anonymous ? "to Crimestoppers" : "to the police"} from this site. When you{" "}
          {anonymous ? "copy or download" : "copy, email or download"} your report, I&apos;m told a report was made, with your concern but never your name or
          contact details.
        </p>
        {anonymous ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <a href={`tel:${CRIMESTOPPERS.tel}`} className={`${callBtn} bg-accent text-accent-foreground hover:bg-accent-hover`}>
              Call {CRIMESTOPPERS.telLabel}
            </a>
            <a href={CRIMESTOPPERS.web} target="_blank" rel="noopener noreferrer" className={outlineBtn}>
              Give information online
            </a>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            {contact && (
              <a href={`tel:${contact.tel}`} className={`${callBtn} bg-accent text-accent-foreground hover:bg-accent-hover`}>
                {contact.label}
              </a>
            )}
            {contact?.web && (
              <a href={contact.web} target="_blank" rel="noopener noreferrer" className={outlineBtn}>
                Contact them online
              </a>
            )}
            <a href="tel:101" className={outlineBtn}>
              Call 101 (UK non-emergency)
            </a>
            <a href="https://www.police.uk/pu/contact-us/" target="_blank" rel="noopener noreferrer" className={outlineBtn}>
              Report online (police.uk)
            </a>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={copy} disabled={!ready}>
            Copy my report
          </Button>
        </div>
        {!anonymous && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="Or email it to" htmlFor="emailto" hint="The police email address. It opens in your own email app.">
              <Input id="emailto" type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} className="sm:w-80" />
            </Field>
            <Button type="button" variant="secondary" onClick={email} disabled={!ready}>
              Email my report
            </Button>
          </div>
        )}
        <ReportDownloads
          title={`Report about a published plan: ${facts.title}`}
          base={`plan-report-${facts.title}`}
          text={text}
          disabled={!ready}
          onDone={() => void tellOwner()}
          csv={
            widen && period.visits && periodFacts.movement
              ? { label: "GPS readings (.csv)", base: readingsFileBase(period.range), text: () => readingsCsv(periodFacts.movement!) }
              : null
          }
        />
        {!ready && (
          <p className="text-xs text-muted">
            Write your concern (at least {PLAN_REPORT_RULES.concernMin} characters) and tick the box to copy, {anonymous ? "" : "email "}or download it.
          </p>
        )}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {ready && (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">See the full report</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[#F1F4F8] p-3 font-sans">{text()}</pre>
          </details>
        )}
      </section>

      <p className="text-sm">
        <Link href="/plans" className="font-semibold text-accent hover:underline">
          Back to plans
        </Link>
      </p>
    </>
  );
}
