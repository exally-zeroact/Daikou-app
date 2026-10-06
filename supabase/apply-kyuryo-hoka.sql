-- ============================================================
-- ★★給料の ほかの 払い方（日給・回数歩合・距離歩合・段階歩合・指定日の 割増）の 置き場★★ 2026-10-06
--
--   ★司さん★「給料設定はいろんなものに対応できるようにしとんか？」→「対応できるように対立でやれ」
--   ★足す 物★ dk_payroll_settings.pay_extra（jsonb・空＝使わない＝今の 給料と 1円も 変わらない）
--     中身の 形は js/daiko-payroll.js の normExtra に 書いた。
--   ★roles の jsonb に 混ぜない★（roles は {rate, floor} だけに 作り直して 保存する＝混ぜると 消える）
--   ★本人の 画面（dk_kyuryo_get）★ は settings を to_jsonb で 丸ごと 返す＝この 列も そのまま 届く
--
--   ★窓（public の view）は 列を 最後に 足す★（本番の 今の 並び＝2026-10-06 実測 pg_get_viewdef）
--   ★security_invoker は 付け直す★／★何度 流しても 同じ★
-- ============================================================

alter table daikome.dk_payroll_settings
  add column if not exists pay_extra jsonb;

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
  pay_extra
from daikome.dk_payroll_settings;

alter view public.dk_payroll_settings set (security_invoker = true);
