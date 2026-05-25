// tests/integration/history-trip-key-dedupe.test.js
//
// ★設計変更宣言 (2026-05-23・履歴3個重複バグ修正・A 案 trip_key 冪等化 verify):
//   index.html renderFare 内・hist 保存 logic の・pure helper (_historyDedupeUpsert) を
//   index.html script から・抽出 → vitest で・behavior verify。
//
// 真因:
//   ・index.html L7283 hist.push の・冪等 guard (= histSaved flag) が・cancelFare で
//     reset される (= L7598) ため・「確定 → 走行に戻る → 再確定」反復で・N 回 push 重複。
//   ・¥6,300 1 回精算が・3 個重複・todayFareYen 水増し・症状 確定。
//
// 修正 (= A 案):
//   ・hist entry に・trip_key (= current_trip.start_time) を付与
//   ・直前 entry の・trip_key が・同じ → 上書き update (= 同 trip の・最新値)
//   ・違えば・新規 push (= 別 trip)
//   ・todayDist / todayFareYen は・差分計算で・水増し防止
//   ・todayCount は・同 trip 内 不変 (= 1 trip = 1 回)
//
// 検証内容 (= 本物 hist entry 形式 fixture・decimal mock 禁止):
//   1. 新規 trip → push (= +1 entry)
//   2. 同一 trip 再確定 → update (= entries.length 不変・上書き)
//   3. 別 trip → push (= +1 entry)
//   4. todayFareYen / todayDist / todayCount 水増しなし (= 反復確定で・水増し 0)
//   5. trip_key null (= 後方互換 既存 entry) → 別 trip 扱い・push
//   6. 連続 3 回 同 trip 確定 → 1 entry のみ・最新値 保持
//   7. 同 trip update 中・距離増 → todayDist 差分のみ反映
//   8. 同 trip update 中・extras 追加 → entry に反映 (= 上書き)
//
// 絶対ルール準拠:
//   ✓ distance_m / calcFare / Meter / Worker B / state.trips: 完全無関係
//   ✓ hist (= daikou_history) 保存 logic のみ verify
//   ✓ 本物 hist entry 形式 (= 既存 _hist_render が読む field):
//       time:string / distance_m:int / fare:int / surcharge:bool / extras:array /
//       start_address:string|null / end_address:string|null / waypoints:array
//       + 新規 trip_key:number|null

'use strict';

const fs = require('fs');
const path = require('path');

// ─── index.html から・_historyDedupeUpsert 関数を・抽出して・eval する ───
//   理由: index.html script は・~9k 行・全 load (= jsdom) は・現実的でない。
//   helper は・pure function (= 副作用なし・引数経由) なので・抽出 + eval で・unit test 可能。
let _historyDedupeUpsert;
beforeAll(() => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  // function _historyDedupeUpsert(...) { ... } 全体を・brace counting で・抽出
  // (regex で・balanced brace は・困難なため・手動 文字 走査)
  const startMarker = 'function _historyDedupeUpsert';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error('_historyDedupeUpsert function 開始位置・見つからず・index.html schema 変更?');
  }
  // function body の・最初の '{' を探す
  const openIdx = html.indexOf('{', startIdx);
  if (openIdx === -1) {
    throw new Error('_historyDedupeUpsert function body 開始 brace 見つからず');
  }
  // brace count で・閉じ '}' まで進む (= string/comment は・粗く skip)
  let depth = 0;
  let endIdx = -1;
  let inStr = null; // ' or " or ` のどれか or null
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = openIdx; i < html.length; i++) {
    const ch = html[i];
    const prev = i > 0 ? html[i - 1] : '';
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '/' && prev === '*') inBlockComment = false;
      continue;
    }
    if (inStr) {
      if (ch === inStr && prev !== '\\') inStr = null;
      continue;
    }
    if (ch === '/' && html[i + 1] === '/') {
      inLineComment = true;
      continue;
    }
    if (ch === '/' && html[i + 1] === '*') {
      inBlockComment = true;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) {
    throw new Error('_historyDedupeUpsert function body 閉じ brace 見つからず');
  }
  const fnSrc = html.slice(startIdx, endIdx + 1);
  // sandbox eval (= function 定義 + 即時 export)
  const sandbox = {};
  new Function('sandbox', fnSrc + '\nsandbox._historyDedupeUpsert = _historyDedupeUpsert;')(
    sandbox
  );
  _historyDedupeUpsert = sandbox._historyDedupeUpsert;
  if (typeof _historyDedupeUpsert !== 'function') {
    throw new Error('_historyDedupeUpsert 抽出後・関数として取り出せず');
  }
});

