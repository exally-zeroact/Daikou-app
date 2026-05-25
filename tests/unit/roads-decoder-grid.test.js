// tests/unit/roads-decoder-grid.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P1-⑨ / 全32件)
//
// 検証対象: roads-decoder.js RoadDecoder.prototype.getRoadsNear (L236)
//   precision (= 1e5 default) で lat/lng を整数化
//   gridSize (= 1000 default) で gy/gx 計算
//   key = gy + '_' + gx
//   radiusGrids=1 で ±1 grid 9 セル探索
//   seen map で重複防止
//
// 検証手法:
//   ① 静的 verify: 実 roads-decoder.js の関数定義 + 定数
//   ② 動的 verify: isolated ロジック抽出で grid offset precision / radius boundary 検証
//
// 絶対ルール準拠:
//   js/roads-decoder.js は触らない absolute・本 test は isolated 実装で property test。

const fs = require('fs');
const path = require('path');
const { fc, propertyAssert } = require('../../scripts/zeroact-test-commons/property-test-helpers');

const RD_PATH = path.join(__dirname, '..', '..', 'js', 'roads-decoder.js');

function loadSource() {
  return fs.readFileSync(RD_PATH, 'utf8');
}

// roads-decoder.js L236 getRoadsNear の grid 計算 isolated 実装
function gridKey(lat, lng, precision, gridSize) {
  const latInt = Math.round(lat * precision);
  const lngInt = Math.round(lng * precision);
  const gy = Math.floor(latInt / gridSize);
  const gx = Math.floor(lngInt / gridSize);
  return { gy, gx, key: gy + '_' + gx };
}

function isolatedGetRoadsNear(grid, lat, lng, radiusGrids, precision, gridSize) {
  if (radiusGrids == null) radiusGrids = 1;
  const { gy, gx } = gridKey(lat, lng, precision, gridSize);
  const result = [];
  const seen = {};
  for (let dy = -radiusGrids; dy <= radiusGrids; dy++) {
    for (let dx = -radiusGrids; dx <= radiusGrids; dx++) {
      const key = gy + dy + '_' + (gx + dx);
      const ids = grid[key];
      if (!ids) continue;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (seen[id]) continue;
        seen[id] = 1;
        result.push(id);
      }
    }
  }
  return result;
}

