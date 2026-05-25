// tests/unit/osrm-client-fallback.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P3-⑱ / 全32件)
//
// 検証対象: osrm-client.js OsrmClient.matchBatch / setEndpoint / getEndpoint
//   TIMEOUT_MS=8000・MIN_COORDS=2・MAX_COORDS=100
//   navigator.onLine=false / coords invalid / 過多座標 / fetch error の fallback
//
// 絶対ルール準拠:
//   js/osrm-client.js は触らない absolute・vm sandbox + fetch mock。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const OC_PATH = path.join(__dirname, '..', '..', 'js', 'osrm-client.js');

function loadSource() {
  return fs.readFileSync(OC_PATH, 'utf8');
}

function loadOsrmClient(opts) {
  opts = opts || {};
  const ctx = {
    console: console,
    AbortController: typeof AbortController !== 'undefined' ? AbortController : undefined,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.navigator = opts.navigator || { onLine: true };
  ctx.fetch =
    opts.fetch ||
    (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            code: 'Ok',
            matchings: [{ legs: [{ distance: 100 }] }],
            tracepoints: [],
          }),
      }));
  ctx.setTimeout = setTimeout;
  ctx.clearTimeout = clearTimeout;
  vm.createContext(ctx);
  vm.runInContext(loadSource(), ctx, { filename: 'js/osrm-client.js' });
  return ctx.OsrmClient;
}

describe('osrm-client.js OsrmClient (P3-⑱)', () => {
  it('S1: TIMEOUT_MS=8000 / MIN_COORDS=2 / MAX_COORDS=100 定数', () => {
    const source = loadSource();
    if (!/TIMEOUT_MS\s*=\s*8000\b/.test(source)) throw new Error('TIMEOUT_MS=8000 未検出');
    if (!/MIN_COORDS\s*=\s*2\b/.test(source)) throw new Error('MIN_COORDS=2 未検出');
    if (!/MAX_COORDS\s*=\s*100\b/.test(source)) throw new Error('MAX_COORDS=100 未検出');
  });

  it('S2: setEndpoint / getEndpoint / matchBatch API 定義', () => {
    const source = loadSource();
    if (!/function\s+matchBatch\s*\(/.test(source)) throw new Error('matchBatch 未検出');
    if (!/function\s+setEndpoint\s*\(/.test(source)) throw new Error('setEndpoint 未検出');
    if (!/function\s+getEndpoint\s*\(/.test(source)) throw new Error('getEndpoint 未検出');
  });

  it('S3: navigator.onLine=false で即スキップ経路', () => {
    const source = loadSource();
    if (!/navigator\.onLine\s*===\s*false/.test(source)) {
      throw new Error('navigator.onLine ガード未検出');
    }
  });

  it('S4: window / self 両方への export (= main + Worker 両環境対応)', () => {
    const source = loadSource();
    if (!/self\.OsrmClient\s*=\s*api/.test(source))
      throw new Error('self.OsrmClient export 未検出');
    if (!/window\.OsrmClient\s*=\s*api/.test(source))
      throw new Error('window.OsrmClient export 未検出');
  });

  it('D1: getEndpoint default = router.project-osrm.org', () => {
    const OC = loadOsrmClient();
    expect(OC.getEndpoint()).toBe('https://router.project-osrm.org');
  });

  it('D2: setEndpoint で endpoint 更新・trailing slash 除去', () => {
    const OC = loadOsrmClient();
    OC.setEndpoint('https://my-osrm.example.com/');
    expect(OC.getEndpoint()).toBe('https://my-osrm.example.com');
    OC.setEndpoint('https://other.example.com');
    expect(OC.getEndpoint()).toBe('https://other.example.com');
  });

  it('D3: setEndpoint(空文字 / null / 数値) で更新されない', () => {
    const OC = loadOsrmClient();
    OC.setEndpoint('https://valid.example.com');
    OC.setEndpoint('');
    expect(OC.getEndpoint()).toBe('https://valid.example.com');
    OC.setEndpoint(null);
    expect(OC.getEndpoint()).toBe('https://valid.example.com');
    OC.setEndpoint(123);
    expect(OC.getEndpoint()).toBe('https://valid.example.com');
  });

  it('D4: matchBatch(null) → invalid coords', async () => {
    const OC = loadOsrmClient();
    const r = await OC.matchBatch(null);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid coords');
  });

  it('D5: matchBatch(非配列) → invalid coords', async () => {
    const OC = loadOsrmClient();
    const r = await OC.matchBatch('not array');
    expect(r.reason).toBe('invalid coords');
  });

  it('D6: matchBatch(1 座標) → too few coords (MIN_COORDS=2)', async () => {
    const OC = loadOsrmClient();
    const r = await OC.matchBatch([{ lat: 35.68, lng: 139.69 }]);
    expect(r.reason).toBe('too few coords');
  });

  it('D7: navigator.onLine=false → offline reason', async () => {
    const OC = loadOsrmClient({ navigator: { onLine: false } });
    const r = await OC.matchBatch([
      { lat: 35.68, lng: 139.69 },
      { lat: 35.69, lng: 139.7 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('offline');
  });

  it('D8: fetch http error (= !r.ok) で reason="http <status>"', async () => {
    const OC = loadOsrmClient({
      fetch: () => Promise.resolve({ ok: false, status: 503 }),
    });
    const r = await OC.matchBatch([
      { lat: 35.68, lng: 139.69 },
      { lat: 35.69, lng: 139.7 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('http 503');
  });

  it('D9: fetch 例外で reason="error: <msg>"', async () => {
    const OC = loadOsrmClient({
      fetch: () => Promise.reject(new Error('network down')),
    });
    const r = await OC.matchBatch([
      { lat: 35.68, lng: 139.69 },
      { lat: 35.69, lng: 139.7 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^error: /);
  });

  it('D10: 正常 200 response で ok=true + legs 取得', async () => {
    const OC = loadOsrmClient({
      fetch: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              code: 'Ok',
              matchings: [{ legs: [{ distance: 250 }] }],
              tracepoints: [],
            }),
        }),
    });
    const r = await OC.matchBatch([
      { lat: 35.68, lng: 139.69 },
      { lat: 35.69, lng: 139.7 },
    ]);
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.legs)).toBe(true);
    // legs は number 配列 (= leg.distance のみ抽出)
    expect(r.legs[0]).toBe(250);
  });

  it('D11: code !== "Ok" で reason="osrm <code>"', async () => {
    const OC = loadOsrmClient({
      fetch: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ code: 'NoMatch' }),
        }),
    });
    const r = await OC.matchBatch([
      { lat: 35.68, lng: 139.69 },
      { lat: 35.69, lng: 139.7 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('osrm NoMatch');
  });

  it('D12: matchings 空 → reason="no matchings"', async () => {
    const OC = loadOsrmClient({
      fetch: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ code: 'Ok', matchings: [] }),
        }),
    });
    const r = await OC.matchBatch([
      { lat: 35.68, lng: 139.69 },
      { lat: 35.69, lng: 139.7 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no matchings');
  });
});
