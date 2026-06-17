// tests/unit/obd-abs-wheelspeed.test.js
// ★ABS各輪速モニタ プローブの純パーサ検証 (2026-06-15・測定前精度レバー)★
//   obd-client.js の _parseMonitorFrames / _summarizeFrames はブラウザBLEで取れたATMA生出力を
//   オフライン解析にかける前段。実機の前にパース仕様(空白あり/なし・雑音行除外)を固定する。
//   ★read-only プローブの純関数のみ・距離コアには一切触れない★。
require('../../js/obd-client.js');
const OBD = global.OBDClient;

describe('ABS輪速モニタ: _parseMonitorFrames (ATMA出力 → CANフレーム)', () => {
  it('★空白あり(ATH1+ATS1): "<ID> <byte>..." を正しく分解', () => {
    const raw = ['1C4 00 50 00 50 00 50 00 50', '0B4 00 00 12 34 56 78 9A BC', '224 10 20'].join(
      '\r\n'
    );
    const f = OBD._parseMonitorFrames(raw);
    expect(f.length).toBe(3);
    expect(f[0]).toEqual({ id: '1C4', bytes: [0x00, 0x50, 0x00, 0x50, 0x00, 0x50, 0x00, 0x50] });
    expect(f[1].id).toBe('0B4');
    expect(f[1].bytes.length).toBe(8);
    expect(f[2]).toEqual({ id: '224', bytes: [0x10, 0x20] });
  });

  it('★雑音行(BUFFER FULL / STOPPED / ATMA echo / プロンプト)は除外', () => {
    const raw = ['ATMA', '1C4 00 50 00 50 00 50 00 50', 'BUFFER FULL', 'STOPPED', '>'].join('\r\n');
    const f = OBD._parseMonitorFrames(raw);
    expect(f.length).toBe(1);
    expect(f[0].id).toBe('1C4');
  });

  it('★空白なし(ATS0個体) fallback: 11bit 先頭3桁=ID・残り2hexずつ', () => {
    const f = OBD._parseMonitorFrames('1C40050005000500050'); // 1C4 + 8データバイト(00 50 ×4)
    expect(f.length).toBe(1);
    expect(f[0].id).toBe('1C4');
    expect(f[0].bytes).toEqual([0x00, 0x50, 0x00, 0x50, 0x00, 0x50, 0x00, 0x50]);
  });

  it('★不正hex/短すぎる行は捨てる(クラッシュしない)', () => {
    expect(OBD._parseMonitorFrames('')).toEqual([]);
    expect(OBD._parseMonitorFrames(null)).toEqual([]);
    expect(OBD._parseMonitorFrames('ZZZ GG HH')).toEqual([]);
    expect(OBD._parseMonitorFrames('1C4')).toEqual([]); // IDのみ・データなし
  });

  it('★29bit(8桁ID)空白ありも受理', () => {
    const f = OBD._parseMonitorFrames('18FEF100 FF FF FF 64 FF FF FF FF');
    expect(f.length).toBe(1);
    expect(f[0].id).toBe('18FEF100');
    expect(f[0].bytes[3]).toBe(0x64);
  });
});

describe('ABS輪速モニタ: _summarizeFrames (ID別あたり付け)', () => {
  it('★ID別に出現数と「変化したバイト位置」を要約(動くバイト=速度候補)', () => {
    // 1C4: byte1 が 50→52→54 と変化(速度候補) / 224: 全バイト固定
    const frames = OBD._parseMonitorFrames(
      [
        '1C4 00 50 00 00',
        '1C4 00 52 00 00',
        '1C4 00 54 00 00',
        '224 10 20 30 40',
        '224 10 20 30 40',
      ].join('\r\n')
    );
    const s = OBD._summarizeFrames(frames);
    const a = s.find((x) => x.id === '1C4');
    const b = s.find((x) => x.id === '224');
    expect(a.count).toBe(3);
    expect(a.changingBytes[1]).toBe(3); // byte1 に 3 種の値 → 動いてる(速度候補)
    expect(a.changingBytes[0]).toBe(1); // byte0 は固定
    expect(b.changingBytes.every((n) => n === 1)).toBe(true); // 224 は全固定
  });

  it('★出現数の多い順にソート', () => {
    const frames = OBD._parseMonitorFrames(
      ['AAA 01', 'BBB 01', 'BBB 02', 'BBB 03', 'CCC 01', 'CCC 02'].join('\r\n')
    );
    const s = OBD._summarizeFrames(frames);
    expect(s[0].id).toBe('BBB'); // 3回で先頭
  });
});

