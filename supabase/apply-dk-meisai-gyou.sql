-- ============================================================
-- ★入力の 画面に 出す 明細の 行（窓 public.dk_meisai_gyou）★ 2026-11-14 件⑧b
--   司さん（11-14）「お互い修正したら反映されるようにしろ」＝入力の 画面で 車×日の 明細を 1行ずつ（日付・お客・金額）出し、
--   直す 時は 関数 public.dk_meisai_naosu（supabase/apply-meisai-naosu.sql）を 呼ぶ。
--   ・読むだけ・security_invoker＝見る 人の 権限＝daikou.meisai（own）と daikome の 表の RLS が 効く（anon は 0行）
--   ・窓 dk_meisai_gyoumu_goukei と 同じ 結び（端末・業務開始 ms・会社の 持ち主＝明細の 持ち主）。生きている 行・ダイコメ発 だけ
create or replace view public.dk_meisai_gyou as
SELECT m.id,
    s.shift_id,
    m.date,
    m.company,
    m.name,
    m.destination,
    m.amount,
    split_part(m.extra ->> 'dk_ref', ':', 3)::integer AS seq
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
    AND (m.extra ->> 'dk_ref') ~ '^[^:]+:[0-9]{1,15}:[0-9]{1,9}$';
alter view public.dk_meisai_gyou set (security_invoker = true);
grant select on dk_meisai_gyou to authenticated;
