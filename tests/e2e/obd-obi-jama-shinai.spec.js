// ============================================================
// ★★OBD の 赤帯は 邪魔を しない★★ 2026-09-09
//
//   ★司さん（実物の 写真 2枚）★
//     「この警告だして 設定とか ホームの 位置 変えるなや ぼけ」
//     「なんで 英語に かわったんど ぼけ」
//
//   ★★実物で 起きていた 2つ★★
//     ①開いた だけで 赤帯「OBDは 業務開始の 時に つなぎます」
//         ⇒ ★2026-09-08 に 私が 足した 物★。要らない。
//     ②機械を 選ぶ 窓を ★閉じた だけ★で 赤帯に
//         "User cancelled the requestDevice() chooser."
//         ＝★ブラウザが 返す 生の 英語★
//         ⇒ やめたのは ★間違いでは ない★。何も 出さない。
//
//   ★★帯 そのものは 消していません★★
//     走っている 途中で OBD が 切れたら 出す（2026-06-30 司さん）。
//     ★出ないと 距離が 黙って 減る★ので そこは 守る。
//
//   ★★ここで 守る 事★★
//     ①開いた だけでは 帯が 出ない
//     ②帯に ★英語だけの 字★を 出さない
//     ③帯は ★青バーの 真下に 浮く★（下の 中身を 1px も 動かさない）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-09 実測 ＝ 下に 書く）★★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

test('★★① 開いた だけでは 赤帯を 出さない★★', async ({ page }) => {
  // ★前に OBD を 使った 端末★（一番 出やすい 形で 見る）
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dk_obd_tsunaida', '1');
    } catch (_) {
      /* ignore */
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const r = await page.evaluate(() => {
    const b = document.getElementById('obdReconnectBar');
    return {
      aru: !!b,
      mieru: b ? b.offsetHeight > 0 : false,
      ji: b ? (b.textContent || '').trim() : '',
      susumi: window._obdSusumiJi || '',
    };
  });
  // eslint-disable-next-line no-console
  console.log('★開いた だけ★ ' + JSON.stringify(r));
  expect(r.aru, '★帯そのものが 消えています★（切れた 時に 出せなく なります）').toBe(true);
  expect(r.mieru, '★開いた だけで 赤帯が 出ています★').toBe(false);
  expect(r.susumi, '★開いた だけで 帯に 出す 字を 用意しています★').toBe('');
});

test('★★② 帯に 英語だけの 字を 出さない★★', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // ★本物の 受け口に 本物の 英語を 流す★（写しを 作らない）
  const r = await page.evaluate(() => {
    const O = window.OBDClient;
    if (!O || typeof O.emit !== 'function') {
      // emit が 外に 出ていない 作りなら 受け口を 直接 叩く
      return { tsukaenai: true };
    }
    O.emit('error', 'User cancelled the requestDevice() chooser.');
    return { tsukaenai: false, susumi: window._obdSusumiJi || '' };
  });

  if (r.tsukaenai) {
    // ★字を 読んで 見る★（受け口を 外から 叩けない 作りの 時）
    const i = HTML.indexOf("O.on('error', function (msg) {");
    expect(i, '★エラーの 受け口が ありません★').toBeGreaterThan(0);
    const naka = HTML.slice(i, i + 1600);
    // ★日本語かを 見てから 帯に 入れる★ 段が 在るか
    expect(
      /_nihongo\s*\?\s*_m\s*:\s*''/.test(naka),
      '★生の 字を そのまま 帯に 入れています★（英語が 出ます）'
    ).toBe(true);
    expect(
      naka.indexOf('window._obdSusumiJi = String(msg'),
      '★生の 字を そのまま 帯に 入れる 行が 残っています★'
    ).toBe(-1);
    return;
  }
  // eslint-disable-next-line no-console
  console.log('★英語を 流した 後★ ' + JSON.stringify(r));
  expect(r.susumi, '★英語が そのまま 帯に 出ます★').toBe('');
});

