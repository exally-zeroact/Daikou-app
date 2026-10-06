// ============================================================
// js/daiko-payroll.js
// ★運転代行の歩合計算（設定駆動・純ロジック）2026-08-01★
//
//   司さんの実物「代行計算表2026.xlsb」の『計算』シートの数式を、そのまま再現できる形にした物。
//   実データ3日分（1/10・1/31・2/14）と1円まで一致することをテストで固定している。
//
//   ▼司さんのやり方（既定）
//     売上合計 = 自分以外の車の売上合計 − 各車の経費
//     時数合計 = 自分以外の車の時数合計
//     積立     = 売上合計 × 5%
//     ★売上1h  = (売上合計 − 積立) ÷ 時数合計★  ← 積立を引いてから割る
//     各人の給料 = MAX( 売上1h × 役割の係数 × その人の時数 , 役割の最低保証 × その人の時数 )
//        2種 = 係数0.35 / 保証1150円   1種 = 係数0.30 / 保証1000円
//     自分の取り分 = (売上合計 − 積立 − 全員の給料) + 自分の売上 − 自分の積立 − 自分の経費
//
//   ▼「他のユーザーは違う形」への備え（司さん指示）
//     ・係数も最低保証も★全部設定★。役割は好きなだけ足せる。
//     ・母数の作り方(poolMode)を選べる:
//         others_total … 自分以外の車を合算（司さんのやり方・既定）
//         all_total    … 自分の車も入れて全台合算
//         per_car      … 車ごとに その車の売上 ÷ その車の時数
//     ・積立を引いてから割るかどうかも設定(deductReserveBeforeRate)
//
//   ▼絶対に守ること
//     ・throw しない ・0除算で NaN を出さない ・お金は勝手に丸めない（表示側で丸める）
// ============================================================
(function (global) {
  'use strict';

  function n(v) {
    const x = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(x) ? x : 0;
  }
  function arr(v) {
    return Array.isArray(v) ? v : [];
  }

  // ★司さんのやり方が既定★
  const DEFAULT_SETTINGS = {
    poolMode: 'others_total', // 母数の作り方
    deductReserveBeforeRate: true, // 積立を引いてから時数で割る
    reservePoolRate: 0.05, // 積立(みんなの売上から)
    reserveOwnerRate: 0.05, // 積立(自分の売上から)
    roles: {
      '2種': { rate: 0.35, floor: 1150 },
      '1種': { rate: 0.3, floor: 1000 },
    },
  };

  // ★★ほかの 払い方（日給・回数歩合・距離歩合・段階歩合・指定日の 割増）★★ 2026-10-06
  //   司さん「給料設定はいろんなものに対応できるようにしとんか？」「対応できるように対立でやれ」
  //   ★全部 既定は「使わない」★＝何も 決めていなければ 今の 給料と 1円も 変わらない。
  //   置き場は dk_payroll_settings.pay_extra（jsonb）。roles の jsonb に 混ぜない
  //   （roles は {rate, floor} だけに 作り直して 保存するので 混ぜると 黙って 消える＝対立役 10-06）。
  //   pay_extra = {
  //     roles: { '2種': { nikkyu, nikkyuMode:'kawari'|'tasu'|'takai', nikkyuHoshou:bool,
  //                       dankai:[{ijou, rate}] } },
  //     kaisu, kyori,               … ★1台 あたり★ 1回いくら・1kmいくら（会社で 1つ）
  //     bunpai: 'ritsu'|'touwari',  … 1台の 額を 乗った 人で どう 分けるか（役の 率の 比／人数で 等分）
  //       司さん 10-06「回数距離は1台としてやろが」＝1台で 1回だけ 額を 出し 乗った 人で 分ける
  //     kyoriShu: 'jissha'|'sou',   … 距離は 客を 乗せた 距離か 全部の 距離か
  //     kasanAto: bool,             … 回数・距離の 分を 最低保証と 比べた 後で 足すか（既定は 比べる 側）
  //     wariMode: 'buai'|'zentai',  … 指定日の 倍率を 歩合だけに 掛けるか 日の 給料 全体に 掛けるか
  //     wariHi: { 'YYYY-MM-DD': { mult, label } }
  //   }
  function normExtra(x) {
    const out = {
      roles: {},
      kaisu: 0,
      kyori: 0,
      bunpai: 'ritsu',
      kyoriShu: 'jissha',
      kasanAto: false,
      wariMode: 'buai',
      wariHi: {},
    };
    try {
      if (!x || typeof x !== 'object') return out;
      out.kaisu = n(x.kaisu);
      out.kyori = n(x.kyori);
      out.bunpai = x.bunpai === 'touwari' ? 'touwari' : 'ritsu';
      out.kyoriShu = x.kyoriShu === 'sou' ? 'sou' : 'jissha';
      out.kasanAto = x.kasanAto === true;
      out.wariMode = x.wariMode === 'zentai' ? 'zentai' : 'buai';
      const wh = x.wariHi && typeof x.wariHi === 'object' ? x.wariHi : {};
      Object.keys(wh).forEach(function (d) {
        const m = n(wh[d] && wh[d].mult);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && m > 0) {
          out.wariHi[d] = { mult: m, label: String((wh[d] && wh[d].label) || '') };
        }
      });
      const rs = x.roles && typeof x.roles === 'object' ? x.roles : {};
      Object.keys(rs).forEach(function (k) {
        const r = rs[k] || {};
        const dk = Array.isArray(r.dankai)
          ? r.dankai
              .map(function (t) {
                return { ijou: n(t && t.ijou), rate: n(t && t.rate) };
              })
              .filter(function (t) {
                return t.ijou > 0 && t.rate > 0;
              })
              .sort(function (a, b) {
                return a.ijou - b.ijou;
              })
          : [];
        out.roles[k] = {
          nikkyu: n(r.nikkyu),
          nikkyuMode: r.nikkyuMode === 'tasu' || r.nikkyuMode === 'takai' ? r.nikkyuMode : 'kawari',
          nikkyuHoshou: r.nikkyuHoshou !== false,
          dankai: dk,
        };
      });
    } catch (_) {
      /* 壊れていたら 使わない＝今の 給料の まま */
    }
    return out;
  }

  function normSettings(s) {
    try {
      const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      base.extra = normExtra(null);
      if (!s || typeof s !== 'object') return base;
      const out = {
        poolMode: typeof s.poolMode === 'string' ? s.poolMode : base.poolMode,
        deductReserveBeforeRate:
          s.deductReserveBeforeRate === undefined
            ? base.deductReserveBeforeRate
            : !!s.deductReserveBeforeRate,
        reservePoolRate:
          s.reservePoolRate === undefined ? base.reservePoolRate : n(s.reservePoolRate),
        reserveOwnerRate:
          s.reserveOwnerRate === undefined ? base.reserveOwnerRate : n(s.reserveOwnerRate),
        roles: {},
        extra: normExtra(s.extra),
      };
      const src = s.roles && typeof s.roles === 'object' ? s.roles : base.roles;
      Object.keys(src).forEach(function (k) {
        const r = src[k] || {};
        out.roles[k] = { rate: n(r.rate), floor: n(r.floor) };
      });
      if (!Object.keys(out.roles).length) out.roles = base.roles;
      return out;
    } catch (_) {
      const d = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      d.extra = normExtra(null);
      return d;
    }
  }

  // 1台ぶんの売上（経費を引いた後）
  function carNet(c) {
    return n(c && c.sales) - n(c && c.expense);
  }

  // 母数（売上と時数）を作る
  function buildPool(input, st) {
    const cars = arr(input && input.cars);
    const owner = (input && input.owner) || {};
    if (st.poolMode === 'all_total') {
      let sales = n(owner.sales) - n(owner.expense);
      let hours = n(owner.hours);
      cars.forEach(function (c) {
        sales += carNet(c);
        hours += n(c && c.hours);
      });
      return { sales: sales, hours: hours };
    }
    // others_total（既定）: 自分の車は入れない
    let sales = 0;
    let hours = 0;
    cars.forEach(function (c) {
      sales += carNet(c);
      hours += n(c && c.hours);
    });
    return { sales: sales, hours: hours };
  }

  // 1時間あたりの単価を出す
  function hourlyOf(poolSales, poolHours, reserve, st) {
    const base = st.deductReserveBeforeRate ? poolSales - reserve : poolSales;
    if (!(poolHours > 0)) return 0; // 0除算しない（NaNを出さない）
    return base / poolHours;
  }

  // ★本体★
  function compute(input, settings) {
    try {
      const st = normSettings(settings);
      const owner = (input && input.owner) || {};
      const cars = arr(input && input.cars);
      const staff = arr(input && input.staff);

      const pool = buildPool(input, st);
      const reservePool = pool.sales * st.reservePoolRate;
      const reserveOwner = (n(owner.sales) - 0) * st.reserveOwnerRate;

      // 車ごとの単価（per_car のときだけ使う）
      const perCarHourly = {};
      if (st.poolMode === 'per_car') {
        cars.forEach(function (c) {
          const net = carNet(c);
          const res = net * st.reservePoolRate;
          perCarHourly[String(c && c.id)] = hourlyOf(net, n(c && c.hours), res, st);
        });
      }

      const hourly = hourlyOf(pool.sales, pool.hours, reservePool, st);

      // ★人ごとに歩合・最低保証を変えられる (2026-08-05・司さん指示 A案)★
      //   司さん「人によって変えれるの仕組みにしてないやないか」
      //   ★空欄なら役割どおり、打てばその人だけ変わる★
      //   0 は「0にしたい」という意思なので通す。空(null/undefined/'')だけを「未指定」とする。
      const has = function (v) {
        return v !== null && v !== undefined && v !== '' && isFinite(parseFloat(v));
      };

      const ex = st.extra || normExtra(null);
      // ★指定日の 倍率★（決めていない 日は 1＝今の まま）
      const wari = ex.wariHi[(input && input.date) || ''];
      const mult = wari ? wari.mult : 1;
      const tbc = (input && input.tripsByCar) || {};

      const rows = staff.map(function (p) {
        const role = st.roles[(p && p.role) || ''] || { rate: 0, floor: 0 };
        const re = ex.roles[(p && p.role) || ''] || null;
        const hours = n(p && p.hours);
        const h = st.poolMode === 'per_car' ? n(perCarHourly[String(p && p.car)]) : hourly;
        // ★段階歩合★ その日の 売上（乗った車ごと なら その車の 売上）で 率を 決める。人の 率が 打って あれば 人が 勝つ
        let roleRate = role.rate;
        if (re && re.dankai.length) {
          let uri = pool.sales;
          if (st.poolMode === 'per_car') {
            const c0 = cars.filter(function (c) {
              return String(c && c.id) === String(p && p.car);
            })[0];
            uri = c0 ? carNet(c0) : 0;
          }
          re.dankai.forEach(function (t) {
            if (uri >= t.ijou) roleRate = t.rate;
          });
        }
        const rate = has(p && p.rate) ? n(p.rate) : roleRate;
        const floor = has(p && p.floor) ? n(p.floor) : role.floor;
        let byRate = h * rate * hours;
        let byFloor = floor * hours;
        // ★回数・距離の 歩合★ 乗った 車の その日の 回数・距離（2人で 1台＝2人とも 車の 分を 全部）
        // ★★回数・距離の 歩合は ★1台 として★★★ 2026-10-06（司さん「回数距離は1台としてやろが」）
        //   1台の 額 ＝ 回数 × 1回いくら ＋ km × 1kmいくら（1台で 1回だけ）
        //   それを その日 その車に 乗った 人で 分ける：役の 率の 比（既定）／人数で 等分
        //   乗った 人の 役は crewByCar（本人の 画面でも 同じに なるよう 倉庫の 関数が 役だけ 返す）
        let kasan = 0;
        if (ex.kaisu || ex.kyori) {
          const car = String(p && p.car);
          const t = tbc[car] || {};
          const km = n(ex.kyoriShu === 'sou' ? t.sou_m : t.jissha_m) / 1000;
          const daiGaku = ex.kaisu * n(t.trips) + ex.kyori * km;
          const crew = ((input && input.crewByCar) || {})[car] || [(p && p.role) || ''];
          if (ex.bunpai === 'touwari') {
            kasan = daiGaku / Math.max(1, crew.length);
          } else {
            const rr = function (y) {
              return n((st.roles[y] || {}).rate);
            };
            const goukei = crew.reduce(function (a, y) {
              return a + rr(y);
            }, 0);
            kasan =
              goukei > 0
                ? (daiGaku * rr((p && p.role) || '')) / goukei
                : daiGaku / Math.max(1, crew.length);
          }
        }
        // ★日給★ 代わり／足す／高い方。最低保証を 外す 時は 0 と 比べる
        let nikkyu = 0;
        if (re && re.nikkyu > 0 && hours > 0) {
          nikkyu = re.nikkyu;
          if (re.nikkyuMode === 'kawari') byRate = nikkyu;
          else if (re.nikkyuMode === 'tasu') byRate += nikkyu;
          else byRate = Math.max(byRate, nikkyu);
          if (!re.nikkyuHoshou) byFloor = 0;
        }
        if (!ex.kasanAto) byRate += kasan;
        if (mult !== 1 && ex.wariMode === 'buai') byRate *= mult;
        let pay = Math.max(byRate, byFloor);
        if (ex.kasanAto) pay += kasan;
        if (mult !== 1 && ex.wariMode === 'zentai') pay *= mult;
        return {
          name: (p && p.name) || '',
          role: (p && p.role) || '',
          hours: hours,
          hourly: h,
          rate: rate,
          floor: floor,
          // その人だけ変えているか（画面で「この人は個別」と出せるように）
          rateIsOwn: has(p && p.rate) && n(p.rate) !== role.rate,
          floorIsOwn: has(p && p.floor) && n(p.floor) !== role.floor,
          byRate: byRate, // 歩合で出した額
          byFloor: byFloor, // 最低保証で出した額
          pay: pay, // ★高い方★（＋比べた 後に 足す 分・日の 割増）
          kasan: kasan, // 回数・距離の 歩合
          nikkyu: nikkyu, // 日給
          wariMult: mult, // 指定日の 倍率（1 なら 無し）
          // ★★丸めた 後で 比べる★★ 2026-09-06（司さん「丸め込み含め最低時給になった時は赤」）
          //   ★前★ ★丸める 前★の 生の 数で 比べていた（byFloor >= byRate）
          //     ⇒ 画面と 紙は ★Math.round（1円まで）★で 出しているので
          //       例）歩合 9000.4円 / 保証 9000.0円
          //          生では 歩合が 勝ち＝黒 ／ ★出る 額は どちらも 9,000円★
          //          ＝★払った 額は 最低保証と 同じ★なのに 赤に ならなかった
          //   ★今★ ★出す 額（丸めた 後）で 比べる★＝見た 通りに なる
          //   ★払う 額（pay）は 1円も 変えていません★（Math.max のまま）
          usedFloor: Math.round(byFloor) >= Math.round(byRate), // 保証が勝ったか（★丸めた後★）
        };
      });

      const staffTotal = rows.reduce(function (a, r) {
        return a + r.pay;
      }, 0);

      // 自分の取り分
      const ownerShare =
        pool.sales - reservePool - staffTotal + n(owner.sales) - reserveOwner - n(owner.expense);

      return {
        poolSales: pool.sales,
        poolHours: pool.hours,
        reservePool: reservePool,
        reserveOwner: reserveOwner,
        hourly: hourly,
        staff: rows,
        staffTotal: staffTotal,
        ownerShare: ownerShare,
      };
    } catch (_) {
      return {
        poolSales: 0,
        poolHours: 0,
        reservePool: 0,
        reserveOwner: 0,
        hourly: 0,
        staff: [],
        staffTotal: 0,
        ownerShare: 0,
      };
    }
  }

  const api = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    normSettings: normSettings,
    compute: compute,
  };

  if (global) global.DaikoPayroll = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
