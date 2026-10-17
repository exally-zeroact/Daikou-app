-- ============================================================
-- ★★人ごとの 歩合・最低保証・役割の「何日から」★★ 2026-10-18（docs/nannichi-kara-hito.md）
--
--   ★司さん 10-17★「その日より前は前の値」「1週間前の日付で設定したら遡って変わるようにしろよ」
--     「何日から変えれるかはユーザーが自由に指定できるように」（記録の 日付・値は 後から 直せて 消せる）
--   ★1行＝1人の 1つの 欄の「この 日から この 値」★
--     key   … 'pay_rate'（歩合）／ 'pay_floor'（最低保証）／ 'role'（役割）
--     value … その 日から 次の 記録の 日まで 効く 値（JSON の null＝空＝歩合・保証は 役割どおり）
--   ★記録が 無い 日（一番 古い 記録より 前）は dk_employees の 列の 値★（今と 同じ＝記録0の 人は 1円も 違わない）
--   ★守り★ 会社の 持ち主だけ 読める／書ける／消せる（他の 給料の 表と 同じ）＋ その 会社の 人だけ
--   ★1回だけ 流す★（create policy は 2回目に「もう在る」で 止まる＝それで よい）
-- ============================================================

create table if not exists daikome.dk_hito_rireki (
  rireki_id   uuid        primary key default gen_random_uuid(),
  company_id  uuid        not null references daikome.dk_companies (company_id) on delete cascade,
  employee_id uuid        not null references daikome.dk_employees (employee_id) on delete cascade,
  key         text        not null check (key in ('pay_rate', 'pay_floor', 'role')),
  from_date   date        not null,
  value       jsonb,
  created_at  timestamptz not null default now(),
  unique (employee_id, key, from_date)
);

create index if not exists dk_hito_rireki_co on daikome.dk_hito_rireki (company_id, employee_id);

alter table daikome.dk_hito_rireki enable row level security;

create policy dk_hito_rireki_owner_sel on daikome.dk_hito_rireki
  for select using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

-- ★書く 時は その 会社の 人か も 見る★（よその 会社の 人に 記録を 付けない）
create policy dk_hito_rireki_owner_ins on daikome.dk_hito_rireki
  for insert with check (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
    and employee_id in (
      select e.employee_id from daikome.dk_employees e where e.company_id = dk_hito_rireki.company_id
    )
  );

create policy dk_hito_rireki_owner_upd on daikome.dk_hito_rireki
  for update using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  ) with check (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
    and employee_id in (
      select e.employee_id from daikome.dk_employees e where e.company_id = dk_hito_rireki.company_id
    )
  );

create policy dk_hito_rireki_owner_del on daikome.dk_hito_rireki
  for delete using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

grant select, insert, update, delete on daikome.dk_hito_rireki to authenticated;

create or replace view public.dk_hito_rireki
  with (security_invoker = true) as
  select rireki_id, company_id, employee_id, key, from_date, value, created_at
    from daikome.dk_hito_rireki;

-- ★窓（public）の 鍵は 書かない★＝public の 窓は 倉庫の 既定の 鍵で 配られる（SQL の 門は public への grant を 止める）
