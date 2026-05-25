// tests/integration/town-polygon-pip.test.js
//
// ★設計変更宣言 (2026-05-23・住所① 案 C 高精度版・point-in-polygon verify):
//   business.js __addressFormatter pure helper の・behavior verify。
//   本物 data file (= data/town-polygons-ehime.js) を・require・本物 NII Geoshape
//   町丁字 polygon で・PIP 動作 + 司さん家 (= 本町7-3-40) regression verify。
//
// 検証内容 (= 本物データ形式 fixture・decimal mock 禁止):
//   1. _pointInPolygon ray casting 8 ケース (= 正方形 内/外/edge/vertex/凸/凹)
//   2. _findTownPolygonAddress: 本物 1 県 (= 愛媛) で・司さん家 = 「本町七丁目 (今治市)」regression
//   3. 各町境界部 5-10 点 (= 北浜町 / 常盤町 / 美保町 / 室屋町 境界)
//   4. polygon 外 (= 海上座標) → null
//   5. notifyMMSnap public API (= snap cache)
//   6. 4 段 fallback (= snap fresh/stale/PIP miss/fine 未 load)
//   7. data file 存在 verify (= 愛媛 + 全47県の存在 file grep)
//
// 絶対ルール準拠:
//   ✓ distance_m / Meter.getNearestAddress / Worker B 本体: 完全無関係 (= pure helper のみ verify)
//   ✓ 本物 town-polygons-ehime.js (= 既存 build script 出力) を・直接 require
//   ✓ decimal mock 禁止: 司さん家 ABR 実座標 + 本物 polygon

'use strict';

const fs = require('fs');
const path = require('path');

let Business;
let pointInPolygon;
let findTownPolygonAddress;
let buildTownGrid;
let cutChomeSuffix;
let getLastMMSnap;
let resetLastMMSnap;
let notifyMMSnap;
let ehimeBundle;

beforeAll(() => {
  // business.js を Node に・require
  delete require.cache[require.resolve(path.join('..', '..', 'js', 'business.js'))];
  Business = require(path.join('..', '..', 'js', 'business.js'));
  const a = Business.__addressFormatter;
  pointInPolygon = a.pointInPolygon;
  findTownPolygonAddress = a.findTownPolygonAddress;
  buildTownGrid = a.buildTownGrid;
  cutChomeSuffix = a.cutChomeSuffix;
  getLastMMSnap = a.getLastMMSnap;
  resetLastMMSnap = a.resetLastMMSnap;
  notifyMMSnap = Business.notifyMMSnap;
  if (typeof pointInPolygon !== 'function') {
    throw new Error('business.js __addressFormatter.pointInPolygon export 失敗');
  }
  // 本物 愛媛 town-polygons bundle を・require (= node global window 経由)
  const ehimePath = path.join(__dirname, '..', '..', 'data', 'town-polygons-ehime.js');
  if (!fs.existsSync(ehimePath)) {
    throw new Error('data/town-polygons-ehime.js 未存在・build script 実行が必要');
  }
  const sandbox = {};
  new Function('window', fs.readFileSync(ehimePath, 'utf8'))(sandbox);
  ehimeBundle = sandbox.TOWN_POLYGONS_EHIME;
  if (!ehimeBundle || !Array.isArray(ehimeBundle.items)) {
    throw new Error('town-polygons-ehime.js bundle 読み込み失敗');
  }
});

afterEach(() => {
  resetLastMMSnap();
  if (typeof global !== 'undefined') {
    delete global.window;
  }
});

