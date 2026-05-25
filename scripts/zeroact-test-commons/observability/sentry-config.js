/* eslint-env browser */

// ============================================================
// scripts/zeroact-test-commons/observability/sentry-config.js
// ZEROact 共通テスト基盤 Stage 6 (2026-05-18 新規)
//
// 目的: Sentry Free (月 5,000 イベント) を ダイコメに導入する設定テンプレート。
//
// 用途:
//   index.html / sw.js から本ファイルを <script> 経由で読込み initSentry() を呼ぶ前提。
//   ★ 本ファイル自体は既存コード無変更原則のため index.html / sw.js には現状未配線。
//   司さんが index.html に <script src="..."> + initSentry() 呼出を追加するタイミングで有効化。
//
// 必要環境:
//   ・window.SENTRY_DSN を index.html の build 時に注入 (例: <meta name="sentry-dsn">)
//   ・@sentry/browser CDN script を index.html head に追加
//
// 月 5,000 イベント上限を意識した抑制:
//   ・tracesSampleRate=0.01 (= 1% のみ)
//   ・replaysSessionSampleRate=0.0 (= replay 無し)
//   ・課金関連エラー (= distance_m / fare_yen 異常) は強制送信 (= sampling 無視)
//   ・GPS 取得失敗等の頻発エラーは fingerprint で集約 (= 1 issue として扱う)
//
// 課金ロジック異常検出フィルタ:
//   distance_m / fare_yen / business_distance_m に NaN / 負値 / 物理上限超過があれば
//   即 captureMessage で送信。Sentry Issue タイトルに "[BILLING]" プレフィクスを付ける。
// ============================================================

(function (global) {
  function getDsn() {
    if (global?.SENTRY_DSN) return global.SENTRY_DSN;
    const meta = global.document?.querySelector('meta[name="sentry-dsn"]');
    return meta?.getAttribute('content') || '';
  }

  function getRelease() {
    const meta = global.document?.querySelector('meta[name="app-version"]');
    return meta?.getAttribute('content') || 'daikome@unknown';
  }

  // 課金関連識別子・送信時に強制 force-send
  const BILLING_KEYWORDS = [
    'distance_m',
    'business_distance_m',
    'fare_yen',
    'calcFare',
    'mmIncrementM',
  ];

  function isBillingRelevant(event) {
    try {
      const msg = event?.message || '';
      const exception = event?.exception?.values?.[0]?.value;
      const haystack = (msg + ' ' + (exception || '')).toLowerCase();
      return BILLING_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()));
    } catch (_e) {
      return false;
    }
  }

  function beforeSend(event, _hint) {
    // 課金関連: タグ付け + force送信
    if (isBillingRelevant(event)) {
      event.tags = event.tags || {};
      event.tags['daikome.billing'] = 'true';
      event.level = event.level || 'error';
      event.fingerprint = ['{{ default }}', 'daikome-billing'];
      // 課金関連はサンプリング bypass のため beforeSendTransaction では除外
      return event;
    }
    // 非課金 GPS / Worker 等のエラー: 既知パターンを 1 issue に集約
    if (event?.message) {
      if (/Worker.*terminated/i.test(event.message)) {
        event.fingerprint = ['daikome-worker-terminated'];
      }
      if (/Geolocation.*denied/i.test(event.message)) {
        event.fingerprint = ['daikome-geolocation-denied'];
      }
    }
    return event;
  }

  function initSentry(extraOpts) {
    if (!global.Sentry) {
      console.warn('[sentry-config] Sentry SDK 未 load・skip');
      return;
    }
    const dsn = getDsn();
    if (!dsn) {
      console.warn('[sentry-config] SENTRY_DSN 未設定・skip');
      return;
    }
    const release = getRelease();
    const baseOpts = {
      dsn,
      release,
      environment: location.hostname === 'localhost' ? 'development' : 'production',
      // 月 5000 イベント上限対策
      tracesSampleRate: 0.01,
      replaysSessionSampleRate: 0.0,
      replaysOnErrorSampleRate: 0.0,
      sampleRate: 0.5, // error も半分にサンプリング (= billing 関連は beforeSend で force 化)
      autoSessionTracking: false,
      beforeSend,
      ignoreErrors: [
        // ブラウザ拡張 / 既知の noisy error
        'ResizeObserver loop limit exceeded',
        'Non-Error promise rejection captured',
        /chrome-extension/,
      ],
      // 課金関連 tag を全 transaction に付与
      initialScope: {
        tags: {
          'daikome.app': 'daikome',
          'daikome.platform': /iPad|iPhone|iPod/.test(navigator.userAgent) ? 'ios' : 'android',
        },
      },
    };
    global.Sentry.init(Object.assign(baseOpts, extraOpts || {}));
    console.log('[sentry-config] init OK release=' + release);
  }

  // 課金関連異常値の手動 captureMessage helper
  // 利用例: Sentry.captureBillingAnomaly('distance_m became NaN', { distance_m: NaN });
  function captureBillingAnomaly(message, context) {
    if (!global.Sentry) return;
    global.Sentry.captureMessage('[BILLING] ' + message, {
      level: 'error',
      tags: { 'daikome.billing': 'true' },
      contexts: { billing: context || {} },
      fingerprint: ['daikome-billing-anomaly', message],
    });
  }

  // export to window for index.html consumption
  global.DaikomeSentryConfig = {
    initSentry,
    captureBillingAnomaly,
    isBillingRelevant,
    BILLING_KEYWORDS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
