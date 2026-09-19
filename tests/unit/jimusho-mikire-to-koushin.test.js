'use strict';
// ============================================================
// ★★事務所の 2つ★★ 2026-09-18（司さん）
//   ①「★見切れとるし★」          … 上の 字が iPhone の 時計・電池に 潜る
//   ②「★開いただけではアップデートされんやないか
//       タスクキルして初めてアップデートされるけどなんでどぼけ★」
//
//   ★①の 訳（実測 2026-09-18）★
//     事務所の 5枚は ★viewport-fit=cover★ を 付けている（画面の 端まで 広げる）。
//     ⇒ ★逃がし（env(safe-area-inset-*)）を 書かないと 上の 字が 時計に 重なる★。
//     実測 … 5枚とも viewport-fit ★在り★／safe-area ★0件★＝★5枚 全部 見切れていた★。
//     下の 帯は js/jimusho-footer.js が 既に padding-bottom:env(safe-area-inset-bottom)。
//
//   ★②の 訳（実測 2026-09-18）★
//     事務所の 5枚は ★サービスワーカーを 1つも 登録していない★
//       （grep serviceWorker … dashboard/nyuryoku/uriage/shukei/kyuryo とも ★0件★）
//       メーター index.html だけ controllerchange→reload を 持っている。
//     ⇒ ホーム画面の iPhone アプリは ★画面を 記憶に 持ったまま 復帰する★
//       ＝★取りに 行かない★＝★アプリを 切る まで 古いまま★。
//     ⇒ 直し … 戻ってきた 時に ★HEAD で ETag を 見て★ 変わっていたら 読み直す。
//       ETag は 実測で 事務所/メーター どちらの 入口でも 同じ値が 返る。
//
//   ★新しい js を 作らない★＝事務所の 中継の 名簿（office-host/vercel.json）は
//     ★2つの repo★ に 在る（Daikou-app と daikome-jimusho-host）。
//     ⇒ ★5枚が 既に 読む js/jimusho-footer.js に 入れる★。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-18 実測）★★
//     ①どれか 1枚から safe-area の 逃がしを 消す … ★赤★
//     ②jimusho-footer から visibilitychange を 消す … ★赤★
//     ③打ち込み中の 見張り（activeElement）を 消す … ★赤★
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const yomu = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

// ★事務所の 5枚★（1枚でも 抜けると そこだけ 見切れる）
const GAMEN = ['dashboard.html', 'nyuryoku.html', 'uriage.html', 'shukei.html', 'kyuryo.html'];
const FOOTER = yomu('js/jimusho-footer.js');

describe('★①事務所の 5枚が iPhone の 時計に 潜らない★', () => {
  GAMEN.forEach((f) => {
    it('★' + f + ' に 上の 逃がしが 在る★', () => {
      const s = yomu(f);
      // viewport-fit=cover を 付けている 画面だけが 対象（付けていなければ 潜らない）
      if (s.indexOf('viewport-fit=cover') < 0) return;
      expect(
        /padding-top:\s*max\([^)]*env\(safe-area-inset-top\)\)/.test(s),
        '★' +
          f +
          ' が 画面の 端まで 広がる 指定（viewport-fit=cover）なのに\n' +
          '  ★上の 逃がし（padding-top: max(…, env(safe-area-inset-top))）が 在りません★\n' +
          '  ＝iPhone の 時計・電池に 字が 潜ります（司さん「見切れとる」）'
      ).toBe(true);
    });
  });

  it('★横の 逃がしも 在る（ノッチの 横向き）★', () => {
    GAMEN.forEach((f) => {
      const s = yomu(f);
      if (s.indexOf('viewport-fit=cover') < 0) return;
      expect(/env\(safe-area-inset-left\)/.test(s), '★' + f + ' に 左の 逃がしが 在りません★').toBe(
        true
      );
      expect(
        /env\(safe-area-inset-right\)/.test(s),
        '★' + f + ' に 右の 逃がしが 在りません★'
      ).toBe(true);
    });
  });
});

describe('★②戻ってきた時に 新しく なる（タスクキル 不要）★', () => {
  it('★5枚とも 帯の js を 読んでいる（入れた 所が 全部に 効く）★', () => {
    GAMEN.forEach((f) => {
      expect(
        yomu(f).indexOf('js/jimusho-footer.js') >= 0,
        '★' + f + ' が js/jimusho-footer.js を 読んでいません★＝この画面だけ 古いまま に なります'
      ).toBe(true);
    });
  });

  it('★戻ってきた合図を 拾っている（visibilitychange と pageshow）★', () => {
    expect(
      /addEventListener\('visibilitychange'/.test(FOOTER),
      '★戻ってきた合図を 拾っていません★＝アプリを 切るまで 古いまま に 戻ります'
    ).toBe(true);
    expect(/addEventListener\('pageshow'/.test(FOOTER), '★pageshow を 拾っていません★').toBe(true);
  });

  it('★指紋を 頭だけ（HEAD）・控えを 使わずに 取る★', () => {
    expect(/method:\s*'HEAD'/.test(FOOTER), '★HEAD で 取っていません★＝丸ごと 取ると 重い').toBe(
      true
    );
    expect(
      /cache:\s*'no-store'/.test(FOOTER),
      "★cache:'no-store' が 在りません★＝控えを 読んで ★変わっていないと 勘違い★ します"
    ).toBe(true);
  });

  it('★★打ち込み中は 読み直さない（打ちかけの 数字を 消さない）★★', () => {
    expect(
      /activeElement/.test(FOOTER),
      '★打ち込み中かを 見ていません★\n' +
        '  ＝金額を 打っている 最中に 画面が 読み直され ★打ちかけが 消えます★'
    ).toBe(true);
  });

  it('★輪に ならない（1回の 変わり目で 1回だけ）★', () => {
    // 読み直した 印を 持たないと、指紋が 取れない 度に 読み直し続ける 恐れが 在る
    expect(
      /YONDA\s*=\s*true/.test(FOOTER),
      '★読み直した 印が 在りません★＝読み直しが 輪に なる 恐れが 在ります'
    ).toBe(true);
  });

  it('★圏外でも 仕事を 止めない（取れなければ 何も しない）★', () => {
    expect(/\.catch\(/.test(FOOTER), '★取れなかった時の 逃げ道が 在りません★').toBe(true);
    expect(
      /if\s*\(!ima\s*\|\|\s*!SHIMON\)\s*return;/.test(FOOTER),
      '★指紋が 取れない 時に 読み直さない 守りが 在りません★'
    ).toBe(true);
  });
});
