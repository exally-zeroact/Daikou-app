// tests/unit/obd-0131-instrumentation.test.js
// ★OBD診断計装(2026-06-23・司さん「できること全部入れてtrace分析→式」)の単体テスト★
//   全車をB(物理の実距離=車輪回転×タイヤ比)へ寄せる材料を1回の診断走行で集めるための read-only 計装:
//     ・0131 ECU距離(_parseDistKm / getDistanceSinceClear)= B(真距離)の基準
//     ・生OBD∫v(getObdIntegral)= K較正の忠実な分母(GPS 1Hz再積分の過小を回避)
//     ・輪速診断モード(setWheelSpeedDiscovery)= ABS輪速CAN捕捉の手動ON/OFF
//   絶対ルール: いずれも距離コア/課金に未配線(記録専用)であることを担保する。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const OBD_PATH = path.join(__dirname, '..', '..', 'js', 'obd-client.js');

function loadOBD() {
  const src = fs.readFileSync(OBD_PATH, 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, Date, Promise, Uint8Array, Number, Math };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'obd-client.js' });
  return sandbox.OBDClient;
}

describe('0131 ECU距離パース (_parseDistKm・41 31 + 2byte・1km/bit)', () => {
  const O = loadOBD();
  const cases = [
    ['41 31 00 7B', 123],
    ['4131007B', 123],
    ['41 31 00 00', 0],
    ['41 31 FF FF', 65535],
    ['SEARCHING...\r41 31 01 00', 256],
    ['41 31 00 7B\r>', 123],
    ['NO DATA', null],
    ['ERROR', null],
    ['41 0D 3C', null], // 速度PID(0D)はECU距離ではない
    ['41 A6 00 00 03 E8', null], // オドメーターPID(A6)は0131ではない
    ['', null],
    ['>', null],
    [null, null],
    [undefined, null],
  ];
  it.each(cases)('parse(%o) = %o', (input, expected) => {
    expect(O._parseDistKm(input)).toBe(expected);
  });
});

describe('getDistanceSinceClear (0131・初期=未取得)', () => {
  const O = loadOBD();
  it('初期は km:-1(未対応/未取得)・shape を持つ', () => {
    const d = O.getDistanceSinceClear();
    expect(d).toBeTruthy();
    expect(d.km).toBe(-1);
    expect(typeof d.ts).toBe('number');
    expect(d.supported).toBe(false);
    expect(d.ageMs).toBe(Infinity);
  });
});

describe('getObdIntegral (生OBD∫v・faithful・初期=0)', () => {
  const O = loadOBD();
  it('初期は m:0・shape を持つ(積算前)', () => {
    const v = O.getObdIntegral();
    expect(v).toBeTruthy();
    expect(v.m).toBe(0);
    expect(typeof v.ts).toBe('number');
  });
});

describe('setWheelSpeedDiscovery (輪速診断モード手動トグル・既定OFF)', () => {
  const O = loadOBD();
  it('true で true を返す / false で false を返す', () => {
    expect(O.setWheelSpeedDiscovery(true)).toBe(true);
    expect(O.setWheelSpeedDiscovery(false)).toBe(false);
  });
  it('真偽値以外は false 扱い(=安全側OFF)', () => {
    expect(O.setWheelSpeedDiscovery(1)).toBe(false);
    expect(O.setWheelSpeedDiscovery('on')).toBe(false);
    expect(O.setWheelSpeedDiscovery(undefined)).toBe(false);
  });
});

describe('★絶対ルール: 計装は距離コア/課金に未配線(記録専用)★', () => {
  const O = loadOBD();
  it('診断系API(getDistanceSinceClear/getObdIntegral/setWheelSpeedDiscovery)は export されているが距離を返さない', () => {
    // 距離源は従来通り getSpeed(010D)一本。診断APIは別物(記録専用)。
    expect(typeof O.getDistanceSinceClear).toBe('function');
    expect(typeof O.getObdIntegral).toBe('function');
    expect(typeof O.setWheelSpeedDiscovery).toBe('function');
    expect(typeof O.getSpeed).toBe('function'); // 距離源は不変
  });
});
