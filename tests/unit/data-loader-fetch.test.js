// tests/unit/data-loader-fetch.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P3-⑲ / 全32件)
//
// 検証対象: data-loader.js DataLoader.loadFromCache
//   _matchInCaches: daikome-roads-v1 → daikome-* の順検索
//   _fetchAsText: cache miss → fetch (cache:'reload')
//   _evalText: new Function('window', text) で sandbox eval
//
// 絶対ルール準拠:
//   js/data-loader.js は触らない absolute・vm sandbox + caches/fetch mock。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DL_PATH = path.join(__dirname, '..', '..', 'js', 'data-loader.js');

function loadSource() {
  return fs.readFileSync(DL_PATH, 'utf8');
}

function loadDataLoader(opts) {
  opts = opts || {};
  const ctx = { console: console };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.caches = opts.caches;
  ctx.fetch = opts.fetch || (() => Promise.reject(new Error('no fetch mock')));
  vm.createContext(ctx);
  vm.runInContext(loadSource(), ctx, { filename: 'js/data-loader.js' });
  return ctx.DataLoader;
}

describe('data-loader.js DataLoader.loadFromCache (P3-⑲)', () => {
  it('S1: loadFromCache / _matchInCaches / _fetchAsText / _evalText 定義', () => {
    const source = loadSource();
    if (!/async\s+function\s+loadFromCache\s*\(/.test(source)) {
      throw new Error('loadFromCache 未検出');
    }
    if (!/async\s+function\s+_matchInCaches\s*\(/.test(source)) {
      throw new Error('_matchInCaches 未検出');
    }
    if (!/async\s+function\s+_fetchAsText\s*\(/.test(source)) {
      throw new Error('_fetchAsText 未検出');
    }
    if (!/function\s+_evalText\s*\(/.test(source)) throw new Error('_evalText 未検出');
  });

  it('S2: cache 検索順序 = daikome-roads-v1 → daikome-* (= roads 優先)', () => {
    const source = loadSource();
    if (!/daikome-roads-v1/.test(source)) {
      throw new Error('daikome-roads-v1 cache 名未検出');
    }
    if (!/indexOf\s*\(\s*['"]daikome-['"]\s*\)\s*!==\s*0/.test(source)) {
      throw new Error('daikome- prefix フィルタ未検出');
    }
  });

  it('S3: fetch cache: reload (= HTTP cache bypass)', () => {
    const source = loadSource();
    if (!/cache\s*:\s*['"]reload['"]/.test(source)) {
      throw new Error('cache:reload 未検出');
    }
  });

  it('S4: new Function("window", text) で sandbox eval', () => {
    const source = loadSource();
    if (!/new\s+Function\s*\(\s*['"]window['"]\s*,\s*text\s*\)/.test(source)) {
      throw new Error('new Function("window", text) 未検出');
    }
  });

  it('D1: cache hit で text 取得 → eval', async () => {
    const cacheMock = {
      keys: () => Promise.resolve(['daikome-roads-v1']),
      open: () =>
        Promise.resolve({
          match: () =>
            Promise.resolve({
              ok: true,
              text: () => Promise.resolve('window.TEST_DATA = { value: 123 };'),
            }),
        }),
    };
    const DL = loadDataLoader({ caches: cacheMock });
    const result = await DL.loadFromCache('/data/test.js');
    expect(result.TEST_DATA).toEqual({ value: 123 });
  });

  it('D2: cache miss + fetch ok → text eval', async () => {
    const cacheMock = {
      keys: () => Promise.resolve([]),
      open: () => Promise.resolve({ match: () => Promise.resolve(null) }),
    };
    const fetchMock = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('window.FOO = "bar";'),
      });
    const DL = loadDataLoader({ caches: cacheMock, fetch: fetchMock });
    const result = await DL.loadFromCache('/data/foo.js');
    expect(result.FOO).toBe('bar');
  });

  it('D3: cache miss + fetch 失敗 → reject with "fetch failed"', async () => {
    const cacheMock = {
      keys: () => Promise.resolve([]),
      open: () => Promise.resolve({ match: () => Promise.resolve(null) }),
    };
    const DL = loadDataLoader({
      caches: cacheMock,
      fetch: () => Promise.reject(new Error('network')),
    });
    await expect(DL.loadFromCache('/data/x.js')).rejects.toThrow(/fetch failed/);
  });

  it('D4: fetch 200 but !ok → reject with "not ok"', async () => {
    const cacheMock = {
      keys: () => Promise.resolve([]),
      open: () => Promise.resolve({ match: () => Promise.resolve(null) }),
    };
    const fetchMock = () =>
      Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
    const DL = loadDataLoader({ caches: cacheMock, fetch: fetchMock });
    await expect(DL.loadFromCache('/data/x.js')).rejects.toThrow(/not ok.*404/);
  });

  it('D5: eval error (= 不正 JS) → reject with "eval failed"', async () => {
    const cacheMock = {
      keys: () => Promise.resolve([]),
      open: () => Promise.resolve({ match: () => Promise.resolve(null) }),
    };
    const fetchMock = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('this is not valid javascript {'),
      });
    const DL = loadDataLoader({ caches: cacheMock, fetch: fetchMock });
    await expect(DL.loadFromCache('/data/x.js')).rejects.toThrow(/eval failed/);
  });

  it('D6: window グローバル汚染なし (= sandbox に限定)', async () => {
    const cacheMock = {
      keys: () => Promise.resolve([]),
      open: () => Promise.resolve({ match: () => Promise.resolve(null) }),
    };
    const fetchMock = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('window.LOCAL_VAR = 42;'),
      });
    const DL = loadDataLoader({ caches: cacheMock, fetch: fetchMock });
    const result = await DL.loadFromCache('/data/x.js');
    // sandbox に代入されているが globalThis (= window) には汚染なし
    expect(result.LOCAL_VAR).toBe(42);
    expect(globalThis.LOCAL_VAR).toBeUndefined();
  });

  it('D7: caches API 未対応環境 (= caches=undefined) でも fetch fallback', async () => {
    const fetchMock = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('window.RES = "ok";'),
      });
    const DL = loadDataLoader({ caches: undefined, fetch: fetchMock });
    const result = await DL.loadFromCache('/data/x.js');
    expect(result.RES).toBe('ok');
  });

  it('D8: 複数 cache (daikome-roads-v1 + daikome-app-xyz) を順次検索', async () => {
    const openedCaches = [];
    const cacheMock = {
      keys: () => Promise.resolve(['daikome-roads-v1', 'daikome-app-xyz', 'other-cache']),
      open: (name) => {
        openedCaches.push(name);
        return Promise.resolve({
          match: () => {
            if (name === 'daikome-app-xyz') {
              return Promise.resolve({
                ok: true,
                text: () => Promise.resolve('window.M = "matched";'),
              });
            }
            return Promise.resolve(null);
          },
        });
      },
    };
    const DL = loadDataLoader({ caches: cacheMock });
    const result = await DL.loadFromCache('/data/x.js');
    expect(result.M).toBe('matched');
    // daikome-roads-v1 が先に open される
    expect(openedCaches[0]).toBe('daikome-roads-v1');
    // other-cache (= daikome- prefix なし) は open されない
    expect(openedCaches).not.toContain('other-cache');
  });
});
