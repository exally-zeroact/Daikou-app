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
  // ★読みの 失敗は「見つからない」に 化かさない★ 2026-10-14（対立役：通信の 失敗が no_row・no_shift 等に なり、
  //   合計の 読みが 落ちると 0円を 書いて ok:true を 返した）＝読めなければ 500 read_failed で 何も 書かずに 返す
  const { data: row, error: rErr } = await sb
    .from('meisai')
    .select('id, user_id, amount, extra, deleted_at')
    .eq('id', meisaiId)
    .maybeSingle();
  if (rErr) return json({ ok: false, reason: 'read_failed', at: 'meisai' }, 500);
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
  const { data: co, error: cErr } = await sb
    .from('dk_companies')
    .select('company_id')
    .eq('owner_id', uid)
    .maybeSingle();
  if (cErr) return json({ ok: false, reason: 'read_failed', at: 'company' }, 500);
  if (!co) return json({ ok: false, reason: 'no_company' }, 403);
  const { data: dev, error: dErr } = await sb
    .from('dk_company_devices')
    .select('device_id')
    .eq('company_id', co.company_id)
    .eq('device_id', deviceId)
    .maybeSingle();
  if (dErr) return json({ ok: false, reason: 'read_failed', at: 'device' }, 500);
  if (!dev) return json({ ok: false, reason: 'unknown_device' }, 403);

  // ② 業務を 探す（端末＋業務開始の 時刻）
  const startIso = new Date(shiftStartMs).toISOString();
  const { data: shift, error: shErr } = await sb
    .from('dk_shifts')
    .select('shift_id')
    .eq('company_id', co.company_id)
    .eq('device_id', deviceId)
    .eq('started_at', startIso)
    .maybeSingle();
  if (shErr) return json({ ok: false, reason: 'read_failed', at: 'shift' }, 500);
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
  // 直す 代行が 見つからない（seq が 合わない）＝何も 直していない ⇒ 合計も 事務所の 直しも 触らない 2026-10-14（対立役）
  if (!count) return json({ ok: true, updated: 0, reason: 'no_trip' });

  // ④ 業務の 合計を 数え直す（★足し算し直すだけ★・件数や距離は 触らない）
  const { data: trips, error: tsErr } = await sb
    .from('dk_trips')
    .select('fare_yen')
    .eq('shift_id', shift.shift_id);
  // ★合計を 読めない 時は 書かない★（前は trips が null で 0円を 書いた）。代行 1件は ③で 直っている
  if (tsErr || !Array.isArray(trips))
    return json({ ok: false, reason: 'read_failed', at: 'trips', updated: count || 0 }, 500);
  const goukei = (trips || []).reduce(
    (a: number, t: { fare_yen: number | null }) => a + (typeof t.fare_yen === 'number' ? t.fare_yen : 0),
    0
  );
  const { error: sErr } = await sb
    .from('dk_shifts')
    .update({ fare_total_yen: goukei })
    .eq('shift_id', shift.shift_id);
  if (sErr) return json({ ok: false, reason: 'shift_update_failed' }, 500);

  // ⑤ 事務所が 給料の 画面で 直した 売上（dk_shift_edits.uriage_yen）を 外す 2026-10-14
  //   司さん「請求書や給料のとこの売上かえたら変えた最後のやつで合わせろや」
  //   ＝請求書の 一覧で 直した（今）＝こちらが 後＝事務所の 直しより 勝つ。出来事の 順で 決める
  //   （時刻や 値で 比べると 運転手の 端末の 送り直しで 事務所の 直しが 黙って 消える＝対立役 10-14）
  //   ★外せなかった 時は 黙らない★（売上が 請求書の 直しに 揃わない）＝返事に 出し、関数の ログにも 残す
  const { data: hazushita, error: uErr } = await sb
    .from('dk_shift_edits')
    .update({ uriage_yen: null, uriage_at: null })
    .eq('shift_id', shift.shift_id)
    .not('uriage_yen', 'is', null)
    .select('shift_id');
  if (uErr) {
    console.warn(
      '[dk-fix-fare] uriage_yen を 外せなかった ' +
        shift.shift_id +
        ' ' +
        String(uErr.message || uErr).slice(0, 80)
    );
    return json(
      { ok: false, reason: 'uriage_reset_failed', updated: count || 0, shift_total: goukei },
      500
    );
  }

  return json({
    ok: true,
    updated: count || 0,
    shift_total: goukei,
    uriage_hazushita: (hazushita || []).length,
  });
});
