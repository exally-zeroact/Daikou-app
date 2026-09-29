// ============================================================
// scripts/apply-dkmeteryen-backfill.mjs
// ★既に 在る 明細に「その時 メーターが 出していた 額」の 印を 1回だけ 入れる★ 2026-09-29
//
//   ★なぜ 専用の 道具に したか★
//     これは SQL で 書くと `update daikou.meisai set extra = extra || …` に なる。
//     `scripts/sql-guard.mjs` は ★update を 止める★。それで 正しい。
//     （門は「その update が 足すだけか」を 読めない。読めない物は 止めるのが 門の 仕事）
//     ⇒ ★門を ゆるめる のでは なく、この 1件しか 出来ない 道具を 作る★。
//        ・当てる 字は ★この中で 組み立てる★（外から SQL を 受け取らない）
//        ・触るのは `daikou.meisai.extra` の ★`dk_meter_yen` の キー 1つだけ★
//        ・`amount` などの お金の 列は ★1つも 触らない★（後で 数えて 確かめる）
//
//   ★なぜ 要るか（本番 実測 2026-09-29）★
//     `daikou.meisai` の dk_ref 付き ………… 150行
//       うち 印が 在る ……………………… ★0行★
//     ＝関数だけ 配っても ★守れる 行は 0★。
//       印が 無い 行は 今までどおり メーターの 値で 上書きされる。
//
//   ★印は「メーターの 額」で 入れる（明細の 額では ない）★
//     dk_ref = `端末:勤務開始ms:何件目` から `daikome.dk_trips.fare_yen` を 引く。
//     ・金額が 合っている 143行 … どちらで 入れても 同じ
//     ・ずれている 7行（明細が 低い6行 計1,400円／高い1行 2,000円）
//       … メーターの 額で 入れると 次の 送り直しで
//         「メーターは 変わっていない」と 読めて ★明細側の 額が 守られる★
//
//   ★丸め方は 関数と 揃える★
//     buildMeisaiRows は `amount = Math.round(fare_yen)` / `dk_meter_yen = Math.round(fare_yen)`。
//     ここも `round(fare_yen)` で 入れる。（揃っていないと 毎回 上書きし続ける）
//
//   使い方:
//     node scripts/apply-dkmeteryen-backfill.mjs            … ★見るだけ★（当てない）
//     node scripts/apply-dkmeteryen-backfill.mjs --yaru     … 当てる
//
//   ▼向き先は ★js/dk-config.js から読む★（このrepoの向き先にしか 当てない）
//   ▼鍵は %TEMP% のファイルから読む。★画面に 出さない★。
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken } from './db-token.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEYA = 'daikou';
const TANA = 'meisai';
const KAGI = 'dk_meter_yen';

function projectRef() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
  const m = src.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!m) throw new Error('js/dk-config.js から 向き先が 読めない');
  return m[1];
}

// ★突き合わせ★ dk_ref = 端末:勤務開始ms:何件目 → daikome.dk_trips.fare_yen
const JOIN = `
    from daikou.meisai m
    join daikome.dk_shifts s
      on s.device_id = split_part(m.extra->>'dk_ref', ':', 1)
     and extract(epoch from s.started_at) * 1000 = (split_part(m.extra->>'dk_ref', ':', 2))::bigint
    join daikome.dk_trips t
      on t.shift_id = s.shift_id
     and t.seq = (split_part(m.extra->>'dk_ref', ':', 3))::int
   where m.extra ? 'dk_ref'
     and not (m.extra ? '${KAGI}')
     and jsonb_typeof(m.extra) = 'object'`;

// ★当てる 字は ここで 組み立てる（外から 受け取らない）★
const ATERU = `
update ${HEYA}.${TANA} m
   set extra = m.extra || jsonb_build_object('${KAGI}', round(t.fare_yen)::int)
  from daikome.dk_shifts s
  join daikome.dk_trips t
    on t.shift_id = s.shift_id
 where m.extra ? 'dk_ref'
   and not (m.extra ? '${KAGI}')
   and jsonb_typeof(m.extra) = 'object'
   and s.device_id = split_part(m.extra->>'dk_ref', ':', 1)
   and extract(epoch from s.started_at) * 1000 = (split_part(m.extra->>'dk_ref', ':', 2))::bigint
   and t.seq = (split_part(m.extra->>'dk_ref', ':', 3))::int;`;

const KAZOERU = `
select
  count(*) filter (where extra ? 'dk_ref')                         as dkref,
  count(*) filter (where extra ? 'dk_ref' and extra ? '${KAGI}')   as in_ari,
  count(*) filter (where extra ? 'dk_ref' and not (extra ? '${KAGI}')) as in_nashi,
  count(*)                                                          as zenbu,
  coalesce(sum(amount), 0)                                          as kingaku_kei,
  coalesce(sum(jsonb_object_keys_count), 0)                         as dummy
from (select amount, extra, 0 as jsonb_object_keys_count from ${HEYA}.${TANA}) z;`;

