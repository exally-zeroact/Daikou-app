/* check-parity.mjs — ★本番(Daikou-app)とテスト線(Daikou-app-test)の食い違いを、中身で数える★
 *
 * ★この 道具は Exally から ★丸ごと 借りた★（2026-09-26）
 *   exally-prod/scripts/check-parity.mjs を 写して 向き先と 一覧だけ 変えた。
 *   ★見た目を 真似ず 道具を 借りる★
 *
 * なぜ 必要か（2026-09-26・司さんに 叱られた）:
 *   ★テスト線を 飛ばして 本番へ 直接 12回 押した★。
 *   司さん「なんでそんなことが起きるんどぼけ
 *     テストに入れて大丈夫やけん本番にいれとんやないんか」
 *   ⇒ ★ダイコメにだけ この 道具が 無かった★ので 長い間 気づかなかった。
 *
 * ★コミットの履歴ではなく「ファイルの中身」で比べる。★
 *   履歴で 数えると ★機械が 打つ commit で 膞れ上がる★。
 *   実測(2026-09-26): 履歴だと 223本 → ★中身だと 137本★
 *     うち 105本は data/ の 地図・POI の 自動更新（線ごとに 機械が 作る物）。
 *
 * 比べる前にそろえる（ここを揃えないと、意味のない差で埋まって本物の差が見えない）:
 *   ・改行コード（CRLF / LF）… Windowsとgitの設定で勝手に変わる。中身の違いではない
 *   ・?v=<刻印> のキャッシュ避け … ビルドのたびに変わる。中身の違いではない
 *   ・★daikome-<7桁> の SW の 刻印★ … 機械が 押すたびに 書き換える。★中身では ない★
 *     （sw.js を 一覧に 入れて 逃がすと ★先取り名簿の 本物の 差が 隠れる★ので
 *      刻印だけ ここで 消す）
 *
 * ★片側にしか無くてよい物は、理由つきで一覧に書く。★
 *   理由が書けない差は許さない（＝一覧は「逃げ道」ではなく「決めた事の記録」）。
 *
 * 使い方: node scripts/check-parity.mjs [stagingの場所]   （既定 ../dk-tokei-2026-09-02/wt-test）
 *         node scripts/check-parity.mjs --json
 *         node scripts/check-parity.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ★片側にしか無くてよい／中身が違ってよい物。必ず理由を書く。 */
const ALLOWED = {
  // ── ★揃えては いけない 物★（揃えると テスト線が 本番を 触る） ──
  'data/':
    '★地図・POI の 自動更新★（OSM・POIの workflow が 線ごとに 別々に 作る 生成物）。' +
    '走らせた 日が 違うので 中身が 違って 当たり前。' +
    '★実測 2026-09-26：105本★（ここを 逃がさないと 本物の 差 18本が 埋まる）',
  'js/dk-config.js':
    '★倉庫の 向き先★。本番 ENV=prod（tnfwipbg…）／テスト線 ENV=test（khawdrnv…）。' +
    '揃えると ★テスト線が 本番の お客の 数字を 書き換える★（2026-09-12 に 逆を 踏んでいる）',
  'vercel.json': '事務所への 行き先。本番 daikome-jimusho／テスト線 daikome-jimusho-test。',
  'office-host/vercel.json':
    '事務所の 中継の 名簿。★行き先が 違う★（daikou-app ／ daikou-app-test）。' +
    '★名簿の 中身（通す 道）は 両方で 同じ★… scripts/office-allow.mjs が 機械で 作る。',
  'manifest.json':
    'ホーム画面に 入る 名前（メーター）。テスト線は ★【テスト用】★ を 付ける' +
    '＝運転する 人の 電話に 本番と 同じ 顔で 入ると 踏み違える。',
  'office-manifest.json':
    'ホーム画面に 入る 名前。テスト線は ★【テスト用】★ を 付ける' +
    '＝本番と 同じ 顔で 並ぶと 司さんが 踏み違える。',
  'tests/gate-snap-accuracy.baseline.json':
    '★その 線で 測った 基準値★（generatedAt と 実測の 数が 入る）。' +
    '取り直した 日が 違うので 中身が 違って 当たり前。',
  'docs/DAIKOME_E2E_PLAN.md': 'テスト線で 書いた 下書き。本番に 要らない。',
  'docs/DAIKOME_HONBAN_CHECK.md': '同上。',
  'docs/DAIKOME_OFFICE_DESIGN.md': '同上。',
  'docs/DAIKOME_STANDALONE_MIGRATION.md': '同上。',
  'docs/DAIKOME_STEP1_SHEET.md': '同上。',
  'tools/fake-clock.mjs': '★偽の 時計★で 試す 道具。テスト線だけで 使う（本番に 入れない）。',
  'tests/tools/fake-clock.js': '同上。',
  'vitest.fake.config.js': '同上（偽の 時計で 走らせる 設定）。',
  'tests/unit/karita-tokei-dougu.test.js': '同上（偽の 時計の 見張り）。',
  'tests/unit/test-band.test.js': '★テスト線の 帯★の 見張り。本番に 帯は 出ない。',

  // ★ここに 書いて いない 差は ★追いつかせる 物★。
  //   2026-09-26 の 残り（本番にしか 無い／古い）…
  //     js/veh-backup.js ／ js/license-activate.js（companyId）／
  //     dashboard.html（車ごとのQR）／ nyuryoku.html（実費の消す）／
  //     supabase/apply-*.sql 2本 ／ 見張り 6本 ／ js/dk-env-badge.js（書き方が古い）
  //   ★理由を 書けない物を ここに 入れない★。
};

