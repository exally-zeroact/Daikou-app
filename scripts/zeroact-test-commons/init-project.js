#!/usr/bin/env node
/* eslint-env node */

// ============================================================
// scripts/zeroact-test-commons/init-project.js
// ZEROact 共通テスト基盤 横展開基盤 ⑦/8 (2026-05-18 新規)
//
// 目的: 新 PJ で zeroact.config.<project>.yml を読込んで以下を自動生成
//       ・.github/workflows/ (= project.type に応じて選別)
//       ・semgrep-rules/<project>/ ディレクトリ
//       ・package.json scripts 追加
//       ・初期 README (= PJ 固有絶対ルール記載)
//
// 使い方:
//   dry-run (= preview のみ・default):
//     node scripts/zeroact-test-commons/init-project.js \
//       --config zeroact.config.<project>.yml
//
//   apply (= 実適用):
//     node scripts/zeroact-test-commons/init-project.js \
//       --config zeroact.config.<project>.yml --apply
//
//   force (= 既存ファイル上書き許可・dangerous):
//     ... --apply --force
//
// 安全機構:
//   1. dry-run default (= --apply で初めて実行)
//   2. 既存ファイル上書きしない (= --force で override)
//   3. Daikou-app-test 自身での実行検出して中断
//   4. git tree dirty で警告 (= --force で続行)
//   5. apply 時に .zeroact-init-rollback.json で変更ファイル list 出力
// ============================================================

const fs = require('fs');
const path = require('path');

const COMMONS_DIR = __dirname;
const PROJECT_TYPES = require(path.join(COMMONS_DIR, 'configs', 'project-types.js'));
const TEMPLATES_DIR = path.join(COMMONS_DIR, 'workflow-templates');

