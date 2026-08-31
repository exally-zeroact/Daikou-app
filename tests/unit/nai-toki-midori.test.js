// tests/unit/nai-toki-midori.test.js
//
// ★★「無い時に緑」を 機械が 数える★★ 2026-08-28（指示役）
//
//   ★なぜ 作ったか★
//     私は 前に「残り7件」と 言っていました。実物から 数え直したら ★24本★でした。
//     ★手で数えると 数え方が 変わり、「進んでいるのか」が 分からなくなります★。
//     ⇒★数え方を ここに 固定し、機械に 数えさせます★。
//     ⇒★定義を 変えた時は「定義を変えた」と 報告に 書きます★（数だけ動かさない）。
//
//   ★★数え方の定義（1行）★★
//     ★材料・生成物・設定が「無い / null」事を 見た直後に、赤にせず そのまま 緑で終わる形★
//
//   ★細かい決まり（読む人が 同じ数を 出せるように）★
//     ・見る所 … tests/ の下の .js / .mjs（node_modules は 除く）
//     ・コメントは ★外してから★ 探す（自分の説明文を 拾わない為・2回 踏んだ）
//     ・「無い」を 見る印 … existsSync / loadFixture / readFileSync / process.env /
//                          !fx / !fixture / == null / === null
//     ・「緑で終わる」印 … process.exit(0) / return; / continue; / it.skip / describe.skip
//     ・★赤にしている物は 数えない★ … 窓の中に
//        未測定 / MISOKUTEI / anyFail / exitCode / process.exit(1) / expect( の どれかが在る
//     ・窓 … その行から 6行
//     ・1ファイルにつき 1つ数える（同じ形が何か所在っても 1本）
//
//   ★この数え方の 穴（分かっていて 残している物）★
//     ・★expect( が「緑で終わる所より 後ろ」に在ると 見逃します★
//       （窓の中に在るだけで「赤にしている」と みなす為）。
//       実際 scripts-no-shebang.test.js を 1本 見逃しました（2026-08-28・手で見つけて 直した）。
//       ⇒★数が減った時は「本当に直したか」を 1本ずつ 目で見る★
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const NAI = /existsSync|loadFixture|readFileSync|process\.env|!fx|!fixture|==\s*null|===\s*null/;
const MIDORI = /process\.exit\(0\)|return;|continue;|it\.skip|describe\.skip/;
const AKA = /未測定|MISOKUTEI|anyFail|exitCode|process\.exit\(1\)|expect\(/;
const MADO = 6;

// ★コメントを外す★（[[feedback_guard_searching_by_name_dies_on_rename]] と 同じ型）
const komentoWoKesu = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

function kazoeru(dir, deta) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') kazoeru(p, deta);
      return;
    }
    if (!/\.(js|mjs)$/.test(e.name)) return;
    const rel = path.relative(ROOT, p).split(path.sep).join('/');
    if (rel === 'tests/unit/nai-toki-midori.test.js') return; // ★自分は 数えない★
    // ★★凍らせた 複製は 数えない★★ 2026-08-31（理由を 書いてから 外す）
    //   tests/fixtures/ に 置く 物は ★変える前の コードを そのまま 保存した 物★です
    //   （例: meter-MAE-2026-08-31.js＝料金の 計算を 別ファイルに 出す前の meter.js）。
    //   ★1バイトでも 直したら 比べる 意味が 無くなります★ので、
    //   ここを 数えると ★直せない 物を 直せと 言い続ける★事に なります。
    //   ⇒ ★fixtures だけ 外します★（js/ と 他の tests/ は 今まで通り 数えます）。
    if (rel.indexOf('tests/fixtures/') === 0) return;
    const gyou = komentoWoKesu(fs.readFileSync(p, 'utf8')).split('\n');
    for (let i = 0; i < gyou.length; i++) {
      if (!NAI.test(gyou[i])) continue;
      const mado = gyou.slice(i, i + MADO).join('\n');
      if (MIDORI.test(mado) && !AKA.test(mado)) {
        deta.push(rel);
        break; // ★1ファイル 1本★
      }
    }
  });
  return deta;
}

// ★2026-08-28 実測 … 残り15本★（1本 直すたびに ここから消す）
//   ★手で数えた時は 16本でした★。この定義（窓に expect( が在れば「赤にしている」＝数えない）で
//   scripts-no-shebang が 外れて ★15本★。★機械の数が 正★です。
//   この日 ★11本 直しました★（24本 → 16本 …【A】必ず在る物6・【B】距離の見張り2・【C】言い換え3）
//   ※【C】3本は 数えなくなった側（未測定と 言うようになった）
// ★2026-08-28 実測 … 残り 11本★（この日 24本 → 11本）
//   ★内訳★ … ★直す物 0本／★対象外 12本（理由つき）★★（2026-08-28 夜 帯の試験を 1本 追加）
//   ⇒ ★「対象外」は 見逃しではありません★。1本ずつ ★なぜ そのままで よいか★ を 下に 書いています。
//     ・数え方が 行だけを見る（前後の 締めを 見ない）ので ★安全な物も 引っかかります★
//     ・★安全にした物も 行の形は 残る★（例：0件なら 赤 を 別の行に 足した）
//   ⇒ ★対象外に 移す時は 必ず 1行の理由を 書く★（黙って 名簿から 消さない）
const NOKORI = [
  'tests/e2e/env-badge.spec.js',
  'tests/integration/adaptive-mode-distance.test.js',
  'tests/integration/meisai-autopush-row.test.js',
  'tests/integration/overcount-zero-routing.test.js',
  'tests/integration/smoothed-distance-parity-creep.test.js',
  'tests/kp-segment-score.js',
  'tests/lib/snap.drift-guard.test.js',
  'tests/replay-mm-worker/scoring.js',
  'tests/tier1-osrm.js',
  'tests/tier4-google.js',
  'tests/truedist-kp-gate.js',
  'tests/unit/dk-config-single-source.test.js',
];