/* 比べる前にそろえる（改行コードと刻印は「中身の違い」ではない） */
export function normalize(text) {
  return String(text)
    .replace(/\r\n/g, '\n') // 改行コード
    .replace(/\?v=[0-9a-f]{6,}/g, '?v=') // キャッシュ避けの刻印
    .replace(/daikome-[0-9a-f]{7,}/g, 'daikome-'); // ★SWの刻印（押すたび 機械が 書き換える）
}

/* ★純関数: 2つのファイル一覧と中身から、差を分類する。self-testで作り物を通せる。 */
export function classify(a, b, allowed) {
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const out = { onlyProd: [], onlyStaging: [], differ: [], same: 0, allowedCount: 0 };
  for (const n of names) {
    const inA = Object.prototype.hasOwnProperty.call(a, n),
      inB = Object.prototype.hasOwnProperty.call(b, n);
    /* ★末尾が / の 鍵は「その 下 全部」★（2026-09-26 ダイコメで 足した）
       data/ の 地図・POI は 105本 あり、1本ずつ 書くと ★記録に ならない★。
       ★理由は 1つで よいが、書かなければ 許さない★のは 同じ。 */
    const why =
      allowed[n] ||
      Object.keys(allowed)
        .filter((k) => k.endsWith('/') && n.startsWith(k))
        .map((k) => allowed[k])[0];
    if (inA && inB) {
      if (normalize(a[n]) === normalize(b[n])) {
        out.same++;
        continue;
      }
      if (why) {
        out.allowedCount++;
        continue;
      }
      out.differ.push(n);
    } else if (inA) {
      if (why) {
        out.allowedCount++;
        continue;
      }
      out.onlyProd.push(n);
    } else {
      if (why) {
        out.allowedCount++;
        continue;
      }
      out.onlyStaging.push(n);
    }
  }
  return out;
}

