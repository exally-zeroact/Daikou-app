// tests/property/msw-integration.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・⑥ MSW 配線)
//
// 検証対象: scripts/zeroact-test-commons/msw-handlers.js が
//          setupServer 経由で実 fetch を mock できることを動作確認。
//
// 用途:
//   ・将来 AI script (multi-llm-consensus / llm-as-judge / ai-bug-hunter) の
//     unit test を書く際に本 setup を流用 (= 実 API 呼出回避)
//   ・property test で外部 fetch を含むコードを実行する場合の mock 基盤
//
// 注意:
//   ・tests/e2e/ への MSW Browser 配線 (setupWorker) は ダイコメ既存 sw.js (PWA)
//     と service worker 登録が競合するため将来課題
//   ・本 spec は Node test (= vitest) での msw/node 経由動作を verify

const { makeServer, defaultHandlers } = require('../../scripts/zeroact-test-commons/msw-handlers');

describe('MSW 配線 verification (⑥)', () => {
  let server;

  beforeAll(() => {
    server = makeServer(
      defaultHandlers({
        firebaseRC: {
          viterbi_n_ios: 10,
          fare_display_mode: 'classic',
          warmup_retry_count: 3,
        },
        anthropicVerdict: 'OK',
        anthropicReasoning: 'msw-integration test verdict',
        geminiVerdict: 'OK',
        geminiReasoning: 'msw-integration test verdict',
      })
    );
    server.listen({ onUnhandledRequest: 'bypass' });
  });

  afterAll(() => {
    server.close();
  });

  it('Anthropic Messages API mock が JSON で verdict を返す', async () => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-mock',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.id).toBe('msg_mock');
    expect(data.role).toBe('assistant');
    expect(Array.isArray(data.content)).toBe(true);
    const text = data.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.verdict).toBe('OK');
    expect(parsed.reasoning).toBe('msw-integration test verdict');
  });

  it('Gemini generateContent API mock が candidates で verdict を返す', async () => {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        }),
      }
    );
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.candidates)).toBe(true);
    const text = data.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.verdict).toBe('OK');
  });

  it('Firebase Remote Config mock が viterbi_n_ios=10 を返す', async () => {
    const res = await fetch(
      'https://firebaseremoteconfig.googleapis.com/v1/projects/test-project/namespaces/firebase:fetch',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }
    );
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.state).toBe('UPDATE');
    expect(data.entries.viterbi_n_ios).toBe('10');
    expect(data.entries.fare_display_mode).toBe('classic');
    expect(data.entries.warmup_retry_count).toBe('3');
  });

  it('Sentry envelope ingest mock が 200 noop を返す', async () => {
    const res = await fetch(
      'https://o4511406201634816.ingest.us.sentry.io/api/4511406221885440/envelope/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body: '{"event_id":"test"}\n{"type":"event"}\n{"message":"test"}',
      }
    );
    expect(res.status).toBe(200);
  });
});
