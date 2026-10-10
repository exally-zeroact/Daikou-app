'use strict';
// ============================================================
// ★「全部走った」の判定そのものが甘くないこと 2026-08-03（2026-10-10 作り直し）★
//
//   前回の事故は「success だから緑」で見逃した。実際は
//   ★5本は実行にすら至っていなかった★（20分で打ち切られたため）。
//   だから判定は「結末が success か」ではなく
//   ★1本ずつ、実際に走ったか★ を見る。
//   skipped も cancelled も「走っていない」に数える。
//
//   ★2026-10-10★ 期待の11本を決め打ちしていた（matrix は23本）・部分一致で
//   bg-freeze-nagaana を bg-freeze と取り違えていた・別名で呼ぶと exit 0 だった。
//   ＝名簿は その commit の cert-gate.yml から取る・ジョブ名は完全一致・既定は exit 1。
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'gate-run-report.mjs');
const YML = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'cert-gate.yml'), 'utf8');

let G;
let GATES;
beforeAll(async () => {
  G = await import('../../scripts/gate-run-report.mjs');
  GATES = G.gatesFromYml(YML);
});

// 実物の --json jobs と同じ形：ゲートの手順（手順名＝ゲート名）を持つ
//   continue-on-error で落ちた手順も 実物では conclusion=success（2026-10-10 run 38020033782 で確かめた）
const job = (name, conclusion, stepConclusion = conclusion) => ({
  name,
  conclusion,
  status: 'completed',
  steps: [
    { name: 'Set up job', conclusion: 'success' },
    { name, conclusion: stepConclusion },
  ],
});
const result = (conclusion = 'success') => ({ name: 'cert-gate 総合結果', conclusion, steps: [] });
const names = () => GATES.map((g) => g.name);

describe('★名簿は cert-gate.yml から取る（決め打ちしない）★', () => {
  it('★本物の YAML 読み（js-yaml）と 名前も soft も 1本残らず同じ★', () => {
    const yaml = require('js-yaml');
    const want = yaml
      .load(YML)
      .jobs.gate.strategy.matrix.include.map((x) => ({ name: x.name, soft: x.soft === true }));
    expect(want.length).toBeGreaterThan(11); // 11本の決め打ちで 12本を見ていなかった
    expect(GATES).toEqual(want);
  });

  it('括弧つきの表示名も そのまま取る（ジョブ名は ${{ matrix.name }} と同じ字）', () => {
    expect(names().some((n) => n.startsWith('verify-9677（'))).toBe(true);
  });

  it('jobs.gate の外の name: は拾わない（手順名・別のジョブ）', () => {
    const y = [
      'name: cert-gate',
      'jobs:',
      '  gate:',
      '    name: ${{ matrix.name }}',
      '    strategy:',
      '      matrix:',
      '        include:',
      '          # 注記',
      '          - name: a-gate',
      '            cmd: x',
      '            soft: true # 赤で正しい',
      '          - name: b-gate  # 注記',
      '    steps:',
      '      - name: Setup Node',
      '  cert-gate-result:',
      '    name: cert-gate 総合結果',
    ].join('\n');
    expect(G.gatesFromYml(y)).toEqual([
      { name: 'a-gate', soft: true },
      { name: 'b-gate', soft: false },
    ]);
  });

  it('★CRLF でも同じに読む★', () => {
    expect(G.gatesFromYml(YML.replace(/\r?\n/g, '\r\n'))).toEqual(GATES);
  });
});

describe('★yml の割れる形★', () => {
  const head = ['jobs:', '  gate:', '    strategy:', '      matrix:', '        include:'];

  it('★項目の最初の鍵が name でない時は 黙って落とさず 止める★（前は soft を1つ前へ付けた）', () => {
    const y = [
      ...head,
      '          - name: a',
      '            soft: true',
      '          - cmd: x',
      '            name: b',
    ];
    expect(() => G.gatesFromYml(y.join('\n'))).toThrow(/読めません/);
  });

  it('★最初の項目が name で始まらなくても 後ろの steps の name: を拾わない★', () => {
    const y = [
      ...head,
      '          - cmd: x',
      '            name: a',
      '    steps:',
      '      - name: s',
    ];
    expect(() => G.gatesFromYml(y.join('\n'))).toThrow(/読めません/);
  });

  it('引用符つきの名前・- の後の空白の多い形・soft の大文字も 読む', () => {
    const y = [
      ...head,
      "          - name: 'a'",
      '            soft: True',
      '          -   name: "b"',
    ];
    expect(G.gatesFromYml(y.join('\n'))).toEqual([
      { name: 'a', soft: true },
      { name: 'b', soft: false },
    ]);
  });

  it('名前が空の項目は 止める', () => {
    const y = [...head, '          - name:', '            cmd: x'];
    expect(() => G.gatesFromYml(y.join('\n'))).toThrow(/読めません/);
  });
});

