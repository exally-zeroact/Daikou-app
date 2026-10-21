// ============================================================
// scripts/tooshi-kakunin.mjs
// ★テスト線で「請求書払いの 代行 → 事務所の 明細」を 通して 数える★ 2026-09-30
//
//   ★なぜ 作ったか（司さん「前に 倉庫の 向きを 確認したのに なぜ まだ そんなに なってる？」）★
//     2026-09-30 に 数えたら テスト倉庫の `daikou.meisai` は ★0行★ だった。
//     私は それを「材料が 無いだけ」と 言ったが ★嘘★ だった:
//       ・`daikome.dk_trips` に 請求書払いの 代行が ★2件 在った★
//       ・その 2件は 8/06 の ★同じ 1秒★ に 種として 直接 入れた 物＝アプリを 通っていない
//       ・しかも その 会社は `owner_id` が 空＝通しても 入口で 弾かれる
//     ★0行は「材料が 無い」の 証拠にも「壊れている」の 証拠にも ならない★
//     （[[feedback_hakaru_dougu_ga_kaeshita_0_wo_shinjiruna]]）。
//
//     そして 一番 悪かったのは ★「通るか」を 見張る 物が 0本 だった★ 事。
//     向き先の 見張りは 6本 在ったが、どれも ★字の 向き★ しか 見ていない。
//     ＝「向き先は 全アプリ ○・未測定 0」は ★盛り★ だった。
//   ⇒ 手で やった 通し確認を ★機械に させる★。
//
//   ★何を 見るか（4つ）★
//     ① 請求書払いを 1件 送ると 明細が ★1行 増える★
//     ② その 行に ★extra.dk_meter_yen（守りの 印）が 付く★
//     ③ 事務所が 額を 手で 直した 後に 送り直しても ★戻らない★（`skip:変わっていない`）
//        ★2026-10-22★ 明細だけで なく 売上（dk_trips.fare_yen・dk_shifts.fare_total_yen）も 見る。
//        前は 明細しか 見ず、「続ける」の 送り直しで 売上だけ 端末の 額に 戻る 穴を 緑で 通した（対立役 N2）。
//        事務所の 直しは dk-fix-fare が 売上にも 写すので、ここでも 同じ 形を 作ってから 送り直す。
//     ④ 運転手が メーターを 値引きしたら ★届く★（印も 進む）
//     ★③だけ 見て 終わると 前に 踏んだ 穴（値引きが 一生 届かない）を 見落とす★
//
//   ★後片付け★ 作った 物は 全部 消して ★元の 数に 戻った事を 数える★。
//
//   ★★本番では 走らない★★
//     向き先が 本番なら その場で 止める。実データを 汚さない。
//
//   ★dk_ref の 繋ぎ方（次の人が 誤診しない為に 書く）★
//     `extra.dk_ref` = `端末:勤務開始ms:何件目`（例 `xxxx:1600009000000:1`）
//     ・`trip_id` で 繋ぐと ★0件★（trip_id は 送り直すと 変わる ので 使っていない）
//     ・`shift_id` で 繋いでも ★0件★
//     ・繋がるのは ★勤務開始ms → dk_shifts.started_at（epoch×1000）＋ seq → dk_trips★ の道だけ
//       （本番で 156/156・ズレ 0 で 繋がる事を 実測した）
//
//   ★★わざと壊して 赤に なるのを ★見ていない★（なぜ しなかったか）★★
//     この道具を 赤に するには ★壊した 関数を テスト倉庫に 配る★ 必要が ある。
//     配る 道具は ★git が 持っている 中身しか 配らない★ ので 壊れた字を commit する事に なる。
//     ★壊れた字を commit するのも、hook を 迂回するのも やめた★（2026-09-30）。
//     ⇒ この道具は ★「壊れた時に 赤に なる」を まだ 見ていない★。
//     ただし 別の 裏付けは 在る：
//       ・本番の 古い 関数(ver15)に `check-function-body.mjs` を 当てると
//         ★dk_meter_yen が 無い＝2/7 しか 在るない★ と 赤に なった（実測）。
//         ＝この道具の ②が 見ている 印は 古い字には 無い。
//       ・本番で 走らせると ★その場で 止まる★（実測）。
//     ★次に 関数を 大きく 直す 時に、配る 前後で これを 走らせて 赤を 見る事★。
//
//   使い方:
//     node scripts/tooshi-kakunin.mjs
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken } from './db-token.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HONBAN = 'tnfwipbgfgjaymlszeid';
// ★本物と ぶつからない 時刻★（2020年＝ダイコメが 無かった頃）
const MS = 1600009000000;

