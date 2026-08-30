#!/usr/bin/env node
'use strict';
// ============================================================
// ★物差し★ 2026-08-29 … ★距離の採点では ありません★
//   見ているのは ★料金を 変えた記録と「1つ前に 戻す」★の 作り。
//   タクシー認定モード／代行モード の どちらの線でも 判定していません。
//
// ★★料金の「変えた記録」と「戻す」ゲート（試験を 先に 書いた物）★★ 2026-08-29
//
//   ★赤で正しい★: ★本体（js/fare-history.js）は まだ 作っていません★。
//     うちは ★テスト先行★（[[feedback_daikome_test_tools_first_ALWAYS]]）なので、
//     ★書いた直後は 赤が 正しい★。★線を 緩めて 緑にするのは 不可★。
//
//   ★なぜ 要るか（2026-08-29 実測）★
//     今 料金を 保存する所は ★上書き 1件だけ★（js/firebase.js:346 set(config)）
//     ＝★前が いくらだったか どこにも 残らず、間違えても 戻せません★。
//     C1 で 社長が 変えられるようにする＝★戻せない物を 触らせる★事なので、
//     ★戻す道を 先に 作ります★。
//
//   ★設計1枚★: scratchpad/shot/C1_料金を変えた記録と戻す_設計1枚_2026-08-29.txt
//   ★借りた形★: js/trip-edit.js（2026-08-05・司さん指示の「あとから直す」）
//
//   ★触ってはいけない物★
//     distance_m ／ 過去の運行の 料金の写し(fare_config_snapshot) ／
//     走行中の凍結(_fareConfigFrozen) ／ 代行係数 1.0085
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HONTAI = path.join(ROOT, 'js', 'fare-history.js');

// ★今の既定（js/meter.js:223 と 同じ）★ ＝★司さんの 基本設定★
//   出どころ … zeroact-memory/projects/daikome/memory.md
//   「★calcFare … 1000m以下 ¥1,300 ／ 以降 420mごと +¥100★」（2026-08-29 訂正）
const KITEI = {
  version: 2,
  base_fare: 1300,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: 420,
  tiers: [],
  surcharges: [],
  minFare: null,
  maxFare: null,
  rounding: 10,
};

const MAX_KEN = 20; // ★直近 N件だけ 持つ（案・指示役 OK）★

function meterYomu(cfg) {
  const p = path.join(ROOT, 'js', 'meter.js');
  delete require.cache[require.resolve(p)];
  const M = require(p);
  M.setFareConfig(cfg);
  return M;
}

const kekka = [];
function miru(namae, fn) {
  try {
    const r = fn();
    kekka.push({ namae: namae, ok: r === true, riyuu: r === true ? '' : String(r) });
  } catch (e) {
    kekka.push({ namae: namae, ok: false, riyuu: (e && e.message) || String(e) });
  }
}

function honntai() {
  if (!fs.existsSync(HONTAI)) throw new Error('★本体が まだ 在りません: js/fare-history.js★');
  delete require.cache[require.resolve(HONTAI)];
  return require(HONTAI);
}

const utsushi = (o) => JSON.parse(JSON.stringify(o));
const kaeta = (en) => Object.assign(utsushi(KITEI), { base_fare: en });

// ── ① 変えたら 記録が 1件 増える（いつ・誰が・前・後 の4つが 全部 入っている）──
miru('① 変えたら 記録が 1件 増える（4つとも 入っている）', function () {
  const H = honntai();
  const s0 = H.hajime({ config: utsushi(KITEI), records: [] });
  const s1 = H.kaeru(s0, { config: kaeta(1500), dare: 'x@example.com', itsu: 1756400000000 });
  if (H.kiroku(s1).length !== 1) return '記録が 1件に なっていない';
  const k = H.kiroku(s1)[0];
  const tarinai = ['itsu', 'dare', 'mae', 'ato'].filter((x) => k[x] == null);
  return tarinai.length ? '足りない: ' + tarinai.join(',') : true;
});

// ── ② 戻すと 前の「金額」に 戻る（★金額で 確かめる★）──
miru('② 戻すと 前の「金額」に 戻る（設定の中身だけ 見ない）', function () {
  const H = honntai();
  const s0 = H.hajime({ config: utsushi(KITEI), records: [] });
  const maeEn = meterYomu(H.ima(s0)).calcFare(5000);
  const s1 = H.kaeru(s0, { config: kaeta(1500), dare: 'x@example.com', itsu: 1756400000000 });
  const atoEn = meterYomu(H.ima(s1)).calcFare(5000);
  if (atoEn === maeEn) return '変えたのに 金額が 変わっていない（' + maeEn + '円のまま）';
  const s2 = H.modosu(s1, { dare: 'x@example.com', itsu: 1756400001000 });
  const modoshiEn = meterYomu(H.ima(s2)).calcFare(5000);
  return modoshiEn === maeEn ? true : '戻したのに ' + modoshiEn + '円（前は ' + maeEn + '円）';
});

// ── ③ 戻した事も 記録に 残る ──
miru('③ 戻した事も 記録に 残る', function () {
  const H = honntai();
  const s1 = H.kaeru(H.hajime({ config: utsushi(KITEI), records: [] }), {
    config: kaeta(1500),
    dare: 'x@example.com',
    itsu: 1,
  });
  const s2 = H.modosu(s1, { dare: 'y@example.com', itsu: 2 });
  const k = H.kiroku(s2);
  if (k.length !== 2) return '記録が ' + k.length + '件（戻した分が 残っていない）';
  return k[k.length - 1].dare === 'y@example.com' ? true : '戻した人が 記録に 残っていない';
});

