'use strict';
// ============================================================
// ★本番で起きた「勤務は上がったが距離が0」を追う 2026-08-03★
//
//   ★実測（本番 dk_shifts 3件）★
//     7e1919ef  13:51→13:53(149秒)     total_distance_m = 0
//     f3527369  14:01→14:03(69秒)      total_distance_m = 0.71 m
//     22849fdb  14:08→18:01(13993秒)   total_distance_m = 0
//     actual_total_m / fare_total_yen / trip_count = 全部 0 ／ dk_trips = 0
//   ★司さんの画面には 5.32km / 5.36km / 5.28km と出ていた★
//
//   ▼ここで見るのは business.js が履歴に何を書くか（クラウドは触らない）。
//     job-sync は履歴の値をそのまま運ぶだけなので、
//     ★履歴が0なら、上がる行も必ず0になる★。
//
//   ▼メーターの偽物は★実機どおり★にする:
//     ・start() で 0 に戻される
//     ・business_active の間だけ積み上がる（meter.js:378 と同じ条件）
//     ここを実機と違う形にすると、テストが嘘をつく（一度やってしまった）。
// ============================================================
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BJS = path.join(ROOT, 'js', 'business.js');

function makeStorage(seed) {
  const m = Object.assign({}, seed || {});
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => {
      m[k] = String(v);
    },
    removeItem: (k) => {
      delete m[k];
    },
    _dump: () => m,
  };
}

// 実機どおりのメーター
function makeMeter() {
  const s = {
    running: false,
    billing_frozen: false,
    business_active: false,
    distance_m: 0,
    business_distance_m: 0,
    business_display_distance_m: 0,
    business_tier2_pending_m: 0,
  };
  return {
    getState: () => s,
    setBusinessActive: (v) => {
      s.business_active = !!v;
    },
    setBusinessDistance: (v) => {
      s.business_distance_m = v;
      s.business_display_distance_m = v;
    },
    // 走る（business_active の間だけ積み上がる = meter.js:378 と同じ条件）
    drive: (m) => {
      if (s.business_active && !s.billing_frozen) {
        s.business_distance_m += m;
        s.business_display_distance_m = s.business_distance_m;
        s.distance_m += m;
      }
    },
    reboot: () => {
      s.business_distance_m = 0;
      s.business_display_distance_m = 0;
      s.distance_m = 0;
      s.business_active = false;
    },
    _s: s,
  };
}

function loadBusiness(storage, meter) {
  global.localStorage = storage;
  global.Meter = meter;
  delete require.cache[require.resolve(BJS)];
  return require(BJS);
}

const hist = (storage) => {
  try {
    return JSON.parse(storage.getItem('daikou_business_history') || '[]');
  } catch (_) {
    return [];
  }
};

function driveShift(B, meter, meters, ticks) {
  B.start();
  const per = meters / ticks;
  for (let i = 0; i < ticks; i++) {
    meter.drive(per);
    B.onGps({ lat: 34, lng: 133, t: Date.now() + i * 1000 });
  }
  B.end();
}

describe('★ふつうに走って終了 → 次の業務開始（今まで通り動く形）★', () => {
  it('5.32km が履歴に残る', () => {
    const storage = makeStorage();
    const meter = makeMeter();
    const B = loadBusiness(storage, meter);
    driveShift(B, meter, 5320, 10);
    B.start(); // ★履歴が確定するのはここ（index.html:8586 の設計）★
    const h = hist(storage);
    expect(h.length, '履歴が1件も残っていない').toBeGreaterThan(0);
    expect(h[0].total_distance_m).toBeCloseTo(5320, 0);
  });
});

