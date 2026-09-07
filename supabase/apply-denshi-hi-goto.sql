-- ============================================================
-- ★★電子決済 を 日ごとに 入れられるように する★★ 2026-09-06
--
--   ★司さん★「毎日 入れれるように しろよ 前から いよろが 入力タブ作れって」
--
--   ★今まで★ `dk_month_extras`（company_id, ym, paypay_yen）＝★月に 1マス★
--     ⇒ いつ 受け取ったか 分からない／日ごとの 突き合わせが 出来ない
--   ★これから★ `dk_day_extras`（company_id, pay_date, paypay_yen）＝★日ごと★
--
--   ★★古い 月ごとの 棚は 消しません★★
--     ・前に 入れた 分が 読めなくなる 事故を 防ぐ
--     ・画面は ★日ごとが 在れば 日ごと／無ければ 月ごと★ を 使う（下の 決まり）
--     ・★二重に 数えない★＝その月に 日ごとが 1件でも 在れば 月ごとは 使わない
--
--   ★窓（public の view）も 必ず 作る★
--     ★create or replace view は security_invoker を 落とす★ので 付け直す。
--     （2026-09-06 に これを 忘れて 保存が 2週間 死んでいた）
-- ============================================================

create table if not exists daikome.dk_day_extras (
  company_id  uuid    not null references daikome.dk_companies (company_id) on delete cascade,
  pay_date    date    not null,
  paypay_yen  integer not null default 0,
  note        text,
  updated_at  timestamptz default now(),
  primary key (company_id, pay_date)
);

alter table daikome.dk_day_extras enable row level security;

drop policy if exists dk_day_extras_owner_sel on daikome.dk_day_extras;
create policy dk_day_extras_owner_sel on daikome.dk_day_extras
  for select using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

drop policy if exists dk_day_extras_owner_ins on daikome.dk_day_extras;
create policy dk_day_extras_owner_ins on daikome.dk_day_extras
  for insert with check (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

drop policy if exists dk_day_extras_owner_upd on daikome.dk_day_extras;
create policy dk_day_extras_owner_upd on daikome.dk_day_extras
  for update using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

drop policy if exists dk_day_extras_owner_del on daikome.dk_day_extras;
create policy dk_day_extras_owner_del on daikome.dk_day_extras
  for delete using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

grant select, insert, update, delete on daikome.dk_day_extras to authenticated;
grant select, insert, update, delete on daikome.dk_day_extras to anon;

create or replace view public.dk_day_extras
  with (security_invoker = true) as
  select company_id, pay_date, paypay_yen, note, updated_at
    from daikome.dk_day_extras;
