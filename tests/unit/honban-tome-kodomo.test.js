'use strict';
// ============================================================
// ★倉庫に 書く 道具 6本の 本番の 止めを、道具を 本当に 走らせて 縛る★ 2026-10-17（3本→6本）
//   前の 試験は 止めの 字の 位置しか 見ず、`if (tome)` や process.exit(3) を 外しても 緑だった（対立役 直す-2）。
//   ここでは 一時の 根に 道具を 写し、向き先（js/dk-config.js）を 書き換え、fetch を 偽物に 替えて 子で 走らせ、
//   ★終わり値★ と ★倉庫へ 向かった fetch の 数★ を 数える（偽の fetch は 何も 送らない・鍵も 作り物）。
//     本番・--honban 無し＝止まる（fetch 0）／本番・--honban 付き＝倉庫へ 向かう（fetch 1 以上＝止めが 効いている 証し）
//     知らない 倉庫＝止まる（fetch 0）／テストの 倉庫＝向かう
//   ★わざと壊して 赤に なった 記録（2026-10-17）★
//     3本 それぞれで `if (tome)` を `if (false)` に＝その 道具の「本番・無し」と「知らない」が 赤（3本とも）
//     honban-tome.mjs の 白名簿を 外し 知らない 倉庫を 通す＝3本の「知らない」が 赤
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const HON = 'tnfwipbgfgjaymlszeid';
const TEST = 'khawdrnvssdenumbiwfg';
const SHIRANAI = 'zzzzzzzzzzzzzzzzzzzz';
const NOKOSU = [];
afterAll(() => NOKOSU.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const DOUGU = [
  { f: 'apply-supabase-sql.mjs', hiki: ['supabase/nai.sql'] },
  { f: 'apply-meisai-sql.mjs', hiki: ['supabase/nai.sql'] },
  { f: 'deploy-edge-function.mjs', hiki: ['dk-sync-jobs'] },
  // 2026-10-17 残りの 書く 道具 3本も 寄せた（請求明細の 1回きりの 書き直し・本人リンクの 関数 2本）
  { f: 'apply-dkmeteryen-backfill.mjs', hiki: ['--yaru'] },
  { f: 'apply-kyuryo-get.mjs', hiki: ['--ateru'] },
  { f: 'apply-kyuryo-saihakkou.mjs', hiki: ['--ateru'] },
];

function ne(ref) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'honban-tome-'));
  NOKOSU.push(d);
  fs.mkdirSync(path.join(d, 'scripts'));
  fs.mkdirSync(path.join(d, 'js'));
  // 当てる 前に SQL を 切り出す 道具（配る 関数 3本・10-17）の 為に、読む SQL も 写す
  fs.mkdirSync(path.join(d, 'supabase'));
  for (const f of ['apply-kyuryo-haifu.sql', 'apply-kyuryo-haifu-hitori.sql'])
    fs.copyFileSync(path.join(ROOT, 'supabase', f), path.join(d, 'supabase', f));
  for (const f of [...DOUGU.map((x) => x.f), 'db-token.mjs', 'sql-guard.mjs', 'honban-tome.mjs'])
    fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(d, 'scripts', f));
  const conf = fs
    .readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8')
    .replace(/https:\/\/[a-z0-9]{20}\.supabase\.co/g, 'https://' + ref + '.supabase.co');
  fs.writeFileSync(path.join(d, 'js', 'dk-config.js'), conf);
  // ★偽の fetch★ 呼ばれた 先を 1行 出して 投げる（何も 送らない）
  fs.writeFileSync(
    path.join(d, 'nise-fetch.mjs'),
    "globalThis.fetch = async (u) => { process.stdout.write('NISE_FETCH ' + String(u).slice(0, 60) + '\\n'); throw new Error('nise'); };\n"
  );
  return d;
}
function hashiru(d, dougu, tsuika) {
  const r = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(path.join(d, 'nise-fetch.mjs')).href,
      path.join(d, 'scripts', dougu.f),
      ...tsuika,
      ...dougu.hiki,
    ],
    {
      cwd: d,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { SUPABASE_ACCESS_TOKEN: 'sbp_tsukurimono' }),
    }
  );
  const fetchKazu = (r.stdout.match(/^NISE_FETCH /gm) || []).length;
  return { status: r.status, fetchKazu, out: r.stdout + r.stderr };
}

describe('★書く 道具 3本の 本番の 止め（子で 走らせて 数える）★', { timeout: 60000 }, () => {
  for (const dougu of DOUGU) {
    it(dougu.f + '：本番で --honban 無し＝倉庫へ 1回も 向かわず 止まる', () => {
      const r = hashiru(ne(HON), dougu, []);
      expect(r.fetchKazu, r.out).toBe(0);
      expect(r.status, r.out).toBe(3);
      expect(r.out).toContain('--honban');
    });
    it(dougu.f + '：本番で --honban 付き＝倉庫へ 向かう（止めが 道を 塞いでいる 証し）', () => {
      const r = hashiru(ne(HON), dougu, ['--honban']);
      expect(r.fetchKazu, r.out).toBeGreaterThan(0);
    });
    it(dougu.f + '：知らない 倉庫＝向かわず 止まる', () => {
      const r = hashiru(ne(SHIRANAI), dougu, ['--honban']);
      expect(r.fetchKazu, r.out).toBe(0);
      expect(r.status, r.out).toBe(3);
    });
    it(dougu.f + '：テストの 倉庫＝向かう', () => {
      const r = hashiru(ne(TEST), dougu, []);
      expect(r.fetchKazu, r.out).toBeGreaterThan(0);
    });
  }
});
