// ============================================================
// scripts/last-red.mjs
// ★直前のテスト実行で赤だったものの「名前」を出す★ 2026-08-02
//
//   ★なぜ作ったか（実際に困った）★
//     npm run test が1回だけ赤になったのに、
//     ★出力を絞り込んで見ていたせいでテスト名を取り逃した★。
//     そのあと7回連続で緑になり、どれが赤だったのか永久に分からなくなった。
//     「揺らぎ」で片付けてはいけないのに、片付けるしかない状態を自分で作った。
//
//   → npm run test は必ず結果を data/test-results/last-run.json に残す。
//     赤が出たら  npm run test:names  で名前・ファイル・エラーが分かる。
//
//   ※このファイルは読むだけ。何も直さない。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = path.join(ROOT, 'data', 'test-results', 'last-run.json');

if (!fs.existsSync(F)) {
  console.error('まだ結果がありません。先に npm run test を走らせてください。');
  process.exitCode = 2;
} else {
  const j = JSON.parse(fs.readFileSync(F, 'utf8'));
  const reds = [];
  for (const suite of j.testResults || []) {
    for (const t of suite.assertionResults || []) {
      if (t.status === 'failed') {
        reds.push({
          file: path.relative(ROOT, suite.name || ''),
          name: [...(t.ancestorTitles || []), t.title].join(' > '),
          why: (t.failureMessages || [])[0] || '',
        });
      }
    }
  }
  if (!reds.length) {
    console.log('直前の実行に赤はありません。');
    console.log(`（${j.numPassedTests} 緑 / ${j.numTotalTests} 件）`);
  } else {
    console.log(`★赤 ${reds.length} 件★`);
    reds.forEach((r, i) => {
      console.log(`\n${i + 1}. ${r.name}`);
      console.log('   ' + r.file);
      console.log(
        '   ' +
          String(r.why)
            .split('\n')
            .slice(0, 4)
            .join('\n   ')
      );
    });
    process.exitCode = 1;
  }
}
