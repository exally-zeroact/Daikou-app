// supabase/functions/dk-sync-jobs
// ★メーターの実績(勤務・代行)を受け取って倉庫に入れる (2026-07-31)★
//   事務所機能(売上/請求/給料/集計)の入口。
//
//   入力(POST JSON): { url_token, device_id, shifts:[{ start_time, end_time, ..., trips:[...] }] }
//   出力: { ok:true, accepted:[start_time...] } | { ok:false, reason }
//
//   ▼設計の要点
//     ・会社は url_token で引く(ドライバー端末はログインを持たないため。dk-issue-license と同じ考え方)。
//     ・★その端末が本当にその会社の端末か(dk_company_devices)を必ず確認する★=よそからの書き込みを拒む。
//     ・同じ勤務を何度送られても増えない(冪等)。鍵 = (company_id, device_id, started_at)。
//     ・代行(trip)は勤務ごとに入れ直す(seq で一意)=送り直しで重複しない。
//     ・★未払い(status='off')でもデータは受け取る★。データを人質にしない(締めは別の層でやる)。
//     ・値は一切いじらない。メーターが確定した距離・料金をそのまま保存する。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// ★請求書アプリに入れる行を作る所（テストが同じ物を触れるよう外出し）★
import { buildMeisaiRows, businessDate, planMeisaiWrite } from './meisai-row.js';

const MAX_SHIFTS = 50; // 1リクエストの勤務上限
const MAX_TRIPS = 300; // 勤務1件あたりの代行上限
const MAX_WAYPOINTS = 50;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

