-- ============================================================
-- ★★手で 入れた 1日ぶんに 実車距離・総走行距離を 持たせる★★ 2026-10-05
--
--   ★司さん★「ここにも車ごとに回数や実車距離や総走行距離を入れる欄」
--     （入力の 画面＝メーターが 読めなかった 車の 売上・電子決済・経費を 打つ 所）
--
--   ★前★ dk_manual_days は 回数（trip_count）だけ 持っていて、距離の 列が 無かった。
--   ★今★ 実車距離（actual_total_m）・総走行距離（total_distance_m）を 足す。
--     単位は ★メートル★（メーターの dk_shifts と 同じ・画面では km で 打つ）。
--     空（null）＝打っていない。
--
--   ★窓（public の view）は 列を 最後に 足す★（create or replace は 末尾に 足すのだけ 許される）
--   ★security_invoker は 付け直す★（2026-09-06 に 忘れて 保存が 2週間 死んでいた）
--   ★何度 流しても 同じ★
-- ============================================================

alter table daikome.dk_manual_days
  add column if not exists actual_total_m double precision;

alter table daikome.dk_manual_days
  add column if not exists total_distance_m double precision;

create or replace view public.dk_manual_days as
select
  company_id,
  work_date,
  device_id,
  sales_yen,
  hours,
  toll_yen,
  bridge_yen,
  other_yen,
  trip_count,
  note,
  updated_at,
  expenses,
  denshi_yen,
  actual_total_m,
  total_distance_m
from daikome.dk_manual_days;

alter view public.dk_manual_days set (security_invoker = true);
