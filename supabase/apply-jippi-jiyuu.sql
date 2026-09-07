-- ============================================================
-- ★★実費（高速代・橋代…）を 会社が 自由に 足せる／消せる ように する★★ 2026-09-06
--
--   ★司さん★「この項目ってユーザーは自由に決めれるん？追加や削除できる？」→「ウ（自由にする）」
--
--   ★今まで（決め打ち）★
--     dk_shift_edits … toll_yen / bridge_yen / other_yen ＝★列が 3本 固定★
--     ⇒ 増やせない・減らせない・名前も「その他」しか 変えられない
--
--   ★これから★
--     ①★dk_expense_kinds★ … 会社ごとの「実費の 名前」の 一覧（足す／消す／並べ替え）
--     ②★dk_shift_edits.expenses★（jsonb）… { 名前のid: 金額 } で いくつでも 持てる
--
--   ★★お金の 安全（先に 数えた）★★
--     2026-09-06 実測 … dk_shift_edits ★1行★／実費が 入っている 行 ★0行★／合計 ★0円★
--     ⇒★★移す お金が 1円も ありません★★＝この 直しで 金額は 動きません。
--     ⇒ それでも ★古い 3列は 消しません★（読めなくなる 事故を 防ぐ・後から 突き合わせる為）
--
--   ★窓（public の view）も 必ず 作り直す★
--     ★create or replace view は security_invoker を 落とす★ので 付け直す。
--     （2026-09-06 に これを 忘れて ★保存が 2週間 死んでいた★＝同じ 過ちを 繰り返さない）
-- ============================================================

-- ─── ①実費の 名前の 一覧 ───────────────────────────────
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

drop policy if exists dk_expense_kinds_owner_sel on daikome.dk_expense_kinds;
create policy dk_expense_kinds_owner_sel on daikome.dk_expense_kinds
  for select using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

drop policy if exists dk_expense_kinds_owner_ins on daikome.dk_expense_kinds;
create policy dk_expense_kinds_owner_ins on daikome.dk_expense_kinds
  for insert with check (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

drop policy if exists dk_expense_kinds_owner_upd on daikome.dk_expense_kinds;
create policy dk_expense_kinds_owner_upd on daikome.dk_expense_kinds
  for update using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

drop policy if exists dk_expense_kinds_owner_del on daikome.dk_expense_kinds;
create policy dk_expense_kinds_owner_del on daikome.dk_expense_kinds
  for delete using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

grant select, insert, update, delete on daikome.dk_expense_kinds to authenticated;
grant select, insert, update, delete on daikome.dk_expense_kinds to anon;

-- ─── ②勤務の 行に「名前つきの 実費」を 持たせる ─────────────────
alter table if exists daikome.dk_shift_edits
  add column if not exists expenses jsonb;

-- ─── ③今の 3つを そのまま 一覧に 入れる（見た目を 変えない）───────────
--   ★other_label が 入っていれば その名前を 使う★（今も 変えられる 作りなので 尊重する）
insert into daikome.dk_expense_kinds (company_id, kind_id, label, sort_order)
select c.company_id, v.kind_id, v.label, v.sort_order
  from daikome.dk_companies c
  cross join (values
    ('toll',   '高速代', 10),
    ('bridge', '橋代',   20),
    ('other',  'その他', 30)
  ) as v (kind_id, label, sort_order)
 on conflict (company_id, kind_id) do nothing;

update daikome.dk_expense_kinds k
   set label = s.other_label
  from daikome.dk_sales_settings s
 where s.company_id = k.company_id
   and k.kind_id = 'other'
   and s.other_label is not null
   and length(btrim(s.other_label)) > 0;

-- ─── ④窓（public）───────────────────────────────────
create or replace view public.dk_expense_kinds
  with (security_invoker = true) as
  select company_id, kind_id, label, sort_order, active, updated_at
    from daikome.dk_expense_kinds;

create or replace view public.dk_shift_edits
  with (security_invoker = true) as
  select shift_id, company_id, toll_yen, bridge_yen, other_yen, other_label, note,
         updated_at, hours, expenses
    from daikome.dk_shift_edits;
