// supabase/functions/dk-reissue
// ダイコメ ライセンス: 管理リンクの再発行(公開LPから) (2026-07-28)。
//   会社URL(?c= の url_token・会社がドライバーに配ってるもの)を入れると、その会社の管理リンクを再表示。
//   入力(POST JSON): { url_token }  出力: { ok:true, name, manage_url } | { ok:false, reason }
//   ★本人確認=会社URL(url_token)を知ってること。＝ドライバーURLは自社の関係者に留める前提。
//     より強くするならメール確認(登録メールへ送る)を後で足す。★
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

  let input: { url_token?: string };
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, reason: 'bad_json' }, 400);
  }
  // 会社URL全体を貼られても ?c= から token を拾う
  let url_token = (input.url_token || '').trim();
  const m = url_token.match(/[?&]c=([a-zA-Z0-9]+)/);
  if (m) url_token = m[1];
  if (!url_token) return json({ ok: false, reason: 'missing' }, 400);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: co, error } = await sb
    .from('dk_companies')
    .select('name, admin_token')
    .eq('url_token', url_token)
    .maybeSingle();
  if (error) return json({ ok: false, reason: 'db_error' }, 500);
  if (!co || !co.admin_token) return json({ ok: false, reason: 'not_found' }, 404);

  return json({
    ok: true,
    name: co.name,
    manage_url: APP_BASE + '/manage.html?k=' + co.admin_token,
  });
});
