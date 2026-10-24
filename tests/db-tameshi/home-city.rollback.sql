-- ★地元の市（home_city）を 持ち主が 保存できるか の 確かめ★ 2026-10-24＝テスト線の 倉庫だけ・必ず rollback
-- 今の 穴：画面は 窓（public.dk_companies）へ PATCH・return=minimal・r.ok だけで「保存しました」と 出す。
--   ところが dk_companies には 持ち主の update の policy が 無い（止めた 会社が 自分で 戻せない様に わざと 作っていない）。
--   ＝運営で ない 持ち主は RLS で 0行・204＝「保存しました」と 出て 何も 変わらない。
-- 直し：home_city の 1列だけを 書く 関数 public.dk_set_home_city（持ち主か 確かめる・ほかの 列は 触らない・書けた 行を 返す）
-- 当て方：node tests/db-tameshi/tameshi-rollback.mjs <worktree> この ファイル
-- ★期待と 違えば 1/(random()*0) で 倉庫が 誤りを 返す★（終わり値 4）。関数が 無い（直す 前）も 誤り＝赤。
-- 期待：
--   0 窓への update（今の 画面の 道）は 0行＝持ち主の update の 口は 開けていない（直した 後も 0）
--   1 自分の 会社 保存＝1行・読み直すと 松山市
--   2 よその 会社＝0行・よその 値は 変わらない
--   3 ほかの 列（status・seat_limit・name・owner_id・url_token・plan・contact）は 変わらない
--   4 空白だけ＝空（null＝今治市あつかい）で 1行
--   5 ログインして いない（sub 無し）＝0行
--   6 anon は 呼べない・authenticated は 呼べる
--   7 長すぎる（41字）＝0行・値は 変わらない
begin;
-- 持ち主（運営で ない＝dk_admins に 居ない 無作為の id）の 会社を 2つ 仮に 作る（rollback で 消える）
create temp table co as
  select gen_random_uuid() a, gen_random_uuid() ua, gen_random_uuid() b, gen_random_uuid() ub;
insert into daikome.dk_companies (company_id, url_token, name, status, seat_limit, plan, contact, owner_id, home_city)
  select a, 'zz-hc-a-' || a::text, 'zz-hc-A', 'off', 3, 'zz-plan', 'zz-contact', ua, null from co;
insert into daikome.dk_companies (company_id, url_token, name, status, seat_limit, owner_id, home_city)
  select b, 'zz-hc-b-' || b::text, 'zz-hc-B', 'on', 1, ub, '西条市' from co;
create temp table k (n text, v text, kitai text);
grant select, insert on k to authenticated, anon;
grant select on co to authenticated, anon;
select set_config('request.jwt.claims', json_build_object('sub', ua::text, 'role', 'authenticated')::text, true) from co;
set local role authenticated;
with u as (update public.dk_companies set home_city = 'zz-mado' where company_id = (select a from co) returning 1)
insert into k select '0 窓への update の 行数', (select count(*) from u)::text, '0';
insert into k select '1 自分の 会社 保存の 行数', public.dk_set_home_city(a, '  松山市 ')::text, '1' from co;
insert into k select '2 よその 会社の 行数', public.dk_set_home_city(b, '今治市')::text, '0' from co;
reset role;
insert into k select '1b 読み直し（自分）', home_city, '松山市' from daikome.dk_companies where company_id = (select a from co);
insert into k select '2b よその 値', home_city, '西条市' from daikome.dk_companies where company_id = (select b from co);
insert into k select '3 ほかの 列',
  status || '/' || seat_limit || '/' || name || '/' || (owner_id = (select ua from co))::text || '/'
  || (url_token = 'zz-hc-a-' || company_id::text)::text || '/' || plan || '/' || contact,
  'off/3/zz-hc-A/true/true/zz-plan/zz-contact'
  from daikome.dk_companies where company_id = (select a from co);
set local role authenticated;
insert into k select '4 空白だけの 行数', public.dk_set_home_city(a, '   ')::text, '1' from co;
insert into k select '7 長すぎるの 行数', public.dk_set_home_city(a, repeat('市', 41))::text, '0' from co;
reset role;
insert into k select '4b 読み直し（空）', coalesce(home_city, 'null'), 'null' from daikome.dk_companies where company_id = (select a from co);
select set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
set local role authenticated;
insert into k select '5 ログイン無しの 行数', public.dk_set_home_city(a, '松山市')::text, '0' from co;
reset role;
insert into k select '6 呼べる 人 anon/authenticated',
  has_function_privilege('anon', 'public.dk_set_home_city(uuid,text)', 'execute')::text || '/'
  || has_function_privilege('authenticated', 'public.dk_set_home_city(uuid,text)', 'execute')::text,
  'false/true';
select n, v, kitai,
  case when v is not distinct from kitai then 'ok' else (1/(random()*0)::int)::text end hantei
  from k order by n;
rollback;
