'use strict';
// ============================================================
// ★★較正の 控え（雲に 預ける／戻す）★★ 2026-09-19
//
//   ★司さん★「車ごとに出さな何のために較正しよんど」
//             「今のが壊れんようにきっちりやれや」
//
//   ★何が 困っていたか（実測 2026-09-19）★
//     較正は ★車（VIN）ごと★ … index.html「VINキーで localStorage 保存」
//       タイヤ円周比（tireRatio）・1km学習K（k / calibKs）＝
//       ★タイヤを 替えたら 走って 取り直す★ 管理項目。
//     ところが ★倉庫に 車の表も 較正の表も 1つも 無かった★
//       （daikome の 20表 全部 見た・2026-09-19）
//     ⇒ スマホの データを 消すと ★較正が 丸ごと 消え、また 走って 取り直し★。
//
//   ★どう する か★
//     車の 一覧（localStorage の dk_veh_list）を ★そのまま 1つの かたまりで★ 預ける。
//     鍵は ★device_id（＝席＝車）★。
//     2026-09-19 に URL を 車ごとに したので
//     ★その車の URL を 開く → 同じ席 → 同じ 較正★ が 繋がる。
//
//   ★★「今のが 壊れない」為の 決まり（ここが 一番 大事）★★
//     ①★戻すのは 手元に 1台も 無い 時だけ★。
//       1台でも 在れば ★何も しない★＝今 動いている 端末は ★1バイトも 変わらない★。
//     ②★中身を 作り変えない★＝預かった 物を ★そのまま★ 返す。
//       tireRatio と k は ★距離に 掛け算される★（js/meter.js 127-129）。
//       計算し直したら ★距離が 動く★ ので 触らない。
//     ③★距離・料金の コードには 一切 触らない★
//     ④★失敗しても 何も しない★＝業務を 止めない（圏外・倉庫が 無い・鍵が 無い）
// ============================================================

(function (global) {
  const LIST_KEY = 'dk_veh_list';
  const TANA = 'dk_vehicle_backup';

  function _store() {
    try {
      return global && global.localStorage ? global.localStorage : null;
    } catch (_) {
      return null;
    }
  }

  // ★手元の 車の 一覧★（読めなければ 空）
  function temotoNoKuruma(store) {
    store = store || _store();
    if (!store) return [];
    try {
      const v = JSON.parse(store.getItem(LIST_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (_) {
      return [];
    }
  }

  // ★★戻してよいか＝手元が 空の 時だけ★★
  //   ここが この部品の 心臓。1台でも 在れば false ＝ 何も しない。
  function modoshiteYoika(store) {
    return temotoNoKuruma(store).length === 0;
  }

  function _cfg() {
    try {
      const c = global && global.DKConfig;
      if (!c || !c.SB_URL || !c.ANON_KEY) return null;
      return c;
    } catch (_) {
      return null;
    }
  }

  function _headers(cfg, extra) {
    const h = {
      apikey: cfg.ANON_KEY,
      Authorization: 'Bearer ' + cfg.ANON_KEY,
      'Content-Type': 'application/json',
    };
    if (extra) Object.keys(extra).forEach((k) => (h[k] = extra[k]));
    return h;
  }

  // ★預ける★（上書き・失敗しても 何も しない）
  function azukeru(companyId, deviceId, store) {
    const cfg = _cfg();
    const cars = temotoNoKuruma(store);
    if (!cfg || !companyId || !deviceId) return Promise.resolve({ ok: false, why: 'no_cfg' });
    if (!cars.length) return Promise.resolve({ ok: false, why: 'kara' }); // ★空を 預けない★
    try {
      return fetch(cfg.SB_URL + '/rest/v1/' + TANA + '?on_conflict=company_id,device_id', {
        method: 'POST',
        headers: _headers(cfg, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({
          company_id: companyId,
          device_id: deviceId,
          cars: cars, // ★そのまま★（作り変えない）
          updated_at: new Date().toISOString(),
        }),
      })
        .then((r) => ({ ok: !!(r && r.ok), why: r && r.ok ? '' : 'ng' }))
        .catch(() => ({ ok: false, why: 'offline' }));
    } catch (_) {
      return Promise.resolve({ ok: false, why: 'offline' });
    }
  }

  // ★戻す★（★手元が 空の 時だけ★・中身は そのまま 書く）
  function modosu(companyId, deviceId, store) {
    store = store || _store();
    const cfg = _cfg();
    if (!cfg || !companyId || !deviceId || !store)
      return Promise.resolve({ ok: false, why: 'no_cfg' });
    // ★★1台でも 在れば 何も しない★★
    if (!modoshiteYoika(store)) return Promise.resolve({ ok: false, why: 'temoto_ari' });
    try {
      const q =
        cfg.SB_URL +
        '/rest/v1/' +
        TANA +
        '?select=cars&company_id=eq.' +
        encodeURIComponent(companyId) +
        '&device_id=eq.' +
        encodeURIComponent(deviceId) +
        '&limit=1';
      return fetch(q, { headers: _headers(cfg) })
        .then((r) => (r && r.ok ? r.json() : []))
        .then((rows) => {
          const cars = rows && rows[0] && rows[0].cars;
          if (!Array.isArray(cars) || !cars.length) return { ok: false, why: 'hikae_nashi' };
          // ★取った 後に もう一度 見る★（待っている 間に 手元が 埋まる事が 在る）
          if (!modoshiteYoika(store)) return { ok: false, why: 'temoto_ari' };
          store.setItem(LIST_KEY, JSON.stringify(cars)); // ★そのまま★
          return { ok: true, dai: cars.length };
        })
        .catch(() => ({ ok: false, why: 'offline' }));
    } catch (_) {
      return Promise.resolve({ ok: false, why: 'offline' });
    }
  }

  const api = {
    LIST_KEY: LIST_KEY,
    temotoNoKuruma: temotoNoKuruma,
    modoshiteYoika: modoshiteYoika,
    azukeru: azukeru,
    modosu: modosu,
  };
  if (typeof global !== 'undefined') global.VehBackup = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
