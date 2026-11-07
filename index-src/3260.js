      // ============================================================
      // ★設計変更宣言 (2026-05-25・起動計測ログ Phase 0・主因確定用):
      //   起動の「遅い」 主因 (= JS parse / 初期化 / GPS first fix / 描画) を
      //   実機 performance API で計測・憶測実装の空振り (04bbe630) 防止のため
      //   まず測る。read-only 計測のみ・既存処理 1 byte 不変・mark 差し込みのみ。
      //
      //   絶対前提 (= 1 byte 不変):
      //     ・distance_m / 課金経路 / running gate / Worker B / isStationary 本体
      //     ・_WATCH_OPTIONS / accelBuffer / gyroBuffer / getState 予測補間
      //     ・巻き戻り修正 (dde124ad business.js current_trip)
      //
      //   Firebase 書き込み先: 既存 /debug_traces.json 配下 (= 既存 rules 内・
      //     debug-trace.js 同 path・追加 rules 設定 不要・writeKey 共通)
      //   schema: 既存 debug-trace.js samples 構造互換 + meta.kind='startup_metrics'
      //
      //   bytecode cache 仮説検証用: 起動回数を localStorage で累積記録・
      //     初回 vs 2 回目以降の・eval 区間 ms 差異を比較可能化。
      //
      //   失敗時挙動: 全 try/catch・performance/sendBeacon 無い環境でも落ちない
      //     業務挙動・課金・距離計測に・一切影響しない。
      // ============================================================
      (function _startupMetrics() {
        'use strict';
        if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
        try {
          performance.mark('inline-script-eval-start');
        } catch (_) {
          return;
        }
        // 起動回数 (= bytecode cache 仮説 検証用・初回/2 回目以降区別)
        let startupCount = 1;
        try {
          const stored = localStorage.getItem('daikome_startup_count');
          const parsed = stored ? parseInt(stored, 10) : 0;
          startupCount = Number.isFinite(parsed) && parsed >= 0 ? parsed + 1 : 1;
          localStorage.setItem('daikome_startup_count', String(startupCount));
        } catch (_) {
          /* localStorage 不可 → デフォルト 1 */
        }
        const PHASES = [
          'inline-script-eval-start',
          'inline-script-eval-end',
          'dom-content-loaded',
          'mm-warmup-done',
          'first-business-start-click',
          'first-gps-fix',
        ];
        let sent = false;
        // DOMContentLoaded mark
        try {
          if (document.readyState === 'loading') {
            document.addEventListener(
              'DOMContentLoaded',
              function () {
                try {
                  performance.mark('dom-content-loaded');
                } catch (_) {
                  /* ignore */
                }
              },
              { once: true }
            );
          } else {
            performance.mark('dom-content-loaded');
          }
        } catch (_) {
          /* ignore */
        }
        function _collectAndSend() {
          if (sent) return;
          sent = true;
          try {
            const baseline = (performance.timeOrigin || 0) | 0;
            const entries =
              typeof performance.getEntriesByType === 'function'
                ? performance.getEntriesByType('mark') || []
                : [];
            const phaseMs = {};
            for (let i = 0; i < entries.length; i++) {
              const e = entries[i];
              if (PHASES.indexOf(e.name) >= 0 && phaseMs[e.name] == null) {
                phaseMs[e.name] = Math.round(e.startTime * 100) / 100;
              }
            }
            let firstPaintMs = null;
            let fcpMs = null;
            try {
              const paint =
                typeof performance.getEntriesByType === 'function'
                  ? performance.getEntriesByType('paint') || []
                  : [];
              for (let i = 0; i < paint.length; i++) {
                if (paint[i].name === 'first-paint') {
                  firstPaintMs = Math.round(paint[i].startTime * 100) / 100;
                } else if (paint[i].name === 'first-contentful-paint') {
                  fcpMs = Math.round(paint[i].startTime * 100) / 100;
                }
              }
            } catch (_) {
              /* paint timing 未対応・skip */
            }
            let deviceId = '';
            try {
              deviceId = localStorage.getItem('DAIKOME_DEVICE_ID') || '';
            } catch (_) {
              /* ignore */
            }
            // ★★ここから 下（起動の 数字を Firebase へ 送る 所）を 外しました★★ 2026-09-02
            //   ★司さんの 決まり★「Firebaseは 2度と 使うな＝★読む為にも★使わない」
            //
            //   ★外し漏れでした（2026-09-02 に 見つかった）★
            //     2026-09-01 に Firebase の ★読み込み(script src)★は 全部 外しましたが、
            //     ★この 画面の 中に 直接 書いてあった 送り先★が 残っていました:
            //       https://daikou-app-c821a-…firebasedatabase.app/debug_traces.json
            //       navigator.sendBeacon → 失敗したら fetch(POST, keepalive)
            //   ★誰に 起きていたか★
            //     ・新しい 端末 … 飛ばない（DAIKOME_DEVICE_ID が 作られないので）
            //     ・★前に 一度でも trace を 入れた 端末★ … ID が 残っているので
            //       ★起動の たびに Firebase へ 送り続けていました★
            //   ⇒ 私の 見張りは ★読み込む ファイルしか 見ていませんでした★（穴）。
            //     ⇒ ★画面の 中に 直接 書いた 住所も 数える★ように 直しました
            //       （tests/unit/firebase-tsukawanai.test.js）
            //
            //   ★数える所（performance.mark）は 残しています★＝送り先だけ 外しました。
            //   送り先を Supabase に 作る時は ここに 書きます。
            return;
          } catch (_) {
            /* 集計失敗 → 業務影響なし・graceful skip */
          }
        }
        try {
          setTimeout(_collectAndSend, 30000);
        } catch (_) {
          /* ignore */
        }
        try {
          document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') _collectAndSend();
          });
        } catch (_) {
          /* ignore */
        }
      })();

      // ★設計変更宣言 (2026-05-10): TDZ 撲滅のため全 let/const を script 先頭に集約
      //   旧: line 1906/2254/3843/4214 等に分散・script 中盤の throw で halt すると
      //       後続宣言が TDZ → startGPS 内 appState 参照, onBusinessStart 内 noSleep
      //       参照, MM guard setInterval 内 _forwardedPrefs 参照で全て ReferenceError
      //   新: script 先頭で初期化・script 中盤に halt があっても TDZ は発生しない
      //
      // デバイス判定
      const _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const _isAndroid = /Android/.test(navigator.userAgent);

      // ─── MM-1 + H-1 修正 (2026-05-08): Map Matching Worker B 起動 + 自動再起動 ───
      // js/map-matcher.js を Worker として起動し Meter.setMapMatcher で注入。
      // H-1: Worker B が死んだら 5 秒後に自動再生成し state を再 forward する。
      //      再起動中も meter.js inline fallback で state.distance_m は継続。
      let _mmWorker = null;
      let _mmWorkerRestartTimer = null;
      const _MM_WORKER_RESTART_DELAY_MS = 5000;

      // MM-3 health check 状態 (旧 line 1485-1487)
      let _mmHealthPongAt = 0;
      let _mmHealthPingAt = 0;
      const _MM_HEALTH_TIMEOUT_MS = 3000;

      // ★設計変更宣言 (2026-05-13・大改修 C11): 旧 MM forward 関連変数を全削除
      //   _crossUserSubscribedPrefs / _forwardedPrefs / _attrsLoadedPrefs /
      //   _attrs*ByPref / _autoRoadLoadInflight は新パイプライン (MMDataPipeline)
      //   に置き換え。旧 _forwardRoadsToMmWorker / _autoLoadNearbyRoads /
      //   _autoLoadNearbyAttrs が使っていた状態管理は不要。

      // アプリ全体状態 (旧 line 1906-1918・startGPS / onBusinessStart 等が参照)
      let appState = 'idle'; // idle / driving / fare
      let histSaved = false; // 確定時の履歴保存済みフラグ
      let noSleep = null; // NoSleepインスタンス (= iOS 16.3 以下 fallback)
      // ★設計変更宣言 (2026-05-19・R3・Screen Wake Lock API 移行):
      //   旧: NoSleep library 経由 (= iOS PWA で動作不安定・司さん実車「画面消える」報告)
      //   新: navigator.wakeLock.request('screen') を主経路に・NoSleep を fallback として並行起動
      //   サポート: iOS 16.4+ / Android Chrome 84+ / Edge 84+ / Firefox 128+ / Samsung 14+
      //            iOS 16.3 以下は wakeLock 未定義 → NoSleep のみで動作 (= 既存挙動維持)
      //   visibilitychange で sentinel が release されるため・visible 復帰時に再取得する仕様。
      let wakeLockSentinel = null;
      async function acquireWakeLock() {
        // Wake Lock API 主経路
        try {
          if ('wakeLock' in navigator && typeof navigator.wakeLock.request === 'function') {
            if (!wakeLockSentinel || wakeLockSentinel.released) {
              wakeLockSentinel = await navigator.wakeLock.request('screen');
              wakeLockSentinel.addEventListener('release', () => {
                if (typeof dlog === 'function') dlog('[WakeLock] released (visibility change)');
              });
              if (typeof dlog === 'function') dlog('[WakeLock] acquired (Screen Wake Lock API)');
            }
          }
        } catch (e) {
          if (typeof dlog === 'function') dlog('[WakeLock] API error: ' + (e && e.message));
        }
        // NoSleep fallback (= iOS 16.3 以下・wakeLock 失敗時の保険)
        try {
          if (!noSleep) {
            noSleep = new NoSleep();
          }
          noSleep.enable().catch((e) => {
            if (typeof dlog === 'function') dlog('[NoSleep fallback] error: ' + (e && e.message));
          });
        } catch (e) {
          if (typeof dlog === 'function')
            dlog('[NoSleep fallback] init error: ' + (e && e.message));
        }
      }
      function releaseWakeLock() {
        // Wake Lock API release
        try {
          if (wakeLockSentinel && typeof wakeLockSentinel.release === 'function') {
            wakeLockSentinel.release();
            wakeLockSentinel = null;
            if (typeof dlog === 'function') dlog('[WakeLock] released (manual)');
          }
        } catch (_) {}
        // NoSleep fallback disable
        try {
          if (noSleep && typeof noSleep.disable === 'function') {
            noSleep.disable();
          }
        } catch (_) {}
      }
      // visibilitychange で再取得 (= Wake Lock 仕様で visible 時のみ保持される)
      try {
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') {
            // 業務中 (appState !== 'businessStart') なら再取得
            if (typeof appState !== 'undefined' && appState !== 'businessStart') {
              acquireWakeLock();
            }
          }
        });
      } catch (_) {}
      let dimTimer = null; // 空車時の画面暗転タイマー
      const DIM_MINUTES = 300; // 空車5時間(300分)で暗転
      let surchargeOn = false;
      let surchargeRate = 1.2;
      let surchargeEnabled = false;
      let extras = [];
      let discounts = []; // ★値引き (追加料金と同型・合計から減算)★
      let todayDist = 0;
      let todayCount = 0;
      // ★総走行距離の命綱 (2026-08-08)★: 実車/回数/売上 の3つには 2026-05-14 に
      //   Math.max の命綱を付けたが、★総走行距離だけ付け忘れていた★。
      //   getReport().total_distance_m が一瞬でも 0 を返すと、200ms ごとの更新が
      //   画面を 0.00 に上書きし続ける（司さん報告: 1台だけ総走行距離が動かない）。
      //   ★同じ業務の中で、一度出た正の値より下げない★。業務開始で 0 に戻す。
      let lastGoodTotalM = 0;
