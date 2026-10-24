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
