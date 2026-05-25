#!/usr/bin/env node
/* eslint-env node */

// ============================================================
// scripts/zeroact-test-commons/observability/error-analyzer.js
// ZEROact 共通テスト基盤 Stage 6 (2026-05-18 新規)
//
// 目的: Sentry API からエラー一覧を取得し distance_m / fare_yen 関連を優先抽出。
//       結果を GitHub Actions Summary に出力する (= chaos.yml と連動可)。
//
// トリガー想定:
//   ・chaos.yml の朝バッチ (= 毎日 JST 0:00) と連動
//   ・別途 workflow から `node error-analyzer.js` で起動
//
// 必要環境変数:
//   SENTRY_AUTH_TOKEN   Sentry Personal Auth Token (= sentry.io org settings)
//   SENTRY_ORG          Sentry org slug (例: zeroact)
//   SENTRY_PROJECT      Sentry project slug (例: daikome)
//   GITHUB_STEP_SUMMARY GitHub Actions が自動設定 (= summary 出力先)
//
// 出力:
//   stdout    人間可読サマリ
//   $GITHUB_STEP_SUMMARY  Markdown 形式の summary (= GitHub Actions UI 表示用)
//   error-analyzer-report.json artifact
// ============================================================

const fs = require('fs');

const TOKEN = process.env.SENTRY_AUTH_TOKEN;
const ORG = process.env.SENTRY_ORG || 'zeroact';
const PROJECT = process.env.SENTRY_PROJECT || 'daikome';
const SUMMARY_PATH = process.env.GITHUB_STEP_SUMMARY;

const BILLING_KEYWORDS = [
  'distance_m',
  'business_distance_m',
  'fare_yen',
  'calcFare',
  'mmIncrementM',
];

async function fetchSentryIssues() {
  if (!TOKEN) return { error: 'SENTRY_AUTH_TOKEN 未設定' };
  const url =
    'https://sentry.io/api/0/projects/' +
    encodeURIComponent(ORG) +
    '/' +
    encodeURIComponent(PROJECT) +
    '/issues/?statsPeriod=24h&query=is:unresolved';
  try {
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + TOKEN },
    });
    if (!res.ok) {
      return { error: 'Sentry API ' + res.status + ': ' + (await res.text()).slice(0, 300) };
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      return { error: 'unexpected response shape: ' + JSON.stringify(data).slice(0, 200) };
    }
    return { issues: data };
  } catch (e) {
    return { error: 'fetch failed: ' + e.message };
  }
}

function isBillingRelevant(issue) {
  const haystack = (
    (issue.title || '') +
    ' ' +
    (issue.culprit || '') +
    ' ' +
    (issue.metadata?.value || '')
  ).toLowerCase();
  return BILLING_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()));
}

function summarize(issues) {
  const billing = [];
  const other = [];
  for (const issue of issues) {
    if (isBillingRelevant(issue)) billing.push(issue);
    else other.push(issue);
  }
  // 件数降順
  billing.sort((a, b) => (b.count || 0) - (a.count || 0));
  other.sort((a, b) => (b.count || 0) - (a.count || 0));
  return { billing, other };
}

function renderMarkdown(billing, other, totalIssues) {
  const lines = [];
  lines.push('## 🔬 Sentry Error Analyzer (24h)');
  lines.push('');
  lines.push('- **Total issues:** ' + totalIssues);
  lines.push('- **Billing-related:** ' + billing.length + ' (priority)');
  lines.push('- **Other:** ' + other.length);
  lines.push('');
  if (billing.length > 0) {
    lines.push('### ⚠️ Billing-related issues (priority)');
    lines.push('');
    lines.push('| # | count | title | culprit |');
    lines.push('|---|------:|-------|---------|');
    billing.slice(0, 20).forEach((issue, i) => {
      const t = (issue.title || '').replace(/\|/g, '\\|').slice(0, 120);
      const c = (issue.culprit || '').replace(/\|/g, '\\|').slice(0, 80);
      lines.push('| ' + (i + 1) + ' | ' + (issue.count || 0) + ' | ' + t + ' | ' + c + ' |');
    });
    lines.push('');
  }
  if (other.length > 0) {
    lines.push('### Other issues (top 10)');
    lines.push('');
    lines.push('| # | count | title |');
    lines.push('|---|------:|-------|');
    other.slice(0, 10).forEach((issue, i) => {
      const t = (issue.title || '').replace(/\|/g, '\\|').slice(0, 120);
      lines.push('| ' + (i + 1) + ' | ' + (issue.count || 0) + ' | ' + t + ' |');
    });
  }
  if (billing.length === 0 && other.length === 0) {
    lines.push('🎉 No unresolved issues in last 24h.');
  }
  return lines.join('\n');
}

function writeSummary(md) {
  console.log(md);
  if (SUMMARY_PATH) {
    try {
      fs.appendFileSync(SUMMARY_PATH, md + '\n');
    } catch (e) {
      console.warn('[error-analyzer] failed to write summary: ' + e.message);
    }
  }
}

async function main() {
  const result = await fetchSentryIssues();
  if (result.error) {
    const errMd = '## 🔬 Sentry Error Analyzer\n\n⚠️ Execution error: ' + result.error;
    writeSummary(errMd);
    fs.writeFileSync(
      'error-analyzer-report.json',
      JSON.stringify({ error: result.error, timestamp: new Date().toISOString() }, null, 2)
    );
    process.exit(1);
  }
  const { billing, other } = summarize(result.issues);
  const md = renderMarkdown(billing, other, result.issues.length);
  writeSummary(md);
  fs.writeFileSync(
    'error-analyzer-report.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        org: ORG,
        project: PROJECT,
        total: result.issues.length,
        billing_count: billing.length,
        other_count: other.length,
        billing,
        other_top10: other.slice(0, 10),
      },
      null,
      2
    )
  );
  // 課金関連がある場合は exit 1 (= alert)
  if (billing.length > 0) {
    console.error('[error-analyzer] BILLING-related issues detected: ' + billing.length);
    process.exit(1);
  }
  process.exit(0);
}

main();
