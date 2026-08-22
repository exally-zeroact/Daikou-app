'use strict';
// ============================================================
// ★売上の画面を「読める一覧＋バー」にする★ 2026-08-09
//
//   ★司さんの言葉★
//     「4 売上を１日おきと車おきで見れないかんやろ」
//     「全体的に表が見にくいから他のアプリの用に見せるようにしろってもゆうたよな」
//
//   ★今どうだったか（測った）★
//     ・7列の表（車 / 件数 / 実車距離 / 総走行距離 / 売上 / 引いた分 / 開くボタン）
//       スマホの幅では ★横に流れて読めない★
//     ・日ごとは ★1台を開いた時だけ★＝全部の車を合わせた「その日いくら」が出ない
//
//   ★どう変えるか★
//     ・上に切り替え「車ごと／日ごと」
//     ・1行＝名前（または日付）＋売上を大きく＋★バー★＋小さい字で内訳
//       （アマかせと同じ「読める一覧＋バー」。散布図は使わない）
//     ・押すと開く … 車ごと→その車の日 ／ 日ごと→その日の車
//
//   ★数字は1円も変えない★（byDay と byDevice の合計が一致することは
//     tests/unit/uriage-byday.test.js で毎回突き合わせている）
// ============================================================
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'uriage.html'), 'utf8');

describe('★切り替えがある★', () => {
  it('「車ごと」「日ごと」の両方のボタンがある', () => {
    expect(HTML, '★切り替えが無い＝日ごとが見られない★').toContain('id="segCar"');
    expect(HTML).toContain('id="segDay"');
    expect(HTML).toContain('車ごと');
    expect(HTML).toContain('日ごと');
  });

  it('★日ごとは UriageAgg.byDay を使う★（画面で足し直さない）', () => {
    expect(HTML, '★画面で別に足している＝車ごとと食い違う元★').toContain('UriageAgg.byDay(');
  });

  it('車ごとは今までどおり UriageAgg.byDevice を使う', () => {
    expect(HTML).toContain('UriageAgg.byDevice(');
  });
});

describe('★横に流れる表をやめる★', () => {
  it('売上の一覧に <table> を使っていない', () => {
    // 表そのものを消す（スマホで7列は読めない）
    expect(HTML.includes('<table id="tbl">'), '★7列の表が残っている★').toBe(false);
    expect(HTML.includes('<tbody id="tbody">'), '★表の中身が残っている★').toBe(false);
  });

  it('★バーがある★（読める一覧＋バー）', () => {
    expect(HTML, 'バーの入れ物が無い').toContain('class="rbar"');
  });

  it('★散布図は使わない★', () => {
    expect(HTML.toLowerCase()).not.toContain('scatter');
  });
});

describe('★今できていた事を落としていない★', () => {
  it('車の名前を変えられる', () => {
    expect(HTML, '★名前を変える所を消している★').toContain('class="carname"');
  });

  it('高速代・橋代・その他を手で直せる', () => {
    expect(HTML).toContain('data-f="toll_yen"');
    expect(HTML).toContain('data-f="bridge_yen"');
    expect(HTML).toContain('data-f="other_yen"');
  });

  it('売上から引く物の設定が残っている', () => {
    for (const id of ['dToll', 'dBridge', 'dOther']) expect(HTML).toContain('id="' + id + '"');
  });

  it('月の行き来が残っている', () => {
    expect(HTML).toContain('id="prevM"');
    expect(HTML).toContain('id="nextM"');
  });

  it('★取れなかった時の帯が残っている★（0と混ぜない）', () => {
    expect(HTML).toContain('showUnknownBar');
  });
});

describe('★手で入れた分は そうと分かる★', () => {
  it('「手で入れた分」の断り書きが残っている', () => {
    expect(HTML).toContain('手で入れた分');
  });
});
