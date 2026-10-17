-- ★辞めた 人の 門（dk_kyuryo_get）の 確かめ★ 2026-10-16＝テスト線の 倉庫だけで、必ず rollback で 終わる（後に 残る 行 0）
-- 当て方：node tests/db-tameshi/tameshi-rollback.mjs <worktree> この ファイル（本番の 向き先なら 投げない・その 字は 書かない）
-- 窓は ★本人の 画面が 本当に 頼む 形★（_honninHaba＝前の 月の 1日〜次の 月の 末日）で 呼ぶ（前は 自分で 作った 窓で 呼び、画面の 90 日の 窓を 見落とした・対立役）
-- 期待：1 true／2 true／3 true／4 false/taishoku／5 false/taishoku（94日）／6 true（92日）／0 1（今いる人には 返る）／7 0/0（最後に 働いた 月の 次の 月末 より 後の 行は 返さない）／8 true/（手当だけの 月も 通す・10-17）／9 0/0/0/1（会社の 物は 返さず 手当は 返す）／10 true/0/0/0/1（働いた 日 0 の 人に 会社の 物を 返さない）
begin;
create temp table t as
  select w.company_id, w.employee_id, w.work_date d,
         (date_trunc('month', w.work_date) - interval '1 month')::date f,
         (date_trunc('month', w.work_date) + interval '2 month' - interval '1 day')::date e
  from daikome.dk_work_hours w order by w.work_date limit 1;
delete from daikome.dk_kyuryo_pub where employee_id = (select employee_id from t);
insert into daikome.dk_kyuryo_pub (token, company_id, employee_id, pw_hash)
  select 'zz-taishoku-tameshi', company_id, employee_id, extensions.crypt('pw', extensions.gen_salt('bf')) from t;
create temp table k (n text, v text);
-- 切る 日の 後に 手入力の 日を 1つ 置く（0件が 空振りで ない 事を 見る＝今いる人には 返る）
insert into daikome.dk_manual_days (company_id, work_date, device_id, sales_yen)
  select company_id, (date_trunc('month', d) + interval '2 month' + interval '4 day')::date, 'zz-kiru-ato', 1000 from t;
insert into k select '0 今いる人・切る日の後の手入力も返る', (select count(*) from jsonb_array_elements(coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', d - 10, d + 80)::jsonb->'manualDays','[]'::jsonb)) x where x->>'device_id' = 'zz-kiru-ato')::text from t;
insert into k select '1 今いる人・画面の窓（働いた月）', public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f, e)::jsonb->>'ok' from t;
insert into k select '2 今いる人・働いていない遠い月', public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f + 150, e + 150)::jsonb->>'ok' from t;
update daikome.dk_employees set active = false where employee_id = (select employee_id from t);
insert into k select '3 辞めた・画面の窓（働いた月・' || (e - f) || '日）', coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f, e)::jsonb->>'ok','') || '/' || coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f, e)::jsonb->>'reason','') from t;
insert into k select '4 辞めた・働いていない月', coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f + 150, e + 150)::jsonb->>'ok','') || '/' || coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f + 150, e + 150)::jsonb->>'reason','') from t;
insert into k select '5 辞めた・94日', coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', d - 47, d + 47)::jsonb->>'ok','') || '/' || coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', d - 47, d + 47)::jsonb->>'reason','') from t;
insert into k select '6 辞めた・92日', coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', d - 46, d + 46)::jsonb->>'ok','') || '/' || coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', d - 46, d + 46)::jsonb->>'reason','') from t;
insert into k select '7 辞めた・切った後の日付の行が0（勤務と手入力と直し）', (select count(*) from jsonb_array_elements(coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', d - 10, d + 80)::jsonb->'shifts','[]'::jsonb)) x where ((x->>'started_at')::timestamptz at time zone 'Asia/Tokyo')::date > (date_trunc('month', (select max(w.work_date) from daikome.dk_work_hours w where w.employee_id = t.employee_id)) + interval '2 month' - interval '1 day')::date)::text || '/' || (select count(*) from jsonb_array_elements(coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', d - 10, d + 80)::jsonb->'manualDays','[]'::jsonb)) x where (x->>'work_date')::date > (date_trunc('month', (select max(w.work_date) from daikome.dk_work_hours w where w.employee_id = t.employee_id)) + interval '2 month' - interval '1 day')::date)::text from t;
-- 10-17 司さん「向こうが URL 消すまで 見れないかん」＝手当・控除だけの 月も 通す。会社の 物（勤務・手入力・直し）は 返さない（対立役 S2）
insert into daikome.dk_pay_adjustments (company_id, employee_id, work_date, kind, label, yen)
  select company_id, employee_id, d + 150, 'teate', 'zz-tameshi', 3000 from t;
insert into k select '8 辞めた・手当だけの月（ok/reason）', coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f + 150, e + 150)::jsonb->>'ok','') || '/' || coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f + 150, e + 150)::jsonb->>'reason','') from t;
insert into k select '9 辞めた・手当だけの月の 勤務/手入力/直し/手当', (select count(*) from jsonb_array_elements(coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f + 150, e + 150)::jsonb->'shifts','[]'::jsonb)))::text || '/' || (select count(*) from jsonb_array_elements(coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f + 150, e + 150)::jsonb->'manualDays','[]'::jsonb)))::text || '/' || (select count(*) from jsonb_array_elements(coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f + 150, e + 150)::jsonb->'edits','[]'::jsonb)))::text || '/' || (select count(*) from jsonb_array_elements(coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f + 150, e + 150)::jsonb->'adjustments','[]'::jsonb)))::text from t;
-- 働いた 日が 1日も 無い 辞めた 人（least(p_to, NULL) の 穴）＝勤務時間を 消して、働いた 月の 窓に 手当を 置く
delete from daikome.dk_work_hours where employee_id = (select employee_id from t);
insert into daikome.dk_pay_adjustments (company_id, employee_id, work_date, kind, label, yen)
  select company_id, employee_id, d, 'koujo', 'zz-tameshi', 1200 from t;
insert into k select '10 辞めた・働いた日0・手当の月 ok/勤務/手入力/直し/手当', coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f, e)::jsonb->>'ok','') || '/' || (select count(*) from jsonb_array_elements(coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f, e)::jsonb->'shifts','[]'::jsonb)))::text || '/' || (select count(*) from jsonb_array_elements(coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f, e)::jsonb->'manualDays','[]'::jsonb)))::text || '/' || (select count(*) from jsonb_array_elements(coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f, e)::jsonb->'edits','[]'::jsonb)))::text || '/' || (select count(*) from jsonb_array_elements(coalesce(public.dk_kyuryo_get('zz-taishoku-tameshi','pw', f, e)::jsonb->'adjustments','[]'::jsonb)))::text from t;
select n, v from k order by n;
rollback;
