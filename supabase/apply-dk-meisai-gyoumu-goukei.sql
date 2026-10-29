-- ★請求書アプリの 明細の 業務ごとの 合計（入力の 請求書の 欄の メーターの 額）★ 2026-10-30
--   司さん 10-29「入力の自動反映されてる項目でメーターの方で請求書押してるんやから請求書も自動で反映されるようにしろ」
--         「代行請求書アプリの方を修正しても事務所の方に反映されるようにしろ」
--   ・元＝メーターで 請求書を 押した 乗車が dk-sync-jobs で 入った 明細（extra.dk_ref＝端末:業務開始ms:何本目）
--     ＝請求書アプリで 直した 額・消した 行が そのまま 入る（dk_trips を 元に すると 直し 7件・消し 34件が 入らない・本番 10-30 実測）
--   ・生きている 行（deleted_at is null）の amount を 業務（daikome.dk_shifts）と 明細の 日 ごとに 足す
--   ・業務との 結び＝端末・業務開始の ms（切り捨て）・★明細の 持ち主＝会社の 持ち主★（別の 会社の 業務に 混ざらない）
--   ・dk_ref の 形が 崩れた 行・桁が 多すぎる 行は 数えない（bigint の 溢れで 窓ごと 落とさない）
--   ・security_invoker＝見る 人の 権限で 動く＝daikou.meisai（own）と daikome の 表の RLS が 効く
--     （anon は 0行＝今の 窓 dk_meisai_hi_goukei と 同じ。revoke は 門番 sql-guard が 許さない）
--   ・請求書アプリの 表（daikou.meisai）と ダイコメの 表は 触らない＝読むだけ
create or replace view public.dk_meisai_gyoumu_goukei as
SELECT s.shift_id,
    m.date,
    sum(m.amount)::bigint AS goukei,
    count(*)::integer AS kensuu
   FROM daikou.meisai m
     JOIN daikome.dk_shifts s
       ON s.device_id::text = split_part(m.extra ->> 'dk_ref', ':', 1)
      AND floor(extract(epoch from s.started_at) * 1000)::bigint =
          (CASE WHEN (m.extra ->> 'dk_ref') ~ '^[^:]+:[0-9]{1,15}:[0-9]{1,9}$'
                THEN split_part(m.extra ->> 'dk_ref', ':', 2)::bigint END)
     JOIN daikome.dk_companies c
       ON c.company_id = s.company_id
      AND c.owner_id = m.user_id
  WHERE m.deleted_at IS NULL
    AND (m.extra ->> 'dk_source') = 'daikome'
    AND (m.extra ->> 'dk_ref') ~ '^[^:]+:[0-9]{1,15}:[0-9]{1,9}$'
  GROUP BY s.shift_id, m.date;
alter view public.dk_meisai_gyoumu_goukei set (security_invoker = true);
grant select on dk_meisai_gyoumu_goukei to authenticated;