describe('★名簿の外と 総合結果も 照らす（組を足した日に 黙って緑にしない）★', () => {
  const okLog = () =>
    names()
      .map((g) => `${g}\tUNKNOWN STEP\tt ok`)
      .join('\n');

  it('全部そろって 総合結果も success なら 名簿の外は0・総合結果は良い', () => {
    const jobs = [...names().map((g) => job(g, 'success')), result()];
    const r = G.judge(jobs, GATES, okLog());
    expect(r.extra).toEqual([]);
    expect(r.resultOk).toBe(true);
  });

  it('★名簿に無いジョブは 結末に関わらず 名簿の外として出す★（別の組 gate-heavy が落ちた・止まった形）', () => {
    const jobs = [
      ...names().map((g) => job(g, 'success')),
      job('heavy1', 'failure'),
      job('heavy2', 'cancelled'),
      result(),
    ];
    expect(G.judge(jobs, GATES, okLog()).extra.map((j) => j.name)).toEqual(['heavy1', 'heavy2']);
  });

  it.each([['failure'], ['cancelled'], ['skipped']])('★総合結果が %s なら 良くない★', (c) => {
    const jobs = [...names().map((g) => job(g, 'success')), result(c)];
    expect(G.judge(jobs, GATES, okLog()).resultOk).toBe(false);
  });

  it('★総合結果のジョブが無い時も 良くない★', () => {
    const jobs = names().map((g) => job(g, 'success'));
    expect(G.judge(jobs, GATES, okLog()).resultOk).toBe(false);
  });
});

describe('★ジョブが走っても ゲートの手順が走っていなければ「走っていない」★', () => {
  const okLog = () =>
    names()
      .map((g) => `${g}\tUNKNOWN STEP\tt Current runner version`)
      .join('\n');

  it.each([['skipped'], ['cancelled'], [null]])('ゲートの手順が %s なら 走っていない', (c) => {
    const jobs = names().map((g, i) => job(g, 'success', i === 4 ? c : 'success'));
    const { notRun } = G.judge(jobs, GATES, okLog());
    expect(notRun.map((r) => r.gate)).toEqual([names()[4]]);
    expect(notRun[0].conclusion).toBe('（ゲートの手順が走っていない）');
  });

  it('★ゲートの手順が steps に無い（セットアップの行しかない）時も 走っていない★', () => {
    const jobs = names().map((g) => job(g, 'success'));
    jobs[5].steps = [{ name: 'Set up job', conclusion: 'success' }];
    const { notRun } = G.judge(jobs, GATES, okLog());
    expect(notRun.map((r) => r.gate)).toEqual([names()[5]]);
  });
});

