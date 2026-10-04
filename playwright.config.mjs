import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-level E2E for the document workflows users depend on. The dev
 * server runs locally; AI/provider calls are never made (AI stays disabled and
 * unconfigured), so the suite is deterministic and offline-safe.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    // This machine boots the dev server in roughly two minutes; the default
    // timeout assumes a faster start than reality and aborts the suite early.
    timeout: 300_000,
  },
});
