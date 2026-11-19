// Design-system pieces from the visual refresh. Server-safe (no hooks).
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import { Artwork } from "@/components/brand";
import { LIVE_STATUS_META } from "@/lib/live-status";

/* ------------------------------------------------------------------ icons */

const PATHS: Record<string, ReactNode> = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  "arrow-out": (
    <>
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </>
  ),
  dash: <path d="M6 12h12" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  rings: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0113 0c0 4.8-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 103-6.5" />
      <path d="M3.5 4.5v4h4" />
      <path d="M12 8v4.5l3 1.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  chat: <path d="M5 18.5V6.5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H9l-4 2z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.5v.5" />
    </>
  ),
  home: <path d="M4 11l8-6.5 8 6.5V19.5a1 1 0 01-1 1h-4.5v-5h-5v5H5a1 1 0 01-1-1z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  swap: (
    <>
      <path d="M7 4L4 7l3 3M4 7h12" />
      <path d="M17 20l3-3-3-3M20 17H8" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 004 0" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  map: (
    <>
      <path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5.5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="18.5" r="2.5" />
      <path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1" />
    </>
  ),
  layers: (
    <>
      <path d="M12 4l8.5 4.5L12 13 3.5 8.5z" />
      <path d="M3.5 12.5L12 17l8.5-4.5" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, className, title }: { name: IconName; className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-5 w-5 shrink-0", className)}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}

/* --------------------------------------------------------------- layout */

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1264px] px-4 sm:px-8", className)}>{children}</div>;
}

/** Sky page-head band: eyebrow, title, lead, optional artwork, optional slot (e.g. tabs). */
export function PageHead({
  eyebrow,
  title,
  lead,
  art,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  art?: "hero" | "plans" | "history" | "geofence";
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b border-[#DCE7F3] bg-sky">
      {art && (
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] max-w-[560px] md:block" aria-hidden="true">
          <Artwork stem={art} sizes="560px" className="h-full w-full object-cover object-left opacity-90 [mask-image:linear-gradient(to_right,transparent,black_35%)]" />
        </div>
      )}
      <Container className="relative py-8 sm:py-12">
        <div className="max-w-2xl">
          {eyebrow && <p className="text-xs font-bold uppercase tracking-[.08em] text-muted">{eyebrow}</p>}
          <h1 className="mt-1 text-[32px] font-bold leading-[1.08] sm:text-[44px]">{title}</h1>
          {lead && <div className="mt-3 text-[17px] leading-relaxed text-muted sm:text-lg">{lead}</div>}
        </div>
        {children && <div className="mt-6">{children}</div>}
      </Container>
    </section>
  );
}

/** Segmented control made of links (e.g. List · Calendar · Map). */
export function Segmented({ items }: { items: { href: string; label: string; icon?: IconName; current?: boolean }[] }) {
  return (
    <nav aria-label="Views" className="inline-flex max-w-full flex-wrap rounded-xl bg-[#DCE9F7] p-1">
      {items.map((it) => (
        <Link
          key={`${it.href}|${it.label}`}
          href={it.href}
          aria-current={it.current ? "page" : undefined}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-[10px] px-4 text-sm font-semibold",
            it.current ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {it.icon && <Icon name={it.icon} className="h-4 w-4" />}
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

export function IconTile({ name, tone = "sky", className }: { name: IconName; tone?: "sky" | "mint"; className?: string }) {
  return (
    <span className={cn("inline-flex h-12 w-12 items-center justify-center rounded-[14px]", tone === "sky" ? "bg-sky text-accent" : "bg-mint text-jade", className)}>
      <Icon name={name} className="h-6 w-6" />
    </span>
  );
}

/** Card that is entirely a link. */
export function CardLink({
  href,
  icon,
  title,
  text,
  footer,
}: {
  href: string;
  icon: IconName;
  title: string;
  text: string;
  footer?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col rounded-[var(--ft-radius-card)] border border-border bg-surface p-6 shadow-[var(--ft-shadow-card)] transition hover:border-accent hover:shadow-[0_14px_36px_rgb(20_43_73/14%)]"
    >
      <IconTile name={icon} />
      <h3 className="mt-4 text-[22px] font-bold">{title}</h3>
      <p className="mt-1 text-[15px] text-muted">{text}</p>
      <div className="mt-auto flex items-center justify-between pt-4 text-sm">
        <span className="text-muted">{footer}</span>
        <span className="font-semibold text-accent group-hover:underline">Open →</span>
      </div>
    </Link>
  );
}

export function EmptyState({ icon = "info", title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-dashed border-[#93A4B5] bg-[#F7FAFD] p-4">
      <Icon name={icon} className="mt-0.5 text-muted" />
      <div>
        <p className="font-semibold text-ink">{title}</p>
        {children && <div className="mt-0.5 text-sm text-muted">{children}</div>}
      </div>
    </div>
  );
}

/** Card wrapper for maps, with an optional key underneath. */
export function MapFrame({ children, legend, className }: { children: ReactNode; legend?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[var(--ft-radius-card)] border border-border bg-surface p-3 shadow-[var(--ft-shadow-card)]", className)}>
      <div className="overflow-hidden rounded-xl">{children}</div>
      {legend && <div className="flex flex-wrap gap-x-5 gap-y-2 px-2 pb-1 pt-3 text-xs text-muted">{legend}</div>}
    </div>
  );
}

export function LegendItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      {swatch}
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- status */

type StatusKey = keyof typeof LIVE_STATUS_META;

const STATUS_ICON: Record<StatusKey, IconName> = {
  green: "check",
  yellow: "arrow-out",
  amber: "layers",
  red: "target",
  purple: "rings",
  unknown: "dash",
  disabled: "dash",
};

/** Coloured disk with a state-specific icon: colour is never the only signal. */
export function StatusDisk({ status, size = 64 }: { status: StatusKey; size?: number }) {
  const meta = LIVE_STATUS_META[status] ?? LIVE_STATUS_META.unknown;
  const isAmber = (status === "yellow" || status === "amber");
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: meta.color,
        color: isAmber ? "#142B49" : "#fff",
        boxShadow: `0 0 0 6px color-mix(in srgb, ${meta.color} 18%, transparent)${isAmber ? ", inset 0 0 0 2px #B45309" : ""}`,
      }}
      aria-hidden="true"
    >
      <Icon name={STATUS_ICON[status]} className="h-1/2 w-1/2" />
    </span>
  );
}

export function StatusDot({ status, className }: { status: StatusKey; className?: string }) {
  const meta = LIVE_STATUS_META[status] ?? LIVE_STATUS_META.unknown;
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)}
      style={{ background: meta.color, boxShadow: (status === "yellow" || status === "amber") ? "0 0 0 1.5px #B45309" : undefined }}
      aria-hidden="true"
    />
  );
}

