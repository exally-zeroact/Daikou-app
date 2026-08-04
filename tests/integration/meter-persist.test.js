'use strict';
// ============================================================
// ★メーターが自分で走行距離を覚えること 2026-08-04★
//
//   ★司さんの実際の操作（これが決定的）★
//     3台ともオフラインで較正してテスト走行 → ★いったん画面を閉じた★
//     → 家に持ち帰ってWi-Fiに繋いで → 業務終了を押した
//     ＝上がった3件は全部 0m。★「画面を閉じる」で消えていた★
//
//   ★測って確定した欠陥★
//     js/meter.js の localStorage 参照は3件だけ、全部 dk_veh_active（車両プロファイル）。
//     ★distance_m / fare_yen / business_distance_m を保存している行は1件も無い★
//     ＝走った距離も料金も、閉じたら消える。
//     電波の有無に関係なく ★電池切れ・iOSのバックグラウンド破棄・killでも同じ★。
//
//   ★今までのテストが見ていなかった形★
//     1回のページ内で完結するテストしか無かったので、この形を一度も通していない。
//     ここでは必ず ★閉じる／落ちる★ を通す。
// ============================================================
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MP = path.join(ROOT, 'js', 'meter-persist.js');

let P;
beforeAll(() => {
  P = require(MP);
});

const KEY = 'dk_meter_snapshot';

