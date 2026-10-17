-- ============================================================
-- ★従業員の 退職・復職★（2026-10-16 司さん）
--
--   司さん「赤丸の所に退職者のボタンを作って（従業員もボタンにする）切り替えれるようにして
--           青丸の所に退職ボタンを作って従業員のページから消せるようにして退職者ページに移して
--           退職者ページでは2行で1行目に辞めた日付2行目に名前とその横に復職ボタンが欲しい」
--
--   ★持ち場は 人の棚★ … 辞めた 日を dk_employees に 1本 足す（退職＝active=false ＋ retired_on）。
--   ★空（null）＝日付なし★＝前から「今いる人」を 外していた 人。
--   ★お金は 1円も 動かない★（明細に 出すかは report() が 働いた 日と 手当・控除で 決める・10-16）
--   ★データは 1行も 触りません★（列を 1本 足し、窓に 映す 列を 1本 足すだけ）
--
--   ★窓（public の view）も 作り直す★（列を 本体にだけ 足すと API が 400＝2026-09-06 に 踏んだ）
--     今の 列（テスト線・本番とも information_schema で 読んで 同じ・2026-10-16）の 末尾に 足す。
--     `create or replace view` は security_invoker を 落とすので 必ず 付け直す。
-- ============================================================

alter table daikome.dk_employees
  add column if not exists retired_on date;

comment on column daikome.dk_employees.retired_on is
  '辞めた日（退職ボタンで入る・復職で空）。空＝日付なし。お金の計算には使わない。2026-10-16 司さん';

create or replace view public.dk_employees
  with (security_invoker = true) as
  select employee_id, company_id, name, role, active, sort_order, note,
         created_at, updated_at, pay_rate, pay_floor, slip_cars, retired_on
    from daikome.dk_employees;
