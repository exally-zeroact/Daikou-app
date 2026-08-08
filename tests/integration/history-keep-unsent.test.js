'use strict';
// ============================================================
// ★まだ雲へ上がっていない業務は、30日で捨てないこと★ 2026-08-08
//
//   ★何が起きうるか（2026-08-08 実測で見つけた）★
//     終わった業務は端末の localStorage(daikou_business_history) に貯まり、
//     ・アプリを開いた時 ・圏外から戻った時 ・業務終了の直後 に雲へ上がる。
//     ところが ★会社の有効化に失敗している端末★（送り先が分からない）では
//     一度も上がらないまま貯まり続ける。実測:
//         POST 500 /functions/v1/dk-issue-license → {"ok":false,"reason":"server_no_key"}
//         → dk_license_company が入らない → 送り先が無い → 送信済0件・履歴1件のまま
//     そして _appendHistory は ★30日を過ぎた物を無条件で捨てていた★。
//     ＝ ★お客さんの売上が、誰にも気づかれずに消える★
//
//   ★直す形（安くて一番効く物から）★
//     30日を過ぎていても ★送信済みの印(dk_synced_shifts)が付いていない物は捨てない★。
//     ただし溜まり続けないよう上限を決め、上限を超えた分は
//     ★捨てた件数を残す★（あとで画面に出せるように）。
// ============================================================
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'business.js'), 'utf8');

function makeLocalStorage() {
  const store = Object.create(null);
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => delete store[k],
    _raw: store,
  };
}

function load(ls) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.Meter = {
    getState: () => ({ distance_m: 0, business_distance_m: 0, running: false }),
    setBusinessActive: () => {},
  };
  sandbox.localStorage = ls;
  sandbox.dlog = () => {};
  const fn = new Function(
    'window',
    'Meter',
    'localStorage',
    'dlog',
    'console',
    SRC + '\n;return window.Business;'
  );
  return fn(sandbox, sandbox.Meter, sandbox.localStorage, sandbox.dlog, console);
}

const DAY = 24 * 60 * 60 * 1000;
const HISTORY_KEY = 'daikou_business_history';
const SYNCED_KEY = 'dk_synced_shifts';

// 古い業務を1本作る（start_time が印の元になる）
const oldShift = (daysAgo, id) => {
  const t = Date.now() - daysAgo * DAY;
  return { start_time: t, end_time: t + 3600000, total_distance_m: 1000 * id, trip_count: id };
};

function seed(ls, history, synced) {
  ls.setItem(HISTORY_KEY, JSON.stringify(history));
  if (synced) ls.setItem(SYNCED_KEY, JSON.stringify(synced));
}
const readHist = (ls) => JSON.parse(ls.getItem(HISTORY_KEY) || '[]');

// 業務を1本まわして _appendHistory を発火させる（= 履歴の掃除が走る）
function runOneShift(B) {
  B.start();
  B.end();
}

describe('★上がっていない業務は 30日で捨てない★', () => {
  it('送信済みの古い業務は 今までどおり捨てる（溜め込まない）', () => {
    const ls = makeLocalStorage();
    const old = oldShift(40, 1); // 40日前・送信済み
    seed(ls, [old], [String(old.start_time)]);
    const B = load(ls);
    runOneShift(B);
    const h = readHist(ls);
    expect(
      h.some((x) => x.start_time === old.start_time),
      '★送信済みの古い物が残っている＝溜まり続ける★'
    ).toBe(false);
  });

  it('★まだ上がっていない古い業務は 捨てない★（お客さんの売上が消える所）', () => {
    const ls = makeLocalStorage();
    const old = oldShift(40, 2); // 40日前・★印なし＝まだ上がっていない★
    seed(ls, [old], []);
    const B = load(ls);
    runOneShift(B);
    const h = readHist(ls);
    expect(
      h.some((x) => x.start_time === old.start_time),
      '★まだ上がっていない業務が捨てられた＝売上が黙って消える★'
    ).toBe(true);
  });

  it('印の一覧が壊れていても 捨てない（読めない時は安全側）', () => {
    const ls = makeLocalStorage();
    const old = oldShift(40, 3);
    ls.setItem(HISTORY_KEY, JSON.stringify([old]));
    ls.setItem(SYNCED_KEY, '{壊れたJSON');
    const B = load(ls);
    runOneShift(B);
    expect(
      readHist(ls).some((x) => x.start_time === old.start_time),
      '★読めない時に捨てた★'
    ).toBe(true);
  });

  it('30日以内の業務は 今までどおり残る', () => {
    const ls = makeLocalStorage();
    const recent = oldShift(3, 4);
    seed(ls, [recent], [String(recent.start_time)]);
    const B = load(ls);
    runOneShift(B);
    expect(readHist(ls).some((x) => x.start_time === recent.start_time)).toBe(true);
  });

  it('★上限を超えたら、捨てた件数を残す★（黙って消さない）', () => {
    const ls = makeLocalStorage();
    const many = [];
    for (let i = 0; i < 260; i++) many.push(oldShift(40 + i, i + 10)); // 全部 未送信の古い物
    seed(ls, many, []);
    const B = load(ls);
    runOneShift(B);
    const h = readHist(ls);
    const dropped = Number(ls.getItem('dk_history_dropped') || '0');
    expect(h.length, '★上限が効いていない＝端末が溢れる★').toBeLessThanOrEqual(201 + 1);
    expect(dropped, '★捨てたのに件数が残っていない＝黙って消えた★').toBeGreaterThan(0);
    expect(h.length + dropped, '数が合わない').toBeGreaterThanOrEqual(260);
  });
});