/** Legend of states; the current one is outlined and marked NOW. */
export function StatusLegend({
  states,
  current,
  labels,
}: {
  states: StatusKey[];
  current?: StatusKey;
  labels?: Partial<Record<StatusKey, string>>;
}) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2" aria-label="Status colours">
      {states.map((s) => {
        const on = s === current;
        return (
          <li
            key={s}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border bg-white px-3 py-2 text-sm",
              on ? "border-2 border-ink font-semibold" : "border-hairline text-muted",
            )}
          >
            <StatusDisk status={s} size={22} />
            <span className="flex-1">{labels?.[s] ?? LIVE_STATUS_META[s].label}</span>
            {on && <span className="text-[10px] font-bold tracking-[.08em] text-ink">NOW</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Prominent "On the move" badge in the current status colour. */
export function OnTheMove({ status, className }: { status: StatusKey; className?: string }) {
  const meta = LIVE_STATUS_META[status] ?? LIVE_STATUS_META.unknown;
  const amber = (status === "yellow" || status === "amber");
  return (
    <span
      className={cn("inline-flex h-9 items-center gap-2 rounded-full px-4 text-[15px] font-bold", className)}
      style={{ background: meta.color, color: amber ? "#142B49" : "#fff", boxShadow: amber ? "inset 0 0 0 2px #B45309" : undefined }}
    >
      <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: amber ? "#142B49" : "#fff" }} />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: amber ? "#142B49" : "#fff" }} />
      </span>
      On the move
    </span>
  );
}

/* ------------------------------------------------- engagement refresh */

/** Tint (background) and dark text for each status: status colours always mean a status. */
export const STATUS_TONE: Record<StatusKey | "blue", { bg: string; ink: string; dot: string; short: string }> = {
  green: { bg: "var(--green-bg)", ink: "var(--green-ink)", dot: "#007B60", short: "Okay zone" },
  yellow: { bg: "var(--yellow-bg)", ink: "var(--yellow-ink)", dot: "#D4A900", short: "Outside zone" },
  amber: { bg: "var(--amber-bg)", ink: "var(--amber-ink)", dot: "#F08C00", short: "Wish area" },
  red: { bg: "var(--red-bg)", ink: "var(--red-ink)", dot: "#C62828", short: "Noted area" },
  purple: { bg: "var(--purple-bg)", ink: "var(--purple-ink)", dot: "#7E22CE", short: "Location" },
  unknown: { bg: "var(--grey-bg)", ink: "var(--grey-ink)", dot: "#64748B", short: "No GPS" },
  disabled: { bg: "var(--grey-bg)", ink: "var(--grey-ink)", dot: "#64748B", short: "Off" },
  blue: { bg: "var(--ice)", ink: "#1947B5", dot: "#245AD6", short: "" },
};

/** A tinted chip with a number and a label, e.g. "23 stays" or "91% in okay zone". */
export function StatChip({ tone = "blue", value, label, dot = false }: { tone?: StatusKey | "blue"; value: string; label: string; dot?: boolean }) {
  const t = STATUS_TONE[tone];
  return (
    <span className="inline-flex min-h-[30px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold" style={{ background: t.bg, color: t.ink }}>
      {dot && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.dot }} aria-hidden="true" />}
      <span className="font-display text-[14px] font-bold tabular-nums">{value}</span> {label}
    </span>
  );
}

/** A shimmering placeholder while something loads (still when reduced motion is on). */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("ft-skeleton block rounded-xl", className)} aria-hidden="true" />;
}
