// tests/unit/mada-naoshite-inai.test.js
//
// ★★「まだ直していない（赤で正しい）」の組★★ 2026-08-28（指示役の裁定②-2）
//
//   ★線を緩めて緑にするのは 絶対に不可★（それをやると 何も見ていない緑になる）
//   ★でも 黙って赤のまま置くのが 一番いけない★
//   ⇒ ★ここに 名前と理由と「今の数」を書いて、毎回 本数を数えます★
//     ・★中身が増えたら 気づける★（本数が変わったら 赤）
//     ・★直したら ここから消す★（消し忘れも 赤）
//
//   ★なぜ赤のままで正しいのか★
//     ダイコメは ★テスト先行★（[[feedback_daikome_test_tools_first_ALWAYS]]）。
//     ★直す物より先に 試験を書く★ので、書いた直後は ★赤で正しい★。
//     ★線は 思いつきではなく 根拠つき★（下の1本ずつに 書いてあります）。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// ★まだ直していない物（赤で正しい）★
//   直したら ここから消す。増えたら ここに足す。★どちらも 本数が変わるので 赤になります★
const MADA = {
  'verify-display-frame-clamp.js': {
    実測: '2026-08-28 … 1フレーム飛び ★22.7m★ > 上限10m（戻り値1）',
    なぜ赤で正しいか:
      '★試験を先に書いてある★（同ファイル17行「EXPECT_FAIL=1 で clamp 前の飛びを確認」）。' +
      '直す物（画面の追従の上限）が まだ入っていないので 赤が正しい。',
    直す物: '★DISP_RATE_MAX_MPS=55 の固定をやめ「直近の速度から作る上限」にする★',
    お金への影響: '★無し★（★画面の見え方だけ★・課金距離には触れない）',
  },
  'verify-display-gap-recovery.js': {
    実測: '2026-08-28 … 復帰の追従速度 ★29.70 m/s★ > 上限25m/s（戻り値1）',
    なぜ赤で正しいか:
      '★線に 根拠が書いてある★（同ファイル19-20行「直近走行速度 11.1m/s の ~2.2倍＝' +
      '25m/s（90km/h）を妥当上限」「現行は DISP_RATE_MAX_MPS=55 に張り付くため FAILするはず' +
      '（＝trivial-greenでない証明）」）。',
    直す物: '★同上（55固定をやめる）★',
    お金への影響: '★無し★（画面の見え方だけ）',
  },
};

describe('★まだ直していない（赤で正しい）の組★', () => {
  it('★本数が 変わっていない★（増えたら足す・直したら消す）', () => {
    const ima = Object.keys(MADA).length;
    // ★2026-08-28 時点 … 2本★
    expect(
      ima,
      '★「まだ直していない」の本数が 2本から変わりました★\n' +
        '  ・増えた … ★新しく赤になった物を ここに 名前と理由と実測で 足してください★\n' +
        '  ・減った … ★直したなら ここから消す（消し忘れも ここで止まります）★\n' +
        '  ★黙って赤のまま置くのが 一番いけない★（指示役 2026-08-28）'
    ).toBe(2);
  });

  it('★1本ずつ 実物が在る★（消えた物の理由が 残っていない）', () => {
    const nai = Object.keys(MADA).filter((f) => !fs.existsSync(path.join(ROOT, 'tests', f)));
    expect(nai, '★tests/ に無い物が 書いてあります★').toEqual([]);
  });

  it('★1本ずつ「実測・なぜ赤で正しいか・直す物・お金への影響」が 書いてある★', () => {
    const tarinai = [];
    Object.keys(MADA).forEach((f) => {
      ['実測', 'なぜ赤で正しいか', '直す物', 'お金への影響'].forEach((k) => {
        if (!MADA[f][k] || String(MADA[f][k]).trim().length < 5) tarinai.push(f + ' の ' + k);
      });
    });
    expect(tarinai, '★書けていない所が あります★').toEqual([]);
  });

  it('★お金に関わる物を ここに入れていない★（逃げ道にしない）', () => {
    const okane = Object.keys(MADA).filter((f) => !/無し/.test(String(MADA[f]['お金への影響'])));
    expect(
      okane,
      '★お金が動く物を「まだ直していない」に入れています★\n' +
        '  ＝★この組は 画面の見え方など お金に触れない物だけ★。\n' +
        '  お金が動く物は ★止めて 指示役へ★（[[feedback_daikome_absolute_rules]]）'
    ).toEqual([]);
  });
});

// ★配る物に「作った時刻」を焼き付けない★ 2026-08-28（指示役の裁定③）
//   道路のデータ（data/roads-*.js）に「// Generated: <時刻>」が入っていたため、
//   ★中身が1本も違わなくても 刷り直す度に「テスト線と本番で違う」★になっていました
//   （2026-08-22 の 19分違いで 実際に鳴りました）。
//   この行は ★誰も読んでいません★（js/ tests/ scripts/ を grep して 0件）。
//   いつ作ったかは ★git のコミットが持っています★。
describe('★配る物に 作った時刻を 焼き付けない★', () => {
  it('★build-roads.js が 時刻を書かない★', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build-roads.js'), 'utf8');
    expect(
      src,
      '★roads-*.js に 作った時刻を 焼き付けています★\n' +
        '  ＝中身が同じでも 刷り直す度に「両側が違う」と 永久に鳴ります。\n' +
        '  ★いつ作ったかは git が持っています★'
    ).not.toContain('// Generated: ${new Date().toISOString()}');
  });

  it('★今 repo に在る道路データにも 時刻が入っていない★（入っていたら 刷り直しが要る）', () => {
    const dir = path.join(ROOT, 'data');
    const roads = fs.readdirSync(dir).filter((f) => /^roads-[a-z]+\.js$/.test(f));
    expect(roads.length, '★道路データが 1本も無い★').toBeGreaterThan(0);
    // ★頭だけ読む★（1本 4.6MB × 47本 = 200MB を丸ごと読むと 8秒かかり、
    //   全部まとめて回した時に 他の試験とぶつかって 不安定になりました・2026-08-28 実測）
    const atama = (fp) => {
      const fd = fs.openSync(fp, 'r');
      try {
        const buf = Buffer.alloc(400);
        const n = fs.readSync(fd, buf, 0, 400, 0);
        return buf.slice(0, n).toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    };
    const nokotteru = roads.filter((f) => /\/\/ Generated: \d{4}-/.test(atama(path.join(dir, f))));
    // ★今は 47本 全部に 残っています（2026-08-28 実測）★
    //   次に osm-update（毎週）が回って 刷り直されると 0本 に減ります。
    //   ⇒ ★減ったら ここを 0 に直す★（そのままだと 消えた事に 気づけません）
    //   ★自分の値と自分を比べない★（それだと 何も見ていないのに いつも緑）
    expect(
      nokotteru.length,
      '★道路データの「Generated:」の本数が 47本から 変わりました★\n' +
        '  ・減った … ★刷り直しで 消えました。ここを 今の本数（0のはず）に 直してください★\n' +
        '  ・増えた … ★別の作り方で 時刻が また入りました★'
    ).toBe(47);
  });
});
