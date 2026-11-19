import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests against a production build. They run WITHOUT Supabase so they
 * verify routing, rendering, access control and graceful degradation. Data
 * flows (create plan → appears publicly, etc.) need a seeded Supabase project:
 * see docs/TESTING.md.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npx next start -p 3100", port: 3100, reuseExistingServer: true, timeout: 60_000 },
});
