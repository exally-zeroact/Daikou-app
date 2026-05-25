// tests/integration/data-loader-idb-cache.test.js
//
// ★設計変更宣言 (2026-05-23・X4 方式E・IDB parse cache verify):
//   data-loader.js の・IDB cache 経路を・unit + integration で verify。
//   Node 環境では・indexedDB 自体が undefined のため・主に「fallback chain が・
//   正常動作するか」「内部 helper の・graceful 挙動」を中心に試験。
//   本物 IDB の hit/miss シナリオは・e2e (= playwright) 別 task で carry。
//
// 検証内容:
//   1. _currentVersion: DataRegistry.VERSION 参照 + fallback 'unknown'
//   2. _openCacheDb: indexedDB undefined → null 返却 (= graceful)
//   3. _idbGet: db null → null 返却
//   4. _idbPut: db null → silent skip (= 例外 throw しない)
//   5. _idbClear: db null → silent skip
//   6. loadFromCache: IDB null + global.fetch mock で・既存経路 経由・sandbox 正常返却
//   7. loadFromCache: 同一 url 連続呼出・sandbox 構造 同一
//   8. window.XXX 互換: sandbox 形式が・既存 fetch+eval 経路と・1 bit 不変
//
// 絶対ルール準拠:
//   ✓ decimal mock 禁止: 本物 ADDRESSES_COARSE_JP 形式 (= int×1e5 + items) を fixture に使用
//   ✓ distance_m / Worker B 本体 無関係 (= data 層の・cache 動作のみ)
//   ✓ iOS/Android 共通 (= node test は・両 OS の・native API 模擬)

'use strict';

const fs = require('fs');
const path = require('path');

// data-loader.js は・IIFE で・global.DataLoader を・代入する
// Node では・global を・偽 window として・渡す
const _GLOBAL = {};

beforeAll(() => {
  // ─── DataRegistry mock (= 本物形式・VERSION + 構造) ───
  _GLOBAL.DataRegistry = {
    VERSION: '2026-05-23-e1',
    DATA_REGISTRY: {
      global: [],
      perPref: [],
    },
    expandPerPref: function () {
      return [];
    },
  };
  // ─── DataLoader を・Node に・load (= window 引数 で・_GLOBAL 渡す) ───
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'data-loader.js'), 'utf8');
  // IIFE は・引数 (= typeof window) で・global 判定するため・
  // ここでは・global オブジェクトに・直接 DataRegistry を載せて・eval する
  global.DataRegistry = _GLOBAL.DataRegistry;
  // indexedDB は・Node にないので・undefined のまま (= 確認したい挙動)
  // performance も Node 18+ で・既存 (= 計測 hook 動作 確認用)
  new Function(src)();
});

afterAll(() => {
  delete global.DataRegistry;
  delete global.DataLoader;
});

// ─── 1. _currentVersion ─────────────────────────────
describe('data-loader IDB cache: _currentVersion', () => {
  it('global.DataRegistry.VERSION が・あれば・それを返す', () => {
    expect(global.DataLoader._currentVersion()).toBe('2026-05-23-e1');
  });

  it('DataRegistry なし → "unknown" fallback', () => {
    const saved = global.DataRegistry;
    delete global.DataRegistry;
    expect(global.DataLoader._currentVersion()).toBe('unknown');
    global.DataRegistry = saved;
  });
});

// ─── 2. _openCacheDb ─────────────────────────────────
describe('data-loader IDB cache: _openCacheDb', () => {
  it('indexedDB undefined (Node) → Promise<null> (= graceful)', async () => {
    const db = await global.DataLoader._openCacheDb();
    expect(db).toBeNull();
  });
});

// ─── 3. _idbGet ───────────────────────────────────────
describe('data-loader IDB cache: _idbGet', () => {
  it('db null → null 返却 (= 例外 throw しない)', async () => {
    const result = await global.DataLoader._idbGet('/data/foo.js');
    expect(result).toBeNull();
  });
});

// ─── 4. _idbPut ───────────────────────────────────────
describe('data-loader IDB cache: _idbPut', () => {
  it('db null → silent skip (= 例外 throw しない)', async () => {
    // 本物 ADDRESSES_COARSE_JP 形式の sandbox (= 既存 data file plain object)
    const sandbox = {
      ADDRESSES_COARSE_JP: {
        v: 1,
        precision: 100000,
        items: [{ lat: 3406467, lng: 13300150, n: '今治市', p: '38', c: '38202' }],
      },
    };
    // 例外 throw しないこと verify
    await expect(
      global.DataLoader._idbPut('/data/addresses-coarse-jp.js', '2026-05-23-e1', sandbox)
    ).resolves.toBeUndefined();
  });
});

