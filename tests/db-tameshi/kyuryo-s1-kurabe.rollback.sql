-- ★S1 の 比べ（直しを 窓で 絞っても 今いる人の 額が 変わらないか）★ 2026-10-17＝テスト線の 倉庫だけ・必ず rollback で 終わる（後に 残る 行 0）
-- 当て方：node tests/db-tameshi/kyuryo-s1-kurabe.mjs <worktree>（この ファイルを 投げて 返りを 本物の 計算 js/payroll-daily.js に 通す）
-- ★空振りに しない★ テストの 倉庫は 勤務 3 件・8 月だけ＝窓の 外の 直しが 0 行（1回目＝絞りで 外れた 行 延べ 0）。
--   勤務と 勤務時間を 3 か月 後へ 写し、全部の 勤務に 仮の 直し（売上 77,777 円・高速 1,234 円）を 置く
--   ＝8 月の 窓では 11 月の 直しが、11 月の 窓では 8 月の 直しが 絞りで 外れる（外れた 行の 数も 出す）
-- 今いる人 × 働いた 月 ごとに、
--   g＝本人の 関数（本人の 画面と 同じ 窓＝前の 月の 1日〜次の 月の 末日）／all_edits＝会社の 直しを 全部（絞る 前の 関数と 同じ）
--   jim_*＝事務所の 画面と 同じ 材料（会社の 人・勤務時間・手当控除を 全員ぶん）
begin;
insert into daikome.dk_shifts
  select (jsonb_populate_record(null::daikome.dk_shifts,
    to_jsonb(s) || jsonb_build_object('shift_id', gen_random_uuid(),
      'started_at', s.started_at + interval '3 month', 'ended_at', s.ended_at + interval '3 month'))).*
  from daikome.dk_shifts s;
insert into daikome.dk_work_hours (company_id, employee_id, work_date, device_id, hours)
  select company_id, employee_id, (work_date + interval '3 month')::date, device_id, hours from daikome.dk_work_hours;
insert into daikome.dk_shift_edits (shift_id, company_id, uriage_yen, toll_yen)
  select sh.shift_id, sh.company_id, 77777, 1234 from daikome.dk_shifts sh
  where not exists (select 1 from daikome.dk_shift_edits ed where ed.shift_id = sh.shift_id);
update daikome.dk_shift_edits set uriage_yen = 77777, toll_yen = 1234;
create temp table p as
  select distinct w.company_id, w.employee_id, date_trunc('month', w.work_date)::date m
  from daikome.dk_work_hours w join daikome.dk_employees e on e.employee_id = w.employee_id
  where coalesce(e.active, true)
  order by m desc limit 24;
delete from daikome.dk_kyuryo_pub where employee_id in (select employee_id from p);
insert into daikome.dk_kyuryo_pub (token, company_id, employee_id, pw_hash)
  select distinct on (employee_id) 'zz-s1-' || employee_id, company_id, employee_id, extensions.crypt('pw', extensions.gen_salt('bf'))
  from p order by employee_id;
select p.employee_id, p.m,
  public.dk_kyuryo_get('zz-s1-' || p.employee_id, 'pw', (p.m - interval '1 month')::date, (p.m + interval '2 month' - interval '1 day')::date)::jsonb g,
  (select coalesce(jsonb_agg(jsonb_build_object('shift_id', ed.shift_id, 'toll_yen', ed.toll_yen, 'bridge_yen', ed.bridge_yen, 'other_yen', ed.other_yen, 'expenses', ed.expenses, 'hours', ed.hours, 'uriage_yen', ed.uriage_yen)), '[]'::jsonb)
     from daikome.dk_shift_edits ed where ed.company_id = p.company_id) all_edits,
  (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from daikome.dk_employees e where e.company_id = p.company_id) jim_emps,
  (select coalesce(jsonb_agg(jsonb_build_object('work_date', w.work_date, 'employee_id', w.employee_id, 'device_id', w.device_id, 'hours', w.hours)), '[]'::jsonb)
     from daikome.dk_work_hours w where w.company_id = p.company_id
       and w.work_date between (p.m - interval '1 month')::date and (p.m + interval '2 month' - interval '1 day')::date) jim_wh,
  (select coalesce(jsonb_agg(jsonb_build_object('work_date', a.work_date, 'employee_id', a.employee_id, 'kind', a.kind, 'label', a.label, 'yen', a.yen)), '[]'::jsonb)
     from daikome.dk_pay_adjustments a where a.company_id = p.company_id
       and a.work_date between (p.m - interval '1 month')::date and (p.m + interval '2 month' - interval '1 day')::date) jim_adj
from p order by p.m desc, p.employee_id;
rollback;
