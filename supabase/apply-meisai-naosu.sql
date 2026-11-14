-- ============================================================
-- ★★事務所の 入力から 請求書アプリの 明細 1行の 額を 直す＝明細・代行・業務の 合計・事務所の 手打ちを 1つの 取引で★★ 2026-11-14 件⑧b
--
--   司さん（11-14）「お互い修正したら反映されるようにしろ」
--   ＝請求書アプリで 直す（PATCH＋Edge dk-fix-fare）の 逆の 向き。設計 4.1（C:/Users/zeroa/sekkei_nyuryoku_kara_meisai_2026-11-14.md・taiketsu 止め0）
--
--   ★なぜ 倉庫の 関数 1本か★ Edge は 書きを 別々に する＝途中で 落ちると「半分だけ 直った 姿」が 残る（1.x〜3.x で 9回 止められた根）。
--     ここは 1つの 取引＝どこで 落ちても 全部 戻る。送り直し・帯は 作らない。
--
--   ★する事★（dk-fix-fare の ①〜⑥ と 同じ 決まり・比べの 台本 scripts/meisai-naosu-kurabe.mjs が 姿の 一致を 見る）
--     ①明細の 行を 鍵を 取って 読む（無い・人の 物・消えた＝何も しない）
--     ②額が 控え（p_hikae＝画面が 読んだ 額）と 違う＝別の 画面で 直された＝何も しない（chigau）
--     ③dk_ref（端末:業務開始ms:何本目）から 業務と 代行を 探す（その人の 会社の 端末だけ）＝無ければ 何も しない
--     ④明細の amount（0円に した 時は 0円と 決めた 印・請求書アプリ saveEdit と 同じ）⑤代行の fare_yen
--     ⑥業務の 合計（fare_total_yen）⑦その 回の 売上の 手打ち（uriage_yen）を 外す（10-14 の決め）
--     ⑧excluded で なければ 同じ 会社・端末・日本時間の 同じ 日の 回の 請求書の 手打ち（seikyu_yen）を 外す（件⑧a と 同じ）
--
--   ★鍵の 順★ meisai → dk_shifts（FOR NO KEY UPDATE）→ dk_trips → dk_shift_edits（shift_id の 順）
--     ＝同じ 業務の 別の 乗車を 同時に 直しても 合計が 互いを 落とさない（4.0 止め S2）
--   ★距離・件数・料金表・他の 会社の 物には 触らない★。マイナスの 額は 断る（乗車の 料金が 0円 未満は 意味と 逆）。
--   ★守り★ security definer・search_path ''（名前は 全部 書く）・anon と PUBLIC には 呼ばせない（authenticated だけ）
--   直しの 記録（dk_naoshi_kiroku）は request.jwt.claims を 読む＝この 中の 書きも jimusho:<uid> で 残る（11-14 測った）
-- ============================================================

