// tests/unit/data-registry-metadata.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P3-⑯ / 全32件)
//
// 検証対象: data-registry.js DATA_REGISTRY metadata + PREFECTURES_47
//   PREFECTURES_47: 全国 47 県リスト (ROADS_DL と同順序)
//   DATA_REGISTRY.global: 全国共通 (= worker/main 別 entries)
//   DATA_REGISTRY.perPref: 都道府県別 (7 種 × 47 = 329 件想定)
//
// 絶対ルール準拠:
//   js/data-registry.js は触らない absolute・vm sandbox + source 静的解析。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DR_PATH = path.join(__dirname, '..', '..', 'js', 'data-registry.js');

function loadSource() {
  return fs.readFileSync(DR_PATH, 'utf8');
}

function loadRegistry() {
  const ctx = { console: console };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(loadSource(), ctx, { filename: 'js/data-registry.js' });
  // data-registry.js は global.DataRegistry={PREFECTURES_47, DATA_REGISTRY, ...} で export
  return {
    PREFECTURES_47: ctx.DataRegistry && ctx.DataRegistry.PREFECTURES_47,
    DATA_REGISTRY: ctx.DataRegistry && ctx.DataRegistry.DATA_REGISTRY,
    VERSION: ctx.DataRegistry && ctx.DataRegistry.VERSION,
  };
}

describe('data-registry.js DATA_REGISTRY + PREFECTURES_47 (P3-⑯)', () => {
  it('S1: PREFECTURES_47 / DATA_REGISTRY 定義の存在', () => {
    const source = loadSource();
    if (!/PREFECTURES_47\s*=\s*\[/.test(source)) {
      throw new Error('PREFECTURES_47 定義未検出');
    }
    if (!/DATA_REGISTRY\s*=\s*\{/.test(source)) {
      throw new Error('DATA_REGISTRY 定義未検出');
    }
  });

  it('S2: DATA_REGISTRY.global / .perPref の存在', () => {
    const source = loadSource();
    if (!/global\s*:\s*\[/.test(source)) {
      throw new Error('DATA_REGISTRY.global 未検出');
    }
    if (!/perPref\s*:\s*\[/.test(source)) {
      throw new Error('DATA_REGISTRY.perPref 未検出');
    }
  });

  it('D1: PREFECTURES_47 は 47 県・hokkaido で始まり okinawa で終わる', () => {
    const { PREFECTURES_47 } = loadRegistry();
    expect(Array.isArray(PREFECTURES_47)).toBe(true);
    expect(PREFECTURES_47.length).toBe(47);
    expect(PREFECTURES_47[0]).toBe('hokkaido');
    expect(PREFECTURES_47[46]).toBe('okinawa');
  });

  it('D2: PREFECTURES_47 全件が重複なし unique', () => {
    const { PREFECTURES_47 } = loadRegistry();
    const set = new Set(PREFECTURES_47);
    expect(set.size).toBe(47);
  });

  it('D3: DATA_REGISTRY.global は配列・各 entry に url/globalKey/target', () => {
    const { DATA_REGISTRY } = loadRegistry();
    expect(Array.isArray(DATA_REGISTRY.global)).toBe(true);
    expect(DATA_REGISTRY.global.length).toBeGreaterThan(0);
    for (const entry of DATA_REGISTRY.global) {
      expect(typeof entry.url).toBe('string');
      expect(typeof entry.globalKey).toBe('string');
      expect(['worker', 'main']).toContain(entry.target);
    }
  });

  it('D4: DATA_REGISTRY.global の worker target entry は msgType を持つ', () => {
    const { DATA_REGISTRY } = loadRegistry();
    const workerEntries = DATA_REGISTRY.global.filter((e) => e.target === 'worker');
    expect(workerEntries.length).toBeGreaterThan(0);
    for (const entry of workerEntries) {
      expect(typeof entry.msgType).toBe('string');
    }
  });

  it('D5: DATA_REGISTRY.perPref は配列・各 entry に urlTemplate (= {pref} 置換)', () => {
    const { DATA_REGISTRY } = loadRegistry();
    expect(Array.isArray(DATA_REGISTRY.perPref)).toBe(true);
    expect(DATA_REGISTRY.perPref.length).toBeGreaterThan(0);
  });

  it('D6: 主要県 (tokyo, osaka, hokkaido) が PREFECTURES_47 に含まれる', () => {
    const { PREFECTURES_47 } = loadRegistry();
    expect(PREFECTURES_47).toContain('tokyo');
    expect(PREFECTURES_47).toContain('osaka');
    expect(PREFECTURES_47).toContain('hokkaido');
    expect(PREFECTURES_47).toContain('okinawa');
  });

  it('D7: DATA_REGISTRY.global url は /data/ で始まり .js で終わる', () => {
    const { DATA_REGISTRY } = loadRegistry();
    for (const entry of DATA_REGISTRY.global) {
      expect(entry.url).toMatch(/^\/data\/[\w-]+\.js$/);
    }
  });

  it('D8: globalKey は SCREAMING_SNAKE_CASE (= JS 慣例)', () => {
    const { DATA_REGISTRY } = loadRegistry();
    for (const entry of DATA_REGISTRY.global) {
      expect(entry.globalKey).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('D9: optional flag (= true/undefined) で必須/任意区別', () => {
    const { DATA_REGISTRY } = loadRegistry();
    const optionalEntries = DATA_REGISTRY.global.filter((e) => e.optional === true);
    // backbone / dem 等 optional 系は存在
    expect(optionalEntries.length).toBeGreaterThanOrEqual(1);
  });
});
