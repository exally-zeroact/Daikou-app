-- ============================================================
-- ★★給料の 締め（20日締め・月2回・週・毎日 等）の 置き場★★ 2026-10-07
--
--   ★司さん★「この払い方がまだ対応できてないやろが」（月3回／月1回／日数 の 3つだけ だった）
--   ★司さんの 決め（10-07）★ 何月分と 呼ぶかは 会社が 選ぶ（nazuke）／月次の 給料は 締めた 分
--   ★足す 物★ dk_payroll_settings.period_shime（jsonb・空＝今まで 通り period_end_mode を 読む）
--     中身の 形は js/payroll-period.js の seiki に 書いた（壊れて いれば 給料を 出さずに 止める）
--   ★本人の 画面（dk_kyuryo_get）★ は settings を to_jsonb で 丸ごと 返す＝この 列も そのまま 届く
--
--   ★窓（public の view）は 列を 最後に 足す★（本番・テストの 今の 並び＝2026-10-07 実測 pg_get_viewdef）
--   ★security_invoker は 付け直す★／★何度 流しても 同じ★
-- ============================================================

alter table daikome.dk_payroll_settings
  add column if not exists period_shime jsonb;

create or replace view public.dk_payroll_settings as
select
  company_id,
  pool_mode,
  deduct_reserve_before_rate,
  reserve_pool_rate,
  reserve_owner_rate,
  period_start_day,
  period_end_mode,
  period_days,
  owner_device_id,
  roles,
  updated_at,
  show_car_sales,
  pay_extra,
  period_shime
from daikome.dk_payroll_settings;

alter view public.dk_payroll_settings set (security_invoker = true);