describe('★走っていないゲートを見逃さないこと★', () => {
  it('全部そろって success なら OK', () => {
    const jobs = names().map((g) => job(g, 'success'));
    const { notRun, failed } = G.judge(jobs, GATES);
    expect(notRun).toEqual([]);
    expect(failed).toEqual([]);
  });

  it('★cancelled は「走った」に数えない（前回すり抜けた形）★', () => {
    const jobs = names().map((g, i) => job(g, i === 3 ? 'cancelled' : 'success'));
    const { notRun } = G.judge(jobs, GATES);
    expect(notRun.map((r) => r.gate)).toEqual([names()[3]]);
  });

  it('★skipped も「走った」に数えない★', () => {
    const jobs = names().map((g, i) => job(g, i === 0 ? 'skipped' : 'success'));
    const { notRun } = G.judge(jobs, GATES);
    expect(notRun.map((r) => r.gate)).toEqual([names()[0]]);
  });

  it('★ジョブが1本も無いゲートは当然「走っていない」★（前回の5本がこの形）', () => {
    const jobs = names()
      .slice(0, 6)
      .map((g) => job(g, 'success'));
    const { notRun } = G.judge(jobs, GATES);
    expect(notRun.length).toBe(GATES.length - 6);
    expect(notRun.every((r) => r.conclusion === '（ジョブが無い）')).toBe(true);
  });

  it('failure は「走った」に数え、「落ちた」にも数える', () => {
    const jobs = names().map((g, i) => job(g, i === 2 ? 'failure' : 'success'));
    const { notRun, failed } = G.judge(jobs, GATES);
    expect(notRun).toEqual([]);
    expect(failed.map((r) => r.gate)).toEqual([names()[2]]);
  });

  it('★同じ名前のジョブが2本ある時は どちらかを選ばず「走っていない」★', () => {
    for (const order of ['後が success', '先が success']) {
      const jobs = names().map((g, i) => job(g, i === 1 ? 'cancelled' : 'success'));
      if (order === '後が success') jobs.push(job(names()[1], 'success'));
      else jobs.unshift(job(names()[1], 'success'));
      const { notRun } = G.judge(jobs, GATES);
      expect(
        notRun.map((r) => r.gate),
        order
      ).toEqual([names()[1]]);
    }
  });
});

describe('★ジョブ名は完全一致（bg-freeze-nagaana を bg-freeze と取り違えない）★', () => {
  it('名簿に 片方がもう片方を含む組が 本当に在る（この試験が飾りでない）', () => {
    expect(names()).toContain('bg-freeze');
    expect(names()).toContain('bg-freeze-nagaana');
  });

  it.each([
    ['nagaana が後', false],
    ['nagaana が先', true],
  ])('★nagaana だけ cancelled なら nagaana だけが走っていない★（%s）', (_, reverse) => {
    const jobs = names().map((g) => job(g, g === 'bg-freeze-nagaana' ? 'cancelled' : 'success'));
    if (reverse) jobs.reverse();
    const { notRun } = G.judge(jobs, GATES);
    expect(notRun.map((r) => r.gate)).toEqual(['bg-freeze-nagaana']);
  });

  it('★ログの赤も 名前の完全一致で 持ち主を決める★', () => {
    const log = [
      'bg-freeze-nagaana\tUNKNOWN STEP\t2026-10-10T03:17:49Z ##[error]Process completed with exit code 1.',
      'bg-freeze\tUNKNOWN STEP\t2026-10-10T03:17:44Z ok',
    ].join('\n');
    expect(G.failedFromLog(log, 'bg-freeze-nagaana')).toBe(true);
    expect(G.failedFromLog(log, 'bg-freeze')).toBe(false);
  });
});

