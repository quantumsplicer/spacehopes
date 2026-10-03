import { defineConfig } from "@playwright/test";

// Run against the running stack: `make e2e` (docker compose up first). Rate limits are switched off for the run.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080", trace: "retain-on-failure", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", viewport: { width: 1360, height: 900 } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
