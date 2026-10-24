// ============================================================
// js/payroll-period.js
// ★給与期間の区切り（司さんの実物と同じ）2026-08-01★
//
//   司さんの「代行計算表2026.xlsb」の給料1〜8 を全部読んで確かめた作り:
//     給料1 = 1月分 1/21 ~ 1/31 (11日)
//     給料2 = 2月分 2/21 ~ 2/28 ( 8日)  ← ★3月に食い込まない★
//     給料3 = 3月分 3/21 ~ 3/31 (11日)
//     給料4 = 4月分 4/21 ~ 4/30 (10日)
//     給料8 = 8月分 8/1  ~ 8/10 (10日)  ← 開始日も長さも変えられる必要がある
//
//   ★つまり「毎回11日分」ではない。「21日から その月の末日まで」＝月末締め★
//     長さは月によって 8日〜11日 と変わる。
//     （日数を11で固定すると、2月分の明細に3月1日〜3日が混ざって金額が合わなくなる）
//
//   ★2026-08-01 追記: 実物の『月別』シートを読んで、もう1つ分かった★
//     月別シートの列が「バ1～10 / バ11～20 / バ21～31」だった。
//     そして **バ21～31 = 279,332 は 給料1(21日〜末日)の8人の合計とぴったり一致する**。
//     ＝★司さんは給料を月3回に分けて払っている（1〜10日 / 11〜20日 / 21〜末日）★
//     給料1〜8 に「21日〜末日」しか無かったのは、それが3期のうちの1つだったから。
//     → endMode='thirds'（既定）で 1ヶ月＝3期を返す。
//
//   ▼設定で変えられる（他のユーザー用）
//     endMode … 'thirds'(既定・月3回払い) / 'month_end'(起算日〜末日で1回) / 'days'(日数で切る)
//     startDay … 起算日（'month_end'/'days' のとき。既定21日）
//     days     … endMode='days' のときの日数
//   ▼throw しない・うるう年でも落ちない
// ============================================================
(function (global) {
  'use strict';

  const DEFAULT_START_DAY = 21; // 'month_end'/'days' のときの既定
  const DEFAULT_END_MODE = 'thirds'; // ★司さん = 月3回払い★
  const DEFAULT_DAYS = 11; // endMode='days' のときの既定
  // ★月3回払いの区切り（実物の月別シート「バ1～10 / バ11～20 / バ21～31」）★
  const THIRDS = [
    { from: 1, to: 10, name: '1〜10日' },
    { from: 11, to: 20, name: '11〜20日' },
    { from: 21, to: 0, name: '21日〜末日' }, // to=0 は月末まで
  ];

  function n(v, d) {
    const x = typeof v === 'number' ? v : parseInt(v, 10);
    return isFinite(x) ? x : d;
  }

  function pad(x) {
    return x < 10 ? '0' + x : String(x);
  }
  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function md(d) {
    return d.getMonth() + 1 + '/' + d.getDate();
  }

  // その月の日数（うるう年もこれで正しく出る）
  function daysInMonth(year, month1) {
    return new Date(year, month1, 0).getDate();
  }

  function emptyPeriod() {
    return {
      year: 0,
      month: 0,
      index: 0,
      name: '',
      startDay: DEFAULT_START_DAY,
      endMode: DEFAULT_END_MODE,
      days: 0,
      label: '',
      rangeLabel: '',
      start: '',
      end: '',
      dates: [],
    };
  }

  // 起算日と日数から1つぶんを組み立てる
  function build(y, m, startDay, days, index, name, endMode) {
    const start = new Date(y, m - 1, startDay);
    const dates = [];
    for (let i = 0; i < days; i++) {
      // 月をまたいでも Date が繰り上げる（endMode='days' のとき）
      dates.push(ymd(new Date(y, m - 1, startDay + i)));
    }
    const last = new Date(y, m - 1, startDay + days - 1);
    return {
      year: y,
      month: m,
      index: index,
      name: name,
      startDay: startDay,
      endMode: endMode,
      days: days,
      label: m + '月分',
      rangeLabel: md(start) + ' 〜 ' + md(last), // 全角の 〜（半角の ~ は 上に 浮いて 見える・司さん 2026-10-14）
      start: ymd(start),
      end: ymd(last),
      dates: dates,
    };
  }

  // ★その月の期間を全部返す（月3回払いなら3つ、それ以外は1つ）★
  function periodsOf(year, month, opts) {
    try {
      const now = new Date();
      const y = n(year, now.getFullYear());
      const m = n(month, now.getMonth() + 1);
      // ★★締めの 形（kata）が 来たら そちらだけ★★ 2026-10-07（画面・集計は 全部 これ）
      if (opts && opts.kata)
        return opts.kata.kind === 'rireki'
          ? rirekiPeriods(y, m, opts.kata, opts.zenbuMiru === true).ps
          : kataPeriods(y, m, opts.kata);
      const raw = opts && opts.endMode;
      const endMode = raw === 'days' || raw === 'month_end' ? raw : DEFAULT_END_MODE;

      if (endMode === 'thirds') {
        const last = daysInMonth(y, m);
        return THIRDS.map(function (t, i) {
          const to = t.to > 0 ? Math.min(t.to, last) : last;
          const days = Math.max(1, to - t.from + 1);
          return build(y, m, t.from, days, i, t.name, endMode);
        });
      }

      let startDay = n(opts && opts.startDay, DEFAULT_START_DAY);
      if (!(startDay >= 1 && startDay <= 28)) startDay = DEFAULT_START_DAY;

      let days;
      if (endMode === 'days') {
        days = n(opts && opts.days, DEFAULT_DAYS);
        if (!(days >= 1 && days <= 62)) days = DEFAULT_DAYS;
      } else {
        // 月末締め: 起算日からその月の末日まで
        days = daysInMonth(y, m) - startDay + 1;
        if (!(days >= 1)) days = 1;
      }
      return [build(y, m, startDay, days, 0, startDay + '日〜', endMode)];
    } catch (_) {
      return [emptyPeriod()];
    }
  }

  // ============================================================
  // ★★締めの 形（period_shime）★★ 2026-10-07
  //   司さん「この払い方がまだ対応できてないやろが」（月3回／月1回／日数 の 3つ だけ だった）
  //   司さんの 決め（10-07）: 何月分と 呼ぶかは ★会社が 選ぶ★（nazuke）・月次の 給料は 締めた 分
  //   形:
  //     {kind:'tsuki', hi:[10,20,0], nazuke}  締め日の 並び（0＝末日・その月に 無い 日は 末日）
  //     {kind:'shuu', youbi:0..6(0=日), nazuke} 週1回
  //     {kind:'hi'}                              毎日
  //     nazuke: 'shime'＝締めた 日の 月の 分 ／ 'hajime'＝始まった 日の 月の 分
  //   ★期が 月を またぐ 形で nazuke が 無い ⇒ 止める★（既定で 決め打ちしない）
  //   読み方は yomu だけ（壊れた・知らない・昔の month_end/days ⇒ dame＝止めて 警告）
  // ============================================================
  const NAZUKE = { shime: 1, hajime: 1 };
  function dame(riyuu) {
    return { dame: true, riyuu: riyuu };
  }
  function seisu(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }
  // 締めの 形を 確かめて 整える（壊れて いれば dame）
  function seiki(sh) {
    if (!sh || typeof sh !== 'object') return dame('締めの 形が 読めません');
    if (sh.kind === 'hi') return { ok: true, kata: { kind: 'hi' } };
    if (sh.kind === 'tsuki') {
      if (!Array.isArray(sh.hi) || !sh.hi.length || sh.hi.length > 31)
        return dame('締め日が 入っていません');
      const seen = {};
      const hi = [];
      for (let i = 0; i < sh.hi.length; i++) {
        const h = sh.hi[i];
        if (!seisu(h) || h < 0 || h > 31) return dame('締め日が おかしい: ' + h);
        const k = h === 31 ? 0 : h; // 31日締め ＝ 末日締め
        if (!seen[k]) {
          seen[k] = 1;
          hi.push(k);
        }
      }
      hi.sort(function (a, b) {
        return (a || 99) - (b || 99);
      });
      // ★今の 月3回（1〜10／11〜20／21〜末日）と 同じ 形は 今の 道を そのまま 通す★
      if (hi.length === 3 && hi[0] === 10 && hi[1] === 20 && hi[2] === 0)
        return { ok: true, kata: { kind: 'thirds' } };
      const kosu = hi[hi.length - 1] !== 0; // 最後が 末日で ない ＝ 月を またぐ 期が ある
      // ★28・29・30日締めは「締めた 日の 月の 分」だけ★（司さん 10-19「3/1〜3/30 が 2月分 おかしくないか」→「直せ」）
      //   短い 月が ある＝始まった 日の 月で 呼ぶと 同じ 月に 2つ・次の 月に 0（毎月 払う 決まりに 反する）。
      //   前の 月から 入る 日は 1〜3日だけ＝締めた 日の 月の 分が 中身の 日と 合う。古い 行の 'hajime' も こう 読む（本番 0社）
      //   ★28〜30 を 1つでも 含めば★（全部 28〜30 の 時だけに 狭めると、[10,30] の 始まった 日の 月の 分で
      //    1か月の 給料が 1〜58日に 振れた＝対立役 本番前6 止A・2026-10-19。司さんの「直せ」の 形に 戻した）
      if (kosu && hi.some((h) => h >= 28))
        return { ok: true, kata: { kind: 'tsuki', hi: hi, nazuke: 'shime' } };
      if (kosu && !NAZUKE[sh.nazuke]) return dame('何月分と 呼ぶかが 決まっていません');
      return { ok: true, kata: { kind: 'tsuki', hi: hi, nazuke: kosu ? sh.nazuke : 'shime' } };
    }
    if (sh.kind === 'shuu') {
      if (!seisu(sh.youbi) || sh.youbi < 0 || sh.youbi > 6) return dame('締めの 曜日が おかしい');
      if (!NAZUKE[sh.nazuke]) return dame('何月分と 呼ぶかが 決まっていません');
      return { ok: true, kata: { kind: 'shuu', youbi: sh.youbi, nazuke: sh.nazuke } };
    }
    return dame('知らない 締めの 形: ' + String(sh.kind));
  }
  // ★会社の 設定の 行から 締めの 形を 読む（ここ 1か所）★
  function yomu(row) {
    try {
      if (!row || typeof row !== 'object') return { ok: true, kata: { kind: 'thirds' } };
      // ★設定の 行を 読めなかった（通信）＝行が 無い（新しい 会社＝月3回）とは 別★（対立役 10-07 D）
      if (row.yomenai === true) {
        const d = dame('給料の 設定を 読めませんでした（通信）');
        d.tsushin = true; // ★文の 字でなく この 印で「開き直して」を 出す★（対立役 10-07 B）
        return d;
      }
      const sh = row.period_shime;
      if (sh !== null && sh !== undefined) return seiki(sh); // ★壊れて いても 昔の 列へ 戻らない★
      const m = row.period_end_mode;
      if (m === 'thirds' || m === '' || m === null || m === undefined)
        return { ok: true, kata: { kind: 'thirds' } };
      // ★昔の month_end／days・知らない 値 は 区切りを 黙って 変えない＝止める★（本番 0社・10-07）
      return dame('払い方の 設定（' + String(m) + '）が 今の 作りでは 読めません');
    } catch (_) {
      return dame('払い方の 設定が 読めません');
    }
  }

  function addDays(d, k) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
  }
  function ymKey(d) {
    return d.getFullYear() * 12 + d.getMonth();
  }
  // ★何月分（月の 鍵）★：締めた 日の 月の 分＝締めた 日の 月・始まった 日の 月の 分＝始まった 日の 月
  //   （2026-10-19：28〜30日締めは seiki で「締めた 日の 月の 分」だけに した＝始まった 日で 呼ぶ 形は 27日 以下だけ＝月が 空かない）
  function tsukiKey(kata, p) {
    return ymKey(kata.nazuke === 'hajime' ? p.start : p.end);
  }
  // 締め日（Date）の 並び → 期（start〜end）
  function kugiru(shimebi) {
    const out = [];
    for (let i = 1; i < shimebi.length; i++) {
      out.push({ start: addDays(shimebi[i - 1], 1), end: shimebi[i] });
    }
    return out;
  }
  function kataPeriods(y, m, kata) {
    try {
      if (!kata || kata.dame) return [];
      if (kata.kind === 'thirds') return periodsOf(y, m, { endMode: 'thirds' });
      const last = daysInMonth(y, m);
      const me = y * 12 + (m - 1);
      let kikan = [];
      if (kata.kind === 'hi') {
        for (let d = 1; d <= last; d++) {
          const t = new Date(y, m - 1, d);
          kikan.push({ start: t, end: t });
        }
      } else {
        const shimebi = [];
        if (kata.kind === 'tsuki') {
          for (let k = -3; k <= 3; k++) {
            const t = new Date(y, m - 1 + k, 1);
            const ty = t.getFullYear();
            const tm = t.getMonth() + 1;
            const tl = daysInMonth(ty, tm);
            const seen = {};
            kata.hi.forEach(function (h) {
              const d = h === 0 ? tl : Math.min(h, tl);
              if (!seen[d]) {
                seen[d] = 1;
                shimebi.push(new Date(ty, tm - 1, d));
              }
            });
          }
        } else if (kata.kind === 'shuu') {
          let t = new Date(y, m - 1 - 3, 1);
          while (t.getDay() !== kata.youbi) t = addDays(t, 1);
          const owari = new Date(y, m + 3, 1);
          for (; t < owari; t = addDays(t, 7)) shimebi.push(t);
        } else {
          return [];
        }
        shimebi.sort(function (a, b) {
          return a - b;
        });
        kikan = kugiru(shimebi).filter(function (p) {
          return tsukiKey(kata, p) === me;
        });
      }
      return kikan.map(function (p, i) {
        const days = Math.round((p.end - p.start) / 86400000) + 1;
        const dates = [];
        for (let k = 0; k < days; k++) dates.push(ymd(addDays(p.start, k)));
        const naka = ymKey(p.start) === me && ymKey(p.end) === me;
        const rangeLabel = md(p.start) + ' 〜 ' + md(p.end); // 全角の 〜（司さん 2026-10-14）
        let name;
        if (kata.kind === 'hi') name = p.start.getDate() + '日';
        else if (!naka) name = rangeLabel;
        else if (p.end.getDate() === last) name = p.start.getDate() + '日〜末日';
        else name = p.start.getDate() + '〜' + p.end.getDate() + '日';
        return {
          year: y,
          month: m,
          index: i,
          name: name,
          startDay: p.start.getDate(),
          endMode: 'shime',
          kind: kata.kind,
          days: days,
          label: m + '月分',
          rangeLabel: rangeLabel,
          start: ymd(p.start),
          end: ymd(p.end),
          dates: dates,
        };
      });
    } catch (_) {
      return [];
    }
  }

  // ============================================================
  // ★★締めの 形の「何日から」★★ 2026-10-19（docs/nannichi-kara-shime.md）
  //   rows＝dk_shime_rireki の 行 {from_date:'YYYY-MM-DD', value:締めの 形（period_shime と 同じ）}
  //   undefined＝記録 無し＝kata そのまま（今と 1日も 違わない）／null・形が 違う＝dame（止める）
  //   ★変えた 日 D の 前日で 必ず 切る★。切った 期の「何月分」は 前の 形の 側＝★元の 期の 月の まま★・
  //   新しい 形の 側＝切った 後の 日付で（司さん 10-19・2回目＝払い終えた 前の 月に 後から 日を 入れない）
  // ============================================================
  const HI_RE = /^\d{4}-\d{2}-\d{2}$/;
  function hiOk(s) {
    if (typeof s !== 'string' || !HI_RE.test(s)) return false;
    return ymd(hiDate(s)) === s;
  }
  function hiDate(s) {
    return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  }
  function kataKagi(k) {
    return JSON.stringify(k);
  }
  function rirekiKata(kata, rows) {
    try {
      if (rows === undefined) return kata;
      if (!kata || kata.dame) return kata;
      if (!Array.isArray(rows)) {
        const d = dame('締めの 変えた 記録を 読めませんでした（通信）');
        d.tsushin = true;
        d.kiroku = true; // ★画面の 字を 分ける 印★（字で 分けない）
        return d;
      }
      const l = [];
      for (let i = 0; i < rows.length; i++) {
        const x = rows[i];
        const hi = x && typeof x.from_date === 'string' ? x.from_date.slice(0, 10) : '';
        if (!hiOk(hi)) return dame('締めの 変えた 記録の 日付が 読めません');
        const t = seiki(x.value);
        if (!t.ok) return dame('締めの 変えた 記録（' + hi + '）が 読めません：' + t.riyuu);
        l.push({ kara: hi, kata: t.kata });
      }
      l.sort(function (a, b) {
        return a.kara < b.kara ? -1 : a.kara > b.kara ? 1 : 0;
      });
      for (let i = 1; i < l.length; i++)
        if (l[i].kara === l[i - 1].kara) return dame('締めの 変えた 記録が 同じ 日に 2つ あります');
      const segs = [{ kara: '', kata: kata }];
      l.forEach(function (x) {
        // ★隣と 同じ 形は 1つに まとめる★（同じ 形の 記録で 期を 切らない）
        if (kataKagi(segs[segs.length - 1].kata) !== kataKagi(x.kata)) segs.push(x);
      });
      if (segs.length === 1) return kata;
      return { kind: 'rireki', segs: segs };
    } catch (_) {
      return dame('締めの 変えた 記録が 読めません');
    }
  }
  // その 日に 効く 形（記録 無しの 形は その まま）
  function kataNoHi(kata, hi) {
    if (!kata || kata.kind !== 'rireki') return kata;
    let k = kata.segs[0].kata;
    kata.segs.forEach(function (sg) {
      if (sg.kara && sg.kara <= hi) k = sg.kata;
    });
    return k;
  }
  // 形の 素の 期（前後 3か月・月で 絞らない）＝{start, end, key（何月分＝年*12+月-1）}
  function soKikan(kata, y, m) {
    const out = [];
    if (kata.kind === 'thirds' || kata.kind === 'hi') {
      for (let k = -3; k <= 3; k++) {
        const t = new Date(y, m - 1 + k, 1);
        const ty = t.getFullYear();
        const tm = t.getMonth() + 1;
        const tl = daysInMonth(ty, tm);
        const key = ty * 12 + tm - 1;
        if (kata.kind === 'hi') {
          for (let d = 1; d <= tl; d++) {
            const x = new Date(ty, tm - 1, d);
            out.push({ start: x, end: x, key: key });
          }
        } else {
          THIRDS.forEach(function (th) {
            const to = th.to > 0 ? Math.min(th.to, tl) : tl;
            out.push({
              start: new Date(ty, tm - 1, th.from),
              end: new Date(ty, tm - 1, to),
              key: key,
            });
          });
        }
      }
      return out;
    }
    const shimebi = [];
    if (kata.kind === 'tsuki') {
      for (let k = -4; k <= 4; k++) {
        const t = new Date(y, m - 1 + k, 1);
        const ty = t.getFullYear();
        const tm = t.getMonth() + 1;
        const tl = daysInMonth(ty, tm);
        const seen = {};
        kata.hi.forEach(function (h) {
          const d = h === 0 ? tl : Math.min(h, tl);
          if (!seen[d]) {
            seen[d] = 1;
            shimebi.push(new Date(ty, tm - 1, d));
          }
        });
      }
    } else if (kata.kind === 'shuu') {
      let t = new Date(y, m - 1 - 4, 1);
      while (t.getDay() !== kata.youbi) t = addDays(t, 1);
      const owari = new Date(y, m + 4, 1);
      for (; t < owari; t = addDays(t, 7)) shimebi.push(t);
    } else {
      throw new Error('知らない 締めの 形');
    }
    shimebi.sort(function (a, b) {
      return a - b;
    });
    kugiru(shimebi).forEach(function (p) {
      p.key = tsukiKey(kata, p);
      out.push(p);
    });
    return out;
  }
  // ★記録の 在る 会社の その月の 期★＝{ps, hitotsu（月が 1つの 形だけで 切られずに 出来た 時の 形・他は null）}
  //   ★転んだら 止める★（[] は「この 月に 締める 給料は 無い」と 読まれる＝対立役 止3）
  //   zenbu＝遠い 区間も 見る（試験で 比べる 時だけ）
  function rirekiPeriods(y, m, kata, zenbu) {
    try {
      const me = y * 12 + (m - 1);
      const segs = kata.segs;
      const zen = [];
      // ★この 月から 遠い 区間は 見ない★（soKikan は 前後 4か月の 期しか 作らない＝5か月の 外の 区間からは 1つも 出ない・
      //   記録が 多いと 重かった＝対立役 本番前3 直A 2026-10-19。結果は 1日も 変えない＝単体 ⑩ が 縛る）
      const madoA = new Date(y, m - 1 - 5, 1);
      const madoB = new Date(y, m + 5, 0);
      segs.forEach(function (sg, i) {
        const a = sg.kara ? hiDate(sg.kara) : null;
        const b = i + 1 < segs.length ? addDays(hiDate(segs[i + 1].kara), -1) : null;
        if (a && b && b < a) return;
        if (!zenbu && ((a && a > madoB) || (b && b < madoA))) return;
        soKikan(sg.kata, y, m).forEach(function (p) {
          const st = a && p.start < a ? a : p.start;
          const en = b && p.end > b ? b : p.end;
          if (en < st) return;
          // ★何月分★（司さん 10-19 2回目）：前の 形の 期（後ろを 切った）＝元の 期の 月の まま／
          //   新しい 形の 期（頭を 切った）＝切った 後の 日付で その 形の 決まり
          //   ★変えた 日に ちょうど 始まる 期も 頭を 切った 期★（素の 期の 数え方〈tsukiKey〉で 前の 月に 入れない・対立役 止1 2026-10-19）
          const atamaKiri = st.getTime() !== p.start.getTime();
          const atamaNazuke = atamaKiri || (!!a && st.getTime() === a.getTime());
          zen.push({
            start: st,
            end: en,
            seg: i,
            key: atamaNazuke ? ymKey(sg.kata.nazuke === 'hajime' ? st : en) : p.key,
            kiri: atamaKiri || en.getTime() !== p.end.getTime(),
          });
        });
      });
      zen.sort(function (p, q) {
        return p.start - q.start;
      });
      // ★前の 日の 期の 月より 前の 月の 分に しない★（司さん 10-19 3回目＝払い終えた 月に 後から 日を 入れない・
      //   日付の 順と 何月分の 順を 揃える）。例：20日締め → 9/25 から 末日＝9/21〜9/24 は 10月分・9/25〜9/30 も 10月分
      let mae = -Infinity;
      zen.forEach(function (f) {
        if (f.key < mae) f.key = mae;
        mae = f.key;
      });
      const frags = zen.filter(function (f) {
        return f.key === me;
      });
      // ★期が 1つも 無い 月＝締めの 変え方で 空いた 月★＝止める（0円に しない・訳を 出す・対立役 直5 2026-10-19）
      if (!frags.length) {
        const e0 = emptyPeriod();
        e0.dame = true;
        e0.aki = true;
        return { ps: [e0], hitotsu: null };
      }
      // ★1つの 形から 切られずに 出来た 月は その 形の 期と 同じ 物★（名前・index・kind も 変えない・対立役 直3）
      if (frags.length) {
        const s0 = frags[0].seg;
        const hitotsu = frags.every(function (f) {
          return f.seg === s0 && !f.kiri;
        });
        if (hitotsu) {
          const k0 = segs[s0].kata;
          const moto = kataPeriods(y, m, k0);
          if (moto.length === frags.length) return { ps: moto, hitotsu: k0 };
        }
      }
      const last = daysInMonth(y, m);
      const ps = frags.map(function (p, i) {
        const k = segs[p.seg].kata;
        const days = Math.round((p.end - p.start) / 86400000) + 1;
        const dates = [];
        for (let j = 0; j < days; j++) dates.push(ymd(addDays(p.start, j)));
        const naka = ymKey(p.start) === me && ymKey(p.end) === me;
        const rangeLabel = md(p.start) + ' 〜 ' + md(p.end);
        let name;
        // 毎日払いで よその 月の 日は 月/日（同じ 月の 中で「25日」が 2つ 並ばない・対立役 4回目 直1）
        if (k.kind === 'hi') name = naka ? p.start.getDate() + '日' : md(p.start);
        else if (!naka) name = rangeLabel;
        else if (p.end.getDate() === last) name = p.start.getDate() + '日〜末日';
        else name = p.start.getDate() + '〜' + p.end.getDate() + '日';
        return {
          year: y,
          month: m,
          index: i,
          name: name,
          startDay: p.start.getDate(),
          endMode: 'shime',
          kind: k.kind,
          kiri: p.kiri, // ★切り替わりで 短く 切った 期★
          days: days,
          label: m + '月分',
          rangeLabel: rangeLabel,
          start: ymd(p.start),
          end: ymd(p.end),
          dates: dates,
        };
      });
      return { ps: ps, hitotsu: null };
    } catch (_) {
      const e = emptyPeriod();
      e.dame = true; // ★区切れない＝止める 印★
      return { ps: [e], hitotsu: null };
    }
  }
  // ★期が 1つも 無い 月（記録の 切り替わりで 空いた 月）★ 2026-10-19（docs/nannichi-kara-shime.md「月が 空く 件」）
  //   給料は 毎月 払う 決まり（労基法24条）＝空く 変え方は 保存させない・空いた 月は 訳を 出す
  //   返り：['YYYY-MM', …]（日付順）。記録の 無い 形は 空く 月が 無い（tsukiKey）＝[]
  function akiTsuki(kata) {
    if (!kata || kata.dame || kata.kind !== 'rireki') return [];
    // 見る 月を 先に 集める（近い 記録で 同じ 月を 何回も 区切らない）
    const tsuki = {};
    kata.segs.forEach(function (sg) {
      if (!sg.kara) return;
      const y = Number(sg.kara.slice(0, 4));
      const m = Number(sg.kara.slice(5, 7));
      for (let d = -3; d <= 3; d++) {
        const t = shift({ year: y, month: m }, d);
        tsuki[t.year + '-' + pad(t.month)] = t;
      }
    });
    return Object.keys(tsuki)
      .sort()
      .filter(function (key) {
        const t = tsuki[key];
        const ps = rirekiPeriods(t.year, t.month, kata).ps;
        return ps.length === 1 && ps[0].aki;
      });
  }
  // その月の 形（記録の 道で 月が 混ざる 時は null）＝月3回・毎日・年の 期ごとの 合計 を 決める 所が 見る
  function tsukiNoKata(kata, y, m) {
    if (!kata || kata.kind !== 'rireki') return kata || null;
    return rirekiPeriods(n(y, 0), n(m, 0), kata).hitotsu;
  }

  // その月の期間を1つ取り出す（index を省いたら最初の期）
  function periodOf(year, month, opts, index) {
    try {
      const list = periodsOf(year, month, opts);
      const i = n(index, 0);
      return list[i >= 0 && i < list.length ? i : 0] || emptyPeriod();
    } catch (_) {
      return emptyPeriod();
    }
  }

  // その月ぜんぶの日付（月次集計はこれを使う。期の切り方に左右されない）
  function monthDates(year, month) {
    try {
      const now = new Date();
      const y = n(year, now.getFullYear());
      const m = n(month, now.getMonth() + 1);
      const last = daysInMonth(y, m);
      const out = [];
      for (let d = 1; d <= last; d++) out.push(ymd(new Date(y, m - 1, d)));
      return out;
    } catch (_) {
      return [];
    }
  }

  // 月を前後に送る
  function shift(ym, delta) {
    try {
      const y = n(ym && ym.year, new Date().getFullYear());
      const m = n(ym && ym.month, new Date().getMonth() + 1);
      const d = n(delta, 0);
      const t = new Date(y, m - 1 + d, 1);
      return { year: t.getFullYear(), month: t.getMonth() + 1 };
    } catch (_) {
      return { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
    }
  }

  const api = {
    DEFAULT_START_DAY: DEFAULT_START_DAY,
    DEFAULT_END_MODE: DEFAULT_END_MODE,
    DEFAULT_DAYS: DEFAULT_DAYS,
    THIRDS: THIRDS,
    daysInMonth: daysInMonth,
    periodsOf: periodsOf,
    yomu: yomu,
    seiki: seiki,
    rirekiKata: rirekiKata,
    kataNoHi: kataNoHi,
    tsukiNoKata: tsukiNoKata,
    akiTsuki: akiTsuki,
    periodOf: periodOf,
    monthDates: monthDates,
    shift: shift,
  };

  if (global) global.PayrollPeriod = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);

// ============================================================
// ★KaishaKikan（js/payroll-period.js の 後ろ）★
//   ★置き場の 訳★ 新しい js を 作ると 事務所の 中継の 名簿（office-host/vercel.json と 別 repo の
//   daikome-jimusho-host）にも 足さないと 事務所の 画面で 404＝月次集計が 開かない
//   （tests/e2e/jimusho-haishin-todoku.spec.js が 実配信で 赤に した・2026-10-24）。
//   ⇒ 名簿に 既に 在り 月次集計・売上表が 読む この 1本に 置く（給料の 期とは 別の 物＝名前も 別）
// ★★会社の 締め日（月 → 会社の 期間 の 割り当て）＝ここ 1か所★★ 2026-10-24（司さん）
//
//   司さん「会社の締め日も決めれるようにしとかないかんな」
//         「締め日は給料やなくて会社の締めのことな。給料は給料のとこで設定できるやろが」
//
//   ▼決まり
//     締め日 hi … null＝末日（今まで 通りの 暦の 月）／1〜28＝その 日で 締める
//     期間の 名前＝★締めた 月★：20日締めの 10月＝9/21〜10/20（前の 月の 21日〜その 月の 20日）
//     末日の 会社は 暦の 月と 1日も 違わない（月次・紙・売上表の 数は 1円も 変わらない）
//     29〜31日締めは 置かない（2月が 割れる）＝1〜28日・末日 だけ
//
//   ▼置き場
//     dk_sales_settings.kaisha_shime_hi（smallint・null＝末日・1〜28）
//     （dk_companies には 持ち主の 更新の 口が 無い＝止めた 会社が 自分で 戻せる 口を 開けない・叩き役 K-1）
//
//   ▼読めない 時は 末日に 倒さない（叩き役 K-8）
//     行は 在るのに 列が 無い（読み足し忘れ・倉庫に 列が まだ 無い）・値が 1〜28 以外 ⇒ dame（月次と 紙を 止めて 訳を 出す）
//     行が 無い（その 会社は まだ 売上の 設定を 1度も 保存していない）＝末日（新しい 会社の 既定）
//
//   ▼throw しない（yomu 以外の 関数は 壊れた 値を 末日として 扱わず、呼ぶ 側が yomu の dame で 止める）
// ============================================================
(function (global) {
  'use strict';

  function pad(x) {
    return x < 10 ? '0' + x : String(x);
  }
  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }
  function ymd(y, m, d) {
    return y + '-' + pad(m) + '-' + pad(d);
  }
  function seisu(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }
  function hiOk(hi) {
    return hi === null || (seisu(hi) && hi >= 1 && hi <= 28);
  }
  function dame(riyuu) {
    return { dame: true, riyuu: riyuu };
  }

  // ★設定の 行から 締め日を 読む（ここ 1か所）★
  //   row … dk_sales_settings の 1行（select=* で 読んだ 物）／null・undefined＝行が 無い
  //   返り … {ok:true, hi:null|1..28} ／ {dame:true, riyuu}
  function yomu(row) {
    try {
      if (row === null || row === undefined) return { ok: true, hi: null };
      if (typeof row !== 'object') return dame('会社の 締め日が 読めません');
      if (!Object.prototype.hasOwnProperty.call(row, 'kaisha_shime_hi'))
        return dame('会社の 締め日（kaisha_shime_hi）を 読めませんでした');
      const v = row.kaisha_shime_hi;
      if (v === null) return { ok: true, hi: null };
      const x = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
      if (!seisu(x) || x < 1 || x > 28) return dame('会社の 締め日が おかしい: ' + String(v));
      return { ok: true, hi: x };
    } catch (_) {
      return dame('会社の 締め日が 読めません');
    }
  }

  // ★その 名前の 月の 期間★（y年 m月＝締めた 月）
  //   返り {year, month, hi, start, end, dates:[…], label:'10月', rangeLabel:'9/21 〜 10/20'}
  function kikan(y, m, hi) {
    const t = new Date(y, m - 1, 1);
    const yy = t.getFullYear();
    const mm = t.getMonth() + 1;
    const dates = [];
    let start;
    let end;
    if (hi === null || hi === undefined || !hiOk(hi)) {
      const last = daysInMonth(yy, mm);
      for (let d = 1; d <= last; d++) dates.push(ymd(yy, mm, d));
      start = { y: yy, m: mm, d: 1 };
      end = { y: yy, m: mm, d: last };
    } else {
      const p = new Date(yy, mm - 2, 1);
      const py = p.getFullYear();
      const pm = p.getMonth() + 1;
      const plast = daysInMonth(py, pm);
      for (let d = hi + 1; d <= plast; d++) dates.push(ymd(py, pm, d));
      for (let d = 1; d <= hi; d++) dates.push(ymd(yy, mm, d));
      start = hi + 1 <= plast ? { y: py, m: pm, d: hi + 1 } : { y: yy, m: mm, d: 1 };
      end = { y: yy, m: mm, d: hi };
    }
    return {
      year: yy,
      month: mm,
      hi: hiOk(hi) ? hi : null,
      start: ymd(start.y, start.m, start.d),
      end: ymd(end.y, end.m, end.d),
      dates: dates,
      label: mm + '月',
      rangeLabel: start.m + '/' + start.d + ' 〜 ' + end.m + '/' + end.d, // 全角の 〜（給料の 期の 字と 同じ）
    };
  }

  // ★その 日は どの 月の 期間か★（'YYYY-MM-DD' → {year, month}）／読めない 日は null
  function tsukiOf(date, hi) {
    const s = String(date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    let y = +s.slice(0, 4);
    let m = +s.slice(5, 7);
    const d = +s.slice(8, 10);
    if (hiOk(hi) && hi !== null && d > hi) {
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return { year: y, month: m };
  }
  // ★その 日が y年の m月の 期間に 入るか★（m を 省く ⇒ y年の どこかの 月）
  function naka(date, hi, y, m) {
    const t = tsukiOf(date, hi);
    if (!t || t.year !== y) return false;
    return m === undefined || m === null || t.month === m;
  }
  // ★その 年の 期間の 頭と 尻★（1月の 期間の 頭〜12月の 期間の 尻）
  function nen(y, hi) {
    const a = kikan(y, 1, hi);
    const b = kikan(y, 12, hi);
    return { start: a.start, end: b.end };
  }
  // ★今日（日本時間の 'YYYY-MM-DD'）は どの 月の 期間か★（20日締めで 10/24 ⇒ 11月）
  function kyou(hi, now) {
    const t = new Date((now === undefined ? Date.now() : now) + 9 * 3600 * 1000);
    return tsukiOf(t.toISOString().slice(0, 10), hi);
  }
  // ★画面に 出す 字★（末日 ⇒「末日」）
  function hiNoJi(hi) {
    return hi === null || hi === undefined ? '末日' : hi + '日';
  }

  const api = {
    yomu: yomu,
    kikan: kikan,
    tsukiOf: tsukiOf,
    naka: naka,
    nen: nen,
    kyou: kyou,
    hiNoJi: hiNoJi,
    hiOk: hiOk,
  };
  if (global) global.KaishaKikan = api;
  /* eslint-disable no-undef */
  // node では require('./payroll-period.js').KaishaKikan で 取る
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports.KaishaKikan = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
