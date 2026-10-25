-- ★請求書アプリの 明細の 日ごとの 合計（月次集計の 請求書の もと）★ 2026-10-25
--   司さん「このようなシステムを使ってるサイトはどうしとんど？読み込めんってありえんやろが」
--   前：月次集計（shukei.html meisaiZenbu）が 明細を 1行ずつ 1000行 ごとに 画面へ 運び、5万行で 黙って 打ち切った
--       （1年 約 5.1万行を 越えると 請求書の 額が 数えられず 月次の 現金が 多く 出た）。
--   今：足し算は 倉庫で する＝画面に 来るのは 日の 数だけ（1年分で 最大 397行）・行が 何万 在っても 変わらない。
--   ・数は 前と 同じ：生きている 行（deleted_at is null）の amount（integer・NOT NULL）を 日（date 型）ごとに 足す
--   ・security_invoker＝見る 人の 権限で 動く＝daikou.meisai の RLS（own: auth.uid() = user_id）が 窓の 中でも 効く
--     （anon は 0行・本人は 自分の 明細だけ＝今の public.meisai と 同じ）
--   ・請求書アプリの 表（daikou.meisai）と 窓（public.meisai）は 触らない＝読むだけ
create or replace view public.dk_meisai_hi_goukei as
SELECT m.date,
    sum(m.amount)::bigint AS goukei,
    count(*)::integer AS kensuu
   FROM daikou.meisai m
  WHERE m.deleted_at IS NULL
  GROUP BY m.date;
alter view public.dk_meisai_hi_goukei set (security_invoker = true);
grant select on dk_meisai_hi_goukei to authenticated;
