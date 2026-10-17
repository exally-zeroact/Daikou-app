-- ★本人リンクを 配る 関数（作り直す・1人ぶん・一覧）を 辞めた 人にも 使える 事の 確かめ★ 2026-10-16 → 10-17＝テスト線の 倉庫だけ・必ず rollback
-- 10-17 司さん「向こうが URL 消すまで 見れないかん・退職者のページからでもURLの配付ができないかん」
--   （10-16 の「辞めた 人には 作り直さない」は 外した。前は 作り直すと パスワードが 消え、1人ぶんの 道が 辞めた 人を 断るので 取り出せなかった・対立役 S1）
-- 当て方：node tests/db-tameshi/tameshi-rollback.mjs <worktree> この ファイル
-- 期待：1 今いる人 作り直し＝true／2 辞めた人 作り直し＝true/true/true（ok・token 在り・初回コード 在り）
--       3 辞めた人 1人ぶん＝true/true/true／4 一覧に 辞めた人（active=false）＝1
--       5 よその 会社の 人＝not_yours/not_yours（作り直し・1人ぶん）／6 リンクの 無い 辞めた人は 一覧に 出ない＝0
begin;
-- 持ち主の 居る 会社に 仮の 人を 2人 足す（rollback で 消える）
insert into daikome.dk_employees (company_id, name, role, active)
  select company_id, 'zz-saihakkou-tameshi', '2種', true from daikome.dk_companies where owner_id is not null order by company_id limit 1;
insert into daikome.dk_employees (company_id, name, role, active)
  select company_id, 'zz-saihakkou-nashi', '2種', false from daikome.dk_companies where owner_id is not null order by company_id limit 1;
create temp table t as
  select e.employee_id, e.company_id, c.owner_id
  from daikome.dk_employees e join daikome.dk_companies c on c.company_id = e.company_id
  where e.name = 'zz-saihakkou-tameshi';
-- この 取引の 中だけ 会社の 持ち主として 呼ぶ（auth.uid() が 読む 値）
select set_config('request.jwt.claims', json_build_object('sub', owner_id::text, 'role', 'authenticated')::text, true) from t;
create temp table k (n text, v text);
-- 今いる 間に 一覧で リンクを 作る（作るのは 今いる人だけ）
select public.dk_kyuryo_haifu();
insert into k select '1 今いる人 作り直し', public.dk_kyuryo_saihakkou(employee_id)::jsonb->>'ok' from t;
update daikome.dk_employees set active = false where employee_id = (select employee_id from t);
insert into k select '2 辞めた人 作り直し ok/token/初回', coalesce(x->>'ok','') || '/' || (x->>'token' is not null)::text || '/' || (x->>'init_code' is not null)::text
  from (select public.dk_kyuryo_saihakkou(employee_id)::jsonb x from t) z;
insert into k select '3 辞めた人 1人ぶん ok/token/初回', coalesce(x->>'ok','') || '/' || (x->'hito'->>'token' is not null)::text || '/' || (x->'hito'->>'init_code' is not null)::text
  from (select public.dk_kyuryo_haifu_hitori(employee_id)::jsonb x from t) z;
insert into k select '4 一覧に 辞めた人', (select count(*) from jsonb_array_elements(public.dk_kyuryo_haifu()::jsonb->'list') y where y->>'employee_id' = t.employee_id::text and y->>'active' = 'false')::text from t;
insert into k select '5 よその会社の人 作り直し/1人ぶん', coalesce(public.dk_kyuryo_saihakkou(gen_random_uuid())::jsonb->>'reason','') || '/' || coalesce(public.dk_kyuryo_haifu_hitori(gen_random_uuid())::jsonb->>'reason','') from t;
insert into k select '6 リンクの 無い 辞めた人は 一覧に 出ない', (select count(*) from jsonb_array_elements(public.dk_kyuryo_haifu()::jsonb->'list') y where y->>'name' = 'zz-saihakkou-nashi')::text from t;
select n, v from k order by n;
rollback;
