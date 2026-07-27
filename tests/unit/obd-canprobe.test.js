// tests/unit/obd-canprobe.test.js
// ★CAN見えるかチェック(canBusProbe)の判定器 _classifyCanProbe の単体テスト★
//   司さん「テストできるようにしろ」: モコMG33S(クローンELM327)の停車ATMA生出力から
//   「ブロードキャストが見える=ゲート無し=輪速探索へ進める / ゲート済=OBD経由不可」を
//   即判定する純関数。診断応答ID(7DF/7E0-7EF)は自発でないので除外する。
//   ★read-only・距離計算/課金に一切影響しないことが前提(別テストで未配線を担保)★。

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

describe('_classifyCanProbe — CAN可視性判定', () => {
  const O = loadOBD();

  it('自発ブロードキャストID多数 → broadcast_visible / ok=true(ゲート無し=勝ち筋)', () => {
    const raw = [
      '1C4 00 50 00 50 00 50 00 50',
      '236 12 34 56 78',
      '2DE AA BB CC DD',
      '1A0 00 01 02 03',
      '1C4 00 51 00 51 00 51 00 51',
      '236 12 35 56 78',
    ].join('\r');
    const r = O._classifyCanProbe(raw, 'ISO 15765-4 (CAN 11/500)', 4000);
    expect(r.verdict).toBe('broadcast_visible');
    expect(r.ok).toBe(true);
    expect(r.broadcastIdCount).toBeGreaterThanOrEqual(3);
    expect(r.frameCount).toBeGreaterThan(0);
  });

  it('診断応答ID(7E8)のみ → gated / ok=false(自発ブロードキャスト無し=ゲート済)', () => {
    const raw = ['7E8 06 41 00 BE 3E B8 11', '7E8 06 41 00 BE 3E B8 11'].join('\r');
    const r = O._classifyCanProbe(raw, 'ISO 15765-4 (CAN 11/500)', 4000);
    expect(r.verdict).toBe('gated');
    expect(r.ok).toBe(false);
    expect(r.broadcastIdCount).toBe(0);
  });

  it('BUFFER FULL あり → 見える側(ok=true)。クローンが溢れた=大量トラフィックの証拠', () => {
    const raw = ['1C4 00 50 00 50', 'BUFFER FULL'].join('\r');
    const r = O._classifyCanProbe(raw, 'ISO 15765-4 (CAN 11/500)', 4000);
    expect(r.bufferFull).toBe(true);
    expect(r.ok).toBe(true);
    expect(['broadcast_visible', 'broadcast_likely']).toContain(r.verdict);
  });

  it('BUFFER FULL のみ(ID判別前に溢れた) → broadcast_likely / ok=true', () => {
    const raw = 'BUFFER FULL\rBUFFER FULL';
    const r = O._classifyCanProbe(raw, 'ISO 15765-4 (CAN 11/500)', 4000);
    expect(r.verdict).toBe('broadcast_likely');
    expect(r.ok).toBe(true);
  });

  it('CAN応答なし(空) → no_can / ok=false(K-Line/非対応の可能性)', () => {
    const r = O._classifyCanProbe('', '', 4000);
    expect(r.verdict).toBe('no_can');
    expect(r.ok).toBe(false);
  });

  it('NO DATA のみ・プロトコル空 → no_can / ok=false', () => {
    const r = O._classifyCanProbe('NO DATA\r>', '', 4000);
    expect(r.verdict).toBe('no_can');
    expect(r.ok).toBe(false);
  });

  it('CAN確立済だがフレーム0(静か or 取りこぼし) → quiet_or_gated / ok=false', () => {
    const r = O._classifyCanProbe('>\r>', 'ISO 15765-4 (CAN 11/500)', 4000);
    expect(r.verdict).toBe('quiet_or_gated');
    expect(r.ok).toBe(false);
  });

  it('自発ID少数(1種) → broadcast_weak / ok=true(流れてはいる)', () => {
    const raw = ['026 00 1F 00 1F', '026 00 20 00 20'].join('\r');
    const r = O._classifyCanProbe(raw, 'ISO 15765-4 (CAN 11/500)', 4000);
    expect(r.verdict).toBe('broadcast_weak');
    expect(r.ok).toBe(true);
    expect(r.broadcastIds).toContain('026');
  });

  it('結果オブジェクトの形(trace記録用フィールド)が揃っている', () => {
    const r = O._classifyCanProbe('1C4 00 50\r236 12 34\r2DE AA BB', 'CAN', 3000);
    expect(typeof r.ts).toBe('number');
    expect(r.durationMs).toBe(3000);
    expect(typeof r.reason).toBe('string');
    expect(Array.isArray(r.distinctIds)).toBe(true);
    expect(Array.isArray(r.topIds)).toBe(true);
    expect(typeof r.rawSample).toBe('string');
  });

  it('canBusProbe / _classifyCanProbe が公開APIに存在する', () => {
    expect(typeof O.canBusProbe).toBe('function');
    expect(typeof O._classifyCanProbe).toBe('function');
  });
});
