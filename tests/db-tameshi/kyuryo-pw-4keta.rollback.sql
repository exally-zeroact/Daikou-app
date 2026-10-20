-- ★本人の パスワード 4桁・3回 続けて 間違えたら 止める・作り直しで 戻る★ 2026-10-20（docs/pw-4keta.md）＝テスト線の 倉庫だけ・必ず rollback
--   司さん 10-19「パスワードは 4桁に しろ」「3回 間違えたら」「新しく URL や QR コードを 作成し直す」・10-20「続けて 3回」
-- 当て方：node tests/db-tameshi/tameshi-rollback.mjs <worktree> この ファイル
-- ★期待（e）と 違えば 1/(random()*0) で 倉庫が 誤りを 返す★（終わり値 4）。返事は 最後の 文の 行（全部 ok）
-- 直す 前の 倉庫（10-20 の 本番・テスト＝pw_set 44286601…）では 赤（4）を 見る
begin;
create temp table k (n text, v text, e text);
-- A 作り物の 行（初回コード 在り・まだ 決めて いない）
insert into daikome.dk_kyuryo_pub (token, company_id, employee_id, init_code, pw_hash)
values ('zz-4keta-a', gen_random_uuid(), gen_random_uuid(), 'INITAAAA', null);
insert into k values ('01 8文字', public.dk_kyuryo_pw_set('zz-4keta-a', 'INITAAAA', '12345678')::jsonb->>'reason', 'pw_4keta');
insert into k values ('02 3桁', public.dk_kyuryo_pw_set('zz-4keta-a', 'INITAAAA', '123')::jsonb->>'reason', 'pw_4keta');
insert into k values ('03 英字', public.dk_kyuryo_pw_set('zz-4keta-a', 'INITAAAA', 'abcd')::jsonb->>'reason', 'pw_4keta');
insert into k values ('04 全角', public.dk_kyuryo_pw_set('zz-4keta-a', 'INITAAAA', '１２３４')::jsonb->>'reason', 'pw_4keta');
insert into k values ('05 空白', public.dk_kyuryo_pw_set('zz-4keta-a', 'INITAAAA', '    ')::jsonb->>'reason', 'pw_4keta');
insert into k values ('06 null', public.dk_kyuryo_pw_set('zz-4keta-a', 'INITAAAA', null)::jsonb->>'reason', 'pw_4keta');
insert into k values ('07 初回コード 違う', public.dk_kyuryo_pw_set('zz-4keta-a', 'CHIGAU00', '1234')::jsonb->>'reason', 'bad_init');
insert into k values ('08 4桁で 決まる', public.dk_kyuryo_pw_set('zz-4keta-a', 'INITAAAA', '1234')::jsonb->>'ok', 'true');
insert into k values ('09 決めた 後は 形より 先に already_set', public.dk_kyuryo_pw_set('zz-4keta-a', 'INITAAAA', 'x')::jsonb->>'reason', 'already_set');
-- 続けて 3回（合えば 0 に 戻る）
insert into k values ('10 違う 1回目', (select x->>'reason' || '/' || (x->>'nokori') from (select public.dk_kyuryo_verify('zz-4keta-a', '0000')::jsonb x) z), 'bad_pw/2');
insert into k values ('11 違う 2回目（get）', (select x->>'reason' || '/' || (x->>'nokori') from (select public.dk_kyuryo_get('zz-4keta-a', '0001', current_date - 30, current_date)::jsonb x) z), 'bad_pw/1');
insert into k values ('12 合う', public.dk_kyuryo_verify('zz-4keta-a', '1234')::jsonb->>'ok', 'true');
insert into k values ('13 合うと 数が 0', (select pw_miss::text from daikome.dk_kyuryo_pub where token = 'zz-4keta-a'), '0');
insert into k values ('14 違う（数え直し）', (select x->>'reason' || '/' || (x->>'nokori') from (select public.dk_kyuryo_verify('zz-4keta-a', '9999')::jsonb x) z), 'bad_pw/2');
insert into k values ('15 違う（null）', (select x->>'reason' || '/' || (x->>'nokori') from (select public.dk_kyuryo_verify('zz-4keta-a', null)::jsonb x) z), 'bad_pw/1');
insert into k values ('16 3回目で 止まる', public.dk_kyuryo_verify('zz-4keta-a', '')::jsonb->>'reason', 'tomatta');
insert into k values ('17 止まると 正しくても 開かない', public.dk_kyuryo_verify('zz-4keta-a', '1234')::jsonb->>'reason', 'tomatta');
insert into k values ('18 止まると get も 開かない', public.dk_kyuryo_get('zz-4keta-a', '1234', current_date - 30, current_date)::jsonb->>'reason', 'tomatta');
insert into k values ('19 止めた 時刻', (select (tomatta_at is not null)::text from daikome.dk_kyuryo_pub where token = 'zz-4keta-a'), 'true');
-- B 古い 8文字の パスワードの 人は そのまま 開く
insert into daikome.dk_kyuryo_pub (token, company_id, employee_id, init_code, pw_hash)
values ('zz-4keta-b', gen_random_uuid(), gen_random_uuid(), null, extensions.crypt('abcd1234', extensions.gen_salt('bf')));
insert into k values ('20 古い 8文字は 開く', public.dk_kyuryo_verify('zz-4keta-b', 'abcd1234')::jsonb->>'ok', 'true');
-- C 窓から 負の 数に できない
insert into k values ('21 数は 0〜3', (select count(*)::text from pg_constraint where conname = 'dk_kyuryo_pub_pw_miss_chk'), '1');
-- D 読むだけの 取引（GET の rpc の 真似）では 照らせない＝25006 で 落ちる
create function pg_temp.yomudake() returns text language plpgsql as $t$
begin
  begin
    perform set_config('transaction_read_only', 'on', true);
    perform public.dk_kyuryo_verify('zz-4keta-b', 'abcd1234'); -- 正しい パスワードでも 落ちる＝for update が 縛る（対立役 小1）
    return 'toota';
  exception when sqlstate '25006' then
    return 'ochita';
  end;
