-- ============================================================
-- ★ダイコメの管理画面（運営＝司さん専用）★ 2026-08-07
--
--   司さん「ダイコメの管理アプリを（Exally系の）ように作って
--           そこでおれが権限持つようしろ」
--         「ダイコメ用の作れや 最終は別アプリやろが」
--
--   ★他のアプリの管理画面を全部見てきた（2026-08-07）★
--     payslip-app/admin.html（Kyually）と nomiya-app/castally-admin.html（Castally）
--     どちらも同じ形だった:
--       ・司さんだけが入れる（exally_admins に自分の行が読めるか）
--       ・お客さんの一覧を出す
--       ・★プランを押して切り替えるだけ★（体験/有料/無料/停止）
--       ・人の追加・削除・招待は無い。管理者を増やすのもSQL手打ち。
--
--   ★ダイコメ用に作る（Exally の exally_admins には寄りかからない）★
--     最後は別アプリになるので、ダイコメ自身の部屋に持つ＝そのまま持って出られる。
--
--   ★ダイコメで押す物は「プラン」ではなく 状態(on/off) と 席数★
--     dk_companies に status / seat_limit / plan が★元からある★。
--     新しい仕組みは足さない。並べて押せるようにするだけ。
-- ============================================================

create table if not exists daikome.dk_admins (
  account_id uuid primary key,
  email text,
  note text,
  created_at timestamptz not null default now()
);

alter table daikome.dk_admins enable row level security;

-- ★自分の行だけ読める★（他人の管理者行は見えない＝管理者の一覧は漏らさない）
drop policy if exists dk_admins_read_self on daikome.dk_admins;
create policy dk_admins_read_self on daikome.dk_admins
  for select using (account_id = auth.uid());

grant select on daikome.dk_admins to authenticated;

create or replace view public.dk_admins with (security_invoker = true) as
  select * from daikome.dk_admins;
grant select on public.dk_admins to authenticated, anon;

-- ★管理者かどうか★（会社一覧の鍵で使う。security definer で自分の行以外も判定できる）
create or replace function daikome.is_dk_admin()
returns boolean
language sql
stable
security definer
set search_path = daikome, public, auth
as $$
  select exists (select 1 from daikome.dk_admins a where a.account_id = auth.uid())
$$;

revoke all on function daikome.is_dk_admin() from public;
grant execute on function daikome.is_dk_admin() to authenticated;

-- ★管理者を登録する（アドレスは司さんが決める）★
--
--   ★2026-08-07 司さん「アドレスも勝手に決めるなや」★
--     私がここに司さんのアドレスを★直接書き込んで、自動で登録していた★。
--     誰を運営にするかは司さんが決めることで、私が決めることではない。
--     Kyually(payslip-app/supabase/schema.sql) も★コメントのまま★にしてある。
--     同じにする。
--
--   ▼登録するとき（1行を書き換えて実行）
--     insert into daikome.dk_admins (account_id, email, note)
--     select u.id, u.email, 'ダイコメの運営'
--     from auth.users u
--     where lower(u.email) = 'ここに運営のログインメール'
--     on conflict (account_id) do update set email = excluded.email;
--
--   ▼外すとき
--     delete from daikome.dk_admins where lower(email) = 'そのアドレス';
--
--   ★1人も登録していないと、管理画面は誰も開けません（それが既定）★

-- ─────────────────────────────────────────
-- ★管理者は 全部の会社を見られる／状態と席数を変えられる★
--   今までは「会社の持ち主だけ」だったので、司さんでも他社は見えなかった。
--   持ち主の鍵はそのまま残す（お客さんは今までどおり自分の会社だけ）。
-- ─────────────────────────────────────────
drop policy if exists dk_companies_admin_read on daikome.dk_companies;
create policy dk_companies_admin_read on daikome.dk_companies
  for select using (daikome.is_dk_admin());

drop policy if exists dk_companies_admin_write on daikome.dk_companies;
create policy dk_companies_admin_write on daikome.dk_companies
  for update using (daikome.is_dk_admin()) with check (daikome.is_dk_admin());

-- ★運営が新しいお客さん（会社）を登録できる★ 2026-08-07
--   司さん「おれが新規で登録してやるんやろが」
--   今までは★お客さん自身が事務所から登録する★形しか無かった。
--   売るのは司さんなので、司さんの側から登録して★会社URL(QR)を渡せる★ようにする。
drop policy if exists dk_companies_admin_insert on daikome.dk_companies;
create policy dk_companies_admin_insert on daikome.dk_companies
  for insert with check (daikome.is_dk_admin());

-- 端末の数を出すため（管理者は全部の端末を数えられる）
drop policy if exists dk_company_devices_admin_read on daikome.dk_company_devices;
create policy dk_company_devices_admin_read on daikome.dk_company_devices
  for select using (daikome.is_dk_admin());

-- 最後に動いた日を出すため
drop policy if exists dk_shifts_admin_read on daikome.dk_shifts;
create policy dk_shifts_admin_read on daikome.dk_shifts
  for select using (daikome.is_dk_admin());
