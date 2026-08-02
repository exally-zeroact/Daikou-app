'use strict';
// ============================================================
// ★「11本走った」の判定そのものが甘くないこと 2026-08-03★
//
//   前回の事故は「success だから緑」で見逃した。実際は
//   ★5本は実行にすら至っていなかった★（20分で打ち切られたため）。
//   だから判定は「結末が success か」ではなく
//   ★1本ずつ、実際に走ったか★ を見る。
//   skipped も cancelled も「走っていない」に数える。
// ============================================================
let G;
beforeAll(async () => {
  G = await import('../../scripts/gate-run-report.mjs');
});

const job = (name, conclusion) => ({ name, conclusion, status: 'completed' });

describe('★走っていないゲートを見逃さないこと★', () => {
  it('11本そろって success なら OK', async () => {
    const jobs = G.EXPECTED_GATES.map((g) => job(g, 'success'));
    const { notRun } = G.judge(jobs, G.EXPECTED_GATES);
    expect(notRun).toEqual([]);
  });

  it('★cancelled は「走った」に数えない（前回すり抜けた形）★', async () => {
    const jobs = G.EXPECTED_GATES.map((g, i) => job(g, i === 3 ? 'cancelled' : 'success'));
    const { notRun } = G.judge(jobs, G.EXPECTED_GATES);
    expect(notRun.length).toBe(1);
    expect(notRun[0].gate).toBe(G.EXPECTED_GATES[3]);
  });

  it('★skipped も「走った」に数えない★', async () => {
    const jobs = G.EXPECTED_GATES.map((g, i) => job(g, i === 0 ? 'skipped' : 'success'));
    const { notRun } = G.judge(jobs, G.EXPECTED_GATES);
    expect(notRun.map((r) => r.gate)).toEqual([G.EXPECTED_GATES[0]]);
  });

  it('★ジョブが1本も無いゲートは当然「走っていない」★（前回の5本がこの形）', async () => {
    const jobs = G.EXPECTED_GATES.slice(0, 6).map((g) => job(g, 'success'));
    const { notRun } = G.judge(jobs, G.EXPECTED_GATES);
    expect(notRun.length).toBe(5);
    expect(notRun.every((r) => r.conclusion === '（ジョブが無い）')).toBe(true);
  });

  it('failure は「走った」に数える（赤は赤で別に分かる）', async () => {
    const jobs = G.EXPECTED_GATES.map((g, i) => job(g, i === 2 ? 'failure' : 'success'));
    const { notRun } = G.judge(jobs, G.EXPECTED_GATES);
    expect(notRun).toEqual([]);
  });
});

// ============================================================
// ★2026-08-03 自分の道具が甘かった（実際に誤報した）★
//   最初の版は「走ったか」しか見ておらず、
//   ★11本すべて走りました／終了コード0★ と報告した。
//   実際には4本落ちていた（device-spread / tunnel-continuity / bg-freeze / gnss-degraded）。
//   原因: cert-gate はその4本を soft(continue-on-error) にしており、
//   ★continue-on-error は落ちても GitHub の API 上 success に見せる★。
//   ＝「success だから緑」の一段深い版。結末ではなくログを見るしかない。
// ============================================================
describe('★soft で隠れている失敗を見逃さないこと★', () => {
  const LOG_FAIL = [
    'device-spread\t2026-08-02T18:46:00Z > node tests/gate-realdevice-spread.js',
    "device-spread\t2026-08-02T18:46:01Z Error: Cannot find module 'tests/gate-realdevice-spread.js'",
    'device-spread\t2026-08-02T18:46:01Z ##[error]Process completed with exit code 1.',
    'sim-cert\t2026-08-02T18:46:02Z すべて通りました',
  ].join('\n');

  it('★continue-on-error で success に見えていても、ログが落ちていれば「落ちた」と出す★', async () => {
    const jobs = G.EXPECTED_GATES.map((g) => job(g, 'success'));
    const { hiddenFail, notRun } = G.judge(jobs, G.EXPECTED_GATES, LOG_FAIL);
    expect(notRun).toEqual([]); // 走ってはいる
    expect(hiddenFail.map((r) => r.gate)).toEqual(['device-spread']);
  });

  it('落ちていないゲートは「通った」のまま', async () => {
    const jobs = G.EXPECTED_GATES.map((g) => job(g, 'success'));
    const { hiddenFail } = G.judge(jobs, G.EXPECTED_GATES, 'ぜんぶ順調\n');
    expect(hiddenFail).toEqual([]);
  });

  it('★ログが取れない時は「通った」と言わない★（分からないを緑にしない）', async () => {
    const jobs = G.EXPECTED_GATES.map((g) => job(g, 'success'));
    const { unknown } = G.judge(jobs, G.EXPECTED_GATES, null);
    expect(unknown.length).toBe(G.EXPECTED_GATES.length);
  });

  it('exit code 0 の行は失敗と見なさない', async () => {
    const log = 'sim-cert\t##[error]Process completed with exit code 0.';
    expect(G.failedFromLog(log, 'sim-cert')).toBe(false);
  });
});

describe('★見張る本数が減っていないこと★', () => {
  it('ゲートは11本', () => {
    expect(G.EXPECTED_GATES.length).toBe(11);
  });

  it('cert-gate.yml に書かれているゲート名と一致する', () => {
    const fs = require('fs');
    const path = require('path');
    const t = fs.readFileSync(
      path.resolve(__dirname, '..', '..', '.github', 'workflows', 'cert-gate.yml'),
      'utf8'
    );
    const names = Array.from(t.matchAll(/^\s*- name:\s*([\w-]+)\s*$/gm)).map((m) => m[1]);
    G.EXPECTED_GATES.forEach((g) => {
      expect(names, `${g} が cert-gate.yml に無い`).toContain(g);
    });
  });
});
