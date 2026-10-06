-- ============================================================
-- ★★給料の 手当・控除★★ 2026-10-06
--
--   ★司さん★「対応できるように対立でやれ」→ 手当・控除で 会社に 残る分を 動かすか →「ア」（動かす）
--     手当（ガソリン代・交通費・待機 など）は 会社が 払う 分＝給料の 総額に 足す・会社に 残る分が 減る
--     控除（前借り・制服代 など）は 会社に 戻る 分＝給料の 総額から 引く・会社に 残る分が 増える
--   ★1行＝1人の 1つの 手当 か 控除★（その 日が 入る 払う回の 明細に 載る）
--     kind … 'teate'（手当）／ 'koujo'（控除）
--   ★守り★ 会社の 持ち主だけ 読める／書ける／消せる（他の 給料の 表と 同じ）
--   ★1回だけ 流す★（create policy は 2回目に「もう在る」で 止まる＝それで よい）
-- ============================================================

create table if not exists daikome.dk_pay_adjustments (
  adj_id      uuid        primary key default gen_random_uuid(),
  company_id  uuid        not null references daikome.dk_companies (company_id) on delete cascade,
  employee_id uuid        not null,
  work_date   date        not null,
  kind        text        not null check (kind in ('teate', 'koujo')),
  label       text        not null default '',
  yen         integer     not null default 0 check (yen >= 0),
  created_at  timestamptz not null default now()
);

create index if not exists dk_pay_adjustments_co_date on daikome.dk_pay_adjustments (company_id, work_date);

alter table daikome.dk_pay_adjustments enable row level security;

create policy dk_pay_adjustments_owner_sel on daikome.dk_pay_adjustments
  for select using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_pay_adjustments_owner_ins on daikome.dk_pay_adjustments
  for insert with check (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_pay_adjustments_owner_upd on daikome.dk_pay_adjustments
  for update using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_pay_adjustments_owner_del on daikome.dk_pay_adjustments
  for delete using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

grant select, insert, update, delete on daikome.dk_pay_adjustments to authenticated;

create or replace view public.dk_pay_adjustments
  with (security_invoker = true) as
  select adj_id, company_id, employee_id, work_date, kind, label, yen, created_at
    from daikome.dk_pay_adjustments;

-- ★窓（public）の 鍵は 書かない★＝public の 窓は 倉庫の 既定の 鍵で 配られる（SQL の 門は public への grant を 止める）
