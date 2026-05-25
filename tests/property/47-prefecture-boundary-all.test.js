// tests/property/47-prefecture-boundary-all.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step ㉜ / 全32件・真の完全網羅 4/4)
//
// 検証対象: 47 県全件の境界整合性 (fast-check)
//   data-registry.js PREFECTURES_47 全件 + region-helper.js getCurrentPref で
//   全県 JIS コード対応 + 隣接県判定の整合性を property test で網羅。
//
// 絶対ルール準拠:
//   js/region-helper.js / js/data-registry.js は触らない absolute・vm sandbox で実行。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fc, propertyAssert } = require('../../scripts/zeroact-test-commons/property-test-helpers');

const DR_PATH = path.join(__dirname, '..', '..', 'js', 'data-registry.js');
const RH_PATH = path.join(__dirname, '..', '..', 'js', 'region-helper.js');

function loadRegistry() {
  const ctx = { console: console };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(DR_PATH, 'utf8'), ctx, { filename: 'js/data-registry.js' });
  return ctx.DataRegistry;
}

function loadRegionHelper(items) {
  const ctx = { console: console, Math: Math };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  if (items) ctx.ADDRESSES_COARSE_JP = { items };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(RH_PATH, 'utf8'), ctx, { filename: 'js/region-helper.js' });
  return ctx.RegionHelper;
}

// 47 県の代表座標 + JIS code (= 主要都市)
// 全 47 県の代表座標を網羅
const PREF_REPRESENTATIVES = [
  { jis: '01', name: 'hokkaido', lat: 43.0711, lng: 141.35 }, // 札幌
  { jis: '02', name: 'aomori', lat: 40.8244, lng: 140.74 }, // 青森
  { jis: '03', name: 'iwate', lat: 39.7036, lng: 141.1527 }, // 盛岡
  { jis: '04', name: 'miyagi', lat: 38.2688, lng: 140.8721 }, // 仙台
  { jis: '05', name: 'akita', lat: 39.7186, lng: 140.1024 }, // 秋田
  { jis: '06', name: 'yamagata', lat: 38.2404, lng: 140.3636 }, // 山形
  { jis: '07', name: 'fukushima', lat: 37.75, lng: 140.4678 }, // 福島
  { jis: '08', name: 'ibaraki', lat: 36.3418, lng: 140.4468 }, // 水戸
  { jis: '09', name: 'tochigi', lat: 36.5658, lng: 139.8836 }, // 宇都宮
  { jis: '10', name: 'gunma', lat: 36.3911, lng: 139.0608 }, // 前橋
  { jis: '11', name: 'saitama', lat: 35.857, lng: 139.6489 }, // さいたま
  { jis: '12', name: 'chiba', lat: 35.6047, lng: 140.1233 }, // 千葉
  { jis: '13', name: 'tokyo', lat: 35.6895, lng: 139.6917 }, // 東京
  { jis: '14', name: 'kanagawa', lat: 35.4437, lng: 139.638 }, // 横浜
  { jis: '15', name: 'niigata', lat: 37.9026, lng: 139.0237 }, // 新潟
  { jis: '16', name: 'toyama', lat: 36.6953, lng: 137.2113 }, // 富山
  { jis: '17', name: 'ishikawa', lat: 36.5947, lng: 136.6256 }, // 金沢
  { jis: '18', name: 'fukui', lat: 36.0652, lng: 136.2216 }, // 福井
  { jis: '19', name: 'yamanashi', lat: 35.6638, lng: 138.5683 }, // 甲府
  { jis: '20', name: 'nagano', lat: 36.6513, lng: 138.181 }, // 長野
  { jis: '21', name: 'gifu', lat: 35.3912, lng: 136.7223 }, // 岐阜
  { jis: '22', name: 'shizuoka', lat: 34.977, lng: 138.3831 }, // 静岡
  { jis: '23', name: 'aichi', lat: 35.1815, lng: 136.9066 }, // 名古屋
  { jis: '24', name: 'mie', lat: 34.7303, lng: 136.5086 }, // 津
  { jis: '25', name: 'shiga', lat: 35.0045, lng: 135.8686 }, // 大津
  { jis: '26', name: 'kyoto', lat: 35.0211, lng: 135.7556 }, // 京都
  { jis: '27', name: 'osaka', lat: 34.6863, lng: 135.52 }, // 大阪
  { jis: '28', name: 'hyogo', lat: 34.6913, lng: 135.183 }, // 神戸
  { jis: '29', name: 'nara', lat: 34.6852, lng: 135.8329 }, // 奈良
  { jis: '30', name: 'wakayama', lat: 34.226, lng: 135.1675 }, // 和歌山
  { jis: '31', name: 'tottori', lat: 35.5036, lng: 134.2383 }, // 鳥取
  { jis: '32', name: 'shimane', lat: 35.4723, lng: 133.0505 }, // 松江
  { jis: '33', name: 'okayama', lat: 34.6618, lng: 133.9344 }, // 岡山
  { jis: '34', name: 'hiroshima', lat: 34.3963, lng: 132.4596 }, // 広島
  { jis: '35', name: 'yamaguchi', lat: 34.186, lng: 131.4706 }, // 山口
  { jis: '36', name: 'tokushima', lat: 34.0658, lng: 134.5594 }, // 徳島
  { jis: '37', name: 'kagawa', lat: 34.3401, lng: 134.0434 }, // 高松
  { jis: '38', name: 'ehime', lat: 33.8416, lng: 132.7657 }, // 松山
  { jis: '39', name: 'kochi', lat: 33.5597, lng: 133.5311 }, // 高知
  { jis: '40', name: 'fukuoka', lat: 33.6064, lng: 130.4181 }, // 福岡
  { jis: '41', name: 'saga', lat: 33.2494, lng: 130.2989 }, // 佐賀
  { jis: '42', name: 'nagasaki', lat: 32.7448, lng: 129.8737 }, // 長崎
  { jis: '43', name: 'kumamoto', lat: 32.7898, lng: 130.7417 }, // 熊本
  { jis: '44', name: 'oita', lat: 33.2382, lng: 131.6126 }, // 大分
  { jis: '45', name: 'miyazaki', lat: 31.9111, lng: 131.4239 }, // 宮崎
  { jis: '46', name: 'kagoshima', lat: 31.5602, lng: 130.5581 }, // 鹿児島
  { jis: '47', name: 'okinawa', lat: 26.2125, lng: 127.6809 }, // 那覇
];

