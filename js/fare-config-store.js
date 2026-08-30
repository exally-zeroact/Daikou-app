// ============================================================
// js/fare-config-store.js
// ★★料金表の 置き場（Supabase）★★ 2026-08-30
//
//   ★司さんの指示★
//     「なんでFirebaseにあるんど 全部Supabaseに引越ししたろが」
//     「★Firebaseは2度と使うな★」「引っ越しもしろよ」
//
//   ★これは 何か★
//     料金表を ★Supabase★ から 読み書きします。★Firebase は 1行も 呼びません★
//     （試験が それを 機械で 見ています）。
//
//   ★★2026-08-30 直し（自分の間違い）★★
//     はじめ `DKSupabase.from(...)` で 書いていましたが、
//     ★この repo に DKSupabase という物は 存在しません★（supabase-js を 積んでいない）。
//     この repo の 作りは ★fetch で 直に 叩く★（js/dk-session.js / js/job-sync.js と同じ）。
//     ⇒ ★周りと 同じ書き方★に 直しました。
//
//   ★★読み書きの 道が 2つ ある（作りが 違うから）★★
//     ①★メーター（運転する人の 画面）★… ログインを ★持たない★・★オフライン前提★
//        ⇒ Edge Function `dk-fare-config`（url_token＋端末ID）で 読む／書く。
//        ⇒ 取れたら ★localStorage に 焼く★＝★圏外でも 料金が 出る★。
//        ★これが 一番 大事な所★です。ダイコメは 完全オフライン前提なので、
//        「通信できないと 料金が 出ない」作りには ★絶対に しません★。
//     ②★事務所（ログインしている 画面）★… PostgREST を 直に 叩く（RLS が 効く）
//        ⇒ 読む・書く・★1つ前に 戻す★。
//     ★メーターの 設定画面から 料金表を 変えられる力は 落としません★
//     （前は Firebase へ 認証なしで 全社共通の1件に 書いていた＝今の方が 狭い）。
//
//   ★前（Firebase）と 何が 違うか★
//     ①★倉庫が 1つに なる★（片方が 止まって 片方だけ 死ぬ、が 無くなる）
//     ②★会社ごとに 持てる★（前は 全社 共通の 1件だけ＝別の会社が 入れたら 全員 同じ料金）
//     ③★変えた記録が 残る★（前は ★上書き 1件だけ＝間違えても 戻せない★）
//     ④★圏外でも 前の料金表が 出る★（前は 圏外だと 何も 来なかった）
//
//   ★お金は 1円も 変えません★
//     読み込む形（キーの名前・値の意味）は ★前と 同じ★＝ Meter.setFareConfig に 渡す物が 変わらない。
//     ★1,044通りの 距離（段の境目 92個 全部込み）で 料金が 1円も 変わらない事を 試験で 見ています★。
//
//   ★走行中は 変えない★（今ある決まり＝Meter 側の _fareConfigFrozen を そのまま 使う）
// ============================================================
(function (global) {
  'use strict';

  // ★既定の 料金表★＝★引っ越し前に 使われていた 既定と 同じ値★
  //   （倉庫に まだ 1件も 無い会社は これを 使う。★勝手な 数字では ありません★）
  //
  //   ★★2026-08-30 直し（自分の間違い・お金の 差）★★
  //     はじめ rounding を ★1★ と 書いていました。★これは 前と 違います★。
  //     前の 既定は ★どちらの道でも 10★でした:
  //       ・js/meter.js の 内蔵の 既定 …………………… rounding ★10★
  //       ・js/firebase.js の _migrateFareConfig の 穴埋め … rounding ★10★
  //     ★1 は 端数を 丸めない・10 は 10円に 丸める★＝割増や 率を 使う会社で
  //     ★1円ずつ ずれます★。★引っ越しで 既定を 変えない★ので 10 に 戻しました。
  //     （司さんの 実物は rounding を ★1 と 自分で 持っている★ので この会社は 影響なし。
  //       効くのは「棚に まだ 何も 無い会社」だけ）
  const KITEI = {
    version: 2,
    base_fare: 1300,
    base_distance_m: 1000,
    add_fare: 100,
    add_distance_m: 420,
    rounding: 10,
    tiersEnabled: false,
    vehiclesEnabled: false,
    zonesEnabled: false,
    autoSurcharges: {
      night: { enabled: false, from: 22, to: 5, rate: 1.2 },
      weekend: { enabled: false, rate: 1.1 },
      winter: { enabled: false, from: '12-15', to: '03-15', rate: 1.1 },
    },
    wait: { enabled: false, freeMins: 5, ratePerMin: 100 },
  };

  const K_CACHE = 'dk_fare_config_cache'; // ★圏外用の 写し★
  const K_COMPANY = 'dk_license_company'; // 会社url_token（license-activate と 同じ鍵）
  const DEVICE_ID_KEY = 'DAIKOME_DEVICE_ID'; // 端末ID（job-sync / license と 同じ鍵）

  function _utsushi(o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  }

  function _ls() {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : global && global.localStorage;
    } catch (_) {
      return null;
    }
  }

  function _get(k) {
    try {
      const ls = _ls();
      return ls ? ls.getItem(k) : null;
    } catch (_) {
      return null;
    }
  }

  function _cfg() {
    try {
      return global && global.DKConfig ? global.DKConfig : null;
    } catch (_) {
      return null;
    }
  }

  // ★足りない所を 既定で 埋める★（前の _migrateFareConfig と 同じ考え方）
  //   ★在る値は 1つも 書き換えません★（勝手に 料金を 変えない）
  function totonoeru(raw) {
    const out = _utsushi(raw) || {};
    Object.keys(KITEI).forEach((k) => {
      if (out[k] === undefined || out[k] === null) out[k] = _utsushi(KITEI[k]);
    });
    // 入れ子も 足りない所だけ 埋める
    ['autoSurcharges', 'wait'].forEach((k) => {
      const kitei = KITEI[k];
      if (typeof kitei !== 'object') return;
      if (typeof out[k] !== 'object' || out[k] === null) out[k] = _utsushi(kitei);
      else {
        Object.keys(kitei).forEach((k2) => {
          if (out[k][k2] === undefined || out[k][k2] === null) out[k][k2] = _utsushi(kitei[k2]);
        });
      }
    });
    return out;
  }

  // ─── ①メーター側（ログイン無し・オフライン前提） ─────────────

  // ★焼いてある 写しを 読む★（通信 0回）。無ければ 既定。
  //   ★ここは 絶対に throw しません★（料金が 出ない画面を 作らない）
  function yomuOffline() {
    const raw = _get(K_CACHE);
    if (!raw) return { config: totonoeru(null), moto: 'kitei' };
    try {
      const v = JSON.parse(raw);
      const c = v && v.config ? v.config : null;
      if (!c) return { config: totonoeru(null), moto: 'kitei' };
      return { config: totonoeru(c), moto: 'utsushi', updated_at: v.updated_at || null };
    } catch (_) {
      return { config: totonoeru(null), moto: 'kitei' };
    }
  }

  function _yaku(config, updatedAt) {
    try {
      const ls = _ls();
      if (!ls) return;
      ls.setItem(K_CACHE, JSON.stringify({ config: config, updated_at: updatedAt || null }));
    } catch (_) {
      /* 焼けなくても 今の走行は 続けられる */
    }
  }

  // ★倉庫から 取り直して 写しを 焼く★
  //   返り値は ★必ず オブジェクト（throw しない）★
  //     { ok:true, config, moto:'souko'|'kitei' } … 取れた
  //     { ok:false, reason }                      … 取れなかった（★写しは 消しません★）
  async function torikomu(opts) {
    opts = opts || {};
    const cfg = _cfg();
    const urlToken = opts.urlToken || _get(K_COMPANY) || '';
    const deviceId = opts.deviceId || _get(DEVICE_ID_KEY) || '';
    if (!cfg) return { ok: false, reason: 'no_config' };
    if (!urlToken || !deviceId) return { ok: false, reason: 'not_activated' };
    let res;
    try {
      res = await fetch(cfg.fn('dk-fare-config'), {
        method: 'POST',
        headers: cfg.headers(),
        body: JSON.stringify({ url_token: urlToken, device_id: deviceId }),
      });
    } catch (e) {
      return { ok: false, reason: 'network' }; // ★圏外＝写しは そのまま★
    }
    if (!res || !res.ok) return { ok: false, reason: 'http_' + ((res && res.status) || 0) };
    let body;
    try {
      body = await res.json();
    } catch (_) {
      return { ok: false, reason: 'bad_json' };
    }
    if (!body || body.ok !== true) return { ok: false, reason: (body && body.reason) || 'ng' };
    // ★config が null＝棚に まだ 無い★。★写しを 消さない★（前の料金で 走り続ける）
    if (body.config == null) return { ok: false, reason: 'no_row' };
    const c = totonoeru(body.config);
    _yaku(c, body.updated_at);
    return { ok: true, config: c, moto: 'souko', updated_at: body.updated_at || null };
  }

  // ★メーターから 料金表を 変える★（今の 設定画面の 力を 落とさない）
  //   ★先に 写しを 焼いてから 送ります★＝送信が 落ちても
  //   ★画面と 次の走行は 新しい料金で 動く★（前は Firebase が 落ちたら 何も 残らなかった）
  //   返り値は ★必ず オブジェクト（throw しない）★
  async function kakuMeter(config, opts) {
    opts = opts || {};
    const cfg = _cfg();
    const ato = totonoeru(config);
    _yaku(ato, null); // ★まず 手元に 残す★
    const urlToken = opts.urlToken || _get(K_COMPANY) || '';
    const deviceId = opts.deviceId || _get(DEVICE_ID_KEY) || '';
    if (!cfg) return { ok: false, reason: 'no_config', config: ato };
    if (!urlToken || !deviceId) return { ok: false, reason: 'not_activated', config: ato };
    let res;
    try {
      res = await fetch(cfg.fn('dk-fare-config'), {
        method: 'POST',
        headers: cfg.headers(),
        body: JSON.stringify({ url_token: urlToken, device_id: deviceId, config: ato }),
      });
    } catch (_) {
      return { ok: false, reason: 'network', config: ato };
    }
    if (!res || !res.ok)
      return { ok: false, reason: 'http_' + ((res && res.status) || 0), config: ato };
    let body;
    try {
      body = await res.json();
    } catch (_) {
      return { ok: false, reason: 'bad_json', config: ato };
    }
    if (!body || body.ok !== true)
      return { ok: false, reason: (body && body.reason) || 'ng', config: ato };
    _yaku(ato, body.updated_at);
    return { ok: true, config: ato, updated_at: body.updated_at || null };
  }

  // ─── ②事務所側（ログインあり・PostgREST 直） ─────────────

  function _rest(sess, pathAndQuery, opts) {
    const cfg = _cfg();
    if (!cfg) return Promise.reject(new Error('no_config'));
    opts = opts || {};
    const h = cfg.headers(sess && sess.access_token ? sess.access_token : null);
    if (opts.headers) for (const k in opts.headers) h[k] = opts.headers[k];
    opts.headers = h;
    return fetch(cfg.rest(pathAndQuery), opts);
  }

  // ★読む★: 無ければ 既定を 返す（★null を 返して 画面を 空にしない★）
  //   ★取れなかった時は throw します★（事務所は 通信ありきの 画面なので、
  //   「読めなかった」を「既定です」と 見せると ★人が 上書きしてしまう★）
  async function yomu(sess, companyId) {
    if (!companyId) throw new Error('★会社が 決まっていません★');
    const res = await _rest(
      sess,
      'dk_fare_config?select=config,updated_at&company_id=eq.' + encodeURIComponent(companyId)
    );
    if (!res || !res.ok)
      throw new Error('★料金表を 読めませんでした★ status=' + ((res && res.status) || 0));
    const rows = await res.json();
    const raw = Array.isArray(rows) && rows[0] ? rows[0].config : null;
    return {
      config: totonoeru(raw),
      moto: raw ? 'souko' : 'kitei',
      updated_at: (Array.isArray(rows) && rows[0] && rows[0].updated_at) || null,
    };
  }

  // ★書く★: ★変えた記録も 一緒に 残す★（前は 上書きだけで 戻せなかった）
  async function kaku(sess, companyId, config, dare, opts) {
    if (!companyId) throw new Error('★会社が 決まっていません★');
    const mae = await yomu(sess, companyId);
    const ato = totonoeru(config);
    const up = await _rest(sess, 'dk_fare_config?on_conflict=company_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        company_id: companyId,
        config: ato,
        updated_at: new Date().toISOString(),
        updated_by: dare || null,
      }),
    });
    if (!up || !up.ok)
      throw new Error('★料金表を 保存できませんでした★ status=' + ((up && up.status) || 0));
    // ★記録は 失敗しても 本体を 止めません★（料金は 保存済み）
    try {
      await _rest(sess, 'dk_fare_config_history', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          company_id: companyId,
          changed_by: dare || null,
          before_config: mae.moto === 'souko' ? mae.config : null,
          after_config: ato,
          is_revert: !!(opts && opts.modoshi),
        }),
      });
    } catch (_) {
      /* 記録が 残らなくても 料金は 保存されています */
    }
    return ato;
  }

  // ★1つ前に 戻す★（戻した事も 記録に 残る）
  async function modosu(sess, companyId, dare) {
    if (!companyId) throw new Error('★会社が 決まっていません★');
    const res = await _rest(
      sess,
      'dk_fare_config_history?select=before_config&company_id=eq.' +
        encodeURIComponent(companyId) +
        '&order=changed_at.desc&limit=1'
    );
    if (!res || !res.ok)
      throw new Error('★記録を 読めませんでした★ status=' + ((res && res.status) || 0));
    const rows = await res.json();
    const saigo = Array.isArray(rows) && rows[0] ? rows[0].before_config : null;
    if (!saigo) return null; // 戻る先が 無い
    return kaku(sess, companyId, saigo, dare, { modoshi: true });
  }

  const api = {
    KITEI: KITEI,
    K_CACHE: K_CACHE,
    totonoeru: totonoeru,
    // メーター側
    yomuOffline: yomuOffline,
    torikomu: torikomu,
    kakuMeter: kakuMeter,
    // 事務所側
    yomu: yomu,
    kaku: kaku,
    modosu: modosu,
  };
  if (global) global.FareConfigStore = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
