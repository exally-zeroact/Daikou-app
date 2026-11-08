// ============================================================
// ★★OBD の 進みの 字が 帯に 届く・切れた 帯に 進みの 字を 出さない★★ 2026-11-09
//
//   ★穴★ js/obd-client.js の _listeners に susumi が 無く、on('susumi') は 黙って 捨てられていた
//     ＝09-08（司さん「直せや」）の「機械を 起こしています（あと 約4秒）」は 作った 日から 1回も 出ていなかった。
//     前の 試験（obd-susumi-dasu）は 字の 数を 数える だけ＝本物の 道を 1回も 通らずに 緑だった。
//   ★ここで 守る 事★（設計 C:/Users/zeroa/sekkei_obd_susumi_2026-11-09.md v1・設計前 taiketsu）
//     ①本物の OBDClient＋偽の bluetooth で チップを 押す → 帯に「⏳ OBD 機械に つないでいます」
//     ②業務中に 切れた 帯に 古い 進みの 字（つながりました）が 残っていても「⚠ OBDが切れました」
//     ③段 tsunagi_naoshi で 古い 訳の 字が 残っていても「つなぎ直しています」（注4）
//     ④訳の 字（ayamari）は 切れた 帯に 出す（今の まま）
//   ★帯の 字は 500ms ごとの 書き直しで しか 変わらない★（_obdBarKakinaosu は 空の 関数）＝読む 前に 1.5秒 待つ
// ============================================================
const { test, expect } = require('@playwright/test');

function gyoumuChu() {
  const now = Date.now();
  return JSON.stringify({
    active: true,
    start_time: now - 60 * 60 * 1000,
    end_time: null,
    ended: false,
    ended_at: null,
    total_distance_m: 12000,
    actual_total_m: 12000,
    fare_total_yen: 3000,
    trip_count: 1,
    trips: [],
    last_meter_distance_m: 12000,
  });
}

const obiJi = (page) =>
  page.evaluate(() => {
    const b = document.getElementById('obdReconnectBar');
    return { mieru: b ? b.offsetHeight > 0 : false, ji: b ? (b.textContent || '').trim() : '' };
  });

test('★★① 本物の 道で 進みの 字が 帯に 届く（チップを 押す→機械に つないでいます）★★', async ({
  page,
}) => {
  // ★gatt.connect が 返らない 機械★＝段 gatt の まま 止まる（帯は 業務の 外でも 繋ぐ 途中は 出る）
  await page.addInitScript(() => {
    try {
      const dev = {
        id: 'NISE',
        name: 'OBDII',
        gatt: { connect: () => new Promise(() => {}), connected: false, disconnect: () => {} },
        addEventListener: () => {},
        removeEventListener: () => {},
      };
      Object.defineProperty(navigator, 'bluetooth', {
        configurable: true,
        value: {
          requestDevice: async () => dev,
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
  await page.waitForFunction(
    () => typeof window._obdOsu === 'function' && !!window.OBDClient,
    null,
    { timeout: 15000 }
  );
  await page.click('#obdChip');
  await page.waitForTimeout(1500);
  const r = await obiJi(page);
  const dan = await page.evaluate(() => window.OBDClient.getDan());
  // eslint-disable-next-line no-console
  console.log('★押した 後★ ' + JSON.stringify(Object.assign({ dan }, r)));
  expect(dan, '★段が gatt に なっていません（試験の 前提が 崩れた）★').toBe('gatt');
  expect(r.mieru, '★繋ぐ 途中なのに 帯が 出ていません★').toBe(true);
  expect(r.ji, '★進みの 字が 帯に 届いていません★（_listeners に susumi が 無い 形）').toMatch(
    /^⏳ OBD 機械に つないでいます/
  );
});

async function kireta(page) {
  await page.addInitScript((bs) => {
    try {
      localStorage.setItem('dk_obd_tsunaida', '1');
      localStorage.setItem('dk_obd_kono_gyoumu', '1');
      localStorage.setItem('daikou_business_state', bs);
    } catch (_) {
      /* ignore */
    }
  }, gyoumuChu());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.OBDClient, null, { timeout: 15000 });
  // ★CI の Linux には bluetooth が 無い★＝isSupported だけ 差し替える（obd-gohou-futago と 同じ）
  await page.evaluate(() => {
    window.OBDClient.isSupported = () => true;
  });
  // ★猶予の 4秒を 越えて 切れた 帯が 出るまで 待つ★
  await page.waitForFunction(
    () => {
      const c = document.getElementById('obdChipLabel');
      return !!c && (c.textContent || '').trim() === 'OBD 再接続';
    },
    null,
    { timeout: 15000 }
  );
}

async function ji(page, j, kara, dan) {
  await page.evaluate(
    (a) => {
      window._obdSusumiJi = a.j;
      window._obdSusumiKara = a.kara;
      window._obdSusumiMade = 0;
      if (a.dan) window.OBDClient.getDan = () => a.dan;
    },
    { j, kara, dan }
  );
  await page.waitForTimeout(1500);
  return obiJi(page);
}

test('★★② 切れた 帯に 古い 進みの 字（つながりました）を 出さない★★', async ({ page }) => {
  await kireta(page);
  const r = await ji(page, 'つながりました', 'susumi');
  // eslint-disable-next-line no-console
  console.log('★切れた 帯・進みの 字★ ' + JSON.stringify(r));
  expect(r.mieru).toBe(true);
  expect(r.ji, '★切れたのに 帯が「つながりました」★').toBe('⚠ OBDが切れました — タップで再接続');
});

test('★★③ つなぎ直しの 段は 古い 訳の 字より「つなぎ直しています」★★', async ({ page }) => {
  await kireta(page);
  const r = await ji(
    page,
    'OBDの 機械から 返事が ありません。一度 抜いて 挿し直して もう一度 押してください。',
    'ayamari',
    'tsunagi_naoshi'
  );
  // eslint-disable-next-line no-console
  console.log('★つなぎ直し・古い 訳★ ' + JSON.stringify(r));
  expect(r.ji, '★つなぎ直しの 字が 古い 字に 負けています★（注4）').toBe(
    '⏳ OBD つなぎ直しています（タップで選び直し）'
  );
});

test('★④ 訳の 字は 切れた 帯に 出す（今の まま）★', async ({ page }) => {
  await kireta(page);
  const wake = '車から 返事が ありません。エンジンを かけた まま もう一度 押してください。';
  const r = await ji(page, wake, 'ayamari');
  expect(r.ji, '★切れた 帯から 訳が 消えました★').toBe(wake);
});
