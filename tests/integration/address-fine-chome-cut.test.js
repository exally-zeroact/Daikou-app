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
//   6-8. 町の 形が 無い 時の 細かい 点＝市の 名前は その 点の 物（2026-10-24・代表点の 市名は 外した）
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

beforeAll(() => {
  // ─── business.js を Node に・require ───
  delete require.cache[require.resolve(path.join('..', '..', 'js', 'business.js'))];
  Business = require(path.join('..', '..', 'js', 'business.js'));
  cutChomeSuffix = Business.__addressFormatter.cutChomeSuffix;
  if (typeof cutChomeSuffix !== 'function') {
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

// ─── 6-8. 町の 形が まだ 無い 時＝細かい 点（その 点が 持つ 市の 名前）★2026-10-24★ ─────
//   前は 市の 名前を「一番 近い 市の 代表点」で 付けた＝今治市郷桜井 が「西条市郷桜井」に なった
//   今は 細かい 点 {n, c} の c を 使う。代表点の 市は 使わない・500m より 遠い 点は 使わない
describe('町の 形が 無い 時の 細かい 点：市の 名前は その 点の 物（代表点で 付けない）', () => {
  const chimei = (lat, lng) => {
    const r = Business.__addressFormatter.chimeiAt(lat, lng);
    return r ? r.s : null;
  };
  it('郷桜井三丁目の 点の 近く＝「今治市郷桜井」（西条市の 代表点が 近くても）', () => {
    global.window = {
      ADDRESSES_COARSE_JP: {
        items: [
          { lat: 3413215, lng: 13304801, n: '今治市', c: '38202' },
          { lat: 3394621, lng: 13311180, n: '西条市', c: '38206' },
        ],
      },
      ADDRESSES_FINE_EHIME: {
        items: [{ lat: 3401685, lng: 13303519, n: '郷桜井三丁目', c: '今治市' }],
      },
    };
    expect(chimei(34.0165, 133.0349)).toBe('今治市郷桜井');
  });
  it('細かい 点が 500m より 遠い＝null（「付近」に しない）', () => {
    global.window = {
      ADDRESSES_COARSE_JP: { items: [{ lat: 3394621, lng: 13311180, n: '西条市', c: '38206' }] },
      ADDRESSES_FINE_EHIME: {
        items: [{ lat: 3401685, lng: 13303519, n: '郷桜井三丁目', c: '今治市' }],
      },
    };
    expect(chimei(34.0066, 133.04)).toBe(null);
  });
  it('市の 名前を 持たない 細かい 点は 使わない', () => {
    global.window = {
      ADDRESSES_FINE_EHIME: { items: [{ lat: 3401685, lng: 13303519, n: '郷桜井三丁目' }] },
    };
    expect(chimei(34.0165, 133.0349)).toBe(null);
  });
  it('何も 読めて いない＝null', () => {
    global.window = {};
    expect(chimei(34.0939, 132.9622)).toBe(null);
  });
});

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
