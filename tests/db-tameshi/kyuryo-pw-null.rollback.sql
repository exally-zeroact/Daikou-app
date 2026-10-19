-- ★本人の パスワード：空（null）は 必ず 違う★ 2026-10-19（前は パスワード 無しで 開いた）
--   回し方：node tests/db-tameshi/tameshi-rollback.mjs <repo> tests/db-tameshi/kyuryo-pw-null.rollback.sql
--   ⑤〜⑦＝初回コードの 空も（odan 10-19）。
--   ★期待と 違えば 1/(random()*0) で 倉庫が 誤りを 返す★（定数の 1/0 は 組み立ての 時に 割られて いつも 誤り＝使わない）（終わり値 4）＝倉庫の 返事は 最後の 文の 3行（⑤⑥⑦）だけ。①〜④は 誤りが 出ない 事で 合っていると 分かる
--   直す 前の 倉庫（10-19 の 本番と 同じ md5）では ① ③ で 誤り（赤）を 見た
begin;
insert into daikome.dk_kyuryo_pub (token, company_id, employee_id, init_code, pw_hash)
values ('zz-tameshi-pw-null', gen_random_uuid(), gen_random_uuid(), null, extensions.crypt('abcd1234', extensions.gen_salt('bf')));
select '① verify null' k, case when (public.dk_kyuryo_verify('zz-tameshi-pw-null', null)->>'ok') = 'false' then 'ok' else (1/(random()*0)::int)::text end v
union all
select '② verify 違う', case when (public.dk_kyuryo_verify('zz-tameshi-pw-null', 'chigau99')->>'reason') = 'bad_pw' then 'ok' else (1/(random()*0)::int)::text end
union all
select '③ get null', case when (public.dk_kyuryo_get('zz-tameshi-pw-null', null, '2026-09-01', '2026-10-31')->>'reason') = 'bad_pw' then 'ok' else (1/(random()*0)::int)::text end
union all
select '④ verify 合う', case when (public.dk_kyuryo_verify('zz-tameshi-pw-null', 'abcd1234')->>'ok') = 'true' then 'ok' else (1/(random()*0)::int)::text end;
insert into daikome.dk_kyuryo_pub (token, company_id, employee_id, init_code, pw_hash)
values ('zz-tameshi-init-null', gen_random_uuid(), gen_random_uuid(), 'ABCD1234', null);
select '⑤ pw_set 初回コード null' k, case when (public.dk_kyuryo_pw_set('zz-tameshi-init-null', null, 'hacker123')->>'reason') = 'bad_init' then 'ok' else (1/(random()*0)::int)::text end v
union all
select '⑥ verify 空文字', case when (public.dk_kyuryo_verify('zz-tameshi-pw-null', '')->>'reason') = 'bad_pw' then 'ok' else (1/(random()*0)::int)::text end
union all
select '⑦ pw_set 初回コード 合う', case when (public.dk_kyuryo_pw_set('zz-tameshi-init-null', 'ABCD1234', 'abcd1234')->>'ok') = 'true' then 'ok' else (1/(random()*0)::int)::text end;
rollback;
