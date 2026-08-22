-- ダイコメ ライセンス STEP1: 会社URL/QR + 署名方式の表(Supabase SQL Editorで1回実行)
-- 既存の dk_licensed_devices(旧MVP・tenant基準)とは別。会社(company)基準の新方式。

-- 会社(契約単位)。url_token = 会社固有URLの ?c=<これ>(推測不能・crypto乱数)。
create table if not exists dk_companies (
  company_id uuid primary key default gen_random_uuid(),
  url_token  text unique not null,
  name       text default '',
  contact    text default '',               -- 連絡先(セルフ登録・2026-07-27)
  status     text not null default 'on',   -- 'on' | 'off'(未払い停止)
  seat_limit int  not null default 1,       -- 契約台数N
  plan       text default '',
  created_at timestamptz default now()
);
alter table dk_companies enable row level security;  -- 直アクセス不可・Edge Function(service_role)のみ
-- 既存テーブルへの追加(冪等・2026-07-27 セルフ登録用):
alter table dk_companies add column if not exists contact text default '';
-- 代表者ページ用の管理トークン(url_tokenとは別の秘密・2026-07-28):
alter table dk_companies add column if not exists admin_token text;
-- 既存行に admin_token を付与(未設定のみ):
update dk_companies set admin_token = encode(gen_random_bytes(16), 'hex') where admin_token is null;

-- 会社ごとの活性化端末(台数カウントの真実源)。同一 device_id 再活性化は席を消費しない。
create table if not exists dk_company_devices (
  company_id uuid not null references dk_companies(company_id) on delete cascade,
  device_id  text not null,
  vin        text default '',
  last_seen  timestamptz default now(),
  created_at timestamptz default now(),
  primary key (company_id, device_id)
);
alter table dk_company_devices enable row level security;  -- Edge Function(service_role)のみ

-- ★司さんの自社テスト用の会社を1件作る(seat_limit=4=4台まで)★:
insert into dk_companies (url_token, name, status, seat_limit)
values (encode(gen_random_bytes(16), 'hex'), '自社(テスト)', 'on', 4)
on conflict do nothing;

-- 作成した会社の url_token を確認(この値が会社固有URLの ?c= になる):
select name, url_token, seat_limit, status from dk_companies order by created_at desc;
