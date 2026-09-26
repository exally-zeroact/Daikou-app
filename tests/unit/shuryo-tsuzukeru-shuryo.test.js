// tests/unit/shuryo-tsuzukeru-shuryo.test.js
// ============================================================
// ★[終了]→(Wi-Fiで送信)→[続ける]→もう何件か→[終了] で 事務所から 消えないか★
//   2026-09-26  司さんの報告
//   「従業員がオフラインで使って Wi-Fi 繋いでから業務終了したら
//     何件か（はっきり分からない）減ることがある」
//
// ★元の穴★
//   business.js の resume() は 履歴からは 外していたが
//   ★dk_synced_shifts の「送信済み」の印を 外していなかった★。
//   ⇒ 本当に終えた時の「続きを足した版」を job-sync が 1件も 選ばず
//     ★事務所には 途中までの 件数・距離・売上・勤務時間しか 残らない★。
//   同じ対処は js/trip-edit.js には 入っていた（★片方だけ 直っていた★）。
//
// ★なぜ 何ヶ月も 見えなかったか★
//   resume を見る試験(tests/business.test.js)と
//   送信済みの印を見る試験(trip-edit.test.js 他3本)が ★一度も 交わっていなかった★。
//   ⇒ この紙は ★2つを 同じ localStorage の 上で 通す★ ことだけを 仕事にする。
//
// ★わざと壊して 赤に なる事を 見た (2026-09-26)★
//   js/business.js の resume() から `_unsealSynced(state.start_time);` の 1行を 消す
//     ⇒ 「① 続きを足した版が もう一度 選ばれる」など ★3本 赤★
//   戻す ⇒ 全部 緑。（外し方は この紙の 下の「測り方」を 見ること）
//
// ★真似ない★ 画面が 使う 関数を そのまま 呼ぶ
//   ・Business … js/business.js を そのまま 読み込む(tests/business.test.js と同じやり方)
//   ・JobSync  … js/job-sync.js を require する
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BUSINESS_JS_SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'business.js'), 'utf8');
const JobSync = require(path.join(ROOT, 'js', 'job-sync.js'));

const HISTORY_KEY = 'daikou_business_history';

function makeLocalStorage() {
  const store = Object.create(null);
  return {
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem(k, v) {
      store[k] = String(v);
    },
    removeItem(k) {
      delete store[k];
    },
    clear() {
      for (const k of Object.keys(store)) delete store[k];
    },
    key(i) {
      return Object.keys(store)[i] || null;
    },
    get length() {
      return Object.keys(store).length;
    },
    _raw: store,
  };
}

function makeMeterMock() {
  let dist = 0;
  return {
    getState: () => ({ distance_m: dist, business_distance_m: 0, running: true }),
    setDistance: (v) => {
      dist = v;
    },
    setBusinessActive: () => {},
    businessEnd: () => {},
  };
}

function loadBusiness(ls) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.Meter = makeMeterMock();
  sandbox.localStorage = ls;
  sandbox.dlog = () => {};
  sandbox.console = console;
  const fn = new Function(
    'window',
    'Meter',
    'localStorage',
    'dlog',
    'console',
    BUSINESS_JS_SOURCE + '\n;return window.Business;'
  );
  return fn(sandbox, sandbox.Meter, sandbox.localStorage, sandbox.dlog, sandbox.console);
}

const readJson = (ls, k, d) => {
  try {
    const raw = ls.getItem(k);
    return raw ? JSON.parse(raw) : d;
  } catch (_) {
    return d;
  }
};

// 「Wi-Fi に繋がって 事務所へ 上がった」を 本物の関数で 再現する。
//   ＝job-sync が 送る物を 選び、サーバが accepted を 返し、印が 付くところまで。
function jimushoHeAgeru(ls) {
  const history = readJson(ls, HISTORY_KEY, []);
  const synced = readJson(ls, JobSync.K_SYNCED, []);
  const targets = JobSync.selectUnsynced(history, synced);
  const okKeys = targets.map((s) => String(s.start_time)); // サーバが全部 受け取った
  if (okKeys.length) {
    ls.setItem(JobSync.K_SYNCED, JSON.stringify(JobSync.mergeSynced(synced, okKeys)));
  }
  return targets.map((s) => JobSync.toPayload(s));
}

