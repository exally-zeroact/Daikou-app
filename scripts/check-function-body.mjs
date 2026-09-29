// ============================================================
// scripts/check-function-body.mjs
// ★配った「中身」を 取って 数える★ 2026-09-29
//
//   ★なぜ 要るか（2026-09-29 に 対立役に 叩かれて 分かった）★
//     `scripts/check-deployed-functions.mjs` は ★repo の 印が 配ってある 中に 在るか★
//     の ★片道の 包含★ しか 見ていない。しかも その 印は
//       ・`extra.dk_meter_yen` の ような ★オブジェクトの キーを 拾わない★
//       ・`fingerprint` が `^https?://` を ★わざと 捨てる★ ので
//         ★借り物の 版（esm.sh/@supabase/supabase-js@2.116.0）を 見ていない★
//     ＝★今回の 中身（お金の 守り ＋ 版の 固定）が 丸ごと 抜けても あの門は 緑★。
//     ＝「版が 上がった」も 中身の 証しでは ない（[[取れた≠合っている]]）。
//
//   ⇒ ★配った 物そのもの（/body）を 取って、在る／無い を 何個中 何個で 出す★。
//
//   使い方:
//     node scripts/check-function-body.mjs dk-sync-jobs
//
//   ▼向き先は ★js/dk-config.js から読む★（このrepoの向き先しか 見ない）
//   ▼鍵は %TEMP% のファイルから読む。★画面に 出さない★。
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken } from './db-token.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ★在って ほしい 字★（お金の 守りと 版の 固定）
const ARU = [
  ['dk_meter_yen', '書いた時の メーターの額を 残す印'],
  ['deleted_at', '事務所が 消した 行を 見る'],
  ['yomeNakatta', '読めなくても 入る物は 入れる'],
  ['naoseNakatta', '直す輪で 途中で 抜けない'],
  ['IRE_JOUGEN', '往復の 上限'],
  ["eq('user_id', ownerId)", '他社の 明細を 書き換えない'],
  ['supabase-js@2.116.0', '借り物の 版を 固定'],
];
// ★無くて ほしい 字★
const NAI = [
  ['supabase-js@2.117.2', '固定していない 版が 入っている'],
  ["supabase-js@2'", '版を 固定していない 書き方'],
];

function projectRef() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
  const m = src.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!m) throw new Error('js/dk-config.js から 向き先が 読めない');
  return m[1];
}

async function main() {
  const slug = process.argv[2] || 'dk-sync-jobs';
  const ref = projectRef();
  const { token, from } = readToken();
  const H = { Authorization: 'Bearer ' + token, 'User-Agent': 'daikome-check-body/1.0' };
  console.log(`向き先: ${ref}  /  鍵: ${from}（中身は出さない）`);

  const m = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/${slug}`, {
    headers: H,
  });
  if (!m.ok) throw new Error('関数の 札が 読めない: ' + m.status);
  const meta = await m.json();
  console.log(`いまの ${slug}: 版=${meta.version} 状態=${meta.status}`);

  const b = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/${slug}/body`, {
    headers: H,
  });
  if (!b.ok) throw new Error('中身が 読めない: ' + b.status);
  const buf = Buffer.from(await b.arrayBuffer());
  // eszip だが 生の 字が そのまま 入っている（実測 2026-09-29）
  const body = buf.toString('latin1');
  console.log(`中身: ${buf.length} B`);

  let ng = 0;
  console.log('\n★在って ほしい 字★');
  for (const [s, naze] of ARU) {
    const ok = body.includes(s);
    if (!ok) ng++;
    console.log(`  ${ok ? '在り' : '★無い★'}  ${s}  … ${naze}`);
  }
  console.log(`  ＝ ${ARU.length - ng} / ${ARU.length} 在り`);

  let ng2 = 0;
  console.log('\n★無くて ほしい 字★');
  for (const [s, naze] of NAI) {
    const aru = body.includes(s);
    if (aru) ng2++;
    console.log(`  ${aru ? '★在る★' : '無し'}  ${s}  … ${naze}`);
  }
  console.log(`  ＝ ${NAI.length - ng2} / ${NAI.length} 無し`);

  if (ng || ng2) {
    console.log(`\nBODY RESULT: ★NG★（足りない ${ng}個 / 余計 ${ng2}個）`);
    process.exit(1);
  }
  console.log('\nBODY RESULT: OK');
}

main().catch((e) => {
  console.error('BODY RESULT: ★NG★ ' + (e && e.message ? e.message : e));
  process.exit(1);
});
