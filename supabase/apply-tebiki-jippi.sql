-- ============================================================
-- ★★走った 記録が 無い 日にも 実費を 入れられるように する★★ 2026-09-08
--
--   ★司さん★「日付選んどんやけん入力するとこ出しとけや」
--
--   ★何が 困っていたか★
--     高速代・橋代は ★1回の 業務（メーターの 記録）に ぶら下がる★（dk_shift_edits）。
--     ⇒ 走っていない 日を 選ぶと ★入れる 欄が 1つも 出なかった★。
--
--   ★使う 棚は 前から 在る★ … daikome.dk_manual_days
--     （company_id, work_date, device_id, sales_yen, toll_yen, bridge_yen, other_yen …）
--     ＝「手で 入れた 1日ぶん」。売上表・給料・月次集計が ★もう 読んでいます★。
--
--   ★足りなかった 物★
--     会社が 足した 実費（例：駐車場代）を 入れる 所が 無い。
--     dk_shift_edits には 2026-09-06 に expenses（名前つき）を 足しましたが、
--     こちらは ★古い 3つ（toll/bridge/other）の ままでした★。
--     ⇒ ★同じ 形に そろえます★（画面は どちらでも 同じ 名前で 打てる）
--
--   ★実測（2026-09-08 本番）★ dk_manual_days は ★0行★ ⇒ 失う 物は 無い
--
--   ★★窓（public の view）は 作り直したら security_invoker を 付け直す★★
--     （2026-09-06 に これを 忘れて 保存が 2週間 死んでいた）
--
--   ★何度 流しても 同じ★
-- ============================================================

alter table daikome.dk_manual_days
  add column if not exists expenses jsonb not null default '{}'::jsonb;

drop view if exists public.dk_manual_days;
create view public.dk_manual_days
  with (security_invoker = true) as
  select company_id,
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
         expenses
    from daikome.dk_manual_days;

grant select, insert, update, delete on public.dk_manual_days to authenticated;
grant select, insert, update, delete on public.dk_manual_days to anon;
