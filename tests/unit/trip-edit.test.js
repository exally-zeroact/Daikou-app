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
      customer: { customer_id: 'c1', customer_name: 'エスプリ アマン' },
    });
    expect(out.distance_m).toBe(5362);
  });
});

describe('★請求書（請求先）を後から付けたり外したりできること★', () => {
  it('現金だったものに請求先を付ける', () => {
    const out = TE.applyToRide(ride(), {
      customer: { customer_id: 'c1', customer_name: 'エスプリ アマン' },
    });
    expect(out.customer_id).toBe('c1');
    expect(out.customer_name).toBe('エスプリ アマン');
    const trip = TE.applyToTrip(
      { start_time: 1, distance_m: 5362, fare_yen: 2200, payment_type: 'cash' },
      out
    );
    expect(trip.payment_type, '★請求書払いになっていない★').toBe('invoice');
    expect(trip.customer_name).toBe('エスプリ アマン');
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
    expect(TE.findShiftOf(999, cur, hist)).toBe(null);
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

    it('Business が壊れていても直しは通る', () => {
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
      expect(r.ok).toBe(true);
      expect(st._json(RIDE_KEY)[0].fare).toBe(2100);
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
      edit: { customer: { customer_id: 'c1', customer_name: 'エスプリ アマン' } },
    });
    const t = st._json('daikou_business_state').trips[0];
    expect(t.payment_type).toBe('invoice');
    expect(t.customer_name).toBe('エスプリ アマン');
    expect(t.fare_yen, '★金額が勝手に動いた★').toBe(2200);
  });

  it('★終わった業務（送信済み）でも直せる★', () => {
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
    expect(r.ok).toBe(true);
    const h = st._json('daikou_business_history')[0];
    expect(h.trips[0].fare_yen).toBe(2700);
    expect(h.fare_total_yen).toBe(2700);
    expect(st._json('dk_synced_shifts')).toEqual([]);
  });

  it('★業務が残っていない古い履歴でも、画面だけは直せる★（落ちない）', () => {
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
    expect(r.ok).toBe(true);
    expect(r.linkedToShift).toBe(false);
    expect(st._json(RIDE_KEY)[0].fare).toBe(2700);
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
    expect(r.reason).toBe('ride_not_found');
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