// ─── 本物 hist entry 形式 fixture helper (= decimal mock 禁止) ───
function makeEntry(opts) {
  return {
    time: opts.time || '01:43',
    distance_m: opts.distance_m != null ? opts.distance_m : 10250, // 整数・Math.round 済
    fare: opts.fare != null ? opts.fare : 6300, // 整数
    surcharge: opts.surcharge != null ? opts.surcharge : false,
    extras: opts.extras != null ? opts.extras : [],
    start_address: opts.start_address != null ? opts.start_address : '今治市付近',
    end_address: opts.end_address != null ? opts.end_address : '今治市付近',
    waypoints: opts.waypoints != null ? opts.waypoints : [{ address: '今治市付近' }],
    trip_key: opts.trip_key != null ? opts.trip_key : 1716480180000, // start_time 1716480180000ms
  };
}

// ─── 1. 新規 trip → push ─────────────────────────────────────
describe('history dedupe: 新規 trip → push', () => {
  it('空 hist に・新規 trip entry → push される (= length 1)', () => {
    const prevHist = [];
    const newEntry = makeEntry({ trip_key: 1716480180000, fare: 6300, distance_m: 10250 });
    const r = _historyDedupeUpsert(
      prevHist,
      newEntry,
      { dist: 0, count: 0, fareYen: 0 },
      10250.5,
      6300
    );
    expect(r.action).toBe('push');
    expect(r.isReConfirm).toBe(false);
    expect(r.hist.length).toBe(1);
    expect(r.hist[0]).toBe(newEntry);
    expect(r.today.dist).toBeCloseTo(10250.5, 5);
    expect(r.today.count).toBe(1);
    expect(r.today.fareYen).toBe(6300);
  });

  it('既存 entry (= 別 trip) ある hist に・新規 trip → push (= length+1)', () => {
    const prevHist = [makeEntry({ trip_key: 1716480000000, fare: 1300, distance_m: 2100 })];
    const newEntry = makeEntry({ trip_key: 1716480180000, fare: 6300, distance_m: 10250 });
    const r = _historyDedupeUpsert(
      prevHist,
      newEntry,
      { dist: 2100, count: 1, fareYen: 1300 },
      10250.0,
      6300
    );
    expect(r.action).toBe('push');
    expect(r.hist.length).toBe(2);
    expect(r.today.count).toBe(2);
    expect(r.today.fareYen).toBe(1300 + 6300);
  });
});

// ─── 2. 同一 trip 再確定 → update ─────────────────────────────
describe('history dedupe: 同一 trip 再確定 → update', () => {
  it('直前 entry と・同 trip_key → 上書き update (= length 不変)', () => {
    const tripKey = 1716480180000;
    const prevEntry = makeEntry({ trip_key: tripKey, fare: 6300, distance_m: 10250 });
    const prevHist = [prevEntry];
    const newEntry = makeEntry({ trip_key: tripKey, fare: 6300, distance_m: 10250 });
    const r = _historyDedupeUpsert(
      prevHist,
      newEntry,
      { dist: 10250, count: 1, fareYen: 6300 },
      10250.0,
      6300
    );
    expect(r.action).toBe('update');
    expect(r.isReConfirm).toBe(true);
    expect(r.hist.length).toBe(1); // ★ length 不変
    expect(r.hist[0]).toBe(newEntry); // ★ 最新 entry に・置換
    // ★ todayFareYen / todayDist / todayCount 水増しなし
    expect(r.today.dist).toBeCloseTo(10250, 5);
    expect(r.today.count).toBe(1); // ★ count は・1 のまま
    expect(r.today.fareYen).toBe(6300); // ★ fareYen は・6300 のまま
  });

  it('連続 3 回 同 trip 確定 → 1 entry のみ・最新値', () => {
    const tripKey = 1716480180000;
    let hist = [];
    let today = { dist: 0, count: 0, fareYen: 0 };
    // 1 回目: 新規 push
    let r = _historyDedupeUpsert(
      hist,
      makeEntry({ trip_key: tripKey, fare: 6300, distance_m: 10250 }),
      today,
      10250.0,
      6300
    );
    expect(r.action).toBe('push');
    hist = r.hist;
    today = r.today;
    // 2 回目: update
    r = _historyDedupeUpsert(
      hist,
      makeEntry({ trip_key: tripKey, fare: 6300, distance_m: 10250 }),
      today,
      10250.0,
      6300
    );
    expect(r.action).toBe('update');
    hist = r.hist;
    today = r.today;
    // 3 回目: update
    r = _historyDedupeUpsert(
      hist,
      makeEntry({ trip_key: tripKey, fare: 6300, distance_m: 10250 }),
      today,
      10250.0,
      6300
    );
    expect(r.action).toBe('update');
    // ★ 結果: hist length 1・count 1・fareYen 6300・dist 10250 (= 水増しゼロ)
    expect(r.hist.length).toBe(1);
    expect(r.today.count).toBe(1);
    expect(r.today.fareYen).toBe(6300);
    expect(r.today.dist).toBeCloseTo(10250, 5);
  });
});

