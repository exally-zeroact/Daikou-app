// tests/integration/cross-prefecture-snap.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step ㉒ / 全32件)
//
// 検証対象: 県境跨ぎ snap / 複県同時 load / データ load 中 GPS arrival race
//   region-helper.js getCurrentPref が県境座標で隣接県を切替判定する動作を検証。
//
// 絶対ルール準拠:
//   js/region-helper.js は触らない absolute・vm sandbox で ADDRESSES_COARSE_JP mock。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RH_PATH = path.join(__dirname, '..', '..', 'js', 'region-helper.js');

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

describe('県境跨ぎ snap / 複県同時 load race (㉒)', () => {
  it('C1: Tokyo (JIS 13) 領域 + Kanagawa (JIS 14) entry を含む items で東京座標 → tokyo', () => {
    // 東京 (35.6895, 139.6917) - 横浜 (35.4437, 139.6380)
    const items = [
      { lat: 3568950, lng: 13969170, c: '13xxxx' }, // 東京駅
      { lat: 3544370, lng: 13963800, c: '14xxxx' }, // 横浜駅
    ];
    const RH = loadRegionHelper(items);
    expect(RH.getCurrentPref(35.6895, 139.6917)).toBe('tokyo');
    expect(RH.getCurrentPref(35.4437, 139.638)).toBe('kanagawa');
  });

  it('C2: 県境座標 (= 多摩川沿い 35.55, 139.6) で最近傍 = 横浜 (Kanagawa)', () => {
    const items = [
      { lat: 3568950, lng: 13969170, c: '13xxxx' }, // 東京駅 (= 北方向)
      { lat: 3544370, lng: 13963800, c: '14xxxx' }, // 横浜駅 (= 南方向)
    ];
    const RH = loadRegionHelper(items);
    // 35.55 は東京駅 (35.69) と横浜駅 (35.44) のうち横浜駅に近い
    expect(RH.getCurrentPref(35.55, 139.65)).toBe('kanagawa');
  });

  it('C3: 47 県全件 simulate (= 隣接データ整合性)', () => {
    // 簡易: 47 県中 5 県のみシミュレート (= データ整合性のみ)
    const items = [
      { lat: 4307110, lng: 14135000, c: '01xxxx' }, // 札幌 (Hokkaido)
      { lat: 3568950, lng: 13969170, c: '13xxxx' }, // 東京 (Tokyo)
      { lat: 3469340, lng: 13550220, c: '27xxxx' }, // 大阪 (Osaka)
      { lat: 3384000, lng: 13276560, c: '38xxxx' }, // 松山 (Ehime)
      { lat: 2621050, lng: 12768950, c: '47xxxx' }, // 那覇 (Okinawa)
    ];
    const RH = loadRegionHelper(items);
    expect(RH.getCurrentPref(43.0711, 141.35)).toBe('hokkaido');
    expect(RH.getCurrentPref(35.6895, 139.6917)).toBe('tokyo');
    expect(RH.getCurrentPref(34.6934, 135.5022)).toBe('osaka');
    expect(RH.getCurrentPref(33.84, 132.7656)).toBe('ehime');
    expect(RH.getCurrentPref(26.2105, 127.6895)).toBe('okinawa');
  });

  it('C4: データ load 中 (= isReady=false) でも getCurrentPref は null 返却 (= 例外なし)', () => {
    const RH = loadRegionHelper(null);
    expect(() => RH.getCurrentPref(35.6895, 139.6917)).not.toThrow();
    expect(RH.getCurrentPref(35.6895, 139.6917)).toBeNull();
  });

  it('C5: load 完了後 (= items 追加) で getCurrentPref が動作開始 (= race 安全)', () => {
    // 初回 null・後で items 追加 (= ctx ベースの再 load 検証)
    const RH1 = loadRegionHelper(null);
    expect(RH1.isReady()).toBe(false);

    const RH2 = loadRegionHelper([{ lat: 3568950, lng: 13969170, c: '13xxxx' }]);
    expect(RH2.isReady()).toBe(true);
    expect(RH2.getCurrentPref(35.6895, 139.6917)).toBe('tokyo');
  });

  it('C6: 隣接県の overlap (= 同一 GPS 座標で複県 candidate) → 最近傍 1 件', () => {
    // 完全同一座標で 2 県候補 → 配列順で先頭が最近傍判定で勝つ
    const items = [
      { lat: 3568950, lng: 13969170, c: '13xxxx' }, // Tokyo
      { lat: 3568950, lng: 13969170, c: '14xxxx' }, // Kanagawa (同座標)
    ];
    const RH = loadRegionHelper(items);
    const result = RH.getCurrentPref(35.6895, 139.6917);
    // 同座標で距離 0・どちらか 1 つ・両者とも valid 県
    expect(['tokyo', 'kanagawa']).toContain(result);
  });

  it('C7: 50km 圏外 GPS → 全件 null (= boundary 外で誤判定なし)', () => {
    const items = [
      { lat: 3568950, lng: 13969170, c: '13xxxx' }, // 東京
    ];
    const RH = loadRegionHelper(items);
    // 北海道座標 → 東京と 800km 以上離れている → null
    expect(RH.getCurrentPref(43.0711, 141.35)).toBeNull();
  });
});
