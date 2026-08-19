// supabase/functions/dk-issue-license
// ダイコメ ライセンス STEP1: 会社URLトークン検証 → Ed25519署名ライセンストークン発行。
//   入力(POST JSON): { url_token, device_id, vin? }
//   出力: { ok:true, token } | { ok:false, reason }
//   token契約(client js/license-v2.verifyLicenseToken と厳密一致):
//     payloadB64 = base64url(utf8(JSON.stringify(payload)))
//     署名対象   = utf8bytes(payloadB64)      ← 送信文字列そのものに署名(JSON再直列化しない)
//     token      = payloadB64 + '.' + base64url(signature)
//   秘密鍵は Edge Function secret DK_LICENSE_PRIVKEY(pkcs8 pem)。公開鍵はアプリ同梱(license-v2 PUBLIC_KEY)。
//   ★秘密鍵は絶対に応答/ログに出さない★。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXP_MS = 60 * 24 * 60 * 60 * 1000; // 2ヶ月

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signEd25519(payload: Record<string, unknown>, pkcs8Pem: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(pkcs8Pem),
    { name: 'Ed25519' },
    false,
    ['sign']
  );
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign(
    { name: 'Ed25519' },
    key,
    new TextEncoder().encode(payloadB64) // ★payloadB64「文字列」のバイトに署名★
  );
  return payloadB64 + '.' + b64url(new Uint8Array(sig));
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

  let input: { url_token?: string; device_id?: string; vin?: string };
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, reason: 'bad_json' }, 400);
  }
  const url_token = (input.url_token || '').trim();
  const device_id = (input.device_id || '').trim();
  const vin = (input.vin || '').trim();
  if (!url_token || !device_id) return json({ ok: false, reason: 'missing' }, 400);

  const privKey = Deno.env.get('DK_LICENSE_PRIVKEY');
  if (!privKey) return json({ ok: false, reason: 'server_no_key' }, 500);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // 会社をURLトークンで引く(service_role=RLSバイパス)
  const { data: co, error } = await sb
    .from('dk_companies')
    .select('company_id, status, seat_limit, name')
    .eq('url_token', url_token)
    .maybeSingle();
  if (error) return json({ ok: false, reason: 'db_error' }, 500);
  if (!co) return json({ ok: false, reason: 'invalid_url' }, 404);

  // ★台数 = 有効化したスマホ(device_id)の数★ (司さん決定 2026-07-28: 車VIN固定はめんどくさい→スマホ単位)。
  //   契約台数まで有効化OK・どの車でも使える(車に固定しない)。同一device再活性化は無料(冪等)。
  //   スマホ壊れ/入れ替えは管理画面で古い端末を外して席を空ける。席チェックは有効化(オンライン)時だけ=業務はオフラインOK。
  try {
    const { data: dev } = await sb
      .from('dk_company_devices')
      .select('device_id')
      .eq('company_id', co.company_id)
      .eq('device_id', device_id)
      .maybeSingle();
    if (!dev) {
      const { count } = await sb
        .from('dk_company_devices')
        .select('device_id', { count: 'exact', head: true })
        .eq('company_id', co.company_id);
      if ((count || 0) >= (co.seat_limit || 1)) {
        return json({ ok: false, reason: 'seat_limit', seat_limit: co.seat_limit });
      }
    }
    // 端末を記録(upsert・冪等)。台数カウントの真実源。vinは参考情報として保存(判定には使わない)。
    await sb
      .from('dk_company_devices')
      .upsert(
        { company_id: co.company_id, device_id, vin, last_seen: new Date().toISOString() },
        { onConflict: 'company_id,device_id' }
      );
  } catch {
    // 台数テーブル未整備でも署名は出す(疎通を殺さない)。
  }

  const payload = {
    company_id: co.company_id,
    device_id,
    vin,
    status: co.status || 'on',
    exp: Date.now() + EXP_MS,
  };
  const token = await signEd25519(payload, privKey);
  return json({ ok: true, token });
});
