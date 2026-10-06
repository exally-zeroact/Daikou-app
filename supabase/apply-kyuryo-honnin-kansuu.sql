-- ============================================================
-- ★★従業員が 自分の 給料明細を 見る（倉庫の 関数）★★ 2026-09-03
--
--   ★作り方は Rakunally から 借りました★
--     元 … rakually-test の RPC（meisai_set_password / meisai_verify / get_meisai）
--     ★パスワードは 倉庫の 中で 照合する★＝画面に ハッシュを 出さない・外へ 出さない。
--
--   ★★給料の 計算は ここに 1つも 書きません★★
--     ここは ★その人の 材料（勤務・時数・設定・車の札）を 返すだけ★。
--     計算は ★js/payroll-daily.js（事務所の 画面と 同じ 1か所）★が やります。
--     ⇒ ★決まりを 2か所に 書かない★（片方だけ 直って 金額が ずれるのを 防ぐ）
--
--   ★3本だけ★
--     ① dk_kyuryo_pw_set   … 初回コードで 本人を 縛り、自分の パスワードを 決める
--     ② dk_kyuryo_verify   … パスワードが 合っているか（名前だけ 返す）
--     ③ dk_kyuryo_get      … その人の 材料を 返す（★自分の分だけ★）
--
--   ★守り★
--     ・★token と パスワードの 両方★が 合わないと 何も 返さない
--     ・★他の人の 行は 1行も 返さない★（employee_id で 絞る）
--     ・security definer ＝ RLS を 越えるが ★引数で 絞った 自分の分だけ★
--     ・★search_path を 固定★（差し替え防止）
-- ============================================================

create extension if not exists pgcrypto;

-- ① 初回コードで 本人を 縛り、自分の パスワードを 決める
create or replace function public.dk_kyuryo_pw_set(p_token text, p_init text, p_pw text)
returns json
language plpgsql
security definer
set search_path = daikome, public, extensions
as $fn$
declare
  r daikome.dk_kyuryo_pub;
begin
  if p_pw is null or length(p_pw) < 8 then
    return json_build_object('ok', false, 'reason', 'pw_short');
  end if;
  select * into r from daikome.dk_kyuryo_pub where token = p_token;
  if not found then
    return json_build_object('ok', false, 'reason', 'no_token');
  end if;
  if r.init_code is null then
    return json_build_object('ok', false, 'reason', 'already_set');
  end if;
  if r.init_code <> p_init then
    return json_build_object('ok', false, 'reason', 'bad_init');
  end if;
  update daikome.dk_kyuryo_pub
     set pw_hash = crypt(p_pw, gen_salt('bf')),
         init_code = null,
         consent_at = coalesce(consent_at, now()),
         updated_at = now()
   where token = p_token;
  return json_build_object('ok', true);
end;
$fn$;

-- ② パスワードが 合っているか（名前だけ 返す）
create or replace function public.dk_kyuryo_verify(p_token text, p_pw text)
returns json
language plpgsql
security definer
set search_path = daikome, public, extensions
as $fn$
declare
  r daikome.dk_kyuryo_pub;
  nm text;
begin
  select * into r from daikome.dk_kyuryo_pub where token = p_token;
  if not found or r.pw_hash is null then
    return json_build_object('ok', false, 'reason', 'no_token');
  end if;
  if r.pw_hash <> crypt(p_pw, r.pw_hash) then
    return json_build_object('ok', false, 'reason', 'bad_pw');
  end if;
  select e.name into nm from daikome.dk_employees e where e.employee_id = r.employee_id;
  return json_build_object('ok', true, 'name', coalesce(nm, ''));
end;
$fn$;

-- ③ その人の 材料を 返す（★自分の分だけ★・給料の 計算は しない）
create or replace function public.dk_kyuryo_get(p_token text, p_pw text, p_from date, p_to date)
returns json
language plpgsql
security definer
set search_path = daikome, public, extensions
as $fn$
declare
  r daikome.dk_kyuryo_pub;
