-- ============================================================
-- 事務所が メーターの 車の 回数・実車距離・総走行距離を 直せる 様に する（列）2026-10-25
--
--   司さん「入力のドロップダウンの中身でなぜつかさしか回数、実車距離、総走行距離がない？
--          全部の車に自動反映できるもので（修正できるように）つけろよ」
--
--   足す 列（dk_shift_edits＝1回の 業務ごと）
--     trip_count_naoshi       … 直した 回数。null＝メーターの まま（dk_shifts.trip_count）
--     actual_total_m_naoshi   … 直した 実車距離（m）。null＝メーターの まま（dk_shifts.actual_total_m）
--     total_distance_m_naoshi … 直した 総走行距離（m）。null＝メーターの まま（dk_shifts.total_distance_m）
--   計算は 全部 js/uriage-agg.js kazuOf の 1か所（直しが 在れば それ・無ければ メーター）。
--   元データ（dk_shifts・課金の distance_m）は この 列の 為に 書かない。
--
--   窓（public の view）は 列を 最後に 足す（create or replace は 末尾に 足すのだけ 許される）
--     テスト・本番の 今の 並び（2026-10-25 実測 information_schema・両方 同じ）：
--       shift_id,company_id,toll_yen,bridge_yen,other_yen,other_label,note,updated_at,hours,
--       expenses,denshi_yen,seikyu_yen,uriage_yen,uriage_at
--   security_invoker は 付け直す／何度 流しても 同じ
--   負の 数を 倉庫で 止める check は 付けない（apply-uriage-naoshi.sql と 同じ 訳）。
--   負・小数・字は 保存の 口（JippiHozon.saveKazu）と 読む 関数（UriageAgg.kazuOf）が 止める
--
--   本人の 給料の 画面（dk_kyuryo_get の edits）にも 同じ 列を 出す（apply-kyuryo-honnin-kansuu.sql）。
--   ★この 紙を 先に 当ててから 関数を 当てる★（関数は この 列を 名指しで 読む）
-- ============================================================

alter table daikome.dk_shift_edits
  add column if not exists trip_count_naoshi integer;

alter table daikome.dk_shift_edits
  add column if not exists actual_total_m_naoshi integer;

alter table daikome.dk_shift_edits
  add column if not exists total_distance_m_naoshi integer;

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
  seikyu_yen,
  uriage_yen,
  uriage_at,
  trip_count_naoshi,
  actual_total_m_naoshi,
  total_distance_m_naoshi
from daikome.dk_shift_edits;

alter view public.dk_shift_edits set (security_invoker = true);