describe('★[終了]→送信→[続ける]→[終了] で 事務所から 消えない★', () => {
  let ls;
  let Business;

  beforeEach(() => {
    ls = makeLocalStorage();
    Business = loadBusiness(ls);
  });

  function daikou(n) {
    for (let i = 0; i < n; i++) Business.onTripEnd(1000, 2000, Date.now() + i);
  }

  it('① 続きを足した版が もう一度 選ばれる（＝事務所に 届く）', () => {
    Business.start();
    daikou(3);
    Business.end();

    const okuri1 = jimushoHeAgeru(ls);
    expect(okuri1.length, '1回目に 勤務が 上がっていない＝前提が 崩れている').toBe(1);
    expect(okuri1[0].trips.length).toBe(3);

    Business.resume();
    daikou(2);
    Business.end();

    const okuri2 = jimushoHeAgeru(ls);
    expect(okuri2.length, '★続きを足した版が 1件も 選ばれない＝事務所から 消える★').toBe(1);
    expect(okuri2[0].trips.length, '★代行の 件数が 減っている★').toBe(5);
    expect(okuri2[0].trip_count, '★数え札も 5 でないと 食い違う★').toBe(5);
  });

  it('② 件数だけでなく 終了時刻・売上・距離も 続きの分が 入る', () => {
    Business.start();
    daikou(2);
    Business.end();
    const mae = jimushoHeAgeru(ls)[0];

    Business.resume();
    daikou(3);
    Business.end();
    const ato = jimushoHeAgeru(ls)[0];

    expect(ato, '★2回目が 上がっていない★').toBeTruthy();
    expect(ato.fare_total_yen).toBeGreaterThan(mae.fare_total_yen);
    expect(ato.actual_total_m).toBeGreaterThan(mae.actual_total_m);
    expect(ato.end_time).toBeGreaterThanOrEqual(mae.end_time);
    expect(ato.start_time, '★同じ勤務として 置き換わること（別物に しない）★').toBe(mae.start_time);
  });

  it('③ resume() が 印を 外す（本物の関数を そのまま 呼ぶ）', () => {
    Business.start();
    daikou(1);
    Business.end();
    jimushoHeAgeru(ls);
    const st = Business.getState();
    expect(readJson(ls, JobSync.K_SYNCED, [])).toContain(String(st.start_time));

    Business.resume();
    expect(
      readJson(ls, JobSync.K_SYNCED, []),
      '★resume() が 送信済みの印を 外していない★'
    ).not.toContain(String(st.start_time));
  });

  it('④ [続ける]を 押さなければ 二重に 送らない（直しが 別の穴を 開けていないか）', () => {
    Business.start();
    daikou(2);
    Business.end();
    expect(jimushoHeAgeru(ls).length).toBe(1);
    expect(jimushoHeAgeru(ls).length, '★同じ勤務を 2回 送っている★').toBe(0);
  });

  it('⑤ 送信されていない時に [続ける] を 押しても 壊れない', () => {
    Business.start();
    daikou(1);
    Business.end();
    Business.resume(); // 一度も 送っていない（印が 無い）
    daikou(1);
    Business.end();
    const okuri = jimushoHeAgeru(ls);
    expect(okuri.length).toBe(1);
    expect(okuri[0].trips.length).toBe(2);
  });
});

describe('★取り戻し resendOnce（もう消えている分を 送り直させる）★', () => {
  const T1 = 1700000000000;
  const T2 = 1700000100000;

  function tana(history, synced, other) {
    const ls = makeLocalStorage();
    ls.setItem(HISTORY_KEY, JSON.stringify(history));
    ls.setItem(JobSync.K_SYNCED, JSON.stringify(synced));
    if (other) ls.setItem(JobSync.K_SEAL_OTHER_CO, JSON.stringify(other));
    return ls;
  }
  const shift = (t) => ({ start_time: t, end_time: t + 1000, trips: [] });

  it('手元の履歴に在る 送信済みの勤務は 印を 外す', () => {
    const ls = tana([shift(T1), shift(T2)], [String(T1), String(T2)]);
    const r = JobSync.resendOnce(ls);
    expect(r.ran).toBe(true);
    expect(r.unsealed).toBe(2);
    expect(readJson(ls, JobSync.K_SYNCED, [])).toEqual([]);
  });

  it('★前の会社の物（dk_seal_other_co）は 絶対に 外さない★', () => {
    const ls = tana([shift(T1), shift(T2)], [String(T1), String(T2)], [String(T1)]);
    const r = JobSync.resendOnce(ls);
    expect(r.unsealed, '★前の会社の勤務まで 外した＝別の会社の売上に なる★').toBe(1);
    expect(readJson(ls, JobSync.K_SYNCED, [])).toEqual([String(T1)]);
  });

  it('手元の履歴に 無い勤務は 印を 残す（送り直しようが 無い）', () => {
    const ls = tana([shift(T1)], [String(T1), String(T2)]);
    JobSync.resendOnce(ls);
    expect(readJson(ls, JobSync.K_SYNCED, [])).toEqual([String(T2)]);
  });

  it('★1回だけ 走る★（2回目は 何もしない）', () => {
    const ls = tana([shift(T1)], [String(T1)]);
    expect(JobSync.resendOnce(ls).ran).toBe(true);
    ls.setItem(JobSync.K_SYNCED, JSON.stringify([String(T1)])); // また 送信済みに なった
    const r2 = JobSync.resendOnce(ls);
    expect(r2.ran, '★毎回 走ると 通信を 無駄に 増やす★').toBe(false);
    expect(readJson(ls, JobSync.K_SYNCED, [])).toEqual([String(T1)]);
  });

  it('壊れた中身でも throw しない', () => {
    const ls = makeLocalStorage();
    ls.setItem(HISTORY_KEY, '{壊れている');
    ls.setItem(JobSync.K_SYNCED, 'これもJSONではない');
    expect(() => JobSync.resendOnce(ls)).not.toThrow();
  });
});

