import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { isPwnedPassword } = await import("@/lib/pwned");

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex").toUpperCase();

function fakeApi(body: string, seen: { url?: string; headers?: Record<string, string> }) {
  return (async (url: string, init?: RequestInit) => {
    seen.url = String(url);
    seen.headers = init?.headers as Record<string, string>;
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

describe("isPwnedPassword (k-anonymity)", () => {
  const pw = "correct horse battery staple";
  const h = sha1(pw);

  it("sends only the 5-character hash prefix, with padding requested", async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {};
    await isPwnedPassword(pw, fakeApi("", seen));
    expect(seen.url).toBe(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`);
    expect(seen.url).not.toContain(h.slice(5));
    expect(seen.url).not.toContain(pw);
    expect(seen.headers?.["Add-Padding"]).toBe("true");
  });

  it("finds a breached password by its suffix", async () => {
    expect(await isPwnedPassword(pw, fakeApi(`0000000000000000000000000000000000A:3\r\n${h.slice(5)}:42\r\n`, {}))).toBe(true);
  });

  it("ignores padding rows (count 0) and other suffixes", async () => {
    expect(await isPwnedPassword(pw, fakeApi(`${h.slice(5)}:0\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:9\r\n`, {}))).toBe(false);
  });

  it("returns null when the service can't be reached", async () => {
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await isPwnedPassword(pw, down)).toBeNull();
  });
});