// ★対象外＝そのままで よい物と その理由★（★11本とも 理由が 要ります★）
const RIYUU = {
  'tests/e2e/env-badge.spec.js':
    '★材料の話では ない★ … 実物の dk-session.js を 読んで その後ろに 上書きを 足しているだけ' +
    '（readFileSync の 後ろに return が 在るのを 数え方が 拾っただけ）。' +
    '無ければ この試験自体が 落ちる（＝黙って 緑にならない）。',
  'tests/integration/adaptive-mode-distance.test.js':
    '★2026-08-28 に 安全にした★ … 真値が 無い trip は 飛ばすが ★1回も 比べなければ 赤★（0件でも緑 を 断った・壊して確認済）',
  'tests/integration/overcount-zero-routing.test.js':
    '★2026-08-28 に 安全にした★ … 同上（比べた回数が 0 なら 赤・壊して確認済）',
  'tests/lib/snap.drift-guard.test.js':
    '★2026-08-28 に 安全にした★ … snap 出来ない点は 飛ばすが ★全部 飛ばしたら 赤★（壊して確認済）',
  'tests/unit/dk-config-single-source.test.js':
    '★2026-08-28 に 未測定と 言うようにした★ … Edge Function は repo によって 在る/無い（本番repoには 置いていない）',
  'tests/integration/meisai-autopush-row.test.js':
    '★材料の話ではない★ … 列の値が null なら 型を見ない、という ★1行1行の 当たり前の飛ばし★（欠けた材料の話ではない）',
  'tests/integration/smoothed-distance-parity-creep.test.js':
    '★読めなければ 落ちる★ … catch で fails に 積んでから continue（＝黙って 緑にならない）',
  'tests/kp-segment-score.js':
    '★材料の話ではない★ … OBD の付いていない点を 飛ばす（1点ずつの 選別）。結果は obdKm=null で はっきり返す',
  'tests/truedist-kp-gate.js': '★材料の話ではない★ … 同上（OBD の無い点を 飛ばす）',
  'tests/replay-mm-worker/scoring.js':
    '★採点の道具（見張りではない）★ … 比べられない層を 飛ばし、0件なら ★null を返す★（呼ぶ側が 判断する）',
  'tests/tier1-osrm.js':
    '★外のサービスが要る＝未測定の組★（頭で ★未測定★ と 出している・別の行が 引っかかっただけ）',
  'tests/tier4-google.js': '★外の鍵が要る＝未測定の組★（同上）',
};

describe('★「無い時に緑」を 機械が 数える★', () => {
  const ima = kazoeru(path.join(ROOT, 'tests'), []).sort();

  it('★本数が 増えていない★（黙って足せない）', () => {
    expect(
      ima.length,
      '★「無い時に緑」の本数が 変わりました★\n' +
        '  ・増えた … ★新しく「無い時に そのまま緑」を 書きました★。赤にするか 未測定と言うか どちらかに。\n' +
        '  ・減った … ★直したなら NOKORI から その1本を 消してください★\n' +
        '  ★数え方は このファイルの頭に 1行で 書いてあります。変えたら「定義を変えた」と 報告に書く★'
    ).toBe(NOKORI.length);
  });

  it('★中身も 同じ★（別の物と 入れ替わっていない）', () => {
    const fueta = ima.filter((f) => NOKORI.indexOf(f) < 0);
    const hetta = NOKORI.filter((f) => ima.indexOf(f) < 0);
    expect({ fueta, hetta }, '★数は同じでも 中身が 入れ替わっています★').toEqual({
      fueta: [],
      hetta: [],
    });
  });

  it('★1本ずつ 理由が 書いてある★（黙って 名簿に 置かない）', () => {
    const nai = NOKORI.filter((f) => !RIYUU[f] || String(RIYUU[f]).trim().length < 10);
    expect(nai, '★理由が 書けていない物が あります★（なぜ そのままで よいか を 1行で）').toEqual(
      []
    );
  });

  it('★名簿の物は 実物が 在る★（消えた物の名前を 残さない）', () => {
    const nai = NOKORI.filter((f) => !fs.existsSync(path.join(ROOT, f)));
    expect(nai, '★tests/ に無い物が 名簿に 在ります★').toEqual([]);
  });
});
