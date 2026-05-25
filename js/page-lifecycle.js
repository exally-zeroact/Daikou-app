// js/page-lifecycle.js (新規・Phase A-1・2026-05-20)
//
// ★設計変更宣言 (2026-05-20・Phase A-1・Page Lifecycle API 補完):
//   目的: iOS Safari PWA / Android Chrome PWA が freeze / kill された時に・
//         業務中の state.distance_m と業務状態を確実に永続化する。
//   既存 visibilitychange handler (= index.html L7778-7825) を補完する形で・
//   pagehide / freeze (= bfcache 直前の最終チャンス) と・
//   resume / pageshow (= bfcache 復帰) を捕捉する。
//
//   絶対ルール準拠:
//     - distance_m += 5 経路 (= meter.js L440/L514/L961/L979/L1365) には触れない
//     - 復元は既存 Meter.setDistance / Business.load 経路に任せる (= 新規復元経路は作らない)
//     - 新規 storage キーは作らず・既存 daikou_driving_state + Business.save() を再利用
//     - 既存 visibilitychange handler とは異なる event 経路を捕捉する (= 二重ハンドラではない・
//       同一 event に対する 2 つ目の listener は登録しない)
//
//   発火順 (= W3C Page Lifecycle 仕様):
//     ユーザー切替: visibilitychange(hidden) → pagehide(persisted:true) → [bfcache] → pageshow(persisted:true)
//     OS kill   : visibilitychange(hidden) → pagehide(persisted:false) → [unload]
//     freeze    : visibilitychange(hidden) → pagehide(persisted:true) → freeze → resume → pageshow
//   既存 visibilitychange で先に保存済の状態を・pagehide / freeze の最終チャンスで上書き再保存する
//   (= localStorage 同一キー上書きで内容矛盾なし)。
//
//   iOS Safari: freeze イベント非対応・pagehide のみ発火 (= bfcache 直前の最終 hook)
//   Android Chrome: pagehide + freeze 両方発火
//
//   classic script global lexical environment 共有経由で・index.html の Meter / Business /
//   appState / surchargeOn / surchargeRate / extras / dlog を typeof guard 付きで参照する。

/* global Business, appState, surchargeOn, surchargeRate, extras, module */

(function () {
  'use strict';

  // browser / classic script context のみ動作 (= Node test context では no-op)
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // 既存 visibilitychange handler (= index.html L7778-7825) と同等のロジックで
  // daikou_driving_state を保存。saved_at は最新時刻で上書き。
  function _saveDrivingState(reason) {
    try {
      if (
        typeof Meter !== 'undefined' &&
        typeof Meter.getState === 'function' &&
        typeof appState !== 'undefined' &&
        appState === 'driving'
      ) {
        const s = Meter.getState();
        let fare = s.fare_yen;
        if (typeof surchargeOn !== 'undefined' && surchargeOn) {
          const rate = typeof surchargeRate !== 'undefined' ? surchargeRate : 1;
          fare = Math.round(fare * rate);
        }
        const extraTotal =
          typeof extras !== 'undefined' && Array.isArray(extras)
            ? extras.reduce(function (a, b) {
                return a + (b && typeof b.amount === 'number' ? b.amount : 0);
              }, 0)
            : 0;
        const total = fare + extraTotal;
        const mmStats = typeof Meter.getMMStats === 'function' ? Meter.getMMStats() : null;
        localStorage.setItem(
          'daikou_driving_state',
          JSON.stringify({
            distance_m: s.distance_m,
            fare_yen: total,
            saved_at: Date.now(),
            last_lat: s.last_gps ? s.last_gps.lat : null,
            last_lng: s.last_gps ? s.last_gps.lng : null,
            last_altitude: s.last_gps ? s.last_gps.altitude : null,
            last_speed_kmh: s.last_speed_kmh || 0,
            last_gps_at: s.last_timestamp || null,
            mm_distance_m: mmStats ? mmStats.mm_distance_m : 0,
            distance_source: mmStats ? mmStats.distance_source : null,
            mm_snap_rate: mmStats ? mmStats.snap_rate : 0,
          })
        );
        if (typeof dlog === 'function') {
          dlog('[page-lifecycle] daikou_driving_state save (' + reason + ')');
        }
      }
    } catch (e) {
      console.error('[page-lifecycle] daikou_driving_state save error (' + reason + '):', e);
    }
  }

  // 既存 Business.save() (= js/business.js L586-592) を呼び出すだけ。
  // STORAGE_KEY = 'daikou_business_state' に state.total_distance_m / elapsed_ms 等が保存される。
  function _saveBusinessState(reason) {
    try {
      if (typeof Business !== 'undefined' && typeof Business.save === 'function') {
        Business.save();
        if (typeof dlog === 'function') {
          dlog('[page-lifecycle] Business.save (' + reason + ')');
        }
      }
    } catch (e) {
      console.error('[page-lifecycle] Business.save error (' + reason + '):', e);
    }
  }

  function _persist(reason) {
    _saveDrivingState(reason);
    _saveBusinessState(reason);
  }

  // resume / pageshow(persisted) は dlog のみ。
  // 復元は既存 startup 経路 (= index.html L7848 付近 Business.load + drivingState restore)
  // と既存 Business.resume / Meter.setDistance 経路に任せる (= 新規復元経路は作らない)。
  function _onResume(reason) {
    if (typeof dlog === 'function') {
      dlog('[page-lifecycle] resume (' + reason + ') - restore handled by existing startup');
    }
  }

  function init() {
    if (init._initialized) return;
    init._initialized = true;

    // pagehide: iOS Safari + Android Chrome の最終チャンス (= bfcache 直前)
    window.addEventListener(
      'pagehide',
      function (e) {
        _persist('pagehide' + (e && e.persisted ? ':bfcache' : ''));
      },
      { passive: true }
    );

    // freeze: Android Chrome 系 bfcache 開始 (= iOS Safari は非対応・登録のみで害なし)
    document.addEventListener(
      'freeze',
      function () {
        _persist('freeze');
      },
      { passive: true }
    );

    // resume: freeze からの復帰
    document.addEventListener(
      'resume',
      function () {
        _onResume('resume');
      },
      { passive: true }
    );

    // pageshow(persisted=true): bfcache 復帰
    window.addEventListener(
      'pageshow',
      function (e) {
        if (e && e.persisted) _onResume('pageshow:bfcache');
      },
      { passive: true }
    );

    if (typeof dlog === 'function') dlog('[page-lifecycle] init');
  }

  // export
  window.PageLifecycle = { init: init };
})();

// ★設計変更宣言 (Node coverage 計測可能化):
//   browser/Worker: window で IIFE 動作完結・module 未定義のため下記は no-op
//   Node test    : require('./page-lifecycle.js') で空 object を取得可能 (= IIFE は browser 限定)
// eslint-disable-next-line no-undef -- node 環境のみ・typeof guard で browser/Worker は no-op
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = {};
}