function store(seed) {
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

// 走っているメーターの中身
const running = (over) =>
  Object.assign(
    {
      distance_m: 5320.4,
      business_distance_m: 5320.4,
      elapsed_accumulated_sec: 900,
      fare_yen: 1850,
      wait_sec: 120,
      running: true,
      business_active: true,
      billing_frozen: false,
    },
    over || {}
  );

const BIZ = 1785890000000; // 業務の開始時刻
const TRIP = 1785899000000; // 代行の開始時刻

describe('★書く（閉じても消えないように）★', () => {
  it('走っている時は書く', () => {
    const s = store();
    expect(P.save(s, running(), { businessStart: BIZ, tripStart: TRIP, now: 1785900000000 })).toBe(
      true
    );
    const j = JSON.parse(s.getItem(KEY));
    expect(j.distance_m).toBeCloseTo(5320.4, 1);
    expect(j.business_distance_m).toBeCloseTo(5320.4, 1);
    expect(j.business_start_time).toBe(BIZ);
    expect(j.trip_start_time).toBe(TRIP);
  });

  it('★表示用の値は書かない★（実距離から作り直せる）', () => {
    const s = store();
    P.save(s, running({ display_distance_m: 9999, business_display_distance_m: 9999 }), {
      businessStart: BIZ,
      tripStart: TRIP,
      now: 1,
    });
    const raw = s.getItem(KEY);
    expect(raw).not.toContain('display');
  });

  it('走っていない時は書かない（増えていないので要らない）', () => {
    const s = store();
    const ok = P.save(s, running({ running: false, business_active: false }), {
      businessStart: null,
      tripStart: null,
      now: 1,
    });
    expect(ok).toBe(false);
    expect(s.getItem(KEY)).toBe(null);
  });

  it('★保存できない端末でも落ちない（業務を止めない）★', () => {
    const bad = {
      getItem: () => {
        throw new Error('だめ');
      },
      setItem: () => {
        throw new Error('だめ');
      },
    };
    expect(() =>
      P.save(bad, running(), { businessStart: BIZ, tripStart: TRIP, now: 1 })
    ).not.toThrow();
  });

  it('★1回の書き込みは小さい★（1秒ごとに書くので）', () => {
    const s = store();
    P.save(s, running(), { businessStart: BIZ, tripStart: TRIP, now: 1 });
    expect(s.getItem(KEY).length, '1秒ごとに書くには大きすぎる').toBeLessThan(600);
  });
});

describe('★読む（業務が一致した時だけ）★', () => {
  function saved(over) {
    const s = store();
    P.save(s, running(), { businessStart: BIZ, tripStart: TRIP, now: 1785900000000 });
    if (over) {
      const j = JSON.parse(s.getItem(KEY));
      s.setItem(KEY, JSON.stringify(Object.assign(j, over)));
    }
    return s;
  }

  it('★同じ業務なら距離が戻る（今回の穴の根治）★', () => {
    const r = P.restore(saved(), {
      businessStart: BIZ,
      tripStart: TRIP,
      now: 1785900001000,
      cur: {},
    });
    expect(r.restored, '★閉じたら距離が消える★').toBe(true);
    expect(r.distance_m).toBeCloseTo(5320.4, 1);
    expect(r.business_distance_m).toBeCloseTo(5320.4, 1);
  });

  it('★12時間を超える夜勤でも戻る（時間で切らない）★', () => {
    // 18時開始→翌9時終了=15時間。時間で切ると★一番長く働いた日に消える★
    const fifteenHours = 15 * 3600 * 1000;
    const r = P.restore(saved(), {
      businessStart: BIZ,
      tripStart: TRIP,
      now: 1785900000000 + fifteenHours,
      cur: {},
    });
    expect(r.restored, '★長い夜勤で消える＝一番まずい形★').toBe(true);
    expect(r.distance_m).toBeCloseTo(5320.4, 1);
  });

  it('★別の業務なら戻さない（前日の残骸を拾わない）★', () => {
    const r = P.restore(saved(), {
      businessStart: BIZ + 1,
      tripStart: TRIP,
      now: 1785900001000,
      cur: {},
    });
    expect(r.restored).toBe(false);
  });

  it('業務が始まっていなければ戻さない', () => {
    const r = P.restore(saved(), { businessStart: null, tripStart: null, now: 1, cur: {} });
    expect(r.restored).toBe(false);
  });

  it('★保存が未来の時刻なら戻さない（時計が狂った端末）★', () => {
    const s = saved({ saved_at: 9999999999999 });
    const r = P.restore(s, { businessStart: BIZ, tripStart: TRIP, now: 1785900001000, cur: {} });
    expect(r.restored).toBe(false);
  });

  it('保存が壊れていても落ちない', () => {
    const s = store({ [KEY]: 'こわれている' });
    expect(() =>
      P.restore(s, { businessStart: BIZ, tripStart: TRIP, now: 1, cur: {} })
    ).not.toThrow();
    expect(P.restore(s, { businessStart: BIZ, tripStart: TRIP, now: 1, cur: {} }).restored).toBe(
      false
    );
  });

  it('保存が無ければ0から始まる（今までどおり）', () => {
    const r = P.restore(store(), { businessStart: BIZ, tripStart: TRIP, now: 1, cur: {} });
    expect(r.restored).toBe(false);
  });
});

describe('★過大ゼロを守る（ここが一番危ない）★', () => {
  function saved() {
    const s = store();
    P.save(s, running(), { businessStart: BIZ, tripStart: TRIP, now: 1785900000000 });
    return s;
  }

  it('★2回戻しても2倍にならない（上書き・足し算にしない）★', () => {
    const s = saved();
    const o = { businessStart: BIZ, tripStart: TRIP, now: 1785900001000, cur: {} };
    const a = P.restore(s, o);
    const b = P.restore(s, Object.assign({}, o, { cur: { distance_m: a.distance_m } }));
    expect(b.distance_m, '★2回目で足し込まれている＝二重課金★').toBeCloseTo(5320.4, 1);
  });

  it('★今の値より小さければ戻さない（戻す＝過小方向＝安全側）★', () => {
    const r = P.restore(saved(), {
      businessStart: BIZ,
      tripStart: TRIP,
      now: 1785900001000,
      cur: { distance_m: 9000 }, // 既に9km走っている
    });
    expect(r.restored, '★9km走っているのに5.3kmに戻した＝距離が減った★').toBe(false);
  });

  it('★戻した距離が保存値を1mmも超えない★', () => {
    const r = P.restore(saved(), {
      businessStart: BIZ,
      tripStart: TRIP,
      now: 1785900001000,
      cur: {},
    });
    expect(r.distance_m).toBeLessThanOrEqual(5320.4);
    expect(r.business_distance_m).toBeLessThanOrEqual(5320.4);
  });

  it('★戻す時に料金を計算し直さない（保存時の確定値をそのまま）★', () => {
    const s = store();
    // わざと「距離と釣り合わない料金」で保存する
    P.save(s, running({ fare_yen: 1234 }), { businessStart: BIZ, tripStart: TRIP, now: 1 });
    const r = P.restore(s, { businessStart: BIZ, tripStart: TRIP, now: 2, cur: {} });
    expect(r.fare_yen, '料金を作り直している').toBe(1234);
  });
});

describe('★料金は「同じ代行」の時だけ戻す（別の代行の金を戻さない）★', () => {
  function saved() {
    const s = store();
    P.save(s, running(), { businessStart: BIZ, tripStart: TRIP, now: 1785900000000 });
    return s;
  }

  it('同じ代行なら 料金と待機時間が戻る', () => {
    const r = P.restore(saved(), {
      businessStart: BIZ,
      tripStart: TRIP,
      now: 1785900001000,
      cur: {},
    });
    expect(r.fare_yen).toBe(1850);
    expect(r.wait_sec).toBe(120);
    expect(r.fare_restored, '料金を戻したのに印が付いていない').toBe(true);
  });

  it('★別の代行なら 料金も待機時間も戻さない（距離だけ戻す）★', () => {
    const r = P.restore(saved(), {
      businessStart: BIZ,
      tripStart: TRIP + 1, // 別の代行
      now: 1785900001000,
      cur: {},
    });
    expect(r.restored, '距離は戻ってよい').toBe(true);
    expect(r.fare_yen, '★別の代行の料金を戻している★').toBe(null);
    expect(r.wait_sec, '★別の代行の待機時間を戻している★').toBe(null);
    expect(r.fare_restored).toBe(false);
  });

  it('代行が始まっていなければ料金は戻さない', () => {
    const r = P.restore(saved(), {
      businessStart: BIZ,
      tripStart: null,
      now: 1785900001000,
      cur: {},
    });
    expect(r.fare_yen).toBe(null);
    expect(r.fare_restored).toBe(false);
  });
});

describe('★黙って金額を戻さない（運転手が目で見て止められる）★', () => {
  it('料金を戻したら、画面に出す文が付いてくる', () => {
    const s = store();
    P.save(s, running(), { businessStart: BIZ, tripStart: TRIP, now: 1785900000000 });
    const r = P.restore(s, { businessStart: BIZ, tripStart: TRIP, now: 1785900001000, cur: {} });
    expect(r.notice, '★金額が戻ったのに何も出ない★').toBeTruthy();
    expect(r.notice).toContain('前回の続きから');
    expect(r.notice).toContain('1,850円');
    expect(r.notice).toContain('5.3km');
  });

  it('★料金を戻していない時は「続きから」を出さない★（嘘の表示をしない）', () => {
    const s = store();
    P.save(s, running(), { businessStart: BIZ, tripStart: TRIP, now: 1785900000000 });
    const r = P.restore(s, {
      businessStart: BIZ,
      tripStart: TRIP + 1,
      now: 1785900001000,
      cur: {},
    });
    expect(r.fare_restored).toBe(false);
    expect(r.notice || '', '料金を戻していないのに「続きから」と出している').not.toContain('円');
  });

  it('何も戻さなかった時は文も出さない', () => {
    const r = P.restore(store(), { businessStart: BIZ, tripStart: TRIP, now: 1, cur: {} });
    expect(r.notice).toBeFalsy();
  });
});
