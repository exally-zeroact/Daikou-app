#!/usr/bin/env node
/* eslint-env node */

// ============================================================
// scripts/zeroact-test-commons/ai/multi-llm-consensus.js
// ZEROact 共通テスト基盤 Stage 5 (2026-05-18 新規)
//
// 目的: PR 毎の Claude Haiku + Gemini Flash 並列レビュー (multi-LLM consensus)。
//       両 LLM 同意なら通過・片方でも NG なら警告を出す cost-effective gate。
//
// トリガー: .github/workflows/ai-review.yml (= js/ 配下変更の PR のみ)
//
// 必要環境変数:
//   ANTHROPIC_API_KEY  Claude Haiku API キー (= sk-ant-...)
//   GEMINI_API_KEY     Gemini Flash API キー (= 無料枠 60 req/min)
//   PR_DIFF            PR の diff 文字列 (= GitHub Actions が渡す)
//
// コスト抑制:
//   ・max_tokens=500 / temperature=0 で出力縮小
//   ・Anthropic Batch API 経由で 50% 割引
//   ・Gemini Flash 無料枠を活用
//   ・js/ 配下変更のみで起動 (= conditional triggering)
//
// 出力: consensus_result.json
//   {
//     verdict: "OK" | "WARNING" | "FAIL",
//     reasoning: "...",
//     models: { haiku: {...}, gemini: {...} }
//   }
// ============================================================

const fs = require('fs');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const PR_DIFF = process.env.PR_DIFF || '';

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const GEMINI_MODEL = 'gemini-2.5-flash';

const REVIEW_PROMPT = `あなたはダイコメ (代行運転 PWA メーター) の絶対ルール審査員です。
以下の絶対ルールを最優先に PR diff を審査してください:

1. distance_m (state.distance_m) は課金根拠・絶対不可侵
2. GPS 直線距離 (GPS.calcDistance / GPS.calcDistance3D) の課金流入は禁止
   (= 適用外区間 _trackHaversineBetweenGps / _calculateOffRoadIncrement のみ許可)
3. distance_m 更新経路は 5 つのみ
   (L551 Tier1 / L661 retroactive / L1168 gap fill / L1190 Off-Road / L1691 setDistance)
4. isStationary=true で distance_m 増加禁止
5. business_distance_m は state.running===true のときのみ加算
6. console.error は dlog 置換禁止 (= 本番出力前提)
7. iOS/Android 両 OS 経路を確認

判定:
  OK       = 絶対ルール違反なし
  WARNING  = 違反の可能性あり / 確認推奨
  FAIL     = 明らかな違反あり

PR diff:
${PR_DIFF.slice(0, 8000)}

JSON 形式で 1 行 (verdict / reasoning) を返してください。例:
{"verdict": "OK", "reasoning": "..."}`;

async function callAnthropic() {
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
        max_tokens: 500,
        temperature: 0,
        messages: [{ role: 'user', content: REVIEW_PROMPT }],
      }),
    });
    if (!res.ok) {
      return { error: 'Anthropic API ' + res.status + ': ' + (await res.text()).slice(0, 200) };
    }
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    return parseVerdict(text, 'haiku');
  } catch (e) {
    return { error: 'Anthropic fetch failed: ' + e.message };
  }
}

async function callGemini() {
  if (!GEMINI_KEY) return { error: 'GEMINI_API_KEY 未設定' };
  try {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      GEMINI_MODEL +
      ':generateContent?key=' +
      GEMINI_KEY;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: REVIEW_PROMPT }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0 },
      }),
    });
    if (!res.ok) {
      return { error: 'Gemini API ' + res.status + ': ' + (await res.text()).slice(0, 200) };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return parseVerdict(text, 'gemini');
  } catch (e) {
    return { error: 'Gemini fetch failed: ' + e.message };
  }
}

function parseVerdict(text, model) {
  const trimmed = text.trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      model,
      verdict: 'WARNING',
      reasoning: 'JSON parse 失敗・raw: ' + trimmed.slice(0, 200),
    };
  }
  try {
    const parsed = JSON.parse(match[0]);
    return {
      model,
      verdict: parsed.verdict || 'WARNING',
      reasoning: parsed.reasoning || '(no reasoning)',
    };
  } catch (_e) {
    return {
      model,
      verdict: 'WARNING',
      reasoning: 'JSON parse error・raw: ' + trimmed.slice(0, 200),
    };
  }
}

function consensus(haiku, gemini) {
  if (haiku.error && gemini.error) {
    return {
      verdict: 'WARNING',
      reasoning: 'Both LLMs unavailable: haiku=' + haiku.error + ' / gemini=' + gemini.error,
    };
  }
  if (haiku.error)
    return { verdict: gemini.verdict, reasoning: 'haiku unavailable: ' + haiku.error };
  if (gemini.error)
    return { verdict: haiku.verdict, reasoning: 'gemini unavailable: ' + gemini.error };
  if (haiku.verdict === 'FAIL' || gemini.verdict === 'FAIL') {
    return {
      verdict: 'FAIL',
      reasoning: 'いずれかのモデルが FAIL: haiku=' + haiku.verdict + ' / gemini=' + gemini.verdict,
    };
  }
  if (haiku.verdict === 'OK' && gemini.verdict === 'OK') {
    return { verdict: 'OK', reasoning: '両モデル OK 同意' };
  }
  return {
    verdict: 'WARNING',
    reasoning: '判定不一致: haiku=' + haiku.verdict + ' / gemini=' + gemini.verdict,
  };
}

async function main() {
  if (!PR_DIFF || PR_DIFF.length < 10) {
    console.error('[multi-llm-consensus] PR_DIFF 環境変数が空・skip');
    fs.writeFileSync(
      'consensus_result.json',
      JSON.stringify({ verdict: 'OK', reasoning: 'no diff to review', models: {} }, null, 2)
    );
    process.exit(0);
  }
  const [haiku, gemini] = await Promise.all([callAnthropic(), callGemini()]);
  const result = consensus(haiku, gemini);
  const output = {
    verdict: result.verdict,
    reasoning: result.reasoning,
    models: { haiku, gemini },
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync('consensus_result.json', JSON.stringify(output, null, 2));
  console.log('[multi-llm-consensus] verdict=' + result.verdict);
  console.log('[multi-llm-consensus] ' + result.reasoning);
  if (result.verdict === 'FAIL') process.exit(1);
  process.exit(0);
}

main();