// ★2026-08-03 直した★ ここは元の壊れた挙動（終了しても残らない）を固定していた。
//   直したので期待値を逆にする。中身の固定は tests/integration/shift-history-on-end.test.js。
describe('★業務終了した時点で記録が残ること（司さん「反映されない」の根治）★', () => {
  it('終了した時点で履歴が1件できる', () => {
    const storage = makeStorage();
    const meter = makeMeter();
    const B = loadBusiness(storage, meter);
    driveShift(B, meter, 5320, 10);
    expect(hist(storage).length, '★終了しても記録がどこにも残らない★').toBe(1);
  });

  it('★終了して、その日はもう始めなくても送れる★（翌日まで待たない）', () => {
    // 夜の仕事は「終わったらもう開かない」。元の作りだと翌日まで上がらなかった。
    const storage = makeStorage();
    const meter = makeMeter();
    const B = loadBusiness(storage, meter);
    driveShift(B, meter, 5320, 10);
    const JS = require(path.join(ROOT, 'js', 'job-sync.js'));
    const targets = JS.selectUnsynced(hist(storage), []);
    expect(targets.length, '終了しただけでは送れない＝翌日まで上がらない').toBe(1);
    expect(targets[0].total_distance_m).toBeCloseTo(5320, 0);
  });
});

describe('★アプリを開き直しても、前の勤務が残ること★', () => {
  // ★2026-08-03 テストの作りを直した★
  //   最初は再起動のあと Business.load() を呼んでいなかった。
  //   実機は index.html:9867 で必ず呼ぶ。★呼ばないテストは実機と違う＝嘘をつく★。
  //   （一度これで「開き直すと消える」と誤って報告しかけた）
  function reboot(storage, meter) {
    meter.reboot();
    const B = loadBusiness(storage, meter);
    B.load(); // ★実機と同じ★
    return B;
  }

  it('走行 → 終了 → 開き直し → 次の業務開始 で距離が残る', () => {
    const storage = makeStorage();
    const meter = makeMeter();
    const B = loadBusiness(storage, meter);
    driveShift(B, meter, 5320, 10);

    const B2 = reboot(storage, meter);
    B2.start(); // 中で abandon() が前の勤務を履歴に確定する

    const h = hist(storage);
    expect(h.length, '★開き直すと前の勤務が丸ごと消える★').toBeGreaterThan(0);
    expect(h[0].total_distance_m, '★開き直すと距離が消える★').toBeCloseTo(5320, 0);
  });

  it('★開き直して「業務再開」を押した場合も距離が続く★', () => {
    const storage = makeStorage();
    const meter = makeMeter();
    const B = loadBusiness(storage, meter);
    driveShift(B, meter, 5320, 10);

    const B2 = reboot(storage, meter);
    expect(B2.resume(), '再開できない').toBe(true);
    meter.drive(1000); // さらに1km走る
    B2.onGps({ lat: 34, lng: 133, t: Date.now() });
    const rep = B2.getReport();
    expect(rep.total_distance_m, '★再開したら前の距離が消えた★').toBeGreaterThan(5000);
  });
});

describe('★0の勤務は「正常」ではない★', () => {
  it('長時間なのに0mは、原理的にありえない（決まりとして持つ）', () => {
    const 長い = 13993; // 本番で実際に上がった 3時間53分
    const 距離 = 0;
    expect(長い > 600 && 距離 <= 0, '長時間0mを正常扱いしている').toBe(true);
  });
});

describe('★job-sync は距離をそのまま運ぶ（作らない・変えない）★', () => {
  it('履歴の値がそのまま payload になる', () => {
    const JS = require(path.join(ROOT, 'js', 'job-sync.js'));
    const p = JS.toPayload({
      start_time: 1,
      end_time: 2,
      elapsed_sec: 100,
      total_distance_m: 5320,
      actual_total_m: 4000,
      empty_distance_m: 1320,
      fare_total_yen: 4500,
      trip_count: 1,
      trips: [{ distance_m: 4000, fare_yen: 4500 }],
    });
    expect(p.total_distance_m).toBe(5320);
    expect(p.actual_total_m).toBe(4000);
    expect(p.fare_total_yen).toBe(4500);
    expect(p.trips.length).toBe(1);
  });

  it('★履歴が0なら、上がる行も必ず0になる（本番で起きた形）★', () => {
    const JS = require(path.join(ROOT, 'js', 'job-sync.js'));
    const p = JS.toPayload({
      start_time: 1,
      end_time: 2,
      elapsed_sec: 13993,
      total_distance_m: 0,
      trips: [],
    });
    expect(p.total_distance_m, '運び手が値を作ってはいけない').toBe(0);
  });
});
