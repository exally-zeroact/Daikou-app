-- ============================================================
-- ★★従業員が 自分の 給料明細を 自分で 見る（QR/URL を 配る）★★ 2026-09-03
--
--   ★司さんの言葉★
--     「Rakunallyみたいに 従業員ごとに QRコードや URLを 配って
--       個人が 勝手に 確認できるようにも しろやぼけ」
--
--   ★★作り方は Rakunally から そのまま 借りました★★（新しく 考えていません）
--     借りた 元 … rakually-test の `pay_meisai_pub` ＋ kyuyo/js/meisai.js の 流れ
--     ★借りてよいのは 道具・測り方・試験★（うちの 決まり）＝ここは ★仕組み★を 借りている。
--
--   ★流れ（Rakunally と 同じ）★
--     ①事務所が「配る」を 押す → ★人ごとに token と 初回コード★ が 出来る
--     ②配る URL ＝ `kyuryo-honnin.html?t=<token>&c=<初回コード>`
--       ★初回コードは URL に 埋める★＝本人は 打たなくてよい（QRを 読むだけ）
--     ③本人が 開く → ★自分の パスワードを 決める★（8文字以上）→ 初回コードは 消える
--     ④次からは ★パスワードだけ★で 自分の 給料明細が 見える
--     ⑤忘れた／漏れた → 事務所が ★再発行★（初回コードを 作り直し・パスワードを 消す）
--
--   ★なぜ パスワードを 付けるか★
--     給料明細は ★他人に 見えては いけない 物★。
--     URL だけだと ★リンクを 知った人 全員★が 見えてしまう。
--     ⇒ Rakunally が 既に この形（token＋初回コード＋本人のパスワード）で 動いている。
--
--   ★お金には 触りません★
--     この棚は ★見せる為の 鍵だけ★。給料の 計算・金額・距離には 1つも 触りません。
--
--   ★棚の 場所の 決まり（前に 2回 間違えた所）★
--     ★本体は daikome.◯◯★／public.◯◯ は ★窓(view)★。
--     `create or replace view` は ★security_invoker を 落とす★ので 必ず 付け直す。
-- ============================================================

create table if not exists daikome.dk_kyuryo_pub (
  token         text primary key,              -- 配る URL の ?t=（人ごと・当てられない長さ）
  company_id    uuid not null,                 -- どの会社の人か
  employee_id   uuid not null,                 -- 誰か（daikome.dk_employees）
  init_code     text,                          -- 初回コード（パスワードを 決めたら null）
  pw_hash       text,                          -- 本人が 決めた パスワード（pgcrypto crypt）
  device_tokens text[] default '{}',           -- 覚えた 端末（次から 楽に 入れる）
  consent_at    timestamptz,                   -- 本人が 同意した 時刻
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (company_id, employee_id)             -- ★1人 1本★（二重に 配らない）
);

comment on table daikome.dk_kyuryo_pub is
  '従業員が 自分の 給料明細を 見る為の 鍵（Rakunally の pay_meisai_pub を 借りた形）2026-09-03';

-- ★事務所（社長）だけが 自分の 会社の 分を 読める★
--   本人は ★Edge Function（service_role）経由★でしか 触らない＝ここに 政策は 足さない。
alter table daikome.dk_kyuryo_pub enable row level security;

-- ★★政策の 書き方で 2回 つまずいた（実測・記録として 残す）★★ 2026-09-03
--   1回目 `do $$ … $$` … ★この repo の 門番が 止める★（消す/書き換えの 書き方と 見なす）
--   2回目 `create policy if not exists` … ★PostgreSQL に その書き方は 無い★
--          ERROR 42601: syntax error at or near "not"
--   ⇒ ★素直に create policy★ にする。
--     ★2回目に 当てると この行だけ 赤★（＝もう 在るという意味・棚と 窓は 出来ている）。
--     `drop policy` は ★門番が 止める★ので 使わない。
create policy own_company on daikome.dk_kyuryo_pub
  for all
  using (
    exists (
      select 1 from daikome.dk_companies c
      where c.company_id = dk_kyuryo_pub.company_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from daikome.dk_companies c
      where c.company_id = dk_kyuryo_pub.company_id and c.owner_id = auth.uid()
    )
  );

-- ★事務所の 画面から 見る 窓★（★初回コードと パスワードは 出さない★）
--   ★出すのは「配ったか／パスワードを 決めたか」だけ★＝画面に 秘密を 置かない。
create or replace view public.dk_kyuryo_pub as
select
  p.token,
  p.company_id,
  p.employee_id,
  (p.init_code is not null) as init_code_ari,   -- 初回コードが 残っているか
  (p.pw_hash is not null)   as pw_ari,          -- 本人が パスワードを 決めたか
  p.consent_at,
  p.created_at,
  p.updated_at
from daikome.dk_kyuryo_pub p;

alter view public.dk_kyuryo_pub set (security_invoker = on);