end
$t$;
insert into k values ('22 読むだけの 取引では 落ちる', pg_temp.yomudake(), 'ochita');
-- C2 窓から 数や 止めを 書き換えられない（式の 列・対立役 本番前 直1）
create function pg_temp.mado_kaku() returns text language plpgsql as $t$
begin
  begin
    update public.dk_kyuryo_pub set pw_miss = 0 where token = 'zz-4keta-a';
    return 'kaketa';
  exception when others then
    return 'kakenai';
  end;
end
$t$;
insert into k values ('22b 窓から 数を 書けない', pg_temp.mado_kaku(), 'kakenai');
-- C3 事務所の 鍵（authenticated）は 表を 直に 読めない・書けない（pw_hash を 手元で 当てさせない・止めを 外させない・対立役 本番前 S1）
create function pg_temp.hyou_kagi(nani text) returns text language plpgsql as $t$
declare v text;
begin
  begin
    set local role authenticated;
    if nani = 'yomu' then
      select pw_hash into v from daikome.dk_kyuryo_pub limit 1;
    else
      update daikome.dk_kyuryo_pub set pw_miss = 0 where token = 'zz-4keta-a';
    end if;
    reset role;
    return 'dekita';
  exception when insufficient_privilege then
    return 'kotowatta';
  end;
end
$t$;
insert into k values ('22c 事務所の 鍵で 表を 読めない', pg_temp.hyou_kagi('yomu'), 'kotowatta');
insert into k values ('22d 事務所の 鍵で 表に 書けない', pg_temp.hyou_kagi('kaku'), 'kotowatta');
-- E 事務所の 作り直し（持ち主として 呼ぶ）＝token が 替わり、古い token は 開かず、止めと 数が 消える
insert into daikome.dk_employees (company_id, name, role, active)
  select company_id, 'zz-4keta-hito', '2種', true from daikome.dk_companies where owner_id is not null order by company_id limit 1;
create temp table t as
  select e.employee_id, e.company_id, c.owner_id
  from daikome.dk_employees e join daikome.dk_companies c on c.company_id = e.company_id
  where e.name = 'zz-4keta-hito';
select set_config('request.jwt.claims', json_build_object('sub', owner_id::text, 'role', 'authenticated')::text, true) from t;
select public.dk_kyuryo_haifu();
create temp table furui as select p.token from daikome.dk_kyuryo_pub p join t on p.employee_id = t.employee_id;
update daikome.dk_kyuryo_pub p set pw_hash = extensions.crypt('1234', extensions.gen_salt('bf')), init_code = null, pw_miss = 3, tomatta_at = now()
  from t where p.employee_id = t.employee_id;
insert into k select '23 一覧に 止まって いる', (select y->>'tomatta' from jsonb_array_elements(public.dk_kyuryo_haifu()::jsonb->'list') y where y->>'employee_id' = t.employee_id::text), 'true' from t;
insert into k select '24 1人ぶんに 止まって いる', public.dk_kyuryo_haifu_hitori(employee_id)::jsonb->'hito'->>'tomatta', 'true' from t;
insert into k select '25 作り直す', public.dk_kyuryo_saihakkou(employee_id)::jsonb->>'ok', 'true' from t;
insert into k select '26 token が 替わる', (p.token <> f.token)::text, 'true' from daikome.dk_kyuryo_pub p join t on p.employee_id = t.employee_id, furui f;
insert into k select '27 古い token は 開かない', public.dk_kyuryo_verify(f.token, '1234')::jsonb->>'reason', 'no_token' from furui f;
insert into k select '28 止めと 数が 消える', (p.tomatta_at is null and p.pw_miss = 0 and p.pw_hash is null and p.init_code is not null)::text, 'true' from daikome.dk_kyuryo_pub p join t on p.employee_id = t.employee_id;
insert into k select '29 よその 会社の 人は 作り直せない', public.dk_kyuryo_saihakkou(gen_random_uuid())::jsonb->>'reason', 'not_yours';
select n, v, case when v is not distinct from e then 'ok' else (1/(random()*0)::int)::text end as hantei from k order by n;
rollback;