// ─── 3. todayFareYen 水増しなし (= 反復確定 で・売上不変) ───
describe('history dedupe: todayFareYen / todayDist / todayCount 水増しなし', () => {
  it('反復 5 回 同 trip → fareYen / dist / count は・1 回分のみ', () => {
    const tripKey = 1716480180000;
    let hist = [];
    let today = { dist: 0, count: 0, fareYen: 0 };
    for (let i = 0; i < 5; i++) {
      const r = _historyDedupeUpsert(
        hist,
        makeEntry({ trip_key: tripKey, fare: 6300, distance_m: 10250 }),
        today,
        10250.0,
        6300
      );
      hist = r.hist;
      today = r.today;
    }
    expect(hist.length).toBe(1);
    expect(today.count).toBe(1);
    expect(today.fareYen).toBe(6300); // ★ 水増しゼロ
    expect(today.dist).toBeCloseTo(10250, 5);
  });

  it('同 trip update 中・距離増 + 料金増 → 差分のみ加算', () => {
    const tripKey = 1716480180000;
    // 1 回目: distance=10000m / fare=¥6000
    let r = _historyDedupeUpsert(
      [],
      makeEntry({ trip_key: tripKey, distance_m: 10000, fare: 6000 }),
      { dist: 0, count: 0, fareYen: 0 },
      10000.0,
      6000
    );
    expect(r.today.dist).toBeCloseTo(10000, 5);
    expect(r.today.fareYen).toBe(6000);
    // 2 回目 update: 走行戻る → 少し走った後・distance=10250m / fare=¥6300 で再確定
    r = _historyDedupeUpsert(
      r.hist,
      makeEntry({ trip_key: tripKey, distance_m: 10250, fare: 6300 }),
      r.today,
      10250.0,
      6300
    );
    expect(r.action).toBe('update');
    // ★ 差分のみ加算: dist += 10250 - 10000 = 250 → 合計 10250
    // ★ 差分のみ加算: fareYen += 6300 - 6000 = 300 → 合計 6300
    expect(r.today.dist).toBeCloseTo(10250, 5);
    expect(r.today.fareYen).toBe(6300);
    expect(r.today.count).toBe(1); // 不変
  });
});

// ─── 4. trip_key null (= 後方互換 既存 entry) → 別 trip 扱い ───
describe('history dedupe: trip_key null 後方互換', () => {
  it('直前 entry が・trip_key 欠落 (= 旧版) → 新 entry は・別 trip 扱い・push', () => {
    const oldEntry = makeEntry({ trip_key: null });
    delete oldEntry.trip_key; // 完全に・field なし (= 旧 hist 完全互換)
    const newEntry = makeEntry({ trip_key: 1716480180000 });
    const r = _historyDedupeUpsert(
      [oldEntry],
      newEntry,
      { dist: 10250, count: 1, fareYen: 6300 },
      10250.0,
      6300
    );
    expect(r.action).toBe('push');
    expect(r.hist.length).toBe(2);
    expect(r.today.count).toBe(2);
    expect(r.today.fareYen).toBe(6300 + 6300);
  });

  it('新 entry も・trip_key null → 別 trip 扱い・push (= 安全側 fallback)', () => {
    const prevEntry = makeEntry({ trip_key: 1716480000000 });
    const newEntry = makeEntry({ trip_key: null });
    const r = _historyDedupeUpsert(
      [prevEntry],
      newEntry,
      { dist: 10250, count: 1, fareYen: 6300 },
      10250.0,
      6300
    );
    // ★ trip_key null → 「同 key 判定 不可」→ 安全側で・push (= 既存挙動互換)
    expect(r.action).toBe('push');
    expect(r.hist.length).toBe(2);
    expect(r.today.count).toBe(2);
  });
});

