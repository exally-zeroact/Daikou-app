// tests/unit/obd-wheelspeed-map.test.js
// ★ABS輪速 CANシード表 検証 (2026-06-16・opendbc網羅抽出・出典付き)★
//   js/obd-wheelspeed-map.js は撃った生CAN IDを既知の輪速ID(opendbc verbatim)に照合する参照データ。
//   ★read-only・距離コアには触れない★。値の正しさ(出典どおり)と逆引き・バリアントを固定する。
const SEED = require('../../js/obd-wheelspeed-map.js');

describe('ABS輪速 CANシード表 (網羅・バリアント)', () => {
  it('★事前シード可能メーカー(verbatim確認・Hyundai/Kia追加)', () => {
    const makers = SEED.listSeedableMakers();
    ['Toyota', 'Lexus', 'Honda', 'Acura', 'Nissan', 'Subaru', 'Mazda', 'Hyundai', 'Kia'].forEach(
      (m) => expect(makers).toContain(m)
    );
  });

  it('★Toyota 0xAA → factor 0.01・BE・★15bit非整列(bitStarts)★(2026-06-16訂正)', () => {
    const s = SEED.lookupById('0AA');
    expect(s).toBeTruthy();
    expect(s.makers).toContain('Toyota');
    expect(s.factor).toBe(0.01);
    expect(s.endian).toBe('BE');
    expect(s.lenBits).toBe(15); // ★旧16bitは誤り→15bitに訂正★
    expect(s.resolutionKmhPerLsb).toBe(0.01);
  });

  it('★Honda 0x1D0 → 0.01・BE・15bit', () => {
    const s = SEED.lookupById('1D0');
    expect(s.makers).toContain('Honda');
    expect(s.factor).toBe(0.01);
    expect(s.lenBits).toBe(15);
  });

  it('★Nissan: FRONT車種別(0x284 Leaf/0x29A X-Trail)+REAR共通0x285・全て0.005(最も細かい)', () => {
    expect(SEED.lookupById('284').factor).toBe(0.005);
    expect(SEED.lookupById('29A').factor).toBe(0.005);
    expect(SEED.lookupById('285').factor).toBe(0.005);
    expect(SEED.lookupById('285').makers).toContain('Nissan');
  });

  it('★Subaru: Global 0x13A(LE 0.057) と pre-global 0x0D4(LE 0.0592) の2バリアント', () => {
    expect(SEED.lookupById('13A').endian).toBe('LE');
    expect(SEED.lookupById('13A').factor).toBe(0.057);
    expect(SEED.lookupById('0D4').factor).toBe(0.0592); // ★新規・verbatim確定★
    expect(SEED.lookupById('0D4').makers).toContain('Subaru');
  });

  it('★Mazda は車種別2ID(0x215 / 0x1C)とも引ける(BE 0.01 offset-100)', () => {
    expect(SEED.lookupById('215').makers).toContain('Mazda');
    expect(SEED.lookupById('01C').makers).toContain('Mazda'); // 0x1C は3桁正規化で 01C
    expect(SEED.lookupById('215').offsetK).toBe(-100);
  });

  it('★Hyundai/Kia classic 0x386 → 0.03125 LE(新規・輸入車補足)', () => {
    const s = SEED.lookupById('386');
    expect(s.makers).toContain('Hyundai');
    expect(s.makers).toContain('Kia');
    expect(s.factor).toBe(0.03125);
    expect(s.endian).toBe('LE');
  });

  it('★Hyundai CAN-FD 0x0A0 は ELM327非対応→シード照合から除外(null)', () => {
    expect(SEED.lookupById('0A0')).toBeNull();
  });

  it('★ID正規化: 0x接頭辞/小文字/桁不足を3桁hexへ揃えて逆引き', () => {
    expect(SEED.lookupById('0x1d0').makers).toContain('Honda');
    expect(SEED.lookupById('1d0').makers).toContain('Honda');
  });

  it('★未収録(架空ID)は null = 010Dフォールバック', () => {
    expect(SEED.lookupById('7FF')).toBeNull();
    expect(SEED.lookupById('000')).toBeNull();
    expect(SEED.lookupById('zzz')).toBeNull();
  });

  it('★PROBE_ONLY群(Suzuki/Daihatsu/Mitsubishi/Infiniti)は seedable=false', () => {
    expect(SEED.WHEELSPEED_SEED.PROBE_ONLY.seedable).toBe(false);
    ['Suzuki', 'Daihatsu', 'Mitsubishi', 'Infiniti'].forEach((m) =>
      expect(SEED.WHEELSPEED_SEED.PROBE_ONLY.makers).toContain(m)
    );
  });

  it('★seededIds: 読めるIDのみ列挙(CAN-FD 0A0 は含まない)', () => {
    const ids = SEED.seededIds();
    expect(ids).toContain('0AA');
    expect(ids).toContain('386');
    expect(ids).not.toContain('0A0'); // ELM327非対応は除外
  });
});

