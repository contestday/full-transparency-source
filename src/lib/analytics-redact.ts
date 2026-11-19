/**
 * What page views may tell Vercel Analytics. Watch links carry a watcher's
 * private key in the path, and contact confirm/stop links carry a token in
 * the query: both are replaced before anything is sent. Admin and sign-in
 * pages are not counted at all. Pure: exported for tests.
 */
export function redactAnalyticsUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (/^\/(admin|login|auth)(\/|$)/.test(u.pathname)) return null;
  u.pathname = u.pathname.replace(/^\/watch\/[^/]+/, "/watch/[link]");
  for (const k of ["t", "token", "code"]) u.searchParams.delete(k);
  u.hash = "";
  return u.toString();
}
