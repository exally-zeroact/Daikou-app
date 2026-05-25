// tests/integration/address-fine-chome-cut.test.js
//
// ★設計変更宣言 (2026-05-23・住所① fine 配線 + 丁目カット表示 verify):
//   meter.js getNearestAddress が・fine hit 時に・「常盤町八丁目」(= 大字単体・市町村なし) を
//   return する仕様 (= 実 data file の・n field) を前提に・consumer side で・
//     1. coarse bundle から・市町村名「今治市」を別 query
//     2. 末尾「○丁目」(漢数字/算用/全角算用) カット → 「常盤町」
//     3. 連結 → 「今治市常盤町」
//   を実現するための・pure helper の・behavior verify。
//
// 検証内容 (= 本物 data 形式 fixture・decimal mock 禁止):
//   1. _cutChomeSuffix: 末尾 ○丁目 (漢数字) カット
//   2. _cutChomeSuffix: 末尾 ○丁目 (算用数字 / 全角算用) カット
//   3. _cutChomeSuffix: 大字止まり (= 丁目なし) は・無変換
//   4. _cutChomeSuffix: null / undefined / non-string は・無変換
//   5. _cutChomeSuffix: 中間の・「○丁目」(= 末尾でない) は・カットしない
//   6. _findNearestMunicipality: 本物 coarse 形式 (= int×1e5 + items) で・最近傍 hit
//   7. _findNearestMunicipality: range 外 → null
//   8. _findNearestMunicipality: ADDRESSES_COARSE_JP 未 load → null
//   9. ★ pipeline auxKinds に・'addresses-fine' 追加 verify (= 配線確認・grep ベース)
//
// 絶対ルール準拠:
//   ✓ distance_m / calcFare / Meter.reset / Worker B 本体: 完全無関係
//   ✓ pure helper (= 副作用なし・引数経由) のみ verify
//   ✓ 本物 coarse / fine entry 形式 (= int×1e5 + n/c field・既存 data file 形式) 使用

'use strict';

const fs = require('fs');
const path = require('path');

let Business;
let cutChomeSuffix;
let findNearestMunicipality;

beforeAll(() => {
  // ─── business.js を Node に・require ───
  delete require.cache[require.resolve(path.join('..', '..', 'js', 'business.js'))];
  Business = require(path.join('..', '..', 'js', 'business.js'));
  cutChomeSuffix = Business.__addressFormatter.cutChomeSuffix;
  findNearestMunicipality = Business.__addressFormatter.findNearestMunicipality;
  if (typeof cutChomeSuffix !== 'function' || typeof findNearestMunicipality !== 'function') {
    throw new Error('business.js __addressFormatter helper export 失敗');
  }
});

afterEach(() => {
  // global ADDRESSES_COARSE_JP の・mock を・各 test 後 clean
  if (typeof global !== 'undefined') {
    delete global.window;
  }
});

// ─── 1-5. _cutChomeSuffix の・各分岐 ─────────────
describe('_cutChomeSuffix: 末尾 ○丁目 カット', () => {
  it('漢数字: 常盤町八丁目 → 常盤町', () => {
    expect(cutChomeSuffix('常盤町八丁目')).toBe('常盤町');
  });

  it('漢数字: 松本町一丁目 → 松本町', () => {
    expect(cutChomeSuffix('松本町一丁目')).toBe('松本町');
  });

  it('漢数字: 十丁目 / 二十丁目 (= 十 / 二十) → 大字単独', () => {
    expect(cutChomeSuffix('青葉町十丁目')).toBe('青葉町');
    expect(cutChomeSuffix('青葉町二十丁目')).toBe('青葉町');
  });

  it('算用数字 (半角): 常盤町5丁目 → 常盤町', () => {
    expect(cutChomeSuffix('常盤町5丁目')).toBe('常盤町');
  });

  it('算用数字 (全角): 常盤町５丁目 → 常盤町', () => {
    expect(cutChomeSuffix('常盤町５丁目')).toBe('常盤町');
  });

  it('複数桁 算用: 常盤町12丁目 → 常盤町', () => {
    expect(cutChomeSuffix('常盤町12丁目')).toBe('常盤町');
  });

  it('大字止まり (= 丁目なし): 市坪西町 → 市坪西町 (無変換)', () => {
    expect(cutChomeSuffix('市坪西町')).toBe('市坪西町');
  });

  it('地番系 (= 「-丁目」含まない): 松本町123-4 → 松本町123-4 (無変換)', () => {
    expect(cutChomeSuffix('松本町123-4')).toBe('松本町123-4');
  });

  it('null / undefined / non-string → 無変換', () => {
    expect(cutChomeSuffix(null)).toBe(null);
    expect(cutChomeSuffix(undefined)).toBe(undefined);
    expect(cutChomeSuffix(123)).toBe(123);
    expect(cutChomeSuffix('')).toBe('');
  });

  it('中間「○丁目」(= 末尾でない) は・カットしない', () => {
    // 仮想例: 末尾が・別の文字 → 丁目部分は・末尾でない
    expect(cutChomeSuffix('五丁目通り')).toBe('五丁目通り');
  });

  it('「丁目」単体 / 数字なし「丁目」は・カットしない', () => {
    expect(cutChomeSuffix('丁目')).toBe('丁目');
    expect(cutChomeSuffix('松本町丁目')).toBe('松本町丁目');
  });
});

