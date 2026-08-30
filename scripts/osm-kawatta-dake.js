#!/usr/bin/env node
'use strict';
// ============================================================
// ★★変わった県だけを 積む★★ 2026-08-31
//
//   ★司さん「そもそもなんで全部やりよんど／変わったとこだけでええやろが」★
//
//   ★何が 悪かったか（実測）★
//     ・道路データは 毎週 ★45県／198MB★ を 刷り直して 履歴に 積んでいた
//     ・でも 実際に 変わったのは ★道の 0.05%★（624万本のうち 3,169本）
//     ・道路データは ★base64＋varint の 一続きの 塊★なので、
//       道が 1本 増えると ★後ろが 全部 ずれる★
//       ⇒ 0.05% の 変化で ★ファイルは 1バイト目から 別物★
//       ⇒ git は 差分を 取れず ★毎週 まるごと 積む★
//       ⇒ ★clone が 毎週 +6.5秒 増え続ける★
//
//   ★この道具は 何を するか★
//     刷り直した data/roads-<県>.js を 1本ずつ 見て、
//     ★変わり方が 小さい県は 元に 戻す（＝積まない）★。
//     ★変わり方＝道の 本数(numRoads)の 差の 割合★。
//
//   ★★距離にも 料金にも 1mmも 触りません★★
//     ・客が 読む ★ファイルの 形は 何も 変わりません★
//     ・変わるのは「★その県を いつ 刷り直すか★」だけ
//     ・積まない県は ★前の 中身が そのまま 使われます★
//     ・そもそも ★課金距離は OBD の 速度と GPS の 位置★で 出しており、
//       ★道路データは 1バイトも 使っていません★（2026-08-31 実測）
//
//   ★安全側の 決め方★
//     ・★新しく 出来た県★（前が 無い）… ★必ず 積む★
//     ・★本数が 読めない★（形が 変わった 等）… ★必ず 積む★
//     ・★しきい値 以上 変わった県★ … 積む
//     ⇒★迷ったら 積む★（古いまま 放置しない）
//
//   使い方: node scripts/osm-kawatta-dake.js <前のgit ref> [しきい値%]
//     例:   node scripts/osm-kawatta-dake.js HEAD 0.2
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BEFORE = process.argv[2] || 'HEAD';
const SHIKII = process.argv[3] != null ? Number(process.argv[3]) : 0.2; // ★既定 0.2%★

function git(args, opts) {
  return execFileSync('git', args, Object.assign({ cwd: ROOT, maxBuffer: 1 << 30 }, opts || {}));
}

function numRoadsOf(buf) {
  if (!buf) return null;
  const head = buf.slice(0, 4000).toString('utf8');
  const m = /"numRoads":(\d+)/.exec(head);
  return m ? Number(m[1]) : null;
}

function mae(rel) {
  try {
    return git(['show', BEFORE + ':' + rel]);
  } catch (_) {
    return null; // ★前が 無い＝新しい県★
  }
}

const dataDir = path.join(ROOT, 'data');
const files = fs
  .readdirSync(dataDir)
  .filter((f) => /^roads-[a-z]+\.js$/.test(f))
  .sort();

let tsumu = 0;
let modosu = 0;
let tsumuByte = 0;
let modosuByte = 0;
const rows = [];

for (const f of files) {
  const rel = 'data/' + f;
  const now = fs.readFileSync(path.join(dataDir, f));
  const old = mae(rel);

  if (old === null) {
    rows.push([f, '—', '—', '★新しい県★', '積む']);
    tsumu++;
    tsumuByte += now.length;
    continue;
  }
  if (old.equals(now)) {
    rows.push([f, '—', '—', '中身が 同じ', '積まない']);
    continue; // 何も しない（git も 変化なしと 見る）
  }

  const a = numRoadsOf(now);
  const b = numRoadsOf(old);
  if (a === null || b === null || b === 0) {
    rows.push([f, String(b), String(a), '★本数が 読めない★', '積む']);
    tsumu++;
    tsumuByte += now.length;
    continue;
  }
  const hen = (Math.abs(a - b) * 100) / b;
  if (hen >= SHIKII) {
    rows.push([f, String(b), String(a), hen.toFixed(3) + '%', '積む']);
    tsumu++;
    tsumuByte += now.length;
  } else {
    // ★小さい変化＝前の物に 戻す（履歴に 積まない）★
    fs.writeFileSync(path.join(dataDir, f), old);
    rows.push([f, String(b), String(a), hen.toFixed(3) + '%', '★戻す★']);
    modosu++;
    modosuByte += now.length;
  }
}

const MB = (n) => (n / 1048576).toFixed(1) + ' MB';
console.log('■ 変わった県だけ 積む（しきい値 ' + SHIKII + '%・前 = ' + BEFORE + '）');
console.log('');
for (const r of rows) {
  if (r[4] === '積まない') continue; // 静かな物は 出さない
  console.log(
    '  ' +
      r[0].padEnd(24) +
      String(r[1]).padStart(9) +
      ' → ' +
      String(r[2]).padStart(9) +
      '  ' +
      String(r[3]).padStart(12) +
      '  ' +
      r[4]
  );
}
console.log('');
console.log('  ★積む県 … ' + tsumu + ' 県（' + MB(tsumuByte) + '）★');
console.log('  ★戻した県 … ' + modosu + ' 県（' + MB(modosuByte) + ' を 履歴に 積まずに 済んだ）★');
console.log('  変化なし … ' + (files.length - tsumu - modosu) + ' 県');
