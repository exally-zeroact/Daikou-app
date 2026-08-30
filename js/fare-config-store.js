// ============================================================
// js/fare-config-store.js
// ★★料金表の 置き場（Supabase）★★ 2026-08-30
//
//   ★司さんの指示★
//     「なんでFirebaseにあるんど 全部Supabaseに引越ししたろが」
//     「★Firebaseは2度と使うな★」「引っ越しもしろよ」
//
//   ★これは 何か★
//     料金表を ★Supabase の public.dk_fare_config★ から 読み書きします。
//     ★Firebase は 1行も 呼びません★（試験が それを 機械で 見ています）。
//
//   ★前（Firebase）と 何が 違うか★
//     ①★倉庫が 1つに なる★（片方が 止まって 片方だけ 死ぬ、が 無くなる）
//     ②★会社ごとに 持てる★（前は 全社 共通の 1件だけ＝別の会社が 入れたら 全員 同じ料金）
//     ③★変えた記録が 残る★（前は ★上書き 1件だけ＝間違えても 戻せない★）
//
//   ★お金は 1円も 変えません★
//     読み込む形（キーの名前・値の意味）は ★前と 同じ★です。
//     ＝ js/meter.js の calcFare に 渡す物が 変わらない。
//     ★787通りの 距離で 前後の 料金が 1円も 変わらない事を 試験で 見ています★。
//
//   ★走行中は 変えない★（今ある決まりを そのまま 使う）
// ============================================================
(function (global) {
  'use strict';

  // ★既定の 料金表★＝2026-08-30 に 引っ越し元から 読んだ 実物と ★同じ値★
  //   （倉庫に まだ 1件も 無い会社は これを 使う。★勝手な 数字では ありません★）
  const KITEI = {
    version: 2,
    base_fare: 1300,
    base_distance_m: 1000,
    add_fare: 100,
    add_distance_m: 420,
    rounding: 1,
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

  function _utsushi(o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
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

  function _sb() {
    try {
      return global && global.DKSupabase ? global.DKSupabase : null;
    } catch (_) {
      return null;
    }
  }

  // ★読む★: 無ければ 既定を 返す（★null を 返して 画面を 空にしない★）
  async function yomu(companyId) {
    const sb = _sb();
    if (!sb || !companyId) return { config: totonoeru(null), moto: 'kitei' };
    const r = await sb
      .from('dk_fare_config')
      .select('config')
      .eq('company_id', companyId)
      .maybeSingle();
    if (r && r.error) throw r.error;
    const raw = r && r.data ? r.data.config : null;
    return { config: totonoeru(raw), moto: raw ? 'souko' : 'kitei' };
  }

  // ★書く★: ★変えた記録も 一緒に 残す★（前は 上書きだけで 戻せなかった）
  async function kaku(companyId, config, dare, opts) {
    const sb = _sb();
    if (!sb || !companyId) throw new Error('★倉庫に つながっていません★');
    const mae = await yomu(companyId);
    const ato = totonoeru(config);
    const up = await sb.from('dk_fare_config').upsert(
      {
        company_id: companyId,
        config: ato,
        updated_at: new Date().toISOString(),
        updated_by: dare || null,
      },
      { onConflict: 'company_id' }
    );
    if (up && up.error) throw up.error;
    // ★記録は 失敗しても 本体を 止めません★（料金は 保存済み）
    try {
      await sb.from('dk_fare_config_history').insert({
        company_id: companyId,
        changed_by: dare || null,
        before_config: mae.moto === 'souko' ? mae.config : null,
        after_config: ato,
        is_revert: !!(opts && opts.modoshi),
      });
    } catch (_) {
      /* 記録が 残らなくても 料金は 保存されています */
    }
    return ato;
  }

  // ★1つ前に 戻す★（戻した事も 記録に 残る）
  async function modosu(companyId, dare) {
    const sb = _sb();
    if (!sb || !companyId) throw new Error('★倉庫に つながっていません★');
    const r = await sb
      .from('dk_fare_config_history')
      .select('before_config')
      .eq('company_id', companyId)
      .order('changed_at', { ascending: false })
      .limit(1);
    if (r && r.error) throw r.error;
    const saigo = r && r.data && r.data[0] ? r.data[0].before_config : null;
    if (!saigo) return null; // 戻る先が 無い
    return kaku(companyId, saigo, dare, { modoshi: true });
  }

  const api = { KITEI: KITEI, totonoeru: totonoeru, yomu: yomu, kaku: kaku, modosu: modosu };
  if (global) global.FareConfigStore = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
