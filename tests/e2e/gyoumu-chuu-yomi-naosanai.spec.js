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
//   ★★2026-09-28 直し＝この 紙が 守っていた 物が 広すぎた★★
//     司さん「タスクキルせな バージョンが 更新されないのを どうにかしろ」
//     ★この 紙は「業務中＝start_time が 在るか」で 守っていた★。
//     ところが `start_time` は [業務終了] を 押しても 消えない
//     （business.js:end は ended=true に するだけ／消えるのは [終了]=abandon か 次の 業務開始）。
//     ⇒ ★仕事と 仕事の 間 ずっと「業務中」扱い★＝読み直しが 永久に 止まり、
//       ★タスクキルしか 効かない★ 状態に なっていた。
//     ⇒ ★この 紙が「実装の 形」を 守っていて「狙い」を 守っていなかった★。
//
//     ★狙いは「走行中に 切らない」★（OBD が 切れて 距離が 短く 出る）。
//     limbo（[業務終了]の 後）は
//       ・Meter.setBusinessActive(false) 済み ＝★業務の 距離を 積んでいない★
//       ・onBusinessEnd で stopGPS 済み
//       ・読み直しても 中身は localStorage から 戻る／★勝手に 再開しない★
//         （再開は [続ける]＝onResumeFromStart を 押した時だけ）
//       ・OBD の 警告は 下の ③（_obdTsunaidaHozon）で 読み直しを またいで 残る
//     ⇒ ★limbo は 読み直してよい★。守るのは ★active（業務が 動いている間）だけ★。
//
//   ★この 見張りが 守る 物（1つずつ）★
//     ①★業務が 動いている（active）なら 読み直さない★
//     ②★limbo（[業務終了]の 後）は 読み直す★（タスクキルを 要らなくする）
//     ③★業務が 終わって 印が 消えたら 待たせた 分を 当てる★
//        （＝「読み直さない」だけ 入れて 新しい版が 一生 当たらない、を 防ぐ）
//     ④★一度 OBD に 繋いだ事を 端末に 覚える★（読み直しても 警告が 出る）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①_gyoumuChuu() を () => false に する ……… ★赤★（①の 段）
//     ②業務終了後の setInterval を 消す ………… ★赤★（②の 段）
//     ③_obdTsunaidaHozon(true) を 消す ………… ★赤★（③の 段）
//   ★★2026-09-28 も 見た★★
//     判定を 前の形（start_time が 在れば 止める）に 戻す
//       ⇒ ★②の 段が 赤★（limbo で 読み直さない＝タスクキルが 必要に 戻る）
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
      const out = { chuu: null, limbo: null, ato: null, err: null };
      try {
        let reloads = 0;
        let start_time = 111; // ★業務中★
        let active = true; // ★2026-09-28 追加★ 走っているか（limbo と 分ける）
        const kikai = {
          // 読み直しの 代わりに 数える
          location: {
            reload: function () {
              reloads++;
            },
          },
          Business: {
            getState: function () {
              return { start_time: start_time, active: active };
            },
          },
          dlog: function () {},
          timers: [],
          setInterval: function (fn) {
            this.timers.push(fn);
            return this.timers.length;
          },
          // ★2026-09-28★ 段が document.addEventListener('visibilitychange') を 使う
          //   （待たせた 読み直しを 画面に 戻った時にも 当てる）。渡さないと 段が 落ちる。
          document: {
            addEventListener: function () {},
            visibilityState: 'visible',
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
          'document',
          dan + '\n;return { yoiKa: _swYominaoshiteYoiKa };'
        );
        f(nav, kikai, kikai.Business, kikai.dlog, kikai.setInterval.bind(kikai), kikai.document);

        // ★①業務が 動いている間に 新しい版が 来た★
        handler();
        out.chuu = reloads; // ★0 が 正しい★

        // ★②[業務終了] を 押した（limbo）→ ここで 当たって ほしい★
        //   ★start_time は 残ったまま★＝前の 形だと ここで 止まっていた
        active = false;
        kikai.timers.forEach(function (fn) {
          fn();
        });
        out.limbo = reloads; // ★1 が 正しい（タスクキルを 要らなくする）★

        // ★③業務が 消えた後も 1回だけ（二重に 読み直さない）★
        start_time = null;
        kikai.timers.forEach(function (fn) {
          fn();
        });
        out.ato = reloads; // ★1 のまま が 正しい★
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
  expect(r.chuu, '★業務が 動いているのに 読み直しました（距離が 消える 形）★').toBe(0);
  expect(
    r.limbo,
    '★[業務終了]の 後（limbo）で 読み直していません＝タスクキルしないと 版が 変わらない★'
  ).toBe(1);
  expect(r.ato, '★二度 読み直しています（1回だけで よい）★').toBe(1);
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
