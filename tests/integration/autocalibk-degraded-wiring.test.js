// tests/integration/autocalibk-degraded-wiring.test.js
//
// ★対立監査P1-①是正の配線検証 (2026-07-03)★
//   Fix B で calibStatus に degraded を出しても、index.html が消費しなければ「検知するが誰も見ない=dead」
//   で無音過小が再発する(監査官指摘)。→ mmResult ハンドラが degraded を window フラグに反映し、
//   代行開始ゲートを閉じ、永続バナーで「更新/再起動」を警告する配線が入っていることを検証する。
//   ※source assertion(index.htmlのDOM実行は別途実機trace)。緑≠実機OK。

'use strict';

const fs = require('fs');
const path = require('path');

let html;
beforeAll(() => {
  html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
});

describe('degraded 配線: 無音過小の再発防止 (対立監査P1-①)', () => {
  it('★ mmResult が calibStatus.degraded を window._autoCalibKDegraded に反映', () => {
    expect(html).toMatch(
      /window\._autoCalibKDegraded\s*=\s*!!\([\s\S]*?m\.calibStatus[\s\S]*?degraded\s*===\s*true/
    );
  });

  it('★ 代行開始ゲート(_calibGateBlocked)が degraded/notApplied で true=課金開始させない', () => {
    expect(html).toMatch(
      /_calibGateBlocked\s*=\s*function[\s\S]*?window\._autoCalibKDegraded\s*===\s*true\s*\|\|\s*window\._autoCalibKNotApplied\s*===\s*true\)[\s\S]*?return true/
    );
  });

  it('★ Kが乗ってない時は"較正中"でなく赤の「更新/再起動」警告バナーを出す', () => {
    expect(html).toMatch(/較正Kが未適用/);
    expect(html).toMatch(/較正Kが未適用[\s\S]*?更新\/再起動/);
  });

  it('★③の穴: 保存calibKs≥3なのに実行時active≠trueを掴む(復元漏れ等の無音過小)', () => {
    expect(html).toMatch(
      /_rawNotApplied\s*=\s*!!\([\s\S]*?_savedKn\s*>=\s*3[\s\S]*?m\.calibStatus\.active\s*!==\s*true/
    );
  });

  it('★対立監査P1-a: notApplied は3連続で確定=単発フリッカーで誤ブロックしない(debounce)', () => {
    expect(html).toMatch(
      /_notAppliedStreak\s*=\s*_rawNotApplied\s*\?\s*\(window\._notAppliedStreak\s*\|\|\s*0\)\s*\+\s*1\s*:\s*0/
    );
    expect(html).toMatch(/window\._autoCalibKNotApplied\s*=\s*window\._notAppliedStreak\s*>=\s*3/);
  });

  it('★対立監査P1-a: OBD接続時に _postVehicleK() で保存K再注入(接続直後transient誤爆の根治)', () => {
    expect(html).toMatch(
      /_obdConnected\s*&&[\s\S]*?Meter\._postVehicleK[\s\S]*?Meter\._postVehicleK\(\)/
    );
  });
});
