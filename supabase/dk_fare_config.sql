-- ============================================================
-- ★★料金表の 棚（Firebase → Supabase の 引っ越し）★★ 2026-08-30
--   ★司さんの指示★「なんでFirebaseにあるんど 全部Supabaseに引越ししたろが」
--                   「★Firebaseは2度と使うな★」「引っ越しもしろよ」
--
--   ★何を 引っ越すか★
--     Firebase の `fare_config/default`（1件だけ・上書きのみ・戻せない）
--     → Supabase の `public.dk_fare_config`
--
--   ★引っ越しで 良くなる事★
--     ①★倉庫が 1つに なる★（片方が 止まったら 片方だけ 死ぬ、を 無くす）
--     ②★会社ごとに 持てる★（今は 全社 共通の 1件だけ）
--     ③★変えた記録が 残る★（今は 上書き 1件だけ＝★間違えても 戻せない★）
--
--   ★お金に 直結する棚★です。値は ★1円も 変えません★:
--     2026-08-30 に Firebase から 読んだ 実物と ★同じ値★を 入れます
--       base_fare 1300 ／ base_distance_m 1000 ／ add_fare 100 ／ add_distance_m 420
--       rounding 1 ／ version 2 ／ 夜間・週末・冬・待ち＝全部 OFF
-- ============================================================

create table if not exists public.dk_fare_config (
  company_id   uuid        not null references public.dk_companies (company_id) on delete cascade,
  config       jsonb       not null,
  updated_at   timestamptz not null default now(),
  updated_by   text,                      -- 誰が 変えたか（事務所の ログインの メール）
  primary key (company_id)
);

comment on table public.dk_fare_config is
  '料金表（会社ごと）。2026-08-30 に Firebase fare_config/default から 引っ越し。★Firebaseは2度と使わない★';

-- ★変えた記録（戻せるように・いつ/誰が/前/後 を 丸ごと）★
--   ★丸ごと★にする理由: 差分だと 戻す時に 組み立て直しが 要り、そこで 間違えます。
--   料金表は 小さい（数百バイト）ので 丸ごとで 困りません。
create table if not exists public.dk_fare_config_history (
  id           bigserial   primary key,
  company_id   uuid        not null references public.dk_companies (company_id) on delete cascade,
  changed_at   timestamptz not null default now(),
  changed_by   text,
  before_config jsonb,                    -- 変える前（初回は null）
  after_config  jsonb       not null,     -- 変えた後
  is_revert    boolean     not null default false  -- 戻した物か
);

create index if not exists dk_fare_config_history_company_idx
  on public.dk_fare_config_history (company_id, changed_at desc);

comment on table public.dk_fare_config_history is
  '料金表を 変えた記録。★戻せるように 前と後を 丸ごと 残す★。戻すのも 1件として 残す';

-- ★鍵（RLS）★: 会社の 持ち主だけが 読み書きできる
alter table public.dk_fare_config enable row level security;
alter table public.dk_fare_config_history enable row level security;

drop policy if exists dk_fare_config_own on public.dk_fare_config;
create policy dk_fare_config_own on public.dk_fare_config
  for all
  using (
    company_id in (select company_id from public.dk_companies where owner_id = auth.uid())
  )
  with check (
    company_id in (select company_id from public.dk_companies where owner_id = auth.uid())
  );

drop policy if exists dk_fare_config_history_own on public.dk_fare_config_history;
create policy dk_fare_config_history_own on public.dk_fare_config_history
  for all
  using (
    company_id in (select company_id from public.dk_companies where owner_id = auth.uid())
  )
  with check (
    company_id in (select company_id from public.dk_companies where owner_id = auth.uid())
  );
