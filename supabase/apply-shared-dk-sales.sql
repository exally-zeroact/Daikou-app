-- ============================================================================
-- ダイコメ 売上表の手入力ぶん（共有本番倉庫 tnfwipbgfgjaymlszeid 用）2026-08-01
--
--   ★このファイルは「足すだけ」★
--     ・新しい表 dk_shift_edits を作るだけ
--     ・既に在る物（dk_shifts / dk_trips / dk_companies / meisai / companies / pay_* …）は
--       ★1バイトも触らない★。drop / delete / truncate / 既存ポリシー変更は1つも書いていない。
--
--   ▼なぜ dk_shifts に列を足さないのか
--     dk_shifts は「メーターが確定した値」を入れる場所で、事務所からは書き換えない約束にしている。
--     手入力（高速代・橋代・備考）や訂正は**別の表に重ねる**。
--     こうすると「元の実績」と「人が入れた分」がいつでも分けて見られる。
--
--   ▼誰が書けるか
--     ログインした会社（自分の勤務の分だけ）。ドライバー端末は書けない。
-- ============================================================================

create table if not exists dk_shift_edits (
  shift_id     uuid primary key references dk_shifts(shift_id) on delete cascade,
  company_id   uuid not null references dk_companies(company_id) on delete cascade,
  toll_yen     int default 0,      -- 高速代（手入力）
  bridge_yen   int default 0,      -- 橋代（手入力）
  other_yen    int default 0,      -- その他の実費（手入力）
  other_label  text default '',    -- その他の名前（例: 駐車場代）
  note         text default '',    -- 備考
  updated_at   timestamptz default now()
);

create index if not exists dk_shift_edits_company_idx
  on dk_shift_edits (company_id);

alter table dk_shift_edits enable row level security;

-- 自分の会社の分だけ 読める / 足せる / 直せる（消すのは想定しないので delete は作らない）
create policy dk_shift_edits_owner_sel on dk_shift_edits
  for select using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

create policy dk_shift_edits_owner_ins on dk_shift_edits
  for insert with check (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

create policy dk_shift_edits_owner_upd on dk_shift_edits
  for update using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

-- 確認
select tablename, rowsecurity as rls_enabled
  from pg_tables
 where schemaname = 'public' and tablename = 'dk_shift_edits';

select policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename = 'dk_shift_edits'
 order by policyname;
