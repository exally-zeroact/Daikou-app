// ============================================================
// ★★誤報の 双子＝「今日 挿さない」だけで「切れました」と 言わない★★ 2026-09-10
//
//   ★指示役の 監査①（実測で 再現した）★
//     `_obdWasConnected` は `localStorage dk_obd_tsunaida` ＝
//     ★「いつか 一度でも 使った」★ であって
//     ★「今回の 業務で 繋いでいた」★では ない。
//
//   ★実測（直す 前）★
//     dk_obd_tsunaida='1'（昨日 使った）＋ 業務中（start_time 在り）＋ OBD 挿さない
//     ⇒ ★4秒後に「⚠ OBDが切れました」／チップも「OBD 再接続」★
//     ⇒ ★何も 切れて いない★
//
//   ★直し★ ★「この 業務で 繋いだか」★ という 別の 印を 持つ
//     ・業務開始 … false／繋がった … true
//   ★localStorage は 消していません★
//     ＝業務開始で 自動で 繋ぎに 行く 判断に 使う ため。
//
//   ★★ここで 守る 事は 2つ★★
//     ①今日 挿さない だけで 出さない（誤報を 出さない）
//     ②★この 業務で 繋いだ のに 切れたら 必ず 出す★（守りを 弱めない）
//       ＝2026-06-30 司さん「全部の画面に 途切れたら 出して」
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-10 実測）★★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const HTML = fs
  .readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8')
  .replace(/\r\n/g, '\n');

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

// ★★Web Bluetooth が 無い 所でも 同じ 答えに する★★ 2026-09-10（実測）
//   ★手元（Windows）★ navigator.bluetooth 在り ⇒ isSupported() = true
//   ★CI（Linux headless）★ 無し ⇒ isSupported() = false
//   ⇒ 帯の 判定は `_obdSupported` が false だと ★必ず 出ない★
//   ⇒ ★手元は 緑・CI だけ 赤★ に なっていた（今日 何度も 踏んだ 型）
//   ★直し★ 本物の OBDClient の isSupported だけ 差し替える。
//     （毎回の 書き直しで 呼ばれるので 後から でも 効く＝実測）
async function tsukaeruKotoNiSuru(page) {
  await page.evaluate(() => {
    if (window.OBDClient) window.OBDClient.isSupported = () => true;
  });
  // ★書き直しの 1回ぶん 待つ★
  await page.waitForTimeout(1500);
}

test('★★① 今日 挿さない だけでは 出さない★★', async ({ page }) => {
  await page.addInitScript((bs) => {
    try {
      localStorage.setItem('dk_obd_tsunaida', '1');
      localStorage.setItem('daikou_business_state', bs);
    } catch (_) {
      /* ignore */
    }
  }, gyoumuChu());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await tsukaeruKotoNiSuru(page);
  // ★猶予の 4秒を 越えて から 見る★
  await page.waitForTimeout(8000);
  const r = await page.evaluate(() => {
    const b = document.getElementById('obdReconnectBar');
    const c = document.getElementById('obdChipLabel');
    return {
      obi: b ? b.offsetHeight > 0 : false,
      chip: c ? (c.textContent || '').trim() : '',
    };
  });
  // eslint-disable-next-line no-console
  console.log('★今日 挿さない★ ' + JSON.stringify(r));
  expect(r.obi, '★何も 切れて いないのに 赤帯が 出ています★').toBe(false);
  expect(r.chip, '★何も 切れて いないのに 「OBD 再接続」に なっています★').toBe('OBD');
});

