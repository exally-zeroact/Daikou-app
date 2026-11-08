// ============================================================
// ★★OBD の 緑は 車と 話せてから（業務開始の ボタン・チップの 点も）★★ 2026-11-08
//
//   ★本番前 taiketsu 止め1★
//     チップは 段（getDan）で 緑に したが、業務開始の ボタン #bizObdConnect と
//     チップの 点 #obdDot は status=connected（機械に 繋いだ 瞬間）で 緑の ままだった。
//     ⇒ 車と 話す 25〜50秒・車が 黙る 間も「✅ OBD接続済」＝運転手が 繋がったと 思って 走り出す。
//
//   ★ここで 守る 事★
//     ①段 hanasu／kuruma_machi の 間は ボタンも 点も 緑に しない（ボタンは チップと 同じ「OBD 待ち」）
//     ②段 tsunagatta で 3つとも 緑
//
//   ★わざと壊す★ index.html の `if (_obdDan === 'tsunagatta') {` を `if (_obdConnected) {` に 戻すと ①が 赤
//     （点は `_obdDan === 'tsunagatta' ? 'gps-dot ok'` を `_obdConnected ? 'gps-dot ok'` に 戻すと 赤）
// ============================================================
const { test, expect } = require('@playwright/test');

async function hiraku(page) {
  // ★index.html の status の 受け口を 拾う★（本物の OBDClient.on を 包む）
  await page.addInitScript(() => {
    window.__obdUke = {};
    let o;
    Object.defineProperty(window, 'OBDClient', {
      configurable: true,
      get: () => o,
      set: (v) => {
        o = v;
        if (v && typeof v.on === 'function') {
          const on = v.on;
          v.on = function (ev, cb) {
            (window.__obdUke[ev] = window.__obdUke[ev] || []).push(cb);
            return on.apply(this, arguments);
          };
        }
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
}

async function dan(page, d) {
  const ok = await page.evaluate((d) => {
    const O = window.OBDClient;
    const uke = (window.__obdUke && window.__obdUke.status) || [];
    if (!O || !uke.length) return false;
    O.isSupported = () => true;
    O.getStatus = () => 'connected';
    O.isConnected = () => true;
    O.getDan = () => d;
    uke.forEach((cb) => cb('connected'));
    return true;
  }, d);
  expect(ok, '★OBDClient か status の 受け口が ありません★').toBe(true);
  // ★見た目は 500ms 毎に 書き直す★
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const b = document.getElementById('bizObdConnect');
    const dot = document.getElementById('obdDot');
    const chip = document.getElementById('obdChip');
    return {
      botan: b ? (b.textContent || '').trim() : null,
      botanIro: b ? b.style.background : null,
      ten: dot ? dot.className : null,
      chip: chip ? chip.classList.contains('connected') : null,
    };
  });
}

for (const d of ['hanasu', 'kuruma_machi']) {
  test(`★★① 段 ${d}（機械に 繋いだが 車と まだ 話せていない）は 緑に しない★★`, async ({
    page,
  }) => {
    await hiraku(page);
    const r = await dan(page, d);
    // eslint-disable-next-line no-console
    console.log(`★${d}★ ` + JSON.stringify(r));
    expect(r.botan, '★業務開始の ボタンが ありません★').not.toBeNull();
    expect(r.botan, '★車と 話す前なのに ボタンが「OBD接続済」★').toBe('⏳ OBD 待ち');
    expect(r.botanIro, '★車と 話す前なのに ボタンが 緑★').not.toMatch(/52,\s*199,\s*89|#34c759/i);
    expect(r.ten, '★車と 話す前なのに チップの 点が 緑★').toBe('gps-dot');
    expect(r.chip, '★車と 話す前なのに チップが 緑★').toBe(false);
  });
}

test('★★② 段 tsunagatta（車と 話せた）で ボタン・点・チップの 3つとも 緑★★', async ({ page }) => {
  await hiraku(page);
  const r = await dan(page, 'tsunagatta');
  // eslint-disable-next-line no-console
  console.log('★tsunagatta★ ' + JSON.stringify(r));
  expect(r.botan, '★車と 話せたのに ボタンが「OBD接続済」で ない★').toBe('✅ OBD接続済');
  expect(r.botanIro, '★車と 話せたのに ボタンが 緑で ない★').toMatch(/52,\s*199,\s*89|#34c759/i);
  expect(r.ten, '★車と 話せたのに 点が 緑で ない★').toBe('gps-dot ok');
  expect(r.chip, '★車と 話せたのに チップが 緑で ない★').toBe(true);
});
