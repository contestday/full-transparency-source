/* eslint-disable @next/next/no-img-element -- static brand SVG/WebP with srcSet; next/image adds nothing here */

/** Decorative page artwork from the asset pack (768/1600 WebP variants). */
export function Artwork({
  stem,
  className,
  sizes = "(min-width: 1024px) 50vw, 100vw",
  priority = false,
}: {
  stem: "hero" | "plans" | "history" | "geofence";
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <img
      src={`/full-transparency/art/${stem}-1600.webp`}
      srcSet={`/full-transparency/art/${stem}-768.webp 768w, /full-transparency/art/${stem}-1600.webp 1600w`}
      sizes={sizes}
      width={1600}
      height={900}
      alt=""
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      className={className ?? "h-auto w-full rounded-[var(--ft-radius-card)]"}
    />
  );
}

export function Logo({ variant = "primary", className }: { variant?: "primary" | "reverse" | "mark"; className?: string }) {
  return (
    <img
      src={variant === "mark" ? "/full-transparency/brand/mark.svg" : `/full-transparency/brand/logo-${variant}.svg`}
      alt={variant === "mark" ? "" : "Full Transparency"}
      width={variant === "mark" ? 64 : 308}
      height={64}
      className={className ?? "h-9 w-auto"}
    />
  );
}