begin
  select * into r from daikome.dk_kyuryo_pub where token = p_token;
  if not found or r.pw_hash is null then
    return json_build_object('ok', false, 'reason', 'no_token');
  end if;
  if r.pw_hash <> crypt(p_pw, r.pw_hash) then
    return json_build_object('ok', false, 'reason', 'bad_pw');
  end if;
  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 400 then
    return json_build_object('ok', false, 'reason', 'bad_range');
  end if;

  return json_build_object(
    'ok', true,
    -- ★自分の 1行だけ★（他の人は 返さない）
    'emp', (
      select to_jsonb(e) from daikome.dk_employees e where e.employee_id = r.employee_id
    ),
    'settings', (
      select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
      from daikome.dk_payroll_settings s where s.company_id = r.company_id
    ),
    'labels', (
      select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
      from daikome.dk_device_labels l where l.company_id = r.company_id
    ),
    -- ★★売上から 何を 引くか（会社の 設定）★★ 2026-10-02 夜（対立役が 見つけた）
    --   前は 返していなかった＝本人の 画面は ★既定（高速・橋を 引く／その他は 引かない）★ で 計算し、
    --   事務所は dk_sales_settings を 読む ⇒ ★会社が 設定を 変えると 本人と 事務所で 給料が ずれる★
    --   （本物の 計算に 通して：既定 8,000円 ／「何も 引かない」 8,835円）
    'salesSettings', (
      select to_jsonb(x) from (
        select ss.deduct_toll, ss.deduct_bridge, ss.deduct_other, ss.other_label
        from daikome.dk_sales_settings ss where ss.company_id = r.company_id
        limit 1
      ) x
    ),
    -- ★勤務は 会社ぶん 要ります★（売上の 分け方が「みんなの売上」を 使うので）
    --   ★ただし 返すのは 金額と 距離と 端末だけ★（人の 名前は 上の emp だけ）
    'shifts', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select sh.shift_id, sh.device_id, sh.started_at, sh.ended_at, sh.elapsed_sec,
               sh.total_distance_m, sh.actual_total_m, sh.empty_distance_m,
               sh.fare_total_yen, sh.trip_count, sh.excluded
        from daikome.dk_shifts sh
        where sh.company_id = r.company_id
          and (sh.started_at at time zone 'Asia/Tokyo')::date between p_from and p_to
      ) x
    ),
    -- ★★2026-10-02 直し＝★会社全部の 行を 列ごと 丸ごと 返していた★★★
    --   to_jsonb(行) は ★列を 全部★ 出す。画面に 出ない だけで 本人の 端末には 届いていた：
    --     dk_work_hours   … ★同僚の employee_id と 時間★
    --     dk_shift_edits  … ★同僚の 備考(note)・その他の 名前★
    --     dk_manual_days  … ★備考(note)★
    --   ★何が 要るかは 計算の 字で 数えた★
    --     ・edits      … 車ごとの 売上から 引く 額（uriage-agg.js deductOf）と 時数（carHoursOf）
    --                    ＝ shift_id / toll_yen / bridge_yen / other_yen / expenses / hours
    --                    ★みんなの売上に 効くので 行は 会社ぶん 要る★（列だけ 絞る）
    --     ・manualDays … 車ごとの 売上・時数・実費（payroll-daily.js buildCtx）
    --                    ★これも 行は 会社ぶん 要る★（列だけ 絞る）
    --     ・workHours  … ★本人の 分だけで よい★。buildCtx は empById に 居ない 人を
    --                    `if (!emp) return` で 読み捨てる。本人の 画面の empById は 本人 1人。
    --                    時給の 割り方（poolHours）は 車の 時数から 出す（daiko-payroll.js buildPool）
    --                    ＝★絞っても 金額は 1円も 変わらない★
    'edits', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select ed.shift_id, ed.toll_yen, ed.bridge_yen, ed.other_yen, ed.expenses, ed.hours
        from daikome.dk_shift_edits ed where ed.company_id = r.company_id
      ) x
    ),
    'workHours', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select w.work_date, w.employee_id, w.device_id, w.hours
        from daikome.dk_work_hours w
        where w.company_id = r.company_id
          and w.employee_id = r.employee_id
          and w.work_date between p_from and p_to
      ) x
    ),
    -- ★★その日 その車に 乗った 人の 役だけ★★ 2026-10-06（司さん「回数距離は1台としてやろが」）
    --   回数・距離の 1台の 額を 乗った 人で 分けるのに 相方の 役が 要る。★名前・ID・時間は 返さない★
    'crew', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select w.work_date, w.device_id, jsonb_agg(coalesce(e.role, '') order by e.role) as roles
        from daikome.dk_work_hours w
        join daikome.dk_employees e on e.employee_id = w.employee_id and e.company_id = w.company_id
        where w.company_id = r.company_id
          and w.work_date between p_from and p_to
          and w.device_id is not null
          -- ★本人が 乗った 車と 日だけ★（他の 車の 乗り方は 返さない・対立役 10-06）
          and exists (
            select 1 from daikome.dk_work_hours w2
            where w2.company_id = r.company_id and w2.employee_id = r.employee_id
              and w2.work_date = w.work_date and w2.device_id = w.device_id
          )
        group by w.work_date, w.device_id
      ) x
    ),
    -- ★★自分の 手当・控除だけ★★ 2026-10-06（司さん「ア」）＝他の 人の 行は 返さない
    'adjustments', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select a.work_date, a.employee_id, a.kind, a.label, a.yen
        from daikome.dk_pay_adjustments a
        where a.company_id = r.company_id
          and a.employee_id = r.employee_id
          and a.work_date between p_from and p_to
      ) x
    ),
    'manualDays', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select m.work_date, m.device_id, m.sales_yen, m.hours,
               m.toll_yen, m.bridge_yen, m.other_yen, m.trip_count,
               -- ★距離★ 2026-10-06（距離歩合の 材料＝事務所の 画面と 同じ 額に する）
               m.actual_total_m, m.total_distance_m
        from daikome.dk_manual_days m
        where m.company_id = r.company_id and m.work_date between p_from and p_to
      ) x
    )
  );
end;
$fn$;

-- ★誰が 呼べるか★ … ログインしていない 人（anon）も 呼べる必要が 在る（本人は URL で 来る）。
--   ★token＋パスワードが 合わないと 何も 返さない★のが 守り。
grant execute on function public.dk_kyuryo_pw_set(text, text, text) to anon, authenticated;
grant execute on function public.dk_kyuryo_verify(text, text) to anon, authenticated;
grant execute on function public.dk_kyuryo_get(text, text, date, date) to anon, authenticated;
