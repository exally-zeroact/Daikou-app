// tests/unit/mm-data-pipeline-load.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P3-⑬ / 全32件)
//
// 検証対象: mm-data-pipeline.js MMDataPipeline class
//   loadGlobal / loadRoads / loadAuxiliary / onGpsReady / onMmReady のロード経路
//   IIFE + global.MMDataPipeline export 形式。本 test は source の静的構造 verify が中心。
//
// 絶対ルール準拠:
//   js/mm-data-pipeline.js は触らない absolute。

const fs = require('fs');
const path = require('path');

const MM_DP_PATH = path.join(__dirname, '..', '..', 'js', 'mm-data-pipeline.js');

function loadSource() {
  return fs.readFileSync(MM_DP_PATH, 'utf8');
}

describe('mm-data-pipeline.js MMDataPipeline (P3-⑬)', () => {
  it('S1: class MMDataPipeline 定義の存在', () => {
    const source = loadSource();
    if (!/class\s+MMDataPipeline\s*\{/.test(source)) {
      throw new Error('class MMDataPipeline 未検出');
    }
  });

  it('S2: IIFE で global.MMDataPipeline に export される', () => {
    const source = loadSource();
    if (!/global\.MMDataPipeline\s*=\s*MMDataPipeline/.test(source)) {
      throw new Error('global.MMDataPipeline export 未検出');
    }
  });

  it('S3: enqueueRetry 関数が定義されている (= retry 経路の存在)', () => {
    const source = loadSource();
    if (!/enqueueRetry\s*\(/.test(source)) {
      throw new Error('enqueueRetry 関数未検出');
    }
  });

  it('S4: warmup 起動経路が存在 (= MMDataPipeline 段階起動)', () => {
    const source = loadSource();
    if (!/warmup\s+(開始|起動|既に)/.test(source)) {
      throw new Error('warmup 経路コメント未検出');
    }
  });

  it('S5: GPS timeout 経路が存在', () => {
    const source = loadSource();
    if (!/GPS timeout/.test(source)) {
      throw new Error('GPS timeout 経路未検出');
    }
  });

  it('S6: RegionHelper.getCurrentPref を利用 (= 県別 load 分岐)', () => {
    const source = loadSource();
    if (!/RegionHelper\.getCurrentPref/.test(source)) {
      throw new Error('RegionHelper.getCurrentPref 利用箇所未検出');
    }
  });

  it('S7: cache 補修 (offline skip) 経路の存在', () => {
    const source = loadSource();
    if (!/cache 補修 skip.*offline/.test(source)) {
      throw new Error('cache 補修 skip (offline) 経路未検出');
    }
  });

  it('S8: 各 entry の load 試行で no global var / worker not ready の reason 返却', () => {
    const source = loadSource();
    if (!/no global var/.test(source)) {
      throw new Error('no global var reason 未検出');
    }
    if (!/worker not ready/.test(source)) {
      throw new Error('worker not ready reason 未検出');
    }
  });

  it('S9: onProgress callback hook が存在 (= UI 進捗通知)', () => {
    const source = loadSource();
    if (
      !/this\.onProgress\s*===\s*['"]function['"]|typeof\s+this\.onProgress\s*===\s*['"]function['"]/.test(
        source
      )
    ) {
      throw new Error('this.onProgress callback hook 未検出');
    }
  });
});
