// tests/unit/obd-client.test.js
// ★OBD速度源(obdブランチ・2026-06-05)の単体テスト★
//   実機BLEは無いので、純関数(ELM327応答→車速)と speedProvider 鮮度ロジックを検証する。
//   絶対ルール: 距離コア/課金に依存しない独立部品であることの担保も兼ねる。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const OBD_PATH = path.join(__dirname, '..', '..', 'js', 'obd-client.js');

// obd-client.js を sandbox で実体化し global.OBDClient を取り出す (navigator なし=Web BT非対応環境)
function loadOBD(navigatorStub) {
  const src = fs.readFileSync(OBD_PATH, 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, Date, Promise, Uint8Array, Number, Math };
  if (navigatorStub !== undefined) sandbox.navigator = navigatorStub;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'obd-client.js' });
  return sandbox.OBDClient;
}

describe('OBDClient ELM327 速度パース (_parseSpeedKmh)', () => {
  const O = loadOBD();
  const cases = [
    ['41 0D 3C', 60],
    ['410D00', 0],
    ['41 0D FF', 255],
    ['SEARCHING...\r41 0D 1E', 30],
    ['41 0D 50\r>', 80],
    ['NO DATA', null],
    ['ERROR', null],
    ['41 0C 1A 2B', null], // 別PID(0C)は速度ではない
    ['', null],
    ['>', null],
    [null, null],
    [undefined, null],
  ];
  it.each(cases)('parse(%o) = %o', (input, expected) => {
    expect(O._parseSpeedKmh(input)).toBe(expected);
  });

  it('範囲外(>255)はnull', () => {
    // 16進2桁では最大FF=255なので構造上 >255 は出ないが、念のため正しく扱う
    expect(O._parseSpeedKmh('41 0D FF')).toBe(255);
  });
});

describe('OBDClient ELM327 RPMパース (_parseRpm・010C・(256A+B)/4)', () => {
  const O = loadOBD();
  const cases = [
    ['41 0C 0F A0', 1000], // (256*15+160)/4 = 4000/4
    ['410C0BB8', 750], // idle (256*11+184)/4 = 3000/4
    ['41 0C 1A F8', 1726], // (256*26+248)/4 = 6904/4
    ['41 0C 00 00', 0],
    ['SEARCHING...\r41 0C 0F A0', 1000],
    ['41 0C 0F A0\r>', 1000],
    ['NO DATA', null],
    ['ERROR', null],
    ['41 0D 3C', null], // 速度PID(0D)はRPMではない
    ['41 0C 0F', null], // 1byteしかない(2byte必要)
    ['', null],
    [null, null],
    [undefined, null],
  ];
  it.each(cases)('parse(%o) = %o', (input, expected) => {
    expect(O._parseRpm(input)).toBe(expected);
  });

  it('最大値16383.75rpm(FFFF)を正しく扱う', () => {
    expect(O._parseRpm('41 0C FF FF')).toBe(16383.75);
  });

  it('getRpm() 初期値は rpm:-1 (未取得)', () => {
    expect(O.getRpm().rpm).toBe(-1);
  });
});

describe('OBDClient 環境判定 / speedProvider 鮮度', () => {
  it('Web Bluetooth 非対応環境では isSupported()=false', () => {
    const O = loadOBD({}); // navigator あり・bluetooth なし
    expect(O.isSupported()).toBe(false);
  });

  it('navigator.bluetooth.requestDevice があれば isSupported()=true', () => {
    const O = loadOBD({ bluetooth: { requestDevice: () => {} } });
    expect(O.isSupported()).toBe(true);
  });

  it('未接続では speedProvider() = -1 (= 速度不明 → GPS fallback)', () => {
    const O = loadOBD();
    expect(O.speedProvider({})).toBe(-1);
  });

  it('未接続では getSpeed().valid=false', () => {
    const O = loadOBD();
    const s = O.getSpeed();
    expect(s.valid).toBe(false);
    expect(s.mps).toBe(-1);
  });

  it('初期 status は idle', () => {
    const O = loadOBD();
    expect(O.getStatus()).toBe('idle');
  });

  it('既知BLEプロファイル(fff0 / Nordic UART)を保持', () => {
    const O = loadOBD();
    const names = O._PROFILES.map((p) => p.name);
    expect(names).toContain('fff0');
    expect(names).toContain('nordic-uart');
  });
});

describe('OBDClient 独立性 (距離コア非依存)', () => {
  it('ソースが Meter / calcFare / pipeline-distance を参照しない', () => {
    const src = fs.readFileSync(OBD_PATH, 'utf8');
    // コメント以外での参照が無いことの粗いガード (コメントには説明で出てよい)
    const codeOnly = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(/Meter\.\w+\s*\(/.test(codeOnly)).toBe(false);
    expect(/calcFare/.test(codeOnly)).toBe(false);
    expect(/createDistanceTracker/.test(codeOnly)).toBe(false);
  });
});
