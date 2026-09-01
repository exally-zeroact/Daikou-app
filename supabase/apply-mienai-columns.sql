-- ============================================================
-- ★★「見えなかった分」を 業務の 行に 残す（列を 3つ 足すだけ）★★ 2026-09-01
--
--   ★なぜ★
--     走った後に ★「本当に 走ったか」★を 確かめる 手が 今 ありません
--     （trace は Firebase なので ★使いません★＝司さんの 決まり）。
--     メーターは もう 数えています（pipeline-distance.mienakattaBun）。
--     ⇒ ★その3つを 業務の 行に 一緒に 残します★。
--
--   ★お金には 効きません★
--     ★足すだけ★です。距離にも 料金にも 1mmも 触りません。
--     既に 在る 行は NULL のまま（＝「取っていない」と 読める）。
--
--   ★入れる人★ … ★司さん★（私は 当てません）
--   ★入れる先★ … ★本番の 倉庫（tnfwipbgfgjaymlszeid）★ と テストの 倉庫 の 両方
-- ============================================================

alter table if exists daikome.dk_jobs
  add column if not exists mienai_kaisuu integer,   -- 点が 途切れて 捨てた 回数
  add column if not exists mienai_byou   numeric,   -- 捨てた 秒数の 合計
  add column if not exists mienai_m      numeric;   -- 埋められず 捨てた 距離(m)

comment on column daikome.dk_jobs.mienai_kaisuu is '見えなかった回数（点の途切れ）2026-09-01';
comment on column daikome.dk_jobs.mienai_byou   is '見えなかった秒数の合計 2026-09-01';
comment on column daikome.dk_jobs.mienai_m      is '穴を埋められず捨てた距離m（★3つの合計ではない★）2026-09-01';