function cfg() {
  const s = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
  const url = (s.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  const key = (s.match(/eyJ[A-Za-z0-9_.-]{40,}/) || [])[0];
  if (!url || !key) throw new Error('js/dk-config.js から 向き先か 鍵が 読めない');
  return { url, key, ref: url.replace(/^https:\/\/|\.supabase\.co$/g, '') };
}

async function main() {
  const { url, key, ref } = cfg();
  const { token, from } = readToken();
  console.log(`向き先: ${ref}  /  鍵: ${from}（中身は出さない）`);

  // ★★本番では 走らない★★
  if (ref === HONBAN)
    throw new Error('★本番の 倉庫です＝この道具は 走りません★（実データを 汚さない）');

  const q = async (sql) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'daikome-tooshi/1.0',
      },
      body: JSON.stringify({ query: sql }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(r.status + ' ' + JSON.stringify(j).slice(0, 200));
    return j;
  };

  // ★持ち主の 在る 会社＋その 端末★（持ち主が 無いと 249行目で 弾かれる）
  const co = (
    await q(`select c.url_token, c.name, c.owner_id, d.device_id
               from daikome.dk_companies c
               join daikome.dk_company_devices d on d.company_id = c.company_id
              where c.owner_id is not null
              limit 1;`)
  )[0];
  if (!co) throw new Error('★持ち主の 在る 会社が 1つも 無い＝通せない（種を 入れる所から）★');
  console.log(`使う 会社: ${co.name}（url_token は 出さない）`);

  const kazu = async () =>
    (
      await q(`select (select count(*) from daikome.dk_shifts) a,
                      (select count(*) from daikome.dk_trips) b,
                      (select count(*) from daikou.meisai) c,
                      (select count(*) from daikome.dk_meisai_hazushi) d,
                      (select count(*) from daikou.invoices) e,
                      (select count(*) from daikou.invoice_no) f;`)
    )[0];
  const gyou = async () =>
    (
      await q(`select id, amount, note, deleted_at, extra->>'dk_meter_yen' as shirushi,
                      (select count(*) from daikome.dk_meisai_hazushi h where h.meisai_id = m.id) kiroku
                 from daikou.meisai m
                where extra->>'dk_ref' = '${co.device_id}:${MS}:1';`)
    )[0];

  // ★売上の 額★（その 勤務の 1件目の 乗車・業務の 合計）
  const uriage = async () =>
    (
      await q(`select t.fare_yen, s.fare_total_yen
                 from daikome.dk_shifts s join daikome.dk_trips t on t.shift_id = s.shift_id and t.seq = 1
                where s.started_at = to_timestamp(${MS} / 1000.0);`)
    )[0] || {};

  const okuru = async (yen, genkin) => {
    const r = await fetch(url + '/functions/v1/dk-sync-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        url_token: co.url_token,
        device_id: co.device_id,
        shifts: [
          {
            start_time: MS,
            end_time: MS + 3600000,
            trip_count: 1,
            fare_total_yen: yen,
            trips: [
              {
                seq: 1,
                distance_m: 5362,
                fare_yen: yen,
                customer_id: genkin ? null : 'tooshi-kakunin',
                customer_name: genkin ? '' : '【通し確認】お客',
                payment_type: genkin ? 'cash' : 'invoice',
                start_time: MS + 60000,
                end_time: MS + 900000,
                start_address: '今治市 A町',
                end_address: '今治市 B町',
                waypoints: [],
              },
            ],
          },
        ],
      }),
    });
    const j = await r.json();
    return (j.meisai || []).join(' / ') || JSON.stringify(j);
  };

  const warui = [];
  const mae = await kazu();
  console.log(
    `\n★前★ dk_shifts=${mae.a} dk_trips=${mae.b} meisai=${mae.c} 外した記録=${mae.d} 請求書=${mae.e} 番号=${mae.f}`
  );

  try {
    // ── ① 通すと 1行 増える／② 印が 付く ──
    console.log('\n① 請求書払いを 1件 送る');
    console.log('   返事 =', await okuru(2500));
    const a1 = await kazu();
    const g1 = await gyou();
    console.log(`   meisai ${mae.c} → ${a1.c}`);
    if (Number(a1.c) !== Number(mae.c) + 1) warui.push('★明細が 1行 増えていない★');
    if (!g1) warui.push('★入れた 行が 見つからない★');
    else {
      console.log(`   入った 行: ${g1.amount}円 / 印=${g1.shirushi}`);
      if (String(g1.shirushi) !== '2500') warui.push('★守りの 印(dk_meter_yen)が 付いていない★');
    }

    // ── ③ 事務所の 直しが 守られる ──
    console.log('\n③ 事務所が 2,500 → 1,600円に 下げた ふり → 送り直す');
    await q(`update daikou.meisai set amount = 1600, note = '【通し確認】事務所が 手で 直した'
              where extra->>'dk_ref' = '${co.device_id}:${MS}:1';`);
    // dk-fix-fare と 同じ 形（その 乗車の 額と 業務の 合計を 事務所の 額に）
    await q(`update daikome.dk_trips set fare_yen = 1600
              where seq = 1 and shift_id in (select shift_id from daikome.dk_shifts
                                              where started_at = to_timestamp(${MS} / 1000.0));`);
    await q(`update daikome.dk_shifts set fare_total_yen = 1600
              where started_at = to_timestamp(${MS} / 1000.0);`);
    console.log('   返事 =', await okuru(2500));
    const g2 = await gyou();
    const u2 = await uriage();
    console.log(
      `   → 明細 ${g2.amount}円 / 乗車 ${u2.fare_yen}円 / 業務 ${u2.fare_total_yen}円 / 備考「${g2.note}」`
    );
    if (Number(g2.amount) !== 1600) warui.push('★事務所の 額が メーターに 戻された★');
    if (Number(u2.fare_yen) !== 1600) warui.push('★売上の 乗車の 額が 端末の 額に 戻った★');
    if (Number(u2.fare_total_yen) !== 1600) warui.push('★売上の 業務の 合計が 端末の 額に 戻った★');
    // ★印は 端末の 額の まま★（明細を 書く 所に 事務所の 額を 渡すと 印が 1600 に 進み、次で 戻る・対立役 直B）
    if (String(g2.shirushi) !== '2500')
      warui.push('★印が 事務所の 額に 進んだ＝次の 送り直しで 戻る★');
    console.log('   もう 1回 同じ 2,500円で 送り直す');
    console.log('   返事 =', await okuru(2500));
    const g2b = await gyou();
    const u2b = await uriage();
    console.log(
      `   → 明細 ${g2b.amount}円 / 乗車 ${u2b.fare_yen}円 / 業務 ${u2b.fare_total_yen}円 / 印=${g2b.shirushi}`
    );
    if (
      Number(g2b.amount) !== 1600 ||
      Number(u2b.fare_yen) !== 1600 ||
      Number(u2b.fare_total_yen) !== 1600
    )
      warui.push('★2回目の 送り直しで 事務所の 額が 戻った★');
    if (!String(g2.note).includes('事務所が 手で 直した')) warui.push('★備考が 消えた★');

    // ── ④ 運転手の 値引きは 届く ──
    console.log('\n④ 運転手が メーターを 2,500 → 2,200円に 値引き → 送る');
    console.log('   返事 =', await okuru(2200));
    const g3 = await gyou();
    console.log(`   → ${g3.amount}円 / 印=${g3.shirushi}`);
    if (Number(g3.amount) !== 2200) warui.push('★運転手の 値引きが 届かない★');
    const u3 = await uriage();
    console.log(`   → 乗車 ${u3.fare_yen}円 / 業務 ${u3.fare_total_yen}円`);
    if (Number(u3.fare_yen) !== 2200 || Number(u3.fare_total_yen) !== 2200)
      warui.push('★運転手の 値引きが 売上に 届かない★');
    if (String(g3.shirushi) !== '2200') warui.push('★印が 進んでいない＝次は 守れない★');

    // ── ⑤ 運転手が 現金に 戻すと 明細から 外れる（2026-10-12）──
    console.log(
      '\n⑤ 運転手が 請求書払い → 現金 に 直して 送る（前の 送りで 行の 書きが 落ちて 残った 記録が 在る ふり）'
    );
    // ★事務所が 2,200 → 1,800円に 直した 形（明細と 売上）★ 2026-10-22（対立役 直A：現金→請求書払いに 戻した 時に
    //   事務所の 額が 売上に 乗るかを ⑥で 見る）
    await q(
      `update daikou.meisai set amount = 1800 where extra->>'dk_ref' = '${co.device_id}:${MS}:1';`
    );
    await q(`update daikome.dk_trips set fare_yen = 1800
              where seq = 1 and shift_id in (select shift_id from daikome.dk_shifts
                                              where started_at = to_timestamp(${MS} / 1000.0));`);
    await q(`update daikome.dk_shifts set fare_total_yen = 1800
              where started_at = to_timestamp(${MS} / 1000.0);`);
    // ★taiketsu の 指摘★ 記録だけ 残った 行を 同じ 送りで 外して 記録を 捨てると 戻せなくなる
    await q(`insert into daikome.dk_meisai_hazushi (meisai_id, dk_ref, hidden_at)
             values ('${g3.id}', '${co.device_id}:${MS}:1', '2020-09-13T00:00:00Z');`);
    console.log('   返事 =', await okuru(2200, true));
    const g5 = await gyou();
    if (!g5.deleted_at || Date.parse(g5.deleted_at) !== Date.parse('2020-09-13T00:00:00Z'))
      warui.push('★残っていた 記録の 時刻で 外していない＝戻せない 行に なる★');
    console.log(`   → 消した印=${g5.deleted_at ? 'あり' : 'なし'} / 外した記録=${g5.kiroku}`);
    if (!g5.deleted_at) warui.push('★現金に 戻したのに 明細に 残った★');
    if (String(g5.kiroku) !== '1') warui.push('★外した 記録が 無い＝戻せない★');

    // ── ⑥ 請求書払いに 戻すと 戻る（事務所の 備考も 残る）──
    console.log('\n⑥ 運転手が また 請求書払いに 直して 送る');
    console.log('   返事 =', await okuru(2200));
    const g6 = await gyou();
    console.log(
      `   → 消した印=${g6.deleted_at ? 'あり' : 'なし'} / 外した記録=${g6.kiroku} / 備考「${g6.note}」`
    );
    if (g6.deleted_at) warui.push('★請求書払いに 戻したのに 戻らない★');
    const u6 = await uriage();
    console.log(`   → 明細 ${g6.amount}円 / 乗車 ${u6.fare_yen}円 / 業務 ${u6.fare_total_yen}円`);
    if (
      Number(g6.amount) !== 1800 ||
      Number(u6.fare_yen) !== 1800 ||
      Number(u6.fare_total_yen) !== 1800
    )
      warui.push('★請求書払いに 戻した 時、事務所の 額（1800）が 明細と 売上で 揃わない★');
    if (String(g6.kiroku) !== '0') warui.push('★外した 記録が 残った★');
    if (!String(g6.note).includes('事務所が 手で 直した'))
      warui.push('★戻した 時に 備考が 消えた★');

    // ── ⑦ 請求書を 出した 月でも 現金に したら 外す（2026-10-22 司さん「よい」・前は 外さなかった）──
    console.log('\n⑦ その 会社・その 月の 請求書を 出した ふり → 現金に 直して 送る');
    const tsuki = new Date(MS + 9 * 3600000).toISOString().slice(0, 7);
    await q(`insert into daikou.invoices (user_id, month, company, invoice_no, issued_at, total, tax)
             values ('${co.owner_id}', '${tsuki}', '【通し確認】お客', 'TOOSHI-1', now(), 2200, 0);`);
    console.log('   返事 =', await okuru(2200, true));
    const g7 = await gyou();
    console.log(`   → 消した印=${g7.deleted_at ? 'あり' : 'なし'}`);
    if (!g7.deleted_at)
      warui.push('★請求書を 出した 月の 行が 外れない（出した 月の 止めが 残っている）★');
    // ★⑦と ⑧の 間に 請求書払いで 戻す★（戻さないと ⑧が 外れた 行の まま＝空振り・対立役 直N2）
    console.log('\n⑦b 請求書払いに 戻して 送る（出した 月でも 戻る）');
    console.log('   返事 =', await okuru(2200));
    const g7b = await gyou();
    console.log(`   → 消した印=${g7b.deleted_at ? 'あり' : 'なし'}`);
    if (g7b.deleted_at) warui.push('★出した 月で 請求書払いに 戻したのに 戻らない★');

    // ── ⑧ 全社の PDF・印刷で 出した 月（番号だけ 決めた・控えは 無い）でも 外す ──
    console.log('\n⑧ 控えを 消し、番号だけ 決めた ふり（全社の PDF）→ 現金に 直して 送る');
    await q(
      `delete from daikou.invoices where invoice_no = 'TOOSHI-1' and company = '【通し確認】お客';`
    );
    await q(`insert into daikou.invoice_no (user_id, month, company, invoice_no, decided_at)
             values ('${co.owner_id}', '${tsuki}', '【通し確認】お客', 'TOOSHI-2', now());`);
    console.log('   返事 =', await okuru(2200, true));
    const g8 = await gyou();
    console.log(`   → 消した印=${g8.deleted_at ? 'あり' : 'なし'}`);
    if (!g8.deleted_at)
      warui.push('★番号を 決めた 月の 行が 外れない（全社の PDF の 道の 止めが 残っている）★');
  } finally {
    // ── 後片付け（★失敗しても 必ず 消す★）──
    console.log('\n★後片付け★');
    await q(`delete from daikome.dk_meisai_hazushi where dk_ref = '${co.device_id}:${MS}:1';`);
    await q(
      `delete from daikou.invoices where invoice_no = 'TOOSHI-1' and company = '【通し確認】お客';`
    );
    await q(
      `delete from daikou.invoice_no where invoice_no = 'TOOSHI-2' and company = '【通し確認】お客';`
    );
    await q(`delete from daikou.meisai where extra->>'dk_ref' = '${co.device_id}:${MS}:1';`);
    await q(`delete from daikome.dk_trips
              where shift_id in (select shift_id from daikome.dk_shifts
                                  where started_at = to_timestamp(${MS} / 1000.0));`);
    await q(`delete from daikome.dk_shifts where started_at = to_timestamp(${MS} / 1000.0);`);
    const ato = await kazu();
    console.log(
      `   後 dk_shifts=${ato.a} dk_trips=${ato.b} meisai=${ato.c} 外した記録=${ato.d} 請求書=${ato.e} 番号=${ato.f}`
    );
    if (['a', 'b', 'c', 'd', 'e', 'f'].some((k) => String(ato[k]) !== String(mae[k])))
      warui.push('★元の 数に 戻っていない（片付け残り）★');
  }

  console.log('');
  if (warui.length) {
    warui.forEach((w) => console.log('  ' + w));
    console.log(`\nTOOSHI RESULT: ★NG★（${warui.length} 件）`);
    process.exit(1);
  }
  console.log('  ①1行 増えた ②印が 付いた ③事務所の 額が 守られた ④値引きが 届いた');
  console.log(
    '  ⑤現金で 外れた ⑥請求書払いで 戻った ⑦出した 月でも 外れ 戻った ⑧番号だけの 月でも 外れた'
  );
  console.log('TOOSHI RESULT: OK（8 / 8）');
}

main().catch((e) => {
  console.error('TOOSHI RESULT: ★NG★ ' + (e && e.message ? e.message : e));
  process.exit(1);
});
