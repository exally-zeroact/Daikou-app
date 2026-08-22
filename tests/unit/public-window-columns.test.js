'use strict';
// ============================================================
// ★アプリが読む列が、倉庫の「窓」に本当にあるか★ 2026-08-09
//
//   ★これを作った理由（実際に踏んだ）★
//     部屋(daikome.dk_companies)に列 home_city を足した。
//     ところが ★public の窓(view)に足すのを忘れた★。
//     アプリも関数も、窓ごしにしか部屋を見られない。
//     結果 → その列を読みに行った瞬間、★同期が丸ごと db_error で落ちた★。
//     ・文法チェックは通る
//     ・全2460件のテストも通る
//     ・★実際に関数を叩いて初めて分かった★
//
//   ★ここで止めること★
//     repo の中で「窓から取る」と書いてある列が、
//     supabase/windows-public.sql の窓に無ければ★赤にする★。
//     窓を直し忘れたまま push できないようにする。
//
//   ★窓の紙(windows-public.sql)が正しいことは、この紙自体では保証できない★
//     倉庫の実物と突き合わせるのは別の仕事(手で叩いて数える)。
//     ここが守るのは「repo の中で辻褄が合っているか」まで。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SQL = path.join(ROOT, 'supabase', 'windows-public.sql');

// ── 窓の紙から「窓の名前 → 見せている列」を読む ──
function readWindows() {
  const s = fs.readFileSync(SQL, 'utf8');
  const out = {};
  const re = /create or replace view public\.(\w+) as\s*([\s\S]*?);\s*\n/gi;
  let m;
  while ((m = re.exec(s))) {
    const name = m[1];
    const body = m[2].replace(/\s+/g, ' ');
    const sel = body.replace(/^\s*SELECT\s+/i, '').split(/\s+FROM\s+/i)[0];
    out[name] = sel
      .split(',')
      .map((c) =>
        c
          .trim()
          .split(/\s+as\s+/i)
          .pop()
          .replace(/^.*\./, '')
      )
      .filter(Boolean);
  }
  return out;
}

// ── repo の中で「窓から取る」と書いてある所を集める ──
//   ① 画面/共通部品:  '/dk_companies?select=company_id,name,...'
//   ② Edge Function:  .from('dk_companies') ... .select('company_id, owner_id, ...')
// 見る場所は決め打ち（node_modules や配布物を掘りに行かない＝遅くならない）
//   ★深さも決め打ち★ data/ には地図の素が3.5GB入っていて、掘ると落ちる（実際に落ちた）
const SCAN_DIRS = [
  { dir: '', depth: 0 }, // 画面(*.html)は repo の直下だけ
  { dir: 'js', depth: 1 },
  { dir: 'api', depth: 1 },
  { dir: 'supabase/functions', depth: 2 },
];
const SCREEN_DIRS = [
  { dir: '', depth: 0 },
  { dir: 'js', depth: 1 },
  { dir: 'api', depth: 1 },
];

function listFiles(roots) {
  const out = [];
  const walk = (dir, d) => {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of ents) {
      // 隠しフォルダ(.git/.stryker-tmp など)と配布物は掘らない。
      // ★.stryker-tmp には repo 丸ごとの写しが何十個も残る（実際に3.5GBあった）★
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'tests') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (d > 0) walk(p, d - 1);
      } else if (/\.(html|js|ts|mjs)$/.test(e.name)) out.push(p);
    }
  };
  for (const r of roots) walk(path.join(ROOT, r.dir), r.depth);
  return out;
}

// 1つのファイルは1回だけ読む（Windows でここが一番遅い）
const _cache = new Map();
function readCached(p) {
  if (!_cache.has(p)) _cache.set(p, fs.readFileSync(p, 'utf8'));
  return _cache.get(p);
}

