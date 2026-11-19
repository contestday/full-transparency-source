import { isWatchTokenShape } from "@/lib/watchers";

export const dynamic = "force-dynamic";

/**
 * A manifest per watch link: installing the app from a watch page opens that
 * watch view directly, so the person never needs the link again.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const token = (await ctx.params).token.toUpperCase();
  if (!isWatchTokenShape(token)) return new Response("Not found", { status: 404 });
  const icons = [
    { src: "/full-transparency/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/full-transparency/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/full-transparency/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];
  const manifest = {
    id: `/watch/${token}`,
    name: "Full Transparency – My watch",
    short_name: "My watch",
    description: "Your private watch view: the live marker coloured against your own areas.",
    start_url: `/watch/${token}`,
    scope: "/",
    display: "standalone",
    background_color: "#ECF5FF",
    theme_color: "#245AD6",
    icons,
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      "content-type": "application/manifest+json",
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
