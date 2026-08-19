// supabase/functions/dk-customers
// ★請求先マスタ(会社一覧)をドライバー端末に配る (2026-07-31)★
//
//   実車中の「請求書」ボタンで選ぶ会社の一覧。
//   ★マスタは代行請求書アプリの `companies` テーブルが唯一の正★(ダイコメ側に別マスタを作らない
//     =会社を2箇所に登録させない。司さん指摘)。
//
//   入力(POST JSON): { url_token, device_id }
//   出力: { ok:true, customers:[{ id, name }] } | { ok:false, reason }
//
//   ▼なぜ Edge Function 経由か
//     ドライバー端末はログインを持たない(会社URLで有効化するだけ)。
//     `companies` は user_id(ログインした人)で守られているので、端末からは直接読めない。
//     ここで「会社URL → その会社の持ち主(owner_id) → その人の請求先一覧」まで解決して返す。
//
//   ▼安全
//     ・その端末が本当にその会社の端末か(dk_company_devices)を必ず確認する。
//     ・返すのは id と name だけ(様式/単価などの中身は端末に配らない)。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MAX_CUSTOMERS = 500;

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

  let input: { url_token?: string; device_id?: string };
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, reason: 'bad_json' }, 400);
  }
  const url_token = (input.url_token || '').trim();
  const device_id = (input.device_id || '').trim();
  if (!url_token || !device_id) return json({ ok: false, reason: 'missing' }, 400);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: co, error: coErr } = await sb
    .from('dk_companies')
    .select('company_id, owner_id')
    .eq('url_token', url_token)
    .maybeSingle();
  if (coErr) return json({ ok: false, reason: 'db_error' }, 500);
  if (!co) return json({ ok: false, reason: 'invalid_url' }, 404);

  // ★その端末がこの会社の端末か確認(よその端末に配らない)★
  const { data: dev } = await sb
    .from('dk_company_devices')
    .select('device_id')
    .eq('company_id', co.company_id)
    .eq('device_id', device_id)
    .maybeSingle();
  if (!dev) return json({ ok: false, reason: 'unknown_device' }, 403);

  // 会社の持ち主がまだアカウント登録していない = 請求先も無い(空で返す。エラーにしない)
  if (!co.owner_id) return json({ ok: true, customers: [] });

  // 代行請求書アプリの請求先マスタ
  const { data: rows, error: cErr } = await sb
    .from('companies')
    .select('id, name, config')
    .eq('user_id', co.owner_id)
    .is('deleted_at', null)
    .order('name')
    .limit(MAX_CUSTOMERS);
  // マスタがまだ無い/読めない場合も業務を止めない(空で返す)
  if (cErr) return json({ ok: true, customers: [] });

  // ★誰が乗ったかを選ばせる会社か (2026-08-05・司さん指摘)★
  //   藤原建設株式会社 は請求書を「会長／社長／専務」で分けて小計を出す設定
  //   (companies.config.noteGroups)。ところがメーターに★誰が乗ったかを選ぶ所が無く★、
  //   自動投入するとその会社の行だけ備考が空で上がり、仕分けから外れていた。
  //   ⇒ 分け方をそのまま端末へ配って、請求先を選んだら続けて名前も選ばせる。
  //     (会社が増えても・分け方が変わっても、事務所の設定を直すだけで済む)
  const groupsOf = (cfg: unknown): string[] => {
    try {
      const g = (cfg as Record<string, unknown> | null)?.noteGroups;
      if (!Array.isArray(g)) return [];
      return g
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter((x) => x)
        .slice(0, 20);
    } catch {
      return [];
    }
  };

  const customers = (rows || [])
    .filter((r) => r && r.name)
    .map((r) => {
      const groups = groupsOf(r.config);
      const c: Record<string, unknown> = { id: String(r.id), name: String(r.name) };
      if (groups.length) c.note_groups = groups; // 使わない会社には付けない(端末を軽く保つ)
      return c;
    });

  return json({ ok: true, customers });
});
