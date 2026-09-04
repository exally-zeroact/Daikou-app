'use strict';
// ============================================================
// ★★実機 trace（材料）の 受け取り口★★ 2026-09-04
//
//   ★司さんの 恒久ルール★
//     「★Firebaseは 2度と 使うな＝★読む為にも★ 使わない★」（2026-08-30）
//
//   ★なぜ 作ったか★
//     tests/ の 道具 6本が それぞれ ★Firebase RTDB の 住所を 持ち★、
//     同じ 3か所（key の 一覧／meta／samples）を 叩いていました。
//     ⇒ ★受け取り口を 1つに して、外へは 繋がない★ 形に します。
//
//   ★置き場★  data/traces/<名前>.json
//     形は 2通り 受けます
//       ① { meta: {...}, samples: [ {lat,lng,t,...}, ... ] }
//       ② [ {lat,lng,t,...}, ... ]        … meta は {} と みなす
//     ★DK_TRACE_DIR で 置き場を 変えられます★
//
//   ★材料が 無い時は 空を 返します★（外へは 1度も 繋ぎません）
//     ⇒ 呼ぶ側は ★「0件＝未測定」と はっきり 言う★ 事（黙って 緑に しない）
// ============================================================

const fs = require('fs');
const path = require('path');

const OKIBA =
  process.env.DK_TRACE_DIR && process.env.DK_TRACE_DIR.trim()
    ? path.resolve(process.env.DK_TRACE_DIR.trim())
    : path.join(__dirname, '..', '..', 'data', 'traces');

function yomu(key) {
  const p = path.join(OKIBA, key.endsWith('.json') ? key : key + '.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('[trace] 材料が 読めません: ' + p + ' / ' + e.message);
    return null;
  }
}

// ★在る 材料の 名前を 古い順に 返す★（Firebase の key の 並びと 同じ 使い方）
function keyIchiran() {
  if (!fs.existsSync(OKIBA)) return [];
  return fs
    .readdirSync(OKIBA)
    .filter((x) => x.endsWith('.json'))
    .map((x) => x.slice(0, -5))
    .sort();
}

function metaWoYomu(key) {
  const j = yomu(key);
  if (!j) return null;
  return Array.isArray(j) ? {} : j.meta || {};
}

function samplesWoYomu(key) {
  const j = yomu(key);
  if (!j) return null;
  if (Array.isArray(j)) return j;
  return Array.isArray(j.samples) ? j.samples : null;
}

function okiba() {
  return OKIBA;
}

module.exports = { keyIchiran, metaWoYomu, samplesWoYomu, okiba };
