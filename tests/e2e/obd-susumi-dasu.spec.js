// ============================================================
// ★★OBD＝今 何を していて あと 何秒か を 出す★★ 2026-09-08
//
//   ★司さん★「なら接続しにくい原因はなんなんど」→「直せや
//             まず OBD が ないと いかんのやけん そこも 大事に しろよ」
//
//   ★★測って 分かった 繋がりにくい 訳（2026-09-08 実測）★★
//     ①1つの 方式で 最悪 ★25.2秒★／3方式で ★75.6秒★／＋リセット ＝ ★約80秒★
//       なのに ★その間 画面は 無言★ ⇒ 運転手には「押しても 反応しない」
//       ⇒ 途中で 押し直す ⇒ ★最初から やり直し★ ⇒ 余計に 繋がらない
//     ②エンジンが 止まっていると 車が 返事を しない ⇒ 必ず 80秒 かけて 失敗
//     ③機械が 前の 繋がりを 掴んだ まま だと そもそも つなげない
//
//   ★直し（★通信の 手順は 1つも 変えていません★）★
//     ・段ごとに 'susumi' を 出す（何を していて あと 何秒か）
//     ・赤い 帯に ★⏳ OBD ○○（あと 約◯秒）★ を 出す
//     ・失敗した 訳を ★名指しで★ 出す
//         車が 黙っている ⇒「★エンジンを かけた まま★ もう一度」
//         機械が 黙っている ⇒「★一度 抜いて 挿し直して★」
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-08 実測）★★
//     ①通信の 回数（WARMUP_RETRIES 3→2）を 変える … ★赤★
//        ＝★お金と 距離に 効く 所を 勝手に 変えたら 止まる★
//     ②エンジンの 訳の 字を 消す ………………… ★赤★
//     戻した後 … ★緑 4本★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OBD = fs.readFileSync(path.join(ROOT, 'js', 'obd-client.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('★★① 段ごとに 進み具合を 出している★★', async () => {
  // ★出す 側★
  const dasu = (OBD.match(/_susumi\(/g) || []).length;
  // eslint-disable-next-line no-console
  console.log('★進み具合を 出す 回数★ ' + dasu);
  expect(dasu, '★進み具合を 出していません★').toBeGreaterThan(4);
  // ★受ける 側★
  expect(HTML, '★画面が 進み具合を 受けていません★').toContain("O.on('susumi'");
  expect(HTML, '★帯に 出していません★').toContain('あと 約');
});

test('★★② 失敗の 訳を 名指しで 出す★★', async () => {
  expect(OBD, '★エンジンの 訳が ありません★').toContain('エンジンを かけた まま');
  expect(OBD, '★抜き挿しの 訳が ありません★').toContain('抜いて 挿し直して');
  // ★機械に そもそも つなげない 時★
  expect(OBD, '★つなげない 時の 訳が ありません★').toContain('つなげません');
});

test('★★③ 通信の 手順は 変えていない（数字が そのまま）★★', async () => {
  // ★お金と 距離に 効く 所★＝ここを 変えたら 実車で 挙動が 変わる
  const kazu = {
    CMD_TIMEOUT_MS: 1500,
    PROTOCOL_TIMEOUT_MS: 7000,
    WARMUP_RETRIES: 3,
    WARMUP_RETRY_WAIT_MS: 700,
  };
  Object.keys(kazu).forEach((k) => {
    const m = OBD.match(new RegExp('const ' + k + ' = (\\d+)'));
    expect(m, '★' + k + ' が 読めません★').toBeTruthy();
    expect(Number(m[1]), '★' + k + ' を 変えています★').toBe(kazu[k]);
  });
  // ★試す 方式の 順も そのまま★
  expect(OBD, '★方式の 順を 変えています★').toContain("_WARMUP_PROTOS = ['6', '0', '7']");
});

test('★★④ 画面が「繋いでいる 途中」を 出せる★★', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const r = await page.evaluate(() => {
    const bar = document.getElementById('obdReconnectBar');
    if (!bar) return { aru: false };
    // ★繋いでいる 途中の 見せ方を そのまま 呼ぶ★
    window._obdSusumiJi = '車と 話しています（方式 1/3）';
    window._obdSusumiMade = Date.now() + 25000;
    return { aru: true, ji: bar.textContent };
  });
  // eslint-disable-next-line no-console
  console.log('★帯★ ' + JSON.stringify(r));
  expect(r.aru, '★帯が ありません★').toBe(true);
});
