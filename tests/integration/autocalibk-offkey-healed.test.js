// tests/integration/autocalibk-offkey-healed.test.js
//
// ★2026-07-03 実機事故の根治(Fix C)★
//   旧: ?autocalibk=off が localStorage 'DK_AUTO_CALIB_K_OFF' に★永続★→ 一度踏むと以降どの
//   バージョンに更新しても autoCalibK が黙って無効化され、較正K(≈1.02)が乗らず生OBD∫vで過小課金。
//   ドライバーは URL を触らないので気付けず、?autocalibk=on を付けさせるのは製品として論外。
//   → (a)起動毎に OFFキーを必ず消す=焼き付き自動治癒 (b)?autocalibk=off はセッション限定(永続なし)
//     (c)ドライバーは何も付けなくても K が常時ON。
//   ※source assertion(実DOM/localStorageは実機)。緑≠実機OK。

'use strict';

const fs = require('fs');
const path = require('path');

let html;
beforeAll(() => {
  html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
});

describe('autoCalibK: 永続OFFキー廃止・焼き付き自動治癒 (Fix C)', () => {
  it('★ 起動時に DK_AUTO_CALIB_K_OFF を必ず removeItem する(焼き付き治癒)', () => {
    expect(html).toMatch(/removeItem\(\s*'DK_AUTO_CALIB_K_OFF'\s*\)/);
  });

  it('★ OFFキーを localStorage に永続保存(setItem)しない(=二度と焼き付かない)', () => {
    // 旧 `localStorage.setItem(OFFKEY, '1')` / `setItem('DK_AUTO_CALIB_K_OFF'...)` が残っていないこと
    expect(html).not.toMatch(/setItem\(\s*OFFKEY/);
    expect(html).not.toMatch(/setItem\(\s*'DK_AUTO_CALIB_K_OFF'/);
  });

  it('★ DK_AUTO_CALIB_K は素で常時ON・?autocalibk=off はセッション限定OFF', () => {
    // window.DK_AUTO_CALIB_K = (URLパラメータ) !== 'off' の形(localStorage参照でなく現URLのみ)
    expect(html).toMatch(/window\.DK_AUTO_CALIB_K\s*=\s*p\s*!==\s*'off'/);
    // 旧: localStorage.getItem(OFFKEY) を判定に使う形は消えていること
    expect(html).not.toMatch(
      /DK_AUTO_CALIB_K\s*=\s*localStorage\.getItem\('DK_AUTO_CALIB_K_OFF'\)/
    );
  });
});
