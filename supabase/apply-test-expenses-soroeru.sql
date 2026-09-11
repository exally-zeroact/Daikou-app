-- ============================================================
-- ★★テストの 倉庫に 足りない 列を そろえる★★ 2026-09-11（実測で 見つけた）
--
--   ★見つけ方★ 電子決済を 車ごとに する SQL を テストに 当てたら
--     ERROR: column "expenses" does not exist
--
--   ★実測（2026-09-11）★ daikome.dk_shift_edits
--     本番 … shift_id, company_id, toll_yen, bridge_yen, other_yen,
--            other_label, note, updated_at, hours, ★expenses★
--     テスト … 同じ ＋ ★expenses が 無い★
--   ⇒ 2026-09-08 の「実費を 自由に 足せる」の 時に
--     ★本番にだけ 当てて テストに 当て忘れていた★。
--
--   ★決まり★ ★テスト環境を 本番に 合わせる（逆は しない）★
-- ============================================================

alter table daikome.dk_shift_edits
  add column if not exists expenses jsonb;

create or replace view public.dk_shift_edits as
select
  shift_id,
  company_id,
  toll_yen,
  bridge_yen,
  other_yen,
  other_label,
  note,
  updated_at,
  hours,
  expenses
from daikome.dk_shift_edits;

alter view public.dk_shift_edits set (security_invoker = true);
