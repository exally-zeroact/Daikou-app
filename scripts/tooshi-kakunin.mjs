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
    await q(`select c.url_token, c.name, d.device_id
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
                      (select count(*) from daikou.meisai) c;`)
    )[0];
  const gyou = async () =>
    (
      await q(`select amount, note, extra->>'dk_meter_yen' as shirushi
                 from daikou.meisai
                where extra->>'dk_ref' = '${co.device_id}:${MS}:1';`)
    )[0];

  const okuru = async (yen) => {
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
                customer_id: 'tooshi-kakunin',
                customer_name: '【通し確認】お客',
                payment_type: 'invoice',
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
  console.log(`\n★前★ dk_shifts=${mae.a} dk_trips=${mae.b} meisai=${mae.c}`);

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
    console.log('   返事 =', await okuru(2500));
    const g2 = await gyou();
    console.log(`   → ${g2.amount}円 / 備考「${g2.note}」`);
    if (Number(g2.amount) !== 1600) warui.push('★事務所の 額が メーターに 戻された★');
    if (!String(g2.note).includes('事務所が 手で 直した')) warui.push('★備考が 消えた★');

    // ── ④ 運転手の 値引きは 届く ──
    console.log('\n④ 運転手が メーターを 2,500 → 2,200円に 値引き → 送る');
    console.log('   返事 =', await okuru(2200));
    const g3 = await gyou();
    console.log(`   → ${g3.amount}円 / 印=${g3.shirushi}`);
    if (Number(g3.amount) !== 2200) warui.push('★運転手の 値引きが 届かない★');
    if (String(g3.shirushi) !== '2200') warui.push('★印が 進んでいない＝次は 守れない★');
  } finally {
    // ── 後片付け（★失敗しても 必ず 消す★）──
    console.log('\n★後片付け★');
    await q(`delete from daikou.meisai where extra->>'dk_ref' = '${co.device_id}:${MS}:1';`);
    await q(`delete from daikome.dk_trips
              where shift_id in (select shift_id from daikome.dk_shifts
                                  where started_at = to_timestamp(${MS} / 1000.0));`);
    await q(`delete from daikome.dk_shifts where started_at = to_timestamp(${MS} / 1000.0);`);
    const ato = await kazu();
    console.log(`   後 dk_shifts=${ato.a} dk_trips=${ato.b} meisai=${ato.c}`);
    if (String(ato.a) !== String(mae.a) || String(ato.b) !== String(mae.b) || String(ato.c) !== String(mae.c))
      warui.push('★元の 数に 戻っていない（片付け残り）★');
  }

  console.log('');
  if (warui.length) {
    warui.forEach((w) => console.log('  ' + w));
    console.log(`\nTOOSHI RESULT: ★NG★（${warui.length} 件）`);
    process.exit(1);
  }
  console.log('  ①1行 増えた ②印が 付いた ③事務所の 額が 守られた ④値引きが 届いた');
  console.log('TOOSHI RESULT: OK（4 / 4）');
}

main().catch((e) => {
  console.error('TOOSHI RESULT: ★NG★ ' + (e && e.message ? e.message : e));
  process.exit(1);
});
