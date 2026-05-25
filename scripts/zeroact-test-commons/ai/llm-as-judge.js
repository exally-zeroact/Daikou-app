#!/usr/bin/env node
/* eslint-env node */

// ============================================================
// scripts/zeroact-test-commons/ai/llm-as-judge.js
// ZEROact 共通テスト基盤 Stage 5 (2026-05-18 新規)
//
// 目的: テスト結果が glossary.yml + scenarios/ の仕様に合致しているか
//       LLM を judge として判定する。
//
// 必要環境変数:
//   GEMINI_API_KEY     Gemini Flash API キー (= 無料枠優先)
//   TEST_RESULT_PATH   テスト結果 JSON のパス (default: data/test-results/latest.json)
//
// 入力コンテキスト:
//   ・scripts/zeroact-test-commons/glossary.yml (= 用語 + 不変条件)
//   ・scripts/zeroact-test-commons/scenarios/*.yml (= 業務シナリオ)
//   ・テスト結果 JSON (= replay-mm.js の出力)
//
// 出力: judge_result.json
//   {
//     verdict: "PASS" | "FAIL",
//     reasoning: "...",
//     checks: [{ scenario, expected, actual, pass }]
//   }
// ============================================================

const fs = require('fs');
const path = require('path');

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const TEST_RESULT_PATH = process.env.TEST_RESULT_PATH || 'data/test-results/latest.json';
const GEMINI_MODEL = 'gemini-2.5-flash';

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (_e) {
    return null;
  }
}

function loadGlossary() {
  return readFileSafe(path.join(__dirname, '..', 'glossary.yml')) || '(glossary.yml unavailable)';
}

function loadScenarios() {
  const dir = path.join(__dirname, '..', 'scenarios');
  if (!fs.existsSync(dir)) return '(scenarios/ unavailable)';
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml'));
  const parts = [];
  for (const f of files) {
    const content = readFileSafe(path.join(dir, f));
    if (content) parts.push('--- ' + f + ' ---\n' + content.slice(0, 2500));
  }
  return parts.join('\n\n').slice(0, 12000);
}

function loadTestResult() {
  const content = readFileSafe(TEST_RESULT_PATH);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch (_e) {
    return { _rawText: content.slice(0, 2000) };
  }
}

async function callGemini(prompt) {
  if (!GEMINI_KEY) return { error: 'GEMINI_API_KEY 未設定' };
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    GEMINI_MODEL +
    ':generateContent?key=' +
    GEMINI_KEY;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0 },
      }),
    });
    if (!res.ok) {
      return { error: 'Gemini API ' + res.status + ': ' + (await res.text()).slice(0, 200) };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { text };
  } catch (e) {
    return { error: 'Gemini fetch failed: ' + e.message };
  }
}

async function main() {
  const glossary = loadGlossary();
  const scenarios = loadScenarios();
  const testResult = loadTestResult();
  if (!testResult) {
    fs.writeFileSync(
      'judge_result.json',
      JSON.stringify(
        { verdict: 'FAIL', reasoning: 'test result not found at ' + TEST_RESULT_PATH },
        null,
        2
      )
    );
    process.exit(1);
  }

  const prompt = `あなたはダイコメ (代行運転 PWA メーター) のテスト結果審査員です。
以下の用語集とシナリオ仕様に基づき、テスト結果が仕様に合致しているか判定してください。

用語集 (glossary.yml):
${glossary.slice(0, 8000)}

シナリオ (scenarios/*.yml):
${scenarios}

テスト結果 (JSON):
${JSON.stringify(testResult, null, 2).slice(0, 4000)}

判定基準:
- DER (Distance Error Rate) < 0.5% なら PASS 候補
- snap_rate >= 95% なら PASS 候補
- 仕様に明示された不変条件 (= invariants) が満たされているか
- 想定外の異常値がないか (= 物理上限超過 / NaN / 負値)

JSON 1 行で返してください: {"verdict": "PASS|FAIL", "reasoning": "...", "checks": [...]}`;

  const result = await callGemini(prompt);
  if (result.error) {
    fs.writeFileSync(
      'judge_result.json',
      JSON.stringify({ verdict: 'FAIL', reasoning: result.error }, null, 2)
    );
    console.error('[llm-as-judge] ' + result.error);
    process.exit(1);
  }

  const match = result.text.match(/\{[\s\S]*\}/);
  let parsed;
  if (match) {
    try {
      parsed = JSON.parse(match[0]);
    } catch (_e) {
      parsed = { verdict: 'FAIL', reasoning: 'JSON parse error', _raw: result.text.slice(0, 500) };
    }
  } else {
    parsed = { verdict: 'FAIL', reasoning: 'no JSON in response', _raw: result.text.slice(0, 500) };
  }

  const output = Object.assign({ timestamp: new Date().toISOString() }, parsed);
  fs.writeFileSync('judge_result.json', JSON.stringify(output, null, 2));
  console.log('[llm-as-judge] verdict=' + (parsed.verdict || 'FAIL'));
  console.log('[llm-as-judge] ' + (parsed.reasoning || '(no reasoning)'));
  if (parsed.verdict !== 'PASS') process.exit(1);
  process.exit(0);
}

main();
