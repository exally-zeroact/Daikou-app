// tests/replay-mm-worker/eruda-trace-parser.test.js
// Eruda trace parser の単体テスト (= 実機 log からの構造化 + 自動 assessment が機能する事の固定)
'use strict';

const { parseEvents, summarize, assess, analyze } = require('./eruda-trace-parser');

describe('eruda-trace-parser: STEP0 診断ログから構造化 + 自動 assessment', () => {
  it('parseEvents: [GPSDBG] / [GPSREJ] / [MMDBG] / [Business] を全部 parse', () => {
    const log = `
12:34:56.001 [GPSDBG] spd=0.0 src=dop acc=5.0 lim=10 stat=T
12:34:56.500 [GPSREJ] reason=accuracy spd=0.1 src=dop acc=15.9 lim=10
12:34:57.001 [MMDBG] src=commit add=10.5m dm=200m tier2=70m
12:34:58.001 [Business] total=0.05 running=false
12:34:58.001 [GPSDBG] spd=3.1 src=hav acc=8.0 lim=20 stat=F
    `;
    const events = parseEvents(log);
    expect(events).toHaveLength(5);
    expect(events[0]).toMatchObject({ type: 'gpsDbg', spd: 0, src: 'dop', stat: true });
    expect(events[1]).toMatchObject({ type: 'gpsRej', reason: 'accuracy', acc: 15.9 });
    expect(events[2]).toMatchObject({ type: 'mmDbg', src: 'commit', add: 10.5, dm: 200 });
    expect(events[3]).toMatchObject({ type: 'business', total: 0.05, running: false });
    expect(events[4]).toMatchObject({ type: 'gpsDbg', spd: 3.1, src: 'hav', stat: false });
  });

  it('summarize: emit/reject 比 + src 分布 + reject 理由 + creep growth を計算', () => {
    const events = parseEvents(`
[GPSDBG] spd=0.0 src=hav acc=5.0 lim=20 stat=T
[GPSDBG] spd=0.0 src=hav acc=5.0 lim=20 stat=T
[GPSDBG] spd=3.1 src=hav acc=8.0 lim=20 stat=F
[GPSREJ] reason=accuracy spd=0.1 src=dop acc=25 lim=20
[Business] total=0.00 running=false
[Business] total=0.03 running=false
[MMDBG] src=commit add=12m dm=200m tier2=70m
    `);
    const s = summarize(events);
    expect(s.emitRatio).toBeCloseTo(0.75, 2); // 3 emit / 4 attempts
    expect(s.statTrueRatio).toBeCloseTo(2 / 3, 2);
    expect(s.rejReasons.accuracy).toBe(1);
    expect(s.srcCounts.hav).toBe(3);
    expect(s.commitAddStats.count).toBe(1);
    expect(s.commitAddStats.max).toBe(12);
    // 空車中 business 0.00→0.03 = 0.03km creep (= 30m)
    expect(s.creepGrowth).toHaveLength(1);
    expect(s.creepGrowth[0].delta_km).toBeCloseTo(0.03, 3);
  });

  it('assess: creep>10m を high severity で検知', () => {
    const events = parseEvents(`
[Business] total=0.000 running=false
[Business] total=0.030 running=false
    `);
    const s = summarize(events);
    const a = assess(s);
    const creepIssue = a.issues.find((i) => i.kind === 'creep');
    expect(creepIssue).toBeDefined();
    expect(creepIssue.severity).toBe('high');
    expect(a.ok).toBe(false);
  });

  it('assess: reject>50% を freeze-risk として検知', () => {
    const events = parseEvents(`
[GPSDBG] spd=0 src=dop acc=5 lim=10 stat=T
[GPSREJ] reason=accuracy spd=0 src=dop acc=15 lim=10
[GPSREJ] reason=accuracy spd=0 src=dop acc=15 lim=10
[GPSREJ] reason=accuracy spd=0 src=dop acc=15 lim=10
    `);
    const s = summarize(events);
    const a = assess(s);
    const freezeIssue = a.issues.find((i) => i.kind === 'freeze-risk');
    expect(freezeIssue).toBeDefined();
  });

  it('assess: commit add 大 (> 50m) を commit-runaway で検知 (= 5Hz over-count 指標)', () => {
    const events = parseEvents(`
[MMDBG] src=commit add=60.5m dm=400m tier2=0m
    `);
    const s = summarize(events);
    const a = assess(s);
    const runawayIssue = a.issues.find((i) => i.kind === 'commit-runaway');
    expect(runawayIssue).toBeDefined();
    expect(a.ok).toBe(false);
  });

  it('analyze: 健全な log (creep=0 / emit OK / commit small) は ok=true', () => {
    const log = `
[GPSDBG] spd=0 src=hav acc=5 lim=20 stat=T
[GPSDBG] spd=0 src=hav acc=5 lim=20 stat=T
[Business] total=0.00 running=false
[Business] total=0.00 running=false
[MMDBG] src=commit add=2m dm=200m tier2=70m
    `;
    const r = analyze(log);
    expect(r.assessment.ok).toBe(true);
    expect(r.assessment.issues.filter((i) => i.severity === 'high')).toHaveLength(0);
  });
});
