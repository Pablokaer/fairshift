import { defineConfig, devices } from '@playwright/test';

// Requires: `supabase start` (with seed data) and a web build (`pnpm build:web`).
// The static build is served with an SPA fallback on :8081.
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8081',
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx serve -s ../app/dist -l 8081 --no-clipboard',
    url: 'http://localhost:8081',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