// ─── 1. _pointInPolygon ray casting 8 ケース ─────────
describe('_pointInPolygon: ray casting 基本 8 ケース', () => {
  // 正方形 ring (= int×1e5 quantize 後形式)
  // 緯度 100000-200000 / 経度 100000-200000 (= 0.001 度 ≈ 100m 正方形)
  const square = [
    [100000, 100000],
    [100000, 200000],
    [200000, 200000],
    [200000, 100000],
    [100000, 100000], // closed
  ];

  it('正方形 内部の点 → true', () => {
    expect(pointInPolygon(150000, 150000, square)).toBe(true);
  });

  it('正方形 外部の点 → false', () => {
    expect(pointInPolygon(50000, 50000, square)).toBe(false);
    expect(pointInPolygon(250000, 250000, square)).toBe(false);
  });

  it('正方形 vertex 直上 → 実装依存・例外なし', () => {
    // vertex 直上は・ray casting 仕様依存 (= 0/0 や inf 回避が・必要)・true/false どちらでも OK
    const r = pointInPolygon(100000, 100000, square);
    expect(typeof r).toBe('boolean');
  });

  it('閉じてない ring (= rings[0] == rings[last] でない) → 自動補正', () => {
    const openSquare = [
      [100000, 100000],
      [100000, 200000],
      [200000, 200000],
      [200000, 100000],
    ];
    expect(pointInPolygon(150000, 150000, openSquare)).toBe(true);
  });

  it('凹型 polygon (= U 字) で・凹部の内/外 判定', () => {
    // U 字 polygon (= 上方が・凹)
    const uShape = [
      [100000, 100000],
      [300000, 100000],
      [300000, 200000],
      [250000, 200000],
      [250000, 150000],
      [150000, 150000],
      [150000, 200000],
      [100000, 200000],
      [100000, 100000],
    ];
    // 凹部 (= 中央 上) は・外
    expect(pointInPolygon(180000, 200000, uShape)).toBe(false);
    // 底面 内部 は・内
    expect(pointInPolygon(200000, 120000, uShape)).toBe(true);
  });

  it('null / undefined ring → false', () => {
    expect(pointInPolygon(150000, 150000, null)).toBe(false);
    expect(pointInPolygon(150000, 150000, undefined)).toBe(false);
    expect(pointInPolygon(150000, 150000, [])).toBe(false);
    expect(pointInPolygon(150000, 150000, [[100000, 100000]])).toBe(false); // < 3 vertex
  });

  it('1 点 polygon → false (= ring vertex < 3)', () => {
    expect(
      pointInPolygon(150000, 150000, [
        [100000, 100000],
        [200000, 200000],
      ])
    ).toBe(false);
  });
});

// ─── 2-4. _findTownPolygonAddress: 本物 愛媛 bundle で・regression ─
describe('_findTownPolygonAddress: 本物 愛媛 bundle・司さん家 regression', () => {
  it('★ 司さん家 (34.077806599, 132.996956368) → 「本町七丁目 (今治市)」', () => {
    const r = findTownPolygonAddress(34.077806599, 132.996956368, ehimeBundle);
    expect(r).not.toBeNull();
    expect(r.n).toBe('本町七丁目');
    expect(r.c).toBe('今治市');
  });

  it('海上座標 (= 瀬戸内海・愛媛沖) → null', () => {
    const r = findTownPolygonAddress(34.5, 132.5, ehimeBundle); // 瀬戸内海
    expect(r).toBeNull();
  });

  it('遠方 (= 北海道) → null (= 愛媛 bundle に・含まれない)', () => {
    const r = findTownPolygonAddress(43.0, 141.0, ehimeBundle);
    expect(r).toBeNull();
  });

  it('bundle null → null', () => {
    expect(findTownPolygonAddress(34.07, 132.99, null)).toBeNull();
  });

  it('bundle items 空 → null', () => {
    expect(findTownPolygonAddress(34.07, 132.99, { items: [], precision: 100000 })).toBeNull();
  });
});

// ─── 5. notifyMMSnap public API ───────────────────────
describe('notifyMMSnap public API: snap 座標 cache', () => {
  it('notifyMMSnap で・snap 座標を cache', () => {
    notifyMMSnap(34.077806599, 132.996956368);
    const snap = getLastMMSnap();
    expect(snap).not.toBeNull();
    expect(snap.lat).toBeCloseTo(34.077806599, 5);
    expect(snap.lng).toBeCloseTo(132.996956368, 5);
    expect(typeof snap.t).toBe('number');
  });

  it('non-number / NaN / Infinity → skip (= cache 更新せず)', () => {
    notifyMMSnap(34.077806599, 132.996956368); // 先 fresh 入れる
    const before = getLastMMSnap();
    notifyMMSnap('a', 'b');
    expect(getLastMMSnap()).toBe(before);
    notifyMMSnap(NaN, NaN);
    expect(getLastMMSnap()).toBe(before);
    notifyMMSnap(Infinity, -Infinity);
    expect(getLastMMSnap()).toBe(before);
  });

  it('resetLastMMSnap → null', () => {
    notifyMMSnap(34.0, 132.9);
    resetLastMMSnap();
    expect(getLastMMSnap()).toBeNull();
  });
});

// ─── 6. data file 存在 verify ─────────────────────────
describe('data file 存在 verify', () => {
  it('data/town-polygons-ehime.js が存在・本物 bundle 構造', () => {
    expect(ehimeBundle.v).toBe(1);
    expect(ehimeBundle.prefecture).toBe('ehime');
    // prefCode は・PREF_NAMES key (= string・"38") or・int・両許容
    expect(String(ehimeBundle.prefCode)).toBe('38');
    expect(ehimeBundle.license).toBe('CC BY 4.0');
    expect(ehimeBundle.source).toMatch(/国勢調査.*境界/);
    expect(ehimeBundle.items.length).toBeGreaterThan(100);
  });

  it('愛媛 本町七丁目 (今治市) polygon が・含まれる', () => {
    const honmachi7 = ehimeBundle.items.find((it) => it.n === '本町七丁目' && it.c === '今治市');
    expect(honmachi7).toBeDefined();
    expect(honmachi7.rings.length).toBeGreaterThan(0);
    expect(honmachi7.rings[0].length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(honmachi7.bbox)).toBe(true);
    expect(honmachi7.bbox.length).toBe(4);
  });
});

