// tests/integration/sw-precache-core-code.test.js
//
// ★2026-07-03 修正: 較正Kが効かなかった実機過小の真因対策(Fix A)★
//   sw.js の PRECACHE_FILES に js/*.js が1個も無く、アプリコードは staleWhileRevalidate
//   配信だった → インストール済みPWAが古いビルドのコード(autoCalibK未適用版)を掴んだまま走り、
//   較正Kが乗らず生OBD∫vで過小。しかも worker の importScripts('k-calib.js') がオフラインで
//   失敗すると autoCalibK が黙って無効化される。
//   → worker/距離コアのコアJSを install 時に「個別add(耐障害)」で先取りキャッシュし、
//     デプロイ時に確実に最新コードへ更新+オフラインでも importScripts が成功するようにする。
//
// 検証(source ベース・SW実行環境不要):
//   1. コアJS先取りリスト(CORE_CODE_FILES)が存在し、worker/距離クリティカル群を含む
//   2. install は個別 add(...).catch で耐障害に先取り(atomic addAll に入れない=1個404で全install死を防ぐ)

'use strict';

const fs = require('fs');
const path = require('path');

let sw;
beforeAll(() => {
  sw = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');
});

describe('sw.js: コアJSを耐障害プリキャッシュ (Fix A)', () => {
  it('★ CORE_CODE_FILES リストが存在', () => {
    expect(sw).toMatch(/CORE_CODE_FILES\s*=\s*\[/);
  });

  it('★ worker/importScripts クリティカル群を含む (オフラインで importScripts 失敗を防ぐ)', () => {
    for (const f of [
      'js/map-matcher.js',
      'js/roads-decoder.js',
      'js/k-calib.js',
      'js/pipeline-distance.js',
      'js/gps-worker.js',
    ]) {
      expect(sw.includes(f)).toBe(true);
    }
  });

  it('★ 距離/課金コア(meter/gps/business/veh-registry/obd-client)を含む', () => {
    for (const f of [
      'js/meter.js',
      'js/gps.js',
      'js/business.js',
      'js/veh-registry.js',
      'js/obd-client.js',
    ]) {
      expect(sw.includes(f)).toBe(true);
    }
  });

  it('★ install で個別 add(...).catch の耐障害先取り (1個404で全install死なせない)', () => {
    // CORE_CODE_FILES を map して cache.add(...).catch(...) している(addAllの原子性を避ける)
    expect(sw).toMatch(/CORE_CODE_FILES\.map\([\s\S]*?cache\.add\([\s\S]*?\.catch\(/);
  });

  it('★ 先取りは cache:"reload" で最新取得 (HTTPキャッシュの古いコードを掴まない)', () => {
    // CORE_CODE_FILES の add で reload 指定
    expect(sw).toMatch(/CORE_CODE_FILES[\s\S]*?cache:\s*'reload'/);
  });
});
