-- ★現金に 戻した 代行の 明細の 行を「端末が 外した」記録（2026-10-12）★
--   dk-sync-jobs が、運転手が 乗車の 直しで 請求書払い→現金 に した 代行の 明細（daikou.meisai）を
--   deleted_at で 外す 時に、ここへ 行の id を 残す。請求書払いに 戻った 時は ここに 在る 行だけ 戻す
--   （事務所が 消した 行は 生き返らせない）。
--   印を meisai.extra に 置かないのは、請求書アプリの 保存（meisaiToDb）が extra を 丸ごと
--   作り直して 消すため＝消えると 戻せない 行に なる。
--   ★誰にも 開けない★：部屋（daikome）の 表は RLS 有効・方針 0本。anon／authenticated には
--   表にも 窓にも 何も 渡さない。読み書きするのは service_role の Edge Function だけ。
create table if not exists daikome.dk_meisai_hazushi (
  meisai_id uuid primary key,
  dk_ref text not null,
  hidden_at timestamptz not null default now()
);
alter table daikome.dk_meisai_hazushi enable row level security;
revoke all on daikome.dk_meisai_hazushi from anon, authenticated;
grant select, insert, update, delete on daikome.dk_meisai_hazushi to service_role;

create or replace view public.dk_meisai_hazushi as
SELECT meisai_id,
    dk_ref,
    hidden_at
   FROM daikome.dk_meisai_hazushi;
alter view public.dk_meisai_hazushi set (security_invoker = true);
revoke all on public.dk_meisai_hazushi from anon, authenticated;
grant select, insert, update, delete on public.dk_meisai_hazushi to service_role;
