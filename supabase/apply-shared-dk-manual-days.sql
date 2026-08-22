-- ============================================================================
-- ダイコメ 手入力の1日分（共有本番倉庫 tnfwipbgfgjaymlszeid 用）2026-08-01
--
--   ★このファイルは「足すだけ」★
--     ・新しい表 dk_manual_days を作るだけ
--     ・既に在る物（dk_shifts / dk_trips / dk_shift_edits / meisai / companies / pay_* …）は
--       ★1バイトも触らない★
--
--   ▼何のためか（司さん「おれが使えるようにしろ」2026-08-01）
--     今までの入り口は dk_shifts（スマホのメーターが記録した分）だけだった。
--     ＝★スマホを1台も繋いでいないと、売上表も給料も永久に空っぽ★
--     司さんは今まで Excel に手で売上を打ち込んで給料を出していたので、それができないと使えない。
--
--     この表は「その日その車は、売上いくら・何時間だったか」を手で入れる場所。
--     ・スマホが繋がる前から給料明細が出せる
--     ・繋がった後も「アプリ無しで走った日」（つかさ車など）を足せる
--     ・スマホが途中で落ちた日の穴埋めにも使える
--
--   ▼★元データは触らない★
--     メーターが確定した数字(dk_shifts)は書き換えない。手入力は必ず別の棚に重ねる。
--     同じ日・同じ車に両方あったら、画面は★足し算せず、メーターの方を正とする★
--     （二重計上が一番こわい。ロジック側で固定してテストしてある）
-- ============================================================================

create table if not exists dk_manual_days (
  company_id  uuid not null references dk_companies(company_id) on delete cascade,
  work_date   date not null,
  device_id   text not null,               -- どの車か（車名は dk_device_labels）
  sales_yen   double precision not null default 0,  -- メーターの合計にあたる額（実費を引く前）
  hours       double precision not null default 0,  -- その車の時数
  toll_yen    double precision not null default 0,  -- 高速代（手入力）
  bridge_yen  double precision not null default 0,  -- 橋代（手入力）
  other_yen   double precision not null default 0,  -- その他の実費
  trip_count  int not null default 0,               -- 件数（分かれば）
  note        text default '',
  updated_at  timestamptz default now(),
  primary key (company_id, work_date, device_id)
);

create index if not exists dk_manual_days_date_idx
  on dk_manual_days (company_id, work_date);

alter table dk_manual_days enable row level security;

-- 自分の会社の分だけ 読める / 足せる / 直せる / 消せる
--   （手で入れた物は打ち間違いを消せないと困るので delete も許す。
--     メーターの記録 dk_shifts には delete ポリシーを作っていない＝消せないまま）
create policy dk_manual_days_owner_sel on dk_manual_days
  for select using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );
create policy dk_manual_days_owner_ins on dk_manual_days
  for insert with check (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );
create policy dk_manual_days_owner_upd on dk_manual_days
  for update using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );
create policy dk_manual_days_owner_del on dk_manual_days
  for delete using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

-- 確認
select tablename, rowsecurity as rls_enabled
  from pg_tables
 where schemaname = 'public' and tablename = 'dk_manual_days';

select policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename = 'dk_manual_days'
 order by policyname;
