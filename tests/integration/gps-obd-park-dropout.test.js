'use strict';
// tests/integration/gps-obd-park-dropout.test.js
// ★OBDメイン切断時の停車保険 回帰テスト (2026-07-25・実機報告 私有地でメーター暴走 根治)★
//   実機報告: OBDで測ってて OBDが切れた瞬間、広い私有地でGPSがゴミDoppler速度を出しメーター暴走。
//   修正(gps.js onPosition): OBDが「停車」と言った直後に切れたら、GPS点の速度を0にして距離を足さない。
//     車が実際に動いたら(park起点から一定距離)解除してGPSに任せる。
//   本テストは ★実 gps.js を node で駆動★ し、worker へ送られる speedKmh を直接採点する
//   (自己参照でなく実コードを回す)。navigator/Worker/OBDClient をモックし onPosition を叩く。
//   ★不可侵: OBD未接続(OBD_DRIVE_DISTANCE OFF)では完全不発=GPS単独端末は1byte不変★。

// vitest/jest 両対応の最小ハーネス。gps.js は module.exports = GPS を持つ(node test 用)。
function setupGpsModule() {
  let CLOCK = 1700000000000;
  const posted = [];
  const __obd = { kmh: 0, valid: true };
  const g = globalThis;
  g.__CLOCK = () => CLOCK;
  g.__advance = (ms) => {
    CLOCK += ms;
  };
  g.__setObd = (kmh, valid) => {
    __obd.kmh = kmh;
    __obd.valid = valid;
  };
  const RealDate = Date;
  // Date.now だけ制御 (new Date() は本物を維持)
  g.Date = class extends RealDate {
    static now() {
      return CLOCK;
    }
  };
  g.Worker = class {
    postMessage(m) {
      if (m && m.type === 'position') posted.push(m.data);
    }
    set onmessage(_) {}
    set onerror(_) {}
    terminate() {}
    addEventListener() {}
  };
  let onPos = null;
  Object.defineProperty(g, 'navigator', {
    value: {
      userAgent: 'node',
      geolocation: {
        watchPosition: (cb) => ((onPos = cb), 1),
        clearWatch: () => {},
        getCurrentPosition: () => {},
      },
    },
    configurable: true,
    writable: true,
  });
  g.window = g;
  g.self = g;
  g.alert = () => {};
  g.document = { addEventListener() {}, getElementById: () => null };
  g.KalmanGPS = class {};
  g.RoadDecoder = class {};
  g.setInterval = () => 0;
  g.clearInterval = () => {};
  g.setTimeout = () => 0;
  g.clearTimeout = () => {};
  g.dlog = () => {};
  g.DEBUG = { enabled: false };
  g.showToast = () => {};
  g.FB = {};
  g.Meter = {};
  g.OBD_DRIVE_DISTANCE = true;
  g.OBDClient = {
    getSpeed: () => ({
      kmh: __obd.kmh,
      mps: __obd.kmh / 3.6,
      valid: __obd.valid,
      ageMs: 0,
      ts: CLOCK,
    }),
  };

  delete require.cache[require.resolve('../../js/gps.js')];
  const GPS = require('../../js/gps.js');
  try {
    GPS.start();
  } catch (_) {
    /* 一部依存の例外は onPosition 捕捉に影響しない */
  }
  return { GPS, posted, getOnPos: () => onPos };
}

function feed(onPos, lat, lng, speedMps) {
  globalThis.__advance(1000);
  onPos({
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy: 5,
      speed: speedMps,
      heading: 0,
      altitude: 0,
    },
    timestamp: globalThis.__CLOCK(),
  });
}
function jit(i, amp, lat) {
  return [
    (amp / 111320) * Math.sin(i * 2.3),
    (amp / (111320 * Math.cos(lat * 0.0174533))) * Math.cos(i * 1.7),
  ];
}
const B = [33.84, 132.7656];

describe('OBDメイン切断時の停車保険 (gps.js 実駆動)', () => {
  it('★本命修正: OBD停車→切断中のGPS偽速度(1.0m/s)は worker へ 速度0 で送られる', () => {
    const { posted, getOnPos } = setupGpsModule();
    const onPos = getOnPos();
    expect(typeof onPos).toBe('function'); // watchPosition 捕捉=onPosition駆動可
    for (let i = 0; i < 8; i++) {
      globalThis.__setObd(30, true);
      feed(onPos, B[0] + i * 0.000075, B[1], 8.3); // OBDメイン走行
    }
    const pL = B[0] + 8 * 0.000075;
    for (let i = 0; i < 4; i++) {
      globalThis.__setObd(0, true);
      feed(onPos, pL, B[1], 0); // 停車(OBD=0)
    }
    const n0 = posted.length;
    for (let i = 0; i < 20; i++) {
      globalThis.__setObd(0, false); // ★OBD切断
      const [dl, dg] = jit(i, 6, B[0]);
      feed(onPos, pL + dl, B[1] + dg, 1.0); // GPS偽速度1.0m/s + ジッタ
    }
    const p3 = posted.slice(n0);
    expect(p3.length).toBeGreaterThan(10);
    const maxSpd = Math.max(...p3.map((d) => d.speedKmh), 0);
    expect(maxSpd).toBeLessThan(0.1); // ★偽速度は全て0に抑えられる(距離を足さない)
  });

  it('★過剰抑制なし: OBD走行中に切断→GPS実速度は抑えない(速度が通る)', () => {
    const { posted, getOnPos } = setupGpsModule();
    const onPos = getOnPos();
    for (let i = 0; i < 6; i++) {
      globalThis.__setObd(36, true);
      feed(onPos, B[0] + i * 0.0001, B[1], 10); // OBD走行(36km/h)
    }
    const n0 = posted.length;
    for (let i = 6; i < 16; i++) {
      globalThis.__setObd(0, false); // 走行中にOBD切断(直前OBD=36=非停車)
      feed(onPos, B[0] + i * 0.0001, B[1], 10); // GPS実速度10m/s で進む
    }
    const p = posted.slice(n0);
    const maxSpd = Math.max(...p.map((d) => d.speedKmh), 0);
    expect(maxSpd).toBeGreaterThan(20); // ★直前OBDが走行なら保険は不発=速度が通る(実移動を殺さない)
  });

  it('★解除: OBD停車→切断後 実際に動いたら(park起点から離脱) 速度が復活する', () => {
    const { posted, getOnPos } = setupGpsModule();
    const onPos = getOnPos();
    globalThis.__setObd(20, true);
    feed(onPos, B[0], B[1], 5.5);
    globalThis.__setObd(0, true);
    feed(onPos, B[0], B[1], 0); // 停車
    const n0 = posted.length;
    // OBD切断のまま、北へ実際に走り出す(5m/s=18km/h)。15m超えたら解除される想定。
    for (let i = 1; i <= 12; i++) {
      globalThis.__setObd(0, false);
      feed(onPos, B[0] + i * (5 / 111320), B[1], 5.0); // 5m/tick 北進
    }
    const p = posted.slice(n0);
    const maxSpd = Math.max(...p.map((d) => d.speedKmh), 0);
    expect(maxSpd).toBeGreaterThan(10); // ★離脱後は速度が復活=実走行を計上できる
  });
});
