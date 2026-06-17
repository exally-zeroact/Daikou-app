// tests/unit/obd-wheelspeed-identify.test.js
// ★ABS輪速 端末内識別②③ 検証 (2026-06-15・オフラインでその場で識別)★
//   js/obd-wheelspeed-identify.js = 自動discoveryが集めた捕捉(means×010D)から輪速ID/係数を線形回帰で特定し、
//   高R²・速度帯十分・高分解能 を満たした時だけ確定する確信ゲート。決定論で過大ゼロの砦の手前。
//   ★距離コアには触れない(識別と判定のみ)★。
const ID = require('../../js/obd-wheelspeed-identify.js');
const SEED = require('../../js/obd-wheelspeed-map.js');

// 輪速チャネルを合成: ID内の offset(BE16) に value = (kmh - offsetK)/factor を入れた means を作る
function cap(kmh, opts) {
  const o = opts.offset;
  const factor = opts.factor;
  const offsetK = opts.offsetK || 0;
  const val = Math.round((kmh - offsetK) / factor);
  const means = {};
  // 輪速ID(8バイト): offset に BE16 で val、他は固定/別ID もノイズで置く
  const wheel = new Array(8).fill(0);
  wheel[o] = (val >> 8) & 0xff;
  wheel[o + 1] = val & 0xff;
  means[opts.id] = wheel;
  // 固定の別ID(速度と無関係) = 紛らわしいノイズ
  means['620'] = [0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80];
  return { obd010d: kmh, means: means };
}

describe('ABS輪速 端末内識別 identifyWheelSpeed', () => {
  it('★Toyota風 0xAA(BE16@0・factor0.01・offsetK-67.67)を確定特定+シード一致', () => {
    const opt = { id: '0AA', offset: 0, factor: 0.01, offsetK: -67.67 };
    const caps = [cap(0, opt), cap(20, opt), cap(40, opt), cap(60, opt)];
    const r = ID.identifyWheelSpeed(caps, { seed: SEED });
    expect(r.confirmed).toBe(true);
    expect(r.id).toBe('0AA');
    expect(r.key).toBe('0:BE16');
    expect(r.kmhPerLSB).toBeCloseTo(0.01, 4); // 分解能=factor
    expect(r.intercept).toBeCloseTo(-67.67, 1); // 切片=offsetK
    expect(r.seedMatch).toContain('Toyota');
  });

  it('★捕捉が速度帯不足(2帯のみ)→ 確定しない(insufficient_captures)', () => {
    const opt = { id: '0AA', offset: 0, factor: 0.01 };
    const r = ID.identifyWheelSpeed([cap(20, opt), cap(25, opt)], { seed: SEED });
    expect(r.confirmed).toBe(false);
    expect(r.reason).toBe('insufficient_captures');
  });

  it('★速度と相関しないノイズ(低R²)→ 確定しない(誤ID採用を防ぐ確信ゲート)', () => {
    // byte0 が速度と無相関にバラつく → どの候補も低R² → 確定しない
    const noise = [50, 10, 200, 5];
    const caps = [0, 20, 40, 60].map((kmh, i) => ({
      obd010d: kmh,
      means: { 777: [noise[i], 0, 0, 0] },
    }));
    const r = ID.identifyWheelSpeed(caps, { seed: SEED });
    expect(r.confirmed).toBe(false);
    expect(r.reason).toBe('no_confident_channel');
  });

  it('★未知メーカー(シード非収録)でも高R²の高分解能チャネルがあれば確定(seedMatch=null)', () => {
    const opt = { id: '3C2', offset: 2, factor: 0.03, offsetK: 0 }; // 非シードID
    const caps = [cap(0, opt), cap(20, opt), cap(40, opt), cap(60, opt)];
    const r = ID.identifyWheelSpeed(caps, { seed: SEED });
    expect(r.confirmed).toBe(true);
    expect(r.id).toBe('3C2');
    expect(r.key).toBe('2:BE16');
    expect(r.seedMatch).toBeNull();
  });

  it('★S4: 速度U8(1km/h刻み)+隣バイト定数0 → 偽fine BE16を確定しない(誤った高精度主張を封じる)', () => {
    // byte0=速度(0,20,40,60・slope≈1.0)・隣byte1≡0。BE16@0=byte0*256 はslope≈0.0039で
    // 見かけ高分解能に化けるが、隣の動かないバイトを含むため棄却 → どの候補も確定せず。
    const caps = [0, 20, 40, 60].map((kmh) => ({
      obd010d: kmh,
      means: { 555: [kmh, 0, 0, 0] },
    }));
    const r = ID.identifyWheelSpeed(caps, { seed: SEED });
    expect(r.confirmed).toBe(false);
    expect(r.reason).toBe('no_confident_channel');
  });

  it('★N2: means長差でNaNが出ても誤確定しない(有限値のみ候補化)', () => {
    const opt = { id: '0AA', offset: 0, factor: 0.01, offsetK: -67.67 };
    const caps = [cap(0, opt), cap(20, opt), cap(40, opt), cap(60, opt)];
    caps[1].means['0AA'] = [caps[1].means['0AA'][0]]; // 1捕捉だけ長さ1=他offsetでundefined→NaN
    const r = ID.identifyWheelSpeed(caps, { seed: SEED });
    // NaN候補は棄却されクラッシュしない(確定 or 未確定どちらでも可・例外を出さないことが要点)
    expect(typeof r.confirmed).toBe('boolean');
  });

  it('★全部固定(動くバイトなし)→ 確定しない', () => {
    const caps = [0, 20, 40].map((kmh) => ({
      obd010d: kmh,
      means: { 620: [1, 2, 3, 4] },
    }));
    const r = ID.identifyWheelSpeed(caps, { seed: SEED });
    expect(r.confirmed).toBe(false);
  });
});