describe('OEMリバッジ解決 resolveBuilder (バッジ≠製造元)', () => {
  it('★日産モコ(型式MG33S)→ 実製造元スズキ・discovery(seed無し)・バッジに騙されない', () => {
    const r = SEED.resolveBuilder('日産', 'モコ', 'MG33S');
    expect(r.builder).toBe('SUZUKI');
    expect(r.layer).toBe('discovery');
    expect(r.seedGroup).toBeNull(); // ★日産シードを当てない(中身スズキ)★
  });

  it('★トヨタ ルーミー → 実製造元ダイハツ・discovery・★0xAA第一候補(未検証)★', () => {
    const r = SEED.resolveBuilder('トヨタ', 'ルーミー', '');
    expect(r.builder).toBe('DAIHATSU');
    expect(r.layer).toBe('discovery');
    expect(r.seedGroup).toBeNull(); // 自動採用しない
    expect(r.probeFirst).toBe('0AA'); // 最初に試す候補だけ
  });

  it('★日産デイズ → 実体は三菱(NMKV)・discovery(日産シードを当てない)', () => {
    const r = SEED.resolveBuilder('Nissan', 'Dayz', 'B44W');
    expect(r.builder).toBe('MITSUBISHI');
    expect(r.layer).toBe('discovery');
    expect(r.seedGroup).toBeNull();
  });

  it('★トヨタ GR86 → 実製造元スバル・hypothesis・スバル0x13Aで読める見込み(要プローブ)', () => {
    const r = SEED.resolveBuilder('Toyota', 'GR86', 'ZN8');
    expect(r.builder).toBe('SUBARU');
    expect(r.layer).toBe('hypothesis');
    expect(r.seedGroup).toBe('SUBARU');
    expect(r.probeFirst).toBe('13A');
  });

  it('★純正トヨタ(リバッジ表に無い)→ 自社製=verified・トヨタseed', () => {
    const r = SEED.resolveBuilder('トヨタ', 'カローラ', '');
    expect(r.builder).toBe('TOYOTA');
    expect(r.layer).toBe('verified');
    expect(r.seedGroup).toBe('TOYOTA');
    expect(r.probeFirst).toBe('0AA');
  });

  it('★純正ホンダ軽(N-BOX)→ 自社製=verified・ホンダseed(軽で唯一verified)', () => {
    const r = SEED.resolveBuilder('Honda', 'N-BOX', '');
    expect(r.builder).toBe('HONDA');
    expect(r.layer).toBe('verified');
    expect(r.seedGroup).toBe('HONDA');
  });

  it('★非seedメーカー自社車(スズキ ワゴンR)→ discovery・seed無し', () => {
    const r = SEED.resolveBuilder('スズキ', 'ワゴンR', '');
    expect(r.builder).toBe('SUZUKI');
    expect(r.layer).toBe('discovery');
    expect(r.seedGroup).toBeNull();
  });

  it('★型式優先: モデル名が空でも型式MG33Sでスズキ解決', () => {
    const r = SEED.resolveBuilder('日産', '', 'MG33S');
    expect(r.builder).toBe('SUZUKI');
  });

  it('★ヌル安全: 全部空でもクラッシュしない', () => {
    const r = SEED.resolveBuilder('', '', '');
    expect(r).toBeTruthy();
    expect(typeof r.layer).toBe('string');
  });
});
