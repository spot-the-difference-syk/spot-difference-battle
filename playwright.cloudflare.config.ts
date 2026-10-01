import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  use: { baseURL: "http://127.0.0.1:8787", headless: true, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "pnpm build:packages && pnpm build:cloudflare && pnpm --filter @spot-battle/realtime exec wrangler dev --config wrangler.local.toml --ip 127.0.0.1 --port 8787 --persist-to ../../.cloudflare-test-state",
    url: "http://127.0.0.1:8787/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_R2_CANARY_BASE_URL: "", WRANGLER_SEND_METRICS: "false" },
  },
});
