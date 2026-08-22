-- ダイコメ ライセンス: アカウント方式 追加スキーマ (2026-07-29)
-- 会社は「メールのマジックリンク」でログイン → dashboard.html で自社を管理。
--   dk_companies.owner_id = ログインユーザー(auth.uid)。RLSで自分の会社だけ読める/更新できる。
--   端末(dk_company_devices)も、自分の会社の分だけ読める/外せる。
--   ※ dk-issue-license / dk-register-company は service_role で動くので RLS はバイパス(影響なし)。
--   ※ Site URL / 匿名flowには影響しない(anon はRLSで0件=拒否)。

-- 1) owner_id 列(会社の持ち主 = auth.users.id)
alter table dk_companies add column if not exists owner_id uuid;

-- 1オーナー=1会社(NULLは既存テスト行のため許容 = 部分unique)
create unique index if not exists dk_companies_owner_uidx
  on dk_companies (owner_id) where owner_id is not null;

-- 2) dk_companies RLS: 自分の会社だけ select(読取のみ)
alter table dk_companies enable row level security;

drop policy if exists dk_companies_owner_sel on dk_companies;
create policy dk_companies_owner_sel on dk_companies
  for select using (owner_id = auth.uid());

-- ★update policy は作らない★。理由: 会社側に update を許すと status='off'(利用停止)を
--   本人が 'on' に戻せてしまい「止める」機構が無効化する。status/seat_limit の変更は
--   管理(service_role)/課金フロー専用。insert も Edge Function(service_role)経由のみ。
drop policy if exists dk_companies_owner_upd on dk_companies; -- 旧版があれば除去

-- 3) dk_company_devices RLS: 自分の会社の端末だけ select / delete(外す)
alter table dk_company_devices enable row level security;

drop policy if exists dk_devices_owner_sel on dk_company_devices;
create policy dk_devices_owner_sel on dk_company_devices
  for select using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );

drop policy if exists dk_devices_owner_del on dk_company_devices;
create policy dk_devices_owner_del on dk_company_devices
  for delete using (
    company_id in (select company_id from dk_companies where owner_id = auth.uid())
  );
-- insert/update(端末登録)は dk-issue-license(service_role)経由のみ。
