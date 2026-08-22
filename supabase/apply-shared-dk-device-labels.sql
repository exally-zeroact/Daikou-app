-- ============================================================================
-- ダイコメ 車の名前（共有本番倉庫 tnfwipbgfgjaymlszeid 用）2026-08-01
--
--   ★このファイルは「足すだけ」★
--     ・新しい表 dk_device_labels を作るだけ
--     ・既に在る物（dk_company_devices / dk_shifts / meisai / companies …）は
--       ★1バイトも触らない★
--
--   ▼なぜ dk_company_devices に列を足さないのか
--     あの表はライセンス（台数カウント）の真実源で、Edge Function だけが書く約束にしている。
--     会社が自由に書き換えられるようにすると、席の管理が崩れる。
--     「1号車」「2号車」といった呼び名は別表に重ねる。
--
--   ▼これが無いと何が困るか
--     売上表は「車ごと」に出す。今は端末IDしか無いので、どれがどの車か人には分からない。
-- ============================================================================

create table if not exists dk_device_labels (
  company_id uuid not null references dk_companies(company_id) on delete cascade,
  device_id  text not null,
  label      text default '',      -- 例: 1号車 / 社長車
  updated_at timestamptz default now(),
  primary key (company_id, device_id)
);

alter table dk_device_labels enable row level security;

-- 自分の会社の分だけ 読める / 足せる / 直せる
create policy dk_device_labels_owner_sel on dk_device_labels
  for select using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

create policy dk_device_labels_owner_ins on dk_device_labels
  for insert with check (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

create policy dk_device_labels_owner_upd on dk_device_labels
  for update using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

-- 確認
select tablename, rowsecurity as rls_enabled
  from pg_tables
 where schemaname = 'public' and tablename = 'dk_device_labels';