test('★★② この 業務で 繋いだ のに 切れたら 出す（守りを 弱めない）★★', () => {
  // ★★字で 見る 訳★★
  //   本物の Bluetooth を 繋いでから 切る のは 実ブラウザでは 作れない。
  //   ⇒ ★判定の 式に 4つとも 在るか★ を 見る。
  //     どれか 1つでも 抜けたら 意味が 変わる。
  const i = HTML.indexOf('var _obdDropped =');
  expect(i, '★切れたかの 判定が ありません★').toBeGreaterThan(0);
  const j = HTML.indexOf(';', i);
  const shiki = HTML.slice(i, j + 1);
  // eslint-disable-next-line no-console
  console.log('★判定の 式★ ' + shiki.replace(/\s+/g, ' '));
  [
    ['_obdSupported', '★この 端末で 使えるかを 見ていません★'],
    ['!_obdConnected', '★今 切れているかを 見ていません★'],
    ['_obdWasConnected', '★一度 繋いだ かを 見ていません★'],
    ['_gyoumuChuDaKa', '★業務中かを 見ていません★'],
    ['_konoGyoumuDeTsunaidaKa()', '★この 業務で 繋いだ かを 見ていません★'],
  ].forEach((x) => {
    expect(shiki.indexOf(x[0]), x[1]).toBeGreaterThan(-1);
  });

  // ★印が 立つ 所・消える 所が 本当に 在るか★
  expect(
    HTML.indexOf('if (_obdConnected) _konoGyoumuHozon(true);'),
    '★繋がっても 印が 立ちません★（切れても 出なく なります）'
  ).toBeGreaterThan(0);
  expect(
    HTML.indexOf('window._obdGyoumuKaishiDeShirushiKesu();'),
    '★業務開始で 印を 消していません★（昨日の 印を 引きずります）'
  ).toBeGreaterThan(0);

  // ★★localStorage は 消していない★★（自動で 繋ぎに 行く 判断に 要る）
  expect(
    HTML.indexOf('localStorage.removeItem(_OBD_TSUNAIDA_KEY)') > 0 ||
      HTML.indexOf('_obdTsunaidaHozon(true)') > 0,
    '★前に 使った 端末の 覚えが 消えました★（自動接続が 効かなく なります）'
  ).toBe(true);
});

test('★★③ 帯そのものは 消していない★★', () => {
  expect(HTML.indexOf('id="obdReconnectBar"'), '★帯を 消してしまいました★').toBeGreaterThan(0);
  expect(HTML.indexOf('⚠ OBDが切れました'), '★切れた時の 字が ありません★').toBeGreaterThan(0);
});

