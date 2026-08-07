'use strict';
// ============================================================
// ★総走行距離が 0.00 で固まらないこと★ 2026-08-08
//
//   ★司さんの報告★
//     「1台だけ 総走行距離が動かない」（他の数字は正常・不具合の報告も無い）
//
//   ★測って分かったこと★
//     倉庫(dk_shifts)には正しい値が入っていた（総走行 ＝ 実車 ＋ 空車 が全件一致）。
//     ＝ 距離は1件も失われていない。★画面だけが 0.00 で固まっていた★。
//
//   ★真因★
//     ホーム画面の4つの数字は同じ関数で書いている（updateBusinessDashboard）。
//     2026-05-14 に「state が 0 のままだと 0 に上書きし続ける」という
//     ★同じ不具合★を司さんが報告し、3つには Math.max の命綱を付けた。
//     ★総走行距離だけ 付け忘れていた★:
//         実車総距離  Math.max(r.actual_total_m,  todayDist)     命綱あり
//         営業回数    Math.max(r.trip_count,      todayCount)    命綱あり
//         本日売上    Math.max(r.fare_total_yen,  todayFareYen)  命綱あり
//         総走行距離  r.total_distance_m だけ                    ★命綱なし★
//
//   ★直し方★
//     総走行距離にも同じ命綱を付ける。拾う相手は ★総走行距離そのもの★
//     （実車 todayDist を拾うと、総走行が実車と同じ数字になって別の嘘になる）。
//     同じ業務の中で 一度出た正の値より下げない。業務開始で 0 に戻す。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// updateBusinessDashboard の中身を取り出して、その場で動かす
function makeDashboard() {
  const i = HTML.indexOf('function updateBusinessDashboard()');
  if (i < 0) throw new Error('updateBusinessDashboard が見つからない');
  const end = HTML.indexOf('\n      }', i);
  const src = HTML.slice(i, end + 8);

  const els = {
    totalDist: { textContent: '' },
    todayDist: { textContent: '' },
    todayCount: { textContent: '' },
    fareTotalYen: { textContent: '' },
  };
  const ctx = {
    document: { getElementById: (id) => els[id] || null },
    console: { error: () => {} },
    Business: null,
    todayDist: 0,
    todayCount: 0,
    todayFareYen: 0,
    lastGoodTotalM: 0,
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'ctx',
    `with (ctx) { ${src} } return { run: () => ctx.__fn(), };`.replace(
      'return {',
      'ctx.__fn = updateBusinessDashboard; return {'
    )
  );
  const api = factory(ctx);
  return { els, ctx, run: api.run };
}

const report = (o) => ({
  total_distance_m: 0,
  actual_total_m: 0,
  trip_count: 0,
  fare_total_yen: 0,
  ...o,
});

describe('★総走行距離が 0.00 で固まらないこと★', () => {
  it('報告に値がある → そのまま出る', () => {
    const d = makeDashboard();
    d.ctx.Business = { getReport: () => report({ total_distance_m: 12340 }) };
    d.run();
    expect(d.els.totalDist.textContent).toBe('12.34');
  });

  it('★報告が 0 に落ちても 0.00 にしない（一度出た値を保つ）★', () => {
    const d = makeDashboard();
    d.ctx.Business = { getReport: () => report({ total_distance_m: 108400 }) };
    d.run();
    expect(d.els.totalDist.textContent).toBe('108.40');

    // 次の更新で報告が 0 に落ちる（これが司さんの端末で起きていた形）
    d.ctx.Business = { getReport: () => report({ total_distance_m: 0 }) };
    d.run();
    expect(d.els.totalDist.textContent, '★0.00 に上書きされた＝元の不具合★').toBe('108.40');
  });

  it('報告が戻ってきたら、そちらが優先（大きい方を出す）', () => {
    const d = makeDashboard();
    d.ctx.Business = { getReport: () => report({ total_distance_m: 108400 }) };
    d.run();
    d.ctx.Business = { getReport: () => report({ total_distance_m: 0 }) };
    d.run();
    d.ctx.Business = { getReport: () => report({ total_distance_m: 120000 }) };
    d.run();
    expect(d.els.totalDist.textContent).toBe('120.00');
  });

  it('両方 0 なら 0.00（業務開始直後は 0 のままでよい）', () => {
    const d = makeDashboard();
    d.ctx.Business = { getReport: () => report({}) };
    d.run();
    expect(d.els.totalDist.textContent).toBe('0.00');
  });

  it('★実車の値を総走行に流用していないこと★（別の嘘を作らない）', () => {
    const d = makeDashboard();
    d.ctx.todayDist = 43542; // 実車だけ値がある
    d.ctx.Business = { getReport: () => report({ actual_total_m: 43542 }) };
    d.run();
    expect(d.els.todayDist.textContent).toBe('43.54');
    expect(d.els.totalDist.textContent, '★総走行が実車と同じ数字になっている★').toBe('0.00');
  });

  it('他の3つの命綱も残っていること（消してしまわない）', () => {
    expect(HTML).toContain('Math.max(');
    expect(HTML).toMatch(/r\.actual_total_m \|\| 0,\s*[\s\S]{0,80}todayDist/);
    expect(HTML).toMatch(/r\.trip_count \|\| 0,\s*[\s\S]{0,80}todayCount/);
    expect(HTML).toMatch(/r\.fare_total_yen \|\| 0,\s*[\s\S]{0,80}todayFareYen/);
  });

  it('業務開始で命綱が 0 に戻る（前の業務を持ち越さない）', () => {
    const i = HTML.indexOf('function onBusinessStart()');
    const body = HTML.slice(i, i + 6000);
    expect(body, '★業務開始で命綱を 0 に戻していない＝前の業務の距離が残る★').toContain(
      'lastGoodTotalM = 0'
    );
  });
});
