import { defineConfig, devices } from "@playwright/test";

const FAKE_DAEMON_PORT = 8799;
const APP_PORT = 3200;

/**
 * Dashboard E2E suite. Drives real Chromium against the real Next.js dev server, pointed
 * at a fake daemon HTTP server (e2e/fakeDaemon.ts) that speaks the exact API shape the
 * real daemon does. Only the daemon PROCESS is fake — the HTTP boundary, the dashboard's
 * data layer (lib/data/live/httpData.ts), and every component render are real.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: `FAKE_DAEMON_PORT=${FAKE_DAEMON_PORT} npx tsx e2e/runFakeDaemon.ts`,
      port: FAKE_DAEMON_PORT,
      reuseExistingServer: false,
      timeout: 20_000,
    },
    {
      command: `TISSUE_DAEMON_URL=http://127.0.0.1:${FAKE_DAEMON_PORT} PORT=${APP_PORT} npx next dev -p ${APP_PORT}`,
      port: APP_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
