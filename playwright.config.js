// Playwright E2E config (2026-05-15・lint Phase 動的解析 ② 導入)
// ローカル static server を webServer 経由で起動 (npx http-server -p 3000)
// chromium のみ install (firefox/webkit は意図的に未導入・ディスク節約)
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx http-server -p 3000 -c-1 -s',
    port: 3000,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
