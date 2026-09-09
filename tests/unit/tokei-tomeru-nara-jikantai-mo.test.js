'use strict';
// ============================================================
// ★★時計を 止めるなら 時間帯も 止める★★ 2026-09-09
//
//   ★★実際に 起きた 事（実測）★★
//     tests/e2e/ryokin-ima-kami.spec.js は 時計を 止めていました。
//       page.clock.install({ time: new Date('2026-09-07T12:00:00+09:00') })
//     手元（日本時間）では ★昼★ ⇒ 割増なし ⇒ 1,300円 ⇒ ★緑★
//     CI（UTC）では 同じ 瞬間が ★午前3時★ ⇒ 深夜割増 1.2倍 ⇒ 1,560円 ⇒ ★赤★
//
//   ★止めたのは「瞬間」だけで「時間帯」を 止めていなかった★
//     ★手元は 緑・CI だけ 赤★ という 一番 分かりにくい 形に なる。
//     （2026-09-08 から 5回 連続で CI が 赤の まま だった）
//
//   ★決まり★
//     page.clock.install を 使う ファイルは
//     ★同じ ファイルで 時間帯も 名指しする★（test.use({ timezoneId: ... })）
//
//   ★お客さんは 日本に 居る★ので 時間帯は ★試験を 本番に 合わせる★。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-09 実測）★★
//     ①ryokin-ima-kami.spec.js から timezoneId の 行を 消す … ★赤★
// ============================================================
const fs = require('fs');
const path = require('path');

const E2E = path.join(__dirname, '..', 'e2e');

function specAll() {
  return fs
    .readdirSync(E2E)
    .filter((n) => n.endsWith('.spec.js'))
    .map((n) => ({ na: n, ji: fs.readFileSync(path.join(E2E, n), 'utf8') }));
}

describe('★時計を 止めるなら 時間帯も 止める★', () => {
  it('★① 見る 相手が 本当に 居る（空回りしていない）★', () => {
    const zenbu = specAll();
    expect(zenbu.length, '★試験の ファイルが 1つも 見つかりません★').toBeGreaterThan(50);
    const tometeru = zenbu.filter((f) => f.ji.indexOf('clock.install') >= 0);
    // eslint-disable-next-line no-console
    console.log('★時計を 止めている ファイル★ ' + JSON.stringify(tometeru.map((f) => f.na)));
    expect(
      tometeru.length,
      '★時計を 止めている 試験が 1つも ありません（この 見張りは 何も 見ていない）★'
    ).toBeGreaterThan(0);
  });

  it('★★② 時計を 止めた ファイルは 時間帯も 名指ししている★★', () => {
    const warui = specAll()
      .filter((f) => f.ji.indexOf('clock.install') >= 0)
      .filter((f) => f.ji.indexOf('timezoneId') < 0)
      .map((f) => f.na);
    expect(
      warui,
      '★時計だけ 止めて 時間帯を 止めていない 試験が あります★' +
        '（手元は 緑・CI だけ 赤 に なります）: ' +
        JSON.stringify(warui)
    ).toEqual([]);
  });

  it('★③ 名指しする 時間帯は 日本（お客さんの 居る 所）★', () => {
    const chigau = specAll()
      .filter((f) => f.ji.indexOf('timezoneId') >= 0)
      .filter((f) => f.ji.indexOf("timezoneId: 'Asia/Tokyo'") < 0)
      .map((f) => f.na);
    expect(
      chigau,
      '★日本 以外の 時間帯を 名指ししています★（試験は 本番に 合わせる）: ' + JSON.stringify(chigau)
    ).toEqual([]);
  });
});
