// ============================================================
// ★準備が終わるまで押せない時は「押せない姿」で出ること★ 2026-08-07
//
//   ★何が起きていたか（司さん報告「代行開始ボタンが消える時がある」の筋）★
//     道データの版が上がると、印(daikome_warmup_v1)の版が合わなくなり
//     準備ゲートが閉じ直す → 代行開始ボタンが disabled + pointer-events:none になる。
//     ところが 較正ゲート(_updateCalibGate)が同じボタンに
//     el.style.opacity = '' を書き込むので ★薄さだけが消される★。
//     ＝ 見た目は普通の青いボタン・押しても何も起きない（実測 opacity=1）。
//
//   ★ここで固定すること★
//     ・準備できている時 … 濃い(opacity 1)・押せる
//     ・準備中の時       … 薄い(opacity 0.4)・押せない・理由の案内が出る
// ============================================================
import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['iPhone 14'], browserName: 'webkit' });

const PREP = () => {
  localStorage.setItem('daikome_training_consent', 'dismissed');
  localStorage.setItem('pwa_banner_dismissed', '1');
  localStorage.setItem('apk_banner_dismissed', '1');
  localStorage.setItem('tutorial_done', '1');
  try {
    Object.defineProperty(window.navigator, 'standalone', { get: () => true, configurable: true });
  } catch (_) {}
  const _mm = window.matchMedia.bind(window);
  window.matchMedia = (q) => {
    const r = _mm(q);
    if (String(q).includes('display-mode: standalone')) {
      return {
        ...r,
        matches: true,
        media: q,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
      };
    }
    return r;
  };
};

async function toIdle(page) {
  await page.evaluate(() => {
    ['dlOverlay', 'trainingConsentBanner', 'pwaBanner', 'apkBanner', 'sensorRestoreBanner'].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      }
    );
    sessionStorage.setItem('sensorGranted', '1');
    sessionStorage.setItem('sensor_permission_active', '1');
    window._compassGranted = true;
    window._motionGranted = true;
    // 画面側のグローバル関数（window 経由で呼ぶ＝lint の no-undef を踏まない）
    if (typeof window.showScreen === 'function') window.showScreen('businessStart');
    if (typeof window.onBusinessStart === 'function') window.onBusinessStart();
  });
  await page.waitForTimeout(900);
}

async function look(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.btn-main-idle-portrait');
    const cs = el && getComputedStyle(el);
    const hint = document.getElementById('dataReadyHint');
    return {
      ある: !!el,
      opacity: cs ? Number(cs.opacity) : null,
      押せる: cs ? cs.pointerEvents !== 'none' && !el.disabled : null,
      案内:
        hint && getComputedStyle(hint).display !== 'none' ? (hint.textContent || '').trim() : '',
    };
  });
}

test('準備できている時は 濃くて押せる', async ({ page }) => {
  await page.addInitScript(PREP);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const v = (window.DataRegistry && window.DataRegistry.VERSION) || '0';
    localStorage.setItem('daikome_warmup_v1', JSON.stringify({ version: v, at: 1 }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await toIdle(page);

  const r = await look(page);
  expect(r.ある, '★代行開始ボタンが無い★').toBe(true);
  expect(r.opacity, '★準備できているのに薄い★').toBeGreaterThan(0.9);
  expect(r.押せる, '★準備できているのに押せない★').toBe(true);
});

test('★準備中は 薄くて押せない＋理由が出る★（見た目だけ普通、を作らない）', async ({ page }) => {
  await page.addInitScript(PREP);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // ★道データの版が上がった時と同じ状態を作る（印の版だけ古くする）★
  await page.evaluate(() => {
    localStorage.setItem('daikome_warmup_v1', JSON.stringify({ version: 'OLD-0000', at: 1 }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await toIdle(page);

  const r = await look(page);
  expect(r.ある, '★代行開始ボタンが無い★').toBe(true);
  expect(r.押せる, '★準備中なのに押せる＝不完全なデータで業務が始まる★').toBe(false);
  expect(
    r.opacity,
    '★押せないのに濃いまま＝「押しても何も起きない」に見える（司さんが困った形）★'
  ).toBeLessThan(0.7);
  expect(r.案内, '★押せない理由が画面に出ていない★').toContain('準備中');
});