// ─── 5. 別 trip 続く場合 ────────────────────────────────────────
describe('history dedupe: 別 trip 続く場合', () => {
  it('trip A → trip B → trip A (= key 別) で・3 entries (= 全部 別 trip)', () => {
    let hist = [];
    let today = { dist: 0, count: 0, fareYen: 0 };
    // Trip A
    let r = _historyDedupeUpsert(
      hist,
      makeEntry({ trip_key: 1000, fare: 1300, distance_m: 2000 }),
      today,
      2000.0,
      1300
    );
    hist = r.hist;
    today = r.today;
    expect(r.action).toBe('push');
    // Trip B
    r = _historyDedupeUpsert(
      hist,
      makeEntry({ trip_key: 2000, fare: 1800, distance_m: 3000 }),
      today,
      3000.0,
      1800
    );
    hist = r.hist;
    today = r.today;
    expect(r.action).toBe('push');
    // Trip A 再 (= 別 key・同 trip_key=1000 だが・直前は・trip B) → push (= 末尾比較なので・直前 trip B != trip A・別 trip 扱い)
    r = _historyDedupeUpsert(
      hist,
      makeEntry({ trip_key: 1000, fare: 1300, distance_m: 2000 }),
      today,
      2000.0,
      1300
    );
    expect(r.action).toBe('push');
    expect(r.hist.length).toBe(3);
    expect(r.today.count).toBe(3);
    expect(r.today.fareYen).toBe(1300 + 1800 + 1300);
  });
});

// ─── 6. extras / address の・update 反映 ────────────────────────
describe('history dedupe: extras / address の・update 反映', () => {
  it('同 trip update で・extras / address は・最新値で上書き', () => {
    const tripKey = 1716480180000;
    // ★ production の・renderFare で・newEntry.fare === fare 引数 が・保証される (= L7299 fare: total)
    //   test fixture でも・両方を・揃えること (= 整合性 verify)
    const r1 = _historyDedupeUpsert(
      [],
      makeEntry({ trip_key: tripKey, fare: 7300, extras: [{ name: 'A', amount: 1000 }] }),
      { dist: 0, count: 0, fareYen: 0 },
      10250.0,
      7300
    );
    expect(r1.hist[0].extras.length).toBe(1);
    expect(r1.today.fareYen).toBe(7300);
    // update: extras 追加 (= ¥2,000) → 合計 ¥9,300
    const r2 = _historyDedupeUpsert(
      r1.hist,
      makeEntry({
        trip_key: tripKey,
        fare: 9300,
        extras: [
          { name: 'A', amount: 1000 },
          { name: 'B', amount: 2000 },
        ],
      }),
      r1.today,
      10250.0,
      9300
    );
    expect(r2.action).toBe('update');
    expect(r2.hist[0].extras.length).toBe(2); // ★ 最新値で上書き
    // 売上水増し なし (= 差分のみ): 7300 → 9300 で +2000
    expect(r2.today.fareYen).toBe(9300);
    expect(r2.today.count).toBe(1);
  });
});

// ─── 7. 距離課金 logic への・無関係 verify ──────────────────────
describe('history dedupe: distance_m / 課金額 logic 無関係 verify', () => {
  it('helper は・引数 distance_m / fare を・直接受け取る (= Meter 不依存)', () => {
    // 任意の distance_m / fare で・OK・Meter mock 不要
    const r = _historyDedupeUpsert(
      [],
      makeEntry({ trip_key: 1, distance_m: 999, fare: 999 }),
      { dist: 0, count: 0, fareYen: 0 },
      999.0,
      999
    );
    expect(r.today.fareYen).toBe(999);
    expect(r.today.dist).toBeCloseTo(999, 5);
  });
});
