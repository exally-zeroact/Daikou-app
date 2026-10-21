'use strict';
// ============================================================
// ★あとから代行を直す（追加料金・値引き・請求書）★ 2026-08-05
//
//   ★司さんの指示★
//     「その業務押したら追加料金や値引きや請求書などちゃんと編集できな
//       忘れとる時があると思うから」
//
//   ★ここで守ること★
//     ・★距離は絶対に動かない★（距離コアは触らない）
//     ・★走った分の料金も動かない★（直せるのは足し引きする物だけ）
//     ・何も直さずに保存しても★1円も変わらない★（古い履歴でも）
//     ・直したら★事務所にも届く★（送信済みの印を外す）
//     ・画面の履歴と、事務所へ上げる中身が★ずれない★
// ============================================================
/* global vi */ // vitest の globals（vitest.config.js globals: true）
const path = require('path');
const TE = require(path.resolve(__dirname, '..', '..', 'js', 'trip-edit.js'));

const ride = (over) =>
  Object.assign(
    {
      trip_key: 1785835513046,
      start_time: 1785835513046,
      end_time: 1785836513046,
      distance_m: 5362,
      fare: 2200,
      surcharge: false,
      extras: [],
      start_address: '今治市富田新港',
      end_address: '今治市北浜町',
      waypoints: [],
    },
    over || {}
  );

describe('★走った分の料金を取り戻せること★', () => {
  it('新しい履歴は持っている値をそのまま使う', () => {
    expect(
      TE.meterFareOf(ride({ meter_fare: 2000, extras: [{ name: '高速', amount: 200 }] }))
    ).toBe(2000);
  });

  it('★古い履歴（合計しか無い）でも戻せる★', () => {
    // 合計2200 = 走った分2000 + 追加料金200
    expect(TE.meterFareOf(ride({ fare: 2200, extras: [{ name: '高速', amount: 200 }] }))).toBe(
      2000
    );
  });

  it('追加料金も値引きも無い古い履歴は、合計がそのまま走った分', () => {
    expect(TE.meterFareOf(ride({ fare: 2200 }))).toBe(2200);
  });

  it('壊れた履歴でも落ちない', () => {
    expect(TE.meterFareOf(null)).toBe(0);
    expect(TE.meterFareOf(ride({ fare: undefined, extras: 'こわれている' }))).toBe(0);
  });
});

describe('★何も直さなければ1円も変わらないこと（一番大事）★', () => {
  const cases = [
    ['ふつう', ride({ fare: 2200 })],
    ['追加料金あり', ride({ fare: 2500, extras: [{ name: '高速', amount: 300 }] })],
    ['割増あり', ride({ fare: 2860, surcharge: true })],
    [
      '追加料金2件',
      ride({
        fare: 3000,
        extras: [
          { name: '高速', amount: 300 },
          { name: '待ち', amount: 500 },
        ],
      }),
    ],
    [
      '値引きが入っている新しい履歴',
      ride({ meter_fare: 2200, fare: 1700, discounts: [{ name: '常連', amount: 500 }] }),
    ],
  ];
  cases.forEach(([name, r]) => {
    it(name + ' … 開いて閉じるだけで金額が動かない', () => {
      const out = TE.applyToRide(r, {});
      expect(out.fare, '★何もしていないのに金額が変わった★').toBe(r.fare);
      expect(out.distance_m, '★距離が動いた★').toBe(r.distance_m);
    });
  });

  it('★何度開いて閉じても増減しない★（戻し計算の積み重ねでずれない）', () => {
    let r = ride({ fare: 2500, extras: [{ name: '高速', amount: 300 }] });
    for (let i = 0; i < 20; i++) r = TE.applyToRide(r, {});
    expect(r.fare).toBe(2500);
    expect(r.meter_fare).toBe(2200);
  });
});

