'use strict';
// ============================================================
// ★★実費の「消す」＝一覧から 消える。ただし ★過去の 売上は 変えない★★★ 2026-09-18
//
//   ★司さんの言葉★「消す押したら一覧から消えるようにしろや」
//
//   ★前は どうだったか★
//     「消す」＝ active=false を 書くだけ ⇒ ★一覧には 残り「使う」の ✓ が 外れるだけ★。
//     ＝「使う」の チェックを 外すのと ★全く 同じ★動きで、押しても 消えないように 見えた。
//
//   ★★この試験が 一番 守りたい物（お金）★★
//     売上の 引き算は `js/jippi-hozon.js` の goukei() が
//     ★渡された 一覧を 回して★ dk_shift_edits.expenses から 足している。
//     ⇒ 売上の 画面（uriage.html）が 消した 物を ★絞って しまうと★
//       ★過去に 入れた 実費が 売上から 引かれなく なる＝昔の 売上の 数字が 変わる★。
//     ⇒ だから ★uriage は 絞らない★／★会社設定だけ 隠す★。ここを 機械で 縛る。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-18 実測 ＝ 下に 書く）★★
//     ①dashboard の deleted_at の 絞りを 外す ……………… ★赤★（①が 落ちる）
//     ②消す を active だけに 戻す ……………………………… ★赤★（②が 落ちる）
//     ③jippiSave の body から deleted_at を 抜く ………… ★赤★（③が 落ちる）
//     ④uriage に deleted_at の 絞りを 足す ………………… ★赤★（④が 落ちる＝お金の 門）
// ============================================================

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const yomu = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const DASH = yomu('dashboard.html');
const NYURYOKU = yomu('nyuryoku.html');

describe('★実費の「消す」は 一覧から 消える（お金は 動かさない）★', () => {
  it('★① 会社設定の 一覧は deleted_at の 行を 出さない★', () => {
    // JIPPI に 入れる前に 絞っている事を 見る
    expect(
      /JIPPI\s*=\s*\(j\s*\|\|\s*\[\]\)\.filter\(/.test(DASH),
      '★dashboard が 読んだ 直後に 絞っていません★＝消した物が 一覧に 残ります'
    ).toBe(true);
    expect(
      /return\s+k\s*&&\s*!k\.deleted_at;/.test(DASH),
      '★絞りの 中身が deleted_at では ありません★'
    ).toBe(true);
  });

  it('★② 「消す」は deleted_at を 書く（active だけでは 一覧から 消えない）★', () => {
    const i = DASH.indexOf('data-keshi');
    expect(i, 'data-keshi の 消すボタンが 見つかりません').toBeGreaterThan(0);
    // 消す の onclick の あたりを 切り出して 見る
    const mawari = DASH.slice(DASH.indexOf("querySelectorAll('[data-keshi]')"));
    const kire = mawari.slice(0, 1400);
    expect(
      /deleted_at:\s*new Date\(\)\.toISOString\(\)/.test(kire),
      '★消す が deleted_at を 書いていません★＝「使う」の ✓ を 外すのと 同じに なります'
    ).toBe(true);
  });

  it('★★②-2 「消す」は active を 触らない（お金の 門・その2）★★', () => {
    // ★2026-09-18 実測で 判った★
    //   uriage.html は ★active !== false で 絞ってから★ goukei() に 渡している。
    //   ⇒ 消す が active=false を 書くと ★過去に 入れた 実費が 売上から 引かれなく なる★
    //     ＝★昔の 売上の 数字が 上がる★。だから ここは 絶対に 触らせない。
    const mawari = DASH.slice(DASH.indexOf("querySelectorAll('[data-keshi]')"));
    const kire = mawari.slice(0, 1400);
    // 送る 中身（jippiSave の {...}）だけを 見る＝覚書の 中の active は 数えない
    const hikisuu = kire.slice(kire.indexOf('jippiSave('), kire.indexOf('});') + 3);
    expect(
      /active/.test(hikisuu),
      '★消す が active を 書いています★\n' +
        '  ＝uriage は active で 絞るので ★過去の 実費が 売上から 引かれなく なります★\n' +
        '  送っている 中身: ' +
        hikisuu.replace(/\s+/g, ' ')
    ).toBe(false);
  });

  it('★③ 保存は deleted_at を 持ち越す（消した物が 生き返らない）★', () => {
    // upsert は 行を 丸ごと 置き換える。body に 無いと null に 戻る。
    expect(
      /deleted_at:\s*ima\.deleted_at\s*\|\|\s*null/.test(DASH),
      '★jippiSave の body に deleted_at が 在りません★＝' +
        '名前を 打ち直しただけで 消した物が 一覧に 戻ります'
    ).toBe(true);
  });

  // ============================================================
  // ★★④ お金の 門＝★売上は 実費の 一覧を 見ない★（司さん「売上が変わらんようにしろやぼけ」）
  //
  //   ★2026-09-18 実測で 判った 事★
  //     売上を 出すのは `js/uriage-agg.js` の deductOf()。
  //     ★記録に 入っている 金額（edit.expenses の キー）を そのまま 足している★
  //     ＝★実費の 名前の 一覧（dk_expense_kinds）を 1度も 見ていない★。
  //     売上表・給料・月次集計 ★3つとも この 1本★ を 通る。
  //   ⇒ ★設定で 何を しても（使う を 外す／消す）★ ★昔の 売上の 数字は 動かない★。
  //   ⇒ ここを ★字では なく 実際に 計算させて★ 縛る（字の 見張りは 書き換えで すり抜ける）。
  // ============================================================
  it('★★④ 消した 実費も 売上から 引かれ続ける（実際に 計算させる）★★', () => {
    const U = require('../../js/uriage-agg.js');
    const settings = { deduct_toll: true, deduct_bridge: true, deduct_other: true };
    // ★一覧に 無い 名前（消した つもりの 物）★ に 金額が 入っている 記録
    const kiroku = {
      toll_yen: 100,
      bridge_yen: 0,
      other_yen: 0,
      expenses: { kesita_mono_9999: 500 },
    };
    const hiita = U.deductOf(kiroku, settings);
    expect(
      hiita,
      '★一覧に 無い 実費（消した物）が 売上から 引かれていません★\n' +
        '  ＝消した 瞬間に ★昔の 売上の 数字が 上がります★（司さんが 止めた 事）'
    ).toBe(600);
  });

  it('★★④-2 deductOf に 一覧を 渡す 作りに しない（渡せたら いつか 絞られる）★★', () => {
    const U = require('../../js/uriage-agg.js');
    // 引数が 1〜2個（edit, settings）＝★一覧を 受け取らない★
    expect(
      U.deductOf.length <= 2,
      '★deductOf が 3つ目の 引数（一覧）を 取るように なっています★\n' +
        '  ＝いつか そこで 絞られ ★昔の 売上が 変わります★。一覧は 渡さない。'
    ).toBe(true);
  });

  it('★⑤ 入力画面は 消した物を 出さない（deleted_at で 落とす）★', () => {
    // ★active には 頼れません★＝消す は active を 触らない（②-2）。
    //   だから 入力から 落とすのは ★ここの deleted_at の 絞り★ 1か所だけ。
    expect(
      /!k\.deleted_at/.test(NYURYOKU),
      '★入力画面が deleted_at で 絞っていません★＝消した物が 入力に 出ます'
    ).toBe(true);
    expect(
      /k\.active\s*!==\s*false/.test(NYURYOKU),
      '★入力画面の active の 絞りが 無くなっています★（「使う」の ✓ が 効かなく なります）'
    ).toBe(true);
  });
});
