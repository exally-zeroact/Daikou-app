// tests/unit/obd-probe.test.js
// ★OBD距離能力プローブ decode 検証 (2026-06-09・随伴車Tier判定)★
//   _decodeProbe が ELM327 の生応答(01A6 オドメーター/0131 距離)を正しく値化するか。
//   実機プローブ結果(console_log)をオフライン解析する前提の純関数テスト。

import { describe, it, expect, beforeAll } from 'vitest';

let OBDClient;
beforeAll(async () => {
  global.window = global;
  await import('../../js/obd-client.js');
  OBDClient = global.OBDClient;
});

describe('OBD probe decode (_decodeProbe)', () => {
  it('01A6 標準オドメーター(0.1km×4byte)を km へ', () => {
    // 41 A6 00 01 E2 40 → 0x0001E240 = 123456 ×0.1 = 12345.6 km
    const r = OBDClient._decodeProbe({ odometer_01A6: { raw: '41 A6 00 01 E2 40 >' } });
    expect(r.odometer_km).toBeCloseTo(12345.6, 1);
    expect(r.odometer_supported).toBe(true);
  });

  it('空白なし連結応答もパースできる', () => {
    const r = OBDClient._decodeProbe({ odometer_01A6: { raw: '41A60001E240' } });
    expect(r.odometer_km).toBeCloseTo(12345.6, 1);
  });

  it('NO DATA はオドメーター非対応(false)', () => {
    const r = OBDClient._decodeProbe({ odometer_01A6: { raw: 'NO DATA >' } });
    expect(r.odometer_supported).toBe(false);
    expect(r.odometer_km).toBeUndefined();
  });

  it('0131 距離(1km×2byte)を km へ', () => {
    // 41 31 00 64 → 0x0064 = 100 km
    const r = OBDClient._decodeProbe({ dist_since_clear_0131: { raw: '41 31 00 64 >' } });
    expect(r.dist_since_clear_km).toBe(100);
  });

  it('_parseOdometerKm: 走行中ポーリングの01A6応答を km へ (-1=未取得)', () => {
    // 41 A6 00 01 E2 40 → 0x0001E240 = 123456 ×0.1 = 12345.6 km
    expect(OBDClient._parseOdometerKm('41 A6 00 01 E2 40\r>')).toBeCloseTo(12345.6, 1);
    expect(OBDClient._parseOdometerKm('41A60001E240')).toBeCloseTo(12345.6, 1);
    expect(OBDClient._parseOdometerKm('NO DATA\r>')).toBeNull();
    expect(OBDClient._parseOdometerKm('41 0D 3C\r>')).toBeNull(); // 別PID(速度)は odo でない
  });

  it('getOdometer は未接続で km:-1・supported:false', () => {
    const o = OBDClient.getOdometer();
    expect(o.km).toBe(-1);
    expect(o.supported).toBe(false);
  });

  it('プローブ問い合わせ一覧は距離系PID+VINを含む', () => {
    const cmds = OBDClient._PROBE_QUERIES.map((q) => q[1]);
    expect(cmds).toContain('01A6'); // 標準オドメーター
    expect(cmds).toContain('0131'); // 距離
    expect(cmds).toContain('0902'); // VIN
    expect(cmds).toContain('0100'); // 対応PIDマスク
    // 速度010Dはポーリングで取得済のためプローブからは除外(BLEテストのin-flight検証と両立)
    expect(cmds).not.toContain('010D');
  });
});
