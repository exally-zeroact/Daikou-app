-- ============================================================
-- ★★実費の「消す」を 押したら 一覧から 消えるように する★★ 2026-09-18
--
--   ★司さん★「消す押したら一覧から消えるようにしろや」
--
--   ★今まで（何も 起きないように 見えた）★
--     「消す」＝ active=false を 書くだけ ⇒ ★一覧には 残り、使う の ✓ が 外れるだけ★
--     ＝★「使う」の チェックを 外すのと 全く 同じ★動き。だから 押しても 消えない。
--
--   ★★行を 本当に 消しては いけない（訳は 下の 実測）★★
--     ★2026-09-18 実測★ 売上を 出すのは js/uriage-agg.js の deductOf()。
--       ★記録に 入っている 金額（edit.expenses の キー）を そのまま 足している★
--       ＝★実費の 名前の 一覧を 1度も 見ていない★。売上表・給料・月次集計 ★3つとも この1本★。
--     ⇒ だから ★一覧から 消しても 昔の 売上は 動かない★（司さん「売上が変わらんようにしろやぼけ」）。
--     ⇒ ただし ★行ごと delete すると 名前が 引けなくなる★（後から 何の 実費か 読めない）。
--       ＝★隠すだけ（deleted_at）★に する。
--     ※ js/jippi-hozon.js の goukei() は ★どこからも 呼ばれていない★（uriage.html の
--       jippiGoukei も 呼ばれていない 死んだ 皮）。★お金の 道では ない★。
--
--   ★やり方★
--     ★deleted_at★ を 足す（null＝生きている）。
--       ・会社設定の 一覧 … deleted_at が 在る 行は ★出さない★
--       ・入力（nyuryoku）  … 「消す」は active=false も 一緒に 書くので ★今の 絞りで 消える★
--       ・売上（uriage）    … ★絞らない（select=*）★＝★過去の 金額は 今までどおり 引かれる★
--
--   ★窓（public の view）を 必ず 付け直す★
--     ★create or replace view は security_invoker を 落とす★
--     （2026-09-06 に 忘れて ★保存が 2週間 死んだ★）⇒ 下で 付け直している。
--     ★新しい 列は 一番 後ろに 足す★（create or replace view の 決まり）
-- ============================================================

alter table if exists daikome.dk_expense_kinds
  add column if not exists deleted_at timestamptz;

-- ─── 窓（public）を 作り直す ★security_invoker を 付け直す事★ ───────
create or replace view public.dk_expense_kinds
  with (security_invoker = true) as
  select company_id, kind_id, label, sort_order, active, updated_at, deleted_at
    from daikome.dk_expense_kinds;

-- ============================================================
-- ★★戻せるか（2026-09-18 ★試験の倉庫で 実測★・当て推量では ない）★★
--
--   ★結論＝戻せます。ただし ★戻す方が 当てるより 危ない★ ので、
--     困った時は ★戻さずに そのまま 置く★のが 一番 安全です。★置いても 害が 無い★（下の 理由）。
--
--   ①列（deleted_at）… `alter table … drop column deleted_at` で 戻せる
--       ・消えるのは ★どの行を 隠したか★ だけ ⇒ 隠した 物が 一覧に 戻って くる
--       ・★お金は 1円も 動かない★＝売上の 引き算は deleted_at を 見ていない
--   ②窓（public.dk_expense_kinds）… ★`create or replace view` では 戻せません★
--       ★実測★ 列を 減らした create or replace ⇒ `ERROR: 42P16: cannot drop columns from view`
--       ⇒ 戻すには ★drop view → create view★ が 要る
--       ★実測★ public の 窓は drop→create しても authenticated の 権限が ★7個 戻る★
--              （Supabase の 既定の 権限が 付き直す）＝権限が 消えっぱなしには ならない
--       ただし ★drop している 一瞬は 窓が 無い★＝その間の 読み書きは 落ちる
--
--   ★だから 戻さない方が 良い 理由★
--     deleted_at が 余分に 在っても ★古い コードは select=* で 無視するだけ★＝害が 無い。
--     ⇒ ★前に 進むのは 安全（足すだけ）／戻すのは 一瞬 窓が 消える★。
--
-- ★★当てた 後に 必ず 押す（字を 書いただけで 終わりに しない）★★
--   select c.relname, c.reloptions
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'dk_expense_kinds';
--   ⇒ ★reloptions に security_invoker=true が 在る事★を 目で 見る。
--     ★無ければ RLS を すり抜けて 他人の 実費が 見えます★（2026-09-06 に 2週間 死んだ 所）
--   当てる前の 実測（2026-09-18）… dk_expense_kinds / dk_shift_edits とも ★security_invoker=true★
-- ============================================================