describe('★会社が 変わった時は 2つの 棚に 控える（取り戻しと 両立するか）★', () => {
  it('切り離した勤務は dk_seal_other_co にも 入る', () => {
    const T = 1700000000000;
    const ls = makeLocalStorage();
    ls.setItem(HISTORY_KEY, JSON.stringify([{ start_time: T, trips: [] }]));
    ls.setItem('dk_sync_company', 'mae-no-kaisha');

    const r = JobSync.sealForCompanySwitch(ls, 'atarashii-kaisha');
    expect(r.changed).toBe(true);
    expect(r.sealed).toBe(1);
    expect(readJson(ls, JobSync.K_SYNCED, [])).toContain(String(T));
    expect(
      readJson(ls, JobSync.K_SEAL_OTHER_CO, []),
      '★別棚に 控えないと 取り戻しが 前の会社の勤務を 送ってしまう★'
    ).toContain(String(T));
  });

  it('★はじめての活性化は 切り離さない（前からの 決まりを 壊していないか）★', () => {
    const T = 1700000000000;
    const ls = makeLocalStorage();
    ls.setItem(HISTORY_KEY, JSON.stringify([{ start_time: T, trips: [] }]));
    const r = JobSync.sealForCompanySwitch(ls, 'hajimete-no-kaisha');
    expect(r.sealed).toBe(0);
    expect(readJson(ls, JobSync.K_SEAL_OTHER_CO, [])).toEqual([]);
  });

  it('切り離した直後に 取り戻しを 走らせても 送らない（通しで 見る）', () => {
    const T = 1700000000000;
    const ls = makeLocalStorage();
    ls.setItem(HISTORY_KEY, JSON.stringify([{ start_time: T, trips: [] }]));
    ls.setItem('dk_sync_company', 'mae-no-kaisha');
    JobSync.sealForCompanySwitch(ls, 'atarashii-kaisha');
    JobSync.resendOnce(ls);
    const history = readJson(ls, HISTORY_KEY, []);
    const synced = readJson(ls, JobSync.K_SYNCED, []);
    expect(
      JobSync.selectUnsynced(history, synced).length,
      '★前の会社の勤務が 新しい会社へ 上がる★'
    ).toBe(0);
  });
});

describe('★同じ穴を 二度と 開けない（作りの 見張り）★', () => {
  // ★この穴の 正体は「履歴を 触る所が 2つ在って 片方だけ 印を 外していた」事★。
  //   字で 数える: daikou_business_history から ★行を 減らす★ ファイルは
  //   必ず dk_synced_shifts も 触っていること。
  const SAWARU = ['js/business.js', 'js/trip-edit.js'];

  it('履歴から 行を 減らすファイルは 送信済みの印も 触っている', () => {
    const nuke = [];
    for (const f of SAWARU) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(src, f + ' が 履歴を 見ていない＝一覧が 古い').toContain(HISTORY_KEY);
      if (src.indexOf('dk_synced_shifts') < 0) nuke.push(f);
    }
    expect(nuke, '★履歴を 触るのに 送信済みの印を 触っていない★').toEqual([]);
  });

  it('★一覧が 空振りしていない（履歴を 触る他のファイルが 増えていないか）★', () => {
    const mita = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'js'))) {
      if (!f.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
      // 「履歴の 中身を 作り直して 書き戻す」形だけを 拾う（読むだけの物は 除く）
      if (src.indexOf(HISTORY_KEY) >= 0 && src.indexOf('setItem(HISTORY_KEY') >= 0) {
        mita.push('js/' + f);
      }
      if (src.indexOf(HISTORY_KEY) >= 0 && src.indexOf('setItem(K_BIZ_HISTORY') >= 0) {
        mita.push('js/' + f);
      }
    }
    expect(mita.sort(), '★履歴を 書き戻すファイルが 増えた／減った＝上の 一覧を 直すこと★').toEqual(
      SAWARU.slice().sort()
    );
  });
});
