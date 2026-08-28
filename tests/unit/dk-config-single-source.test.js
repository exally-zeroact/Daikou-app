'use strict';
// ============================================================
// dk-config 単一真実源ガード (2026-07-31)
//   ★目的: Supabase の接続先(プロジェクトURL / anonキー / Functionsベース / アプリベースURL)を
//     js/dk-config.js ただ1箇所に閉じ込め、「移設のとき差し替え漏れ」を物理的に不可能にする。★
//
//   背景: ダイコメを Exally 系から独立させる(= 別 Supabase プロジェクトへ移設)決定に伴い、
//     接続先が 6ファイル 12箇所にハードコードされている状態は移設事故の直接原因になる。
//     1箇所でも旧プロジェクトを指したまま残ると「一部だけ旧倉庫を読む」= 最悪の中途半端状態。
//     このテストが緑である限り、その状態は起こり得ない。
//
//   ★このテストは移設が終わった後も恒久的に価値がある(再発防止)。消さないこと。★
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_REL = 'js/dk-config.js';

// 接続先を持ってよい唯一のファイル
const CONFIG_PATH = path.join(ROOT, CONFIG_REL);

// 走査対象: ルートの画面HTML + js/*.js (ベンダ minified と dk-config 自身は除く)
const HTML_FILES = [
  'index.html',
  'login.html',
  'dashboard.html',
  'manage.html',
  'company.html',
  // 事務所の画面(売上表 / 給料)も同じ土台に乗っているので、ここも見張る
  'uriage.html',
  'kyuryo.html',
  'shukei.html',
];

// DKConfig を参照していなければならない消費側(= 接続先を使う画面/モジュール)
const CONSUMERS = [
  'index.html',
  'login.html',
  'dashboard.html',
  'manage.html',
  'uriage.html',
  'kyuryo.html',
  'shukei.html',
  'js/license.js',
  'js/license-activate.js',
];

// 禁止パターン: Supabase プロジェクトURL と anon キー(JWT)の直書き
const RE_SB_URL = /https:\/\/[a-z0-9]{15,}\.supabase\.co/;
const RE_ANON_JWT = /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{40,}/;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ★repo によって「在る画面」が違う（本番には廃止予定の manage.html が無い）★
//   無い物で落ちるのは道具の不備。★在る物は必ず見る★が、無い物は見ない。
//   ただし「全部無くて素通り」を防ぐため、下で最低限の本数を要求する。
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}
function presentOnly(list) {
  return list.filter(exists);
}

function listJsFiles() {
  const dir = path.join(ROOT, 'js');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => !f.endsWith('.min.js')) // ベンダ(tweetnacl/qrcode)は対象外
    .map((f) => 'js/' + f)
    .filter((rel) => rel !== CONFIG_REL);
}

