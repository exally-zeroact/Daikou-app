-- ============================================================================
-- ダイコメ 月次集計の手入力ぶん（共有本番倉庫 tnfwipbgfgjaymlszeid 用）2026-08-01
--
--   ★このファイルは「足すだけ」★
--     ・新しい表 dk_month_extras を作るだけ
--     ・既に在る物（dk_shifts / dk_trips / dk_shift_edits / meisai / companies / pay_* …）は
--       ★1バイトも触らない★
--
--   ▼何のためか
--     実物『売上表』シートは 現金 / 請求書 / PayPay の3つに分けている。
--       ・請求書 … 実車中に請求書ボタンで会社を選んだ代行から自動で集まる（dk_trips）
--       ・現金   … 売上合計 − 未収 で出せる
--       ・PayPay … ★メーターが区別していないので手入力する場所が要る★
--     月ごとに1行だけ持つ。日ごとに要るようになったら別表を足す（この表は壊さない）。
-- ============================================================================

create table if not exists dk_month_extras (
  company_id uuid not null references dk_companies(company_id) on delete cascade,
  ym         text not null,                       -- '2026-01'
  paypay_yen double precision not null default 0, -- PayPayで受け取った分（手入力）
  note       text default '',
  updated_at timestamptz default now(),
  primary key (company_id, ym)
);

alter table dk_month_extras enable row level security;

create policy dk_month_extras_owner_sel on dk_month_extras
  for select using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );
create policy dk_month_extras_owner_ins on dk_month_extras
  for insert with check (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );
create policy dk_month_extras_owner_upd on dk_month_extras
  for update using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 給料の払い方の既定を「月3回」にそろえる（実物の月別シートのバ3列）
--   ★中身は1行も入っていないので、これから作る行の既定が変わるだけ★
-- ---------------------------------------------------------------------------
alter table dk_payroll_settings alter column period_end_mode set default 'thirds';

-- 確認
select tablename, rowsecurity as rls_enabled
  from pg_tables
 where schemaname = 'public' and tablename = 'dk_month_extras';

select column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'dk_payroll_settings'
   and column_name = 'period_end_mode';
