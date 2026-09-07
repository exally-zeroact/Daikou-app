// ============================================================
// ★★役割の 数字（歩合・最低保証）が どこでも 同じか★★ 2026-09-06
//
//   ★司さん★「2種の最低は1150円やが」
//
//   ★何が 起きていたか（実測 2026-09-06）★
//     テストの 種まき（supabase/seed-test-fake.sql）だけ
//       2種 … rate 0.25 / floor ★900★
//     本番と コードは
//       2種 … rate 0.35 / floor ★1150★
//     ⇒★★テストで 試しても 本番と 違う 答えに なる★★＝試した 意味が 薄い
//     ★名前は 2026-08-25 に そろえた（甲乙 → 1種2種）のに ★数字は そのまま★でした★
//     ⇒ 同じ ファイルに「★テスト環境を 本番に 合わせる★」と 書いてあるのに 守れていない。
//     ⇒ 人では 止まらないので 機械に 数えさせる。
//
//   ★★見る 範囲（先に 数えた）★★
//     役割の 数字が 書いてある ファイル … ★4本★
//       ①js/daiko-payroll.js …………★これが 元（既定）★
//       ②supabase/apply-shared-dk-payroll.sql … 倉庫の 既定
//       ③supabase/migrate-standalone.sql …… 倉庫の 既定（別の入れ方）
//       ④supabase/seed-test-fake.sql ……… テストの 種まき
//     ⇒ ★4本とも 同じ 数字か★ を 数えます。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①種まきの 2種を 900 に 戻す ……… ★赤★
//     ②コードの 2種を 1200 に する …… ★赤★
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// ★元（既定）★＝お客さんの 画面が 使う 1本
function motoNoSuuji() {
  const s = fs.readFileSync(path.join(ROOT, 'js', 'daiko-payroll.js'), 'utf8');
  const out = {};
  const re = /'(\d種)':\s*\{\s*rate:\s*([\d.]+),\s*floor:\s*(\d+)\s*\}/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = { rate: Number(m[2]), floor: Number(m[3]) };
  return out;
}

// ★SQL の 中の {"1種":{"rate":..,"floor":..},...} を 拾う★
function sqlNoSuuji(file) {
  const p = path.join(ROOT, 'supabase', file);
  if (!fs.existsSync(p)) return null;
  const s = fs.readFileSync(p, 'utf8');
  const out = {};
  const re = /"(\d種)"\s*:\s*\{\s*"rate"\s*:\s*([\d.]+)\s*,\s*"floor"\s*:\s*(\d+)\s*\}/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = { rate: Number(m[2]), floor: Number(m[3]) };
  return Object.keys(out).length ? out : null;
}

const SQL = [
  'apply-shared-dk-payroll.sql',
  'migrate-standalone.sql',
  'seed-test-fake.sql', // ★テストの 種まきも 同じ 数字で★
];

describe('★役割の 数字が どこでも 同じか★', () => {
  const moto = motoNoSuuji();

  it('★① 元（js/daiko-payroll.js）から 数字が 読める★', () => {
    expect(
      Object.keys(moto).length,
      '★役割の 数字が 読めません（書き方が 変わりました）★'
    ).toBeGreaterThan(0);
  });

  it('★② SQL の 数字が 元と 1つも 食い違わない★', () => {
    const chigau = [];
    SQL.forEach((f) => {
      const t = sqlNoSuuji(f);
      if (!t) {
        chigau.push(f + ' … ★役割の 数字が 見つかりません（書き方が 変わった？）★');
        return;
      }
      Object.keys(moto).forEach((k) => {
        const a = moto[k];
        const b = t[k];
        if (!b) {
          chigau.push(f + ' … ' + k + ' が ありません');
          return;
        }
        if (a.rate !== b.rate || a.floor !== b.floor) {
          chigau.push(
            f +
              ' … ' +
              k +
              ' 元(歩合 ' +
              a.rate +
              ' / 保証 ' +
              a.floor +
              ') ≠ こちら(歩合 ' +
              b.rate +
              ' / 保証 ' +
              b.floor +
              ')'
          );
        }
      });
    });
    expect(
      chigau,
      '★役割の 数字が 食い違っています★\n' +
        '  ⇒ ★テスト環境を 本番に 合わせる（逆は しない）★\n' +
        '  ⇒ 元は js/daiko-payroll.js です。'
    ).toEqual([]);
  });
});
