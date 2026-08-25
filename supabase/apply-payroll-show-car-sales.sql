-- ============================================================
-- ★給料明細に「車ごとの売上」を載せるかどうか★（2026-08-25 司さん）
--
--   司さん「売り上げ（車ごと）を載せないような選べるようにするのを決めるところが欲しい」
--
--   ★新しい棚は作らない★ … 給料の決まりは もう dk_payroll_settings に在るので
--   ★そこに列を1本 足すだけ★（会社ごと・社長の画面で決める・端末は読むだけ）。
--
--   ★既定は true＝今までと同じ見た目★（入れた瞬間に誰の画面も変わらない）。
-- ============================================================

alter table daikome.dk_payroll_settings
  add column if not exists show_car_sales boolean not null default true;

comment on column daikome.dk_payroll_settings.show_car_sales is
  '給料明細に 車ごとの売上（売上1・売上2…）の行を載せるか。既定 true=載せる。2026-08-25 司さん';
