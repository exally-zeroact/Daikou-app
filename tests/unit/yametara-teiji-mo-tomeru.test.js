// ============================================================
// ★★「やめた」物が 定時で 動き続けていないか★★ 2026-09-05（司さん「止めろや」）
//
//   ★なぜ 作ったか★
//     ★Real Trace Compare は 毎日 走って 毎日 緑★でした。
//     ★でも 中身は 0★＝材料（data/traces/*.json）が 1本も 無く、
//     ★MISOKUTEI=1 reason=zairyou-nashi と 出して 緑で 終わっていた★。
//     ★実測 2026-08-30〜09-04 の 6日とも 緑・中身 0★
//     ⇒ ★「緑だから 大丈夫」と 読まれる＝一番 危ない 形★
//     （[[feedback_naoshita_wa_gamen_dake_kaisha_no_dougu_ga_nokoru]] と 同じ 家）
//
//   ★この 見張りが 見る 事★
//     ★定時（cron）で 走る 物は、材料が 手元に 在る 物だけ★
//     ⇒ real-trace-compare は ★schedule を 持っていない★
//     ⇒ 戻す 時は ★先に data/traces/ に 記録を 置く★（材料より 先に 定時を 戻さない）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-05 実測）★★
//     ①real-trace-compare.yml に `schedule:` を 戻す … ★赤★
//     ②数える 本数を 0 に する ………………………… ★赤★（「1本も 見ていません」）
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WF = path.join(ROOT, '.github', 'workflows');

// ★定時で 走らせない と 決めた 物★（決めた 日と 理由を 必ず 書く）
const TEIJI_NASHI = [
  {
    file: 'real-trace-compare.yml',
    hi: '2026-09-05',
    wake: '材料（data/traces/*.json）が 0本＝毎日 緑なのに 中身 0だった（司さん「止めろや」）',
    zairyou: path.join('data', 'traces'),
  },
];

function yomu(f) {
  return fs.readFileSync(path.join(WF, f), 'utf8');
}

describe('★「やめた」物が 定時で 動き続けていないか★', () => {
  it('★① 名簿が 見つかっている（0本でも 緑、に しない）★', () => {
    expect(fs.existsSync(WF), '★workflows の 置き場が ありません★').toBe(true);
    expect(TEIJI_NASHI.length, '★名簿が 空です＝何も 見ていません★').toBeGreaterThan(0);
    TEIJI_NASHI.forEach((x) => {
      expect(
        fs.existsSync(path.join(WF, x.file)),
        '★名簿の ' + x.file + ' が 在りません（消したなら 名簿からも 消す）★'
      ).toBe(true);
    });
  });

  it('★★② 定時（cron / schedule）を 持っていない★★', () => {
    const warui = [];
    TEIJI_NASHI.forEach((x) => {
      const s = yomu(x.file);
      // ★コメントの 中の 字は 数えない★（理由の 説明に cron と 書いてある）
      const nama = s
        .split(/\r?\n/)
        .filter((l) => !/^\s*#/.test(l))
        .join('\n');
      if (/^\s*schedule\s*:/m.test(nama) || /^\s*-\s*cron\s*:/m.test(nama))
        warui.push(x.file + '（' + x.hi + ' に 止めた：' + x.wake + '）');
    });
    expect(
      warui,
      '★止めたはずの 物が 定時で 動いています★＝' +
        '★戻すなら 先に 材料を 置き、この 名簿からも 外して ください★'
    ).toEqual([]);
  });

  it('★③ 手で 押せる 道は 残っている（消したのでは ない）★', () => {
    TEIJI_NASHI.forEach((x) => {
      const s = yomu(x.file);
      expect(
        /^\s*workflow_dispatch\s*:/m.test(s),
        '★' + x.file + ' は 手でも 押せません＝ただ 死んでいます★'
      ).toBe(true);
    });
  });

  it('★④ 戻してよい 合図＝材料が 置かれたか（数えるだけ・赤には しない）★', () => {
    TEIJI_NASHI.forEach((x) => {
      const dir = path.join(ROOT, x.zairyou);
      const n = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => /\.json$/.test(f)).length
        : 0;
      // eslint-disable-next-line no-console
      console.log(
        '★' +
          x.file +
          ' の 材料（' +
          x.zairyou +
          '）… ' +
          n +
          '本★' +
          (n > 0 ? ' ⇒ ★材料が 置かれました。定時に 戻すか 決めて ください★' : '')
      );
      expect(typeof n, '★数えられていません★').toBe('number');
    });
  });
});
