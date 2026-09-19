-- ============================================================
-- ★★較正の 控えを 雲に 置く（車ごとの 席に ぶら下げる）★★ 2026-09-19
--
--   ★司さん★「車ごとに出さな何のために較正しよんど」
--             「今のが壊れんようにきっちりやれや」
--
--   ★何が 困っていたか（実測 2026-09-19）★
--     較正は ★車（VIN）ごと★ … index.html「VINキーで localStorage 保存」
--       （タイヤ円周比・1km学習K＝タイヤを 替えたら 再較正 する 管理項目）
--     ところが ★倉庫に 車の表も 較正の表も 1つも 無かった★（daikome の 20表 全部 見た）
--     ⇒ スマホの データを 消すと ★較正が 丸ごと 消え、走って 取り直し★。
--
--   ★どう する か★
--     ・車の 一覧（localStorage の dk_veh_list）を ★そのまま 1つの かたまりで★ 預かる
--     ・鍵は ★device_id（＝席＝車）★。2026-09-19 に URL を 車ごとに したので
--       ★その車の URL を 開く＝同じ席＝同じ 較正★ に 繋がる
--
--   ★★「今のが 壊れない」為の 決まり（ここが 一番 大事）★★
--     ①★戻すのは 手元に 1台も 無い 時だけ★。
--       1台でも 在れば ★何も しない★＝今 動いている 端末は ★1バイトも 変わらない★。
--     ②★中身を 作り変えない★＝預かった 物を ★そのまま★ 返す。
--       （tireRatio と k は ★距離に 掛け算される★。計算し直したら 距離が 動く）
--     ③★距離・料金の コードには 一切 触らない★
--
--   ★窓（public の view）を 必ず security_invoker で 貼る★
--     （2026-09-06 に 忘れて ★保存が 2週間 死んだ★）
-- ============================================================

create table if not exists daikome.dk_vehicle_backup (
  company_id  uuid        not null references daikome.dk_companies (company_id) on delete cascade,
  device_id   text        not null,
  cars        jsonb       not null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, device_id)
);

alter table daikome.dk_vehicle_backup enable row level security;

-- ★自分の 会社の 物だけ★（他の 決まりと 同じ 形に 揃える）
--   ★drop policy は 書きません★＝関所（scripts/sql-guard.mjs）が 消す 書き方を 通さない。
--   新しい 棚なので 元から 決まりは 無い。2回目に 当てると ここで 止まるが、
--   ★上の create table / enable rls は if not exists なので 壊れない★。
create policy dk_vehicle_backup_rw on daikome.dk_vehicle_backup
  for all
  using (
    company_id in (select c.company_id from daikome.dk_companies c where c.owner_id = auth.uid())
  )
  with check (
    company_id in (select c.company_id from daikome.dk_companies c where c.owner_id = auth.uid())
  );

grant select, insert, update, delete on daikome.dk_vehicle_backup to authenticated;
grant select, insert, update, delete on daikome.dk_vehicle_backup to anon;

-- ─── 窓（public）★security_invoker を 必ず 付ける★ ───────────────
create or replace view public.dk_vehicle_backup
  with (security_invoker = true) as
  select company_id, device_id, cars, updated_at
    from daikome.dk_vehicle_backup;