// ─── 6-8. _findNearestMunicipality の・各分岐 ─────
describe('_findNearestMunicipality: 本物 coarse 形式で・最近傍 市町村 hit', () => {
  it('司さん GPS (34.06467, 133.0015) → 今治市 hit', () => {
    // 本物 ADDRESSES_COARSE_JP 形式 (= int×1e5 + items・n=市町村名 / c=JIS5桁)
    global.window = {
      ADDRESSES_COARSE_JP: {
        v: 1,
        precision: 100000,
        items: [
          { lat: 3406667, lng: 13298333, n: '今治市', c: '38202' },
          { lat: 3384889, lng: 13276706, n: '松山市', c: '38201' },
          { lat: 3306667, lng: 13256667, n: '宇和島市', c: '38203' },
        ],
      },
    };
    expect(findNearestMunicipality(34.06467, 133.0015)).toBe('今治市');
  });

  it('松山市中心 (= 松山市 hit)', () => {
    global.window = {
      ADDRESSES_COARSE_JP: {
        items: [
          { lat: 3406667, lng: 13298333, n: '今治市', c: '38202' },
          { lat: 3384889, lng: 13276706, n: '松山市', c: '38201' },
        ],
      },
    };
    expect(findNearestMunicipality(33.8489, 132.7671)).toBe('松山市');
  });

  it('range 外 (= 50km 超) → null (= 25km プレフィルタで・hit せず)', () => {
    global.window = {
      ADDRESSES_COARSE_JP: {
        items: [{ lat: 3500000, lng: 13900000, n: '東京都', c: '13101' }], // 東京・遠い
      },
    };
    // 司さん GPS から・~600km 離れた・東京は・hit しない
    expect(findNearestMunicipality(34.06467, 133.0015)).toBe(null);
  });

  it('ADDRESSES_COARSE_JP 未 load → null', () => {
    global.window = {}; // ADDRESSES_COARSE_JP 無し
    expect(findNearestMunicipality(34.06467, 133.0015)).toBe(null);
  });

  it('items 空 → null', () => {
    global.window = {
      ADDRESSES_COARSE_JP: { items: [] },
    };
    expect(findNearestMunicipality(34.06467, 133.0015)).toBe(null);
  });

  it('items が・Array でない → null', () => {
    global.window = {
      ADDRESSES_COARSE_JP: { items: 'not an array' },
    };
    expect(findNearestMunicipality(34.06467, 133.0015)).toBe(null);
  });
});

// ─── 9. mm-data-pipeline.js auxKinds に・'addresses-fine' 追加 verify (= 配線) ─
describe('mm-data-pipeline.js auxKinds: addresses-fine 配線 verify', () => {
  it('loadAuxData の auxKinds に・"addresses-fine" を含む', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'js', 'mm-data-pipeline.js'),
      'utf8'
    );
    // auxKinds array literal を・抽出
    const m = src.match(
      /async loadAuxData\s*\(\s*\)\s*\{[\s\S]*?const auxKinds\s*=\s*\[([\s\S]*?)\]/
    );
    expect(m).not.toBeNull();
    const auxKindsBody = m[1];
    expect(auxKindsBody).toContain("'tunnels'");
    expect(auxKindsBody).toContain("'bridges'");
    expect(auxKindsBody).toContain("'road-attrs'");
    expect(auxKindsBody).toContain("'road-flood'");
    expect(auxKindsBody).toContain("'road-jizen'");
    expect(auxKindsBody).toContain("'road-yobo'");
    // ★ 本タスクで・追加した・'addresses-fine'
    expect(auxKindsBody).toContain("'addresses-fine'");
  });

  it('data-registry.js に・addresses-fine perPref 登録あり (= 既存 verify)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'data-registry.js'), 'utf8');
    expect(src).toMatch(/kind:\s*'addresses-fine'/);
    expect(src).toMatch(/template:\s*'\/data\/addresses-fine-\{pref\}\.js'/);
    expect(src).toMatch(/ADDRESSES_FINE_/);
  });
});

// ─── 10. 統合シナリオ (= 司さん住所の・想定挙動) ──────
describe('住所① 統合シナリオ: 司さん住所 (今治市常盤町五丁目) → 今治市常盤町', () => {
  it('fine 戻り値「常盤町五丁目」+ coarse「今治市」 → 「今治市常盤町」', () => {
    // 本物 coarse data・今治市 hit
    global.window = {
      ADDRESSES_COARSE_JP: {
        items: [{ lat: 3406667, lng: 13298333, n: '今治市', c: '38202' }],
      },
    };
    // meter.js fine 戻り値・想定 (= 司さん希望)
    const fineRaw = '常盤町五丁目';
    const cut = cutChomeSuffix(fineRaw);
    expect(cut).toBe('常盤町');
    const city = findNearestMunicipality(34.06467, 133.0015);
    expect(city).toBe('今治市');
    // 連結
    expect(city + cut).toBe('今治市常盤町');
  });

  it('fine 戻り値「松本町一丁目」(= 司さん住所) + 「今治市」 → 「今治市松本町」', () => {
    global.window = {
      ADDRESSES_COARSE_JP: {
        items: [{ lat: 3406667, lng: 13298333, n: '今治市', c: '38202' }],
      },
    };
    expect(cutChomeSuffix('松本町一丁目')).toBe('松本町');
    expect(findNearestMunicipality(34.06467, 133.0015) + cutChomeSuffix('松本町一丁目')).toBe(
      '今治市松本町'
    );
  });

  it('fine 戻り値「市坪西町」(= 大字止まり) + 「松山市」 → 「松山市市坪西町」', () => {
    global.window = {
      ADDRESSES_COARSE_JP: {
        items: [{ lat: 3384889, lng: 13276706, n: '松山市', c: '38201' }],
      },
    };
    // 大字止まり (= 丁目なし) は・カット不要・無変換
    expect(cutChomeSuffix('市坪西町')).toBe('市坪西町');
    expect(findNearestMunicipality(33.8489, 132.7671) + cutChomeSuffix('市坪西町')).toBe(
      '松山市市坪西町'
    );
  });
});
