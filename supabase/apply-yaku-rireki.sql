-- ============================================================
-- ★★役割の 決まり（歩合・最低保証）の「何日から」★★ 2026-10-18（docs/nannichi-kara-yaku.md）
--
--   ★1行＝1つの 役割の 1つの 鍵の「この 日から この 値」★
--     yaku  … 役割の 名前（dk_payroll_settings.roles の 鍵と 同じ 字）
--     key   … 'rate'（歩合）／ 'floor'（最低保証）
--     value … その 日から 次の 記録の 日まで 効く 値（空は 無い）
--   ★記録が 無い 日（一番 古い 記録より 前）は roles の 列の 値★（記録0の 会社は 1円も 違わない）
--   ★roles の 中に 置かない 訳★ 古い 版の 画面（開いた ままの タブ）が 保存すると roles を {rate,floor} に
--     作り直して 記録を 消す（対立役 10-18 止1）。別の 表なら 古い 版は 列だけを 書く。
--   ★unique は deferrable★ 名前の 入れ替え（甲↔乙）を 1つの 文で 直す 時に 途中で ぶつからない
--   ★守り★ 会社の 持ち主だけ 読める／書ける／消せる
--   ★1回だけ 流す★（create policy は 2回目に「もう在る」で 止まる＝それで よい）
-- ============================================================

create table if not exists daikome.dk_yaku_rireki (
  rireki_id   uuid        primary key default gen_random_uuid(),
  company_id  uuid        not null references daikome.dk_companies (company_id) on delete cascade,
  yaku        text        not null check (length(btrim(yaku)) > 0),
  key         text        not null check (key in ('rate', 'floor')),
  from_date   date        not null,
  -- ★0 より 下は 断る★（画面も 断る・倉庫でも 止める＝対立役 10-18 3回目 直4）
  value       numeric     not null constraint dk_yaku_rireki_value_ck check (value >= 0),
  created_at  timestamptz not null default now(),
  constraint dk_yaku_rireki_uq unique (company_id, yaku, key, from_date) deferrable initially immediate
);

alter table daikome.dk_yaku_rireki enable row level security;

create policy dk_yaku_rireki_owner_sel on daikome.dk_yaku_rireki
  for select using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_yaku_rireki_owner_ins on daikome.dk_yaku_rireki
  for insert with check (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_yaku_rireki_owner_upd on daikome.dk_yaku_rireki
  for update using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  ) with check (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

create policy dk_yaku_rireki_owner_del on daikome.dk_yaku_rireki
  for delete using (
    company_id in (select company_id from daikome.dk_companies where owner_id = auth.uid())
  );

grant select, insert, update, delete on daikome.dk_yaku_rireki to authenticated;

create or replace view public.dk_yaku_rireki
  with (security_invoker = true) as
  select rireki_id, company_id, yaku, key, from_date, value, created_at
    from daikome.dk_yaku_rireki;

-- ★窓（public）の 鍵は 書かない★＝public の 窓は 倉庫の 既定の 鍵で 配られる（SQL の 門は public への grant を 止める）
