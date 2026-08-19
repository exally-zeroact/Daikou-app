// supabase/functions/dk-register-company
// ダイコメ ライセンス: 会社登録(アカウント方式) (2026-07-29)。
//   ★ログイン済みユーザー(メールのマジックリンク)が、自分の会社を作る/取得する★
//   入力(POST JSON): { company_name, contact?, seat_limit? }  ※Authorization: Bearer <ユーザーaccess_token> 必須
//   出力: { ok:true, company_id, url_token, company_url, existed? } | { ok:false, reason }
//   owner_id = 呼出ユーザー(auth.uid)。既に会社があればそれを返す(重複作成しない=1オーナー1会社)。
//   url_token = 推測不能な乱数(16byte hex)。作成は service_role。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 会社URLのベース。★移設/本番ドメイン切替はコードを触らず Edge Function secret DK_APP_BASE で行う★
//   (未設定ならテスト環境のURLにフォールバック=今までの挙動)
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

function randToken(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
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

  // ---- 認証: 呼出ユーザーの access_token から owner_id を得る ----
  const authHeader = req.headers.get('Authorization') || '';
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: uerr,
  } = await anon.auth.getUser();
  if (uerr || !user) return json({ ok: false, reason: 'unauthorized' }, 401);
  const owner_id = user.id;

  let input: { company_name?: string; contact?: string; seat_limit?: number | string };
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, reason: 'bad_json' }, 400);
  }
  const name = (input.company_name || '').trim();
  const contact = (input.contact || '').trim();
  let seat = parseInt(String(input.seat_limit), 10);
  if (!Number.isFinite(seat)) seat = 1;
  seat = Math.max(1, Math.min(50, seat)); // 1〜50台に制限
  if (!name) return json({ ok: false, reason: 'no_name' }, 400);
  if (name.length > 100 || contact.length > 200)
    return json({ ok: false, reason: 'too_long' }, 400);

  const svc = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // 既にこのオーナーの会社があれば、それを返す(重複作成しない)。
  const { data: existing } = await svc
    .from('dk_companies')
    .select('company_id, url_token')
    .eq('owner_id', owner_id)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return json({
      ok: true,
      company_id: existing.company_id,
      url_token: existing.url_token,
      company_url: APP_BASE + '/?c=' + existing.url_token,
      existed: true,
    });
  }

  // 新規作成。url_token の衝突は極めて稀だが unique に当たったら1回だけ再試行。
  let row = null;
  for (let attempt = 0; attempt < 2 && !row; attempt++) {
    const url_token = randToken();
    const { data, error } = await svc
      .from('dk_companies')
      .insert({ url_token, name, contact, seat_limit: seat, status: 'on', owner_id })
      .select('company_id, url_token')
      .single();
    if (!error && data) row = data;
    else if (error && error.code !== '23505') return json({ ok: false, reason: 'db_error' }, 500);
  }
  if (!row) return json({ ok: false, reason: 'token_collision' }, 500);

  return json({
    ok: true,
    company_id: row.company_id,
    url_token: row.url_token,
    company_url: APP_BASE + '/?c=' + row.url_token,
  });
});
