// Small crypto helpers that work in both Node and the browser (Web Crypto).

const BASE32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1

export function randomCode(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += BASE32[b % BASE32.length];
  return out;
}

/** Human-friendly reference, e.g. FT-R-7KQ2-M9XD */
export function makeReference(prefix: "R" | "G"): string {
  const code = randomCode(8);
  return `FT-${prefix}-${code.slice(0, 4)}-${code.slice(4)}`;
}

export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const data =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Salted hash of a client identifier (IP). Used only for rate limiting and abuse
 * correlation; the raw IP is never stored.
 */
export async function hashClientId(ip: string, salt: string): Promise<string> {
  return (await sha256Hex(`${salt}:${ip}`)).slice(0, 32);
}
