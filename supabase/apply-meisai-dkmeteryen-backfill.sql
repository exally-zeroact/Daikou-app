-- ============================================================
-- supabase/apply-meisai-dkmeteryen-backfill.sql
--   ★既に 在る 明細に「その時 メーターが 出していた 額」の 印を 1回だけ 埋める★ 2026-09-29
--
-- ★なぜ 要るか★
--   事務所（代行請求書アプリ）で 手で 直した 金額が、送り直しで メーターの 値に 戻る。
--   見分けるには ★書いた 時の メーターの 額★ が 要る（`extra.dk_meter_yen`）。
--   これから 入る 行には 関数が 必ず 付けるが、★既に 在る 150行には 無い★（実測 2026-09-29）。
--   印が 無い 行は 今までどおり 上書きするので、★埋めるまで 守りが 効かない★。
--
-- ★印は「メーターの 額」で 埋める（明細の 額では ない）★
--   dk_ref = `端末:勤務開始ms:何件目` から `daikome.dk_trips.fare_yen` を 引いて 入れる。
--   ・金額が 一致している 143行 … どちらで 埋めても 同じ
--   ・★明細と メーターが ずれている 7行★ … メーターの 額で 埋めると
--       向き（2026-09-29 実測・150行 中 143行は 同じ）:
--         明細が ★低い★ 6行・計 1,400円 ／ 明細が ★高い★ 1行・2,000円
--       ★どちらが 動いたかは 分からない（見立て）★＝meisai に updated_at が 無い。
--     次の 送り直しで「メーターは 変わっていない」と 読めて ★事務所の 額が 守られる★。
--     （明細の 額で 埋めると 逆に「メーターが 変わった」と 読まれて 上書きされる）
--
-- ★これは「足すだけ」★
--   ・`extra` に ★キーを 1つ 足すだけ★。他の キー（dk_ref/dk_from/dk_car/…）は そのまま。
--   ・既に 印が 在る 行は ★触らない★（2回 当てても 同じ）。
--   ・amount / company / date / note など ★お金と 字の 列は 1つも 触らない★。
--   ・`daikome.dk_trips` に 相手が 居る 行だけ（居ない 行は そのまま 残す）。
--
-- ★★当て方は 変わった（2026-09-29）★★
--   この 字は `update … set` なので ★門(scripts/sql-guard.mjs)が 止める★。
--   それで 正しい（門は「その update が 足すだけか」を 読めない）。
--   ★門を ゆるめる のでは なく、この 1件しか 出来ない 道具を 作った★：
--     node scripts/apply-dkmeteryen-backfill.mjs          … ★見るだけ★
--     node scripts/apply-dkmeteryen-backfill.mjs --yaru   … 当てる
--   この 紙は ★何を やるかの 記録★として 残す（このままでは 当てられない）。
-- ============================================================

update daikou.meisai m
   set extra = m.extra || jsonb_build_object('dk_meter_yen', t.fare_yen)
  from daikome.dk_shifts s
  join daikome.dk_trips t
    on t.shift_id = s.shift_id
 where m.extra ? 'dk_ref'
   and not (m.extra ? 'dk_meter_yen')
   and s.device_id = split_part(m.extra->>'dk_ref', ':', 1)
   and extract(epoch from s.started_at) * 1000 = (split_part(m.extra->>'dk_ref', ':', 2))::bigint
   and t.seq = (split_part(m.extra->>'dk_ref', ':', 3))::int;
