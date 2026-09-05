// ============================================================
// ★★代行の 距離係数は「設定が 壊れていても」必ず 当たる★★ 2026-09-06（司さん）
//
//   ★司さんの言葉★「なんで距離や課金変わらんってあれだけゆうて変わったんど」
//                   「原因さがせや」
//
//   ★見つけた 落とし穴（実物の コードで 確かめた）★
//     `index.html` の `loadSettings()` は 途中に ★try で 守られていない JSON.parse★ を
//     持っていました（`daikou_settings` を 読む所）。
//     そこが 1回でも こけると:
//       ①呼ぶ側が try/catch で ★黙って 飲み込む★（画面には 何も 出ない）
//       ②⇒ その 後ろに 在った `Meter.setDaikouDistanceFactor(1.0085)` まで ★来ない★
//       ③⇒ 係数は 既定の ★1.0 のまま★
//     ★1.0 のままだと 2つ 同時に 起きる★
//       ・代行の ★+0.85%★ が 乗らない
//       ・`js/meter.js:137` の `daikouMode: _daikouDistFactor > 1.0` が ★false★
//         ⇒ pipeline の OBD天井の 分位が ★p50 → p25★
//         ⇒ ★js/pipeline-distance.js 199行に 実測で こう 書いてある★
//            「絶対速度の窓 p25 を天井にすると…★実走検証で -16%判明★」
//     ⇒★★合わせて 約 -17%。★画面にも 倉庫にも 何も 残らない★★
//
//   ★直し★ ★係数を loadSettings の 一番 先に 当てる★（手前の 何が こけても 無関係）
//           ＋ ★JSON.parse を その場で 受け止める★（後ろを 止めない）
//   ★数字は 1つも 変えていない（1.0085 のまま・当てる 順番だけ）★
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①係数の 行を 元の 場所（parse の 後ろ）に 戻す … ★赤★
//     ②JSON.parse の try を 外す ………………………… ★赤★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

// ★実物から loadSettings を そのまま 切り出す★（写しを 作らない）
function toriDasu() {
  const h = SRC.indexOf('      function loadSettings() {');
  if (h < 0) return '';
  // ★関数の 閉じ★＝同じ 段の '      }'
  // ★改行の 形に 依らない★（手元は CRLF・GitHub は LF）
  const m = /\r?\n {6}\}\r?\n/.exec(SRC.slice(h));
  return m ? SRC.slice(h, h + m.index + m[0].length) : '';
}

async function hashiraseru(page, kowasu) {
  const dan = toriDasu();
  expect(dan.length, '★loadSettings が 取り出せません（形が 変わりました）★').toBeGreaterThan(400);
  return await page.evaluate(
    ({ dan, kowasu }) => {
      const out = { yonda: null, err: null, kakeru: null };
      try {
        let kakeru = 1.0; // ★既定＝当たらなかった時の 値★
        const store = {};
        // ★ここが 肝★ 壊れた設定を 置く（実際に 端末で 起こり得る）
        store['daikou_settings'] = kowasu ? '{こわれた' : JSON.stringify({ vehicleId: 'v1' });
        const nise = {
          localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => {
              store[k] = String(v);
            },
          },
          Meter: {
            setDaikouDistanceFactor: function (f) {
              kakeru = f;
            },
            setFareConfig: function () {},
          },
          FareConfigStore: {
            yomuOffline: function () {
              return { config: {} };
            },
            torikomu: function () {
              return { then: function () {} };
            },
          },
          console: { error: function () {} },
        };
        const f = new Function(
          'localStorage',
          'Meter',
          'FareConfigStore',
          'console',
          'var surchargeEnabled, surchargeRate, vehicleId;' + dan + ';return loadSettings;'
        );
        const ls = f(nise.localStorage, nise.Meter, nise.FareConfigStore, nise.console);
        // ★実物の 呼び側と 同じ＝try/catch で 包む（黙って 飲み込む所まで 真似る）★
        try {
          ls();
        } catch (e) {
          out.yonda = 'throw:' + String((e && e.message) || e);
        }
        out.kakeru = kakeru;
      } catch (e) {
        out.err = String((e && e.message) || e);
      }
      return out;
    },
    { dan, kowasu }
  );
}

test('★★① 設定が まともな時は 係数 1.0085 が 当たる★★', async ({ page }) => {
  const r = await hashiraseru(page, false);
  // eslint-disable-next-line no-console
  console.log('★まとも★ ' + JSON.stringify(r));
  expect(r.err, '★段が 動きませんでした★').toBe(null);
  expect(r.kakeru, '★代行の 係数が 当たっていません★').toBe(1.0085);
});

test('★★② 設定が 壊れていても 係数 1.0085 は 当たる（-17%の 穴）★★', async ({ page }) => {
  const r = await hashiraseru(page, true);
  // eslint-disable-next-line no-console
  console.log('★壊れた設定★ ' + JSON.stringify(r));
  expect(r.err, '★段が 動きませんでした★').toBe(null);
  expect(
    r.kakeru,
    '★設定が 壊れると 係数が 1.0 のまま＝+0.85%が 乗らず、daikouMode も false に なって 天井が p25 に 落ちます（実測 -16%）★'
  ).toBe(1.0085);
  // ★JSON の こけ方で 落ちていない事★（後ろの 段は 試験の 仕掛けに 無い変数を 使うので
  //   別の 理由では 落ちます。★見たいのは「設定の 壊れ」で 落ちていない事★）
  expect(
    String(r.yonda || ''),
    '★壊れた設定の JSON で 落ちています（そこで 止まると 後ろが 全部 当たりません）★'
  ).not.toMatch(/JSON|Unexpected token/i);
});
