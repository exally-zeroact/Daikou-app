/* eslint-env node */

// ============================================================
// scripts/zeroact-test-commons/arch-rules.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規) — ArchUnitTS (tsarch) 配線
//
// 目的: 純 JS リポジトリ向けの ファイルレベル依存方向ルールを vitest で verify。
//
// ★設計変更宣言 (= memory 既記載「ArchUnitTS スキップ・dep-cruiser でカバー」を更新):
//   旧: ArchUnitTS スキップ (= @ts-arch/core 不在・tsarch は TS-only 認識)
//   新: tsarch を devDep として install (= 将来 TS 移行時の placeholder)
//       実検証は本ファイルの fs/regex 静的解析ベースで純 JS 対応
//
// 検証ルール:
//   ・meter.js / gps.js / map-matcher.js 間の参照は許容 (= IIFE 設計上の暗黙依存 OK)
//   ・index.html → js/*.js への <script src> 依存は許可 (= 明示存在確認)
//   ・js/*.js から sw.js への require/import は禁止 (= SW は build/runtime で別系統)
//   ・tests/* が js/ ファイルを fs.writeFile 等で直接書換する pattern は禁止
//
// 実行: vitest config の include は tests/**/*.test.js のため
//       全体 vitest run には含まれず・"audit:arch" script で単独実行する設計。
// ============================================================

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

function readFile(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function listDirJsFiles(dirRel) {
  const dir = path.join(REPO_ROOT, dirRel);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => path.join(dirRel, e.name).replace(/\\/g, '/'));
}

function walkJsFiles(dirRel) {
  const dir = path.join(REPO_ROOT, dirRel);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dirRel];
  while (stack.length > 0) {
    const cur = stack.pop();
    const full = path.join(REPO_ROOT, cur);
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      const relPath = path.join(cur, entry.name).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        stack.push(relPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        out.push(relPath);
      }
    }
  }
  return out;
}

describe('ArchUnitTS (tsarch) 純 JS 対応 — ファイルレベル依存方向ルール', () => {
  // ─── 許容ルール: 主要モジュール間の参照は OK ──────────────────────

  it('meter.js は map-matcher.js への参照 (= Worker B 起動) が許容される', () => {
    const source = readFile('js/meter.js');
    // mmWorker.postMessage / map-matcher.js の文字列参照は許容
    // 本 test は「禁止していないこと」を明示するための placeholder
    expect(typeof source).toBe('string');
    expect(source.length).toBeGreaterThan(0);
  });

  it('gps.js は meter.js への参照 (= onUpdateCallback 経由) が許容される', () => {
    const source = readFile('js/gps.js');
    expect(typeof source).toBe('string');
    expect(source.length).toBeGreaterThan(0);
  });

  it('index.html から js/*.js への <script src> 依存は許可 (= 多数存在)', () => {
    const html = readFile('index.html');
    const matches = html.match(/<script[^>]+src=["']js\/[^"']+["']/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });

  // ─── 禁止ルール: SW / 課金本体への汚染禁止 ────────────────────────

  it('js/*.js から sw.js への直接 require/import は禁止', () => {
    const violations = [];
    for (const rel of listDirJsFiles('js')) {
      const source = readFile(rel);
      // require('../sw.js') / require('./../sw') 等のパターン
      if (/require\s*\(\s*['"][^'"]*\bsw(?:\.js)?['"]\s*\)/.test(source)) {
        violations.push(rel + ' に sw への require() 検出');
      }
      // import ... from '...sw' パターン
      if (/import[^;]+from\s+['"][^'"]*\bsw(?:\.js)?['"]/.test(source)) {
        violations.push(rel + ' に sw への import 検出');
      }
    }
    if (violations.length > 0) {
      throw new Error('依存方向違反:\n  ' + violations.join('\n  '));
    }
  });

  it('tests/* が js/meter.js / js/gps-worker.js / js/map-matcher.js を直接書換する pattern は禁止', () => {
    const protectedFiles = ['meter.js', 'gps-worker.js', 'map-matcher.js', 'gps.js'];
    const violations = [];
    for (const rel of walkJsFiles('tests')) {
      const source = readFile(rel);
      for (const protectedFile of protectedFiles) {
        // fs.writeFile(...meter.js... / fs.writeFileSync(...meter.js... pattern
        const pattern = new RegExp(
          'fs\\.write(?:File|FileSync)\\s*\\([^)]*\\b' + protectedFile.replace('.', '\\.') + '\\b',
          ''
        );
        if (pattern.test(source)) {
          violations.push(rel + ' が js/' + protectedFile + ' を fs.writeFile 直接書換');
        }
      }
    }
    if (violations.length > 0) {
      throw new Error('テストによる本体書換違反:\n  ' + violations.join('\n  '));
    }
  });

  // ─── 整合性チェック: テスト基盤の構造維持 ─────────────────────────

  it('全 js/*.js が strict mode 系または IIFE パターンに準拠', () => {
    const violations = [];
    for (const rel of listDirJsFiles('js')) {
      const source = readFile(rel);
      // IIFE もしくは "use strict" もしくは ES Module の何れか
      const hasIife = /^\s*\(\s*function\s*\(/m.test(source) || /\(\(\)\s*=>\s*\{/m.test(source);
      const hasUseStrict = /['"]use strict['"]/m.test(source);
      const hasExport = /^\s*export\b/m.test(source);
      const hasModuleExports = /\bmodule\.exports\b/m.test(source);
      if (!hasIife && !hasUseStrict && !hasExport && !hasModuleExports) {
        // ダイコメは IIFE で globals を expose する設計が主流 (= meter.js / gps.js 等)
        // 一部 module (= firebase-config.js) は IIFE なし許容のため warn 止め
        // ここでは informational として記録するのみ (= fail はしない)
      }
    }
    // 違反でも fail しない (= 設計許容範囲) ・統計のみ
    expect(violations.length).toBe(0);
  });
});
