-- ============================================================
-- ★★PayPay → 電子決済（倉庫の 列の 名前も 変える）★★ 2026-09-08
--
--   ★司さん★「PayPayって書いてるとこ全部電子決済にしてな」→「直して全部やれ」
--
--   ★はじめは 残す つもりでした★
--     「名前を 変えると 前に 入れた 分が 読めなくなる」と 思った ため。
--   ★数えたら 0行でした（2026-09-08 実測）★
--     本番   … dk_month_extras 0行 ／ dk_day_extras 0行
--     テスト … dk_month_extras 0行 ／ dk_day_extras 0行
--     ⇒ ★失う 物が 無い★ので 変えます。
--     （それでも rename は 中身を 消しません。列の 札を 付け替えるだけ）
--
--   ★変える 物★
--     daikome.dk_month_extras.paypay_yen → denshi_yen
--     daikome.dk_day_extras.paypay_yen   → denshi_yen
--     public の 窓（view）も 作り直す
--
--   ★★窓は 必ず security_invoker を 付け直す★★
--     create or replace view は これを 落とします。
--     （2026-09-06 に これを 忘れて 保存が 2週間 死んでいた）
--
--   ★何度 流しても 同じ★（もう 変わっていたら 何もしない）
-- ============================================================

-- ① 列の 名前（在る時だけ）
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'daikome' and table_name = 'dk_month_extras'
       and column_name = 'paypay_yen'
  ) then
    alter table daikome.dk_month_extras rename column paypay_yen to denshi_yen;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'daikome' and table_name = 'dk_day_extras'
       and column_name = 'paypay_yen'
  ) then
    alter table daikome.dk_day_extras rename column paypay_yen to denshi_yen;
  end if;
end $$;

-- ② 窓（public）を 作り直す（★security_invoker を 付け直す★）
drop view if exists public.dk_month_extras;
create view public.dk_month_extras
  with (security_invoker = true) as
  select company_id, ym, denshi_yen, note, updated_at
    from daikome.dk_month_extras;

drop view if exists public.dk_day_extras;
create view public.dk_day_extras
  with (security_invoker = true) as
  select company_id, pay_date, denshi_yen, note, updated_at
    from daikome.dk_day_extras;

grant select, insert, update, delete on public.dk_month_extras to authenticated;
grant select, insert, update, delete on public.dk_month_extras to anon;
grant select, insert, update, delete on public.dk_day_extras to authenticated;
grant select, insert, update, delete on public.dk_day_extras to anon;
