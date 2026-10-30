// ============================================================
// ★★見張り：どの 都道府県でも 地名は 町名まで 正しく★★ 2026-10-24
//   司さん「そんな曖昧にすんなや どの都道府県でもそんなにするなきっちりやれや」
//   （今治市郷桜井 が「西条市 付近」「西条市郷桜井」に なって いた）
//
//   正解＝元の 細かい 形（NII Geoshape フル解像度）で 決めた 点（tests/fixtures/chimei-seikai.json・
//   scripts/make-chimei-seikai.js が 作る・県ごとに 面積で 均等＋人の 数で 選ぶ・境から 10m より 近い 点は 入れない）
//   見る 物＝本物の 地名の 関数（Business.__addressFormatter.chimeiAt）に 本物の data/town-polygons-{pref}.js を 渡して 引いた 字
//   ★1点も 違わない★・「付近」は 0
//   わざと壊す：前の 形（町ごとに 別々に 削った 愛媛）に 戻す ⇒ 赤（前の 形で 実測 愛媛 200点中 5点 違う）
//
// ★★全部の 市町村（区）に 1点（2026-10-30・6 住所の 全国確認）★★
//   県ごとの 点は 小さな 村に 落ちない＝前の 作り方で 9市町村（長野4村・知夫・直島・湯前・姫島・渡名喜）が
//   まるごと 形 無しでも この 見張りは 緑だった。perShi＝元データの 全 市町村（区）で 一番 広い 町の 中の 1点
//   （scripts/make-chimei-seikai.js --shi・全国 1892・浜松は 今の 3区）
//   ★数は 1892 で 固める★（元データ 1896 − 浜松 旧7区 ＋ 今の 3区）＝作り直しで 元データが 欠けても 緑に ならない
//   ★引けた 道は pip だけ★（区画が 欠けて 近くの 町で 同じ 名前が 返っても 赤）
//   tokubetsu＝町の 名前が 無い 区画（元の S_NAME が 空・全国 211・町名の ある 町と 混ざった 市町村の 分も）に 1点ずつ（取れない 小さな 3区画は 除く）
//             ＋浜松の 三方原地区 7町（旧北区→中央区・imaNoShi の 置き換え）に 1点ずつ
//   わざと壊す：島根の 束から 町の 名前が 無い 区画（知夫村 まるごと）を 抜く ⇒ 赤1（島根 違う 市町村 1・知夫村→null）
//   わざと壊す：三方原地区 7町を 浜名区に／愛知の 束から 町の 名前が 無い 区画を 抜く ⇒ 赤2（静岡 違う 点 7・愛知 14＝県ごとの 1点 では 愛知は 緑の まま だった）
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SEIKAI = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'chimei-seikai.json'), 'utf8')
);

function loadBusiness() {
  const p = path.join(ROOT, 'js', 'business.js');
  delete require.cache[require.resolve(p)];
  return require(p);
}

describe('どの 都道府県でも 地名は 町名まで 正しく（正解は 元の 細かい 形）', () => {
  afterEach(() => {
    delete global.window;
  });
  const prefs = Object.keys(SEIKAI.perPref);
  it('正解の 点が 在る（県の 数）', () => {
    expect(prefs.length).toBeGreaterThan(0);
  });
  for (const pref of prefs) {
    it(
      pref + '：' + SEIKAI.perPref[pref].length + ' 点 全部 正しい・付近 0',
      () => {
        const sb = {};
        new Function(
          'window',
          fs.readFileSync(path.join(ROOT, 'data', 'town-polygons-' + pref + '.js'), 'utf8')
        )(sb);
        global.window = sb;
        const B = loadBusiness();
        const chigau = [];
        for (const [lat, lng, seikai] of SEIKAI.perPref[pref]) {
          const r = B.__addressFormatter.chimeiAt(lat, lng);
          const s = r ? r.s : null;
          if (s !== seikai) chigau.push([lat, lng, seikai, s]);
        }
        expect(chigau.slice(0, 5), pref + ' で 違う 点 ' + chigau.length).toEqual([]);
      },
      60000
    );
  }
});

describe('全部の 市町村（区）で 地名が 正しい（1市町村 1点）', () => {
  afterEach(() => {
    delete global.window;
  });
  const perShi = SEIKAI.perShi || {};
  it('全国の 市町村（区）の 点が 揃う（形の 無かった 9市町村・浜松の 今の 3区 も 入る）', () => {
    const all = Object.values(perShi).flat();
    expect(Object.keys(perShi).length).toBe(47);
    expect(all.length).toBe(1892);
    expect(SEIKAI.shiKazu).toBe(1892);
    const names = all.map((p) => p[2]);
    const hitotsu = (re) => names.filter((n) => re.test(n)).length;
    for (const re of [
      /^知夫村/,
      /^直島町/,
      /^湯前町/,
      /^姫島村/,
      /^渡名喜村/,
      /^平谷村/,
      /^浜松市中央区/,
      /^浜松市浜名区/,
      /^浜松市天竜区/,
    ])
      expect(hitotsu(re), String(re)).toBe(1);
    expect(hitotsu(/^浜松市(中|東|西|南|北|浜北)区/)).toBe(0);
  });
  for (const pref of Object.keys(perShi)) {
    it(
      pref + '：' + perShi[pref].length + ' 市町村 全部 正しい',
      () => {
        const sb = {};
        new Function(
          'window',
          fs.readFileSync(path.join(ROOT, 'data', 'town-polygons-' + pref + '.js'), 'utf8')
        )(sb);
        global.window = sb;
        const B = loadBusiness();
        const chigau = [];
        for (const [lat, lng, seikai] of perShi[pref]) {
          const r = B.__addressFormatter.chimeiAt(lat, lng);
          const s = r ? r.s + (r.how === 'pip' ? '' : '（' + r.how + '）') : null;
          if (s !== seikai) chigau.push([lat, lng, seikai, s]);
        }
        expect(chigau.slice(0, 5), pref + ' で 違う 市町村 ' + chigau.length).toEqual([]);
      },
      60000
    );
  }
});

describe('町の 名前が 無い 区画・浜松の 三方原地区 も 正しい', () => {
  afterEach(() => {
    delete global.window;
  });
  const toku = SEIKAI.tokubetsu || [];
  it('点が 揃う（町名の 無い 区画 211 の 内 208・三方原地区 7町）', () => {
    expect(SEIKAI.nashiKukaku).toBe(211);
    expect(toku.length).toBe(215);
    const mikata = toku.filter((p) =>
      /^浜松市中央区(初生町|三方原町|東三方町|豊岡町|三幸町|大原町|根洗町)/.test(p[2])
    );
    expect(mikata.length).toBe(7);
  });
  const prefs = [...new Set(toku.map((p) => p[3]))];
  for (const pref of prefs) {
    const pts = toku.filter((p) => p[3] === pref);
    it(
      pref + '：' + pts.length + ' 点 全部 正しい（pip）',
      () => {
        const sb = {};
        new Function(
          'window',
          fs.readFileSync(path.join(ROOT, 'data', 'town-polygons-' + pref + '.js'), 'utf8')
        )(sb);
        global.window = sb;
        const B = loadBusiness();
        const chigau = [];
        for (const [lat, lng, seikai] of pts) {
          const r = B.__addressFormatter.chimeiAt(lat, lng);
          const s = r ? r.s + (r.how === 'pip' ? '' : '（' + r.how + '）') : null;
          if (s !== seikai) chigau.push([lat, lng, seikai, s]);
        }
        expect(chigau.slice(0, 5), pref + ' で 違う 点 ' + chigau.length).toEqual([]);
      },
      60000
    );
  }
});