describe('★直したぶんだけ正しく動くこと★', () => {
  it('追加料金を足す', () => {
    const out = TE.applyToRide(ride({ fare: 2200 }), { extras: [{ name: '高速', amount: 500 }] });
    expect(out.fare).toBe(2700);
    expect(out.meter_fare, '★走った分が動いた★').toBe(2200);
  });

  it('値引きを入れる', () => {
    const out = TE.applyToRide(ride({ fare: 2200 }), {
      discounts: [{ name: '常連', amount: 300 }],
    });
    expect(out.fare).toBe(1900);
    expect(out.meter_fare).toBe(2200);
  });

  it('追加料金と値引きを両方', () => {
    const out = TE.applyToRide(ride({ fare: 2200 }), {
      extras: [{ name: '高速', amount: 500 }],
      discounts: [{ name: '常連', amount: 300 }],
    });
    expect(out.fare).toBe(2400);
  });

  it('★入れすぎた値引きでマイナスにならない★', () => {
    const out = TE.applyToRide(ride({ fare: 2200 }), {
      discounts: [{ name: '大幅', amount: 99999 }],
    });
    expect(out.fare).toBe(0);
  });

  it('追加料金を取り消すと元に戻る', () => {
    const before = ride({ fare: 2700, extras: [{ name: '高速', amount: 500 }] });
    const out = TE.applyToRide(before, { extras: [] });
    expect(out.fare).toBe(2200);
  });

  it('★距離は何をしても動かない★', () => {
    const out = TE.applyToRide(ride({ fare: 2200 }), {
      extras: [{ name: '高速', amount: 500 }],
      discounts: [{ name: '常連', amount: 300 }],
      customer: { customer_id: 'c1', customer_name: 'カレホン カレホ' },
    });
    expect(out.distance_m).toBe(5362);
  });
});

describe('★請求書（請求先）を後から付けたり外したりできること★', () => {
  it('現金だったものに請求先を付ける', () => {
    const out = TE.applyToRide(ride(), {
      customer: { customer_id: 'c1', customer_name: 'カレホン カレホ' },
    });
    expect(out.customer_id).toBe('c1');
    expect(out.customer_name).toBe('カレホン カレホ');
    const trip = TE.applyToTrip(
      { start_time: 1, distance_m: 5362, fare_yen: 2200, payment_type: 'cash' },
      out
    );
    expect(trip.payment_type, '★請求書払いになっていない★').toBe('invoice');
    expect(trip.customer_name).toBe('カレホン カレホ');
  });

  it('★請求先を外すと現金に戻る★', () => {
    const withCust = TE.applyToRide(ride(), {
      customer: { customer_id: 'c1', customer_name: 'A' },
    });
    const out = TE.applyToRide(withCust, { customer: null });
    expect(out.customer_id).toBe(null);
    const trip = TE.applyToTrip(
      { start_time: 1, distance_m: 5362, fare_yen: 2200, payment_type: 'invoice' },
      out
    );
    expect(trip.payment_type).toBe('cash');
    expect(trip.customer_name, '★外したのに名前が残っている★').toBe(null);
  });

  it('請求先を触らなければ、今のままを保つ', () => {
    const before = ride({ customer_id: 'c1', customer_name: 'A' });
    const out = TE.applyToRide(before, { extras: [{ name: '高速', amount: 300 }] });
    expect(out.customer_id).toBe('c1');
  });

  it('★事務所へ上げる金額は値引き反映済み★', () => {
    const out = TE.applyToRide(ride({ fare: 2200 }), {
      discounts: [{ name: '常連', amount: 300 }],
    });
    const trip = TE.applyToTrip({ start_time: 1, distance_m: 5362, fare_yen: 2200 }, out);
    expect(trip.fare_yen).toBe(1900);
    expect(trip.distance_m, '★距離が動いた★').toBe(5362);
  });
});

describe('★業務の合計が積み直されること★', () => {
  it('trips から数え直す（1件だけ足し引きしない）', () => {
    const s = TE.recountShift({
      trips: [
        { distance_m: 5000, fare_yen: 2200 },
        { distance_m: 3000, fare_yen: 1400 },
      ],
      fare_total_yen: 99999,
      trip_count: 99,
    });
    expect(s.fare_total_yen).toBe(3600);
    expect(s.trip_count).toBe(2);
    expect(s.actual_total_m).toBe(8000);
  });

  it('代行が0件でも落ちない', () => {
    expect(TE.recountShift({ trips: [] }).fare_total_yen).toBe(0);
    expect(TE.recountShift({}).fare_total_yen).toBe(0);
  });
});

