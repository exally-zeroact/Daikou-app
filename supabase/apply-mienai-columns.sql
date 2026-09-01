-- ============================================================
-- ★★「見えなかった分」を 勤務の 行に 残す（列を 3つ 足すだけ）★★ 2026-09-01
--
--   ★★棚の 場所を 2回 間違えました（実測で 直した・記録として 残します）★★
--     1回目 `daikome.dk_jobs` … ★そんな棚は 有りません★
--            ERROR 42P01: relation "daikome.dk_jobs" does not exist
--     2回目 `dk_shifts`（前置き無し）… ★それは 窓(view)★でした
--            ERROR 42809: ALTER ... ADD COLUMN cannot be performed on relation "dk_shifts"
--                         DETAIL: This operation is not supported for views.
--     ⇒ 本体は ★daikome.dk_shifts★／public.dk_shifts は ★そこを 見ている 窓★。
--     ⇒ ★本体に 足して、窓も 足し直す★（窓は 列を 名指ししているので 直さないと 見えない）
--
--   ★なぜ★
--     走った後に ★「本当に 走ったか」★を 確かめる 手が 今 ありません
--     （trace は Firebase なので ★使いません★＝司さんの 決まり）。
--     メーターは もう 数えています（pipeline-distance.mienakattaBun）。
--
--   ★お金には 効きません★
--     ★足すだけ★。距離にも 料金にも 1mmも 触りません。
--     既に 在る 行は NULL のまま（＝「取っていない」と 読める）。
--
--   ★窓の 作り直しの 決まり（この repo の 既存の 注意書きと 同じ）★
--     `create or replace view` は ★security_invoker を 落とす★ので 必ず 付け直す。
-- ============================================================

alter table if exists daikome.dk_shifts
  add column if not exists mienai_kaisuu integer,   -- 点が 途切れて 捨てた 回数
  add column if not exists mienai_byou   numeric,   -- 捨てた 秒数の 合計
  add column if not exists mienai_m      numeric;   -- 埋められず 捨てた 距離(m)

comment on column daikome.dk_shifts.mienai_kaisuu is '見えなかった回数（点の途切れ）2026-09-01';
comment on column daikome.dk_shifts.mienai_byou   is '見えなかった秒数の合計 2026-09-01';
comment on column daikome.dk_shifts.mienai_m      is '穴を埋められず捨てた距離m（★3つの合計ではない★）2026-09-01';

-- ★窓も 足し直す（列を 名指ししているので、足さないと 事務所から 見えない）★
create or replace view public.dk_shifts as
SELECT shift_id,
    company_id,
    device_id,
    driver_id,
    started_at,
    ended_at,
    elapsed_sec,
    total_distance_m,
    actual_total_m,
    empty_distance_m,
    fare_total_yen,
    trip_count,
    created_at,
    excluded,
    note,
    mienai_kaisuu,
    mienai_byou,
    mienai_m
   FROM daikome.dk_shifts;
alter view public.dk_shifts set (security_invoker = true);
