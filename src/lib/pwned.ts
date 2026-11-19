import "server-only";
import { createHash } from "node:crypto";

/**
 * Has this password appeared in a known data breach? Uses the HaveIBeenPwned
 * k-anonymity range API: only the first 5 hex characters of the password's
 * SHA-1 hash leave the server; the match is made here. Padding is requested
 * so the response size reveals nothing.
 *
 * Returns true (breached), false (not found) or null (couldn't check: the
 * caller decides; this site allows the change and says so).
 * The password and its full hash are never logged or stored.
 */
export async function isPwnedPassword(password: string, fetchImpl: typeof fetch = fetch): Promise<boolean | null> {
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "user-agent": "FullTransparency-password-check" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    for (const line of body.split("\n")) {
      const [s, count] = line.trim().split(":");
      // Padding rows have a count of 0.
      if (s === suffix && Number(count) > 0) return true;
    }
    return false;
  } catch {
    return null;
  }
}

export const MIN_PASSWORD_LENGTH = 12;
export const BREACHED_MESSAGE = "This password has appeared in a data breach. Please choose a different one.";