function toIso(ms: unknown): string | null {
  if (!isNum(ms) || ms <= 0) return null;
  try {
    return new Date(ms).toISOString();
  } catch (_) {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, 300) : '';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, authorization, apikey',
        'access-control-allow-methods': 'POST, OPTIONS',
      },
    });
  }
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);

  let input: { url_token?: string; device_id?: string; shifts?: unknown[] };
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, reason: 'bad_json' }, 400);
  }

  const url_token = (input.url_token || '').trim();
  const device_id = (input.device_id || '').trim();
  const shifts = Array.isArray(input.shifts) ? input.shifts : [];
  if (!url_token || !device_id) return json({ ok: false, reason: 'missing' }, 400);
  if (!shifts.length) return json({ ok: true, accepted: [] });
  if (shifts.length > MAX_SHIFTS) return json({ ok: false, reason: 'too_many' }, 400);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // 会社を引く(service_role = RLSバイパス)。owner_id は請求書アプリへの橋渡しに使う。
  const { data: co, error: coErr } = await sb
    .from('dk_companies')
    // ★2026-08-09: 地元の市(home_city)も取る★
    //   請求書の行き先を「今治市は落として町名だけ／市外は市名を付ける」で書くため。
    //   空なら meisai-row.js の既定（今治市）が効く。
    .select('company_id, owner_id, home_city')
    .eq('url_token', url_token)
    .maybeSingle();
  if (coErr) return json({ ok: false, reason: 'db_error' }, 500);
  if (!co) return json({ ok: false, reason: 'invalid_url' }, 404);

  // ★その端末がこの会社の端末として登録されているかを確認(よそからの書き込みを拒む)★
  const { data: dev } = await sb
    .from('dk_company_devices')
    .select('device_id')
    .eq('company_id', co.company_id)
    .eq('device_id', device_id)
    .maybeSingle();
  if (!dev) return json({ ok: false, reason: 'unknown_device' }, 403);

  const accepted: number[] = [];
  const meisai: string[] = []; // 請求書アプリへ入れた/入れなかった理由

  for (const raw of shifts) {
    const s = raw as Record<string, unknown>;
    const startedAt = toIso(s?.start_time);
    if (!startedAt) continue; // 識別できない勤務は飛ばす(残りは処理する)

    try {
      // 勤務を入れる/更新する(冪等・鍵は company+device+開始時刻)
      const { data: shiftRow, error: sErr } = await sb
        .from('dk_shifts')
        .upsert(
          {
            company_id: co.company_id,
            device_id,
            started_at: startedAt,
            ended_at: toIso(s.end_time),
            elapsed_sec: isNum(s.elapsed_sec) ? Math.round(s.elapsed_sec) : null,
            total_distance_m: isNum(s.total_distance_m) ? s.total_distance_m : null,
            actual_total_m: isNum(s.actual_total_m) ? s.actual_total_m : null,
            empty_distance_m: isNum(s.empty_distance_m) ? s.empty_distance_m : null,
            fare_total_yen: isNum(s.fare_total_yen) ? Math.round(s.fare_total_yen) : null,
            trip_count: isNum(s.trip_count) ? Math.round(s.trip_count) : null,
          },
          { onConflict: 'company_id,device_id,started_at' }
        )
        .select('shift_id')
        .single();
      if (sErr || !shiftRow) continue;

      // 代行を入れ直す(送り直しでも重複しない)
      const rawTrips = Array.isArray(s.trips) ? (s.trips as Record<string, unknown>[]) : [];
      const trips = rawTrips
        .filter((t) => t && isNum(t.distance_m) && isNum(t.fare_yen))
        .slice(0, MAX_TRIPS)
        .map((t, i) => ({
          shift_id: shiftRow.shift_id,
          company_id: co.company_id,
          seq: isNum(t.seq) ? Math.round(t.seq) : i + 1,
          distance_m: t.distance_m as number, // ★そのまま★
          fare_yen: Math.round(t.fare_yen as number), // ★そのまま(円は整数)★
          // 掛け先(請求書払い)。変な支払区分は現金に倒す。
          customer_id: typeof t.customer_id === 'string' && t.customer_id ? t.customer_id : null,
          customer_name: str(t.customer_name),
          // ★誰が乗ったか(会長/社長/専務など)★ 請求書の備考に入り、そこで小計が分かれる
          customer_note: str(t.customer_note),
          payment_type: t.customer_id && t.payment_type === 'invoice' ? 'invoice' : 'cash',
          started_at: toIso(t.start_time),
          ended_at: toIso(t.end_time),
          start_address: str(t.start_address),
          end_address: str(t.end_address),
          waypoints: Array.isArray(t.waypoints) ? t.waypoints.slice(0, MAX_WAYPOINTS) : [],
        }));

      // 同じ勤務の古い代行を消してから入れる = 件数が減る訂正にも追随できる
      await sb.from('dk_trips').delete().eq('shift_id', shiftRow.shift_id);
      if (trips.length) {
        const { error: tErr } = await sb.from('dk_trips').insert(trips);
        if (tErr) continue; // 代行が入らなかった勤務は「受け取った」と言わない=次回再送
      }

      // ★請求書アプリ(代行請求書)の明細に流し込む (2026-08-01・司さん承認)★
      //   請求書払いの代行だけ。会社を選ばなかった代行(現金)は入れない。
      //   ・重複しない鍵 dk_ref = 端末:勤務開始:何件目 (再送で trip_id が変わっても変わらない)
      //   ・★既に入っている行には一切触らない★=事務所が後から書いた備考/人数を絶対に消さない
      //   ・失敗しても勤務の受け取りは取り消さない(明細は次回の再送で入る)
      //   ★2026-08-05 「なぜ入れなかったか」を返すようにした★
      //     入らない理由が7通りあるのに、全部 return で黙って抜けていたので
      //     ★立てたのに入らない時に、どこで止まったか分からなかった★（実際に踏んだ）。
      //     返事に出しておけば、事務所からでも1回叩けば理由が読める。
      meisai.push(
        await pushToInvoiceApp(
          sb,
          co.owner_id as string | null,
          device_id,
          s,
          trips,
          (co.home_city as string | null) || null // ★地元の市★
        )
      );

      accepted.push(s.start_time as number);
    } catch (_) {
      // この勤務は諦めて次へ(1件の失敗で全部を落とさない)
      continue;
    }
  }

  return json({ ok: true, accepted, meisai });
});