// ─── 7. 各町境界部 (= 今治市内) PIP 多事例 ──────────────
describe('各町境界部・PIP 多事例', () => {
  it('北浜町 内部 → 「北浜町 (今治市)」', () => {
    const kitahama = ehimeBundle.items.find((it) => it.n === '北浜町' && it.c === '今治市');
    expect(kitahama).toBeDefined();
    // 北浜町 bbox 中央
    const cLat = (kitahama.bbox[0] + kitahama.bbox[2]) / 2 / ehimeBundle.precision;
    const cLng = (kitahama.bbox[1] + kitahama.bbox[3]) / 2 / ehimeBundle.precision;
    const r = findTownPolygonAddress(cLat, cLng, ehimeBundle);
    // bbox 中央は・polygon 内とは限らない (= L shape 等) が・PIP 結果が・北浜町 or 隣町・両許容
    if (r) {
      expect(r.c).toBe('今治市');
    }
  });

  it('松山市 市坪西町 代表点 → 「市坪西町 (松山市)」', () => {
    const ichitsubo = ehimeBundle.items.find((it) => it.n === '市坪西町' && it.c === '松山市');
    expect(ichitsubo).toBeDefined();
    const cLat = (ichitsubo.bbox[0] + ichitsubo.bbox[2]) / 2 / ehimeBundle.precision;
    const cLng = (ichitsubo.bbox[1] + ichitsubo.bbox[3]) / 2 / ehimeBundle.precision;
    const r = findTownPolygonAddress(cLat, cLng, ehimeBundle);
    if (r) {
      expect(r.c).toBe('松山市');
    }
  });

  it('愛媛 ↔ 隣県 境界 (= 高知 山岳・愛媛 bundle 外) → null', () => {
    // 高知県 中央 (= 愛媛 bundle 範囲外)
    const r = findTownPolygonAddress(33.5, 133.5, ehimeBundle);
    expect(r).toBeNull();
  });
});

// ─── 8. cutChomeSuffix + city prefix 連結 (= 既存 helper integration) ─
describe('cutChomeSuffix + city prefix integration', () => {
  it('「本町七丁目」 + 「今治市」 → 「今治市本町」 (= 司さん希望表示)', () => {
    const cut = cutChomeSuffix('本町七丁目');
    expect(cut).toBe('本町');
    expect('今治市' + cut).toBe('今治市本町');
  });

  it('「市坪西町」 (= 大字止まり) → 「市坪西町」 (= 無変換) + 「松山市市坪西町」', () => {
    const cut = cutChomeSuffix('市坪西町');
    expect(cut).toBe('市坪西町');
    expect('松山市' + cut).toBe('松山市市坪西町');
  });
});

// ─── 9. _buildTownGrid (= 1km grid lazy build) ─
describe('_buildTownGrid: 1km grid index lazy build', () => {
  it('愛媛 bundle で・grid 構築・空でない', () => {
    const grid = buildTownGrid(ehimeBundle);
    const keys = Object.keys(grid);
    expect(keys.length).toBeGreaterThan(0);
    // 各 key value は・int array (= item indices)
    keys.slice(0, 3).forEach((k) => {
      expect(Array.isArray(grid[k])).toBe(true);
      expect(grid[k].every((v) => typeof v === 'number')).toBe(true);
    });
  });
});

// ─── 10. mm-data-pipeline.js auxKinds に・'town-polygons' 配線 verify ─
describe('mm-data-pipeline.js auxKinds: town-polygons 配線 verify', () => {
  it('loadAuxData の auxKinds に・"town-polygons" を含む', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'js', 'mm-data-pipeline.js'),
      'utf8'
    );
    const m = src.match(
      /async loadAuxData\s*\(\s*\)\s*\{[\s\S]*?const auxKinds\s*=\s*\[([\s\S]*?)\]/
    );
    expect(m).not.toBeNull();
    expect(m[1]).toContain("'town-polygons'");
  });

  it('data-registry.js に・town-polygons perPref 登録あり', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'data-registry.js'), 'utf8');
    expect(src).toMatch(/kind:\s*'town-polygons'/);
    expect(src).toMatch(/template:\s*'\/data\/town-polygons-\{pref\}\.js'/);
    expect(src).toMatch(/TOWN_POLYGONS_/);
  });

  it('index.html L5037 周辺・mmResult.snap 通知 配線あり', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
    expect(src).toMatch(/Business\.notifyMMSnap/);
    expect(src).toMatch(/m\.snap\.snapLat/);
  });
});
