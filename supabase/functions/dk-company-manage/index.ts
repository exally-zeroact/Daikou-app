// supabase/functions/dk-company-manage
// ダイコメ ライセンス: 会社 代表者ページ用API (2026-07-28)。
//   管理用トークン(admin_token・url_tokenとは別の秘密)で自社の情報を見る/端末を外す。
//   入力(POST JSON): { admin_token, action:'info'|'remove', device_id? }
//   出力(info/remove後): { ok:true, name, url_token, company_url, seat_limit, status, devices:[{device_id,vin,last_seen}] }
//   ★台数=スマホ(device)単位。端末を外す=席を1つ空ける。★
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ★この関数は秘密リンク方式=アカウント方式(dashboard.html)に置き換え済で廃止予定・未デプロイ。
//   接続先/URLの取り残しを防ぐため env 化だけ揃えてある。
const APP_BASE = (Deno.env.get('DK_APP_BASE') || 'https://daikou-app-test.vercel.app').replace(
  /\/+$/,
  ''
);

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

  let input: { admin_token?: string; action?: string; device_id?: string };
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, reason: 'bad_json' }, 400);
  }
  const admin_token = (input.admin_token || '').trim();
  const action = (input.action || 'info').trim();
  if (!admin_token) return json({ ok: false, reason: 'missing_token' }, 400);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // 管理用トークンで会社を引く(秘密トークン=これを知ってる人だけ管理できる)
  const { data: co, error } = await sb
    .from('dk_companies')
    .select('company_id, name, url_token, status, seat_limit')
    .eq('admin_token', admin_token)
    .maybeSingle();
  if (error) return json({ ok: false, reason: 'db_error' }, 500);
  if (!co) return json({ ok: false, reason: 'invalid_token' }, 404);

  // 端末を外す(席を空ける)
  if (action === 'remove') {
    const device_id = (input.device_id || '').trim();
    if (device_id) {
      await sb
        .from('dk_company_devices')
        .delete()
        .eq('company_id', co.company_id)
        .eq('device_id', device_id);
    }
  }

  // 現在の端末一覧を返す(info / remove後 共通)
  const { data: devices } = await sb
    .from('dk_company_devices')
    .select('device_id, vin, last_seen')
    .eq('company_id', co.company_id)
    .order('last_seen', { ascending: false });

  return json({
    ok: true,
    name: co.name,
    url_token: co.url_token,
    company_url: APP_BASE + '/?c=' + co.url_token,
    seat_limit: co.seat_limit,
    status: co.status,
    devices: devices || [],
  });
});
