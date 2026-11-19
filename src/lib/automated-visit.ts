/**
 * Which kind of automated visit a request looks like, or null for a person.
 * Vercel's own checks (deployment screenshots, previews, monitoring), test
 * browsers (Playwright, headless Chrome, as used for checks and recordings)
 * and other bots. Such visits are still recorded, just hidden on the Journeys
 * report.
 */
export function automatedKind(userAgent: string | null | undefined, webdriver = false): string | null {
  const ua = (userAgent ?? "").toLowerCase();
  if (/vercel/.test(ua)) return "vercel";
  if (webdriver || /headlesschrome|playwright|puppeteer|lighthouse|pagespeed|electron\//.test(ua)) return "test browser";
  if (/bot\b|bot\/|crawler|spider|slurp|preview|monitor|uptime|checkly|curl\/|wget\/|python-requests|node-fetch|undici/.test(ua)) return "bot";
  return null;
}
