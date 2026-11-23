// Full Transparency service worker: installable app (PWA) + Web Push.
// Deliberately does NOT cache pages or API responses (location data must
// always be fresh and must not persist in a cache). When offline, page
// navigations get a small "you're offline" page instead.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const OFFLINE_HTML = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Full Transparency</title>
<style>body{font-family:system-ui,sans-serif;background:#ECF5FF;color:#142B49;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}
.c{background:#fff;border:1px solid #C5D6E5;border-radius:18px;padding:32px;max-width:420px}button{margin-top:16px;height:44px;padding:0 20px;border:0;border-radius:10px;background:#245AD6;color:#fff;font-size:16px}</style></head>
<body><div class="c"><h1>You're offline</h1><p>Full Transparency shows live information, so it needs a connection. Please try again when you're back online.</p><button onclick="location.reload()">Try again</button></div></body></html>`;

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return; // everything else: normal network
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } }),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Full Transparency", body: "", url: "/admin" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/full-transparency/pwa/icon-192.png",
      badge: "/full-transparency/pwa/badge-96.png",
      actions: Array.isArray(data.actions) ? data.actions : [],
      data: { url: data.url, stopUrl: data.stopUrl },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // "Turn off sample alerts": unsubscribe this device from the public sample only.
  if (event.action === "stop-sample" && event.notification.data?.stopUrl) {
    event.waitUntil(
      self.registration.pushManager.getSubscription().then((sub) =>
        sub ? fetch(event.notification.data.stopUrl + "?endpoint=" + encodeURIComponent(sub.endpoint), { method: "DELETE" }) : undefined,
      ),
    );
    return;
  }
  const url = new URL(event.notification.data?.url || "/admin", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url === url && "focus" in w) return w.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