describe('ABS輪速 自動discovery 判定 (_wsCaptureDecision・ユーザー操作ゼロ)', () => {
  const base = {
    enabled: true,
    caps: 0,
    bins: 0,
    lastTs: 0,
    now: 100000,
    speedKmh: 30,
    minGapMs: 45000,
    maxCaps: 8,
    minBins: 4,
    minSpeed: 8, // ★S5: 停車/極低速は撃たない閾値★
  };
  it('★条件OK(有効・未収集・速度あり・初回)→ 撃つ', () => {
    expect(OBD._wsCaptureDecision({ ...base })).toBe(true);
  });
  it('★無効化(enabled=false)→ 撃たない(運転中に勝手に止まる)', () => {
    expect(OBD._wsCaptureDecision({ ...base, enabled: false })).toBe(false);
  });
  it('★十分集めた(caps≥maxCaps)→ 終了', () => {
    expect(OBD._wsCaptureDecision({ ...base, caps: 8 })).toBe(false);
  });
  it('★速度帯が散った(bins≥minBins)→ 終了', () => {
    expect(OBD._wsCaptureDecision({ ...base, bins: 4 })).toBe(false);
  });
  it('★速度不明(010D未取得 speedKmh<0)→ 撃たない', () => {
    expect(OBD._wsCaptureDecision({ ...base, speedKmh: -1 })).toBe(false);
  });
  it('★間隔が空いてない(now-lastTs<minGap)→ 撃たない / 空いたら撃つ', () => {
    expect(OBD._wsCaptureDecision({ ...base, lastTs: 100000 - 10000 })).toBe(false); // 10s前=早い
    expect(OBD._wsCaptureDecision({ ...base, lastTs: 100000 - 50000 })).toBe(true); // 50s前=OK
  });
  it('★S5: 停車/極低速(<minSpeed)では撃たない(退化点で回帰汚染+捕捉浪費を回避)', () => {
    expect(OBD._wsCaptureDecision({ ...base, speedKmh: 0 })).toBe(false); // 停車
    expect(OBD._wsCaptureDecision({ ...base, speedKmh: 5 })).toBe(false); // 徐行(8未満)
    expect(OBD._wsCaptureDecision({ ...base, speedKmh: 8 })).toBe(true); // 閾値以上=撃つ
  });
  it('★_speedBin: 20km/h刻みで 0/20/40/60 → 0/1/2/3・負は-1', () => {
    expect(OBD._speedBin(0)).toBe(0);
    expect(OBD._speedBin(25)).toBe(1);
    expect(OBD._speedBin(45)).toBe(2);
    expect(OBD._speedBin(60)).toBe(3);
    expect(OBD._speedBin(-1)).toBe(-1);
  });
});

describe('obd-client 輪速マッピングAPI (端末内識別の保持・距離未配線)', () => {
  it('★applyWheelSpeedMapping: 確定マッピングを受理し getWheelSpeedMapping で返る', () => {
    const m = {
      confirmed: true,
      id: '0AA',
      key: '0:BE16',
      slope: 0.01,
      intercept: -67.67,
      r2: 0.999,
    };
    expect(OBD.applyWheelSpeedMapping(m)).toBe(true);
    expect(OBD.getWheelSpeedMapping()).toEqual(m);
  });
  it('★applyWheelSpeedMapping: 不正(未確定/null/必須欠損)は拒否', () => {
    expect(OBD.applyWheelSpeedMapping({ confirmed: false })).toBe(false);
    expect(OBD.applyWheelSpeedMapping(null)).toBe(false);
    expect(OBD.applyWheelSpeedMapping({ confirmed: true, id: '0AA' })).toBe(false); // key/slope欠損
  });
});
