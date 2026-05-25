/* eslint-env browser */

// ============================================================
// scripts/zeroact-test-commons/observability/openreplay-config.js
// ZEROact 共通テスト基盤 P12 (2026-05-18 新規)
//
// 目的: OpenReplay self-host による session replay の初期化テンプレート。
//
// 用途:
//   index.html 側で本ファイルを <script> 経由で読込み initOpenReplay() を呼ぶ前提。
//   ★ 本ファイル自体は既存コード無変更原則のため現状未配線。
//   司さん側で index.html に <script src="..."> + 初期化呼出を追加するタイミングで有効化。
//
// 必要環境:
//   ・window.OPENREPLAY_INGEST_URL を index.html の build 時に注入
//     (例: <meta name="openreplay-ingest"> + <meta name="openreplay-project-key">)
//   ・OpenReplay tracker CDN script を index.html head に追加
//
// 自己ホスト前提:
//   OpenReplay は SaaS ではなく self-host (= 司さん がインフラ準備)。
//   ingest endpoint URL は環境ごとに異なるため設定値で渡す。
//
// 安全 fallback:
//   ・env 値未設定時: 静かに skip (= console.warn のみ・業務 flow 妨害なし)
//   ・OpenReplay tracker SDK 未 load 時: 同上
//   ・全 try-catch で例外を内包・既存 flow 保護
//
// 課金関連保護:
//   ・session replay は GPS 座標 / fare_yen / distance_m を含む可能性あり
//   ・OpenReplay の sanitize 機能 (defaultInputMode: 'obscured') で
//     個人情報入力 field を masking する想定 (= 司さん 必要なら有効化)
// ============================================================

(function (global) {
  function getIngestUrl() {
    if (global?.OPENREPLAY_INGEST_URL) {
      return global.OPENREPLAY_INGEST_URL;
    }
    const meta = global.document?.querySelector('meta[name="openreplay-ingest"]');
    return meta?.getAttribute('content') || '';
  }

  function getProjectKey() {
    if (global?.OPENREPLAY_PROJECT_KEY) {
      return global.OPENREPLAY_PROJECT_KEY;
    }
    const meta = global.document?.querySelector('meta[name="openreplay-project-key"]');
    return meta?.getAttribute('content') || '';
  }

  function initOpenReplay(extraOpts) {
    const ingestPoint = getIngestUrl();
    const projectKey = getProjectKey();

    if (!ingestPoint || !projectKey) {
      console.warn('[openreplay-config] ingest URL or project key 未設定・skip');
      return null;
    }

    // OpenReplay tracker SDK は CDN または npm install で読込前提
    // tracker 名は global.OpenReplay または global.Tracker (= バージョン差異)
    const Tracker = global.OpenReplay || global.Tracker;
    if (!Tracker) {
      console.warn('[openreplay-config] OpenReplay tracker SDK 未 load・skip');
      return null;
    }

    try {
      const baseOpts = {
        projectKey,
        ingestPoint,
        // 個人情報マスキング (= field 入力値を obscured で送信)
        defaultInputMode: 1, // 1 = obscured
        // 課金 / GPS 関連 selector を強制 sanitize
        obscureTextEmails: true,
        obscureTextNumbers: false, // distance / fare は数値で意味あるため保持
        // session 録画上限 (= self-host インフラ負荷制御)
        captureExceptions: true,
        captureIFrames: false,
        // platform metadata (= Sentry と整合)
        __DISABLE_SECURE_MODE: false,
      };

      const tracker = new Tracker(Object.assign(baseOpts, extraOpts || {}));
      tracker.start();

      // Sentry tag と連携 (= 実験 group / user id を OpenReplay metadata に流す)
      if (
        global.DaikomeABConfig &&
        typeof global.DaikomeABConfig.getOrCreateUserId === 'function'
      ) {
        try {
          tracker.setUserID(global.DaikomeABConfig.getOrCreateUserId());
        } catch (_e) {
          // setUserID 不在の古い SDK 等
        }
      }

      console.log('[openreplay-config] init OK ingest=' + ingestPoint);
      return tracker;
    } catch (e) {
      console.warn('[openreplay-config] init failed: ' + e.message);
      return null;
    }
  }

  global.DaikomeOpenReplayConfig = {
    initOpenReplay,
    getIngestUrl,
    getProjectKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
