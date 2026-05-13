#!/usr/bin/env node
/**
 * fetch-bundle-data.js
 *
 * 全13種の bundle build を順次実行し、サイズ・件数レポートを出す
 * オーケストレータ。
 *
 * 使い方:
 *   node scripts/fetch-bundle-data.js [--skip-coarse] [--only=misc,airports]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const SCRIPTS = [
  // [スクリプトファイル名, 出力ファイル, ティア]
  ['build-bundle-misc-jp.js',              'misc-jp.js',              'Tier1'],
  ['build-bundle-coarse-jp.js',            'coarse-jp.js',            'Tier1'],
  ['build-bundle-pref-borders-jp.js',      'pref-borders-jp.js',      'Tier1'],
  ['build-bundle-shelters-jp.js',          'shelters-jp.js',          'Tier1'],
  ['build-bundle-emergency-medical-jp.js', 'emergency-medical-jp.js', 'Tier1'],
  ['build-bundle-highways-jp.js',          'highways-jp.js',          'Tier1'],
  ['build-bundle-stations-jp.js',          'stations-jp.js',          'Tier1'],
  ['build-bundle-faults-jp.js',            'faults-jp.js',            'Tier2'],
  ['build-bundle-night-clinics-jp.js',     'night-clinics-jp.js',     'Tier2'],
  ['build-bundle-airports-jp.js',          'airports-jp.js',          'Tier2'],
  ['build-bundle-michinoeki-jp.js',        'michinoeki-jp.js',        'Tier2'],
  ['build-bundle-coastline-jp.js',         'coastline-jp.js',         'Tier2'],
  ['build-bundle-ports-jp.js',             'ports-jp.js',             'Tier2'],
];

// CLI オプション
const args = process.argv.slice(2);
const skipCoarse = args.includes('--skip-coarse');
const onlyArg = args.find(a => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',') : null;

console.log('=========================================');
console.log('  Bundle Data Builder - 全13種');
console.log('=========================================');

const results = [];
let totalKB = 0;
const startTime = Date.now();

for (const [script, outputFile, tier] of SCRIPTS) {
  // フィルタリング
  if (skipCoarse && script.includes('coarse')) {
    console.log(`\n⏭️  ${script}（--skip-coarse でスキップ）`);
    continue;
  }
  if (only && !only.some(name => script.includes(name) || outputFile.includes(name))) {
    continue;
  }

  console.log(`\n━━━ ${tier}: ${script} ━━━`);
  const t0 = Date.now();
  try {
    const stdout = execFileSync('node', [path.join(__dirname, script)], {
      cwd: PROJECT_ROOT, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024,
    });
    process.stdout.write(stdout);
    const outPath = path.join(PROJECT_ROOT, 'data', outputFile);
    if (fs.existsSync(outPath)) {
      const size = fs.statSync(outPath).size;
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      results.push({ script, output: outputFile, tier, size, elapsed, ok: true });
      totalKB += size / 1024;
    } else {
      results.push({ script, output: outputFile, tier, size: 0, elapsed: '?', ok: false, reason: 'no output' });
    }
  } catch (e) {
    console.error(`❌ ${script} 失敗: ${e.message}`);
    results.push({ script, output: outputFile, tier, size: 0, elapsed: '?', ok: false, reason: e.message });
  }
}

const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

console.log('\n');
console.log('=========================================');
console.log('  最終レポート');
console.log('=========================================');
console.log(`所要時間: ${totalElapsed}秒`);
console.log();
console.log('Tier  | File                          | Size       | Elapsed | Status');
console.log('------+-------------------------------+------------+---------+--------');
for (const r of results) {
  const st = r.ok ? '✅' : '❌';
  const sz = r.size ? `${(r.size/1024).toFixed(1)} KB` : '0';
  console.log(`${r.tier.padEnd(5)} | ${r.output.padEnd(29)} | ${sz.padStart(10)} | ${r.elapsed.padStart(6)}s | ${st}`);
}
console.log('------+-------------------------------+------------+---------+--------');
console.log(`合計サイズ: ${(totalKB/1024).toFixed(2)} MB`);
console.log(`成功: ${results.filter(r => r.ok).length} / ${results.length}`);