/* ══ self-test ═══════════════════════════════════════════════════════ */
if (process.argv.includes('--self-test')) {
  let pass = 0,
    fail = 0;
  const T = (n, fn) => {
    try {
      fn();
      pass++;
      console.log('  ✓ ' + n);
    } catch (e) {
      fail++;
      console.log('  ✗ ' + n + ' — ' + e.message);
    }
  };
  console.log('\n[check-parity --self-test] 数え方が正しいか');
  T('★改行コードだけの差は「差」と数えない', () => {
    const r = classify({ 'a.js': 'x\r\ny\r\n' }, { 'a.js': 'x\ny\n' }, {});
    if (r.differ.length) throw new Error('数えてしまっている');
    if (r.same !== 1) throw new Error('同じと数えていない');
  });
  T('★刻印(?v=)だけの差も「差」と数えない', () => {
    const r = classify(
      { 'a.html': '<script src="x.js?v=abc123">' },
      { 'a.html': '<script src="x.js?v=999fff">' },
      {}
    );
    if (r.differ.length) throw new Error('数えてしまっている');
  });
  T('★中身が本当に違えば差として出す', () => {
    const r = classify({ 'a.js': 'const A=1;' }, { 'a.js': 'const A=2;' }, {});
    if (r.differ.length !== 1) throw new Error('見つけられていない');
  });
  T('★片側にしか無ければ、どちら側かを分けて出す', () => {
    const r = classify({ 'p.js': 'x' }, { 's.js': 'y' }, {});
    if (r.onlyProd[0] !== 'p.js' || r.onlyStaging[0] !== 's.js')
      throw new Error('分けられていない: ' + JSON.stringify(r));
  });
  T('理由を書いた物は差から外れる（ただし数は残る）', () => {
    const r = classify(
      { 'js/supa-config.js': 'A' },
      { 'js/supa-config.js': 'B' },
      { 'js/supa-config.js': '倉庫が違う' }
    );
    if (r.differ.length) throw new Error('外れていない');
    if (r.allowedCount !== 1) throw new Error('数が残っていない');
  });
  T('★フォルダごとの 理由は その下に 効く（他は 効かない）', () => {
    const r = classify(
      { 'data/poi-x.js': 'A', 'js/x.js': 'A' },
      { 'data/poi-x.js': 'B', 'js/x.js': 'B' },
      { 'data/': '自動更新' }
    );
    if (r.differ.length !== 1 || r.differ[0] !== 'js/x.js')
      throw new Error('違う所まで 逃がしている: ' + JSON.stringify(r.differ));
    if (r.allowedCount !== 1) throw new Error('フォルダの 理由が 効いていない');
  });
  T('★理由が無い差は必ず出る（一覧を逃げ道にできない）', () => {
    const r = classify({ 'x.js': 'A' }, { 'x.js': 'B' }, { 'y.js': '関係ない理由' });
    if (r.differ.length !== 1) throw new Error('逃げられてしまう');
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

/* ══ 本番（実物を見る） ═══════════════════════════════════════════════ */
const argPath = process.argv.slice(2).find((a) => !a.startsWith('--'));
const OTHER = path.resolve(argPath || path.join(ROOT, '..', 'dk-tokei-2026-09-02', 'wt-test'));
const JSON_OUT = process.argv.includes('--json');

if (!fs.existsSync(OTHER)) {
  console.error(
    '★テスト側が見つかりません: ' +
      OTHER +
      '\n  場所を引数で渡してください: node scripts/check-parity.mjs <path>'
  );
  process.exit(2);
}

function tracked(dir) {
  const out = execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' });
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}
function readAll(dir, files) {
  const m = {};
  for (const f of files) {
    const p = path.join(dir, f);
    try {
      m[f] = fs.readFileSync(p, 'utf8');
    } catch {
      /* バイナリ/欠落は中身なしとして扱う */ m[f] = '\u0000binary-or-missing';
    }
  }
  return m;
}

const prodFiles = tracked(ROOT),
  stgFiles = tracked(OTHER);
const A = readAll(ROOT, prodFiles),
  B = readAll(OTHER, stgFiles);
const r = classify(A, B, ALLOWED);
const total = r.differ.length + r.onlyProd.length + r.onlyStaging.length;

if (JSON_OUT) {
  console.log(JSON.stringify({ total, ...r }, null, 1));
} else {
  console.log('\n[check-parity] 本番(Daikou-app) と テスト線(Daikou-app-test) の食い違い\n');
  console.log('  本番   : ' + ROOT);
  console.log('  テスト : ' + OTHER + '\n');
  const show = (title, arr) => {
    console.log('■ ' + title + '（' + arr.length + '件）');
    console.log(arr.length ? arr.map((x) => '  ・' + x).join('\n') : '  （なし）');
    console.log('');
  };
  show('★中身が違う', r.differ);
  show('★本番にしか無い', r.onlyProd);
  show('★テストにしか無い', r.onlyStaging);
  console.log('■ 理由つきで許している差（' + r.allowedCount + '件）');
  console.log(
    Object.entries(ALLOWED)
      .map(([k, v]) => '  ・' + k.padEnd(42) + v)
      .join('\n')
  );
  console.log('\n── 実測 ──');
  console.log(
    '  同じ ' +
      r.same +
      ' / ★差 ' +
      total +
      '★（中身違い ' +
      r.differ.length +
      ' / 本番のみ ' +
      r.onlyProd.length +
      ' / テストのみ ' +
      r.onlyStaging.length +
      '）'
  );
  console.log('  ※ 改行コードと ?v= の刻印はそろえてから比べています（中身の違いではないため）');
  if (total > 10)
    console.log('\n  ★差が10件を超えています。新しい作業に入らないでください（指示役の決まり）。★');
}

process.exitCode = total > 10 ? 3 : 0;
