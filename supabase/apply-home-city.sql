-- ============================================================
-- ★会社ごとの「地元の市」★  2026-08-09（司さんが B を選択）
--
--   何のため:
--     請求書の行き先を、司さんの手入力と同じ書き方にする。
--       ・地元の市（既定 今治市）→ ★市名を落として町名だけ★  例) 大西町九王
--       ・市外                   → ★市名を付ける★            例) 松山市道後湯之町
--     会社ごとに違うので、会社の行に持たせる。空なら 今治市。
--
--   ★当てる順番（必ずこの順）★
--     1. 部屋の表に列を足す
--     2. ★public の窓(view)にも足す★   ← ここを忘れると次が起きる
--     3. その後にコード（Edge Function / 画面）を配信する
--
--   ★2026-08-09 に実際に踏んだ穴★
--     1 だけやって 2 を忘れた。アプリも関数も窓ごしにしか部屋を見られないので、
--     home_city を読みに行った瞬間 ★同期が丸ごと db_error★ になった。
--     文法チェックも 2460件のテストも通った。★実際に叩いて初めて分かった★。
--     → tests/unit/public-window-columns.test.js で CI が止めるようにした。
--
--   ★create or replace view は security_invoker を落とす★
--     落ちると窓が「作った人の権限」で開き、RLS を素通りする。
--     必ず alter view を続けて当て、当てた後に reloptions を数えること。
-- ============================================================

-- 1) 部屋の表に足す（★足すだけ。既にある行は1つも触らない＝全部 空 = 今治市あつかい★）
alter table daikome.dk_companies add column if not exists home_city text;

comment on column daikome.dk_companies.home_city is
  '地元の市（請求書の行き先で、この市名は落として町名だけにする）。空なら今治市。';

-- 2) ★窓にも足す★（ここを忘れると同期が丸ごと落ちる）
create or replace view public.dk_companies as
  select company_id, url_token, name, status, seat_limit, plan, created_at, contact, owner_id,
         home_city
    from daikome.dk_companies;

alter view public.dk_companies set (security_invoker = true);

-- 3) 当てた後に必ず数える（★目で見て終わりにしない★）
--   ・窓の列に home_city があるか
--   ・security_invoker=true が付いているか
--   ・行数が当てる前と同じか
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='dk_companies' and column_name='home_city') as 窓に列があるか,
  (select array_to_string(reloptions, ',') from pg_class
    where oid='public.dk_companies'::regclass) as 窓の設定,
  (select count(*) from public.dk_companies) as 窓から見える行数,
  (select count(*) from daikome.dk_companies where home_city is not null) as 地元の市を入れた会社数;
