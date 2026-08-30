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
  // ★★2026-08-30 追加（実際に 赤に なった）★★
  //   道路グラフ 15,990本を 消した コミットで CI の e2e が 落ちました:
  //     GitCommitInfo: timeout ... git fetch <sha> --depth=1
  //     ★RangeError: Invalid string length★
  //   ＝Playwright が ★コミットの 情報（変えたファイルの 一覧）を 文字にまとめる★所で
  //     文字が 長すぎて 落ちていました。★試験の 中身は 1本も 落ちていません★。
  //   ⇒ この情報は ★報告書の 飾り★なので 取りません（試験の 判定は 1文字も 変わりません）。
  captureGitInfo: { commit: false, diff: false },
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
