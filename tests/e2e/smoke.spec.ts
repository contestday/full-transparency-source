import { expect, test } from "@playwright/test";

test("landing page shows product name and primary navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Full Transparency" })).toBeVisible();
  await expect(page.getByText("Full Picture Location Transparency")).toHaveCount(0);
  // Desktop: the menu in the header (Privacy and FAQs under More). Phones: the bottom tab bar (the rest under More).
  const desktop = page.getByRole("navigation", { name: "Primary" }).filter({ visible: true });
  const phone = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
  const nav = (await desktop.count()) ? desktop : phone;
  for (const label of ["Home", "History", "Plans", "Watch"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await nav.getByRole("button", { name: /More/ }).click();
  for (const label of ["Privacy", "FAQs"]) {
    await expect(page.getByRole("link", { name: label, exact: true }).filter({ visible: true }).first()).toBeVisible();
  }
});

test("public pages render", async ({ page }) => {
  for (const [path, heading] of [
    ["/history", "Where I've been"],
    ["/plans", "Where I'm going"],
    ["/plans/calendar", "Where I'm going"],
    ["/plans/map", "Where I'm going"],
    ["/report", "Message me"],
    ["/geofences/submit", "Watch a place"],
    ["/watch", "My watch links"],
    ["/privacy", "Your privacy"],
    ["/privacy/policy", "Privacy policy"],
    ["/about", "Questions and answers"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
});

test("contact page is a simple anonymous note", async ({ page }) => {
  await page.goto("/report");
  await expect(page.getByLabel("Your message")).toBeVisible();
  await expect(page.getByText(/police/i)).toHaveCount(0);
});

test("watch-an-area page explains private watch links", async ({ page }) => {
  await page.goto("/geofences/submit");
  await expect(page.getByText(/private watch link/).first()).toBeVisible();
  await expect(page.getByPlaceholder(/South Yorkshire/)).toBeVisible();
  await expect(page.getByText(/not legal restrictions/)).toBeVisible();
});

test("an invalid watch link is rejected", async ({ request }) => {
  expect((await request.get("/api/watch/AAAAAAAAAAAAAAAAAAAAAAAA")).status()).toBe(404);
});

test("admin pages redirect unauthenticated visitors to sign-in", async ({ page }) => {
  for (const path of ["/admin", "/admin/map", "/admin/plans", "/admin/reports"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("private APIs reject unauthenticated requests", async ({ request }) => {
  for (const path of ["/api/admin/locations", "/api/admin/reports", "/api/admin/geofences", "/api/admin/plans"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(401);
  }
  expect((await request.post("/api/imports/timeline", { data: {} })).status()).toBe(401);
  // Cron/ingest fail closed: 401 with a secret configured, 503 without.
  expect([401, 503]).toContain((await request.get("/api/cron/followmee")).status());
  expect([401, 503]).toContain((await request.post("/api/locations/ingest", { data: {} })).status());
});

test("public plans API never returns private fields", async ({ request }) => {
  const res = await request.get("/api/public/plans");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  for (const p of body.plans) {
    for (const k of ["lat", "lng", "venue_id", "address", "archived"]) expect(p).not.toHaveProperty(k);
  }
});

test("the site is installable: manifest and service worker", async ({ request }) => {
  const m = await (await request.get("/full-transparency/pwa/manifest.webmanifest")).json();
  expect(m.start_url).toBe("/");
  expect(m.display).toBe("standalone");
  expect((await request.get("/sw.js")).ok()).toBeTruthy();
  const wm = await (await request.get("/watch/ABCDEFGHJKLMNPQRSTUVWXYZ/manifest.webmanifest")).json();
  expect(wm.start_url).toBe("/watch/ABCDEFGHJKLMNPQRSTUVWXYZ");
});
