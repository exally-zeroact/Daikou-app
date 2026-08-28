// tests/unit/env-badge.test.js
//
// ★★テスト環境の帯★★ 2026-08-28（指示役／仕組みは 飲み屋 Castally から 借りた）
//
//   ★借りたのは 仕組みだけ★。色と言葉は ダイコメの物。
//
//   ★仕組みの芯★
//     ・★帯が守るのは「どの倉庫のデータを触っているか」であって、どのURLで開いたかではない★
//     ・配り先(URL)は 引っ越しで変わるが ★本番かテストかは 接続先1本で決まる★
//     ・だから ★判定は 自分の側の名札（DKConfig.ENV）だけ★
//     ・★名札が無い・知らない値なら 出さない（迷ったら出さない）★
//       ＝★本番に「テスト環境」と出る という 一番高い事故だけは 構造上 起こさない★
//
//   ★前の形の何が 悪かったか（2026-08-28 実測）★
//     帯が ★HTMLに 直書き★で、本番では ★手で 消す★運用でした。
//     ＝★写し忘れ 1回で 本番に「テスト用」が 出ます★。
//     しかも 見張り(tests/unit/test-band.test.js)が ★テスト線にしか 無く★、
//     本番には「出ていない事」を 見る物が ★1本も 在りませんでした★。
//   ⇒★この見張りは 両repoで 同じ物が 回ります★（本番では「出ない」を 見る）
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ★帯を出す画面（6枚）★
const GAMEN = [
  'index.html',
  'dashboard.html',
  'uriage.html',
  'shukei.html',
  'kyuryo.html',
  'login.html',
];

// ★自分がどちらの repo に居るかは git の remote から取る★
//   （★同期でコピーされない所★から素性を取る。dk-config-app-base-host.test.js と同じ手）
function sujou() {
  try {
    const url = execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim();
    if (/Daikou-app-test/i.test(url)) return 'test';
    if (/Daikou-app(\.git)?$/i.test(url)) return 'prod';
    return null;
  } catch (_) {
    return null;
  }
}

describe('★テスト環境の帯★', () => {
  const badge = require(path.join(ROOT, 'js', 'dk-env-badge.js'));

  it('★名札だけで 決めている★（test だけ 出す／prod・空・知らない値は 出さない）', () => {
    expect(badge.dasuka('test'), '★テストで 出ない★').toBe(true);
    expect(badge.dasuka('prod'), '★本番で 出てしまう（一番 高い事故）★').toBe(false);
    expect(badge.dasuka(null), '★名札が 無い時に 出してはいけない★').toBe(false);
    expect(badge.dasuka(''), '★名札が 空の時に 出してはいけない★').toBe(false);
    expect(badge.dasuka('staging'), '★知らない値で 出してはいけない★').toBe(false);
    expect(badge.dasuka('TEST'), '★大文字違いも 知らない値＝出さない★').toBe(false);
  });

  it('★ホスト名・倉庫ID・repo名を 見ていない★（引っ越しで 嘘になる物を 証拠にしない）', () => {
    const src = read('js/dk-env-badge.js');
    // ★コメントは 外してから 探す★（説明文に 出てくるのは 構わない）
    const naka = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const dame = [];
    // ★禁じるのは「読む」方★（判定に 使う物）。a タグに href を 付けるのは 表示であって 判定では ない
    if (/location\s*\.|\.hostname|document\.URL/.test(naka)) dame.push('URL/ホスト名を 見ている');
    if (/supabase|SB_URL|ANON_KEY/.test(naka)) dame.push('倉庫の値を 見ている');
    if (/Daikou-app|daikou-app|daikome-jimusho|vercel\.app/.test(naka))
      dame.push('配り先の住所を 直書きしている（DKConfig から 受け取る）');
    expect(dame, '★名札 以外を 見ています（引っ越したら 嘘になります）★').toEqual([]);
  });

  it('★文を flex / grid の箱に 入れていない★（1文字ずつ 縦に割れる型・2回 踏んだ）', () => {
    const src = read('js/dk-env-badge.js');
    const style = /setAttribute\(\s*'style',([\s\S]*?)\);/.exec(src);
    expect(style, '★帯の見た目を 書いている所が 見つからない★').not.toBe(null);
    expect(style[1], '★flex を 使っている★').not.toMatch(/display\s*:\s*flex/);
    expect(style[1], '★grid を 使っている★').not.toMatch(/display\s*:\s*grid/);
    expect(style[1], '★display:block を 明示していない★').toMatch(/display\s*:\s*block/);
  });

  it('★高さを 測ってから 下げている★（決め打ちの数字を 置かない）', () => {
    const src = read('js/dk-env-badge.js');
    expect(src, '★高さを 測っていない★').toContain('getBoundingClientRect');
    expect(src, '★上に貼り付く物を 下げていない★').toContain('sticky');
  });

  it('★6画面すべてが 帯を 読み込んでいる★', () => {
    // ★事務所の画面には data-modoru="office" が 付く★＝属性が 付いても 数えられる形で 見る
    const nai = GAMEN.filter(
      (f) => !/<script src="js\/dk-env-badge\.js"[^>]*><\/script>/.test(read(f))
    );
    expect(nai, '★帯を 読んでいない画面が あります★').toEqual([]);
  });

  it('★HTMLに 帯を 直書きしていない★（本番で 手で消す運用に 戻さない）', () => {
    const naka = GAMEN.filter((f) => /id="testBand"|id='testBand'/.test(read(f)));
    expect(
      naka,
      '★帯が HTML に 直書きされています★\n' +
        '  ＝本番では 手で 消す事になり、★写し忘れ 1回で 本番に「テスト用」が 出ます★'
    ).toEqual([]);
  });

  it('★名札が この repo と 合っている★（同期で コピーされていない）', () => {
    const s = sujou();
    const m = /const ENV = '([a-z]+)';/.exec(read('js/dk-config.js'));
    expect(m, '★js/dk-config.js に 名札(ENV)が 在りません★').not.toBe(null);
    if (s === null) {
      // ★remote が 読めない所（浅い checkout 等）では 素性が 分からない＝未測定★
      console.warn('★未測定★ git remote が 読めず、この repo の 素性が 分かりません');
      console.warn('  MISOKUTEI=1 reason=no-git-remote');
      return;
    }
    expect(
      m[1],
      '★名札が この repo と 合っていません★\n' +
        '  remote は ' +
        s +
        ' なのに 名札は ' +
        m[1] +
        ' です。\n' +
        '  ＝★同期で 反対側の値を コピーした★可能性（一番 危ない形）'
    ).toBe(s);
  });
});
