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
//       設定の #obdStatus も「接続済み」に しない＝「OBD 待ち」（本番前 叩き直しの 止め1・同じ 形の 穴）
//     ②段 tsunagatta で 3つとも 緑・設定は「接続済み」
//
//   ★わざと壊す★ index.html の `if (_obdDan === 'tsunagatta') {` を `if (_obdConnected) {` に 戻すと ①が 赤
//     （点は `_obdDan === 'tsunagatta' ? 'gps-dot ok'` を `_obdConnected ? 'gps-dot ok'` に 戻すと 赤）
//     （設定は `_obdStatusJi` の 中の `return 'OBD 待ち'` を `return JA[s]` に 戻すと 赤3）
//     （500ms 毎の 書き直しの `if (statusEl && _obdConnected) statusEl.textContent` の 行を 消すと ②が 赤）
//     （`_obdStatusJi` を 前の「段が hanasu／kuruma_machi の 時だけ OBD 待ち」に 戻すと 繋いだ 瞬間の 字で 赤）
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
    // ★本物の 順★ js/obd-client.js は status connected を 出した 時は 段が まだ okosu、
    //   その 後で 段を hanasu／tsunagatta に 変える（status の 知らせは もう 来ない）
    //   ⇒ 段を 変えた 後の 字は 500ms 毎の 書き直しだけが 作る＝その 1行を 消すと 赤（叩き直しの 任意1）
    O.getDan = () => 'okosu';
    uke.forEach((cb) => cb('connected'));
    // ★繋いだ 瞬間（段 okosu）の 字★＝知らせの 時に もう「OBD 待ち」（前の 関数に 戻すと「接続済み」で 赤・叩き直しの 任意1）
    const stEl = document.getElementById('obdStatus');
    const shunkan = stEl ? (stEl.textContent || '').trim() : null;
    O.getDan = () => d;
    return { ok: true, shunkan };
  }, d);
  expect(ok && ok.ok, '★OBDClient か status の 受け口が ありません★').toBe(true);
  expect(ok.shunkan, '★繋いだ 瞬間（車と 話す前）に 設定が「OBD 待ち」で ない★').toBe('OBD 待ち');
  // ★見た目は 500ms 毎に 書き直す★
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const b = document.getElementById('bizObdConnect');
    const dot = document.getElementById('obdDot');
    const chip = document.getElementById('obdChip');
    const st = document.getElementById('obdStatus');
    return {
      settei: st ? (st.textContent || '').trim() : null,
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
    expect(r.settei, '★車と 話す前なのに 設定が「接続済み」★').toBe('OBD 待ち');
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
  expect(r.settei, '★車と 話せたのに 設定が「接続済み」で ない★').toBe('接続済み');
});