// ── ④ 走行中は 変えられない／戻せない ──
miru('④ 走行中は 変えられない／戻せない', function () {
  const H = honntai();
  const s1 = H.hajime({ config: utsushi(KITEI), records: [], soukouchuu: true });
  let ugoita = false;
  try {
    const s2 = H.kaeru(s1, { config: kaeta(1500), dare: 'x', itsu: 1 });
    ugoita = H.ima(s2).base_fare !== KITEI.base_fare;
  } catch (_) {
    ugoita = false; // 断るのも 正しい
  }
  return ugoita ? '走行中なのに 料金が 変わった' : true;
});

// ── ⑤ 過去の請求は 1円も 動かない（写しが 効いている裏取り）──
miru('⑤ 過去の請求は 1円も 動かない（写しで 計算する）', function () {
  const H = honntai();
  const s0 = H.hajime({ config: utsushi(KITEI), records: [] });
  const kako = { distance_m: 5000, snapshot: utsushi(KITEI) };
  const mae = meterYomu(kako.snapshot).calcFare(kako.distance_m);
  H.kaeru(s0, { config: kaeta(9999), dare: 'x', itsu: 1 });
  const ato = meterYomu(kako.snapshot).calcFare(kako.distance_m);
  return mae === ato ? true : '過去の請求が ' + mae + '円 → ' + ato + '円 に 動いた';
});

// ── ⑥ 記録が 0件でも 緑に しない（何件で 確かめたかを 数える）──
miru('⑥ 0件で 緑に しない（数えた件数を 出す）', function () {
  const H = honntai();
  let s = H.hajime({ config: utsushi(KITEI), records: [] });
  for (let i = 0; i < 5; i++) {
    s = H.kaeru(s, { config: kaeta(1300 + i * 10), dare: 'x', itsu: i + 1 });
  }
  const n = H.kiroku(s).length;
  return n === 5 ? true : '5回 変えたのに 記録が ' + n + '件';
});

// ── ⑦ 記録に お客さんの情報が 入っていない ──
miru('⑦ 記録に お客さんの情報が 入っていない', function () {
  const H = honntai();
  const s = H.kaeru(H.hajime({ config: utsushi(KITEI), records: [] }), {
    config: kaeta(1500),
    dare: 'x@example.com',
    itsu: 1,
  });
  const moji = JSON.stringify(H.kiroku(s));
  const NG = ['customer', 'kokyaku', '顧客', 'tel', '電話', 'address', '住所', 'trip', '運行'];
  const dame = NG.filter((w) => moji.indexOf(w) >= 0);
  return dame.length ? 'お客さんの情報らしい語が 入っている: ' + dame.join(',') : true;
});

// ── ⑧ 21件目を 入れても 20件のまま＋★落ちた事が 分かる★（指示役の条件1）──
miru('⑧ 21件目で 20件のまま＋★落ちた事が 分かる★（黙って 消えない）', function () {
  const H = honntai();
  let s = H.hajime({ config: utsushi(KITEI), records: [] });
  for (let i = 0; i < 21; i++) {
    s = H.kaeru(s, { config: kaeta(1300 + i), dare: 'x', itsu: i + 1 });
  }
  const k = H.kiroku(s);
  if (k.length !== MAX_KEN)
    return '記録が ' + k.length + '件（' + MAX_KEN + '件で 止まっていない）';
  const ochita = typeof H.ochitaKensuu === 'function' ? H.ochitaKensuu(s) : null;
  if (ochita == null) return '★落ちた件数を 数えていない（黙って 消える）★';
  return ochita === 1 ? true : '落ちた件数が ' + ochita + '（1のはず）';
});

// ── ⑨ 書き出す物（客に見える物）に メールが 1件も 出ない（指示役の条件2）──
miru('⑨ 書き出す物に メールが 1件も 出ない', function () {
  const H = honntai();
  const s = H.kaeru(H.hajime({ config: utsushi(KITEI), records: [] }), {
    config: kaeta(1500),
    dare: 'shachou@example.com',
    itsu: 1,
  });
  if (typeof H.kakidasu !== 'function') return '★書き出す物を 作る所が 無い（作る時に 足す）★';
  const moji = JSON.stringify(H.kakidasu(s));
  return /@/.test(moji) ? '★書き出す物に メールが 出ている★' : true;
});

// ── 結び ──
console.log('===========================================================');
console.log('★料金の「変えた記録」と「戻す」ゲート★（試験を 先に 書いた物）');
console.log('  ★本体 js/fare-history.js は まだ 作っていません＝★赤が 正しい★★');
console.log('  ★線を 緩めて 緑にするのは 不可★（それをやると 何も見ていない緑）');
console.log('===========================================================');
kekka.forEach(function (k) {
  console.log('  ' + (k.ok ? 'PASS  ' : '★FAIL★') + ' ' + k.namae + (k.ok ? '' : '  … ' + k.riyuu));
});
const aka = kekka.filter(function (k) {
  return !k.ok;
}).length;
console.log('');
console.log('★見た本数 = ' + kekka.length + ' 本／赤 = ' + aka + ' 本★');
if (kekka.length !== 9) {
  console.error('★9本 見ていません（' + kekka.length + '本）＝数え落とし★');
  process.exit(1);
}
console.log(
  aka === 0
    ? '★GATE PASS★ — 記録と 戻すが 全部 出来ています。'
    : '★GATE FAIL★ — ' + aka + '本 まだ 出来ていません（★試験が先＝この赤は 正しい★）。'
);
process.exit(aka === 0 ? 0 : 1);