// ★★2026-09-10 追記＝指示役の 追い監査で 見つかった 私の 新しい 穴★★
//   最初の 直しでは `var _konoGyoumuDeTsunaida = false;`＝★メモリの 上★に 置いた。
//   ⇒ ★読み直し（リロード／タスクキル）で false に 戻る★
//   ⇒ その後 本当に 切れても ★帯が 出ない★
//   ⇒ ★守ると 決めた 当の 物が 読み直し 1回で 死ぬ★
//   ⇒ ★localStorage に 移した★（start_time と 同じ 寿命）
test('★★④ 印は 読み直しても 消えない（メモリの 上に 置かない）★★', () => {
  // ★① 覚え先を 持っているか★
  expect(
    HTML.indexOf("_KONO_GYOUMU_KEY = 'dk_obd_kono_gyoumu'"),
    '★覚え先が ありません★'
  ).toBeGreaterThan(0);
  expect(HTML.indexOf('localStorage.setItem(_KONO_GYOUMU_KEY'), '★書いていません★').toBeGreaterThan(
    0
  );
  expect(HTML.indexOf('localStorage.getItem(_KONO_GYOUMU_KEY'), '★読んでいません★').toBeGreaterThan(
    0
  );

  // ★② 判定が ★読む方★を 使っているか（メモリの 変数を 見ていないか）★
  const i = HTML.indexOf('var _obdDropped =');
  const shiki = HTML.slice(i, HTML.indexOf(';', i) + 1);
  expect(shiki.indexOf('_konoGyoumuDeTsunaidaKa()'), '★覚え先から 読んでいません★').toBeGreaterThan(
    -1
  );
  expect(
    /_konoGyoumuDeTsunaida[^K(]/.test(shiki),
    '★メモリの 変数を まだ 見ています★（読み直しで 消えます）'
  ).toBe(false);

  // ★③ 業務開始で 消す・繋がったら 書く・手で切ったら 消す★
  expect(HTML.indexOf('_konoGyoumuHozon(false)'), '★消す 所が ありません★').toBeGreaterThan(0);
  expect(
    HTML.indexOf('if (_obdConnected) _konoGyoumuHozon(true);'),
    '★繋がっても 書いていません★'
  ).toBeGreaterThan(0);
});

test('★★⑤ 読み直しても 帯が 出る（実ブラウザ）★★', async ({ page }) => {
  // ★★実測の しかた★★
  //   「この 業務で 繋いだ」印を ★覚え先に 置いてから★ 開く
  //   ＝★読み直した 直後★と 同じ 形。OBD は 繋がっていない。
  //   ⇒ 帯が 出れば「読み直しで 守りが 消えない」事の 証拠。
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
  await page.waitForTimeout(2500);
  await tsukaeruKotoNiSuru(page);
  await page.waitForTimeout(8000);
  const r = await page.evaluate(() => {
    const b = document.getElementById('obdReconnectBar');
    const c = document.getElementById('obdChipLabel');
    return {
      obi: b ? b.offsetHeight > 0 : false,
      ji: b ? (b.textContent || '').trim() : '',
      chip: c ? (c.textContent || '').trim() : '',
    };
  });
  // eslint-disable-next-line no-console
  console.log('★読み直した 後★ ' + JSON.stringify(r));
  expect(r.obi, '★読み直したら 守りが 消えました★（切れても 気づけません）').toBe(true);
  expect(r.chip, '★チップが 変わっていません★').toBe('OBD 再接続');
});

// ★★2026-09-10 追記＝指示役の「業務終了で 消しているか」の 一言から 見つけた★★
//   ★実測★ Business.end() は ★start_time を 残します★
//     （active=false / ended=true に するだけ。「業務再開」ボタンを 出す 為・index.html:9120）
//   ⇒ start_time だけを 見ていた 私の 判定は
//     ★仕事が 終わった 後も ずっと「業務中」★と 読んでいた。
//   ⇒ ★実測で 帯が 出た★（active:false, ended:true なのに）
//   ⇒ ★active も 見る★形に 直した。
function gyoumuOwari() {
  const now = Date.now();
  return JSON.stringify({
    active: false,
    start_time: now - 3 * 3600 * 1000,
    end_time: now - 60000,
    ended: true,
    ended_at: now - 60000,
    total_distance_m: 12000,
    actual_total_m: 12000,
    fare_total_yen: 3000,
    trip_count: 1,
    trips: [],
    last_meter_distance_m: 12000,
  });
}

test('★★⑥ 業務が 終わった 後は 出さない★★', async ({ page }) => {
  await page.addInitScript((bs) => {
    try {
      localStorage.setItem('dk_obd_tsunaida', '1');
      localStorage.setItem('dk_obd_kono_gyoumu', '1');
      localStorage.setItem('daikou_business_state', bs);
    } catch (_) {
      /* ignore */
    }
  }, gyoumuOwari());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await tsukaeruKotoNiSuru(page);
  await page.waitForTimeout(8000);
  const r = await page.evaluate(() => {
    const b = document.getElementById('obdReconnectBar');
    const c = document.getElementById('obdChipLabel');
    return {
      obi: b ? b.offsetHeight > 0 : false,
      chip: c ? (c.textContent || '').trim() : '',
    };
  });
  // eslint-disable-next-line no-console
  console.log('★業務が 終わった 後★ ' + JSON.stringify(r));
  expect(r.obi, '★仕事が 終わったのに 赤帯が 出ています★').toBe(false);
  expect(r.chip, '★仕事が 終わったのに 「OBD 再接続」に なっています★').toBe('OBD');
});

test('★★⑦ 判定は start_time だけに 寄りかからない★★', () => {
  const i = HTML.indexOf('_gyoumuChuDaKa = !!(');
  expect(i, '★業務中かの 判定が ありません★').toBeGreaterThan(0);
  const gyou = HTML.slice(i, HTML.indexOf(';', i) + 1);
  // eslint-disable-next-line no-console
  console.log('★業務中かの 判定★ ' + gyou.replace(/\s+/g, ' '));
  expect(gyou.indexOf('start_time'), '★始まった かを 見ていません★').toBeGreaterThan(-1);
  expect(
    gyou.indexOf('active'),
    '★start_time だけを 見ています★（Business.end() は start_time を 残すので 終了後も 出ます）'
  ).toBeGreaterThan(-1);
});
