-- ============================================================
-- ★試し打ちの勤務を「消さずに集計から外す」印★ 2026-08-06
--
--   司さん「★0mの3件は消さない★」
--   指示役「0m 3行の印付け」
--
--   ★実物（本番・2026-08-06 実測）★
--     2026-08-03 04:51 / 05:01 / 05:08（日本時間 13:51/14:01/14:08）
--     総距離 0m・0.71m・0m ／ 実車0m ／ 0円 ／ ★代行0件★
--     ＝8/3 の較正の日に、司さんが業務開始→すぐ終了を押した試し打ち。
--
--   ▼なぜ消さないか
--     「動かした記録」そのものは残す。消すと後で何が起きたか追えない。
--   ▼なぜ外すか
--     残したままだと 売上表・給料・月次に★中身の無い日が並ぶ★。
--
--   ▼印は2つ
--     excluded … 集計から外すか（画面はこれを見て飛ばす）
--     note     … なぜ外したか（後で見た人が分かるように）
-- ============================================================

alter table daikome.dk_shifts add column if not exists excluded boolean not null default false;
alter table daikome.dk_shifts add column if not exists note text;

-- public の窓口を作り直す（列が増えたので）
create or replace view public.dk_shifts with (security_invoker = true) as
  select * from daikome.dk_shifts;
grant select, insert, update, delete on public.dk_shifts to authenticated, anon;

-- ★印を付ける（消さない）★
--   条件: 代行が1件も無く、実車距離も総距離もほぼ0＝仕事になっていない
update daikome.dk_shifts s
   set excluded = true,
       note = coalesce(s.note, '') ||
              case when coalesce(s.note,'') = '' then '' else ' / ' end ||
              '試し打ち（代行0件・距離ほぼ0）。消さずに集計から外す 2026-08-06'
 where s.excluded = false
   and coalesce(s.fare_total_yen, 0) = 0
   and coalesce(s.trip_count, 0) = 0
   and coalesce(s.total_distance_m, 0) < 10
   and coalesce(s.actual_total_m, 0) < 10
   and not exists (select 1 from daikome.dk_trips t where t.shift_id = s.shift_id);
