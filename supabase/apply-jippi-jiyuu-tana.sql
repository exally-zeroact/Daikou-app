-- ============================================================
-- supabase/apply-jippi-jiyuu-tana.sql
--   ★実費の 名前の 一覧（dk_expense_kinds）の ★棚だけ★ を 作る★  2026-09-26
--
-- なぜ この紙が 要るか（★元の紙が 門を 通らない★）
--   本番の 倉庫には supabase/apply-jippi-jiyuu.sql を ★手で 貼って★ 当ててある。
--   ところが あの 紙には
--     ・drop policy if exists …（作り直しの ため）
--     ・insert into …（今の 3つを 種として 入れる）
--     ・update … set label = …（other_label を 写す）
--   が 入っているので ★scripts/sql-guard.mjs が 通さない★。
--   門を ゆるめるのは ★守るつもりを 作るだけ★なので ゆるめない。
--   ⇒ ★棚と 窓（＝画面が 動くのに 要る物）だけ★ を この紙に 分けた。
--
-- 種の 3行（高速代／橋代／その他）は ★入れない★
--   事務所の 画面 dashboard.html:1028 が
--   `/dk_expense_kinds?on_conflict=company_id,kind_id` で ★自分で 作る★ため。
--   （＝この紙を 当てた 後、事務所の 画面を 1度 開けば 並ぶ）
--
-- ★create policy は 2度 当てられない★（Postgres に create policy if not exists は 無い）。
--   既に 在る 倉庫（本番）に 当てると そこで 止まる＝★当ててはいけない★。
--   この紙は ★倉庫に dk_expense_kinds が 無い 線★（2026-09-26 時点＝テスト）専用。
-- ============================================================

create table if not exists daikome.dk_expense_kinds (
  company_id  uuid    not null references daikome.dk_companies (company_id) on delete cascade,
  kind_id     text    not null,
  label       text    not null,
  sort_order  integer not null default 100,
  active      boolean not null default true,
  updated_at  timestamptz default now(),
  primary key (company_id, kind_id)
);

alter table daikome.dk_expense_kinds enable row level security;

create policy dk_expense_kinds_owner_sel on daikome.dk_expense_kinds
  for select using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_expense_kinds_owner_ins on daikome.dk_expense_kinds
  for insert with check (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_expense_kinds_owner_upd on daikome.dk_expense_kinds
  for update using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_expense_kinds_owner_del on daikome.dk_expense_kinds
  for delete using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

grant select, insert, update, delete on daikome.dk_expense_kinds to authenticated;
grant select, insert, update, delete on daikome.dk_expense_kinds to anon;

-- ─── 勤務の 行に「名前つきの 実費」を 持たせる ─────────────
alter table if exists daikome.dk_shift_edits
  add column if not exists expenses jsonb;

-- ─── 窓（public）──────────────────────────────────
create or replace view public.dk_expense_kinds
  with (security_invoker = true) as
  select company_id, kind_id, label, sort_order, active, updated_at
    from daikome.dk_expense_kinds;

create or replace view public.dk_shift_edits
  with (security_invoker = true) as
  select shift_id, company_id, toll_yen, bridge_yen, other_yen, other_label, note,
         updated_at, hours, expenses
    from daikome.dk_shift_edits;
