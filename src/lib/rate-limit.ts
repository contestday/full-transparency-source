import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { HttpError, clientIp } from "@/lib/http";
import { hashClientId } from "@/lib/crypto";
import { optionalEnv } from "@/lib/env";

export interface Limit {
  name: string;
  windowSeconds: number;
  max: number;
}

export async function clientHash(request: Request): Promise<string> {
  // A missing salt still hashes, but a configured RATE_LIMIT_SALT prevents
  // offline reversal of the stored hashes.
  const salt = optionalEnv("RATE_LIMIT_SALT") ?? optionalEnv("CRON_SECRET") ?? "ft";
  return hashClientId(clientIp(request), salt);
}

/** Throws 429 if any limit is exceeded. Returns the client hash. */
export async function enforceRateLimits(request: Request, limits: Limit[]): Promise<string> {
  const hash = await clientHash(request);
  const supabase = createServiceClient();
  for (const limit of limits) {
    const { data, error } = await supabase.rpc("rate_limit_hit", {
      p_key: `${limit.name}:${hash}`,
      p_window_seconds: limit.windowSeconds,
      p_max: limit.max,
    });
    if (error) throw error;
    if (data === false) {
      throw new HttpError(429, "Too many submissions. Please try again later.");
    }
  }
  return hash;
}