describe('dk-config = Supabase接続先の単一真実源', () => {
  it('js/dk-config.js が存在し、必要なキーを全て公開している', () => {
    expect(fs.existsSync(CONFIG_PATH)).toBe(true);
    const cfg = require('../../js/dk-config.js');
    for (const key of ['SB_URL', 'ANON_KEY', 'REST_BASE', 'FN_BASE', 'APP_BASE']) {
      expect(typeof cfg[key]).toBe('string');
      expect(cfg[key].length).toBeGreaterThan(0);
    }
    // 派生値が SB_URL から組み立てられていること(手打ちの不一致を防ぐ)
    expect(cfg.REST_BASE).toBe(cfg.SB_URL + '/rest/v1');
    expect(cfg.FN_BASE).toBe(cfg.SB_URL + '/functions/v1');
    // SB_URL は Supabase プロジェクトURLの形をしていること
    expect(cfg.SB_URL).toMatch(RE_SB_URL);
    // APP_BASE は https で始まり末尾スラッシュを持たない(URL組み立てで // にならないため)
    expect(cfg.APP_BASE).toMatch(/^https:\/\//);
    expect(cfg.APP_BASE.endsWith('/')).toBe(false);
  });

  it('★本命: dk-config.js 以外に SupabaseプロジェクトURL の直書きが1つも無い', () => {
    const offenders = [];
    for (const rel of [...presentOnly(HTML_FILES), ...listJsFiles()]) {
      const src = read(rel);
      if (RE_SB_URL.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('★本命: dk-config.js 以外に anonキー(JWT) の直書きが1つも無い', () => {
    const offenders = [];
    for (const rel of [...presentOnly(HTML_FILES), ...listJsFiles()]) {
      const src = read(rel);
      if (RE_ANON_JWT.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('接続先を使う画面/モジュールは必ず DKConfig から接続先をもらっている', () => {
    // 直に DKConfig を見るか、DKConfig を内側で使う DKSession 越しに使うか、のどちらか。
    // どちらでも「接続先の出どころは dk-config.js 1箇所」という約束は守られる。
    const missing = [];
    for (const rel of presentOnly(CONSUMERS)) {
      const src = read(rel);
      const direct = /DKConfig/.test(src);
      const viaSession = /js\/dk-config\.js/.test(src) && /DKSession\./.test(src);
      if (!direct && !viaSession) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });

  it('★配線: dk-config.js を読む画面は、それを消費するJSより先に読み込んでいる', () => {
    // index.html は license.js / license-activate.js より前で dk-config を読む必要がある
    const idx = read('index.html');
    const posConfig = idx.indexOf('js/dk-config.js');
    expect(posConfig).toBeGreaterThan(-1);
    for (const dep of ['js/license.js', 'js/license-activate.js']) {
      const posDep = idx.indexOf('src="' + dep + '"');
      expect(posDep).toBeGreaterThan(-1);
      expect(posConfig).toBeLessThan(posDep);
    }
    // DKConfig を使う単体HTMLも script を読み込んでいること
    for (const rel of presentOnly(['login.html', 'dashboard.html', 'manage.html'])) {
      expect(read(rel)).toMatch(/src=["']js\/dk-config\.js["']/);
    }
  });

  it('★配線: sw.js の PRECACHE に dk-config.js が入っている(オフライン起動で欠けない)', () => {
    const sw = read('sw.js');
    expect(sw).toMatch(/['"]\/js\/dk-config\.js['"]/);
  });

  it('Edge Function はアプリURLをハードコードせず環境変数(DK_APP_BASE)から取る', () => {
    const fnDir = path.join(ROOT, 'supabase', 'functions');
    // ★本番repoには Edge Function のソースを置いていない（共有倉庫へデプロイ済）★
    //   無い物で落ちるのは道具の不備。在る時だけ見る。
    // ★2026-08-28: 前は 黙って return＝★合格に見える★。★未測定★と はっきり言う。
    if (!fs.existsSync(fnDir)) {
      console.warn('★未測定★ supabase/functions が 在りません（この repo には 置いていない）');
      console.warn('  MISOKUTEI=1 reason=edge-function-dir-not-in-this-repo');
      return;
    }
    const fns = fs.readdirSync(fnDir).filter((d) => {
      return fs.existsSync(path.join(fnDir, d, 'index.ts'));
    });
    const offenders = [];
    for (const fn of fns) {
      const src = fs.readFileSync(path.join(fnDir, fn, 'index.ts'), 'utf8');
      if (!/APP_BASE/.test(src)) continue; // アプリURLを使わない関数は対象外
      // 環境変数を読んでいること
      if (!/Deno\.env\.get\(\s*['"]DK_APP_BASE['"]\s*\)/.test(src))
        offenders.push(fn + ':env未使用');
      // vercel.app / 独自ドメインの直書きが「唯一のソース」になっていないこと
      //   (fallback として ?? '...' があるのは許容。env を読んでいれば移設時に切替可能)
    }
    expect(offenders).toEqual([]);
  });
});

describe('★この道具自体が空振りしていないこと★', () => {
  // 「在る物だけ見る」にした副作用で、全部無ければ何も見ずに緑になってしまう。
  // それを防ぐため、最低限の本数が実在することを要求する。
  it('見張るべき画面が少なくとも4枚は実在する', () => {
    expect(presentOnly(HTML_FILES).length).toBeGreaterThanOrEqual(4);
  });
  it('接続先を使う側が少なくとも4つは実在する', () => {
    expect(presentOnly(CONSUMERS).length).toBeGreaterThanOrEqual(4);
  });
  it('dk-config.js は必ず在る', () => {
    expect(exists(CONFIG_REL)).toBe(true);
  });
});
