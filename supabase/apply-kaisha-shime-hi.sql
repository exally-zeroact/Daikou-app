-- ============================================================================
-- ★★会社の 締め日（dk_sales_settings.kaisha_shime_hi）★★ 2026-10-24
--
--   司さん「会社の締め日も決めれるようにしとかないかんな」
--         「締め日は給料やなくて会社の締めのことな。給料は給料のとこで設定できるやろが」
--
--   ▼置き場（叩き役 K-1）
--     dk_companies には 持ち主の 更新の 口が 無い（開けると 止めた 会社が 自分で 戻せる＝開けない）。
--     持ち主の 更新の 決まり（dk_sales_settings_owner_upd）が 在る dk_sales_settings に 列を 足す。
--   ▼値
--     null＝末日（既定・今まで 通りの 暦の 月）／1〜28＝その 日で 締める（29〜31 は 2月が 割れる＝置かない）
--     月 → 期間の 決まりは js/kaisha-kikan.js の 1か所。
--   ▼窓（叩き役 K-2）
--     public の 窓は 列を 並べて 書いている ⇒ 列を 足して 作り直し、security_invoker=true を 付け直す
--     （create or replace view は security_invoker を 落とす）。紙は supabase/windows-public.sql と 揃える。
--   ▼足すだけ（消す・書き換えるは 無し・データは 1行も 触らない）
--   当て方：node scripts/apply-supabase-sql.mjs supabase/apply-kaisha-shime-hi.sql（テスト線の 倉庫）
--           本番は --honban を 付けた 時だけ（指示役が 当てる）
-- ============================================================================

alter table daikome.dk_sales_settings
  add column if not exists kaisha_shime_hi smallint
    constraint dk_sales_settings_kaisha_shime_hi_ck
      check (kaisha_shime_hi is null or kaisha_shime_hi between 1 and 28);

comment on column daikome.dk_sales_settings.kaisha_shime_hi is
  '会社の 締め日（null＝末日・1〜28）。月次集計・売上表の 月の 期間（20日締めの 10月＝9/21〜10/20）。2026-10-24';

create or replace view public.dk_sales_settings
  with (security_invoker = true) as
  select company_id, deduct_toll, deduct_bridge, deduct_other, other_label, updated_at,
         kaisha_shime_hi
    from daikome.dk_sales_settings;
alter view public.dk_sales_settings set (security_invoker = true);
