// MA-7 redirect stub 確認 E2E (2026-05-15・動的解析 ②)
// /settings.html / /history.html / /help.html → / にリダイレクトされる
import { test, expect } from '@playwright/test';

const stubs = [
  { path: '/settings.html', name: 'settings' },
  { path: '/history.html', name: 'history' },
  { path: '/help.html', name: 'help' },
];

for (const stub of stubs) {
  test(`flow-redirect: ${stub.path} → / にリダイレクト`, async ({ page }) => {
    // page.goto は redirect 後の最終 URL を返す
    const resp = await page.goto(stub.path, { waitUntil: 'load' });
    // 注: meta refresh は async・load event 後に発火する可能性があるため最大 3 秒待機
    await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/index.html', {
      timeout: 5000,
    });
    const finalPath = new URL(page.url()).pathname;
    expect(['/', '/index.html']).toContain(finalPath);
    // stub 自体は 200 OK で返ってくる (meta refresh + JS replace が発火)
    expect(resp?.status() || 200).toBeLessThan(400);
  });
}
