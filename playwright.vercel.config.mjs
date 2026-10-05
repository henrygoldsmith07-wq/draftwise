import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-level E2E against the production Next.js build.
 *
 * The default config runs the vinext dev server on Cloudflare's runtime. That
 * proves the app works while you develop it, but it does not prove the thing
 * that gets deployed to Vercel does. This config builds and serves exactly what
 * a deployment serves, then runs the same suite against it, so "it works on
 * Vercel" is a checked claim rather than an assumption.
 *
 * The port differs from the dev config on purpose: both servers can be running
 * at once without Playwright silently reusing the wrong one.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3112",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-production",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build:vercel && npm run start:vercel -- -p 3112",
    url: "http://localhost:3112",
    reuseExistingServer: false,
    timeout: 600_000,
  },
});