describe('ABS輪速 復元 decodeWheelSpeedKmh', () => {
  it('★確定マッピングで生フレーム→km/h を復元(往復一致)', () => {
    const opt = { id: '0AA', offset: 0, factor: 0.01, offsetK: -67.67 };
    const m = ID.identifyWheelSpeed([cap(0, opt), cap(20, opt), cap(40, opt), cap(60, opt)], {
      seed: SEED,
    });
    // 50km/h のフレームを作って復元
    const val = Math.round((50 - -67.67) / 0.01);
    const frame = { id: '0AA', bytes: [(val >> 8) & 0xff, val & 0xff, 0, 0, 0, 0, 0, 0] };
    expect(ID.decodeWheelSpeedKmh(frame, m)).toBeCloseTo(50, 0);
  });

  it('★ID不一致/未確定/負値クランプ', () => {
    const m = { confirmed: true, id: '0AA', key: '0:BE16', slope: 0.01, intercept: -67.67 };
    expect(ID.decodeWheelSpeedKmh({ id: '111', bytes: [0, 0] }, m)).toBe(-1); // ID違い
    expect(ID.decodeWheelSpeedKmh({ id: '0AA', bytes: [0, 0] }, { confirmed: false })).toBe(-1);
    expect(ID.decodeWheelSpeedKmh({ id: '0AA', bytes: [0, 0] }, m)).toBe(0); // 0*0.01-67.67<0 → 0クランプ
  });

  it('★LE16 復元', () => {
    const m = { confirmed: true, id: '13A', key: '1:LE16', slope: 0.057, intercept: 0 };
    // value = 1000 → LE16 at offset1: bytes[2]=lo, bytes[1]... LE16(o=1)= b[2]*256+b[1]
    // 期待 kmh = 0.057*1000 = 57
    const frame = { id: '13A', bytes: [0, 1000 & 0xff, (1000 >> 8) & 0xff, 0] };
    expect(ID.decodeWheelSpeedKmh(frame, m)).toBeCloseTo(57, 0);
  });
});
