// tests/integration/live-address-display.test.js
//
// ★設計変更宣言 (2026-05-23・住所② 現在地ライブ常時表示・作り直し版):
//   Business.getCurrentLiveAddress public API の・3 段 fallback behavior verify。
//     ① snap fresh (= _MM_SNAP_FRESH_MS 5 秒以内) → snap 位置で住所
//     ② snap stale + _lastMMSnap あり → 直近 snap 位置で住所 (= 町名不変)
//     ③ raw GPS fresh (= _RAW_GPS_FRESH_MS 60 秒以内) → raw GPS で住所 (= 屋内 drift)
//     ④ 全部無し → null
//
// 検証内容:
//   1-4. snap cache 状態別 behavior + 3 段 fallback
//   5. public API export verify (= notifyMMSnap / notifyRawGps / getCurrentLiveAddress)
//   6. _safeGetNearestAddress 流用 (= 同 fallback ロジック・新 logic ゼロ)
//   7. index.html 配線 verify (= 重複回避撤去・常時表示・「(現在地)」 サフィックス・raw GPS notify)
//   8. 不可侵境界 verify (= Meter / Worker B touch なし)
//   9. wp-sub 「タップ」 赤強調 verify
//
// 絶対ルール準拠:
//   ✓ distance_m / Meter / Worker B / map-matcher: 完全無関係
//   ✓ 既存 _safeGetNearestAddress を・流用・新規 logic ゼロ
//   ✓ raw GPS 60 秒 fresh → 屋内 GPS drift でも・町名レベルで・常時表示

'use strict';

const fs = require('fs');
const path = require('path');

let Business;
let getCurrentLiveAddress;
let notifyMMSnap;
let notifyRawGps;
let resetLastMMSnap;
let resetLastRawGps;
let ehimeBundle;

beforeAll(() => {
  delete require.cache[require.resolve(path.join('..', '..', 'js', 'business.js'))];
  Business = require(path.join('..', '..', 'js', 'business.js'));
  getCurrentLiveAddress = Business.getCurrentLiveAddress;
  notifyMMSnap = Business.notifyMMSnap;
  notifyRawGps = Business.notifyRawGps;
  resetLastMMSnap = Business.__addressFormatter.resetLastMMSnap;
  resetLastRawGps = Business.__addressFormatter.resetLastRawGps;
  if (typeof getCurrentLiveAddress !== 'function') {
    throw new Error('Business.getCurrentLiveAddress 未 export');
  }
  if (typeof notifyMMSnap !== 'function') {
    throw new Error('Business.notifyMMSnap 未 export');
  }
  if (typeof notifyRawGps !== 'function') {
    throw new Error('Business.notifyRawGps 未 export');
  }
  // 本物 愛媛 bundle (= 司さん家 PIP 用)
  const ehimePath = path.join(__dirname, '..', '..', 'data', 'town-polygons-ehime.js');
  if (fs.existsSync(ehimePath)) {
    const sandbox = {};
    new Function('window', fs.readFileSync(ehimePath, 'utf8'))(sandbox);
    ehimeBundle = sandbox.TOWN_POLYGONS_EHIME;
  }
});

beforeEach(() => {
  resetLastMMSnap();
  resetLastRawGps();
  if (typeof global !== 'undefined') {
    global.window = {
      TOWN_POLYGONS_EHIME: ehimeBundle,
      RegionHelper: {
        getCurrentPref: function () {
          return 'ehime';
        },
      },
    };
  }
});

afterEach(() => {
  resetLastMMSnap();
  resetLastRawGps();
  if (typeof global !== 'undefined') {
    delete global.window;
  }
});

