import { defineConfig, devices } from "@playwright/test";

/**
 * The guided walk on NovaAir, end to end: the widget embedded on the real host site, asking a real
 * question, walking the route the spotlight shows.
 *
 * Two ways to run it:
 * - Against a running stack: set NOVAAIR_BASE_URL to a NovaAir that embeds the widget from a
 *   running Lantern (LANTERN_API), with the project's product map explored and its help center
 *   imported. Real model calls happen on the server; the test needs no secret.
 * - Against the widget's development API: leave NOVAAIR_BASE_URL unset and point NOVAAIR_DIR at a
 *   NovaAir checkout. The mock plans over the NovaAir fixture graph and makes no model call.
 */
const NOVAAIR_PORT = Number(process.env.NOVAAIR_PORT ?? 4170);
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 4371);
const baseURL = process.env.NOVAAIR_BASE_URL ?? `http://127.0.0.1:${NOVAAIR_PORT}`;
const novaairDir = process.env.NOVAAIR_DIR ?? "";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  // The device profile carries its own viewport, so the size the demo runs at is set after it.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: process.env.NOVAAIR_BASE_URL
    ? undefined
    : [
        {
          command: `MOCK_PORT=${MOCK_PORT} npx tsx dev/mock-api.ts`,
          cwd: "packages/widget",
          url: `http://127.0.0.1:${MOCK_PORT}/lantern.js`,
          reuseExistingServer: true,
          timeout: 60_000,
        },
        {
          command: `NEXT_DIST_DIR=.next-lantern-e2e NEXT_PUBLIC_LANTERN_WIDGET_URL=http://127.0.0.1:${MOCK_PORT}/lantern.js NEXT_PUBLIC_LANTERN_KEY=pk_dev_000000000000000000000000 npx next dev -p ${NOVAAIR_PORT}`,
          cwd: novaairDir || undefined,
          url: baseURL,
          reuseExistingServer: true,
          timeout: 180_000,
        },
      ],
});
