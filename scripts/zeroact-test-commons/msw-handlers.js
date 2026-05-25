/* eslint-env node */

// ============================================================
// scripts/zeroact-test-commons/msw-handlers.js
// ZEROact 共通テスト基盤 P10 (2026-05-18 新規)
//
// 目的: MSW v2 で外部 API fetch を mock する handler 集 + setup factory。
//       ダイコメ / Exally / 今治AI 共通で使える handler を集約。
//
// 用途:
//   ・Node テスト (= vitest):  setupServer(...handlers).listen()
//   ・Browser テスト (= Playwright e2e): setupWorker(...handlers).start()
//
// 対象 fetch endpoint:
//   ・Firebase Remote Config (= viterbi_n_ios 等の A/B 値返却)
//   ・Anthropic Claude API   (= ai-review / bug-hunter test 用)
//   ・Gemini Flash API       (= ai-review / llm-as-judge test 用)
//   ・Sentry ingest endpoint (= sentry-config が送る event を吸収・noop response)
//
// 注意:
//   ・ダイコメは navigator.geolocation + Worker postMessage 中心で
//     直接 fetch は限定的・主に Firebase / LLM / Sentry のみ
//   ・MSW v2 は http.get/post を使う (= v1 の rest.* は廃止)
// ============================================================

const { http, HttpResponse } = require('msw');

// ─── Firebase Remote Config mock ──────────────────────────────

// /v1/projects/{project}/namespaces/firebase:fetch (= Firebase RC fetch endpoint)
// MSW v2 の path-to-regexp は ":" を parameter として解釈するため URL 内 ":fetch" で
// parse error。RegExp 直接指定で回避。
function firebaseRemoteConfigHandler(values) {
  return http.post(
    /^https:\/\/firebaseremoteconfig\.googleapis\.com\/v1\/projects\/[^/]+\/namespaces\/firebase:fetch/,
    () => {
      const entries = {};
      for (const k of Object.keys(values || {})) {
        entries[k] = String(values[k]);
      }
      return HttpResponse.json({
        entries,
        state: 'UPDATE',
      });
    }
  );
}

// ─── Anthropic Claude API mock ────────────────────────────────

function anthropicMessagesHandler(verdict, reasoning) {
  return http.post('https://api.anthropic.com/v1/messages', () => {
    const text = JSON.stringify({
      verdict: verdict || 'OK',
      reasoning: reasoning || 'mocked response',
    });
    return HttpResponse.json({
      id: 'msg_mock',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'claude-haiku-mock',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 },
    });
  });
}

// ─── Gemini Flash API mock ────────────────────────────────────

function geminiGenerateContentHandler(verdict, reasoning) {
  // ":generateContent" を parameter として解釈されないよう RegExp 直接指定
  return http.post(
    /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[^:]+:generateContent/,
    () => {
      const text = JSON.stringify({
        verdict: verdict || 'OK',
        reasoning: reasoning || 'mocked response',
      });
      return HttpResponse.json({
        candidates: [
          {
            content: { role: 'model', parts: [{ text }] },
            finishReason: 'STOP',
          },
        ],
      });
    }
  );
}

// ─── Sentry ingest mock (= event 送信を吸収) ──────────────────

function sentryIngestHandler() {
  // subdomain + path wildcard を RegExp で表現
  return http.post(/^https:\/\/[^.]+\.ingest\.[^/]+\.sentry\.io\/api\/[^/]+\/envelope\//, () => {
    return new HttpResponse(null, { status: 200 });
  });
}

