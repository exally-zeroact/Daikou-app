// supabase/functions/dk-fare-config
// ★★料金表を メーターへ 配る（Firebase → Supabase の 引っ越し）★★ 2026-08-30
//
//   ★司さんの指示★「全部Supabaseに引越ししたろが」「★Firebaseは2度と使うな★」「引っ越しもしろよ」
//
//   入力(POST JSON): { url_token, device_id }            … ★読む★
//                    { url_token, device_id, config:{} } … ★書く★
//   出力: { ok:true, config:{...}, updated_at } | { ok:false, reason }
//
//   ▼設計の要点（dk-sync-jobs と ★同じ考え方★に そろえる）
//     ・会社は url_token で引く（★メーターは ログインを 持たない★ため）。
//     ・★その端末が 本当に その会社の端末か(dk_company_devices)を 必ず 確認する★
//       ＝読む時も 書く時も 先に 確認する（よそへ 渡さない・よそから 書かせない）。
//     ・★未払い(status='off')でも 料金表は 返す★＝データを 人質にしない（dk-sync-jobs と同じ）。
//     ・棚に まだ 1件も 無い会社は ★config:null★ を 返す。
//       ★「0円の料金表」を でっち上げない★＝呼ぶ側が 前の写し／既定を 使えるように、
//       「無い」と はっきり 言う。
//
//   ★★なぜ 書く道も 要るのか（2026-08-30）★★
//     今の メーターの 設定画面は ★料金表を 変えられます★（Firebase へ 直に 書いていた）。
//     引っ越しで その力を ★落としません★（司さんの 操作を 勝手に 減らさない）。
//     ★今より 弱くは なりません★:
//       前 … Firebase の `fare_config/default` 1件に ★誰でも 認証なしで★ 書けた
//             （＝★別の会社が 変えると 全社の 料金が 変わる★）
//       今 … ★その会社に 登録された 端末★だけが ★その会社の 行★に 書ける
//     ★変えた記録(history)も 必ず 残す★＝間違えても 戻せる。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, authorization, apikey',
        'access-control-allow-methods': 'POST, OPTIONS',
      },
    });
  }
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);

  let input: { url_token?: string; device_id?: string; config?: unknown };
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, reason: 'bad_json' }, 400);
  }

  const url_token = (input.url_token || '').trim();
  const device_id = (input.device_id || '').trim();
  if (!url_token || !device_id) return json({ ok: false, reason: 'missing' }, 400);

  // ★書く時だけ config が 付く★。形が おかしい物は ★受け取らない★
  //   （配列や 文字列を 入れられると 料金表が 壊れて 画面が 空になる）
  const kakuNoka = Object.prototype.hasOwnProperty.call(input, 'config');
  if (kakuNoka) {
    const c = input.config;
    if (typeof c !== 'object' || c === null || Array.isArray(c)) {
      return json({ ok: false, reason: 'bad_config' }, 400);
    }
    if (JSON.stringify(c).length > 200000) return json({ ok: false, reason: 'too_big' }, 400);
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: co, error: coErr } = await sb
    .from('dk_companies')
    .select('company_id')
    .eq('url_token', url_token)
    .maybeSingle();
  if (coErr) return json({ ok: false, reason: 'db_error' }, 500);
  if (!co) return json({ ok: false, reason: 'invalid_url' }, 404);

  // ★その端末が この会社の端末として 登録されているか（よそへ 料金表を 渡さない）★
  const { data: dev } = await sb
    .from('dk_company_devices')
    .select('device_id')
    .eq('company_id', co.company_id)
    .eq('device_id', device_id)
    .maybeSingle();
  if (!dev) return json({ ok: false, reason: 'unknown_device' }, 403);

  const { data: row, error: fErr } = await sb
    .from('dk_fare_config')
    .select('config, updated_at')
    .eq('company_id', co.company_id)
    .maybeSingle();
  // ★読めなかったのを「無い」と 言わない★（呼ぶ側が 前の写しを 消してしまう）
  if (fErr) return json({ ok: false, reason: 'db_error' }, 500);

  if (kakuNoka) {
    const now = new Date().toISOString();
    const { error: uErr } = await sb.from('dk_fare_config').upsert(
      {
        company_id: co.company_id,
        config: input.config,
        updated_at: now,
        updated_by: 'device:' + device_id,
      },
      { onConflict: 'company_id' }
    );
    // ★保存できなかったのを 200 で 返さない★（画面が「保存しました」と 嘘を つく）
    if (uErr) return json({ ok: false, reason: 'save_failed' }, 500);
    // ★変えた記録★は 残らなくても 料金は 保存済み＝本体を 止めない
    try {
      await sb.from('dk_fare_config_history').insert({
        company_id: co.company_id,
        changed_by: 'device:' + device_id,
        before_config: row ? row.config : null,
        after_config: input.config,
        is_revert: false,
      });
    } catch (_) {
      /* 記録が 残らなくても 料金は 保存されています */
    }
    return json({ ok: true, company_id: co.company_id, config: input.config, updated_at: now });
  }

  return json({
    ok: true,
    company_id: co.company_id,
    config: row ? row.config : null,
    updated_at: row ? row.updated_at : null,
  });
});
