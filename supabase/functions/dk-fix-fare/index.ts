// ============================================================
// supabase/functions/dk-fix-fare
// ★★請求書の一覧で 直した金額を 事務所の売上へ 戻す★★ 2026-09-03（司さん）
//
//   ★司さんの言葉★「一覧で金額とか修正したら事務所の売上とかも自動で修正されるようにしろよ」
//
//   ★なぜ 要るか（実測）★
//     道は ★一方通行★でした。ダイコメ → 請求書 へ 送るだけで、
//     ★請求書 → ダイコメ へ 戻す道が 1本も 無かった★。
//     その為 一覧で 金額を 直しても、事務所の売上（dk_shifts.fare_total_yen）は 元のまま。
//
//   ★何を するか★
//     ① 請求書の行（daikou.meisai）を id で 引き、★その人の物か★を 確かめる
//     ② その行の extra.dk_ref（端末:業務開始:何本目）から ダイコメの 代行1件を 探す
//     ③ ★その代行の 金額だけ★ を 直す（daikome.dk_trips.fare_yen）
//     ④ ★業務の 合計を 数え直す★（daikome.dk_shifts.fare_total_yen ＝ その業務の 代行の 合計）
//
//   ★絶対に 触らない物★
//     ・★距離★（distance_m / total_distance_m / actual_total_m / empty_distance_m）… 1mmも 触らない
//     ・料金表（dk_fare_config）／他の 業務／他の 会社の 物
//     ・請求書側の 行（ここは ダイコメ側を 直すだけ。請求書側は 呼ぶ前に 既に 直っている）
//
//   ★守り★
//     ・★その行の 持ち主でなければ 断る★（meisai.user_id ＝ 呼んだ人）
//     ・★その端末が その会社の 端末でなければ 断る★（よその会社の 数字を 動かせない）
//     ・★手で入れた行は 断る★（dk_ref が 無い＝ダイコメ発では ない）
//     ・★throw しない★＝何が あっても 画面は 止めない（呼ぶ側は 返事を 見るだけ）
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);

  let body: { meisai_id?: string } = {};
  try {
    body = await req.json();
  } catch (_) {
    return json({ ok: false, reason: 'bad_json' }, 400);
  }
  const meisaiId = String(body.meisai_id || '');
  if (!meisaiId) return json({ ok: false, reason: 'no_id' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // ★呼んだ人を 確かめる★（Authorization の JWT から）
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ ok: false, reason: 'no_auth' }, 401);
  const { data: who } = await createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  }).auth.getUser();
  const uid = who?.user?.id || null;
  if (!uid) return json({ ok: false, reason: 'no_user' }, 401);

  // ① 請求書の行を 引く（★その人の物か★も ここで 確かめる）
  const { data: row } = await sb
    .from('meisai')
    .select('id, user_id, amount, extra, deleted_at')
    .eq('id', meisaiId)
    .maybeSingle();
  if (!row) return json({ ok: false, reason: 'no_row' }, 404);
  if (row.user_id !== uid) return json({ ok: false, reason: 'not_yours' }, 403);
  if (row.deleted_at) return json({ ok: false, reason: 'deleted' }, 409);

  const extra = (row.extra || {}) as Record<string, unknown>;
  if (extra.dk_source !== 'daikome' || typeof extra.dk_ref !== 'string') {
    return json({ ok: true, updated: 0, reason: 'not_daikome' }); // ★手で入れた行＝戻す先が 無い★
  }
  const parts = String(extra.dk_ref).split(':');
  const deviceId = parts[0] || '';
  const shiftStartMs = Number(parts[1]);
  const seq = Number(parts[2]);
  if (!deviceId || !isFinite(shiftStartMs) || !isFinite(seq)) {
    return json({ ok: true, updated: 0, reason: 'bad_ref' });
  }

  // ★その端末が その人の 会社の 物か★（よその会社の 数字を 動かさない）
  const { data: co } = await sb
    .from('dk_companies')
    .select('company_id')
    .eq('owner_id', uid)
    .maybeSingle();
  if (!co) return json({ ok: false, reason: 'no_company' }, 403);
  const { data: dev } = await sb
    .from('dk_company_devices')
    .select('device_id')
    .eq('company_id', co.company_id)
    .eq('device_id', deviceId)
    .maybeSingle();
  if (!dev) return json({ ok: false, reason: 'unknown_device' }, 403);

  // ② 業務を 探す（端末＋業務開始の 時刻）
  const startIso = new Date(shiftStartMs).toISOString();
  const { data: shift } = await sb
    .from('dk_shifts')
    .select('shift_id')
    .eq('company_id', co.company_id)
    .eq('device_id', deviceId)
    .eq('started_at', startIso)
    .maybeSingle();
  if (!shift) return json({ ok: true, updated: 0, reason: 'no_shift' });

  // ③ その代行1件の ★金額だけ★ 直す（★距離には 触らない★）
  const yen = typeof row.amount === 'number' ? Math.round(row.amount) : null;
  if (yen === null) return json({ ok: true, updated: 0, reason: 'no_amount' });
  const { error: tErr, count } = await sb
    .from('dk_trips')
    .update({ fare_yen: yen }, { count: 'exact' })
    .eq('shift_id', shift.shift_id)
    .eq('seq', seq);
  if (tErr) return json({ ok: false, reason: 'trip_update_failed' }, 500);

  // ④ 業務の 合計を 数え直す（★足し算し直すだけ★・件数や距離は 触らない）
  const { data: trips } = await sb
    .from('dk_trips')
    .select('fare_yen')
    .eq('shift_id', shift.shift_id);
  const goukei = (trips || []).reduce(
    (a: number, t: { fare_yen: number | null }) => a + (typeof t.fare_yen === 'number' ? t.fare_yen : 0),
    0
  );
  const { error: sErr } = await sb
    .from('dk_shifts')
    .update({ fare_total_yen: goukei })
    .eq('shift_id', shift.shift_id);
  if (sErr) return json({ ok: false, reason: 'shift_update_failed' }, 500);

  return json({ ok: true, updated: count || 0, shift_total: goukei });
});
