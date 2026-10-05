-- ============================================================
-- ★★請求書の 額を 車ごとに 打てる ように する★★ 2026-10-06
--
--   ★司さん★「売り上げから請求書アプリに入ってるその日の金額を引く」
--             「2は両方に対応しろ」（請求書アプリの 額 と 入力画面で 打つ 額の 両方）
--   ★Excel（代行計算表2026）★ 入力シートに 車ごとの 請求書の 欄が 在る。
--     請求書が 下げるのは ★現金だけ★（現金 ＝ 売上 − 請求書 − 電子決済）。
--     ★売上合計も 給料も 下げない★（司さん 10-06「1A」＝給料は 引かない）。
--
--   ★足す 列★ seikyu_yen（その 回／その 日の その 車の 請求書の 額）
--     ・dk_shift_edits … メーターで 走った 車（1回の 業務ごと）
--     ・dk_manual_days … メーターの 無い 車（会社×日×車）
--     ★expenses には 入れない★（expenses は 売上から 引かれる＝給料が 下がる）
--
--   ★窓（public の view）は 列を 最後に 足す★（create or replace は 末尾に 足すのだけ 許される）
--     本番の 今の 並び（2026-10-06 実測 information_schema）：
--       dk_shift_edits … shift_id,company_id,toll_yen,bridge_yen,other_yen,other_label,note,
--                        updated_at,hours,expenses,denshi_yen
--       dk_manual_days … company_id,work_date,device_id,sales_yen,hours,toll_yen,bridge_yen,
--                        other_yen,trip_count,note,updated_at,expenses,denshi_yen
--   ★★この 1本で 足りる★★（対立役 10-06：距離の SQL が 当たっていない 本番で view の 作り直しが 落ち、
--     手前の 列だけ 残ると 入力画面が 請求書の 欄を 出して 保存が 400 に なる）
--     ⇒ ★距離の 2列（apply-tebiki-kyori.sql と 同じ）も ここで 先に 足す★＝view の 作り直しが 落ちる 因が 無くなる。
--       （begin/commit は SQL の 門 scripts/sql-guard.mjs の 白名簿に 無いので 使わない）
--   ★security_invoker は 付け直す★／★何度 流しても 同じ★
-- ============================================================

-- 距離（apply-tebiki-kyori.sql と 同じ・何度 流しても 同じ）
alter table daikome.dk_manual_days
  add column if not exists actual_total_m double precision;

alter table daikome.dk_manual_days
  add column if not exists total_distance_m double precision;

alter table daikome.dk_shift_edits
  add column if not exists seikyu_yen integer;

alter table daikome.dk_manual_days
  add column if not exists seikyu_yen integer;

create or replace view public.dk_shift_edits as
select
  shift_id,
  company_id,
  toll_yen,
  bridge_yen,
  other_yen,
  other_label,
  note,
  updated_at,
  hours,
  expenses,
  denshi_yen,
  seikyu_yen
from daikome.dk_shift_edits;

alter view public.dk_shift_edits set (security_invoker = true);

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
  total_distance_m,
  seikyu_yen
from daikome.dk_manual_days;

alter view public.dk_manual_days set (security_invoker = true);
