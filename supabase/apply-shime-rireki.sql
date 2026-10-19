-- ============================================================
-- ★★締めの 形（明細の 期間の 払い方）の「何日から」★★ 2026-10-19（docs/nannichi-kara-shime.md）
--
--   ★1行＝その 日から 効く 締めの 形の 全部★
--     value … dk_payroll_settings.period_shime と 同じ 形
--             {kind:'tsuki',hi:[…],nazuke} ／ {kind:'shuu',youbi,nazuke} ／ {kind:'hi'}
--             月3回は {kind:'tsuki',hi:[10,20,0]}（画面の PayrollPeriod.seiki が 月3回に 読む）
--     その 日から 次の 記録の 日まで 効く。細かい 形の 確かめは 画面の seiki（通らなければ 計算が 止める）
--   ★記録が 無い 日（一番 古い 記録より 前）は 列（period_shime / period_end_mode）の 形★（記録0の 会社は 1日も 違わない）
--   ★dk_payroll_settings に 置かない 訳★ 古い 版の 画面（開いた ままの タブ）は 列だけを 書く＝記録は 消えない
--   ★守り★ 会社の 持ち主だけ 読める／書ける／消せる
--   ★1回だけ 流す★（create policy は 2回目に「もう在る」で 止まる＝それで よい）
-- ============================================================

create table if not exists daikome.dk_shime_rireki (
  rireki_id   uuid        primary key default gen_random_uuid(),
  company_id  uuid        not null references daikome.dk_companies (company_id) on delete cascade,
  from_date   date        not null,
  value       jsonb       not null check (
                jsonb_typeof(value) = 'object' and value->>'kind' in ('tsuki', 'shuu', 'hi')
              ),
  created_at  timestamptz not null default now(),
  constraint dk_shime_rireki_uq unique (company_id, from_date)
);

alter table daikome.dk_shime_rireki enable row level security;

create policy dk_shime_rireki_owner_sel on daikome.dk_shime_rireki
  for select using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_shime_rireki_owner_ins on daikome.dk_shime_rireki
  for insert with check (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_shime_rireki_owner_upd on daikome.dk_shime_rireki
  for update using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  ) with check (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_shime_rireki_owner_del on daikome.dk_shime_rireki
  for delete using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

grant select, insert, update, delete on daikome.dk_shime_rireki to authenticated;

create or replace view public.dk_shime_rireki
  with (security_invoker = true) as
  select rireki_id, company_id, from_date, value, created_at
    from daikome.dk_shime_rireki;

-- ★窓（public）の 鍵は 書かない★＝public の 窓は 倉庫の 既定の 鍵で 配られる（SQL の 門は public への grant を 止める）
