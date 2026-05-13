#!/usr/bin/env node
// 47県の POI 統計レポート用一発スクリプト
const fs = require('fs');
const path = require('path');
const { CATEGORIES } = require('./poi-categories.js');

const DATA = path.join(__dirname, '..', 'data');
const files = fs.readdirSync(DATA).filter(f => /^poi-.+\.js$/.test(f)).sort();

const REGIONS = {
  hokkaido: ['hokkaido'],
  tohoku:   ['aomori','iwate','miyagi','akita','yamagata','fukushima'],
  kanto:    ['ibaraki','tochigi','gunma','saitama','chiba','tokyo','kanagawa'],
  chubu:    ['niigata','toyama','ishikawa','fukui','yamanashi','nagano','gifu','shizuoka','aichi'],
  kansai:   ['mie','shiga','kyoto','osaka','hyogo','nara','wakayama'],
  chugoku:  ['tottori','shimane','okayama','hiroshima','yamaguchi'],
  shikoku:  ['tokushima','kagawa','ehime','kochi'],
  kyushu:   ['fukuoka','saga','nagasaki','kumamoto','oita','miyazaki','kagoshima','okinawa'],
};
const PREF_TO_REGION = {};
for (const r of Object.keys(REGIONS)) for (const p of REGIONS[r]) PREF_TO_REGION[p] = r;

const stats = {};
let grandTotal = 0, grandSize = 0;
const allCatIds = Object.keys(CATEGORIES).map(Number);

for (const file of files) {
  const pref = file.replace(/^poi-|\.js$/g, '');
  const filePath = path.join(DATA, file);
  const text = fs.readFileSync(filePath, 'utf8');
  const m = text.match(/window\.[A-Z_]+ = (\{[\s\S]*\});/);
  if (!m) { console.error('parse fail:', file); continue; }
  const o = JSON.parse(m[1]);
  const size = fs.statSync(filePath).size;
  const total = (o.pois || []).length;
  const byCat = {};
  for (const p of o.pois) byCat[p.c] = (byCat[p.c] || 0) + 1;
  const zeroCats = allCatIds.filter(id => !byCat[id]).map(id => CATEGORIES[id]);
  stats[pref] = { region: PREF_TO_REGION[pref], total, size, byCat, zeroCats };
  grandTotal += total;
  grandSize += size;
}

console.log('===== 47県 総計 =====');
console.log(`県数: ${files.length}`);
console.log(`総POI数: ${grandTotal.toLocaleString()}`);
console.log(`総サイズ: ${(grandSize/1024/1024).toFixed(2)} MB`);
console.log(`平均: ${Math.round(grandTotal/files.length).toLocaleString()} POI / 県, ${(grandSize/files.length/1024).toFixed(1)} KB / 県`);

console.log('\n===== 地方別集計 =====');
for (const r of Object.keys(REGIONS)) {
  const prefs = REGIONS[r];
  let t = 0, s = 0;
  for (const p of prefs) if (stats[p]) { t += stats[p].total; s += stats[p].size; }
  console.log(`${r.padEnd(10)} ${prefs.length}県 / ${t.toLocaleString().padStart(10)} POI / ${(s/1024/1024).toFixed(2)} MB`);
}

console.log('\n===== 県別 (件数 desc) =====');
const sorted = Object.entries(stats).sort((a,b) => b[1].total - a[1].total);
for (const [pref, st] of sorted) {
  const sizeKB = (st.size / 1024).toFixed(1);
  console.log(`  ${pref.padEnd(12)} ${st.region.padEnd(10)} ${st.total.toLocaleString().padStart(8)} POI  ${sizeKB.padStart(8)} KB  zero-cats=${st.zeroCats.length}`);
}

console.log('\n===== 0件カテゴリのある県 =====');
const zeroCatPrefs = Object.entries(stats).filter(([_, s]) => s.zeroCats.length > 0)
  .sort((a,b) => b[1].zeroCats.length - a[1].zeroCats.length);
for (const [pref, st] of zeroCatPrefs) {
  console.log(`  ${pref.padEnd(12)} 0件カテゴリ数=${st.zeroCats.length}: ${st.zeroCats.join(', ')}`);
}
console.log(`\n0件カテゴリある県の数: ${zeroCatPrefs.length} / 47`);
console.log(`全47県で0件のカテゴリ:`);
for (const id of allCatIds) {
  let presentIn = 0;
  for (const pref of Object.keys(stats)) if (stats[pref].byCat[id]) presentIn++;
  if (presentIn === 0) console.log(`  ${CATEGORIES[id]} (id=${id}): 全47県で0件`);
}

console.log('\n===== カテゴリ別 全国合計 =====');
const catTotals = {};
for (const pref of Object.keys(stats)) {
  for (const [id, n] of Object.entries(stats[pref].byCat)) {
    catTotals[id] = (catTotals[id] || 0) + n;
  }
}
const catSorted = Object.entries(catTotals).sort((a,b) => b[1] - a[1]);
for (const [id, n] of catSorted) {
  console.log(`  [${id.padStart(3)}] ${CATEGORIES[id].padEnd(20)} ${n.toLocaleString().padStart(8)}`);
}
