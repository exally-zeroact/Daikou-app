#!/usr/bin/env node
/* eslint-env node */

// ============================================================
// scripts/zeroact-test-commons/ai/ai-bug-hunter.js
// ZEROact 共通テスト基盤 Stage 5 (2026-05-18 新規)
//
// 目的: 週次バグ探索 (= 静的解析 + property + e2e で見つからない未知バグを LLM で探索)。
//       known-issues/ + bug-patterns/ をコンテキストとして与え
//       js/meter.js + js/map-matcher.js + js/gps-worker.js を解析させる。
//
// トリガー: .github/workflows/bug-hunter.yml (= 週次 schedule)
//
// 必要環境変数:
//   ANTHROPIC_API_KEY  Claude API キー
//
// 司さん指示モデル: claude-sonnet-4-20250514 (= Stage 5 prompt 指定)
//   ※ 現状の最新 Sonnet は claude-sonnet-4-5 系・指示 ID が無効なら
//      レスポンスから fallback 検出する設計にしている
//
// 出力: bug-hunt-report.json
//   {
//     risks: [{ severity, category, location, description, recommendation }],
//     summary: "..."
//   }
// ============================================================

const fs = require('fs');
const path = require('path');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

const TARGET_FILES = ['js/meter.js', 'js/map-matcher.js', 'js/gps-worker.js'];

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (_e) {
    return null;
  }
}

function loadContext(dir, maxBytes) {
  const root = path.join(__dirname, '..', dir);
  if (!fs.existsSync(root)) return '(' + dir + ' unavailable)';
  const files = fs.readdirSync(root).filter((f) => f.endsWith('.yml'));
  const parts = [];
  let used = 0;
  for (const f of files) {
    const content = readFileSafe(path.join(root, f));
    if (!content) continue;
    const slice = content.slice(0, 2000);
    if (used + slice.length > maxBytes) break;
    parts.push('--- ' + f + ' ---\n' + slice);
    used += slice.length;
  }
  return parts.join('\n\n');
}

function loadTargetFile(rel) {
  const p = path.join(process.cwd(), rel);
  const content = readFileSafe(p);
  if (!content) return '(' + rel + ' unavailable)';
  // truncate でかいファイルは前半 + 後半に分けて proxy
  if (content.length > 30000) {
    return content.slice(0, 15000) + '\n... (truncated middle) ...\n' + content.slice(-15000);
  }
  return content;
}

async function callAnthropic(prompt) {
  if (!ANTHROPIC_KEY) return { error: 'ANTHROPIC_API_KEY 未設定' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      return { error: 'Anthropic API ' + res.status + ': ' + (await res.text()).slice(0, 500) };
    }
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    return { text };
  } catch (e) {
    return { error: 'Anthropic fetch failed: ' + e.message };
  }
}

async function main() {
  const knownIssues = loadContext('known-issues', 10000);
  const bugPatterns = loadContext('bug-patterns', 10000);
  const codeBlocks = TARGET_FILES.map((f) => '=== ' + f + ' ===\n' + loadTargetFile(f)).join(
    '\n\n'
  );

  const prompt = `あなたはダイコメ (代行運転 PWA メーター) の未知バグ探索エンジンです。
以下の過去事例とパターンを学習し、現コードに潜む未知バグを探してください。

過去事例 (known-issues/):
${knownIssues}

バグパターン (bug-patterns/):
${bugPatterns}

絶対ルール (要約):
- distance_m は課金根拠・絶対不可侵
- GPS 直線距離での課金は禁止 (適用外区間 sanitizer 除く)
- distance_m 更新経路は 5 つのみ (L393/L462/L824/L842/L1172)
- isStationary=true で distance_m 増加禁止
- business_distance_m は running=true のみ

調査対象コード:
${codeBlocks}

タスク: 上記コードから「絶対ルール違反の可能性」「過去事例と類似のリスク」を最大 10 個発見してください。
JSON 1 オブジェクトで返してください:
{
  "risks": [
    { "severity": "high|medium|low", "category": "...", "location": "file:Lxxx", "description": "...", "recommendation": "..." }
  ],
  "summary": "..."
}`;

  const result = await callAnthropic(prompt);
  if (result.error) {
    fs.writeFileSync(
      'bug-hunt-report.json',
      JSON.stringify({ error: result.error, risks: [], summary: 'execution failed' }, null, 2)
    );
    console.error('[ai-bug-hunter] ' + result.error);
    process.exit(1);
  }

  const match = result.text.match(/\{[\s\S]*\}/);
  let parsed;
  if (match) {
    try {
      parsed = JSON.parse(match[0]);
    } catch (e) {
      parsed = {
        risks: [],
        summary: 'JSON parse error: ' + e.message,
        _raw: result.text.slice(0, 1000),
      };
    }
  } else {
    parsed = { risks: [], summary: 'no JSON in response', _raw: result.text.slice(0, 1000) };
  }

  const output = Object.assign(
    { timestamp: new Date().toISOString(), model: ANTHROPIC_MODEL, target_files: TARGET_FILES },
    parsed
  );
  fs.writeFileSync('bug-hunt-report.json', JSON.stringify(output, null, 2));
  console.log('[ai-bug-hunter] risks=' + (parsed.risks ? parsed.risks.length : 0));
  console.log('[ai-bug-hunter] summary: ' + (parsed.summary || '(none)'));
  process.exit(0);
}

main();