function parseArgs(argv) {
  const args = { config: null, apply: false, force: false, targetDir: process.cwd() };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--config') args.config = argv[++i];
    else if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--target-dir') args.targetDir = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
Usage:
  node init-project.js --config <yml> [--apply] [--force] [--target-dir <dir>]

Options:
  --config <yml>      PJ 設定 yml ファイル (必須)
  --apply             実適用 (= dry-run なし)
  --force             既存ファイル上書き許可 + git dirty で続行
  --target-dir <dir>  操作対象 dir (default: cwd)
  --help / -h         このヘルプを表示

Supported project types:
${Object.keys(PROJECT_TYPES)
  .map((t) => '  ' + t + ': ' + PROJECT_TYPES[t].description)
  .join('\n')}
`);
}

// 簡易 yml parser (= project セクションだけ抽出)
// 完全 yml 対応は js-yaml 等が必要だが、init 段階で必要なのは project.name / type のみ
function readSimpleYaml(filePath) {
  // Windows CRLF を normalize してから regex match
  const content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const result = { project: {} };
  // 'project:' セクションを正規表現で抽出
  const m = content.match(/^project:\s*\n((?:[ \t]+.+\n)+)/m);
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^[ \t]+(\w+):\s*["']?([^"'\n]*?)["']?\s*$/);
      if (kv?.[2]) result.project[kv[1]] = kv[2].trim();
    }
  }
  return result;
}

function detectSelfRepo(targetDir) {
  // Daikou-app-test 自身での実行を検出 (= js/meter.js + scripts/zeroact-test-commons/init-project.js 同居)
  const meterPath = path.join(targetDir, 'js', 'meter.js');
  const initPath = path.join(targetDir, 'scripts', 'zeroact-test-commons', 'init-project.js');
  return fs.existsSync(meterPath) && fs.existsSync(initPath);
}

function gitTreeClean(targetDir) {
  try {
    const { execSync } = require('child_process');
    const out = execSync('git status --porcelain', { cwd: targetDir, encoding: 'utf8' });
    return out.trim() === '';
  } catch (_e) {
    return null; // git 不在 / git repo でない
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function renderTemplate(tpl, vars) {
  let out = tpl;
  for (const key of Object.keys(vars)) {
    out = out.split('{{' + key + '}}').join(vars[key]);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.config) {
    console.error('[init-project] --config <yml> is required');
    printHelp();
    process.exit(1);
  }

  if (!fs.existsSync(args.config)) {
    console.error('[init-project] config not found: ' + args.config);
    process.exit(1);
  }

  // 安全機構 1: Daikou-app-test 自身での実行を検出
  if (detectSelfRepo(args.targetDir)) {
    console.error(
      '[init-project] ★ Daikou-app-test 自身での実行は禁止 (= 既に setup 済の repo を破壊するリスク)'
    );
    console.error('               --target-dir で別 dir を指定してください');
    process.exit(2);
  }

  // 安全機構 2: git tree clean check
  const clean = gitTreeClean(args.targetDir);
  if (clean === false && !args.force) {
    console.error('[init-project] ★ git working tree dirty 検出・--force で続行可能');
    console.error('               clean state で実行することを強く推奨');
    process.exit(3);
  }

  // PJ config 読込
  const config = readSimpleYaml(args.config);
  if (!config.project.name || !config.project.type) {
    console.error('[init-project] config に project.name / project.type 必須');
    process.exit(4);
  }

  const projectType = PROJECT_TYPES[config.project.type];
  if (!projectType) {
    console.error(
      '[init-project] unknown project.type: ' +
        config.project.type +
        ' (= supported: ' +
        Object.keys(PROJECT_TYPES).join(' / ') +
        ')'
    );
    process.exit(5);
  }

  console.log('[init-project] mode: ' + (args.apply ? 'APPLY' : 'DRY-RUN'));
  console.log('[init-project] project: ' + config.project.name + ' (' + config.project.type + ')');
  console.log('[init-project] target dir: ' + args.targetDir);
  console.log('[init-project] workflows to generate: ' + projectType.workflows.join(' / '));

  const rollbackList = [];
  const vars = { PROJECT_NAME: config.project.name };

  // 1. .github/workflows/<workflow>.yml 生成
  const workflowsDir = path.join(args.targetDir, '.github', 'workflows');
  for (const wf of projectType.workflows) {
    const tplPath = path.join(TEMPLATES_DIR, wf + '.yml.tpl');
    if (!fs.existsSync(tplPath)) {
      console.warn('[init-project] template not found: ' + tplPath + ' (skip)');
      continue;
    }
    const dest = path.join(workflowsDir, wf + '.yml');
    if (fs.existsSync(dest) && !args.force) {
      console.log('[init-project] [SKIP] existing: ' + dest);
      continue;
    }
    const tpl = fs.readFileSync(tplPath, 'utf8');
    const rendered = renderTemplate(tpl, vars);
    if (args.apply) {
      ensureDir(workflowsDir);
      fs.writeFileSync(dest, rendered);
      console.log('[init-project] [CREATE] ' + dest);
      rollbackList.push({ action: 'created', path: dest });
    } else {
      console.log('[init-project] [DRY] would create: ' + dest);
    }
  }

  // 2. semgrep-rules/<project>/ ディレクトリ
  const semgrepDir = path.join(
    args.targetDir,
    'scripts',
    'zeroact-test-commons',
    'semgrep-rules',
    config.project.name
  );
  if (!fs.existsSync(semgrepDir)) {
    if (args.apply) {
      ensureDir(semgrepDir);
      const readme = path.join(semgrepDir, 'README.md');
      fs.writeFileSync(
        readme,
        '# Semgrep rules for ' +
          config.project.name +
          '\n\n本ディレクトリに ' +
          config.project.name +
          ' 固有 Semgrep rule (.yml) を追加してください。\n' +
          'reference: scripts/zeroact-test-commons/semgrep-rules/daikome/distance-m-no-gps-line.yml\n'
      );
      console.log('[init-project] [CREATE] ' + semgrepDir + ' (with README.md)');
      rollbackList.push({ action: 'created', path: semgrepDir });
    } else {
      console.log('[init-project] [DRY] would create: ' + semgrepDir);
    }
  } else {
    console.log('[init-project] [SKIP] existing: ' + semgrepDir);
  }

  // 3. package.json scripts 追加
  const pkgPath = path.join(args.targetDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.scripts = pkg.scripts || {};
    const newScripts = {
      'audit:semgrep':
        'semgrep --config scripts/zeroact-test-commons/semgrep-rules/' +
        config.project.name +
        '/ .',
      'audit:knip': 'knip --no-exit-code',
      'audit:deps': 'dependency-cruiser --config dependency-cruiser.config.mjs .',
      'audit:biome': 'biome check .',
      'test:property': 'vitest run tests/property',
      'test:e2e': 'playwright test',
    };
    let modified = false;
    for (const k of Object.keys(newScripts)) {
      if (!pkg.scripts[k]) {
        if (args.apply) {
          pkg.scripts[k] = newScripts[k];
          modified = true;
          console.log('[init-project] [ADD] script ' + k);
        } else {
          console.log('[init-project] [DRY] would add script: ' + k);
        }
      } else {
        console.log('[init-project] [SKIP] existing script: ' + k);
      }
    }
    if (args.apply && modified) {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      rollbackList.push({ action: 'modified', path: pkgPath });
    }
  } else {
    console.warn('[init-project] package.json not found・scripts 追加 skip');
  }

  // 4. 初期 README.md
  const initialReadme = path.join(args.targetDir, 'TEST-FOUNDATION-README.md');
  if (!fs.existsSync(initialReadme)) {
    const content =
      '# ' +
      config.project.name +
      ' Test Foundation\n\n' +
      'このプロジェクトは ZEROact 共通テスト基盤 (zeroact-test-commons) を使用しています。\n\n' +
      '## 設定\n\n' +
      '- 設定ファイル: `' +
      args.config +
      '`\n' +
      '- project.type: `' +
      config.project.type +
      '`\n' +
      '- 自動生成 workflow: ' +
      projectType.workflows.join(' / ') +
      '\n\n' +
      '## 使い方\n\n' +
      '```bash\n' +
      'npm run audit:semgrep    # ' +
      config.project.name +
      ' 固有 Semgrep rule 実行\n' +
      'npm run test:property    # fast-check property test\n' +
      'npm run test:e2e         # Playwright E2E\n' +
      '```\n\n' +
      '## 関連ドキュメント\n\n' +
      '- 用語集: `scripts/zeroact-test-commons/glossary.yml`\n' +
      '- 設定テンプレート: `scripts/zeroact-test-commons/zeroact.config.template.yml`\n';
    if (args.apply) {
      fs.writeFileSync(initialReadme, content);
      console.log('[init-project] [CREATE] ' + initialReadme);
      rollbackList.push({ action: 'created', path: initialReadme });
    } else {
      console.log('[init-project] [DRY] would create: ' + initialReadme);
    }
  } else {
    console.log('[init-project] [SKIP] existing: ' + initialReadme);
  }

  // 5. rollback list 出力 (apply 時のみ)
  if (args.apply) {
    const rollbackPath = path.join(args.targetDir, '.zeroact-init-rollback.json');
    fs.writeFileSync(
      rollbackPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          config: args.config,
          project: config.project,
          changes: rollbackList,
        },
        null,
        2
      )
    );
    console.log('[init-project] rollback list: ' + rollbackPath);
  }

  console.log(
    '\n[init-project] ' + (args.apply ? 'APPLIED ' : 'DRY-RUN ') + rollbackList.length + ' changes'
  );
  if (!args.apply) {
    console.log('[init-project] To apply, re-run with --apply');
  }
}

main();