test('★★③ 帯は 青バーの 真下に 浮く（中身を 動かさない）★★', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const r = await page.evaluate(() => {
    const b = document.getElementById('obdReconnectBar');
    if (!b) return null;
    const naka = document.querySelector('main, #home, .page, body > div');
    const mae = naka ? Math.round(naka.getBoundingClientRect().top) : null;
    b.style.display = 'flex';
    b.textContent = '⚠ OBDが切れました — タップで再接続';
    const ato = naka ? Math.round(naka.getBoundingClientRect().top) : null;
    const st = getComputedStyle(b);
    return { pos: st.position, mae: mae, ato: ato };
  });
  // eslint-disable-next-line no-console
  console.log('★帯を 出した 時★ ' + JSON.stringify(r));
  expect(r, '★帯が ありません★').not.toBeNull();
  expect(r.pos, '★帯が 流れの 中に 在ります★（下の 中身が 動きます）').toBe('fixed');
  if (r.mae !== null) {
    expect(r.ato, '★帯を 出したら 下の 中身が 動きました★').toBe(r.mae);
  }
});

test('★★④ 帯の 置き場所を 切れた時だけに していない★★', () => {
  // ★★実測（2026-09-09）★★
  //   前は if (_showRecon) の 中でだけ top を 入れていた ので
  //   進み具合を 出す 時は top:auto ＝ ★置き場所が 成り行き任せ★だった。
  const i = HTML.indexOf("var reconBar = document.getElementById('obdReconnectBar');");
  expect(i, '★帯を 書き直す 所が ありません★').toBeGreaterThan(0);
  const naka = HTML.slice(i, i + 2200);
  const top = naka.indexOf('reconBar.style.top');
  expect(top, '★帯の 置き場所を 入れていません★').toBeGreaterThan(0);
  // ★その 行が if (_showRecon) の 中に 入っていない★
  const jouken = naka.lastIndexOf('if (_showRecon)', top);
  expect(jouken, '★置き場所が 切れた時だけに なっています★（進み具合の 時に ずれます）').toBe(-1);
});

test('★★⑤ 業務が 始まる 前は 帯を 出さない★★', async ({ page }) => {
  // ★★実測（2026-09-09）★★
  //   帯の 条件は「いつか 一度でも 使った」だけだったので
  //   ★開いた だけで 4秒後に「OBDが切れました」★が 出ていた。
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dk_obd_tsunaida', '1');
    } catch (_) {
      /* ignore */
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // ★ゆうよの 4秒を 越えて から 見る★
  await page.waitForTimeout(7000);
  const r = await page.evaluate(() => {
    const b = document.getElementById('obdReconnectBar');
    const c = document.getElementById('obdChipLabel');
    return {
      mieru: b ? b.offsetHeight > 0 : false,
      chip: c ? (c.textContent || '').trim() : '',
    };
  });
  // eslint-disable-next-line no-console
  console.log('★業務前（7秒後）★ ' + JSON.stringify(r));
  expect(r.mieru, '★業務が 始まって いないのに 赤帯が 出ています★').toBe(false);
  expect(r.chip, '★業務前なのに 「OBD 再接続」に なっています★').toBe('OBD');
});

test('★★⑥ 業務中に 切れたら 帯は 出す（消していない）★★', () => {
  // ★守る 事★ 走っている 途中に 切れたら 必ず 出す
  //   （2026-06-30 司さん「全部の画面に 途切れたら 出して」）
  const i = HTML.indexOf('var _obdDropped =');
  expect(i, '★切れたかの 判定が ありません★').toBeGreaterThan(0);
  const naka = HTML.slice(i, i + 220);
  expect(naka.indexOf('_obdWasConnected'), '★一度 繋いだ かを 見ていません★').toBeGreaterThan(0);
  expect(naka.indexOf('_gyoumuChuDaKa'), '★業務中かを 見ていません★').toBeGreaterThan(0);
  // ★帯そのものを 消して いない★
  expect(HTML.indexOf('id="obdReconnectBar"'), '★帯を 消してしまいました★').toBeGreaterThan(0);
});
