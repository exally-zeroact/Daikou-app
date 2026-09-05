// ============================================================
// ★★業務中に 新しい版が 来ても 読み直さない★★ 2026-09-06（司さん）
//
//   ★司さんの言葉★
//     「なんで距離や課金変わらんってあれだけゆうて変わったんど」
//     「今までなかってなんでなったんど」
//
//   ★何が 起きていたか（実測 2026-09-06）★
//     事務所の 画面しか 直していなくても ★sw.js の 版★は 変わります。
//     版が 変わると index.html が ★走行中でも location.reload()★ を していました。
//       ①読み直し ＝ ★OBD の Bluetooth が 切れる★
//       ②★「OBDが切れました」の 赤バーが 出ない★（_obdWasConnected が 0 に 戻る為）
//       ③自動で 繋ぎ直すのは ★Android Chrome だけ★
//       ④OBD が 死んだ間の 穴は ★位置の直線★で 埋まる ＝★道より 短い★
//     ⇒★画面は まとも・距離だけ 少ない★
//     ⇒★09-04 17:29〜09-05 16:16 に 版が 6回 変わった＝「今までなかった」の 正体★
//
//   ★この 見張りが 守る 物（1つずつ）★
//     ①★業務中（Business.getState().start_time が 在る）なら 読み直さない★
//     ②★業務が 終わったら（start_time が 消えたら）★ちゃんと 読み直す★
//        （＝「読み直さない」だけ 入れて 新しい版が 一生 当たらない、を 防ぐ）
//     ③★一度 OBD に 繋いだ事を 端末に 覚える★（読み直しても 警告が 出る）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①_gyoumuChuu() を () => false に する ……… ★赤★（①の 段）
//     ②業務終了後の setInterval を 消す ………… ★赤★（②の 段）
//     ③_obdTsunaidaHozon(true) を 消す ………… ★赤★（③の 段）
//
//   ★この 見張りは 実物の index.html を 読んで 走らせます★
//     （文字を 探すだけの 見張りは 名前を 変えられたら 死ぬ＝会社の 決まり）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

// ★実物から「SW の 読み直しの 段」を 切り出して 走らせる★
//   ＝ index.html を 丸ごと 開くと 位置情報や Bluetooth が 要るので、
//     ★守りたい 段だけ★ を 取り出して 動かす。
function toriDasu() {
  // ★改行の 形に 依らない★（手元は CRLF・GitHub は LF＝今日 3回 踏んだ）
  const hajime = SRC.indexOf('const _hadSWController');
  if (hajime < 0) return '';
  const m = /navigator\.serviceWorker\r?\n {10}\.register/.exec(SRC.slice(hajime));
  return m ? SRC.slice(hajime, hajime + m.index) : '';
}

test('★★① 業務中は 読み直さない／② 終わったら 読み直す★★', async ({ page }) => {
  const dan = toriDasu();
  expect(dan.length, '★SW の 段が 取り出せません（形が 変わりました）★').toBeGreaterThan(200);

  const r = await page.evaluate(
    ({ dan }) => {
      const out = { chuu: null, ato: null, err: null };
      try {
        let reloads = 0;
        let start_time = 111; // ★業務中★
        const kikai = {
          // 読み直しの 代わりに 数える
          location: {
            reload: function () {
              reloads++;
            },
          },
          Business: {
            getState: function () {
              return { start_time: start_time };
            },
          },
          dlog: function () {},
          timers: [],
          setInterval: function (fn) {
            this.timers.push(fn);
            return this.timers.length;
          },
        };
        let handler = null;
        const nav = {
          serviceWorker: {
            controller: {}, // ★既に 版が 在る（初回登録では ない）★
            addEventListener: function (na, fn) {
              if (na === 'controllerchange') handler = fn;
            },
          },
        };
        // ★段を そのまま 走らせる★
        const f = new Function(
          'navigator',
          'window',
          'Business',
          'dlog',
          'setInterval',
          dan + '\n;return { gyoumuChuu: _gyoumuChuu };'
        );
        f(nav, kikai, kikai.Business, kikai.dlog, kikai.setInterval.bind(kikai));

        // ★①業務中に 新しい版が 来た★
        handler();
        out.chuu = reloads; // ★0 が 正しい★

        // ★②業務が 終わった → 待っていた 分を 当てる★
        start_time = null;
        kikai.timers.forEach(function (fn) {
          fn();
        });
        out.ato = reloads; // ★1 が 正しい★
      } catch (e) {
        out.err = String((e && e.message) || e);
      }
      return out;
    },
    { dan }
  );

  // eslint-disable-next-line no-console
  console.log('★読み直しの 回数★ ' + JSON.stringify(r));
  expect(r.err, '★段が 動きませんでした★').toBe(null);
  expect(r.chuu, '★業務中なのに 読み直しました（距離が 消える 形）★').toBe(0);
  expect(r.ato, '★業務が 終わっても 新しい版を 当てていません★').toBe(1);
});

test('★★③ 一度 繋いだ事を 端末に 覚える（読み直しても 警告が 出る）★★', async () => {
  // ★覚える／消す が 3か所 とも 在るか★（振る舞いで 見る）
  const tsunaida = (SRC.match(/_obdTsunaidaHozon\(true\)/g) || []).length;
  const keshita = (SRC.match(/_obdTsunaidaHozon\(false\)/g) || []).length;
  // eslint-disable-next-line no-console
  console.log('★覚える ' + tsunaida + '／消す ' + keshita + '★');
  expect(tsunaida, '★繋がった時に 覚えていません★').toBe(1);
  expect(keshita, '★手動で 切った時に 消していません（2か所)★').toBe(2);

  // ★読み込む 側★＝変数の 初期値が localStorage から 来ているか
  expect(
    /_obdWasConnected\s*=\s*\(function\s*\(\)\s*\{[\s\S]{0,200}getItem\(_OBD_TSUNAIDA_KEY\)/.test(
      SRC
    ),
    '★読み直した時に 覚えた分を 読んでいません★'
  ).toBe(true);
});

test('★★④ OBD の 赤バーが 青バー・overlay より 上に 居る★★', async () => {
  // ★司さんの 元の 指示（2026-06-30）★「全部の画面に 途切れたら 出して」
  //   ★私が 09-05 に z-index を 70 に して、青バー(120)・overlay(80) の 下に 潜らせた★
  //   ⇒ 出ない 画面が 出来た＝OBD が 切れても 運転手が 気づけない
  const bar = SRC.slice(SRC.indexOf('id="obdReconnectBar"'));
  const m = bar.match(/z-index:\s*(\d+)/);
  const z = m ? parseInt(m[1], 10) : -1;
  // ★比べる 相手も 実物から 読む★（数を 手で 書かない）
  const ov = SRC.match(/\.spa-overlay\s*\{[\s\S]{0,400}?z-index:\s*(\d+)/);
  const zov = ov ? parseInt(ov[1], 10) : -1;
  // eslint-disable-next-line no-console
  console.log('★赤バー z=' + z + '／overlay z=' + zov + '★');
  expect(z, '★赤バーの z-index が 読めません★').toBeGreaterThan(0);
  expect(zov, '★overlay の z-index が 読めません★').toBeGreaterThan(0);
  expect(z, '★赤バーが overlay の 下に 潜っています★').toBeGreaterThan(zov);
  expect(z, '★赤バーが 常駐青バー(120) の 下に 潜っています★').toBeGreaterThan(120);
});
