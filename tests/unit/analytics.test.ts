import { describe, expect, it } from "vitest";
import { redactAnalyticsUrl } from "@/lib/analytics-redact";

const B = "https://full-transparency.vercel.app";

describe("analytics never receives private links", () => {
  it("replaces a watcher's key in the path", () => {
    const out = redactAnalyticsUrl(`${B}/watch/ABCDEFGHJKLMNPQRSTUVWXYZ`)!;
    expect(out).toBe(`${B}/watch/[link]`);
    expect(out).not.toContain("ABCDEF");
    expect(redactAnalyticsUrl(`${B}/watch/ABCDEFGHJKLMNPQRSTUVWXYZ/manifest.webmanifest`)).toBe(`${B}/watch/[link]/manifest.webmanifest`);
  });
  it("keeps the watch-links list page as is", () => {
    expect(redactAnalyticsUrl(`${B}/watch`)).toBe(`${B}/watch`);
  });
  it("removes confirm/stop tokens but keeps harmless filters", () => {
    expect(redactAnalyticsUrl(`${B}/contacts/confirm?t=SECRET123456`)).toBe(`${B}/contacts/confirm`);
    expect(redactAnalyticsUrl(`${B}/history?from=2024-09-27&to=2024-10-02`)).toBe(`${B}/history?from=2024-09-27&to=2024-10-02`);
  });
  it("doesn't count admin or sign-in pages", () => {
    expect(redactAnalyticsUrl(`${B}/admin/settings`)).toBeNull();
    expect(redactAnalyticsUrl(`${B}/login`)).toBeNull();
  });
});
