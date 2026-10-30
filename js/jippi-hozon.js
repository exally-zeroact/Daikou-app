'use strict';
// ============================================================
// ★★その日に 入れる 分（実費・電子決済）の 読み書き★★ 2026-09-07
//
//   ★司さんの言葉★「フッターに作れってこやろがぼけ」
//     ⇒ 入力は ★下の 帯（フッター）の「入力」★＝1枚の 画面に なった。
//     ⇒ 売上表（uriage.html）と 入力画面（nyuryoku.html）で
//       ★同じ 決まりを 2か所に 書かない★ 為に ここへ 出した。
//
//   ★ここが 持つ 決まり★
//     ①古い 3つ（toll/bridge/other）は ★列★／会社が 足した 物は ★expenses★
//       ＝古い 列は 消しません（前の 記録が 読めなくなる 事故を 防ぐ）
//     ②実費は dk_shift_edits（1回の 業務ごと）
//     ③電子決済 は dk_day_extras（会社×日）
//     ★元データ（dk_shifts / dk_trips）には 1行も 書きません★
//     ★お金の 計算（料金・距離）は ここには 在りません★
// ============================================================

(function (global) {
  const FURUI = { toll: 'toll_yen', bridge: 'bridge_yen', other: 'other_yen' };

  // ★打った 字を 揃える★ 2026-10-30（全角の 数字・点→半角・桁の 区切り「,」・円¥ を 除き 前後の 空白を 落とす）
  //   前は「1,000」を parseInt で 1円・数の 欄（type=number）は 空＝0円に して 黙って 保存した
  //   shousuu＝小数の 欄（時数・距離）＝「,」「，」は 消さない（「1,5」を 15 に しない＝崩れた 字で 止める・対立役 10-30 止1）
  //   空白は ★前後だけ★ 落とす（途中の 空白＝「7 5」は 崩れた 字＝75 に しない・対立役 10-30 止A）
  function seiri(v, shousuu) {
    const t = String(v == null ? '' : v).replace(/[０-９．]/g, function (c) {
      return c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    });
    return (shousuu ? t : t.replace(/[,，円¥￥]/g, '')).trim();
  }
  // ★金額・回数の 欄の 字を 読む★ 2026-10-30：空＝0／0以上の 整数＝その 数／★読めない 字＝undefined（送らない）★
  function yomuEn(value) {
    const t = seiri(value);
    if (t === '') return 0;
    if (!/^\d+$/.test(t)) return undefined;
    const n = Number(t);
    return Number.isSafeInteger(n) ? n : undefined;
  }
  // ★距離（km）・時数の 欄の 字を 読む★：空＝null／0以上の 数（小数 可）＝その 数／読めない 字＝undefined
  function yomuKm(value) {
    const t = seiri(value, true);
    if (t === '') return null;
    if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
    return Number(t);
  }

  function seisuu(v) {
    const n = parseInt(typeof v === 'number' ? v : seiri(v), 10);
    return isFinite(n) && n > 0 ? n : 0;
  }

  // ★1つの 名前の 今の 額★（古い 列でも 足した 物でも 同じ 呼び方で 読める）
  function ima(e, kindId) {
    if (!e) return 0;
    const f = FURUI[kindId];
    if (f) return e[f] || 0;
    const x = e.expenses || {};
    return x[kindId] || 0;
  }

  // ★1回ぶんの 実費の 合計★（★売上から 引く 物★は 呼ぶ側が 選ぶ）
  function goukei(e, kinds, hiku) {
    let g = 0;
    (kinds || []).forEach(function (k) {
      if (hiku && !hiku(k)) return;
      g += ima(e, k.kind_id) || 0;
    });
    return g;
  }

  // ★★請求書の 額（seikyu_yen）は 在る 時だけ 持ち越す★★ 2026-10-06
  //   ★denshi_yen の ように 毎回 0 を 送らない★＝倉庫に 列が まだ 無い 線（本番に SQL を 当てる 前）で
  //   送ると 列が 無いと 弾かれ ★実費の 保存が 全部 落ちる★（対立役 10-06）。
  //   打った 時は 下の「_yen」の 道で 入る。merge-duplicates は 送らない 列を 消さない。
  function motikosuSeikyu(body, cur) {
    if (cur && cur.seikyu_yen !== undefined && cur.seikyu_yen !== null) {
      body.seikyu_yen = cur.seikyu_yen;
    }
  }

  // ★★メーターの 車の 請求書の 欄の 字を 読む★★ 2026-10-30
  //   司さん 10-29「メーターの方で請求書押してるんやから請求書も自動で反映されるようにしろ」
  //   空＝null（メーターで 請求書を 押した 額＝請求書アプリの 明細を 使う）／0以上の 整数＝打った 額（0＝この 車は 請求書 なし）
  //   読めない 字も null（前の 様に 0 に すると 黙って「請求書 なし」に なる）
  //   ★手で 入れた 日（dk_manual_days）は メーターが 無い＝今まで 通り 空は 0★（saveTebiki）
  function yomuSeikyu(value) {
    const t = seiri(value);
    if (!/^\d+$/.test(t)) return null;
    const n = Number(t);
    return Number.isSafeInteger(n) ? n : null;
  }
  // 倉庫の 1行に 請求書の 額が 打って あるか（null・undefined＝メーターの 額）
  function seikyuUtta(e) {
    return (
      !!e && typeof e.seikyu_yen === 'number' && Number.isInteger(e.seikyu_yen) && e.seikyu_yen >= 0
    );
  }

  // ★打った 1つを 入れた 形にする★（送る 中身を 作るだけ＝通信は しない）
  //   cur … 今 倉庫に 在る 1行（無ければ {}）
  function karada(shiftId, companyId, cur, field, value) {
    const v = seisuu(value);
    cur = cur || {};
    const body = {
      shift_id: shiftId,
      company_id: companyId,
      toll_yen: cur.toll_yen || 0,
      bridge_yen: cur.bridge_yen || 0,
      other_yen: cur.other_yen || 0,
      // ★★電子決済を 車ごとに 持つ★★ 2026-09-11（司さん「車毎に 出す」）
      //   ★持ち越さないと 別の 欄を 打った 時に 0 に 戻る★（upsert は 行を 置き換える）
      denshi_yen: cur.denshi_yen || 0,
      expenses: cur.expenses || {},
      updated_at: new Date().toISOString(),
    };
    motikosuSeikyu(body, cur);
    if (field === 'seikyu_yen') {
      body.seikyu_yen = yomuSeikyu(value); // ★空＝null（メーターの 額）・0＝請求書 なし★
    } else if (FURUI[field]) {
      body[FURUI[field]] = v;
    } else if (field.indexOf('_yen') > 0) {
      body[field] = v; // ★前からの 呼び方（toll_yen 等）も そのまま 通す★
    } else {
      const x = {};
      for (const k in body.expenses) x[k] = body.expenses[k];
      x[field] = v;
      body.expenses = x;
    }
    return body;
  }

  // ★実費を 保存する★（ok なら 入れた 中身を 返す）
  function saveJippi(sess, shiftId, companyId, cur, field, value) {
    const body = karada(shiftId, companyId, cur, field, value);
    return global.DKSession.rest(sess, 'dk_shift_edits?on_conflict=shift_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) throw r;
      return body;
    });
  }

  // ★★メーターの 車の 売上を 事務所が 直す★★ 2026-10-14（司さん「金額の修正もできんやないか」）
  //   dk_shift_edits の uriage_yen・uriage_at だけ 送る（他の 列を 古い 値で 上書きしない）。
  //   v は 読み終えた 値（UriageAgg.yomuUriage）＝0以上の 整数 か null（メーターに 戻す）
  //   請求書の 一覧で 後から 直すと dk-fix-fare が 空に 戻す＝後から 直した 方が 勝つ
  function saveUriage(sess, shiftId, companyId, v) {
    const ima = new Date().toISOString();
    const body = {
      shift_id: shiftId,
      company_id: companyId,
      uriage_yen: v,
      uriage_at: v === null ? null : ima,
      updated_at: ima,
    };
    return global.DKSession.rest(sess, 'dk_shift_edits?on_conflict=shift_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) throw r;
      return body;
    });
  }

  // ★★メーターの 車の 回数・実車距離・総走行距離を 事務所が 直す★★ 2026-10-25
  //   （司さん「全部の車に自動反映できるもので（修正できるように）つけろよ」）
  //   dk_shift_edits の その 1列（*_naoshi）と updated_at だけ 送る（他の 列を 古い 値で 上書きしない）。
  //   col は 直しの 列名だけ。v は 0以上の 整数（回・m）か null（メーターに 戻す）
  const KAZU_RETSU = ['trip_count_naoshi', 'actual_total_m_naoshi', 'total_distance_m_naoshi'];
  function saveKazu(sess, shiftId, companyId, col, v) {
    if (KAZU_RETSU.indexOf(col) < 0) return Promise.reject(new Error('知らない 列: ' + col));
    if (v !== null && !(typeof v === 'number' && Number.isInteger(v) && v >= 0))
      return Promise.reject(new Error('0以上の 整数で ない: ' + v));
    const body = {
      shift_id: shiftId,
      company_id: companyId,
      updated_at: new Date().toISOString(),
    };
    body[col] = v;
    return global.DKSession.rest(sess, 'dk_shift_edits?on_conflict=shift_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) throw r;
      return body;
    });
  }

  // ★★走った 記録が 無い 日の 実費★★ 2026-09-08（司さん「入力するとこ出しとけや」）
  //   ★入れる 棚★ daikome.dk_manual_days（会社×日×車）＝「手で 入れた 1日ぶん」
  //   ★売上は 0 の まま★（実費だけ 入れる）＝走っていない 日に 売上は 立たない
  //   ★決まりは 上の karada と 同じ★（古い 3つは 列／足した 物は expenses）
  function saveTebiki(sess, companyId, hi, deviceId, cur, field, value) {
    const v = seisuu(value);
    cur = cur || {};
    const body = {
      company_id: companyId,
      work_date: hi,
      device_id: deviceId,
      sales_yen: cur.sales_yen || 0,
      hours: cur.hours || 0,
      trip_count: cur.trip_count || 0,
      toll_yen: cur.toll_yen || 0,
      bridge_yen: cur.bridge_yen || 0,
      other_yen: cur.other_yen || 0,
      // ★電子決済を 車ごとに 持つ★ 2026-09-11
      denshi_yen: cur.denshi_yen || 0,
      expenses: cur.expenses || {},
      updated_at: new Date().toISOString(),
    };
    // ★★回数・実車距離・総走行距離★★ 2026-10-05（司さん「車ごとに回数や実車距離や総走行距離を入れる欄」）
    //   距離は ★画面では km★・しまうのは ★メートル★（メーターの dk_shifts と 同じ 単位）。
    //   ★距離の 列は 打った 時か 既に 値が 在る 時だけ 送る★
    //     （倉庫に 列が まだ 無い 線で 保存ごと 落ちない 為・merge-duplicates は 送った 列だけ 直す）
    motikosuSeikyu(body, cur);
    ['actual_total_m', 'total_distance_m'].forEach(function (k) {
      if (cur[k] !== undefined && cur[k] !== null) body[k] = cur[k];
    });
    if (field === 'trip_count') {
      body.trip_count = v;
    } else if (field === 'hours') {
      // ★★車の 時間（時数）★★ 2026-10-23（司さん「入力の各車ごとに経費の下に時数」）
      //   ★小数（0.25 刻み 等）★＝整数に 丸めない。空・0・読めない ⇒ 0（乗った人が 居ても 給料は 出ない＝入れ漏れの 印が 出る）
      //   ★時間は この 写しで 書く★（別の 写しで 書くと 次の 保存が cur.hours＝古い 値で 上書きする・対立役 A-3）
      const h = parseFloat(seiri(value, true));
      body.hours = isFinite(h) && h > 0 ? h : 0;
    } else if (field === 'actual_total_km' || field === 'total_distance_km') {
      const km = parseFloat(seiri(value, true));
      body[field.replace('_km', '_m')] = isFinite(km) && km > 0 ? Math.round(km * 1000) : null;
    } else if (FURUI[field]) {
      body[FURUI[field]] = v;
    } else if (field.indexOf('_yen') > 0) {
      body[field] = v;
    } else {
      const x = {};
      for (const k in body.expenses) x[k] = body.expenses[k];
      x[field] = v;
      body.expenses = x;
    }
    return global.DKSession.rest(
      sess,
      'dk_manual_days?on_conflict=company_id,work_date,device_id',
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(body),
      }
    ).then(function (r) {
      if (!r.ok) throw r;
      return body;
    });
  }

  // ★★手で 入れた 1日ぶんを 消す★★ 2026-10-23（給料の 画面の「この車を消す」を 入力の 画面へ 移した）
  //   その 日の その 車の 1行だけ（メーターの 記録は 消さない）
  function delTebiki(sess, companyId, hi, deviceId) {
    return global.DKSession.rest(
      sess,
      'dk_manual_days?company_id=eq.' +
        encodeURIComponent(companyId) +
        '&work_date=eq.' +
        encodeURIComponent(hi) +
        '&device_id=eq.' +
        encodeURIComponent(deviceId),
      { method: 'DELETE' }
    ).then(function (r) {
      if (!r.ok) throw r;
      return true;
    });
  }

  // ★電子決済（その日に 受け取った 分）を 保存する★
  function saveDenshi(sess, companyId, hi, value) {
    const v = seisuu(value);
    return global.DKSession.rest(sess, 'dk_day_extras?on_conflict=company_id,pay_date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        company_id: companyId,
        pay_date: hi,
        denshi_yen: v,
        updated_at: new Date().toISOString(),
      }),
    }).then(function (r) {
      if (!r.ok) throw r;
      return v;
    });
  }

  // ★★画面・紙に 出す 実費の 名前の 決まり（1か所）★★ 2026-10-20（司さん「会社で設定したものがここや月次などに反映されるんやろが」）
  //   kinds  … 会社設定の 一覧（dk_expense_kinds を 絞らずに）。読めない・空 ⇒ 今までの 3つ
  //   gakuOf … その 月（その 範囲）に 入っている 額（kind_id ⇒ 円）
  //   o.nyuryoku … 打つ 欄（「使う」を 外した 物は 出さない＝入力の 画面と 同じ）
  //   o.mieta    … 一度 出した 物（0 を 打っても その 場では 欄を 消さない＝打ち直せる）
  //   出す＝消していない 物 ＋ ★消した・一覧に 行が 無い 物でも その 月に 額が 在れば★（隠れたまま 引かれる 事を 作らない）
  //   ★お金は 見ない★（引く 額は js/uriage-agg.js deductOf＝名前の 一覧に 関わらず 前と 同じ）
  const FURUI_NA = { toll: '高速代', bridge: '橋代', other: 'その他' };
  function mieruKinds(kinds, gakuOf, o) {
    o = o || {};
    const gaku =
      typeof gakuOf === 'function'
        ? gakuOf
        : function () {
            return 0;
          };
    const mieta = o.mieta || {};
    if (!Array.isArray(kinds) || !kinds.length)
      return ['toll', 'bridge', 'other'].map(function (k) {
        return { kind_id: k, label: FURUI_NA[k] };
      });
    // 同じ kind_id が 2行 在る 時は 消していない 行を 使う（対立役 3回目 指4）
    const yoi = {};
    kinds.forEach(function (k) {
      if (!k || !k.kind_id) return;
      const m = yoi[k.kind_id];
      if (!m || (m.deleted_at && !k.deleted_at)) yoi[k.kind_id] = k;
    });
    const out = [];
    const mita = {};
    kinds.forEach(function (k0) {
      if (!k0 || !k0.kind_id || mita[k0.kind_id]) return;
      mita[k0.kind_id] = 1;
      const k = yoi[k0.kind_id];
      const ikiteru = !k.deleted_at && (!o.nyuryoku || k.active !== false);
      if (ikiteru || gaku(k.kind_id) > 0 || mieta[k.kind_id])
        out.push({ kind_id: k.kind_id, label: k.label || FURUI_NA[k.kind_id] || k.kind_id });
    });
    ['toll', 'bridge', 'other'].forEach(function (k) {
      if (!mita[k] && (gaku(k) > 0 || mieta[k])) out.push({ kind_id: k, label: FURUI_NA[k] });
    });
    return out;
  }

  global.JippiHozon = {
    mieruKinds: mieruKinds,
    FURUI: FURUI,
    seisuu: seisuu,
    seiri: seiri,
    yomuEn: yomuEn,
    yomuKm: yomuKm,
    ima: ima,
    goukei: goukei,
    karada: karada,
    yomuSeikyu: yomuSeikyu,
    seikyuUtta: seikyuUtta,
    saveJippi: saveJippi,
    saveUriage: saveUriage,
    saveKazu: saveKazu,
    saveTebiki: saveTebiki,
    delTebiki: delTebiki,
    saveDenshi: saveDenshi,
  };
})(window);
