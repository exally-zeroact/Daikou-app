'use strict';
// ============================================================
// ★★時数（車の 時間・乗った人）の 判じと 保存★★ 2026-10-23
//
//   ★司さんの言葉★「給料の時数を入れるを入力の各車ごとに経費の下に時数、乗った人
//                    （時数を自由に今のように）して給料タブは確認と従業員の設定だけにして」
//     ⇒ 時数を 打つ 所が 給料の 画面（kyuryo.html）から 入力の 画面（nyuryoku.html）へ 移る。
//       ★同じ 決まりを 2か所に 書かない★ 為に ここへ 出した（入れ漏れの 判じ・3つの 保存）。
//
//   ★ここが 持つ 決まり★
//     ①入れ漏れの 判じ（noriNashi）＝給料の 計算（PayrollDaily.buildCtx の ctx）と 同じ 材料で 数える
//       （車の 時間＝elapsed_sec・ended_at・手で 直した 時間／自分の 車＝ownerDeviceId／名簿＝empById）
//     ②メーターの 車の 時間＝dk_shift_edits.hours（業務ごと・この 列だけ 送る）
//     ③乗った人＝dk_work_hours（会社×日×人 で 1行・device_id が 乗った 車）・外す＝DELETE
//     ★手で 入れた 車の 時間は ここで 書かない★＝JippiHozon.saveTebiki（同じ 行の 他の 列と 一緒に 送る 写し）
//       （別の 写しで 書くと 次の saveTebiki が hours を 古い 値で 上書きして 給料が 黙って 0 に なる）
//     ★元データ（dk_shifts / dk_trips）には 1行も 書きません★
//     ★お金の 計算は ここには 在りません★（判じは「給料が 出る 人が 居るか」を 見るだけ）
// ============================================================

(function (global) {
  function num(v) {
    const x = parseFloat(v);
    return isFinite(x) ? x : 0;
  }

  // ★その 日の 確かめが 要る 所★（給料の 計算 payroll-daily の dayInput と 同じ 数え方）
  //   cars ＝ 動いた 車（自分の 車は 除く・売上か 時間が 在る）なのに 給料が 出る 人が 0人
  //          （乗った人が 居ない／居ても 時間が 0＝計算は 行を 作らない）
  //   hito ＝ 車の 記録が 無い 車（車が 空も）に 乗った 人で 給料が 出ている
  //          （売上の 母数に 入らない 車の 人へ 他の 車の 稼ぎから 払う）
  //   ctx は PayrollDaily.buildCtx の 返り（byDate・hoursByDate・empById・settings.ownerDeviceId）
  function noriNashi(ctx, date) {
    const cars = (ctx && ctx.byDate && ctx.byDate[date]) || {};
    const own = (ctx && ctx.settings && ctx.settings.ownerDeviceId) || '';
    const wh = (ctx && ctx.hoursByDate && ctx.hoursByDate[date]) || {};
    const emp = (ctx && ctx.empById) || {};
    const deru = {};
    const noru = {};
    const hito = [];
    Object.keys(wh).forEach(function (empId) {
      if (!emp[empId]) return; // 計算も 知らない 人は 入れない
      const w = wh[empId];
      noru[w.device_id] = true;
      const car = cars[w.device_id];
      const h = w.hours > 0 ? w.hours : car ? car.hours : 0;
      if (!(h > 0)) return; // 計算は 行を 作らない
      if (car) deru[w.device_id] = true;
      else hito.push(empId);
    });
    const nashi = Object.keys(cars).filter(function (dev) {
      const c = cars[dev] || {};
      if (dev === own || deru[dev]) return false;
      // 乗った人が 居るのに 給料が 出る 人が 0人 なら 売上・時間 0 でも 数える（対立役 3回：
      //   手で 足した 車に 時間 空の 人を 乗せた 日が「入れ漏れ無し」に なった）
      return num(c.hours) > 0 || num(c.sales) > 0 || !!noru[dev];
    });
    return { cars: nashi, hito: hito };
  }

  // ★時間の 字を 読む★（空・0・読めない ⇒ null＝自動／その人は 車の 時間）
  function yomuJikan(value) {
    const v = parseFloat(value);
    return isFinite(v) && v > 0 ? v : null;
  }

  function okuru(sess, path, body) {
    return global.DKSession.rest(sess, path, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r || !r.ok) throw r;
      return body;
    });
  }

  // ★メーターの 車の 時間★（業務ごと・dk_shift_edits.hours）
  //   ★時間の 列だけ 送る★（2026-10-14 対立役：開いた 時の 高速代 等も 送ると 別の 画面で 直した 額を
  //   古い 値で 上書きした＝merge-duplicates は 送った 列を 全部 書く）
  //   空 ⇒ null＝メーターの 記録から 自動
  function saveCarHours(sess, shiftId, companyId, value) {
    return okuru(sess, 'dk_shift_edits?on_conflict=shift_id', {
      shift_id: shiftId,
      company_id: companyId,
      hours: yomuJikan(value),
      updated_at: new Date().toISOString(),
    });
  }

  // ★乗った人★（会社×日×人 で 1行）。hours 0＝乗った 車の 時間を 使う
  //   ★同じ 人を 別の 車に 送ると 黙って 車が 移る★（鍵に 車が 無い）＝呼ぶ 側が 保存中は 札を 止める
  function saveWorkHour(sess, companyId, date, employeeId, deviceId, value) {
    const v = yomuJikan(value);
    return okuru(sess, 'dk_work_hours?on_conflict=company_id,work_date,employee_id', {
      company_id: companyId,
      work_date: date,
      employee_id: employeeId,
      device_id: deviceId || '',
      hours: v === null ? 0 : v,
      updated_at: new Date().toISOString(),
    });
  }

  // ★乗った人を 外す★（その 日の その 人の 1行を 消す）
  function delWorkHour(sess, companyId, date, employeeId) {
    return global.DKSession.rest(
      sess,
      'dk_work_hours?company_id=eq.' +
        encodeURIComponent(companyId) +
        '&work_date=eq.' +
        encodeURIComponent(date) +
        '&employee_id=eq.' +
        encodeURIComponent(employeeId),
      { method: 'DELETE' }
    ).then(function (r) {
      if (!r || !r.ok) throw r;
      return true;
    });
  }

  global.JisuuHozon = {
    noriNashi: noriNashi,
    yomuJikan: yomuJikan,
    saveCarHours: saveCarHours,
    saveWorkHour: saveWorkHour,
    delWorkHour: delWorkHour,
  };
})(typeof window !== 'undefined' ? window : globalThis);
