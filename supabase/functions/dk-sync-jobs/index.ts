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
// ★★2026-09-29 版を x.y.z まで 固定した★★
//   前は `@2` だった。★ソースが 1バイトも 同じでも、配り直すだけで
//   借り物が 入れ替わる★（実測 2026-09-29: 配ってある 中身は 2.116.0 /
//   今 esm.sh が @2 に 返すのは 2.117.2（9/25 公開））。
//   しかも ★戻す 口が 無い★（/functions/<slug>/versions は 404）。
//   会社の 決まりとも 一致：[[feedback_cdn_version_must_be_pinned]]
//   ★今 動いている 物と 同じ 版に 固定する★（上げるなら 別の日に 測ってから）
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
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

  // ★事務所で 付けた「車の札」を 取る (2026-09-03・司さん)★
  //   請求書アプリの 一覧は extra の dk_car / dk_car_no で ★車ごとに 分けて 早い順★に 並べる。
  //   ★これが 無いと 全部「手で入れた分」に まとめられる★（2026-08-25以降 実際に そうなっていた）。
  //   ★取れなくても 送信は 絶対に 止めない★＝札が 無いだけ（今までどおり 入る）。
  const { data: lbl } = await sb
    .from('dk_device_labels')
    .select('label, sort_order')
    .eq('company_id', co.company_id)
    .eq('device_id', device_id)
    .maybeSingle();
  const carLabel = (lbl?.label as string | null) || null; // 車の名前（例 4987）
  const carNo = (lbl?.sort_order as number | null) ?? null; // 事務所で決めた並び順

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
            // ★★見えなかった分（後から「本当に 走ったか」を 確かめる為）★★ 2026-09-01
            //   ★ここで 落としていました★… 画面側(js/job-sync.js)は 送っていたのに、
            //   この 関数が ★列を 名指しで 組み直す★ので ★黙って 捨てられていました★。
            //   ★料金・距離には 一切 効きません★（記録するだけ・無ければ null）
            mienai_kaisuu: isNum(s.mienai_kaisuu) ? Math.round(s.mienai_kaisuu) : null,
            mienai_byou: isNum(s.mienai_byou) ? s.mienai_byou : null,
            mienai_m: isNum(s.mienai_m) ? s.mienai_m : null,
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
          (co.home_city as string | null) || null, // ★地元の市★
          carLabel, // ★車の名前★ 2026-09-11（渡し忘れていた）
          carNo // ★並び順★
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
  homeCity?: string | null, // ★地元の市（空なら既定 今治市）★
  // ★★2026-09-11 ここが 抜けていました★★
  //   ★2026-09-03 に 車の札を 足した 時、★取る所は 関数の 外・使う所は 中★ に 書いた。
  //   関数の 中からは 外の 変数が 見えない ので
  //   ★請求書へ 入れようと した 瞬間に 必ず 落ちる★。
  //   落ちた 所は「1件 失敗しても 次へ」で 握りつぶされる ので
  //   ★走行データは 今まで通り 入り、明細だけ 黙って 0件★に なっていた。
  //   ⇒ 実測 … 9/3〜9/10 の 請求書払い 24件 45,300円 が 入っていない。
  carLabel?: string | null, // ★車の名前（一覧を 車ごとに 分ける為）★
  carNo?: number | null // ★事務所で 決めた 並び順★
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
    // ★★2026-09-29 対立役に 叩かれて 3つ 直した★★
    //   ①★error を 受ける★ … 前は `const { data: exist } =` だけで 捨てていた。
    //      落ちると exist=null ⇒ 全行 inserts ⇒ ★索引が 1行でも 弾くと 束ごと 失敗★
    //      ⇒ updates も 飛び、しかも 勤務は accepted 済み＝★二度と 送られない★。
    //      書き側の 2箸所は error を 受けているのに ★読み側だけ 非対称★ だった。
    //   ②★人の 絞り（.eq('user_id')）は 外さない★
    //      ★一度 外しかけて 自分で 気づいて 戻した（2026-09-29）★。
    //      `planMeisaiWrite` は ★dk_ref だけ★ で 突き合わせ、直す時は
    //      `update(patch).eq('id', …)` ＝★行の id★ で 書く（user_id は 見ない・patch にも 入らない）。
    //      ⇒ 絞りを 外すと ★A社の 同期が B社の 明細行を 書き換える★ 道が 開く。
    //      索引との 見方の ずれ（索引は 表 全体）は ★下の 1行ずつ insert ＋ 23505 を 数える★
    //      で 受け止める＝★弾かれた行は 飛ばして 数え、残りは 入る★。
    //   ③★note を 取る★ … 下の planMeisaiWrite は cur.note を 見るのに 取っていなかった。
    //      ⇒ いつも undefined ⇒ ★送るたび 備考を 上書きしに 行く★（司さんの 書いた 備考が 消える）。
    const { data: exist, error: exErr } = await sb
      .from('meisai')
      // ★deleted_at も 取る★2026-09-29：本番実測で dk_ref 付き 150行中 ★32行が 消されていた★。
      //   見ていなかったので ★事務所が 消した 32行に 書きに 行っていた★。
      .select('id, extra, company, date, destination, amount, distance, note, deleted_at')
      .eq('user_id', ownerId)
      .in('extra->>dk_ref', refs);
    // ★★読めなかった時の 振る舞いを 変えた（2026-09-29 対立役の 指摘・私も 数え直した）★★
    //   朝に 書いた `return 'error:…'` は ★永久に 欠ける 口★ だった：
    //     昇で accepted は ★返り値を 見ずに 立つ★（上の 210行・2026-08-01 の 決め）ので、
    //     読みが 1回 落ちた 晚の 勤務は ★明細が 空の まま 確定★ に なる。
    //   ★なぜ 今は 止めなくて 良いか★
    //     「二重を 作るより…」と 書いたのは ★一意の 索引が 無かった 頃の 話★。
    //     今は `meisai_dk_ref_uniq`（daikou.meisai の extra->>'dk_ref'）が
    //     本番・テスト 両方に ★当て済み★ なので、二重は DB が 弾く。
    //   ⇒ ★読めなくても 先へ 進む★：全行を insert に 落とし、既に 在る行は 23505 で
    //     弾かれて 数えられる。直し(updates)は ★今の値が 分からないので やらない★。
    //     ＝★何も 入らない★ から ★入るものは 入る★ に 変わる。理由は 返事に 出す。
    const yomeNakatta = exErr ? String(exErr.message || exErr).slice(0, 80) : '';

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
      carLabel: carLabel || undefined, // ★車の名前（一覧を 車ごとに 分ける為）2026-09-03★
      carNo: carNo === null ? undefined : carNo, // ★事務所で決めた並び順★
    });
    if (!bizDate) return 'skip:業務開始の日付が読めない';
    if (!rows.length) return 'skip:入れる代行が0件';

    const plan = planMeisaiWrite(rows, yomeNakatta ? [] : exist || []);
    // ★★2026-09-29 1行ずつ 入れるに 変えた★★
    //   前は 束で 1回 の insert だった。
    //   `daikou.meisai` に dk_ref の unique 索引を 張った（2026-09-29）ので、
    //   ★束の 中の 1行が 弾かれるだけで 束ごと 失敗★ し、
    //   その場で return するので ★下の updates（金額・距離の 直し）も 丸ごと 飛ぶ★。
    //   しかも 勤務は accepted に 入るので ★二度と 送られない＝黙って 欠ける★。
    //   ⇒ ★入れるのは 1行ずつ★。弾かれた 1行だけ 飛ばして 残りは 入れる。
    //   弾かれた数は 返事に 出す（★黙って 消さない★）。
    // ★★2026-09-29 その2＝途中で 抜けない（対立役の 指摘）★★
    //   前は 23505 以外の error で ★その場で return★ していた。
    //   すると ①既に 入れた 行は 残る＝★半分 入った 請求書★
    //         ②★下の updates が 丸ごと 走らない★（金額・距離・請求先の 直しが 全部 消える）
    //         ③それでも 勤務は accepted に 入る ＝ ★二度と 送られず 半分の まま 確定★
    //   束で 入れていた 頃は「全部 入らない」だったが、1行ずつに した 事で
    //   ★見た目が 完成品に なる分 こちらの 方が 危ない★。
    //   ⇒ ★最後まで 回し、updates も 必ず 走らせ、落ちた 数を 返事に 出す★。
    //
    //   ★往復の 上限★ この 関数は verify_jwt:false ＝ 運転手なら 誰でも 叩ける。
    //   MAX_SHIFTS 50 × MAX_TRIPS 300 の 道が 開いている ので 上限を 置く。
    //   実運用の 最悪は 1勤務 8件（本番 実測・平均 2.73件）なので 500 で 足りる。
    const IRE_JOUGEN = 500;
    let hajikareta = 0;
    let shippai = 0;
    let saigoNoWake = '';
    let uchikiri = 0;
    for (const row of plan.inserts) {
      if (uchikiri >= IRE_JOUGEN) {
        saigoNoWake = '上限 ' + IRE_JOUGEN + ' 件で 打ち切った';
        shippai += plan.inserts.length - uchikiri;
        break;
      }
      uchikiri++;
      const { error: iErr } = await sb.from('meisai').insert([row]);
      if (!iErr) continue;
      const msg = String(iErr.message || iErr);
      // 23505 = 索引が 弾いた（既に 在る）… 二重を 作らなかっただけなので 進む
      if (/duplicate key|23505/i.test(msg)) {
        hajikareta++;
        continue;
      }
      shippai++;
      saigoNoWake = msg.slice(0, 100);
    }
    // ★★直しの 輪も 途中で 抜けない（2026-09-29・入れる輪だけ 直して こちらを 忘れていた）★★
    //   入れる輪は 09-29 に 直したのに ★この輪は `return` の まま★ だった。
    //   ★しかも 私の 見張りの 窓が `for (const u of plan.updates)` で 切れていて
    //     この輪を ★一度も 見ていなかった★（門が 自分の 見たい 所だけ 見ていた）。
    //   半分 直した まま accepted ＝★半分の 請求書が 確定★ に なる。
    let naoseNakatta = 0;
    for (const u of plan.updates) {
      const { error: uErr } = await sb.from('meisai').update(u.patch).eq('id', u.id);
      if (!uErr) continue;
      naoseNakatta++;
      saigoNoWake = '直し ' + String(uErr.message || uErr).slice(0, 80);
    }
    if (!plan.inserts.length && !plan.updates.length && !yomeNakatta)
      return 'skip:変わっていない';
    // ★入れられなかった 数も 必ず 返事に 出す（黙って 済ませない）★
    return (
      'ok:' +
      (plan.inserts.length - hajikareta - shippai) +
      '件入れた/' +
      plan.updates.length +
      '件直した' +
      // ★読めていたのに 23505 ＝★読みで 見えない 行が 在る★（別の 持ち主の 行 等）
      //   索引は 表 全体・読みは .eq('user_id', ownerId) ＝★見る 範囲が 違う★。
      //   その 代行は ★事務所に 一生 出ない★ ので 「既に 在った」と 同じ 箱に 入れない。
      (hajikareta
        ? yomeNakatta
          ? '/★' + hajikareta + '件 既に 在った★'
          : '/★★' + hajikareta + '件 読みで 見えない 行が 在る★★'
        : '') +
      (shippai ? '/★' + shippai + '件 入らなかった: ' + saigoNoWake + '★' : '') +
      (naoseNakatta ? '/★' + naoseNakatta + '件 直せなかった: ' + saigoNoWake + '★' : '') +
      (yomeNakatta ? '/★今の明細を 読めず 入れるだけに した: ' + yomeNakatta + '★' : '')
    );
  } catch (e) {
    // 請求書側で何が起きても、ダイコメの実績受け取りは止めない
    return 'error:' + String((e as Error)?.message || e).slice(0, 120);
  }
}
