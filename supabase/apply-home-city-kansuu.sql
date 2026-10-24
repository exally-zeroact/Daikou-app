-- ============================================================
-- ★★地元の市（home_city）を 持ち主が 保存する 関数★★ 2026-10-24
--
--   ★今の 穴★
--     会社設定の「地元の市」は 窓（public.dk_companies）へ PATCH・return=minimal・r.ok だけで
--     「保存しました」と 出していた。ところが dk_companies には ★持ち主の update の policy が 無い★
--     （schema-license-account.sql：止めた 会社が status を 自分で 戻せない様に わざと 作っていない）。
--     書けるのは 運営（is_dk_admin）だけ＝運営で ない 持ち主は RLS で 0行・204＝★出るのに 何も 変わらない★。
--     運営の 口座で 試すと 書けるので 緑に 見えていた。
--     （テストの 倉庫で 測った：運営で ない 持ち主の 窓への update＝0行・運営＝1行）
--
--   ★直し方★ 持ち主の update の 口は ★開けない★（開けると status も 書ける）。
--     home_city の 1列だけを 書く 関数を 置く。
--     ・自分の 会社か（owner_id = auth.uid()）を 中で 確かめる。違えば 何も 書かず 0
--     ・書くのは home_city だけ（status・seat_limit・name 等は 触らない）
--     ・前後の 空白を 落とす。空なら null（＝今治市あつかい）。長すぎる（40字超）は 書かず 0
--     ・★返り値＝書けた 行の 数（0 か 1）★ 画面は 1 の 時だけ「保存しました」
--
--   ★守り★ security definer ＋ search_path 固定。anon・PUBLIC には 呼ばせない（authenticated だけ）
--   ★当て方★ node scripts/apply-home-city-kansuu.mjs --ateru（テスト線）
--   ★確かめ★ node tests/db-tameshi/tameshi-rollback.mjs <repo> tests/db-tameshi/home-city.rollback.sql
-- ============================================================

create or replace function public.dk_set_home_city(p_company uuid, p_city text)
returns integer
language plpgsql
security definer
set search_path = daikome, public, extensions
as $fn$
declare
  v text := nullif(btrim(coalesce(p_city, ''), ' ' || chr(9) || chr(10) || chr(13) || chr(12288)), '');
  n int := 0;
begin
  if auth.uid() is null then
    return 0;
  end if;
  if v is not null and char_length(v) > 40 then
    return 0;
  end if;
  update daikome.dk_companies c
     set home_city = v
   where c.company_id = p_company
     and c.owner_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function public.dk_set_home_city(uuid, text) from public, anon;
grant execute on function public.dk_set_home_city(uuid, text) to authenticated;