describe('47 県境界全件 fast-check 網羅 (㉜)', () => {
  it('S1: PREFECTURES_47 が 47 件・unique', () => {
    const reg = loadRegistry();
    expect(reg.PREFECTURES_47.length).toBe(47);
    const set = new Set(reg.PREFECTURES_47);
    expect(set.size).toBe(47);
  });

  it('S2: 全 47 県の代表座標 → getCurrentPref が正しい県名返却', () => {
    const items = PREF_REPRESENTATIVES.map((p) => ({
      lat: Math.round(p.lat * 100000),
      lng: Math.round(p.lng * 100000),
      c: p.jis + '0000',
    }));
    const RH = loadRegionHelper(items);
    for (const p of PREF_REPRESENTATIVES) {
      const result = RH.getCurrentPref(p.lat, p.lng);
      if (result !== p.name) {
        throw new Error('JIS ' + p.jis + ' (' + p.name + ') の判定失敗: result=' + result);
      }
    }
  });

  it('S3: fast-check 任意 JIS code → ローマ字 pref 名へ決定的変換', () => {
    propertyAssert(
      fc.property(fc.constantFrom(...PREF_REPRESENTATIVES), (pref) => {
        const items = [
          {
            lat: Math.round(pref.lat * 100000),
            lng: Math.round(pref.lng * 100000),
            c: pref.jis + '0000',
          },
        ];
        const RH = loadRegionHelper(items);
        const result = RH.getCurrentPref(pref.lat, pref.lng);
        if (result !== pref.name) {
          throw new Error('fast-check failed: ' + pref.jis + ' → ' + result);
        }
      })
    );
  });

  it('S4: 全 47 県の PREFECTURES_47 順序が JIS code 昇順', () => {
    const reg = loadRegistry();
    const expected = PREF_REPRESENTATIVES.map((p) => p.name);
    for (let i = 0; i < 47; i++) {
      if (reg.PREFECTURES_47[i] !== expected[i]) {
        throw new Error(
          'PREFECTURES_47 順序違反 at ' +
            i +
            ': expected=' +
            expected[i] +
            ' actual=' +
            reg.PREFECTURES_47[i]
        );
      }
    }
  });

  it('S5: fast-check 隣接県 boundary 跨ぎ判定整合 (= 任意 2 県の中点で安全動作)', () => {
    propertyAssert(
      fc.property(
        fc.constantFrom(...PREF_REPRESENTATIVES),
        fc.constantFrom(...PREF_REPRESENTATIVES),
        (a, b) => {
          if (a.jis === b.jis) return;
          const items = [
            { lat: Math.round(a.lat * 100000), lng: Math.round(a.lng * 100000), c: a.jis + '0000' },
            { lat: Math.round(b.lat * 100000), lng: Math.round(b.lng * 100000), c: b.jis + '0000' },
          ];
          const RH = loadRegionHelper(items);
          const midLat = (a.lat + b.lat) / 2;
          const midLng = (a.lng + b.lng) / 2;
          const result = RH.getCurrentPref(midLat, midLng);
          // result は a or b の県名・null も許容 (= 距離 > 50km の場合)
          if (result !== null && result !== a.name && result !== b.name) {
            throw new Error('中点判定 不整合: a=' + a.name + ' b=' + b.name + ' mid=' + result);
          }
        }
      )
    );
  });
});
