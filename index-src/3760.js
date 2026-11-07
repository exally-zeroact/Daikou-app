      // ★起動計測ログ Phase 0 (2026-05-25): inline script eval 完了 mark (= read-only)
      try {
        if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
          performance.mark('inline-script-eval-end');
        }
      } catch (_) {
        /* 業務影響ゼロ・graceful skip */
      }
      // ============================================================
      // ★設計変更宣言 (2026-05-25・S3 単独・GPS 初回測位 先行起動):
      //   計測ログ(91a0f516)で・主因 = GPS first fix (= 1.2-7 秒) 特定。
      //   起動 最早期で・getCurrentPosition 1 回・lastWarmupGps prime することで
      //   GPS hardware wake up を・前倒し・cold start 待ちを・少し縮める。
      //
      //   絶対前提 (= 1 byte 不変):
      //     ・_WATCH_OPTIONS / accelBuffer / isStationary / distance_m / 課金経路
      //     ・getState 予測補間 / 巻き戻り修正 / 計測ログ
      //     ・Worker B (map-matcher.js)
      //
      //   既存重複回避:
      //     ・P2 last-GPS warm-up (L6176-) は・roads データロード only
      //       (= localStorage の・前回 GPS 値のみ・getCurrentPosition 呼ばない)
      //     ・L8810 getCurrentPosition は・センサー許可ボタン押下後・roads 用
      //       (= タイミング異なる・本 S3 は・更に最早期)
      //     ・★ 本 S3 は・lastWarmupGps prime 専用・既存と別経路・重複なし ★
      //
      //   watchPosition は・呼ばない (= getCurrentPosition 単発のみ)
      //   gpsStarted=false 維持 (= 既存 startGPS が・後で・watchPosition 起動)
      //   業務前 蓄積なし (= updateGpsOnly は・state には触らず・lastWarmupGps セットのみ)
      //
      //   04bbe630 反省:
      //     ・S1 (= センサー先行登録) は・iOS 空振り → 今回不実装
      //     ・S2 (= Worker 先行 spawn) は・微小効果 → 今回不実装
      //     ・★ S3 単独 ★・主因 (= GPS first fix) 直接対策
      //
      //   効果 verify: 既存計測ログ 'first-gps-fix' mark で・S3 導入前後比較可能
      //     導入前 (= 91a0f516 startup_count=2-4): ~7 秒
      //     導入後: 計測待ち (= 司さん実機 タスクキル数回・データ確認)
      // ============================================================
      (function _s3EarlyGpsPrime() {
        'use strict';
        // 二重起動防止
        if (window._s3PrimeCalled) return;
        window._s3PrimeCalled = true;
        // 既存 watchPosition (= startGPS) が・既に起動済なら・skip (= 競合回避)
        if (typeof gpsStarted !== 'undefined' && gpsStarted) return;
        try {
          if (typeof navigator === 'undefined' || !navigator.geolocation) return;
          if (typeof navigator.geolocation.getCurrentPosition !== 'function') return;
          // iOS Safari 非 PWA は・GPS 関連 skip (= 既存 P2 と同基準)
          const _s3IsIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
          if (_s3IsIOS && window.navigator.standalone !== true) return;
          // ★_WATCH_OPTIONS 自体は触らず・同等値の・新 object で呼出★
          //   既存 _WATCH_OPTIONS = { enableHighAccuracy:true, timeout:3000, maximumAge:0 }
          navigator.geolocation.getCurrentPosition(
            function (pos) {
              try {
                if (!pos || !pos.coords) return;
                if (typeof Meter === 'undefined' || typeof Meter.updateGpsOnly !== 'function') {
                  return;
                }
                Meter.updateGpsOnly({
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude,
                  altitude: pos.coords.altitude || 0,
                  speedKmh: pos.coords.speed != null ? pos.coords.speed * 3.6 : 0,
                  timestamp: pos.timestamp || Date.now(),
                  compassHeading: null,
                });
                if (typeof dlog === 'function') {
                  dlog('[S3] lastWarmupGps 先行 prime OK lat=' + pos.coords.latitude.toFixed(5));
                }
              } catch (_) {
                /* 業務影響ゼロ・graceful skip */
              }
            },
            function () {
              /* GPS 失敗・graceful skip (= 既存 watchPosition で後追い取得) */
            },
            { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 }
          );
        } catch (_) {
          /* 業務影響ゼロ・graceful skip */
        }
      })();