describe('roads-decoder.js getRoadsNear grid 計算 (P1-⑨)', () => {
  // ─── ① 静的 verify ──

  it('S1: roads-decoder.js に RoadDecoder.prototype.getRoadsNear 定義が存在', () => {
    const source = loadSource();
    if (!/RoadDecoder\.prototype\.getRoadsNear\s*=\s*function/.test(source)) {
      throw new Error('getRoadsNear 定義未検出 (drift)');
    }
  });

  it('S2: RoadDecoder constructor で gridSize default 1000 / precision default 1e5', () => {
    const source = loadSource();
    if (!/gridSize\s*=\s*roadsData\.gridSize\s*\|\|\s*1000/.test(source)) {
      throw new Error('gridSize default 1000 未検出');
    }
    if (!/precision\s*=\s*roadsData\.precision\s*\|\|\s*1e5/.test(source)) {
      throw new Error('precision default 1e5 未検出');
    }
  });

  it('S3: getRoadsNear で radiusGrids default 1 / 重複防止 seen / ±radiusGrids 9 セル探索', () => {
    const source = loadSource();
    if (!/radiusGrids\s*==\s*null/.test(source)) {
      throw new Error('radiusGrids null check 未検出');
    }
    if (!/const\s+seen\s*=\s*\{\}/.test(source)) {
      throw new Error('seen map 重複防止未検出');
    }
    if (!/for\s*\(\s*let\s+dy\s*=\s*-radiusGrids/.test(source)) {
      throw new Error('dy radius ループ未検出');
    }
  });

  // ─── ② 動的 verify ──

  it('D1: 空 grid → 空 result 配列', () => {
    const result = isolatedGetRoadsNear({}, 33.84, 132.7656, 1, 1e5, 1000);
    expect(result).toEqual([]);
  });

  it('D2: gridKey 計算: lat=33.84/lng=132.7656/precision=1e5/gridSize=1000', () => {
    const k = gridKey(33.84, 132.7656, 1e5, 1000);
    // 33.84 × 1e5 = 3384000 → /1000 = 3384
    // 132.7656 × 1e5 = 13276560 → /1000 = 13276 (floor)
    expect(k.gy).toBe(3384);
    expect(k.gx).toBe(13276);
    expect(k.key).toBe('3384_13276');
  });

  it('D3: 中心 grid のみに 1 件 → radiusGrids=1 で 1 件 result', () => {
    const grid = { '3384_13276': [42] };
    const result = isolatedGetRoadsNear(grid, 33.84, 132.7656, 1, 1e5, 1000);
    expect(result).toEqual([42]);
  });

  it('D4: 中心 + 隣接 8 grid に id → 9 grid 全件 result (= 重複なし)', () => {
    const grid = {};
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        grid[3384 + dy + '_' + (13276 + dx)] = [(dy + 1) * 3 + (dx + 1)];
      }
    }
    const result = isolatedGetRoadsNear(grid, 33.84, 132.7656, 1, 1e5, 1000);
    expect(result.length).toBe(9);
  });

  it('D5: 同 id 複数 grid に登場 → seen で重複防止 (= 1 件のみ)', () => {
    const grid = {
      '3384_13276': [99],
      '3384_13277': [99],
      '3385_13276': [99],
    };
    const result = isolatedGetRoadsNear(grid, 33.84, 132.7656, 1, 1e5, 1000);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(99);
  });

  it('D6: radiusGrids=0 → 中心 grid のみ (= 1 セル)', () => {
    const grid = {
      '3384_13276': [1],
      '3385_13276': [2],
    };
    const result = isolatedGetRoadsNear(grid, 33.84, 132.7656, 0, 1e5, 1000);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(1);
  });

  it('D7: radiusGrids=2 → 5×5=25 セル探索', () => {
    const grid = {};
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        grid[3384 + dy + '_' + (13276 + dx)] = [(dy + 2) * 5 + (dx + 2)];
      }
    }
    const result = isolatedGetRoadsNear(grid, 33.84, 132.7656, 2, 1e5, 1000);
    expect(result.length).toBe(25);
  });

  it('D8: lat/lng 境界値: 0.00501 / 0.005 で grid 切替 (gridSize=1000, precision=1e5)', () => {
    // 0.005 × 1e5 = 500 → /1000 = 0 (floor)
    // 0.00501 × 1e5 = 501 → /1000 = 0 (floor) ← まだ 0
    // 0.01 × 1e5 = 1000 → /1000 = 1 ← grid 切替
    expect(gridKey(0.005, 0, 1e5, 1000).gy).toBe(0);
    expect(gridKey(0.00501, 0, 1e5, 1000).gy).toBe(0);
    expect(gridKey(0.01, 0, 1e5, 1000).gy).toBe(1);
  });

  it('D9: 負値 lat (= 南半球) でも grid 計算が動作', () => {
    const k = gridKey(-33.84, 132.7656, 1e5, 1000);
    // -33.84 × 1e5 = -3384000 → /1000 = -3384
    expect(k.gy).toBe(-3384);
    expect(k.gx).toBe(13276);
  });

  it('D10: fast-check 任意 lat/lng (日本国内) で gridKey が決定的', () => {
    propertyAssert(
      fc.property(
        fc.double({ min: 24, max: 46, noNaN: true }),
        fc.double({ min: 122, max: 146, noNaN: true }),
        (lat, lng) => {
          const k1 = gridKey(lat, lng, 1e5, 1000);
          const k2 = gridKey(lat, lng, 1e5, 1000);
          // 同入力で同 key を必ず返す (= 決定的)
          if (k1.key !== k2.key) {
            throw new Error('gridKey 非決定的: ' + k1.key + ' vs ' + k2.key);
          }
          // gy/gx は整数
          if (!Number.isInteger(k1.gy) || !Number.isInteger(k1.gx)) {
            throw new Error('gy/gx 非整数: ' + JSON.stringify(k1));
          }
        }
      )
    );
  });

  it('D11: fast-check 隣接 grid (= ±gridSize/precision の小差) で同 grid または隣接', () => {
    propertyAssert(
      fc.property(
        fc.double({ min: 33.85, max: 33.95, noNaN: true }),
        fc.double({ min: 132.8, max: 132.9, noNaN: true }),
        (lat, lng) => {
          const k1 = gridKey(lat, lng, 1e5, 1000);
          // 0.001 度差 (= 約 100m) で同 grid または隣接 grid
          const k2 = gridKey(lat + 0.001, lng, 1e5, 1000);
          const dy = Math.abs(k1.gy - k2.gy);
          if (dy > 1) {
            throw new Error(
              '0.001 度 (= 100 unit precision) 差で grid が ' +
                dy +
                ' 以上ジャンプ: ' +
                k1.key +
                ' → ' +
                k2.key
            );
          }
        }
      )
    );
  });

  it('D12: precision/gridSize の組合せ整合性 (precision=1e7, gridSize=10000)', () => {
    // より細かい precision でも同じロジックが動作
    const k = gridKey(33.84, 132.7656, 1e7, 10000);
    // 33.84 × 1e7 = 338400000 → /10000 = 33840
    expect(k.gy).toBe(33840);
    expect(k.gx).toBe(132765); // 132.7656 × 1e7 = 1327656000 / 10000 = 132765 (floor)
  });
});
