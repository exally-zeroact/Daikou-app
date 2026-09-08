// ============================================================
// ★★OBD＝運転手の 手間を 増やさない★★ 2026-09-08
//
//   ★司さん★「ユーザーにめんどくさいことやらすな」
//
//   ★★何が めんどくさかったか★★
//     ①起動時の 自動接続は ★端末の 設定次第で 黙って 失敗する★
//       （前に 許した 機械の 一覧が 空で 返る 端末が ある）
//       ⇒ 毎回「OBDを接続」を 押して 一覧から 選ぶ 羽目に なる
//     ②失敗を ★握りつぶして いた★ ので 繋がっていない事に 気づけない
//
//   ★★直し★★
//     ★もともと 必ず 押す「業務開始」に ぶら下げる★（押す 回数は 増やさない）
//       ・Web Bluetooth は ★人が 押した 瞬間★でないと 機械を 選べない 決まり
//         ⇒ onBusinessStart の ★一番 先★で 呼ぶ
//       ・★前に OBD を 使った 端末だけ★（使っていない 人には 何も 出さない）
//       ・★業務開始は 絶対に 止めない★（選ぶのを やめても そのまま 始まる）
//
//   ★★ここで 守る 一番 大事な 事★★
//     ★OBD が どうなろうと 業務開始が 止まらない★
//     （OBD の ために 仕事が 止まったら 本末転倒）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-08 実測 ＝ 下に 書く）★★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

test('★★① 業務開始の 一番 先で OBD を 繋ぎに 行く★★', async () => {
  const i = HTML.indexOf('function onBusinessStart() {');
  expect(i, '★業務開始が ありません★').toBeGreaterThan(0);
  const naka = HTML.slice(i, i + 1400);
  const yobu = naka.indexOf('_obdGyoumuKaishiDeTsunagu');
  expect(yobu, '★業務開始で OBD を 繋ぎに 行っていません★').toBeGreaterThan(0);
  // ★人が 押した 瞬間の 権利が 切れない よう「一番 先」で 呼ぶ★
  const hoka = naka.indexOf('performance.mark');
  expect(
    yobu < hoka,
    '★OBD を 呼ぶ 前に 別の 処理が 入っています★ ⇒ 機械を 選べなく なります'
  ).toBe(true);
});

test('★★② OBD が どうなっても 業務開始は 止まらない★★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  // ★★「前に OBD を 使った」を 本物の 覚え先に 入れる★★ 2026-09-08
  //   ★見張りの 間違い（実測）★ window._obdWasConnected を 立てても
  //   中の 囲いの 変数には 届かず ★壊しても 緑の まま★でした。
  //   ⇒ ★本物が 読む 所（localStorage）★に 入れてから 開く。
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dk_obd_tsunaida', '1');
    } catch (_) {
      /* ignore */
    }
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const r = await page.evaluate(() => {
    // ★OBD を わざと 壊す★（繋ごうとすると 必ず こける 形）
    if (window.OBDClient) {
      window.OBDClient.connect = function () {
        window.__obdConnectYonda = (window.__obdConnectYonda || 0) + 1;
        throw new Error('わざと こけさせた');
      };
      window.OBDClient.isSupported = function () {
        return true;
      };
      window.OBDClient.isConnected = function () {
        return false;
      };
      window.OBDClient.getStatus = function () {
        return 'idle';
      };
    }
    let nageta = null;
    try {
      if (typeof window._obdGyoumuKaishiDeTsunagu === 'function') {
        window._obdGyoumuKaishiDeTsunagu();
      }
    } catch (e) {
      nageta = String(e && e.message);
    }
    return {
      aru: typeof window._obdGyoumuKaishiDeTsunagu === 'function',
      nageta: nageta,
      yonda: window.__obdConnectYonda || 0,
    };
  });
  // eslint-disable-next-line no-console
  console.log('★OBD を 壊した時★ ' + JSON.stringify(r));
  expect(r.aru, '★業務開始で 繋ぐ 仕掛けが ありません★').toBe(true);
  // ★★本当に 呼ばれた 事を 確かめる★★（呼ばれずに 緑＝見ていないのと 同じ）
  expect(r.yonda, '★繋ぎに 行っていません（見張りが 何も 見ていない）★').toBe(1);
  expect(r.nageta, '★OBD が こけると 業務開始まで 止まります★（仕事が 止まる）').toBeNull();
  expect(err, '★画面が 落ちました★').toEqual([]);
});

test('★★③ OBD を 使っていない 人には 何も 出さない★★', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    let yonda = 0;
    window._obdWasConnected = false; // ★一度も 使っていない★
    if (window.OBDClient) {
      window.OBDClient.isSupported = function () {
        return true;
      };
      window.OBDClient.isConnected = function () {
        return false;
      };
      window.OBDClient.getStatus = function () {
        return 'idle';
      };
      window.OBDClient.connect = function () {
        yonda++;
        return Promise.resolve();
      };
    }
    if (typeof window._obdGyoumuKaishiDeTsunagu === 'function') {
      window._obdGyoumuKaishiDeTsunagu();
    }
    return { yonda: yonda };
  });
  // eslint-disable-next-line no-console
  console.log('★使っていない 人★ ' + JSON.stringify(r));
  expect(r.yonda, '★OBD を 使っていない 人にも 機械の 一覧を 出しています★').toBe(0);
});
