/**
 * Centralised environment access. Server-only secrets are read lazily so that
 * a missing variable fails the specific feature, not the whole build.
 */

export function publicSupabaseConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  };
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = publicSupabaseConfig();
  return Boolean(url && anonKey);
}

export function requireServerEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value ? value : undefined;
}

export function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * How long the live status holds after the last GPS reading. FollowMee sends
 * nothing while the phone isn't moving, so silence means "still in the same
 * place". By default there is no limit: a silent phone is never shown as
 * unknown or off-grid. Set STATIONARY_HOLD_HOURS to a positive number to add one.
 */
export function liveHoldMs(): number {
  const hours = numberEnv("STATIONARY_HOLD_HOURS", 0);
  return hours > 0 ? hours * 3600_000 : Number.POSITIVE_INFINITY;
}

/** Private admin alert only (never shown publicly): FollowMee silent this long. */
export function adminSilenceAlertMs(): number {
  return numberEnv("ADMIN_SILENCE_ALERT_HOURS", 24) * 3600_000;
}

export const MAP_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
