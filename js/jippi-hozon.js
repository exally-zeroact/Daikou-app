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

  function seisuu(v) {
    const n = parseInt(v, 10);
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
      expenses: cur.expenses || {},
      updated_at: new Date().toISOString(),
    };
    if (FURUI[field]) {
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
      expenses: cur.expenses || {},
      updated_at: new Date().toISOString(),
    };
    if (FURUI[field]) {
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

  global.JippiHozon = {
    FURUI: FURUI,
    seisuu: seisuu,
    ima: ima,
    goukei: goukei,
    karada: karada,
    saveJippi: saveJippi,
    saveTebiki: saveTebiki,
    saveDenshi: saveDenshi,
  };
})(window);