describe('★soft で隠れている失敗を見逃さないこと★', () => {
  // 2026-10-10 の実物の回（run 38020033782）の ##[error] の行と同じ形
  const allOk = (extra) =>
    names()
      .map((g) => `${g}\tstep\tt ok`)
      .concat(extra)
      .join('\n');

  it('★continue-on-error で success に見えていても、ログが落ちていれば「落ちた」と出す★', () => {
    const jobs = names().map((g) => job(g, 'success'));
    const log = allOk([
      'device-spread\tUNKNOWN STEP\tt ##[error]Process completed with exit code 1.',
    ]);
    const { failed, notRun, unknown } = G.judge(jobs, GATES, log);
    expect(notRun).toEqual([]);
    expect(unknown).toEqual([]);
    expect(failed.map((r) => r.gate)).toEqual(['device-spread']);
    expect(failed[0].soft).toBe(true);
  });

  it('落ちていないゲートは「通った」のまま', () => {
    const jobs = names().map((g) => job(g, 'success'));
    const { failed, unknown } = G.judge(jobs, GATES, allOk([]));
    expect(failed).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it('★ログが取れない時は「通った」と言わない★（分からないを緑にしない）', () => {
    const jobs = names().map((g) => job(g, 'success'));
    expect(G.judge(jobs, GATES, null).unknown.length).toBe(GATES.length);
  });

  it('★そのジョブの行がログに1行も無い時も「分からない」★', () => {
    const jobs = names().map((g) => job(g, 'success'));
    const { unknown } = G.judge(jobs, GATES, 'ぜんぶ順調\n');
    expect(unknown.length).toBe(GATES.length);
  });

  it('exit code 0 の行は失敗と見なさない', () => {
    expect(
      G.failedFromLog('sim-cert\tx\t##[error]Process completed with exit code 0.', 'sim-cert')
    ).toBe(false);
  });
});

describe('★呼び方で 黙って exit 0 にならないこと★', () => {
  it('import された時は 走らない（試験の中で gh を叩かない）', () => {
    expect(G.isMainModule()).toBe(false);
  });

  it('自分の本当の場所で呼ばれた時だけ 走る', () => {
    expect(G.isMainModule(SCRIPT)).toBe(true);
    expect(G.isMainModule(path.join(ROOT, 'scripts', 'nai.mjs'))).toBe(false);
  });

  it.each([
    ['sha 無し', []],
    ['sha が字でない', ['--sha', 'main;rm']],
  ])('★%s は 使い方を出して exit 1★（最新の1回を 読みに行かない）', (_, args) => {
    let code = 0;
    let err = '';
    try {
      execFileSync(process.execPath, [SCRIPT, ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (e) {
      code = e.status;
      err = String(e.stderr);
    }
    expect(code).toBe(1);
    expect(err).toContain('使い方');
  });

  it('★別の名前の写しで呼んでも exit 1（前は 何も出さず 0 だった）★', () => {
    // repo の外（OS の一時の場所）に作る＝途中で殺されても repo に残らない
    const copy = path.join(require('os').tmpdir(), `gate-run-report-utsushi-${process.pid}.mjs`);
    fs.copyFileSync(SCRIPT, copy);
    let code = 0;
    try {
      execFileSync(process.execPath, [copy], { cwd: ROOT, stdio: 'pipe' });
    } catch (e) {
      code = e.status;
    } finally {
      fs.unlinkSync(copy);
    }
    expect(code).toBe(1);
  });
});

describe('★再実行の前の attempt も 全部 見る（attempt 2 の緑で attempt 1 の赤を隠さない）★', () => {
  // 試験の中では gh を叩かない＝ attempt ごとの中身を返す 偽の gh を渡す
  const fakeGh = (byAttempt, calls) => (args) => {
    const at = Number(args[args.indexOf('--attempt') + 1]);
    calls.push(at);
    const jobs = byAttempt[at];
    if (args.includes('--json')) return JSON.stringify({ jobs });
    return jobs.map((j) => `${j.name}\tUNKNOWN STEP\tt ok`).join('\n');
  };
  const green = () => [...names().map((g) => job(g, 'success')), result()];
  const red = () => [
    ...names().map((g, i) => job(g, i < 2 ? 'cancelled' : 'success')),
    result('failure'),
  ];
  // 出しは 試験の画面を汚さないよう 黙らせる（vi は この repo の試験では使っていない）
  const keep = {};
  beforeEach(() => {
    keep.log = console.log;
    keep.error = console.error;
    console.log = () => {};
    console.error = () => {};
  });
  afterEach(() => {
    console.log = keep.log;
    console.error = keep.error;
  });

  it('★attempt 1 が赤・attempt 2 が緑なら 赤★（2026-10-10 実物 run 37373880174 の形）', () => {
    const calls = [];
    const bad = G.judgeAllAttempts(
      { databaseId: 1, attempt: 2 },
      [],
      GATES,
      fakeGh({ 1: red(), 2: green() }, calls)
    );
    expect(bad).toBe(true);
    expect([...new Set(calls)]).toEqual([1, 2]);
  });

  it('attempt が1回だけで 緑なら 緑', () => {
    const calls = [];
    expect(
      G.judgeAllAttempts({ databaseId: 1, attempt: 1 }, [], GATES, fakeGh({ 1: green() }, calls))
    ).toBe(false);
    expect([...new Set(calls)]).toEqual([1]);
  });

  it('attempt 3 回とも 緑なら 緑・3回とも読む', () => {
    const calls = [];
    const gh3 = fakeGh({ 1: green(), 2: green(), 3: green() }, calls);
    expect(G.judgeAllAttempts({ databaseId: 1, attempt: 3 }, [], GATES, gh3)).toBe(false);
    expect([...new Set(calls)]).toEqual([1, 2, 3]);
  });
});