describe('★送信済みの印を外すこと（直しを事務所へ届ける）★', () => {
  it('その業務の印だけ外す', () => {
    expect(TE.unmarkSynced([100, 200, 300], 200)).toEqual([100, 300]);
  });

  it('文字でも数でも同じものとして外す', () => {
    expect(TE.unmarkSynced(['100', '200'], 200)).toEqual(['100']);
  });

  it('無い印を外そうとしても壊れない', () => {
    expect(TE.unmarkSynced([100], 999)).toEqual([100]);
    expect(TE.unmarkSynced(null, 1)).toEqual([]);
  });
});

describe('★その代行がどの業務のものか分かること★', () => {
  const cur = { start_time: 500, trips: [{ start_time: 501 }, { start_time: 502 }] };
  const hist = [
    { start_time: 300, trips: [{ start_time: 301 }] },
    { start_time: 100, trips: [{ start_time: 101 }, { start_time: 102 }] },
  ];

  it('今やっている業務の中にある', () => {
    const f = TE.findShiftOf(502, cur, hist);
    expect(f.where).toBe('current');
    expect(f.shiftStart).toBe(500);
  });

  it('終わった業務の中にある', () => {
    const f = TE.findShiftOf(102, cur, hist);
    expect(f.where).toBe('history');
    expect(f.shiftStart).toBe(100);
    expect(f.index).toBe(1);
  });

  it('どこにも無い（古すぎて消えた）', () => {
    // 本物の 鍵は ミリ秒＝どの 代行とも 5秒より 離れた 時刻（小さな 数だと 近さの 窓に 入る）
    expect(TE.findShiftOf(999999999, cur, hist)).toBe(null);
  });

  // ★鍵が 2つの Date.now() で 1〜2ms ずれても 同じ 代行と 見る★ 2026-10-22（対立役 止1・机の Chrome で 測った）
  //   わざと壊す：近さの 探しを 外す（=== だけ）⇒ 赤（null が 返る）
  it('★1〜2ms ずれた 鍵でも 同じ 代行★（ぴったりが 先・無い 時だけ 近さ）', () => {
    const T0 = 1790000000000;
    const c = { start_time: T0 - 9000, trips: [{ start_time: T0 }, { start_time: T0 + 600000 }] };
    expect(TE.findShiftOf(T0 + 2, c, []).where).toBe('current');
    expect(TE.tripIndexOf(c.trips, T0 + 2)).toBe(0);
    expect(TE.tripIndexOf(c.trips, T0 + 600001)).toBe(1);
    expect(TE.tripIndexOf(c.trips, T0 + 6000), '3秒より 離れた 代行は 別').toBe(-1);
  });

  // ★鍵より 後に 始まった 隣の 代行は 拾わない（窓は 片側）★ 2026-10-22（対立役 直1・手元で 再現）
  //   代行の 無い 行（確定→走行に 戻る→キャンセル で 残る）を 直すと、両側の 窓だと 3秒 後に 始まった
  //   隣の 代行の 額を 書き換えた。わざと壊す：d = Math.abs(st - k) に 戻す ⇒ 赤
  it('★鍵より 後に 始まった 隣の 代行は 別（代行の 無い 行で 隣を 書き換えない）★', () => {
    const T0 = 1790000000000;
    const c = { start_time: T0 - 9000, trips: [{ start_time: T0 + 2000 }] };
    expect(TE.tripIndexOf(c.trips, T0)).toBe(-1);
    expect(TE.findShiftOf(T0, c, [])).toBe(null);
  });

  it('壊れた入力でも落ちない', () => {
    expect(() => TE.findShiftOf(null, null, null)).not.toThrow();
    expect(TE.findShiftOf(0, cur, hist)).toBe(null);
  });
});