function collectUses() {
  const files = listFiles(SCAN_DIRS);

  const uses = [];
  for (const f of files) {
    const s = readCached(f);
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');

    // ① REST の書き方
    const re1 = /\/(dk_\w+)\?select=([^'"`&]+)/g;
    let m;
    while ((m = re1.exec(s))) uses.push({ file: rel, table: m[1], cols: m[2] });

    // ② supabase-js の書き方（.from の後、近くにある .select）
    const re2 = /\.from\(\s*['"](dk_\w+)['"]\s*\)([\s\S]{0,400}?)\.select\(\s*['"]([^'"]*)['"]/g;
    while ((m = re2.exec(s))) uses.push({ file: rel, table: m[1], cols: m[3] });
  }
  return uses;
}

// ★まだ倉庫に当てていない計画の分★（今は0件）
//   2026-08-09 まで dk-reissue / dk-company-manage（秘密リンク方式の残骸）を逃がしていたが、
//   ★2026-08-19 に その2本ごと消した★（呼ぶ側を数えたら 0件／本番repoには画面すら無かった）。
//   逃がしを増やす時は ★呼ぶ画面が本当に無いか★を下の試験が毎回 数える。
const NOT_YET_APPLIED = {};

const WINDOWS = readWindows();
const USES = collectUses();

describe('★窓の紙そのもの★', () => {
  it('窓が読めている（15枚くらいある）', () => {
    expect(Object.keys(WINDOWS).length).toBeGreaterThanOrEqual(10);
  });

  it('★security_invoker を付け直す行が、窓の数だけある★（落ちると RLS を素通りする）', () => {
    const s = fs.readFileSync(SQL, 'utf8');
    // 行頭の実行文だけ数える（頭の説明書きに同じ字が出てくるので）
    const views = (s.match(/^create or replace view public\./gim) || []).length;
    const inv = (s.match(/^alter view public\.\w+ set \(security_invoker = true\);/gim) || [])
      .length;
    expect(inv, '★窓を作り直しているのに security_invoker を付け直していない★').toBe(views);
  });

  it('dk_companies の窓に home_city がある（2026-08-09 に足した列）', () => {
    expect(WINDOWS.dk_companies).toContain('home_city');
  });
});

describe('★アプリが読む列が 窓にあるか★', () => {
  it('読んでいる所が ちゃんと集まっている', () => {
    expect(USES.length, '1件も見つからない＝この番人は何も見張っていない').toBeGreaterThan(10);
  });

  it('★窓に無い列を読んでいる所は 1つも無い★', () => {
    const bad = [];
    for (const u of USES) {
      const win = WINDOWS[u.table];
      if (!win) {
        bad.push(u.file + ' : ' + u.table + ' ← ★そんな窓が windows-public.sql に無い★');
        continue;
      }
      for (const raw of u.cols.split(',')) {
        const c = raw.trim();
        if (!c || c === '*') continue;
        if (/[()]/.test(c)) continue; // 入れ子の取り方はここでは見ない
        const name = c.split(':').pop().trim(); // 別名 alias:col
        if (win.includes(name)) continue;
        const ex = NOT_YET_APPLIED[u.file];
        if (ex && ex.cols.includes(name)) continue; // まだ当てていない計画（下で見張る）
        bad.push(u.file + ' : ' + u.table + '.' + name + ' ← ★窓に無い★');
      }
    }
    expect(
      bad,
      '\n★窓に足し忘れている★ supabase/windows-public.sql と倉庫の両方に足すこと:\n  ' +
        bad.join('\n  ') +
        '\n'
    ).toEqual([]);
  });

  it('★逃がした分は 本当に誰も呼んでいない★（呼び始めたら赤くする）', () => {
    const screens = listFiles(SCREEN_DIRS).filter((p) => /\.(html|js)$/.test(p));

    const wired = [];
    for (const [file, ex] of Object.entries(NOT_YET_APPLIED)) {
      for (const p of screens) {
        if (readCached(p).includes('functions/v1/' + ex.fn)) {
          wired.push(
            path.relative(ROOT, p).replace(/\\/g, '/') + ' → ' + ex.fn + ' (' + file + ')'
          );
        }
      }
    }
    expect(
      wired,
      '\n★まだ倉庫に当てていない関数を、画面から呼び始めている★\n' +
        '  倉庫の部屋と public の窓の両方に列を足してから繋ぐこと:\n  ' +
        wired.join('\n  ') +
        '\n'
    ).toEqual([]);
  });
});
