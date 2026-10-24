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
//       例) 1/10 は 試験=時数4(8.75) 例野=時数2(9.00)。日によって乗る車が変わる。
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
  //   shimeRows＝dk_shime_rireki の 行（締めの 形の 何日から・2026-10-19）。undefined＝記録 無し・null＝読めなかった（止める）
  function normSettings(row, shimeRows) {
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
      // ★★締めの 形は ここ 1か所で 読む★★ 2026-10-07（壊れた・昔の month_end/days ⇒ dame＝給料を 出さない）
      //   呼び手は PayrollPeriod.periodsOf(y, m, { kata: st.periodKata }) と し、先に st.periodKata.dame を 見る
      const Period = _need('PayrollPeriod', './payroll-period.js');
      const yomi = Period ? Period.yomu(r) : null;
      out.periodKata = yomi
        ? yomi.ok
          ? Period.rirekiKata(yomi.kata, shimeRows)
          : yomi
        : { dame: true, riyuu: '区切りの 道具が 読めません' };
      return out;
    } catch (_) {
      base.ownerDeviceId = '';
      base.periodStartDay = 21;
      base.periodEndMode = 'month_end';
      base.periodDays = 11;
      // ★読めない 時は 止める★（前は month_end に 倒して 黙って 進んだ・対立役 10-07）
      base.periodKata = { dame: true, riyuu: '払い方の 設定が 読めません' };
      return base;
    }
  }

  // ─── 生データを引きやすい形にする ──────────────────────
  //   raw = { shifts, edits, labels, employees, workHours, payrollSettings }
  //   ★raw.salesSettings・raw.uriageRireki は 読まない★ 2026-10-24 件J（入れた 実費は 全部 引く＝選ぶ 形を やめた）
  function buildCtx(raw) {
    const Uriage = _need('UriageAgg', './uriage-agg.js');
    const ctx = {
      settings: normSettings(raw && raw.payrollSettings, raw ? raw.shimeRireki : undefined),
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
      // 売上の 直し（dk_shift_edits.uriage_yen）が 読めない 業務（shift_id）2026-10-14
      //   ★メーターの 額に 倒さない★。画面は これが 1件でも 在れば 明細・紙を 止めて 知らせる
      uriageDame: [],
      // 役割の 決まりが 無くて 計算できない 人の 日 2026-10-17（yakuDameWoKazoeru）
      //   ★歩合0・保証0に 倒さない★。画面は これが 1件でも 在れば 明細・紙を 止めて 知らせる
      yakuDame: [],
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
        // 売上＝事務所が 直した 額 か メーターの 確定値（UriageAgg.uriageOf の 1か所）2026-10-14
        //   部品（UriageAgg）が 読めない 時も メーターに 倒さず 読めない 業務に 数える
        const u = Uriage ? Uriage.uriageOf(s, e) : null;
        if (u === null) ctx.uriageDame.push(s.shift_id);
        else c.sales += u;
        c.expense += Uriage ? Uriage.deductOf(e) : 0; // ★売上表と同じ引き方★（入れた 実費 全部）
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
            ? // ★会社が 足した 実費（expenses）も 引く★ 2026-10-20（司さん「揃えろ」＝メーターの 日と 同じ 引き方）
              Uriage.deductOf({
                toll_yen: m.toll_yen,
                bridge_yen: m.bridge_yen,
                other_yen: m.other_yen,
                expenses: m.expenses,
              })
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
    // ★★人ごとの 歩合・最低保証・役割の「何日から」★★ 2026-10-18（docs/nannichi-kara-hito.md）
    //   raw.rireki＝dk_hito_rireki の 行。undefined＝記録を 渡さない 呼び方（記録 無し）。
    //   ★null・配列で ない＝読めなかった★＝止める（列の 値に 黙って 倒さない）
    ctx.rireki = {};
    let rirekiDame = false;
    try {
      const rr = raw ? raw.rireki : undefined;
      if (rr !== undefined && !Array.isArray(rr)) rirekiDame = true;
      else rirekiWoKumu(ctx, rr || []);
    } catch (_) {
      rirekiDame = true;
    }
    if (rirekiDame)
      ctx.yakuDame.push({ employee_id: '', name: '', date: '', role: '', wake: 'rireki' });
    // ★★役割の 決まり（歩合・最低保証）の「何日から」★★ 2026-10-18（docs/nannichi-kara-yaku.md）
    //   raw.yakuRireki＝dk_yaku_rireki の 行。undefined＝記録 無し（今と 同じ）。null・形が 違う＝止める
    ctx.yakuRireki = Object.create(null); // ★__proto__ と いう 名前でも 汚さない★
    let yakuRirekiDame = false;
    try {
      const yr = raw ? raw.yakuRireki : undefined;
      if (yr !== undefined && !Array.isArray(yr)) yakuRirekiDame = true;
      else yakuRirekiWoKumu(ctx, yr || []);
    } catch (_) {
      yakuRirekiDame = true;
    }
    if (yakuRirekiDame)
      ctx.yakuDame.push({ employee_id: '', name: '', date: '', role: '', wake: 'yakuRireki' });
    // ★決まり（列）に 無い 役割の 記録が 残っている＝止める★（対立役 10-18 2回目 止1）
    //   古い 版の 画面で 役割だけ 消すと 記録が 残り、後で 同じ 名前の 役割を 足すと 黙って 生き返る。
    //   黙って 使わない／黙って 効かせる の どちらも せず、給料の 設定で 消して もらう
    else {
      const ro = (ctx.settings && ctx.settings.roles) || {};
      Object.keys(ctx.yakuRireki).forEach(function (y) {
        if (!Object.prototype.hasOwnProperty.call(ro, y))
          ctx.yakuDame.push({ employee_id: '', name: '', date: '', role: y, wake: 'yakuNokori' });
      });
    }
    // ★数え損ねたら 止める側★（黙って 0件＝通す に しない）
    try {
      yakuDameWoKazoeru(ctx);
    } catch (_) {
      ctx.yakuDame.push({ employee_id: '', name: '', date: '', role: '', wake: 'yomenai' });
    }
    ctx.yakuDameRiyuu = yakuDameBun(ctx.yakuDame);
    return ctx;
  }

  // ★記録を 人・鍵ごとに 日付の 古い 順へ★（同じ 人・鍵・日は 倉庫の unique で 1つ）
  const RIREKI_KEYS = ['pay_rate', 'pay_floor', 'role'];
  function rirekiWoKumu(ctx, rows) {
    arr(rows).forEach(function (x) {
      if (!x || !x.employee_id) throw new Error('rireki');
      const d = String(x.from_date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || RIREKI_KEYS.indexOf(x.key) < 0)
        throw new Error('rireki');
      // ★値の 形★ 歩合・保証は 数 か null・役割は 字 か null（違えば 止める＝黙って 役割どおりに 倒さない）
      const v = x.value === undefined ? null : x.value;
      if (
        v !== null &&
        (x.key === 'role' ? typeof v !== 'string' : typeof v !== 'number' || !isFinite(v))
      )
        throw new Error('rireki');
      const p = ctx.rireki[x.employee_id] || (ctx.rireki[x.employee_id] = {});
      (p[x.key] || (p[x.key] = [])).push({ d: d, v: x.value === undefined ? null : x.value });
    });
    Object.keys(ctx.rireki).forEach(function (id) {
      Object.keys(ctx.rireki[id]).forEach(function (k) {
        ctx.rireki[id][k].sort(function (a, b) {
          return a.d < b.d ? -1 : a.d > b.d ? 1 : 0;
        });
      });
    });
  }

  // ★役割の 決まりの 記録を 役割・鍵ごとに 日付の 古い 順へ★（同じ 役割・鍵・日は 倉庫の unique で 1つ）
  const YAKU_RIREKI_KEYS = ['rate', 'floor'];
  function yakuRirekiWoKumu(ctx, rows) {
    arr(rows).forEach(function (x) {
      if (!x || typeof x.yaku !== 'string') throw new Error('yakuRireki');
      const d = String(x.from_date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || YAKU_RIREKI_KEYS.indexOf(x.key) < 0)
        throw new Error('yakuRireki');
      // 倉庫の numeric は 字で 来る 事が ある＝数に 直せる 字だけ 通す（空・null・字は 止める）
      const v = typeof x.value === 'string' && x.value.trim() !== '' ? Number(x.value) : x.value;
      if (typeof v !== 'number' || !isFinite(v)) throw new Error('yakuRireki');
      const p = ctx.yakuRireki[x.yaku] || (ctx.yakuRireki[x.yaku] = Object.create(null));
      (p[x.key] || (p[x.key] = [])).push({ d: d, v: v });
    });
    Object.keys(ctx.yakuRireki).forEach(function (y) {
      Object.keys(ctx.yakuRireki[y]).forEach(function (k) {
        ctx.yakuRireki[y][k].sort(function (a, b) {
          return a.d < b.d ? -1 : a.d > b.d ? 1 : 0;
        });
      });
    });
  }

  // ★その 日の 決まり★＝各 役割の 各 鍵で from_date ≤ date の 一番 新しい 記録。無ければ 列の 値
  //   記録が 無い 会社は ctx.settings を そのまま 返す（今と 1円も 違わない）。列に 無い 役割の 記録は 使わない
  function settingsOn(ctx, date) {
    const st = ctx && ctx.settings;
    const yr = ctx && ctx.yakuRireki;
    if (!st || !st.roles || !yr || !Object.keys(yr).length) return st;
    const d = String(date || '').slice(0, 10);
    let roles = null;
    Object.keys(yr).forEach(function (y) {
      if (!Object.prototype.hasOwnProperty.call(st.roles, y)) return;
      YAKU_RIREKI_KEYS.forEach(function (k) {
        const l = yr[y][k];
        if (!l) return;
        let hit;
        for (let i = 0; i < l.length; i++) if (l[i].d <= d) hit = l[i];
        if (!hit) return;
        if (!roles) roles = Object.assign({}, st.roles);
        if (roles[y] === st.roles[y]) roles[y] = Object.assign({}, st.roles[y]);
        roles[y][k] = hit.v;
      });
    });
    return roles ? Object.assign({}, st, { roles: roles }) : st;
  }

  // ★★勤め始めの 日★★ 2026-10-19（司さん「新しい従業員（1人）を10/19で選んだらみんなこれが反映されとんはなぜ？」）
  //   ①登録した 日（created_at の 日本の 日付）。②「何日から」の 記録が それより 前なら その 日。登録日が 無い・使えない 人は ''（＝いつも 出す・前と 同じ）
  //   ★登録した 日が 2人 以上 同じ 時刻★は 倉庫の 引っ越しで まとめて 作った 行＝本当の 登録日で ない ⇒ 使わない
  //   ③乗った 記録（dk_work_hours）が 登録日より 前に 在れば その 日（★前へ 動かす だけ★）2026-10-20（本番前の 叩き N2）
  //     前は 使わなかった（記録で 決めると ✕ で 消した 時に 人が 消えた）。今は 勤め始める 前の 人も 札を 畳んで 置くので 消えない
  //   同じ 時刻かは 字で なく 時刻の 値で 比べる（書き方の 違う 同じ 時刻を 別と 見ない・N3）
  function hajimeOf(ctx, empId) {
    try {
      if (!ctx) return '';
      if (!ctx._hajime) {
        const h = {};
        const mae = function (id, d) {
          if (!id || !d) return;
          if (!h[id] || d < h[id]) h[id] = d;
        };
        // 人が 1人しか 居ない 時は まとめて 作ったか 分からない＝登録日を 使わない（対立役 直2）
        //   ★本人の 画面（ctx.honnin）だけは その人の 登録日を 使う★ 2026-10-21（N4：勤め始める 前の 期が ¥0 の 紙で 出た）
        //   まとめて 作った 人で 登録日が 本当より 遅くても、働いた 日・手当・控除が 在る 期は report が 出す（aru）＝額は 消えない
        if (arr(ctx.employees).length < 2) {
          if (ctx.honnin) {
            arr(ctx.employees).forEach(function (e) {
              if (e && e.created_at) mae(e.employee_id, dateOf(e.created_at));
            });
          } else {
            ctx._hajime = h;
            return '';
          }
        } else {
          const kagi = function (e) {
            const s = String(e.created_at)
              .trim()
              .replace(' ', 'T')
              .replace(/(\.\d{3})\d+/, '$1')
              .replace(/([+-]\d\d)$/, '$1:00');
            const t = Date.parse(s);
            return isNaN(t) ? 'x' + String(e.created_at) : 't' + t;
          };
          const kazu = {};
          arr(ctx.employees).forEach(function (e) {
            if (e && e.created_at) kazu[kagi(e)] = (kazu[kagi(e)] || 0) + 1;
          });
          arr(ctx.employees).forEach(function (e) {
            if (e && e.created_at && kazu[kagi(e)] === 1) mae(e.employee_id, dateOf(e.created_at));
          });
        }
        // 乗った 記録は 登録日より 前に する 時だけ 使う（登録日が 使えない 人には 使わない＝いつも 出す まま）
        Object.keys(ctx.hoursByDate || {}).forEach(function (d) {
          Object.keys(ctx.hoursByDate[d] || {}).forEach(function (id) {
            if (h[id]) mae(id, d);
          });
        });
        // 「何日から」は 登録日より 前に する 時だけ 使う（後から 登録した 人の 前の 日を 入れる 道）
        //   ★登録日が 使えない 人には 使わない★：前から 居る 人に 先の 日付で 率を 変えた 記録を 入れても 消えない様に
        Object.keys(ctx.rireki || {}).forEach(function (id) {
          if (!h[id]) return;
          const p = ctx.rireki[id] || {};
          Object.keys(p).forEach(function (k) {
            arr(p[k]).forEach(function (x) {
              mae(id, x && x.d);
            });
          });
        });
        ctx._hajime = h;
      }
      return ctx._hajime[empId] || '';
    } catch (_) {
      return '';
    }
  }
  // その 日に もう 勤め始めて いるか（分からない 時は 出す 側に 倒す）
  function hajimatteIru(ctx, empId, date) {
    const h = hajimeOf(ctx, empId);
    return !h || !date || h <= String(date).slice(0, 10);
  }

  // ★その 日の 人★＝from_date ≤ date の 一番 新しい 記録。記録が 無ければ 列の 値（今と 同じ）
  //   value の null＝「空」（歩合・保証は 役割どおり／役割は 空）
  function empOn(ctx, empId, date) {
    const emp = ctx && ctx.empById ? ctx.empById[empId] : null;
    if (!emp) return emp;
    const p = ctx.rireki && ctx.rireki[empId];
    if (!p) return emp;
    const d = String(date || '').slice(0, 10);
    let out = null;
    RIREKI_KEYS.forEach(function (k) {
      const l = p[k];
      if (!l) return;
      let hit;
      for (let i = 0; i < l.length; i++) if (l[i].d <= d) hit = l[i];
      if (!hit) return;
      if (!out) out = Object.assign({}, emp);
      out[k] = k === 'role' ? (hit.v === null ? '' : String(hit.v)) : hit.v;
    });
    return out || emp;
  }

  // 止める 訳の 字（明細・紙・月次・本人で 同じ 字＝ここ 1か所）
  function yakuDameBun(list) {
    const l = arr(list);
    if (!l.length) return '';
    if (
      l.some(function (x) {
        return x && x.wake === 'rireki';
      })
    )
      return '歩合・最低保証・役割の 変えた 記録を 読めませんでした。給料の 明細・紙は 止めています。もう一度 開いてください。';
    if (
      l.some(function (x) {
        return x && x.wake === 'yakuRireki';
      })
    )
      return '役割の 決まりの 変えた 記録を 読めませんでした。給料の 明細・紙は 止めています。もう一度 開いてください。';
    const nokori = l
      .filter(function (x) {
        return x && x.wake === 'yakuNokori';
      })
      .map(function (x) {
        return '「' + x.role + '」';
      });
    if (nokori.length)
      return (
        '決まりに 無い 役割 ' +
        nokori.slice(0, 5).join('・') +
        ' の 変えた 記録が 残っています。給料の 明細・紙は 止めています。' +
        '「給料の 設定」の 役割ごとの 決まりで その 記録を 消してください（名前を 直した 後なら「保存する」で 直ります）。'
      );
    if (
      l.some(function (x) {
        return x && x.wake === 'yomenai';
      })
    )
      return '役割の 決まりを 確かめられませんでした。給料の 明細・紙は 止めています。もう一度 開いてください。';
    const na = [];
    l.forEach(function (x) {
      const s = (x.name || '名前の 無い 人') + '（' + (x.role || '役割 なし') + '）';
      if (na.indexOf(s) < 0) na.push(s);
    });
    const hi = l.some(function (x) {
      return x.wake === 'hi';
    });
    return (
      '役割の 決まりが 無くて 給料を 計算できない 人が 居ます：' +
      na.slice(0, 5).join('・') +
      (na.length > 5 ? ' ほか ' + (na.length - 5) + '人' : '') +
      '（' +
      l.length +
      '日ぶん）。給料の 明細・紙は 止めています。「給料の 設定 → 役割ごとの 決まり」で その 役割を 足すか、' +
      (hi
        ? '回数・距離の 分け方を 人数で 等分に するか、'
        : 'その 人の 歩合と 最低保証を 両方 打つか、') +
      '「従業員」で 役割を 決まりに 在る 物に 直してください。'
    );
  }

  // ★★役割の 決まりが 無くて 計算できない 人の 日を 数える★★ 2026-10-17
  //   決まりに 無い 役割の 人は daiko-payroll.js の compute で 歩合0・保証0に 黙って 倒れていた
  //   （役割の 名前を 直す・消すと 人の 役割は 古い 名前の まま 残る）。司さん「計算できなければ 止めて 警告」。
  //   ・人の 歩合と 最低保証が 両方 打って あれば 止めない（司さん 08-25「役割は 選んでも 打っても いい」）
  //   ・回数・距離を 役割の 率の 比で 分ける 日は、その 車に 乗った 全員（自分も）の 役割が 決まりに 要る
  //     （比は 役割の 率だけで 引く＝決まりに 無い 役割は 0 として 扱われ、取り分が 黙って 動く）
  //   見る 人と 日は dayInput と 同じ（時数が 在る 人だけ）
  function yakuDameWoKazoeru(ctx) {
    const roles = (ctx.settings && ctx.settings.roles) || {};
    const ex = (ctx.settings && ctx.settings.extra) || {};
    const aru = function (y) {
      return Object.prototype.hasOwnProperty.call(roles, y);
    };
    const has = function (v) {
      return v !== null && v !== undefined && v !== '' && isFinite(parseFloat(v));
    };
    const hiru = n(ex.kaisu) > 0 || n(ex.kyori) > 0;
    Object.keys(ctx.hoursByDate)
      .sort()
      .forEach(function (date) {
        const wh = ctx.hoursByDate[date] || {};
        const cars = ctx.byDate[date] || {};
        Object.keys(wh).forEach(function (empId) {
          const emp = empOn(ctx, empId, date); // ★その 日の 人★（何日から）
          if (!emp) return;
          const w = wh[empId];
          const car = cars[w.device_id];
          const hours = w.hours > 0 ? w.hours : car ? car.hours : 0;
          if (!(hours > 0)) return;
          const role = emp.role || '';
          let wake = '';
          if (!aru(role) && !(has(emp.pay_rate) && has(emp.pay_floor))) wake = 'yaku';
          if (!wake && hiru && ex.bunpai !== 'touwari' && car) {
            const km = n(ex.kyoriShu === 'sou' ? car.sou_m : car.jissha_m) / 1000;
            const dai = n(ex.kaisu) * n(car.trips) + n(ex.kyori) * km;
            if (dai > 0) {
              // 乗った 人の 役は dayInput の crewByCar と 同じ 作り方
              const cr = ctx.crewByDate && ctx.crewByDate[date];
              const crew = cr
                ? arr(cr[w.device_id])
                : Object.keys(wh)
                    .filter(function (id) {
                      return ctx.empById[id] && wh[id] && wh[id].device_id === w.device_id;
                    })
                    .map(function (id) {
                      return empOn(ctx, id, date).role || '';
                    });
              if (!crew.length) crew.push(role);
              if (
                crew.some(function (y) {
                  return !aru(y);
                })
              )
                wake = 'hi';
            }
          }
          if (wake)
            ctx.yakuDame.push({
              employee_id: empId,
              name: emp.name || '',
              date: date,
              role: role,
              wake: wake,
            });
        });
      });
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
      // 2026-10-14 時数を入れる・入力・売上表と 同じ 1か所（CarName.sortIds）で 並べる
      //   （前は 決めていない 車を ここだけ 名前の順・他は 端末IDの順で 並び が 食い違った）
      if (global && global.CarName && typeof global.CarName.sortIds === 'function') {
        return global.CarName.sortIds(
          arr(ctx && ctx.devices).filter(function (d) {
            return d !== own;
          }),
          rows
        ).map(function (d) {
          return { device_id: d, label: names[d] || '車' }; // ★UUIDは出さない★
        });
      }
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
          const emp = empOn(ctx, empId, date);
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
        const emp = empOn(ctx, empId, date); // ★その 日の 歩合・保証・役割★（何日から）
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
      const r = Payroll.compute(inp, settingsOn(ctx, date)); // ★その 日の 決まり★（何日から）
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
      // ★自分の 車の 積立・全部の 車の 売上★ 2026-10-23 件G（給料タブの 積立・売上を 月次集計と 同じ 数に）
      reserveOwnerTotal: 0,
      uriageZen: 0, // 全部の 車の 売上（経費 後）＝会社に 残る分 ＋ 給料 ＋ 積立（自分の 車も）
      staffTotalAll: 0,
      ownerShareTotal: 0,
      meisaiGai: [], // 名簿に いない 人の 手当・控除（明細に 載らない）2026-10-23 件G
      harai: 0, // 払う 額の 合計＝明細の 差引支給（人ごとに 丸めた 額）を 全員 足した 額
      nokori: 0, // 会社に 残る分＝売上 − harai − 積立（丸めた 給料で）
    };
    try {
      if (!ctx) return out;
      const ds = arr(dates).filter(function (d) {
        return typeof d === 'string' && d;
      });
      out.dates = ds;
      out.cars = carsOf(ctx);

      const byEmp = {};
      // ★★辞めた 人（今いる人を 外した 人）も 行を 作る★★ 2026-10-16（対立役・指示役）
      //   前は active で 絞り、外した 人は 働いた 期間の 明細・紙・本人の 画面から 消えた（総額には 残り、人の 合計と 合わなかった）。
      //   出すかは 最後に 決める：今いる人は 全員、外した 人は この 期間に 働いた 日か 手当・控除が ある 時だけ
      const active = arr(ctx.employees);
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
        out.reserveOwnerTotal += n(day.reserveOwner);
        out.uriageZen +=
          n(day.ownerShare) + n(day.staffTotal) + n(day.reservePool) + n(day.reserveOwner);
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
          if (!row) {
            // ★名簿に いない 人の 手当・控除★ 2026-10-23 件G＝明細に 載らない ので 給料の 合計にも 入れない
            //   黙って 消さない：数を 返して 画面に 帯を 出す（harai・meisaiGai）
            out.meisaiGai.push({
              date: date,
              employee_id: a.employee_id,
              kind: a.kind,
              yen: a.yen,
            });
            return;
          }
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

      // 今いる人でも、期間の 終わりより 後に 勤め始めた 人は 出さない（働いた 日・手当・控除が 在れば 出す）2026-10-19
      const owari = ds.reduce(function (a, d) {
        return d > a ? d : a;
      }, '');
      out.employees = active
        .filter(function (e) {
          const row = byEmp[e.employee_id];
          const aru = !!row && (row.workedDays > 0 || row.adj.length > 0);
          if (e.active !== false) return aru || hajimatteIru(ctx, e.employee_id, owari);
          return aru;
        })
        .map(function (e) {
          return byEmp[e.employee_id];
        });
      out.harai = haraiGoukei(out);
      out.nokori = nokoriGaku(out);
    } catch (_) {
      /* ignore */
    }
    return out;
  }

  // ─── ★★給料の 合計の 決まりは ここ 1つ★★ 2026-10-23 件G ─────────────
  //   払うのは 明細の 差引支給＝人ごとの totalPay を Math.round した 額（丸め方は 変えない）。
  //   給料の 合計は どこでも「払う回ごとに 人ごとの 差引支給を 丸めてから 足す」。
  //   ★前★ 月次集計は 全員・全日を 丸めずに 足して 最後に 1回 丸めた＝明細を 全員分 足した 額と ずれた。
  //   月次集計（js/getsuji-agg.js）・給料タブ・給料表の 紙・月次の 紙は 全部 ここを 呼ぶ。
  function haraiGaku(totalPay) {
    return Math.round(n(totalPay));
  }
  // 1回の 払い（report の 戻り）の 給料の 合計＝明細の 差引支給を 全員分 足した 額
  function haraiGoukei(rep) {
    return arr(rep && rep.employees).reduce(function (a, e) {
      return a + haraiGaku(e && e.totalPay);
    }, 0);
  }
  // 会社に 残る分＝売上 − 丸めた 給料 − 積立
  //   日ごとの ownerShare は「売上 − 積立 − その日の 給料（丸める 前・名簿外の 手当・控除 込み）」
  //   ＝ownerShare と staffTotal を 足し戻すと「売上 − 積立」（自分の 車の 分も 月次集計と 同じ 入り方）
  function nokoriGaku(rep) {
    if (!rep) return 0;
    return n(rep.ownerShareTotal) + n(rep.staffTotalAll) - haraiGoukei(rep);
  }
  // 明細の 日の 欄（日ごとに 丸めた 額）を 足すと 差引支給と 1円 ずれる 人か（注記を 出す 為・額は 変えない）
  function hiNoZure(e) {
    if (!e) return false;
    let s = 0;
    arr(e.cells).forEach(function (c) {
      if (c && c.pay !== null && c.pay !== undefined) s += Math.round(n(c.pay));
    });
    s += Math.round(n(e.teate)) - Math.round(n(e.koujo));
    return s !== haraiGaku(e.totalPay);
  }
  const HI_ZURE_JI =
    '日ごとの額は1円未満を丸めて出しています（合計は丸める前の額から出しています）';
  // 明細に 載らない 手当・控除の 帯の 字（月次集計・給料タブ で 同じ 字）
  function meisaiGaiJi(kensu) {
    return kensu > 0
      ? '明細に載らない手当・控除が' + kensu + '件あります（合計に入れていません）'
      : '';
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
          // ★会社が 足した 実費も 渡す★ 2026-10-20（司さん「揃えろ」＝前は 3列だけで 売上表が 引かなかった）
          expenses: m.expenses && typeof m.expenses === 'object' ? m.expenses : {},
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
    empOn: empOn,
    hajimeOf: hajimeOf,
    hajimatteIru: hajimatteIru,
    settingsOn: settingsOn,
    carsOf: carsOf,
    dayInput: dayInput,
    computeDay: computeDay,
    report: report,
    haraiGaku: haraiGaku,
    haraiGoukei: haraiGoukei,
    nokoriGaku: nokoriGaku,
    hiNoZure: hiNoZure,
    HI_ZURE_JI: HI_ZURE_JI,
    meisaiGaiJi: meisaiGaiJi,
  };

  if (global) global.PayrollDaily = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