// ─── 5. _idbClear ────────────────────────────────────
describe('data-loader IDB cache: _idbClear', () => {
  it('db null → silent skip', async () => {
    await expect(global.DataLoader._idbClear()).resolves.toBeUndefined();
  });
});

// ─── 6. loadFromCache: fallback fetch+eval 経路 ───────
describe('data-loader IDB cache: loadFromCache fallback 経路', () => {
  let originalFetch;
  beforeAll(() => {
    originalFetch = global.fetch;
    // 本物 data file 形式 (= window.X = {...} JS source) を・mock fetch で返す
    global.fetch = async function (_url) {
      // 本物 ADDRESSES_COARSE_JP 形式 (= int×1e5 + items・decimal mock 禁止)
      const body =
        'window.ADDRESSES_COARSE_JP = ' +
        JSON.stringify({
          v: 1,
          precision: 100000,
          items: [
            { lat: 3406467, lng: 13300150, n: '今治市', p: '38', c: '38202' },
            { lat: 3358439, lng: 13276706, n: '松山市', p: '38', c: '38201' },
          ],
        }) +
        ';';
      return {
        ok: true,
        status: 200,
        text: async () => body,
      };
    };
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('IDB null + fetch mock で・既存経路 経由・sandbox 正常返却', async () => {
    const sandbox = await global.DataLoader.loadFromCache('/data/addresses-coarse-jp.js');
    expect(sandbox).toBeDefined();
    expect(sandbox.ADDRESSES_COARSE_JP).toBeDefined();
    expect(sandbox.ADDRESSES_COARSE_JP.v).toBe(1);
    expect(sandbox.ADDRESSES_COARSE_JP.precision).toBe(100000);
    expect(sandbox.ADDRESSES_COARSE_JP.items.length).toBe(2);
    // window.XXX 互換: 本物形式 int×1e5 保持
    expect(sandbox.ADDRESSES_COARSE_JP.items[0].lat).toBe(3406467);
    expect(sandbox.ADDRESSES_COARSE_JP.items[0].n).toBe('今治市');
  });

  it('同一 url 連続呼出: 構造 完全同一 (= window.XXX 1 bit 不変)', async () => {
    const sandbox1 = await global.DataLoader.loadFromCache('/data/addresses-coarse-jp.js');
    const sandbox2 = await global.DataLoader.loadFromCache('/data/addresses-coarse-jp.js');
    // JSON.stringify で・完全同一 verify
    expect(JSON.stringify(sandbox1)).toBe(JSON.stringify(sandbox2));
  });

  it('fetch fail (= ネット切断 模擬) → 例外 throw・cache miss path で・fail 顕在化', async () => {
    const savedFetch = global.fetch;
    global.fetch = async function () {
      throw new Error('network error');
    };
    await expect(global.DataLoader.loadFromCache('/data/dummy.js')).rejects.toThrow(/fetch failed/);
    global.fetch = savedFetch;
  });

  it('fetch res.ok=false → 例外 throw', async () => {
    const savedFetch = global.fetch;
    global.fetch = async function () {
      return { ok: false, status: 404, text: async () => '' };
    };
    await expect(global.DataLoader.loadFromCache('/data/notfound.js')).rejects.toThrow(/not ok/);
    global.fetch = savedFetch;
  });
});

// ─── 7. window.XXX 互換 (= 既存出力と・1 bit 不変) ────
describe('data-loader IDB cache: window.XXX 互換 verify', () => {
  let originalFetch;
  beforeAll(() => {
    originalFetch = global.fetch;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('roads-{pref} 形式 (= 本物 plain object) も・正常 eval', async () => {
    // 本物 roads-ehime.js は・int×1e5 + base64 + plain・decimal mock 禁止
    const realLikeBody =
      'window.ROADS_EHIME = ' +
      JSON.stringify({
        v: 6,
        prefecture: 'ehime',
        precision: 100000,
        bbox: [3294980, 13236976, 3412666, 13364248],
        nodes: [],
        edges: [],
      }) +
      ';';
    global.fetch = async function () {
      return { ok: true, status: 200, text: async () => realLikeBody };
    };
    const sandbox = await global.DataLoader.loadFromCache('/data/roads-ehime.js');
    expect(sandbox.ROADS_EHIME).toBeDefined();
    expect(sandbox.ROADS_EHIME.v).toBe(6);
    expect(sandbox.ROADS_EHIME.prefecture).toBe('ehime');
    expect(sandbox.ROADS_EHIME.precision).toBe(100000);
    expect(Array.isArray(sandbox.ROADS_EHIME.bbox)).toBe(true);
    expect(sandbox.ROADS_EHIME.bbox[0]).toBe(3294980);
  });
});
