import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { optionalEnv, requireServerEnv } from "@/lib/env";

/**
 * Sealing for watchers' local areas and locations.
 *
 * The key comes from the watcher's private link, which the server never
 * stores (only its SHA-256 hash). Without the link, a sealed area can't be
 * read, not even by the site owner. A watcher who turns on alerts for these
 * areas lets the server keep their key, encrypted with a server secret
 * (`alert_key`), so the alert job can check them.
 *
 * A location's real point is sealed with a second key that is never kept, so
 * even with alerts on only the blurred circle is readable.
 */

const AREA_INFO = "full-transparency/watch-area/v1";
const POINT_INFO = "full-transparency/watch-point/v1";

export const areaKeyFor = (token: string) => createHmac("sha256", AREA_INFO).update(token.toUpperCase()).digest();
export const pointKeyFor = (token: string) => createHmac("sha256", POINT_INFO).update(token.toUpperCase()).digest();

export function seal(key: Buffer, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

export function unseal<T>(key: Buffer, sealed: string): T {
  if (!sealed.startsWith("v1.")) throw new Error("Unknown seal format");
  const raw = Buffer.from(sealed.slice(3), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as T;
}

function serverKey(): Buffer {
  const secret = optionalEnv("WATCH_SEAL_SECRET") ?? requireServerEnv("CRON_SECRET");
  return createHash("sha256").update(`full-transparency/alert-key/v1:${secret}`).digest();
}

/** The watcher's area key, encrypted for the alert job (only when they opt in). */
export const escrowAreaKey = (token: string) => seal(serverKey(), areaKeyFor(token).toString("base64"));

export function unescrowAreaKey(alertKey: string): Buffer | null {
  try {
    return Buffer.from(unseal<string>(serverKey(), alertKey), "base64");
  } catch {
    return null;
  }
}

/** What a sealed area holds. */
export interface SealedArea {
  name: string;
  note: string;
  geometry: { type: "Polygon"; coordinates: [number, number][][] } | { type: "MultiPolygon"; coordinates: [number, number][][][] };
  /** How it was drawn, for editing. */
  shape:
    | { type: "circle"; center: { lat: number; lng: number }; radius_m: number }
    | { type: "polygon"; vertices: { lat: number; lng: number }[] }
    | { type: "boundary"; name: string }
    | { type: "location"; radius_m: number; blurred_radius_m: number };
  /** Location only: the real point, sealed again with the point key. */
  point?: string;
}
