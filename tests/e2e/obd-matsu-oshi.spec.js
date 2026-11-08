// ============================================================
// ★★OBD 待ち（車が 黙った＝段 kuruma_machi）の 間に 押すと 繋ぎに 行く★★ 2026-11-09
//
//   ★穴★ 車が 黙ると js/obd-client.js が「もう一度 押してください」と 出すのに、
//     status は connected の まま＝_obdOsu は チップ・業務ボタンを「切る」、設定の 接続は「何もしない」。
//     ⇒ 言われた 通り 押すと 切れるだけ／設定の 接続は 何も 起きなかった。
//
//   ★ここで 守る 事★（設計 C:/Users/zeroa/sekkei_obd_matsu_botan_2026-11-08.md v1・v1.1）
//     ①段 kuruma_machi で チップ・業務開始の ボタン・設定の 接続を 本当に 押す → connect 1・disconnect 0
//     ②段 hanasu／tsunagatta で チップ・業務ボタン → disconnect 1・connect 0（今の まま）
//     ③設定の 切断（btnD）は どの 段でも disconnect 1（今の まま）
//
//   ★CI の Linux には navigator.bluetooth が 無い★＝チップの 聞き手は 読み込みの 時に
//     O.isSupported() の 時だけ 付く ⇒ 読み込みの 前に addInitScript で 差し込む（設計前 taiketsu 2回目の 止め）
//
//   ★わざと壊す★（2026-11-09 手元 chromium で 測った 数）
//     index-src/4480.js の `O.getDan() === 'kuruma_machi' &&` の 分岐（if ごと）を 消すと ①の 3本が 赤3
//     その 1行（段の 条件）だけ 消して 全部の 段で 繋ぎに 行く 形に すると ②の 4本が 赤4
//     下の addInitScript を `value: undefined` に すると チップ 3本＋設定の 接続 1本が 赤4
//       （Windows の chromium は 元から bluetooth を 持つ＝この 差し込みが CI の Linux で 押せる 訳）
// ============================================================
const { test, expect } = require('@playwright/test');

async function hiraku(page) {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'bluetooth', {
        configurable: true,
        value: {
          requestDevice: () => new Promise(() => {}),
          getDevices: async () => [],
          getAvailability: async () => true,
          addEventListener: () => {},
        },
      });
    } catch (_) {
      /* 差し込めない 時は 下の 確かめで 赤 */
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // ★固定の 待ちに しない★（作った物の taiketsu 任意3）＝押しの 口が 出来るまで 待つ
  await page.waitForFunction(
    () => typeof window._obdOsu === 'function' && !!window.OBDClient,
    null,
    { timeout: 15000 }
  );
}

// ★OBDClient を 差し替え★ connect・disconnect を 数える。status は connected・段は d
async function dan(page, d) {
  const ok = await page.evaluate((d) => {
    const O = window.OBDClient;
    if (!O || typeof window._obdOsu !== 'function') return false;
    window.__kazu = { connect: 0, disconnect: 0 };
    O.isSupported = () => true;
    O.getStatus = () => 'connected';
    O.isConnected = () => true;
    O.getDare = () => null;
    O.getDan = () => d;
    O.connect = () => {
      window.__kazu.connect++;
      return new Promise(() => {});
    };
    O.disconnect = () => {
      window.__kazu.disconnect++;
    };
    return true;
  }, d);
  expect(ok, '★OBDClient か _obdOsu が ありません★').toBe(true);
}

const kazu = (page) => page.evaluate(() => window.__kazu);

async function osu(page, kuchi) {
  if (kuchi === 'chip') {
    await page.click('#obdChip');
  } else if (kuchi === 'gyoumu') {
    await page.evaluate(() => window.showScreen('businessStart'));
    await page.click('#bizObdConnect');
  } else if (kuchi === 'settei') {
    await page.evaluate(() => window.showOverlay('settings'));
    await page.click('#btnObdConnect');
  } else if (kuchi === 'kiru') {
    await page.evaluate(() => window.showOverlay('settings'));
    await page.click('#btnObdDisconnect');
  }
  await page.waitForTimeout(300);
}

for (const kuchi of ['chip', 'gyoumu', 'settei']) {
  test(`★★① 段 kuruma_machi で ${kuchi} を 押すと 繋ぎに 行く（切らない）★★`, async ({ page }) => {
    await hiraku(page);
    await dan(page, 'kuruma_machi');
    await osu(page, kuchi);
    const k = await kazu(page);
    // eslint-disable-next-line no-console
    console.log(`★kuruma_machi ${kuchi}★ ` + JSON.stringify(k));
    expect(k.disconnect, `★車が 黙った 時に ${kuchi} を 押したら 切れた★`).toBe(0);
    expect(k.connect, `★車が 黙った 時に ${kuchi} を 押しても 繋ぎに 行かない★`).toBe(1);
  });
}

for (const d of ['hanasu', 'tsunagatta']) {
  for (const kuchi of ['chip', 'gyoumu']) {
    test(`★② 段 ${d} で ${kuchi} は 今の まま 切る★`, async ({ page }) => {
      await hiraku(page);
      await dan(page, d);
      await osu(page, kuchi);
      const k = await kazu(page);
      expect(k.disconnect, `★段 ${d} で ${kuchi} を 押しても 切れない★`).toBe(1);
      expect(k.connect, `★段 ${d} で ${kuchi} を 押したら 繋ぎに 行った★`).toBe(0);
    });
  }
}

for (const d of ['kuruma_machi', 'hanasu', 'tsunagatta']) {
  test(`★③ 段 ${d} で 設定の 切断は 切る★`, async ({ page }) => {
    await hiraku(page);
    await dan(page, d);
    await osu(page, 'kiru');
    const k = await kazu(page);
    expect(k.disconnect, `★段 ${d} で 切断を 押しても 切れない★`).toBe(1);
    expect(k.connect).toBe(0);
  });
}
