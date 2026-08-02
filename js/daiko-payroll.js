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

  function normSettings(s) {
    try {
      const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
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
      };
      const src = s.roles && typeof s.roles === 'object' ? s.roles : base.roles;
      Object.keys(src).forEach(function (k) {
        const r = src[k] || {};
        out.roles[k] = { rate: n(r.rate), floor: n(r.floor) };
      });
      if (!Object.keys(out.roles).length) out.roles = base.roles;
      return out;
    } catch (_) {
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
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

      const rows = staff.map(function (p) {
        const role = st.roles[(p && p.role) || ''] || { rate: 0, floor: 0 };
        const hours = n(p && p.hours);
        const h = st.poolMode === 'per_car' ? n(perCarHourly[String(p && p.car)]) : hourly;
        const byRate = h * role.rate * hours;
        const byFloor = role.floor * hours;
        return {
          name: (p && p.name) || '',
          role: (p && p.role) || '',
          hours: hours,
          hourly: h,
          rate: role.rate,
          floor: role.floor,
          byRate: byRate, // 歩合で出した額
          byFloor: byFloor, // 最低保証で出した額
          pay: Math.max(byRate, byFloor), // ★高い方★
          usedFloor: byFloor >= byRate, // 保証が勝ったか（画面で出せるように）
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
