-- ============================================================
-- supabase/apply-meisai-dkref-index.sql
--   ★請求明細の 二重を「構造で」止める★  2026-09-29（司さん「1.2両方やれや」）
--
-- ★なぜ 要るか（対立役 2人＋私が 別々に 数えて 一致）★
--   ダイコメの 勤務は supabase/functions/dk-sync-jobs/index.ts が
--   `extra->>'dk_ref'`（＝端末:勤務開始ms:何件目）を 鍵に して 明細に 書く。
--   二重を 止めているのは ★「読んでから 書く」だけ★で、
--   `daikou.meisai` に その 鍵の 索引は ★1本も 無かった★（実測 2026-09-29）:
--     meisai_pkey(id) ／ meisai_user_id_company_date_idx(user_id,company,date)＝非unique
--   ⇒ 同じ勤務が ★同時に 2本 飛ぶ★と、両方が「まだ 無い」を 読んで ★2行 入る★。
--   ⇒ さらに index.ts:256 の select は ★error を 捨てている★ので、
--      その 問い合わせが 1回 落ちた 晩は ★その勤務の 請求書払い 全部が 二重★ に なる。
--   ★今 二重は 0件★（dk_ref 付き 150行／全1,380行）＝★今なら 掃除なしで 張れる★。
--
-- ★concurrently を 使わない 訳★
--   Management API の 問い合わせは 取引の 中で 走るので concurrently は 使えない。
--   この表は 1,380行 しか 無い ので ふつうの create でも 一瞬（実測 1秒 未満）。
--
-- ★部分索引に する 訳★
--   dk_ref を 持たない 行が 1,230行 在る（＝事務所が 手で 作った 明細）。
--   それらは 索引に 入れない ＝ 小さく 済み、NULL 同士の 衝突も 起きない。
--
-- ★これは「足すだけ」★ 既存の 行は 1つも 変えない・消さない。
--   すでに 在れば `if not exists` で 何も しない（2回 当てても 同じ）。
-- ============================================================

create unique index if not exists meisai_dk_ref_uniq
  on daikou.meisai ((extra->>'dk_ref'))
  where extra->>'dk_ref' is not null;