// ─── 1-4. 3 段 fallback behavior ─
describe('getCurrentLiveAddress: 3 段 fallback (snap fresh → snap stale → raw GPS)', () => {
  it('1. ① snap fresh → 住所文字列 (= 司さん家・本町七丁目 → 「今治市本町」)', () => {
    if (!ehimeBundle) return;
    notifyMMSnap(34.077806599, 132.996956368);
    expect(getCurrentLiveAddress()).toBe('今治市本町');
  });

  it('2. ② snap stale (= 5 秒超え) でも・直近 snap 位置で・町名取得 (= 短時間停止)', () => {
    if (!ehimeBundle) return;
    notifyMMSnap(34.077806599, 132.996956368);
    const stash = Business.__addressFormatter.getLastMMSnap();
    expect(stash).not.toBeNull();
    stash.t = Date.now() - 6000; // 6 秒前 (= stale)
    // 旧仕様は null・新仕様は・町名 (= snap 位置で・PIP 継続)
    expect(getCurrentLiveAddress()).toBe('今治市本町');
  });

  it('3. ③ snap 未 cache + raw GPS fresh → raw GPS 位置で・町名取得 (= 屋内 drift)', () => {
    if (!ehimeBundle) return;
    notifyRawGps(34.077806599, 132.996956368);
    expect(getCurrentLiveAddress()).toBe('今治市本町');
  });

  it('4. ④ snap 未 cache + raw GPS 未 cache → null (= 起動直後)', () => {
    expect(getCurrentLiveAddress()).toBeNull();
  });

  it('5. raw GPS stale (= 60 秒超え) + snap 未 cache → null', () => {
    if (!ehimeBundle) return;
    notifyRawGps(34.077806599, 132.996956368);
    const stash = Business.__addressFormatter.getLastRawGps();
    expect(stash).not.toBeNull();
    stash.t = Date.now() - 61000; // 61 秒前 (= stale)
    expect(getCurrentLiveAddress()).toBeNull();
  });

  it('6. notifyMMSnap で・cache 更新後・getCurrentLiveAddress が・最新位置を返す', () => {
    if (!ehimeBundle) return;
    notifyMMSnap(34.077806599, 132.996956368);
    expect(getCurrentLiveAddress()).toBe('今治市本町');
    notifyMMSnap(33.80677, 132.73824); // 松山市
    expect(getCurrentLiveAddress()).toMatch(/松山市/);
  });

  it('7. ① snap fresh 優先 (= raw GPS あっても snap が・優先)', () => {
    if (!ehimeBundle) return;
    notifyMMSnap(34.077806599, 132.996956368); // 司さん家
    notifyRawGps(33.80677, 132.73824); // 松山市 (= raw GPS は・別位置)
    // snap fresh が優先 → 「今治市本町」 を返す (= raw GPS は無視)
    expect(getCurrentLiveAddress()).toBe('今治市本町');
  });
});

// ─── 8. public API export verify ─
describe('Business public API export', () => {
  it('getCurrentLiveAddress が・Business object に・export されている', () => {
    expect(typeof Business.getCurrentLiveAddress).toBe('function');
  });

  it('notifyMMSnap も・export されている (= 住所① 既存)', () => {
    expect(typeof Business.notifyMMSnap).toBe('function');
  });

  it('notifyRawGps が・新規 export されている (= 住所② raw GPS 配信)', () => {
    expect(typeof Business.notifyRawGps).toBe('function');
  });
});

// ─── 9. 新 logic ゼロ verify (= _safeGetNearestAddress 流用) ─
describe('getCurrentLiveAddress: 新 logic ゼロ・既存 4 段 fallback 流用', () => {
  it('source code で・_safeGetNearestAddress 流用が・確認できる', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'business.js'), 'utf8');
    const m = src.match(/function getCurrentLiveAddress\(\)\s*\{[\s\S]*?\n\s\s\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toContain('_safeGetNearestAddress');
    expect(m[0]).toContain('_lastMMSnap');
    expect(m[0]).toContain('_lastRawGps');
  });

  it('独自 PIP / 独自 fallback logic を・持たない (= wrapper のみ)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'business.js'), 'utf8');
    const m = src.match(/function getCurrentLiveAddress\(\)\s*\{[\s\S]*?\n\s\s\}/);
    const body = m[0];
    expect(body).not.toMatch(/_findTownPolygonAddress\(/);
    expect(body).not.toMatch(/_pointInPolygon\(/);
  });
});

