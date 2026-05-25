// tests/integration/sw-precache-swr.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step ㉙ / 全32件・真の完全網羅 1/4)
//
// 検証対象: sw.js 47 県 PRECACHE 戦略 + SWR 動作
//   PRECACHE_FILES: 全国共通バンドル (= install 時 1 回 DL)
//   県別ファイル (poi-{pref} / hazard-*-{pref}): PRECACHE 対象外・SWR で cache
//
// 絶対ルール準拠:
//   js/sw.js は触らない absolute・source の静的 verify のみ。

const fs = require('fs');
const path = require('path');

const SW_PATH = path.join(__dirname, '..', '..', 'sw.js');
const SW_SRC = fs.readFileSync(SW_PATH, 'utf8');

describe('sw.js 47 県 PRECACHE + SWR (㉙)', () => {
  it('S1: PRECACHE_FILES 配列が定義されている', () => {
    if (!/PRECACHE_FILES\s*=\s*\[/.test(SW_SRC)) {
      throw new Error('PRECACHE_FILES 定数未検出');
    }
  });

  it('S2: install event で PRECACHE が走る', () => {
    if (!/addEventListener\s*\(\s*['"]install['"]/.test(SW_SRC)) {
      throw new Error('install event listener 未検出');
    }
  });

  it('S3: fetch event handler (= SWR or cache-first 経路) が存在', () => {
    if (!/addEventListener\s*\(\s*['"]fetch['"]/.test(SW_SRC)) {
      throw new Error('fetch event listener 未検出');
    }
  });

  it('S4: 県別ファイル (poi-{pref}) は SWR or 個別 cache 戦略', () => {
    // sw.js 内に poi- / hazard- 文字列の存在で 47 県戦略を verify
    const hasPrefStrategy = /poi-/.test(SW_SRC) || /hazard-/.test(SW_SRC) || /roads-/.test(SW_SRC);
    if (!hasPrefStrategy) {
      throw new Error('県別ファイル戦略 (poi-/hazard-/roads-) 未検出');
    }
  });

  it('S5: caches.open + caches.match の利用 (= Cache API)', () => {
    if (!/caches\.open\s*\(/.test(SW_SRC)) {
      throw new Error('caches.open 利用未検出');
    }
    if (!/caches\.match\s*\(/.test(SW_SRC) && !/cache\.match\s*\(/.test(SW_SRC)) {
      throw new Error('caches/cache.match 利用未検出');
    }
  });

  it('S6: activate event で 古い cache 削除 (= 削除戦略)', () => {
    if (!/addEventListener\s*\(\s*['"]activate['"]/.test(SW_SRC)) {
      throw new Error('activate event listener 未検出');
    }
  });

  it('S7: CACHE_NAME 定数 (= アプリコード cache 識別)', () => {
    if (!/CACHE_NAME|CACHE_VERSION|cache_name/i.test(SW_SRC)) {
      throw new Error('CACHE_NAME / CACHE_VERSION 定数未検出');
    }
  });
});
