// ============================================================
// ★★高速代・橋代を「入れる 所」が 見つかるか★★ 2026-09-06（司さん）
//
//   ★司さんの言葉★「橋代や高速代など入力するタブは？」
//
//   ★実測（言われて 調べた）★
//     ★入れる 所は 前から 在りました★（uriage.html の 車の札 →「日ごと ▾」の 中）。
//     ・売上表の 上には「売上から 引くもの ☑高速代 ☑橋代」の ★チェックだけ★ 在る
//     ・でも ★入れる 欄は 札を 開かないと 出て こない★
//     ⇒ ★在るのに 見つからない＝無いのと 同じ★。司さんは 2週間 気づけませんでした。
//
//   ★直し★（★中身は 1つも 変えていません★／★どこに 在るかを 書いただけ★）
//     ①札の 名前 …「日ごと ▾」→「★日ごと ▾（高速代・橋代を 入れる）★」
//     ②紙の 表の すぐ下に ★道順の 1行★ を 出す
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①札の 名前を「日ごと ▾」に 戻す … ★赤★
//     ②道順の 1行を 消す ……………… ★赤★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'uriage.html'), 'utf8');

test('★★① 札の 名前に「高速代・橋代を 入れる」と 書いてある★★', async () => {
  // ★振る舞いで 見る★＝画面に 出る 字（openText）そのもの
  //   ★札は 2つ 在ります★
  //     ・車ごと の 中 …「日ごと ▾」→ ★shiftLine＝ここに 入れる 欄が 在る★
  //     ・日ごと の 中 …「車ごと ▾」→ carLine（入れる 欄は 無い）
  //   ⇒ ★入れる 欄に 繋がる 方（shiftLine の 札）だけ★ を 見る
  const re = /openText:\s*'([^']*)'[\s\S]{0,120}?detail:\s*[^\n]*?(\w+)\)\.join/g;
  const fuda = {};
  let m;
  while ((m = re.exec(SRC))) fuda[m[2]] = m[1];
  // eslint-disable-next-line no-console
  console.log('★札の 名前★ ' + JSON.stringify(fuda));
  const ji = fuda.shiftLine || '';
  expect(ji, '★入れる欄に 繋がる 札が 読めません（形が 変わりました）★').toBeTruthy();
  expect(ji, '★開かないと 何が 在るか 分かりません★').toContain('高速代');
  expect(ji, '★開かないと 何が 在るか 分かりません★').toContain('橋代');
});

// ★画面を 開かずに 実物の 中身で 見る★
//   （事務所の 画面は ログインが 無いと login.html へ 飛ぶので、
//     ★見たいのは 置き場所と 字★＝実物の HTML を そのまま 読む方が 確か）
test('★★② 実費を 入れる 所が 紙の 表の すぐ下に 書いてある★★', async () => {
  const t = SRC.indexOf('id="kamiTbl"');
  const n = SRC.indexOf('id="jippiNote"');
  // eslint-disable-next-line no-console
  console.log('★置き場所★ 紙の表=' + t + ' / 道順=' + n);
  expect(n, '★実費の 道順が ありません★').toBeGreaterThan(0);
  expect(n, '★紙の 表より 上に 在ります（順番が 逆）★').toBeGreaterThan(t);
  const ji = SRC.slice(n, n + 400).replace(/\s+/g, '');
  expect(ji, '★高速代・橋代と 書いていません★').toContain('高速代');
  expect(ji, '★高速代・橋代と 書いていません★').toContain('橋代');
});

test('★★③ 入れる 欄そのものは 前から 在る（消していない）★★', async () => {
  // ★直しで 中身を 消していない事★＝3つの 欄が そのまま 在る
  ['toll_yen', 'bridge_yen', 'other_yen'].forEach(function (f) {
    expect(SRC.indexOf('data-f="' + f + '"'), '★' + f + ' の 欄が 消えています★').toBeGreaterThan(
      0
    );
  });
});
