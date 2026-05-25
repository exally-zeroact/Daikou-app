// tests/unit/region-helper-conversion.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P3-⑰ / 全32件)
//
// 検証対象: region-helper.js RegionHelper API
//   getCurrentPref(lat, lng[, accuracy]): JIS x 0401 県コード → ローマ字 pref
//   isReady(): ADDRESSES_COARSE_JP load 済か
//
// 絶対ルール準拠:
//   js/region-helper.js は触らない absolute・vm sandbox + ADDRESSES_COARSE_JP mock。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RH_PATH = path.join(__dirname, '..', '..', 'js', 'region-helper.js');

function loadSource() {
  return fs.readFileSync(RH_PATH, 'utf8');
}

function loadRegionHelper(addressesData) {
  const ctx = { console: console, Math: Math };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  if (addressesData) ctx.ADDRESSES_COARSE_JP = addressesData;
  vm.createContext(ctx);
  vm.runInContext(loadSource(), ctx, { filename: 'js/region-helper.js' });
  return ctx.RegionHelper;
}

describe('region-helper.js RegionHelper (P3-⑰)', () => {
  it('S1: global.RegionHelper として export', () => {
    const source = loadSource();
    if (!/global\.RegionHelper\s*=\s*\{/.test(source)) {
      throw new Error('global.RegionHelper export 未検出');
    }
  });

  it('S2: getCurrentPref / isReady API の存在', () => {
    const source = loadSource();
    if (!/getCurrentPref\s*:\s*getCurrentPref/.test(source)) {
      throw new Error('getCurrentPref export 未検出');
    }
    if (!/isReady\s*:\s*isReady/.test(source)) {
      throw new Error('isReady export 未検出');
    }
  });

  it('S3: JIS コード→ローマ字テーブル _JIS_TO_PREF が定義されている', () => {
    const source = loadSource();
    if (!/_JIS_TO_PREF\s*=\s*\{/.test(source)) {
      throw new Error('_JIS_TO_PREF テーブル未検出');
    }
  });

  it('S4: 主要県 (hokkaido / tokyo / osaka / okinawa) が _JIS_TO_PREF に含まれる', () => {
    const source = loadSource();
    if (!/['"]01['"]\s*:\s*['"]hokkaido['"]/.test(source)) {
      throw new Error('JIS 01 → hokkaido 未検出');
    }
    if (!/13\s*:\s*['"]tokyo['"]/.test(source)) {
      throw new Error('JIS 13 → tokyo 未検出');
    }
    if (!/27\s*:\s*['"]osaka['"]/.test(source)) {
      throw new Error('JIS 27 → osaka 未検出');
    }
    if (!/47\s*:\s*['"]okinawa['"]/.test(source)) {
      throw new Error('JIS 47 → okinawa 未検出');
    }
  });

  it('D1: ADDRESSES_COARSE_JP 未 load → isReady=false', () => {
    const RH = loadRegionHelper(null);
    expect(RH.isReady()).toBe(false);
  });

  it('D2: ADDRESSES_COARSE_JP 空 items → isReady=false', () => {
    const RH = loadRegionHelper({ items: [] });
    expect(RH.isReady()).toBe(false);
  });

  it('D3: ADDRESSES_COARSE_JP 正常 items → isReady=true', () => {
    // items の lat/lng は ×100000 整数 (= region-helper.js L142 /100000 で戻る)
    const RH = loadRegionHelper({
      items: [{ lat: 3568000, lng: 13969000, c: '13xxxx' }], // 東京
    });
    expect(RH.isReady()).toBe(true);
  });

  it('D4: isReady=false で getCurrentPref → null', () => {
    const RH = loadRegionHelper(null);
    expect(RH.getCurrentPref(35.68, 139.69)).toBeNull();
  });

  it('D5: 東京座標 (35.68, 139.69) + JIS 13 entry → tokyo', () => {
    const RH = loadRegionHelper({
      items: [{ lat: 3568000, lng: 13969000, c: '13xxxx' }],
    });
    expect(RH.getCurrentPref(35.68, 139.69)).toBe('tokyo');
  });

  it('D6: 大阪座標 + JIS 27 entry → osaka', () => {
    const RH = loadRegionHelper({
      items: [{ lat: 3469000, lng: 13550000, c: '27xxxx' }],
    });
    expect(RH.getCurrentPref(34.69, 135.5)).toBe('osaka');
  });

  it('D7: 50km 超の最近傍ヒットなし → null', () => {
    // 全国一件 (東京) のみ・座標は北海道 → 50km 超 → null
    const RH = loadRegionHelper({
      items: [{ lat: 3568000, lng: 13969000, c: '13xxxx' }],
    });
    expect(RH.getCurrentPref(43.0, 141.0)).toBeNull();
  });

  it('D8: 不正 JIS code (= 99) → null', () => {
    const RH = loadRegionHelper({
      items: [{ lat: 3568000, lng: 13969000, c: '99xxxx' }],
    });
    expect(RH.getCurrentPref(35.68, 139.69)).toBeNull();
  });

  it('D9: c フィールドが文字列でない → null', () => {
    const RH = loadRegionHelper({
      items: [{ lat: 3568000, lng: 13969000, c: 13 }],
    });
    expect(RH.getCurrentPref(35.68, 139.69)).toBeNull();
  });

  it('D10: accuracy>50 で getCurrentPref → null (= GPS 精度低時のガード)', () => {
    const RH = loadRegionHelper({
      items: [{ lat: 3568000, lng: 13969000, c: '13xxxx' }],
    });
    expect(RH.getCurrentPref(35.68, 139.69, 51)).toBeNull();
    expect(RH.getCurrentPref(35.68, 139.69, 50)).toBe('tokyo'); // 50 ちょうどは OK
  });

  it('D11: lat/lng NaN → null', () => {
    const RH = loadRegionHelper({
      items: [{ lat: 3568000, lng: 13969000, c: '13xxxx' }],
    });
    expect(RH.getCurrentPref(NaN, 139.69)).toBeNull();
    expect(RH.getCurrentPref(35.68, NaN)).toBeNull();
  });
});
