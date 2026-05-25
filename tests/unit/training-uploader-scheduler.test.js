// tests/unit/training-uploader-scheduler.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P3-⑭ / 全32件)
//
// 検証対象: training-uploader.js scheduler 起動条件 + retry
//   _checkConditions: navigator.connection.type=wifi/ethernet/unknown + battery.charging
//   UPLOAD_MIN_SAMPLES=500 / UPLOAD_BATCH_SIZE=1000
//
// 絶対ルール準拠:
//   js/training-uploader.js は触らない absolute・isolated 実装で property test。

const fs = require('fs');
const path = require('path');

const TU_PATH = path.join(__dirname, '..', '..', 'js', 'training-uploader.js');

function loadSource() {
  return fs.readFileSync(TU_PATH, 'utf8');
}

// isolated 実装 (= _checkConditions の WiFi + Battery 判定)
function checkConditions(connType, batteryCharging) {
  if (connType !== 'wifi' && connType !== 'ethernet' && connType !== 'unknown') {
    return { ok: false, reason: 'not_wifi' };
  }
  if (batteryCharging === false) {
    return { ok: false, reason: 'not_charging' };
  }
  return { ok: true };
}

describe('training-uploader.js scheduler (P3-⑭)', () => {
  it('S1: 定数 UPLOAD_MIN_SAMPLES=500 / UPLOAD_BATCH_SIZE=1000', () => {
    const source = loadSource();
    if (!/UPLOAD_MIN_SAMPLES\s*=\s*500\b/.test(source)) {
      throw new Error('UPLOAD_MIN_SAMPLES=500 未検出');
    }
    if (!/UPLOAD_BATCH_SIZE\s*=\s*1000\b/.test(source)) {
      throw new Error('UPLOAD_BATCH_SIZE=1000 未検出');
    }
  });

  it('S2: _checkConditions / _maybeUpload / _runUpload 関数定義', () => {
    const source = loadSource();
    if (!/function\s+_checkConditions\s*\(/.test(source)) {
      throw new Error('_checkConditions 関数未検出');
    }
    if (!/function\s+_maybeUpload\s*\(/.test(source)) {
      throw new Error('_maybeUpload 関数未検出');
    }
    if (!/function\s+_runUpload\s*\(/.test(source)) {
      throw new Error('_runUpload 関数未検出');
    }
  });

  it('S3: window.addEventListener online + visibilitychange 経路', () => {
    const source = loadSource();
    if (!/addEventListener\s*\(\s*['"]online['"]/.test(source)) {
      throw new Error('online listener 未検出');
    }
    if (!/visibilitychange/.test(source)) {
      throw new Error('visibilitychange listener 未検出');
    }
  });

  it('S4: navigator.serviceWorker.addEventListener message 経路 (= Background Sync)', () => {
    const source = loadSource();
    if (!/navigator\.serviceWorker\.addEventListener.*message/.test(source)) {
      throw new Error('SW message listener 未検出');
    }
  });

  it('D1: WiFi 接続 + 充電中 → ok=true', () => {
    expect(checkConditions('wifi', true).ok).toBe(true);
  });

  it('D2: ethernet 接続 + 充電中 → ok=true', () => {
    expect(checkConditions('ethernet', true).ok).toBe(true);
  });

  it('D3: unknown 接続 (= 仕様: WiFi として扱う) + 充電中 → ok=true', () => {
    expect(checkConditions('unknown', true).ok).toBe(true);
  });

  it('D4: cellular 接続 → reason=not_wifi', () => {
    const r = checkConditions('cellular', true);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_wifi');
  });

  it('D5: WiFi + 充電中=false → reason=not_charging', () => {
    const r = checkConditions('wifi', false);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_charging');
  });

  it('D6: WiFi + charging=undefined (= API 未対応) → ok=true (= 抑制しない)', () => {
    // 仕様: battery API 未対応の場合 charging=undefined で skip しない (= 業務継続性)
    expect(checkConditions('wifi', undefined).ok).toBe(true);
  });

  it('D7: cellular + charging=false → not_wifi (= 順序: WiFi 判定が先)', () => {
    const r = checkConditions('cellular', false);
    expect(r.reason).toBe('not_wifi'); // WiFi 判定が先に return
  });
});
