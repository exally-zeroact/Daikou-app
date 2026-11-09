// ============================================================
// ★★車待ちから 黙って 緑に 戻った 後に 切れても 古い 訳を 出さない★★ 2026-11-09（候補①）
//
//   ★穴★ 車待ち（kuruma_machi・訳「エンジンを かけた まま…」を 出した 後）から
//     最初の 正しい 車速・走りの 途中の 回復で 段だけ 緑に して 字を 出さなかった
//     ⇒ 字の 出どころ（_obdSusumiKara）が 訳の まま＝後で 切れた 帯に 古い 訳が 出て「切れました」が 出なかった
//     ⇒ 設定の 字（#obdNote）にも「エラー: 車から 返事が…」が「接続済み」の 横に 残った（設計前 taiketsu 止め1）
//   ★道★（設計前 taiketsu 止め2）機械の 側から 切れると 自動の 繋ぎ直しが 字を 書き換える＝直す 前でも 緑になる。
//     ⇒ 業務中に 手で 切る（OBDClient.disconnect）道で 組む＝直す 前は 帯が 古い 訳で 赤。
//   本物の OBDClient＋偽の bluetooth（tests/unit/obd-tsunagi-joutai の makeDev を 写した 物）
// ============================================================
const { test, expect } = require('@playwright/test');

const WAKE = '車から 返事が ありません。エンジンを かけた まま もう一度 押してください。';

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

test('★★車待ち→黙って 緑→手で 切る＝帯は「切れました」・設定に 古い エラーが 残らない★★', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.addInitScript((bs) => {
    try {
      localStorage.setItem('dk_obd_tsunaida', '1');
      localStorage.setItem('dk_obd_kono_gyoumu', '1');
      localStorage.setItem('daikou_business_state', bs);
    } catch (_) {
      /* ignore */
    }
    try {
      // ★偽の 機械★ window.__niseKuruma＝'damaru'（0100・010D に NO DATA）／'hanasu'（全部 返す）
      window.__niseKuruma = 'damaru';
      const kotae = (cmd) => {
        if (window.__niseKuruma === 'damaru' && (cmd === '0100' || cmd === '010D'))
          return 'NO DATA\r\r>';
        if (cmd === '0100') return '41 00 BE 3E B8 11\r\r>';
        if (cmd === '010D') return '41 0D 3C\r\r>';
        return 'OK\r\r>';
      };
      let notify = null;
      let connected = false;
      const kikite = new Set();
      const dv = (s) => {
        const b = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
        return new DataView(b.buffer);
      };
      const notifyChar = {
        startNotifications: () => Promise.resolve(notifyChar),
        addEventListener: (t, h) => {
          if (t === 'characteristicvaluechanged') notify = h;
        },
        removeEventListener: (t, h) => {
          if (notify === h) notify = null;
        },
      };
      const writeChar = {
        writeValueWithoutResponse: (buf) => {
          let s = '';
          for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
          const r = kotae(s.replace(/\r/g, '').trim());
          Promise.resolve().then(() => {
            if (notify) notify({ target: { value: dv(r) } });
          });
          return Promise.resolve();
        },
      };
      const service = {
        getCharacteristic: (u) =>
          Promise.resolve(
            u.indexOf('fff1') >= 0 || u.indexOf('6e400003') >= 0 ? notifyChar : writeChar
          ),
      };
      const server = {
        get connected() {
          return connected;
        },
        getPrimaryService: (u) =>
          u.indexOf('fff0') >= 0
            ? Promise.resolve(service)
            : Promise.reject(new Error('no service')),
        disconnect: () => {
          if (!connected) return;
          connected = false;
          setTimeout(() => Array.from(kikite).forEach((h) => h()), 0);
        },
      };
      const dev = {
        id: 'NISE',
        name: 'OBDII',
        gatt: {
          connect: () => {
            connected = true;
            return Promise.resolve(server);
          },
          disconnect: () => server.disconnect(),
          get connected() {
            return connected;
          },
        },
        addEventListener: (t, h) => {
          if (t === 'gattserverdisconnected') kikite.add(h);
        },
        removeEventListener: (t, h) => {
          if (t === 'gattserverdisconnected') kikite.delete(h);
        },
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
  }, gyoumuChu());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!window.OBDClient && !!document.getElementById('obdNote'),
    null,
    {
      timeout: 15000,
    }
  );
  await page.evaluate(() => {
    window.OBDClient.connect().catch(() => {});
  });
  // ①車が 黙る＝車待ち・訳が 出る
  await page.waitForFunction(() => window.OBDClient.getDan() === 'kuruma_machi', null, {
    timeout: 45000,
  });
  const mae = await page.evaluate(() => ({
    kara: window._obdSusumiKara,
    ji: window._obdSusumiJi,
    note: (document.getElementById('obdNote').textContent || '').trim(),
  }));
  // eslint-disable-next-line no-console
  console.log('★車待ち★ ' + JSON.stringify(mae));
  expect(mae.kara, '★試験の 前提（訳が 出た）が 崩れた★').toBe('ayamari');
  expect(mae.ji).toBe(WAKE);
  expect(mae.note).toBe('エラー: ' + WAKE);

  // ②エンジンが かかった＝次の 車速で 黙って 緑
  await page.evaluate(() => {
    window.__niseKuruma = 'hanasu';
  });
  await page.waitForFunction(() => window.OBDClient.getDan() === 'tsunagatta', null, {
    timeout: 15000,
  });
  await page.waitForTimeout(300);
  const midori = await page.evaluate(() => ({
    kara: window._obdSusumiKara,
    note: (document.getElementById('obdNote').textContent || '').trim(),
  }));
  // eslint-disable-next-line no-console
  console.log('★緑★ ' + JSON.stringify(midori));
  expect(midori.note, '★緑なのに 設定に 古い エラーが 残っています★（止め1）').not.toContain(
    'エラー'
  );

  // ③業務中に 手で 切る→4秒の 猶予の 後に 帯
  await page.evaluate(() => window.OBDClient.disconnect());
  await page.waitForFunction(
    () => {
      const c = document.getElementById('obdChipLabel');
      return !!c && (c.textContent || '').trim() === 'OBD 再接続';
    },
    null,
    { timeout: 15000 }
  );
  await page.waitForTimeout(1500);
  const obi = await page.evaluate(() => {
    const b = document.getElementById('obdReconnectBar');
    return { mieru: b ? b.offsetHeight > 0 : false, ji: b ? (b.textContent || '').trim() : '' };
  });
  // eslint-disable-next-line no-console
  console.log('★切れた 帯★ ' + JSON.stringify(obi));
  expect(obi.mieru).toBe(true);
  expect(obi.ji, '★切れた 帯に 古い 訳（エンジン）が 出ています★').toBe(
    '⚠ OBDが切れました — タップで再接続'
  );
});
