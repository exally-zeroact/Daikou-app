// tests/unit/obd-canwheel.test.js
// ★CAN輪速メーター(1B8連続積分)の純関数テスト★
//   モコMG33S実測=ID1B8 バイト0-1 BE が車輪速(r=0.997・約40カウント/km/h)。
//   _decodeCanWheelKmh: BE/LE 16bit デコード。_cwIntegrateStep: dt積分(断絶保護)。
//   ★read-only・距離計算(distance_m)/課金に未配線(検証専用の並行距離)であることが前提★。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const OBD_PATH = path.join(__dirname, '..', '..', 'js', 'obd-client.js');

function loadOBD() {
  const src = fs.readFileSync(OBD_PATH, 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    clearInterval,
    setInterval,
    Date,
    Promise,
    Uint8Array,
    Number,
    Math,
    JSON,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'obd-client.js' });
  return sandbox.OBDClient;
}

describe('_decodeCanWheelKmh — CAN輪速デコード', () => {
  const O = loadOBD();
  const cfg = { id: '1B8', off: 0, endian: 'BE', scale: 40 };

  it('BE 16bit / scale40: 291→約7.3km/h(010Dの丸め前=8km/hより細かい)', () => {
    // 291 = 0x0123 → bytes [0x01, 0x23]
    const kmh = O._decodeCanWheelKmh([0x01, 0x23, 0, 0], cfg);
    expect(kmh).toBeCloseTo(291 / 40, 2);
  });

  it('実測サンプル: 1440 → 36km/h(040Dと一致域)', () => {
    // 1440 = 0x05A0 → [0x05,0xA0]
    expect(O._decodeCanWheelKmh([0x05, 0xa0, 0, 0], cfg)).toBeCloseTo(36, 1);
  });

  it('LE指定なら逆バイト順', () => {
    const le = { id: '1B8', off: 0, endian: 'LE', scale: 40 };
    // bytes [0x23,0x01] LE = 0x0123 = 291
    expect(O._decodeCanWheelKmh([0x23, 0x01], le)).toBeCloseTo(291 / 40, 2);
  });

  it('off指定でバイト位置をずらせる', () => {
    const c2 = { id: '1B8', off: 2, endian: 'BE', scale: 40 };
    expect(O._decodeCanWheelKmh([0, 0, 0x05, 0xa0], c2)).toBeCloseTo(36, 1);
  });

  it('バイト不足/不正は -1', () => {
    expect(O._decodeCanWheelKmh([0x05], cfg)).toBe(-1);
    expect(O._decodeCanWheelKmh(null, cfg)).toBe(-1);
  });
});

describe('_cwIntegrateStep — dt積分(断絶保護)', () => {
  const O = loadOBD();

  it('初回(lastT=0)は距離を積まずlastT確定', () => {
    const s = O._cwIntegrateStep({ distM: 0, lastT: 0 }, 36, 1000, 2.0);
    expect(s.distM).toBe(0);
    expect(s.lastT).toBe(1000);
  });

  it('36km/h を 1秒積分 = 10m(=36/3.6)', () => {
    const s = O._cwIntegrateStep({ distM: 0, lastT: 1000 }, 36, 2000, 2.0);
    expect(s.distM).toBeCloseTo(10, 3);
    expect(s.lastT).toBe(2000);
  });

  it('dt>maxDtS(断絶)は加算しない=暴走保護', () => {
    const s = O._cwIntegrateStep({ distM: 5, lastT: 1000 }, 36, 1000 + 5000, 2.0);
    expect(s.distM).toBe(5); // 5秒ギャップ→加算ゼロ
    expect(s.lastT).toBe(6000);
  });

  it('負の速度(デコード失敗)は加算しない', () => {
    const s = O._cwIntegrateStep({ distM: 5, lastT: 1000 }, -1, 2000, 2.0);
    expect(s.distM).toBe(5);
  });

  it('累積: 10km/h×1s + 20km/h×1s = 約8.33m', () => {
    let s = { distM: 0, lastT: 1000 };
    s = O._cwIntegrateStep(s, 10, 2000, 2.0); // +10/3.6=2.78
    s = O._cwIntegrateStep(s, 20, 3000, 2.0); // +20/3.6=5.56
    expect(s.distM).toBeCloseTo(10 / 3.6 + 20 / 3.6, 2);
  });
});

describe('_cwWindowSpeed — バースト窓の中央値速度(ストール判定つき)', () => {
  const O = loadOBD();
  const cfg = { id: '1B8', off: 0, endian: 'BE', scale: 40 };
  function f(id, hi, lo) {
    return { id: id, bytes: [hi, lo, 0, 0] };
  }

  it('対象IDの複数フレーム→中央値km/h・n返す(先頭2破棄)', () => {
    // 1440=0x05A0=36km/h を5フレーム(先頭2破棄でも残3)
    const frames = [
      f('1B8', 0x05, 0xa0),
      f('1B8', 0x05, 0xa0),
      f('1B8', 0x05, 0xa0),
      f('1B8', 0x05, 0xa0),
      f('1B8', 0x05, 0xa0),
    ];
    const w = O._cwWindowSpeed(frames, cfg);
    expect(w.kmh).toBeCloseTo(36, 1);
    expect(w.n).toBe(3); // 先頭2破棄
  });

  it('スパイク1個は中央値で無視される', () => {
    // 36,36,36,36,9999(スパイク) → 中央値36付近
    const frames = [
      f('1B8', 0x05, 0xa0),
      f('1B8', 0x05, 0xa0),
      f('1B8', 0x05, 0xa0),
      f('1B8', 0x05, 0xa0),
      f('1B8', 0xff, 0xff),
    ];
    const w = O._cwWindowSpeed(frames, cfg);
    expect(w.kmh).toBeCloseTo(36, 0);
  });

  it('対象ID以外は無視', () => {
    const frames = [f('120', 0x05, 0xa0), f('136', 0x01, 0x00), f('1D0', 0x02, 0x00)];
    const w = O._cwWindowSpeed(frames, cfg);
    expect(w.kmh).toBe(-1);
    expect(w.n).toBe(0);
  });

  it('空フレームは -1', () => {
    expect(O._cwWindowSpeed([], cfg).kmh).toBe(-1);
  });
});

describe('CAN輪速メーター 公開API・初期状態', () => {
  const O = loadOBD();
  it('start/stop/get/config が公開されている', () => {
    expect(typeof O.startCanWheelMeter).toBe('function');
    expect(typeof O.stopCanWheelMeter).toBe('function');
    expect(typeof O.getCanWheelMeter).toBe('function');
    expect(typeof O.configCanWheel).toBe('function');
  });
  it('初期は on=false・距離0・モコ既定ID 1B8', () => {
    const m = O.getCanWheelMeter();
    expect(m.on).toBe(false);
    expect(m.distM).toBe(0);
    expect(m.id).toBe('1B8');
  });
  it('未接続では start が reject(距離経路に触れない)', async () => {
    await expect(O.startCanWheelMeter()).rejects.toThrow();
  });
  it('configCanWheel でID/スケール変更が反映', () => {
    const c = O.configCanWheel({ id: '2c0', off: 2, endian: 'LE', scale: 100 });
    expect(c.id).toBe('2C0');
    expect(c.off).toBe(2);
    expect(c.endian).toBe('LE');
    expect(c.scale).toBe(100);
  });
});
