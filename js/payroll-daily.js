// ============================================================
// js/payroll-daily.js
// ★クラウドの生データ → 日ごとの給料 → 明細（純ロジック）2026-08-01★
//
//   金額の式そのものは js/daiko-payroll.js（司さんの実物と1円まで一致済み）。
//   ここがやるのは ★式に渡す物を、生データから正しく組み立てること★ だけ。
//   式が合っていても束ね方を間違えると給料は狂うので、ここも実物で固定してある。
//
//   ▼実物（代行計算表2026.xlsb『計算』シート）を読んで分かった一番大事なこと
//     人ごとの時数は入力ではなく **=[@時数2] のような式** だった。
//     ＝★その人の時数は、その日その人が乗った車の時数★。
//       例) 1/10 は 竹内=時数4(8.75) 八木=時数2(9.00)。日によって乗る車が変わる。
//     だから「誰がどの車に乗ったか」(dk_work_hours.device_id) が要る。
//
//   ▼時数合計 = ★車の時数の合計★（人の時数の合計ではない）
//     1台に2人乗るので、人で足すと倍になり売上1hが半分になる＝全員の給料が狂う。
//
//   ▼売上から引く実費は ★売上表と同じ関数(UriageAgg.deductOf)★ を通す。
//     別々に書くと売上表と給料で売上が食い違う。
//
//   ▼★手で入れた1日分（dk_manual_days）も入り口にする★ 2026-08-01
//     司さん「おれが使えるようにしろ」。メーターを1台も繋いでいないと今までは永久に空だった。
//     同じ日・同じ車にメーターの記録もある時は ★足さずにメーターを正とする★（二重計上を防ぐ）。
//
//   ▼絶対に守ること
//     ・throw しない ・NaN を出さない ・お金を勝手に丸めない（表示側で丸める）
//     ・辞めた人でも「過去に働いた分」は計算に入れる（他の人の給料が動いてしまうため）
// ============================================================
(function (global) {
  'use strict';

  const JST_OFFSET_MIN = 540; // ★日本時間で日を切る（パソコンの時計が海外でもズレない）★

  function _need(name, path) {
    try {
      if (global && global[name]) return global[name];
    } catch (_) {
      /* ignore */
    }
    try {
      if (typeof require === 'function') {
        // eslint-disable-next-line no-undef, global-require
        return require(path);
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  function n(v) {
    const x = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(x) ? x : 0;
  }
  function arr(v) {
    return Array.isArray(v) ? v : [];
  }
  function pad(x) {
    return x < 10 ? '0' + x : String(x);
  }
  // 時数は0.25刻み（司さんの実物がそうなっている）
  function quarter(h) {
    return Math.round(n(h) * 4) / 4;
  }

  // ─── 日付（日本時間で切る）────────────────────────────
  function dateOf(iso, tzOffsetMin) {
    try {
      if (!iso) return '';
      const t = Date.parse(String(iso));
      if (!isFinite(t)) return '';
      const off = isFinite(Number(tzOffsetMin)) ? Number(tzOffsetMin) : JST_OFFSET_MIN;
      const d = new Date(t + off * 60000);
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    } catch (_) {
      return '';
    }
  }

  // ─── 車の時数 ───────────────────────────────────────
  //   ①手で入れた時数があればそれ ②無ければメーターが記録した実時間から（0.25刻み）
  function carHoursOf(shift, edit) {
    try {
      const manual = edit ? n(edit.hours) : 0;
      if (manual > 0) return manual;
      const el = shift ? n(shift.elapsed_sec) : 0;
      if (el > 0) return quarter(el / 3600);
      if (shift && shift.started_at && shift.ended_at) {
        const a = Date.parse(shift.started_at);
        const b = Date.parse(shift.ended_at);
        if (isFinite(a) && isFinite(b) && b > a) return quarter((b - a) / 3600000);
      }
      return 0;
    } catch (_) {
      return 0;
    }
  }

  // ★★1つの 勤務の「分」と「夜の 時間帯に 重なった 分」★★ 2026-10-06
  //   時間帯は JST の 時刻（kara/made は 0時からの 分）。kara > made は 日を またぐ（22:00〜5:00）。
  //   勤務の 始まりの 日 D を 基準に D−1・D・D+1 の 3つの 夜と 重ねて 足す（明け方 始まりも 拾う）。
  //   終わりが 無い 時は 始まり＋elapsed_sec。どちらも 無ければ 0（割増 無し）
  function yakanFun(s, y) {
    const out = { span: 0, yakan: 0 };
    try {
      const a = Date.parse(s && s.started_at);
      if (!isFinite(a)) return out;
      let b = Date.parse(s && s.ended_at);
      if (!isFinite(b)) b = n(s && s.elapsed_sec) > 0 ? a + n(s.elapsed_sec) * 1000 : NaN;
      if (!isFinite(b) || b <= a) return out;
      out.span = (b - a) / 60000;
      if (!y) return out;
      const JST = 9 * 3600000;
      const d0 = new Date(a + JST);
      const base = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) - JST;
      [-1, 0, 1].forEach(function (k) {
        const day = base + k * 86400000;
        const s1 = day + y.kara * 60000;
        const e1 = y.kara > y.made ? day + 86400000 + y.made * 60000 : day + y.made * 60000;
        const o = Math.min(b, e1) - Math.max(a, s1);
        if (o > 0) out.yakan += o / 60000;
      });
    } catch (_) {
      /* 壊れた 時刻は 割増 無し */
    }
    return out;
  }

  // ─── 設定（DBの行 → 計算エンジンの設定）──────────────────
  function normSettings(row) {
    const Payroll = _need('DaikoPayroll', './daiko-payroll.js');
    const base = Payroll
      ? Payroll.normSettings(null)
      : {
          poolMode: 'others_total',
          deductReserveBeforeRate: true,
          reservePoolRate: 0.05,
          reserveOwnerRate: 0.05,
          roles: {},
        };
    try {
      const r = row && typeof row === 'object' ? row : {};
      const out = Payroll
        ? Payroll.normSettings({
            poolMode: r.pool_mode,
            deductReserveBeforeRate: r.deduct_reserve_before_rate,
            reservePoolRate: r.reserve_pool_rate,
            reserveOwnerRate: r.reserve_owner_rate,
            roles: r.roles,
            // ★ほかの 払い方★ 2026-10-06（日給・回数・距離・段階・指定日）＝空なら 使わない
            extra: r.pay_extra,
          })
        : base;
      out.ownerDeviceId = typeof r.owner_device_id === 'string' ? r.owner_device_id : '';
      out.periodStartDay = r.period_start_day === undefined ? 21 : n(r.period_start_day) || 21;
      // ★既定は thirds＝月3回払い（実物の月別シート「バ1～10/バ11～20/バ21～31」）★
      out.periodEndMode =
        r.period_end_mode === 'days' || r.period_end_mode === 'month_end'
          ? r.period_end_mode
          : 'thirds';
      out.periodDays = r.period_days === undefined ? 11 : n(r.period_days) || 11;
      return out;
    } catch (_) {
      base.ownerDeviceId = '';
      base.periodStartDay = 21;
      base.periodEndMode = 'month_end';
      base.periodDays = 11;
      return base;
    }
  }

  // ─── 生データを引きやすい形にする ──────────────────────
  //   raw = { shifts, edits, labels, employees, workHours, salesSettings, payrollSettings }
  function buildCtx(raw) {
    const Uriage = _need('UriageAgg', './uriage-agg.js');
    const ctx = {
      settings: normSettings(raw && raw.payrollSettings),
      salesSettings: raw ? raw.salesSettings : null,
      byDate: {}, // 日付 → { 車ID → {sales, expense, hours, label} }
      hoursByDate: {}, // 日付 → { 従業員ID → {device_id, hours} }
      employees: [],
      empById: {},
      labels: {},
      // ★名前を付けた行そのまま (2026-08-05)★
      //   labels は「端末ID→名前」だけなので★並び(sort_order)が落ちる★。
      //   並べ替えに要るので生の行も持っておく。
      labelRows: [],
      devices: [], // 出てきた車（つかさ車も含む）
    };
    try {
      const r = raw && typeof raw === 'object' ? raw : {};

      const seen = {};
      arr(r.labels).forEach(function (l) {
        if (!l || !l.device_id) return;
        ctx.labels[l.device_id] = l.label || '';
        ctx.labelRows.push(l);
        // ★名前を付けた車は「知っている車」として扱う★
        //   （記録がまだ1件も無くても、手入力で選べるようにするため）
        if (!seen[l.device_id]) {
          seen[l.device_id] = true;
          ctx.devices.push(l.device_id);
        }
      });

      const editById = {};
      arr(r.edits).forEach(function (e) {
        if (e && e.shift_id) editById[e.shift_id] = e;
      });

      arr(r.shifts).forEach(function (s) {
        if (!s || typeof s !== 'object') return;
        // ★印を付けた勤務は使わない (2026-08-06)★
        //   司さん「0mの3件は消さない」＝記録は残すが、給料・売上表・月次には入れない。
        //   （8/3 の較正の日の試し打ち。0時間の日が並ぶと明細が読みにくい）
        if (s.excluded === true) return;
        const dev = s.device_id;
        if (!dev || typeof dev !== 'string') return; // どの車か分からない数字は使わない
        const date = dateOf(s.started_at);
        if (!date) return;
        const e = editById[s.shift_id] || null;

        if (!ctx.byDate[date]) ctx.byDate[date] = {};
        if (!ctx.byDate[date][dev]) {
          ctx.byDate[date][dev] = {
            device_id: dev,
            sales: 0,
            expense: 0,
            hours: 0,
            trips: 0,
            jissha_m: 0,
            sou_m: 0,
          };
        }
        const c = ctx.byDate[date][dev];
        // ★回数・距離★ 2026-10-06（回数歩合・距離歩合の 材料。給料の 式は 決めていなければ 使わない）
        // ★夜の 割増の 材料★ 2026-10-06：その 勤務の 分 と 夜の 時間帯に 重なった 分（JST）
        const ym = yakanFun(s, ctx.settings && ctx.settings.extra && ctx.settings.extra.yakan);
        c.span = n(c.span) + ym.span;
        c.yakan = n(c.yakan) + ym.yakan;
        c.trips += n(s.trip_count);
        c.jissha_m += n(s.actual_total_m);
        c.sou_m += n(s.total_distance_m);
        c.sales += n(s.fare_total_yen); // ★メーターが確定した売上そのまま★
        c.expense += Uriage ? Uriage.deductOf(e, ctx.salesSettings) : 0; // ★売上表と同じ引き方★
        c.hours += carHoursOf(s, e); // 同じ車で1日2回働いたら足す

        c.fromMeter = true; // ★メーターの記録がある印★（下で手入力を無視する判断に使う）

        if (!seen[dev]) {
          seen[dev] = true;
          ctx.devices.push(dev);
        }
      });

      // ★手で入れた1日分（スマホが繋がる前でも給料を出せるように）★
      //   同じ日・同じ車にメーターの記録もある時は ★足し算しない★。メーターの方を正とする。
      //   （足すと二重計上になり、全員の給料と会社の取り分が狂う）
      arr(r.manualDays).forEach(function (m) {
        if (!m || typeof m !== 'object') return;
        const dev = m.device_id;
        const date = m.work_date;
        if (!dev || typeof dev !== 'string' || !date || typeof date !== 'string') return;

        if (!ctx.byDate[date]) ctx.byDate[date] = {};
        const exist = ctx.byDate[date][dev];
        if (exist && exist.fromMeter) {
          exist.manualIgnored = true; // 画面で「メーターを使っています」と出せるように
          return; // ★二重計上しない★
        }
        ctx.byDate[date][dev] = {
          device_id: dev,
          sales: n(m.sales_yen),
          expense: Uriage
            ? Uriage.deductOf(
                { toll_yen: m.toll_yen, bridge_yen: m.bridge_yen, other_yen: m.other_yen },
                ctx.salesSettings
              )
            : 0,
          hours: n(m.hours),
          trips: n(m.trip_count),
          jissha_m: n(m.actual_total_m),
          sou_m: n(m.total_distance_m),
          fromManual: true,
        };
        if (!seen[dev]) {
          seen[dev] = true;
          ctx.devices.push(dev);
        }
      });

      arr(r.employees).forEach(function (e) {
        if (!e || !e.employee_id) return;
        ctx.employees.push(e);
        ctx.empById[e.employee_id] = e;
      });
      ctx.employees.sort(function (a, b) {
        const d = n(a.sort_order) - n(b.sort_order);
        return d !== 0 ? d : String(a.name || '').localeCompare(String(b.name || ''), 'ja');
      });

      arr(r.workHours).forEach(function (w) {
        if (!w || !w.work_date || !w.employee_id) return;
        if (!ctx.hoursByDate[w.work_date]) ctx.hoursByDate[w.work_date] = {};
        ctx.hoursByDate[w.work_date][w.employee_id] = {
          device_id: typeof w.device_id === 'string' ? w.device_id : '',
          hours: n(w.hours),
        };
      });

      // ★★手当・控除★★ 2026-10-06（司さん「ア」＝会社に 残る分も 動かす）
      //   1行＝1人の 1つの 手当 か 控除。その 日の 給料の 総額（staffTotal）に 足し引き する
      ctx.adjByDate = {};
      arr(r.adjustments).forEach(function (a) {
        if (!a || !a.work_date || !a.employee_id) return;
        const d = String(a.work_date).slice(0, 10);
        const yen = n(a.yen);
        if (!(yen > 0)) return;
        if (!ctx.adjByDate[d]) ctx.adjByDate[d] = [];
        ctx.adjByDate[d].push({
          adj_id: a.adj_id || '',
          employee_id: a.employee_id,
          kind: a.kind === 'koujo' ? 'koujo' : 'teate',
          label: String(a.label || ''),
          yen: yen,
        });
      });

      // ★その日 その車に 乗った 人の 役（本人の 画面 用）★ 2026-10-06
      //   倉庫の 関数 dk_kyuryo_get が 返す crew＝[{work_date, device_id, roles:['2種','1種']}]
      //   （名前・時間は 返さない）。在れば これを 使う／無ければ 勤務時間の 行から 作る（事務所の 画面）
      if (Array.isArray(r.crew)) {
        ctx.crewByDate = {};
        r.crew.forEach(function (c) {
          if (!c || !c.work_date || !c.device_id) return;
          const d = String(c.work_date).slice(0, 10);
          if (!ctx.crewByDate[d]) ctx.crewByDate[d] = {};
          ctx.crewByDate[d][c.device_id] = arr(c.roles).map(function (x) {
            return String(x || '');
          });
        });
      }
    } catch (_) {
      /* ignore: 壊れたデータでも動く形で返す */
    }
    return ctx;
  }

  // ★画面に出す車の名前 (2026-08-05)★
  //   司さん「給料明細の売上1.2.3の横の英数字の訳分からんやつ」
  //   名前が無い時に ★端末ID(UUID)をそのまま出していた★:
  //     売上1（7e1919ef-4aaa-411e-8db0-ba0424…）
  //   名前が無ければ「車1」「車2」にする。★UUIDは絶対に出さない★。
  //   番号は端末IDを並べた順（開くたびに入れ替わらない）。
  function _carLabels(ctx) {
    const ids = arr(ctx && ctx.devices)
      .map(function (d) {
        return typeof d === 'string' ? d : '';
      })
      .filter(Boolean);
    const named = (ctx && ctx.labels) || {};
    if (global && global.CarName) {
      // ★生の行があれば そちらを渡す＝並び(sort_order)も効く★
      const rows =
        ctx && arr(ctx.labelRows).length
          ? ctx.labelRows
          : Object.keys(named).map(function (k) {
              return { device_id: k, label: named[k] };
            });
      return global.CarName.nameMap(ids, rows);
    }
    // CarName が無い時も ★UUIDは出さない★
    const out = {};
    let n = 0;
    ids
      .filter(function (v, i, a) {
        return a.indexOf(v) === i;
      })
      .sort()
      .forEach(function (id) {
        if (named[id]) out[id] = named[id];
        else {
          n += 1;
          out[id] = '車' + n;
        }
      });
    return out;
  }

  // 明細の「売上1・売上2・売上3…」の並び（つかさ車は外す）
  function carsOf(ctx) {
    try {
      const own = (ctx && ctx.settings && ctx.settings.ownerDeviceId) || '';
      const names = _carLabels(ctx);
      // ★売上1・2・3 の並び (2026-08-05・司さん「並べ変えできたら楽」)★
      //   給料の設定で決めた順にする。決めていなければ★今までどおり名前の順★。
      const rows = arr(ctx && ctx.labelRows);
      const ord = global && global.CarName && rows.length ? global.CarName.orderMap(rows) : {};
      const hasOrder = Object.keys(ord).length > 0;
      return arr(ctx && ctx.devices)
        .filter(function (d) {
          return d !== own;
        })
        .map(function (d) {
          return { device_id: d, label: names[d] || '車' }; // ★UUIDは出さない★
        })
        .sort(function (a, b) {
          if (hasOrder) {
            const oa = ord[a.device_id] === undefined ? Infinity : ord[a.device_id];
            const ob = ord[b.device_id] === undefined ? Infinity : ord[b.device_id];
            if (oa !== ob) return oa - ob;
          }
          return String(a.label).localeCompare(String(b.label), 'ja', { numeric: true });
        });
    } catch (_) {
      return [];
    }
  }

  // ─── 1日ぶんを組み立てる ────────────────────────────
  function dayInput(date, ctx) {
    const out = {
      date: date || '',
      cars: [],
      owner: { sales: 0, expense: 0, hours: 0 },
      staff: [],
    };
    try {
      if (!ctx) return out;
      const own = ctx.settings.ownerDeviceId || '';
      const cars = (ctx.byDate && ctx.byDate[date]) || {};
      const names = _carLabels(ctx); // ★UUIDを出さない（2026-08-05）★
      // ★車ごとの 回数・距離★（自分の 車も 入れる＝自分の 車に 乗った 人の 回数歩合 用）
      // ★その日 その車に 乗った 人の 役★（回数・距離の 1台の 額を 分ける 為）
      //   本人の 画面は 相方の 行を 持たないので 倉庫の 関数が 返す crew（役だけ）を 使う
      out.crewByCar = {};
      const cr = (ctx.crewByDate && ctx.crewByDate[date]) || null;
      if (cr) {
        Object.keys(cr).forEach(function (dev) {
          out.crewByCar[dev] = arr(cr[dev]).slice();
        });
      } else {
        const wh0 = (ctx.hoursByDate && ctx.hoursByDate[date]) || {};
        Object.keys(wh0).forEach(function (empId) {
          const emp = ctx.empById[empId];
          const w = wh0[empId];
          if (!emp || !w || !w.device_id) return;
          if (!out.crewByCar[w.device_id]) out.crewByCar[w.device_id] = [];
          out.crewByCar[w.device_id].push(emp.role || '');
        });
      }
      // ★夜の 割増★ 車ごとの 勤務の 分・夜の 分（自分の 車も 入れる）
      out.yakanByCar = {};
      Object.keys(cars).forEach(function (dev) {
        const c = cars[dev] || {};
        out.yakanByCar[dev] = { span: n(c.span), yakan: n(c.yakan) };
      });
      out.tripsByCar = {};
      Object.keys(cars).forEach(function (dev) {
        const c = cars[dev] || {};
        out.tripsByCar[dev] = { trips: n(c.trips), jissha_m: n(c.jissha_m), sou_m: n(c.sou_m) };
      });

      Object.keys(cars).forEach(function (dev) {
        const c = cars[dev];
        if (dev === own) {
          out.owner = {
            sales: c.sales,
            expense: c.expense,
            hours: c.hours,
            fromManual: !!c.fromManual,
          };
        } else {
          out.cars.push({
            id: dev,
            device_id: dev,
            label: names[dev] || '車', // ★UUIDは出さない★
            sales: c.sales,
            expense: c.expense,
            hours: c.hours,
            fromManual: !!c.fromManual, // 手で入れた分か（画面で見分けが付くように）
          });
        }
      });

      const wh = (ctx.hoursByDate && ctx.hoursByDate[date]) || {};
      Object.keys(wh).forEach(function (empId) {
        const emp = ctx.empById[empId];
        if (!emp) return; // 知らない人は入れない
        const w = wh[empId];
        const car = cars[w.device_id];
        // ★時数は「入っていればその値」、無ければ乗った車の時数★
        const hours = w.hours > 0 ? w.hours : car ? car.hours : 0;
        if (!(hours > 0)) return; // 出ていない日は行を作らない
        out.staff.push({
          employee_id: empId,
          name: emp.name || '',
          role: emp.role || '',
          car: w.device_id,
          hours: hours,
          // ★その人だけの歩合・最低保証 (2026-08-05・司さん指示 A案)★
          //   空のままなら役割どおり。打った時だけその人に効く。
          //   （運ばないと画面で打っても金額が変わらない＝配線漏れ）
          rate: emp.pay_rate,
          floor: emp.pay_floor,
        });
      });
      out.staff.sort(function (a, b) {
        const ea = ctx.empById[a.employee_id] || {};
        const eb = ctx.empById[b.employee_id] || {};
        return n(ea.sort_order) - n(eb.sort_order);
      });
    } catch (_) {
      /* ignore */
    }
    return out;
  }

  // ─── 1日ぶんを計算する ─────────────────────────────
  function computeDay(date, ctx) {
    const empty = {
      date: date || '',
      cars: [],
      owner: { sales: 0, expense: 0, hours: 0 },
      poolSales: 0,
      poolHours: 0,
      reservePool: 0,
      reserveOwner: 0,
      hourly: 0,
      staff: [],
      staffTotal: 0,
      ownerShare: 0,
    };
    try {
      const Payroll = _need('DaikoPayroll', './daiko-payroll.js');
      if (!Payroll || !ctx) return empty;
      const inp = dayInput(date, ctx);
      const r = Payroll.compute(inp, ctx.settings);
      // ★計算エンジンは「誰か」を持たない（名前と時数と役割だけ）★
      //   明細は人ごとに並べるので、渡した順で employee_id を戻してやる。
      arr(r.staff).forEach(function (s, i) {
        const src = inp.staff[i];
        if (src) {
          s.employee_id = src.employee_id;
          s.car = src.car;
        }
      });
      // ★★手当・控除★★ 2026-10-06：その 日の 分を 給料の 総額と 会社に 残る分に 入れる（司さん「ア」）
      //   人ごとの 行（歩合・保証の 比べ）には 入れない＝最低保証の 比べを 変えない
      const adj = (ctx.adjByDate && ctx.adjByDate[date]) || [];
      let teate = 0;
      let koujo = 0;
      adj.forEach(function (a) {
        if (a.kind === 'koujo') koujo += a.yen;
        else teate += a.yen;
      });
      r.adj = adj;
      r.teate = teate;
      r.koujo = koujo;
      if (teate || koujo) {
        r.staffTotal = n(r.staffTotal) + teate - koujo;
        r.ownerShare = n(r.ownerShare) - teate + koujo;
      }
      r.date = date || '';
      r.cars = inp.cars;
      r.owner = inp.owner;
      return r;
    } catch (_) {
      return empty;
    }
  }

  // ─── 明細（期間ぶん）───────────────────────────────
  //   実物の給料1〜8 と同じ並び:
  //     日付 / 金額 / 時間 / 売上1 / 売上2 / 売上3 / 時間(全台合計)
  //   ★働いていない日は 0 でなく null（実物は空欄）★
  function report(dates, ctx) {
    const out = {
      dates: [],
      cars: [],
      days: {},
      employees: [],
      poolSalesTotal: 0,
      poolHoursTotal: 0,
      reserveTotal: 0,
      staffTotalAll: 0,
      ownerShareTotal: 0,
    };
    try {
      if (!ctx) return out;
      const ds = arr(dates).filter(function (d) {
        return typeof d === 'string' && d;
      });
      out.dates = ds;
      out.cars = carsOf(ctx);

      const byEmp = {};
      const active = arr(ctx.employees).filter(function (e) {
        return e.active !== false;
      });
      active.forEach(function (e) {
        byEmp[e.employee_id] = {
          employee_id: e.employee_id,
          name: e.name || '',
          role: e.role || '',
          cells: [],
          totalPay: 0,
          totalHours: 0,
          workedDays: 0,
          // ★手当・控除★（totalPay は 差し引き 後＝払う 額。kasegi は 働いた 分だけ）
          kasegi: 0,
          teate: 0,
          koujo: 0,
          adj: [],
          // ★ほかの 払い方の 内わけ★ 2026-10-06（明細の 紙に 出す 為。給料の 額は 変えない）
          kasan: 0, // 1回いくら・1kmいくら の 分（1台の 額を 分けた 後）
          nikkyuHi: 0, // 日給を 使った 日の 数
          wariHi: 0, // 指定日の 割増が 付いた 日の 数
          yakanHi: 0, // 夜の 割増が 付いた 日の 数
        };
      });

      ds.forEach(function (date) {
        const day = computeDay(date, ctx);
        out.days[date] = day;
        out.poolSalesTotal += n(day.poolSales);
        out.poolHoursTotal += n(day.poolHours);
        out.reserveTotal += n(day.reservePool);
        out.staffTotalAll += n(day.staffTotal);
        out.ownerShareTotal += n(day.ownerShare);

        // その日の車ごとの売上（経費を引いた後）
        const salesByDev = {};
        arr(day.cars).forEach(function (c) {
          salesByDev[c.device_id] = n(c.sales) - n(c.expense);
        });

        const payByEmp = {};
        arr(day.staff).forEach(function (s) {
          payByEmp[s.employee_id] = s;
        });

        active.forEach(function (e) {
          const s = payByEmp[e.employee_id];
          const worked = !!s && n(s.hours) > 0;
          const row = byEmp[e.employee_id];
          row.cells.push({
            date: date,
            worked: worked,
            pay: worked ? s.pay : null,
            hours: worked ? s.hours : null,
            usedFloor: worked ? !!s.usedFloor : null,
            car: worked ? s.car : '',
            // 売上1・売上2・売上3…（走っていない車は空欄）
            carSales: out.cars.map(function (c) {
              if (!worked) return null;
              const v = salesByDev[c.device_id];
              return v === undefined || v === 0 ? null : v;
            }),
            poolHours: worked ? n(day.poolHours) : null,
          });
          if (worked) {
            row.totalPay += n(s.pay);
            row.kasegi += n(s.pay);
            row.kasan += n(s.kasan);
            if (n(s.nikkyu) > 0) row.nikkyuHi += 1;
            if (s.wariMult && s.wariMult !== 1) row.wariHi += 1;
            if (n(s.yakanRatio) > 0) row.yakanHi += 1;
            row.totalHours += n(s.hours);
            row.workedDays += 1;
          }
        });
        // ★その 日の 手当・控除を その 人の 行へ★（働いていない 日の 分も 載せる）
        arr(day.adj).forEach(function (a) {
          const row = byEmp[a.employee_id];
          if (!row) return;
          row.adj.push({ date: date, kind: a.kind, label: a.label, yen: a.yen, adj_id: a.adj_id });
          if (a.kind === 'koujo') {
            row.koujo += a.yen;
            row.totalPay -= a.yen;
          } else {
            row.teate += a.yen;
            row.totalPay += a.yen;
          }
        });
      });

      out.employees = active.map(function (e) {
        return byEmp[e.employee_id];
      });
    } catch (_) {
      /* ignore */
    }
    return out;
  }

  // 手で入れた1日分を「勤務っぽい形」に直す（売上表がそのまま使えるように）
  //   ★売上表・給料・月次集計で数字が食い違わないよう、変換はここ1箇所だけ★
  function manualAsShifts(manualDays) {
    const shifts = [];
    const edits = [];
    try {
      arr(manualDays).forEach(function (m) {
        if (!m || !m.work_date || !m.device_id) return;
        const id = 'manual:' + m.work_date + ':' + m.device_id;
        shifts.push({
          shift_id: id,
          device_id: m.device_id,
          started_at: m.work_date + 'T20:00:00+09:00',
          fare_total_yen: n(m.sales_yen),
          trip_count: n(m.trip_count),
          // ★手で 打った 距離★（2026-10-05 入力の 画面に 欄を 足した・前は 0 決め打ち）
          total_distance_m: n(m.total_distance_m),
          actual_total_m: n(m.actual_total_m),
          isManual: true,
        });
        edits.push({
          shift_id: id,
          toll_yen: n(m.toll_yen),
          bridge_yen: n(m.bridge_yen),
          other_yen: n(m.other_yen),
          hours: n(m.hours),
          isManual: true,
        });
      });
    } catch (_) {
      /* ignore */
    }
    return { shifts: shifts, edits: edits };
  }

  const api = {
    JST_OFFSET_MIN: JST_OFFSET_MIN,
    manualAsShifts: manualAsShifts,
    dateOf: dateOf,
    carHoursOf: carHoursOf,
    normSettings: normSettings,
    buildCtx: buildCtx,
    carsOf: carsOf,
    dayInput: dayInput,
    computeDay: computeDay,
    report: report,
  };

  if (global) global.PayrollDaily = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