// ─── 10. index.html 配線 verify (= 重複回避撤去・常時表示・「(現在地)」 ・raw GPS notify) ─
describe('index.html: updateWaypointCardUI 配線 verify (= 作り直し版)', () => {
  let html;
  beforeAll(() => {
    html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  });

  it('updateWaypointCardUI 内で・Business.getCurrentLiveAddress 呼出', () => {
    const m = html.match(/function updateWaypointCardUI\(\)\s*\{[\s\S]*?\n\s\s\s\s\s\s\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toContain('Business.getCurrentLiveAddress');
  });

  it('route-live CSS class が・定義されている (= 青パルス style)', () => {
    expect(html).toMatch(/\.route-live\s*\{/);
    expect(html).toMatch(/@keyframes route-live-pulse/);
    expect(html).toMatch(/#2196f3/i);
  });

  it('「(現在地)」 サフィックス用 route-live-tag class が・定義されている', () => {
    expect(html).toMatch(/\.route-live-tag\s*\{/);
  });

  it('liveSuffix で・「→ 📡」 + 「(現在地)」 を・末尾追加', () => {
    const m = html.match(/function updateWaypointCardUI\(\)\s*\{[\s\S]*?\n\s\s\s\s\s\s\}/);
    expect(m[0]).toContain('📡');
    expect(m[0]).toContain('route-live');
    expect(m[0]).toContain('route-live-tag');
    expect(m[0]).toContain('(現在地)');
  });

  it('重複回避 (= liveAddr !== prevTail) は・撤去済 (= 常時表示)', () => {
    const m = html.match(/function updateWaypointCardUI\(\)\s*\{[\s\S]*?\n\s\s\s\s\s\s\}/);
    expect(m[0]).not.toMatch(/liveAddr\s*&&\s*liveAddr\s*!==\s*prevTail/);
    expect(m[0]).not.toMatch(/prevTail/);
  });

  it('GPS callback で・Business.notifyRawGps 配線済 (= 1Hz raw GPS 配信)', () => {
    expect(html).toMatch(/Business\.notifyRawGps\(g\.lat,\s*g\.lng\)/);
  });
});

// ─── 11. wp-sub 「タップ」 赤強調 verify ─
describe('wp-sub: 「タップ」 だけ赤強調 (= 誘目強化)', () => {
  let html;
  beforeAll(() => {
    html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  });

  it('wp-sub-tap CSS class が・定義されている (= 赤・bold)', () => {
    expect(html).toMatch(/\.wp-sub-tap\s*\{/);
    // hex 直値 #e11d48 (= rose-600) 含む (= CSS 変数禁止ルール準拠)
    expect(html).toMatch(/#e11d48/i);
  });

  it('CSS 変数 var(--…) を・wp-sub-tap で・使っていない (= hex 直値ルール)', () => {
    // wp-sub-tap block 内で・var( を使っていない
    const m = html.match(/\.wp-sub-tap\s*\{[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m[0]).not.toMatch(/var\(/);
  });

  it('静的 HTML wp-sub 初期値 (= 起動直後) で・<span class="wp-sub-tap">タップ</span> 使用', () => {
    // 初期表示 (= count 0) 時の・「タップで現在地の住所を記録」 文言を・赤強調
    expect(html).toMatch(/<span class="wp-sub-tap">タップ<\/span>で現在地の住所を記録/);
  });

  it('JS 側 (= updateWaypointCardUI) で・wp-sub-tap 赤強調 を・出力 (= count > 0 / count == 0 両方)', () => {
    const m = html.match(/function updateWaypointCardUI\(\)\s*\{[\s\S]*?\n\s\s\s\s\s\s\}/);
    expect(m).not.toBeNull();
    // count > 0 path
    expect(m[0]).toMatch(/<span class="wp-sub-tap">タップ<\/span>で経由地点を追加/);
    // count == 0 path
    expect(m[0]).toMatch(/<span class="wp-sub-tap">タップ<\/span>で現在地の住所を記録/);
  });
});

// ─── 12. 不可侵境界 verify ─
describe('不可侵境界 verify (= 表示専用・コア無変更)', () => {
  it('business.js getCurrentLiveAddress は・Meter / Worker B に touch しない', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'business.js'), 'utf8');
    const m = src.match(/function getCurrentLiveAddress\(\)\s*\{[\s\S]*?\n\s\s\}/);
    const body = m[0];
    expect(body).not.toMatch(/Meter\.\w+\s*=/);
    expect(body).not.toMatch(/postMessage/);
  });

  it('notifyRawGps も・Meter / Worker B に touch しない (= cache 更新のみ)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'business.js'), 'utf8');
    const m = src.match(/function notifyRawGps\([^)]*\)\s*\{[\s\S]*?\n\s\s\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).not.toMatch(/Meter\.\w+/);
    expect(body).not.toMatch(/postMessage/);
    // cache 更新 1 行のみ (= _lastRawGps = { ... })
    expect(body).toMatch(/_lastRawGps\s*=\s*\{/);
  });
});
