-- ============================================================
-- ★★売上から 引く 物（高速・橋・その他）の「何日から」★★ 2026-10-18（docs/nannichi-kara-uriage.md）
--
--   ★1行＝1つの 鍵の「この 日から 引く／引かない」★
--     key   … 'toll'（高速代）／ 'bridge'（橋代）／ 'other'（その他）＝dk_sales_settings の deduct_* と 同じ 3つ
--     value … その 日から 次の 記録の 日まで 効く（true＝引く・false＝引かない・空は 無い）
--   ★記録が 無い 日（一番 古い 記録より 前）は dk_sales_settings の 列の 値★（記録0の 会社は 1円も 違わない）
--   ★dk_sales_settings に 置かない 訳★ 古い 版の 画面（開いた ままの タブ）は 列だけを 書く＝記録は 消えない
--   ★守り★ 会社の 持ち主だけ 読める／書ける／消せる
--   ★1回だけ 流す★（create policy は 2回目に「もう在る」で 止まる＝それで よい）
-- ============================================================

create table if not exists daikome.dk_uriage_rireki (
  rireki_id   uuid        primary key default gen_random_uuid(),
  company_id  uuid        not null references daikome.dk_companies (company_id) on delete cascade,
  key         text        not null check (key in ('toll', 'bridge', 'other')),
  from_date   date        not null,
  value       boolean     not null,
  created_at  timestamptz not null default now(),
  constraint dk_uriage_rireki_uq unique (company_id, key, from_date)
);

alter table daikome.dk_uriage_rireki enable row level security;

create policy dk_uriage_rireki_owner_sel on daikome.dk_uriage_rireki
  for select using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_uriage_rireki_owner_ins on daikome.dk_uriage_rireki
  for insert with check (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_uriage_rireki_owner_upd on daikome.dk_uriage_rireki
  for update using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  ) with check (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_uriage_rireki_owner_del on daikome.dk_uriage_rireki
  for delete using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

grant select, insert, update, delete on daikome.dk_uriage_rireki to authenticated;

create or replace view public.dk_uriage_rireki
  with (security_invoker = true) as
  select rireki_id, company_id, key, from_date, value, created_at
    from daikome.dk_uriage_rireki;

-- ★窓（public）の 鍵は 書かない★＝public の 窓は 倉庫の 既定の 鍵で 配られる（SQL の 門は public への grant を 止める）
