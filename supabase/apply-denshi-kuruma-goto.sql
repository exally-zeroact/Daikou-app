-- ============================================================
-- ★★電子決済を「車ごと」に する★★ 2026-09-11（司さん）
--
--   ★司さん★「入力画面での 電子決済は 今 まとめとるの 消して ★車毎に 出す★」
--
--   ★前★ dk_day_extras（会社 × 日）に 1つだけ
--   ★今★ ★車ごと★
--     ・走った 車 …… dk_shift_edits（1回の 業務 ＝ 車 × 日）
--     ・走っていない 車 … dk_manual_days（会社 × 日 × 車）
--
--   ★お金の 計算は 1つも 変えていません★
--     月次集計は 今まで通り [{pay_date, invoice_yen, denshi_yen}] を 足すだけ。
--     ★どこから 拾うか★が 変わるだけです。
--
--   ★前に 入れた 分は 消えません★
--     dk_day_extras は ★そのまま 残します★（読むのも 続けます）。
--     ⇒ 実測（2026-09-11）… dk_day_extras は ★0行★＝まだ 誰も 入れていない。
--
--   ★両方の 倉庫に 当てます★（本番 tnfwipbgfgjaymlszeid ／ テスト khawdrnvssdenumbiwfg）
-- ============================================================

-- ── ① 走った 車ぶん ──────────────────────────────
alter table daikome.dk_shift_edits
  add column if not exists denshi_yen integer;

-- ── ② 走っていない 車ぶん ────────────────────────
alter table daikome.dk_manual_days
  add column if not exists denshi_yen double precision;

-- ── ③ 受け皿（view）に 出す ──────────────────────
--    ★列を 名指ししている ので 作り直しが 要ります★
--    ★security_invoker は 作り直すと 消える ので 必ず 付け直す★
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
  expenses,
  denshi_yen
from daikome.dk_shift_edits;

alter view public.dk_shift_edits set (security_invoker = true);

create or replace view public.dk_manual_days as
select
  company_id,
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
  expenses,
  denshi_yen
from daikome.dk_manual_days;

alter view public.dk_manual_days set (security_invoker = true);