// ─── ダイコメ知識注入 (2026-05-18・billing validation) ──────────────
//
// 課金値域の正常範囲 (= 物理上限 + 業務常識上限):
//   distance_m:          0 <= x <= 1_000_000 (= 物理 1000km・1 trip 上限)
//   business_distance_m: 0 <= x <= 10_000_000 (= 1 業務 10000km・1 夜上限)
//   fare_yen:            0 <= x <= 1_000_000 (= 上限 100 万円・1 trip 通常 1-3 万円)
//
// 異常値検出時の挙動:
//   ・負値           → 400 Bad Request (= 物理上不可能・絶対ルール違反)
//   ・NaN / Infinity → 400 Bad Request (= 計算 bug)
//   ・上限超過       → 400 Bad Request (= 業務外れ値)
//
// 用途:
//   property/e2e test で fetch 経由の billing 値を mock する際に validation 経由。
//   モック API が異常値を絶対返さない設計を強制 (= sandbox 安全性向上)。

const BILLING_RANGE = {
  distance_m: { min: 0, max: 1000000 },
  business_distance_m: { min: 0, max: 10000000 },
  fare_yen: { min: 0, max: 1000000 },
};

function validateBillingValue(key, value) {
  const range = BILLING_RANGE[key];
  if (!range) return { ok: false, reason: 'unknown billing key: ' + key };
  if (typeof value !== 'number') {
    return { ok: false, reason: key + ' must be number (got ' + typeof value + ')' };
  }
  if (!Number.isFinite(value)) {
    return { ok: false, reason: key + ' must be finite (got ' + value + ')' };
  }
  if (value < range.min) {
    return { ok: false, reason: key + ' below minimum: ' + value + ' < ' + range.min };
  }
  if (value > range.max) {
    return { ok: false, reason: key + ' above maximum: ' + value + ' > ' + range.max };
  }
  return { ok: true };
}

// 仮の billing endpoint mock (= 将来 Vercel Functions / Stripe 統合時に
// 同等 endpoint をモックする想定の reference handler)
function billingValidationHandler(endpoint) {
  endpoint = endpoint || 'https://example.com/api/billing';
  return http.post(endpoint, async ({ request }) => {
    let body;
    try {
      body = await request.json();
    } catch (_e) {
      return HttpResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    for (const key of Object.keys(body || {})) {
      if (BILLING_RANGE[key]) {
        const r = validateBillingValue(key, body[key]);
        if (!r.ok) {
          return HttpResponse.json({ error: r.reason, key }, { status: 400 });
        }
      }
    }
    return HttpResponse.json({ ok: true, accepted: body });
  });
}

// ─── factory ──────────────────────────────────────────────────

// 全 mock handler を returns (= 個別 override は呼出側で .use(...) して取捨)
function defaultHandlers(options) {
  options = options || {};
  return [
    firebaseRemoteConfigHandler(
      options.firebaseRC || {
        viterbi_n_ios: 10,
        fare_display_mode: 'classic',
        warmup_retry_count: 3,
      }
    ),
    anthropicMessagesHandler(options.anthropicVerdict, options.anthropicReasoning),
    geminiGenerateContentHandler(options.geminiVerdict, options.geminiReasoning),
    sentryIngestHandler(),
  ];
}

// Node テスト (vitest) 用 server factory
function makeServer(handlers) {
  // 動的 require (= msw/node は node 環境必須・browser 環境では落ちる)
  const { setupServer } = require('msw/node');
  return setupServer(...(handlers || defaultHandlers()));
}

// Browser テスト (Playwright addInitScript or service worker) 用 worker factory
// 注: ブラウザ環境専用・Node test では require('msw/browser') で落ちる
function makeWorker(handlers) {
  const { setupWorker } = require('msw/browser');
  return setupWorker(...(handlers || defaultHandlers()));
}

module.exports = {
  // handler factories
  firebaseRemoteConfigHandler,
  anthropicMessagesHandler,
  geminiGenerateContentHandler,
  sentryIngestHandler,
  // ダイコメ knowledge: billing validation
  billingValidationHandler,
  validateBillingValue,
  BILLING_RANGE,
  // factories
  defaultHandlers,
  makeServer,
  makeWorker,
  // re-export MSW primitives for advanced use
  http,
  HttpResponse,
};