create or replace function public.dk_meisai_naosu(p_meisai_id uuid, p_amount integer, p_hikae integer)
returns json
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_m record;
  v_ref text;
  v_dev text;
  v_ms bigint;
  v_seq integer;
  v_co uuid;
  v_sh record;
  v_trip uuid;
  v_goukei integer;
  v_extra jsonb;
  v_hi date;
  v_ids uuid[];
  n_u integer := 0;
  n_s integer := 0;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'reason', 'no_user');
  end if;
  if p_meisai_id is null or p_amount is null or p_amount < 0 then
    return json_build_object('ok', false, 'reason', 'bad_amount');
  end if;

  -- ① 明細の 行（鍵を 取る＝請求書アプリの 守りつきの 書きと ぶつからない）
  select m.id, m.user_id, m.amount, m.extra, m.deleted_at
    into v_m
    from daikou.meisai m
   where m.id = p_meisai_id
   for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'no_row');
  end if;
  if v_m.user_id is distinct from v_uid then
    return json_build_object('ok', false, 'reason', 'not_yours');
  end if;
  if v_m.deleted_at is not null then
    return json_build_object('ok', false, 'reason', 'deleted');
  end if;
  -- ② 別の 画面で 直されていた
  if v_m.amount is distinct from p_hikae then
    return json_build_object('ok', false, 'reason', 'chigau', 'ima', v_m.amount);
  end if;

  -- ③ ダイコメから 来た 行か・dk_ref の 形（窓 dk_meisai_gyoumu_goukei と 同じ 形）
  v_extra := coalesce(v_m.extra, '{}'::jsonb);
  if (v_extra ->> 'dk_source') is distinct from 'daikome' then
    return json_build_object('ok', false, 'reason', 'not_daikome');
  end if;
  v_ref := v_extra ->> 'dk_ref';
  if v_ref is null or v_ref !~ '^[^:]+:[0-9]{1,15}:[0-9]{1,9}$' then
    return json_build_object('ok', false, 'reason', 'bad_ref');
  end if;
  v_dev := split_part(v_ref, ':', 1);
  v_ms := split_part(v_ref, ':', 2)::bigint;
  v_seq := split_part(v_ref, ':', 3)::integer;

  select c.company_id into v_co
    from daikome.dk_companies c
   where c.owner_id = v_uid;
  if v_co is null then
    return json_build_object('ok', false, 'reason', 'no_company');
  end if;
  if not exists (
    select 1 from daikome.dk_company_devices d
     where d.company_id = v_co and d.device_id = v_dev
  ) then
    return json_build_object('ok', false, 'reason', 'unknown_device');
  end if;

  -- 業務（端末＋業務開始の 瞬間＝dk-fix-fare の new Date(ms).toISOString() の eq と 同じ）
  select s.shift_id, s.started_at, s.excluded
    into v_sh
    from daikome.dk_shifts s
   where s.company_id = v_co
     and s.device_id = v_dev
     and s.started_at = 'epoch'::timestamptz + v_ms * interval '1 millisecond'
   for no key update;
  if not found then
    return json_build_object('ok', false, 'reason', 'no_shift');
  end if;

  select t.trip_id into v_trip
    from daikome.dk_trips t
   where t.shift_id = v_sh.shift_id and t.seq = v_seq
   for update;
  if v_trip is null then
    return json_build_object('ok', false, 'reason', 'no_trip');
  end if;

  -- ★ここから 書く★（この 先の 失敗は raise＝全部 戻る・return で 返さない）
  -- ④ 明細の 額（0円に した＝0円と 決めた 印・前から 0 なら 触らない・0 で なければ 外す＝saveEdit と 同じ）
  update daikou.meisai m
     set amount = p_amount,
         extra = case
                   when p_amount <> 0 then v_extra - 'ryokin_0_kimeta'
                   when p_hikae is distinct from 0 then v_extra || '{"ryokin_0_kimeta": true}'::jsonb
                   else v_extra
                 end
   where m.id = p_meisai_id;

  -- ⑤ 代行の 額（距離には 触らない）
  update daikome.dk_trips t set fare_yen = p_amount where t.trip_id = v_trip;

  -- ⑥ 業務の 合計（鍵を 取った 後の 別の 文で 数える）
  select coalesce(sum(t.fare_yen), 0)::integer into v_goukei
    from daikome.dk_trips t
   where t.shift_id = v_sh.shift_id;
  update daikome.dk_shifts s set fare_total_yen = v_goukei where s.shift_id = v_sh.shift_id;

  -- 外す 先の 回（その 回＋ excluded で なければ 同じ 車×日本時間の 日の excluded で ない 回）
  if v_sh.excluded is true then
    v_ids := array[v_sh.shift_id];
  else
    v_hi := (v_sh.started_at at time zone 'Asia/Tokyo')::date;
    select array_agg(x.shift_id order by x.shift_id) into v_ids
      from (
        select s.shift_id
          from daikome.dk_shifts s
         where s.company_id = v_co
           and s.device_id = v_dev
           and s.started_at >= (v_hi::timestamp at time zone 'Asia/Tokyo')
           and s.started_at < ((v_hi + 1)::timestamp at time zone 'Asia/Tokyo')
           and s.excluded is not true
        union
        select v_sh.shift_id
      ) x;
  end if;
  perform 1
     from daikome.dk_shift_edits e
    where e.shift_id = any (v_ids)
    order by e.shift_id
    for update;

  -- ⑦ その 回の 売上の 手打ちを 外す（10-14「最後に 直した 方が 勝つ」）
  update daikome.dk_shift_edits e
     set uriage_yen = null, uriage_at = null
   where e.shift_id = v_sh.shift_id
     and e.uriage_yen is not null;
  get diagnostics n_u = row_count;

  -- ⑧ 請求書の 手打ちを 外す（入力の 請求書の 欄は 車×日＝その 日の 回 全部・excluded の 回は 欄に 入らない＝外さない）
  if v_sh.excluded is not true then
    update daikome.dk_shift_edits e
       set seikyu_yen = null
     where e.shift_id = any (v_ids)
       and e.seikyu_yen is not null;
    get diagnostics n_s = row_count;
  end if;

  return json_build_object(
    'ok', true,
    'updated', 1,
    'shift_total', v_goukei,
    'uriage_hazushita', n_u,
    'seikyu_hazushita', n_s
  );
end;
$fn$;

revoke all on function public.dk_meisai_naosu(uuid, integer, integer) from public, anon;
grant execute on function public.dk_meisai_naosu(uuid, integer, integer) to authenticated;

