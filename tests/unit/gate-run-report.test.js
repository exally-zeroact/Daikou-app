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
