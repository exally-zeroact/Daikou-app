-- ============================================================
-- 事務所が メーターの 売上を 直せる 様に する（列）2026-10-14
--
--   司さん「赤丸の売上の数も任意でユーザーが修正できるようにしとけよ」（給料の 時数を入れる 画面）
--   司さん「請求書や給料のとこの売上かえたら変えた最後のやつで合わせろや」
--   司さん「（払い終えた 期も）変わるようにしろや」
--
--   足す 列（dk_shift_edits＝1回の 業務ごと）
--     uriage_yen … 事務所が 直した 売上（実費を 引く 前）。null＝メーターの まま（dk_shifts.fare_total_yen）
--     uriage_at  … 直した 時刻（表示 だけ に 使う。勝ち負けの 判じには 使わない）
--
--   「最後に 直した 方」は 出来事の 順で 決める（時刻や 値で 比べない＝対立役 10-14）
--     ・給料の 画面で 直す → uriage_yen に 入る（これが 勝つ）
--     ・請求書の 一覧で 直す → dk-fix-fare が dk_shifts.fare_total_yen を 直し、
--       同じ 業務の uriage_yen を null に 戻す（請求書の 方が 勝つ）
--     ・運転手の 端末の 送り直し（dk-sync-jobs）は uriage_yen を 触らない
--   元データ（dk_shifts / dk_trips）は この 列の 為に 書かない。
--
--   窓（public の view）は 列を 最後に 足す（create or replace は 末尾に 足すのだけ 許される）
--     テスト・本番の 今の 並び（2026-10-14 実測 information_schema・両方 同じ）：
--       shift_id,company_id,toll_yen,bridge_yen,other_yen,other_label,note,updated_at,hours,
--       expenses,denshi_yen,seikyu_yen
--   security_invoker は 付け直す／何度 流しても 同じ
--   負の 数を 倉庫で 止める check は 付けない（add constraint は 2回目で 落ちる＝何度 流しても 同じ に ならない。
--   $do$ の 塊は SQL の 門が 通さない）。負・小数・字は 画面と 読む 関数（UriageAgg.uriageOf）が 止める
--
--   本人の 給料の 画面（dk_kyuryo_get の edits）にも 同じ 列を 出す（apply-kyuryo-honnin-kansuu.sql）。
--   ★この 紙と 同じ 1回の 送りで 当てる★（片方だけ 当たると 事務所と 本人で 給料が ずれる）
-- ============================================================

alter table daikome.dk_shift_edits
  add column if not exists uriage_yen integer;

alter table daikome.dk_shift_edits
  add column if not exists uriage_at timestamptz;

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
  denshi_yen,
  seikyu_yen,
  uriage_yen,
  uriage_at
from daikome.dk_shift_edits;

alter view public.dk_shift_edits set (security_invoker = true);