// 代行請求書アプリの `meisai` に、請求書払いの代行を1件1行で入れる。
//   meisai の列: company(会社名) / date / destination(行き先) / amount(金額) / distance(距離) /
//                name(名前) / note(備考) / people(人数) / extra(jsonb・自由項目)
//   ★extra.dk_ref に安定した鍵を入れて二重登録を防ぐ★
async function pushToInvoiceApp(
  sb: ReturnType<typeof createClient>,
  ownerId: string | null,
  deviceId: string,
  shift: Record<string, unknown>,
  trips: Record<string, unknown>[],
  homeCity?: string | null // ★地元の市（空なら既定 今治市）★
): Promise<string> {
  try {
    // ★★既定オフ (2026-08-01)★★
    //   代行請求書アプリは既に実務で使われていて、明細が1000件超入っている。
    //   司さんは今そこへ「手入力」している。自動投入を同時に走らせると★二重になる★。
    //   よって Edge Function secret `DK_MEISAI_AUTOPUSH=1` を明示的に立てるまで何もしない。
    //   (手入力から自動に切り替える、と決めた時に立てる)
    if (Deno.env.get('DK_MEISAI_AUTOPUSH') !== '1') return 'off:自動投入が立っていない';

    if (!ownerId) return 'skip:会社がアカウント登録していない'; // 請求書アプリ側に置き場が無い
    const invoiceTrips = trips.filter((t) => t.payment_type === 'invoice' && t.customer_name);
    if (!invoiceTrips.length) return 'skip:請求書払いの代行が0件';

    const shiftStart = isNum(shift.start_time) ? shift.start_time : 0;
    const refOf = (t: Record<string, unknown>) => `${deviceId}:${shiftStart}:${t.seq}`;
    const refs = invoiceTrips.map(refOf);

    // 既に入っている分を調べる
    //   ★2026-08-05 「飛ばす」から「中身が違えば直す」に変えた★
    //     メーターの履歴で金額や請求先を後から直せるようにしたため、
    //     飛ばすだけだと★請求書アプリだけ古い金額のまま残る★。
    //     直す時に触るのは金額/距離/請求先/日付/行き先だけ。
    //     ★備考・人数・名前は司さんが書いた物なので絶対に触らない★
    const { data: exist } = await sb
      .from('meisai')
      .select('id, extra, company, date, destination, amount, distance')
      .eq('user_id', ownerId)
      .in('extra->>dk_ref', refs);

    // 行を作るのは meisai-row.js（★テストが同じ物を触れるように外に出してある★）
    //
    // ★請求書の日付は「その晩の仕事の日」= 業務開始の日（日本時間）★ 2026-08-05
    //
    //   ★直した穴（司さんの指摘）★
    //     旧: 代行1件ごとの started_at を UTC のまま slice していた。
    //         代行は夜の仕事なので★深夜0時をまたぐと、同じ晩なのに日付が変わる★。
    //         実データで実際に起きていた:
    //           8/4 23:34 の代行 → 8/4  ／  8/5 00:38 の代行 → ★8/5★
    //         ＝★同じ晩の仕事が請求書では2日に分かれる★。
    //         しかも UTC 切りなので、日本時間 朝9時より前は前日の日付になる。
    //     新: ★業務開始(shift.start_time)の日★を日本時間で切って全件に使う。
    //         給料・売上表も同じ切り方（業務開始の日）なので、★3つとも揃う★。
    const bizDate = businessDate(shiftStart as number);
    const rows = buildMeisaiRows({
      ownerId,
      deviceId,
      shiftStartMs: shiftStart as number,
      trips: invoiceTrips,
      homeCity: homeCity || undefined, // ★会社ごとの地元の市★
    });
    if (!bizDate) return 'skip:業務開始の日付が読めない';
    if (!rows.length) return 'skip:入れる代行が0件';

    const plan = planMeisaiWrite(rows, exist || []);
    if (plan.inserts.length) {
      const { error: iErr } = await sb.from('meisai').insert(plan.inserts);
      if (iErr) return 'error:' + String(iErr.message || iErr).slice(0, 120);
    }
    for (const u of plan.updates) {
      const { error: uErr } = await sb.from('meisai').update(u.patch).eq('id', u.id);
      if (uErr) return 'error:直し ' + String(uErr.message || uErr).slice(0, 100);
    }
    if (!plan.inserts.length && !plan.updates.length) return 'skip:変わっていない';
    return 'ok:' + plan.inserts.length + '件入れた/' + plan.updates.length + '件直した';
  } catch (e) {
    // 請求書側で何が起きても、ダイコメの実績受け取りは止めない
    return 'error:' + String((e as Error)?.message || e).slice(0, 120);
  }
}
