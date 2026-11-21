// Minimal shadcn/ui-style primitives (hand-written; no CLI generation needed).
import clsx from "clsx";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export const cn = clsx;

type Variant = "primary" | "secondary" | "ghost" | "danger" | "jade";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover disabled:bg-blue-300",
  secondary: "bg-surface text-foreground border border-border hover:bg-slate-50 disabled:text-slate-400",
  ghost: "text-foreground hover:bg-slate-100",
  danger: "bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300",
  jade: "bg-jade text-white hover:brightness-95 disabled:opacity-50",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--ft-radius-control)] font-medium transition-colors disabled:cursor-not-allowed",
        size === "sm" && "h-8 px-3 text-sm",
        size === "md" && "h-11 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-base",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[var(--ft-radius-card)] border border-border bg-surface p-4 shadow-[var(--ft-shadow-card)]", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold", className)} {...props} />;
}

const badgeTones = {
  neutral: "bg-slate-100 text-slate-800 border-slate-200",
  blue: "bg-[var(--ft-color-planned-bg)] text-[var(--ft-color-planned-ink)] border-blue-200",
  green: "bg-[var(--ft-color-published-bg)] text-[var(--ft-color-published-ink)] border-green-200",
  amber: "bg-amber-50 text-amber-900 border-amber-300",
  red: "bg-red-50 text-red-800 border-red-200",
  purple: "bg-purple-50 text-purple-800 border-purple-200",
  black: "bg-neutral-900 text-white border-neutral-900",
} as const;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTones }) {
  return (
    <span
      className={cn("inline-flex h-[26px] items-center gap-1 rounded-full border px-2.5 text-xs font-semibold", badgeTones[tone], className)}
      {...props}
    />
  );
}

const fieldBase =
  "w-full rounded-md border border-border bg-white px-3 py-2 text-base sm:text-sm text-foreground placeholder:text-slate-400 disabled:bg-slate-50";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, "min-h-24", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldBase, "h-10", className)} {...props} />;
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-sm font-medium text-foreground", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Notice({
  tone = "blue",
  title,
  children,
  className,
}: {
  tone?: "blue" | "amber" | "red" | "green";
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    blue: "border-blue-200 bg-blue-50 text-blue-950",
    amber: "border-amber-300 bg-amber-50 text-amber-950",
    red: "border-red-300 bg-red-50 text-red-950",
    green: "border-green-300 bg-green-50 text-green-950",
  };
  return (
    <div className={cn("rounded-md border p-3 text-sm", tones[tone], className)} role={tone === "red" ? "alert" : undefined}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
