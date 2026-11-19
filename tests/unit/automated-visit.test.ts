import { describe, expect, it } from "vitest";
import { automatedKind } from "@/lib/automated-visit";

describe("automatedKind", () => {
  it("leaves real browsers alone", () => {
    expect(automatedKind("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBeNull();
    expect(automatedKind("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36")).toBeNull();
    expect(automatedKind(null)).toBeNull();
  });
  it("spots Vercel, test browsers and bots", () => {
    expect(automatedKind("Mozilla/5.0 (compatible; vercel-screenshot/1.0)")).toBe("vercel");
    expect(automatedKind("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/131.0.0.0 Safari/537.36")).toBe("test browser");
    expect(automatedKind("Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36", true)).toBe("test browser");
    expect(automatedKind("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe("bot");
  });
});