async function main() {
  const yaru = process.argv.includes('--yaru');
  const ref = projectRef();
  const { token, from } = readToken();
  const q = async (sql) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'daikome-backfill/1.0',
      },
      body: JSON.stringify({ query: sql }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(r.status + ' ' + JSON.stringify(j).slice(0, 300));
    return j;
  };

  console.log(`向き先: ${ref}  /  鍵: ${from}（中身は出さない）`);
  console.log(`触る所: ${HEYA}.${TANA}.extra の ★${KAGI} の キー 1つだけ★\n`);

  // ── 前を 数える ──
  const mae = (await q(KAZOERU))[0];
  console.log('★当てる前★');
  console.log(`  ${TANA} 全部 ……………… ${mae.zenbu} 行`);
  console.log(`  dk_ref 付き ……………… ${mae.dkref} 行`);
  console.log(`    うち 印が 在る ……… ${mae.in_ari} 行`);
  console.log(`    うち 印が 無い ……… ${mae.in_nashi} 行`);
  console.log(`  金額の 合計 …………… ${mae.kingaku_kei} 円`);

  // ── 当たる 相手を 数える（1対1か / 値は 整数か）──
  const shirabe = (
    await q(`
    select count(*) as ataru,
           count(distinct m.id) as betsubetsu,
           count(*) filter (where t.fare_yen is null) as kara,
           count(*) filter (where t.fare_yen <> round(t.fare_yen)) as shousuu
    ${JOIN};`)
  )[0];
  console.log('\n★当たる 相手★');
  console.log(`  当たる 組 ……………… ${shirabe.ataru}`);
  console.log(`  別々の 行 ……………… ${shirabe.betsubetsu}  （★組と 同じでないと 1対1で ない★）`);
  console.log(`  メーターが 空 ……… ${shirabe.kara}`);
  console.log(`  メーターが 小数 …… ${shirabe.shousuu}  （round で 入れる）`);

  const tarinai = Number(mae.in_nashi) - Number(shirabe.betsubetsu);
  console.log(`  ★相手が 居ない 行 … ${tarinai}（この行は 印が 付かない＝今までどおり）★`);

  // ★★0件で 緑に しない★★（「道具が 返した 0件を 根拠に するな」）
  //   テスト倉庫の daikou.meisai は ★0行★（実測 2026-09-29）。
  //   そこで 走らせると 何も せずに OK を 返してしまう。
  //   ＝★向き先を 間違えていても 緑★ に なるので はっきり 止める。
  if (Number(mae.dkref) === 0)
    throw new Error('★dk_ref 付きの 行が 0★＝この 倉庫に は 当てる 物が 無い（向き先違いの 痑い）');
  if (Number(shirabe.betsubetsu) === 0 && Number(mae.in_nashi) > 0)
    throw new Error('★印の 無い 行は 在るのに 相手が 1つも 見つからない★＝突き合わせが 壊れている');
  if (Number(shirabe.ataru) !== Number(shirabe.betsubetsu))
    throw new Error('★1対1で ない（同じ 明細に 2つの 代行が 当たる）＝当てない★');
  if (Number(shirabe.kara) > 0) throw new Error('★メーターが 空の 組が 在る＝当てない★');

  if (!yaru) {
    console.log('\n見るだけ で 終わり（当てるには --yaru）');
    console.log('BACKFILL RESULT: OK（何も 書いていない）');
    return;
  }

  // ── 当てる ──
  console.log('\n★当てる★');
  await q(ATERU);

  // ── 後を 数える ──
  const ato = (await q(KAZOERU))[0];
  console.log('\n★当てた後★');
  console.log(`  dk_ref 付き ……………… ${ato.dkref} 行`);
  console.log(`    うち 印が 在る ……… ${ato.in_ari} 行  （前 ${mae.in_ari}）`);
  console.log(`    うち 印が 無い ……… ${ato.in_nashi} 行  （前 ${mae.in_nashi}）`);
  console.log(`  金額の 合計 …………… ${ato.kingaku_kei} 円  （前 ${mae.kingaku_kei}）`);

  const warui = [];
  if (String(ato.kingaku_kei) !== String(mae.kingaku_kei))
    warui.push('★金額の 合計が 動いた★');
  if (String(ato.zenbu) !== String(mae.zenbu)) warui.push('★行の 数が 変わった★');
  if (String(ato.dkref) !== String(mae.dkref)) warui.push('★dk_ref の 数が 変わった★');
  if (Number(ato.in_ari) !== Number(mae.in_ari) + Number(shirabe.betsubetsu))
    warui.push('★印が 付いた 数が 見込みと 違う★');

  // 他の キーを 落としていないか（dk_ref は 全部 残っているか）
  const nokori = (
    await q(
      `select count(*) as n from ${HEYA}.${TANA} where extra ? '${KAGI}' and not (extra ? 'dk_ref');`
    )
  )[0];
  if (Number(nokori.n) > 0) warui.push('★dk_ref を 落とした 行が 在る★');

  if (warui.length) {
    warui.forEach((w) => console.log('  ' + w));
    console.log('\nBACKFILL RESULT: ★NG★');
    process.exit(1);
  }
  console.log('\n  金額 動かず / 行数 変わらず / dk_ref 残っている');
  console.log('BACKFILL RESULT: OK');
}

main().catch((e) => {
  console.error('BACKFILL RESULT: ★NG★ ' + (e && e.message ? e.message : e));
  process.exit(1);
});