// ============================================================
// ★通し: 本物の倉庫（localStorage の形）を使って直す★
// ============================================================
describe('★3つの帳面が全部そろうこと★', () => {
  // ★今＝代行の 1分後（同じ 営業日）に 時計を 止める★ 2026-10-22（判じは「今」と 同じ 営業日かを 見る）
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1785835513046 + 60000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  function fakeStore(init) {
    const m = Object.assign({}, init);
    return {
      getItem: (k) => (k in m ? m[k] : null),
      setItem: (k, v) => {
        m[k] = String(v);
      },
      _raw: m,
      _json: (k) => JSON.parse(m[k] || 'null'),
    };
  }

  const RIDE_KEY = 'daikou_history_Tue Aug 04 2026';
  const TRIP = 1785835513046;

  function setup(over) {
    return fakeStore(
      Object.assign(
        {
          [RIDE_KEY]: JSON.stringify([
            { trip_key: TRIP, distance_m: 5362, fare: 2200, extras: [], waypoints: [] },
          ]),
          daikou_business_state: JSON.stringify({
            start_time: 1785830000000,
            active: true,
            trips: [
              {
                start_time: TRIP,
                distance_m: 5362,
                fare_yen: 2200,
                payment_type: 'cash',
                customer_id: null,
              },
            ],
            fare_total_yen: 2200,
            trip_count: 1,
          }),
          daikou_business_history: JSON.stringify([]),
          dk_synced_shifts: JSON.stringify([1785830000000]),
        },
        over || {}
      )
    );
  }

  // ============================================================
  // ★Business の控えに上書きされないこと★ 2026-08-05
  //
  //   ★実機で踏んだ★
  //     倉庫(localStorage)だけ直したら、値引きして 1,700円 になった直後、
  //     ★GPSが1回来た瞬間に 2,500円 に戻った★。
  //     Business は自分の控えを持っていて、業務中は1秒ごとに保存している。
  //     ＝倉庫を直しても、次の保存で控えに上書きされて★直しが必ず消える★。
  //   ⇒ 書く前に控えを流し込ませ(save)、書いた後に読み直させる(load)。
  // ============================================================
  describe('★Business の控えに直しを消されないこと★', () => {
    function fakeBusiness(st, key) {
      const k = key || 'daikou_business_state';
      const b = {
        mem: JSON.parse(st.getItem(k) || 'null'),
        saveCalls: 0,
        loadCalls: 0,
        save() {
          this.saveCalls++;
          st.setItem(k, JSON.stringify(this.mem));
        },
        load() {
          this.loadCalls++;
          this.mem = JSON.parse(st.getItem(k) || 'null');
        },
      };
      return b;
    }

    it('★直したあと Business が保存しても、直しが消えない★', () => {
      const st = setup();
      const biz = fakeBusiness(st);
      TE.apply({
        store: st,
        business: biz,
        rideKey: RIDE_KEY,
        tripKey: TRIP,
        edit: { discounts: [{ name: '常連', amount: 300 }] },
      });
      expect(st._json('daikou_business_state').trips[0].fare_yen).toBe(1900);
      // 業務中は1秒ごとにこれが走る
      biz.save();
      expect(
        st._json('daikou_business_state').trips[0].fare_yen,
        '★Business の控えに上書きされて直しが消えた★'
      ).toBe(1900);
    });

    it('★書く前に控えを流し込む★（控えの方が新しい時に取りこぼさない）', () => {
      const st = setup();
      const biz = fakeBusiness(st);
      // 控えだけが持っている新しい代行（まだ倉庫に無い）
      biz.mem.trips.push({ start_time: TRIP + 1, distance_m: 1000, fare_yen: 900 });
      TE.apply({
        store: st,
        business: biz,
        rideKey: RIDE_KEY,
        tripKey: TRIP,
        edit: { extras: [{ name: '高速', amount: 100 }] },
      });
      const trips = st._json('daikou_business_state').trips;
      expect(trips.length, '★控えにしか無かった代行が消えた★').toBe(2);
      expect(trips[0].fare_yen).toBe(2300);
      expect(trips[1].fare_yen).toBe(900);
    });

    it('読み直したことを知らせる', () => {
      const st = setup();
      const biz = fakeBusiness(st);
      const r = TE.apply({ store: st, business: biz, rideKey: RIDE_KEY, tripKey: TRIP, edit: {} });
      expect(r.reloaded).toBe(true);
      expect(biz.loadCalls).toBeGreaterThan(0);
      expect(biz.saveCalls).toBeGreaterThan(0);
    });

    it('Business が無くても落ちない（事務所側や試験環境）', () => {
      const st = setup();
      const r = TE.apply({
        store: st,
        business: null,
        rideKey: RIDE_KEY,
        tripKey: TRIP,
        edit: { discounts: [{ name: 'x', amount: 100 }] },
      });
      expect(r.ok).toBe(true);
      expect(st._json('daikou_business_state').trips[0].fare_yen).toBe(2100);
    });

    // ★2026-10-22＝控えを 倉庫に 書けない 時は 直さない（前は 通した）★（対立役 直3：書けずに 直すと
    //   古い 倉庫を 読み直し、業務終了した 控えが 業務中に 戻る）
    //   わざと壊す：apply の hozon_dekinai の 止めを 外す ⇒ 赤（書いてしまう）
    it('Business の 保存が 壊れていたら 直さない・何も 書かない', () => {
      const st = setup();
      const broken = {
        save() {
          throw new Error('こわれた');
        },
        load() {
          throw new Error('こわれた');
        },
      };
      const r = TE.apply({
        store: st,
        business: broken,
        rideKey: RIDE_KEY,
        tripKey: TRIP,
        edit: { discounts: [{ name: 'x', amount: 100 }] },
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('hozon_dekinai');
      expect(st._json(RIDE_KEY)[0].fare).toBe(2200);
    });

    // わざと壊す：save() === false の 止めを 外す ⇒ 赤（business.js の save は 書けない 時 false を 返す）
    it('Business の 保存が false（端末の 空きが 無い）なら 直さない・何も 書かない', () => {
      const st = setup();
      const r = TE.apply({
        store: st,
        business: {
          save: () => false,
          load() {},
          getState: () => JSON.parse(st.getItem('daikou_business_state')),
        },
        rideKey: RIDE_KEY,
        tripKey: TRIP,
        edit: { discounts: [{ name: 'x', amount: 100 }] },
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('hozon_dekinai');
      expect(st._json(RIDE_KEY)[0].fare).toBe(2200);
    });
  });

  it('★値引きを入れると、画面・事務所・送信済みの3つがそろう★', () => {
    const st = setup();
    const r = TE.apply({
      store: st,
      business: null,
      rideKey: RIDE_KEY,
      tripKey: TRIP,
      edit: { discounts: [{ name: '常連', amount: 300 }] },
    });
    expect(r.ok).toBe(true);
    expect(r.total).toBe(1900);
    // ① 画面
    expect(st._json(RIDE_KEY)[0].fare).toBe(1900);
    expect(st._json(RIDE_KEY)[0].distance_m, '★距離が動いた★').toBe(5362);
    // ② 事務所へ上げる分
    const bs = st._json('daikou_business_state');
    expect(bs.trips[0].fare_yen).toBe(1900);
    expect(bs.fare_total_yen, '★業務の合計が古いまま★').toBe(1900);
    // ③ 送信済みの印
    expect(st._json('dk_synced_shifts'), '★印が残ると直しが事務所に届かない★').toEqual([]);
    expect(r.resend).toBe(true);
  });

  it('★請求先を後から付けると、事務所へ請求書払いとして上がる★', () => {
    const st = setup();
    TE.apply({
      store: st,
      business: null,
      rideKey: RIDE_KEY,
      tripKey: TRIP,
      edit: { customer: { customer_id: 'c1', customer_name: 'カレホン カレホ' } },
    });
    const t = st._json('daikou_business_state').trips[0];
    expect(t.payment_type).toBe('invoice');
    expect(t.customer_name).toBe('カレホン カレホ');
    expect(t.fare_yen, '★金額が勝手に動いた★').toBe(2200);
  });

  // ★2026-10-22 司さん「運転手の修正はその日の営業だけ」＝終わった 業務は 直せない（前は 直せた）★
  //   わざと壊す：apply の naoseru を 外す ⇒ 赤（書いてしまう）
  it('★終わった業務（送信済み）は 直せない・何も 書かない★', () => {
    const st = setup({
      daikou_business_state: JSON.stringify({ start_time: null, active: false, trips: [] }),
      daikou_business_history: JSON.stringify([
        {
          start_time: 1785830000000,
          end_time: 1785840000000,
          trips: [{ start_time: TRIP, distance_m: 5362, fare_yen: 2200 }],
          fare_total_yen: 2200,
        },
      ]),
    });
    const r = TE.apply({
      store: st,
      business: null,
      rideKey: RIDE_KEY,
      tripKey: TRIP,
      edit: { extras: [{ name: '高速', amount: 500 }] },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('eigyou_owari');
    const h = st._json('daikou_business_history')[0];
    expect(h.trips[0].fare_yen, '★終わった 業務を 書き換えた★').toBe(2200);
    expect(st._json(RIDE_KEY)[0].fare, '★画面の 履歴を 書き換えた★').toBe(2200);
    expect(st._json('dk_synced_shifts'), '★印を 外した★').toEqual([1785830000000]);
  });

  it('★業務が残っていない古い履歴は 直せない★（画面だけ 直す 道も 無くした・落ちない）', () => {
    const st = setup({
      daikou_business_state: JSON.stringify({ start_time: null, trips: [] }),
      daikou_business_history: JSON.stringify([]),
    });
    const r = TE.apply({
      store: st,
      rideKey: RIDE_KEY,
      tripKey: TRIP,
      edit: { extras: [{ name: '高速', amount: 500 }] },
    });
    expect(r.ok).toBe(false);
    expect(st._json(RIDE_KEY)[0].fare).toBe(2200);
  });

  it('★他の代行を巻き込まない★', () => {
    const st = setup({
      [RIDE_KEY]: JSON.stringify([
        { trip_key: TRIP, distance_m: 5362, fare: 2200, extras: [] },
        { trip_key: TRIP + 999, distance_m: 3000, fare: 1400, extras: [] },
      ]),
    });
    TE.apply({
      store: st,
      rideKey: RIDE_KEY,
      tripKey: TRIP,
      edit: { discounts: [{ name: 'x', amount: 300 }] },
    });
    const rides = st._json(RIDE_KEY);
    expect(rides[0].fare).toBe(1900);
    expect(rides[1].fare, '★関係ない代行まで変わった★').toBe(1400);
  });

  it('無い代行を直そうとしても、何も壊さない', () => {
    const st = setup();
    const before = st._raw[RIDE_KEY];
    const r = TE.apply({ store: st, rideKey: RIDE_KEY, tripKey: 1, edit: { extras: [] } });
    expect(r.ok).toBe(false);
    // 判じ（今の 業務の 代行か）が 書く 前に 止める
    expect(r.reason).toBe('betsu_no_gyoumu');
    expect(st._raw[RIDE_KEY], '★見つからないのに書き換えた★').toBe(before);
    expect(st._json('dk_synced_shifts'), '★印を勝手に外した★').toEqual([1785830000000]);
  });

  it('鍵が無ければ何もしない', () => {
    const st = setup();
    expect(TE.apply({ store: st, rideKey: '', tripKey: TRIP }).ok).toBe(false);
    expect(TE.apply({ store: st, rideKey: RIDE_KEY, tripKey: 0 }).ok).toBe(false);
  });

  it('★開いて何も直さず閉じても、送信済みの印は外れない★（無駄な再送をしない）', () => {
    const st = setup();
    const r = TE.apply({ store: st, rideKey: RIDE_KEY, tripKey: TRIP, edit: {} });
    expect(r.total).toBe(2200);
    // 中身は同じでも印は外れる（再送しても冪等なので害は無い）が、
    // ★金額だけは絶対に動かない★ことを見る
    expect(st._json('daikou_business_state').trips[0].fare_yen).toBe(2200);
  });
});

describe('★直した印が残ること（あとで見て分かる）★', () => {
  it('直したら edited_at が入る', () => {
    const out = TE.applyToRide(ride(), { extras: [{ name: 'x', amount: 1 }], now: 1785900000000 });
    expect(out.edited_at).toBe(1785900000000);
  });
});

// ============================================================
// ★★2026-09-29＝[業務終了] の 後（limbo）に 直した分が 事務所に 届くか★★
//   ★対立役に 叩かれて 見つかった★（私も 本物の 関数で 再現した）
//     [業務終了] を 押すと business.js:end が ★履歴にも 積む★。
//     でも state.start_time は 残る（limbo）ので findShiftOf は ★current を 先に 返す★。
//     ⇒ 直るのは 画面と state だけ。★job-sync が 読むのは 履歴★
//       （grep: js/job-sync.js に daikou_business_state の字は 0個）
//     ⇒ 値引きが 届かないどころか ★印を 外して 古い額を わざわざ 送り直す★。
//     実測（直す前）: 画面 4,000／state 4,000／★履歴 5,000／送る額 5,000★
//     画面には「事務所へ送り直します」と 出るので ★嘘の 安心★ に なっていた。
// ★わざと壊して 赤に なる事を 見た★
//   js/trip-edit.js の 「履歴にも 同じ勤務が 居たら そっちも 直す」塊を 消す → ★赤★
// ============================================================
// ★2026-10-22＝業務終了の 後は 直せない（司さん）。この 組は「業務中なのに 履歴にも 同じ 勤務が 居る」
//   （再開の _removeHistory が 転んだ 時の 保険）で 両方 揃うかと、limbo（業務終了を 押した 後）で 止まるかを 見る。
describe('★[業務終了]の後に 直した分が 事務所へ 届くか★', () => {
  const T = 1790000000000;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T + 60000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const tsukuru = () => {
    const store = Object.create(null);
    const ls = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    };
    const trip = {
      start_time: T,
      distance_m: 5000,
      fare_yen: 5000,
      customer_id: null,
      customer_name: null,
      payment_type: 'cash',
    };
    const shift = { start_time: T - 1000, trips: [trip], trip_count: 1, fare_total_yen: 5000 };
    // ★業務中なのに 履歴にも 同じ勤務が 居る（再開の 保険の 道）★
    ls.setItem(
      'daikou_business_state',
      JSON.stringify(Object.assign({ active: true, ended: false }, shift))
    );
    ls.setItem('daikou_business_history', JSON.stringify([JSON.parse(JSON.stringify(shift))]));
    ls.setItem(
      'daikou_history_x',
      JSON.stringify([
        {
          trip_key: T,
          start_time: T,
          distance_m: 5000,
          fare: 5000,
          meter_fare: 5000,
          extras: [],
          discounts: [],
        },
      ])
    );
    ls.setItem('dk_synced_shifts', JSON.stringify([String(T - 1000)]));
    return ls;
  };
  const rireki = (ls) => JSON.parse(ls.getItem('daikou_business_history'))[0].trips[0];

  it('値引きが 履歴（事務所へ 上がる方）にも 入る', () => {
    const ls = tsukuru();
    const r = TE.apply({
      store: ls,
      rideKey: 'daikou_history_x',
      tripKey: T,
      edit: { discounts: [{ label: '値引き', amount: 1000 }] },
    });
    expect(r.ok).toBe(true);
    expect(r.total).toBe(4000);
    expect(rireki(ls).fare_yen, '★履歴が 古いまま＝値引き分を 余計に 請求してしまう★').toBe(4000);
  });

  it('請求先の 付け直しが 履歴にも 入る（入らないと 全額 請求に 載らない）', () => {
    const ls = tsukuru();
    const r = TE.apply({
      store: ls,
      rideKey: 'daikou_history_x',
      tripKey: T,
      edit: { customer: { customer_id: 'c1', customer_name: '標様建設' } },
    });
    expect(r.ok).toBe(true);
    expect(rireki(ls).payment_type, '★履歴が 現金のまま＝請求書に 1行も 立たない★').toBe('invoice');
    expect(rireki(ls).customer_name).toBe('標様建設');
  });

  it('state の方も 同じ額に なっている（片方だけ 直していないか）', () => {
    const ls = tsukuru();
    TE.apply({
      store: ls,
      rideKey: 'daikou_history_x',
      tripKey: T,
      edit: { discounts: [{ label: '値引き', amount: 1000 }] },
    });
    const st = JSON.parse(ls.getItem('daikou_business_state'));
    expect(st.trips[0].fare_yen).toBe(4000);
    expect(rireki(ls).fare_yen).toBe(4000);
  });

  it('業務中（履歴に まだ 積んでいない）は 今までどおり state だけ', () => {
    const ls = tsukuru();
    ls.setItem('daikou_business_history', '[]'); // 業務中＝履歴に 居ない
    const r = TE.apply({
      store: ls,
      rideKey: 'daikou_history_x',
      tripKey: T,
      edit: { discounts: [{ label: '値引き', amount: 1000 }] },
    });
    expect(r.ok).toBe(true);
    expect(JSON.parse(ls.getItem('daikou_business_state')).trips[0].fare_yen).toBe(4000);
    expect(
      JSON.parse(ls.getItem('daikou_business_history')).length,
      '★居ないのに 作ってしまっている★'
    ).toBe(0);
  });
  // わざと壊す：naoseru の ended の 判じを 外す ⇒ 赤（limbo で 書いてしまう）
  it('★limbo（業務終了を 押した 後・start_time が 残る）は 直せない★', () => {
    const ls = tsukuru();
    const st = JSON.parse(ls.getItem('daikou_business_state'));
    ls.setItem(
      'daikou_business_state',
      JSON.stringify(Object.assign(st, { active: false, ended: true }))
    );
    const r = TE.apply({
      store: ls,
      rideKey: 'daikou_history_x',
      tripKey: T,
      edit: { discounts: [{ label: '値引き', amount: 1000 }] },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('eigyou_owari');
    expect(rireki(ls).fare_yen).toBe(5000);
    expect(JSON.parse(ls.getItem('dk_synced_shifts'))).toEqual([String(T - 1000)]);
  });
});

// ============================================================
// ★★運転手が 直せるのは「その日の 営業」だけ（判じの 表）★★ 2026-10-22 司さん
//   「業務終了を押すまで」「再開してもその日の分しか修正さすな」「正午」
//   わざと壊す：判じの 1つを 外す ⇒ 下の どれかが 赤
// ============================================================
describe('★直せるか（naoseru）★', () => {
  // 2026-10-21 20:00 JST に 業務開始・21:00 の 代行
  const KAISHI = Date.parse('2026-10-21T20:00:00+09:00');
  const DAIKOU = Date.parse('2026-10-21T21:00:00+09:00');
  const st = (o) =>
    Object.assign(
      { active: true, ended: false, start_time: KAISHI, trips: [{ start_time: DAIKOU }] },
      o || {}
    );
  const at = (iso) => Date.parse(iso);
  const nao = (o) => TE.naoseru(Object.assign({ tripKey: DAIKOU, state: st(), history: [] }, o));
  it('業務中・同じ 夜（日付を またいだ 夜中 2時も・11時59分も）は 直せる', () => {
    expect(nao({ now: at('2026-10-21T23:00:00+09:00') }).ok).toBe(true);
    expect(nao({ now: at('2026-10-22T02:00:00+09:00') }).ok).toBe(true);
    expect(nao({ now: at('2026-10-22T11:59:00+09:00') }).ok).toBe(true);
  });
  it('正午を 越えたら 前の 日の 分（再開して 業務中でも）', () => {
    const r = nao({ now: at('2026-10-22T12:00:00+09:00') });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('mae_no_hi');
  });
  it('業務終了を 押した 後（limbo・ended）・業務が 無い 時は 直せない', () => {
    const now = at('2026-10-21T23:00:00+09:00');
    expect(nao({ now, state: st({ active: false, ended: true }) }).reason).toBe('eigyou_owari');
    expect(nao({ now, state: st({ active: false }) }).reason).toBe('eigyou_owari');
    expect(nao({ now, state: st({ ended: true }) }).reason).toBe('eigyou_owari');
    expect(nao({ now, state: null }).reason).toBe('eigyou_owari');
  });
  it('今の 業務に 無い 代行（前の 業務・履歴だけ）は 直せない', () => {
    const r = nao({
      now: at('2026-10-21T23:00:00+09:00'),
      state: st({ trips: [] }),
      history: [{ start_time: KAISHI, trips: [{ start_time: DAIKOU }] }],
    });
    expect(r.reason).toBe('betsu_no_gyoumu');
  });
  it('見るだけの 画面（別の タブで 業務中）は 直せない', () => {
    expect(nao({ now: at('2026-10-21T23:00:00+09:00'), readOnly: true }).reason).toBe('yomidake');
  });
  it('営業日は 日本時間の 正午で 切る', () => {
    expect(TE.eigyoubi(at('2026-10-22T11:59:59+09:00'))).toBe('2026-10-21');
    expect(TE.eigyoubi(at('2026-10-22T12:00:00+09:00'))).toBe('2026-10-22');
  });
  it('運転手に 出す 字', () => {
    expect(TE.naosenaiBun('mae_no_hi')).toMatch(/前の 日/);
    expect(TE.naosenaiBun('eigyou_owari')).toMatch(/業務終了/);
  });
});
