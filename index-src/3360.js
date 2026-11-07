      // ─── 古い履歴キー自動削除（保持期間超過分のみ） ───
      // ★設計変更宣言 (2026-06-06・司さん指示「履歴は全業務記録しとかないかん・20回でも30回でも」):
      //   旧: 「今日以外の daikou_history_<日付> を全削除」。
      //       → 代行は深夜営業で日付をまたぐため、22時開始の業務が翌0時以降のアプリ起動で
      //         「昨日のキー」として消され、前夜分の履歴が永久消失していた(実機 2026-06-06 で再現)。
      //   新: business.js (daikou_business_history) と同じ ★30 日 retention★ に統一。
      //       直近 30 日のキーは保持(= 日跨ぎの今夜分も当然残る)・30 日超過 or 日付パース不能のみ削除。
      //   ※保存・dedup ロジック(_historyDedupeUpsert)は 1 byte も触らない。
      function cleanOldHistoryKeys() {
        const PREFIX = 'daikou_history_';
        const RETENTION_DAYS = 30;
        const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const toDelete = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith(PREFIX)) continue;
          const t = Date.parse(key.slice(PREFIX.length)); // "Thu Jun 05 2026" → ms
          // パース不能(壊れたキー) or retention 超過(古い) のみ削除。直近は保持。
          if (!Number.isFinite(t) || t < cutoff) toDelete.push(key);
        }
        toDelete.forEach((k) => localStorage.removeItem(k));
        if (toDelete.length > 0) dlog('[Cleanup] 期限切れ履歴キー削除:', toDelete.length + '件');
      }

      // ★設計変更宣言 (2026-05-14): autoResetCheck / setInterval / visibilitychange 全削除
      //   旧: 時刻ベースの自動リセット (12:00 など) + setInterval (1 分毎) + foreground 復帰時チェック
      //   新: 代行開始ボタン押下時に onBusinessStart 内で表示値 (todayDist/todayCount/totalDist/fareTotalYen)
      //       を全部 0 にリセット (時刻判定は撤去・業務開始トリガー方式に統一)。
      //       resume() 経由は前業務を引き継ぐためリセットしない。

      // ─── 時計（2026/05/01仕様変更：全画面共通の日時表示） ───
      function updateClock() {
        const now = new Date();
        const h = now.getHours().toString().padStart(2, '0');
        const m = now.getMinutes().toString().padStart(2, '0');
        const days = ['日', '月', '火', '水', '木', '金', '土'];
        // 全画面共通：絵文字なし「2026年5月1日（金） 15:43」
        const text =
          now.getFullYear() +
          '年' +
          (now.getMonth() + 1) +
          '月' +
          now.getDate() +
          '日（' +
          days[now.getDay()] +
          '） ' +
          h +
          ':' +
          m;
        // 全画面の dateTimeLine クラスを一括更新（screenIdle/screenDriving/screenFare）
        document.querySelectorAll('.dateTimeLine').forEach((el) => {
          el.textContent = text;
        });
        // ★ライセンス期限警告バナー(業務開始画面)を1秒毎に更新(残り≤7日/期限切れ時のみ表示・非ブロック)
        if (typeof window._updateLicenseBanner === 'function') window._updateLicenseBanner();
        // ★2026-07-23 司さん要望★: 空車画面の日時の上に現在地(町名)だけ表示。
        //   空車表示中のみ Business.getCurrentLiveAddress()(3段fallback)で更新。取得前は:empty で非表示。
        const _locEl = document.getElementById('idleLocation');
        if (_locEl) {
          const _idle = document.getElementById('screenIdle');
          const _idleVisible = _idle && getComputedStyle(_idle).display !== 'none';
          if (_idleVisible) {
            let _addr = null;
            try {
              if (
                typeof Business !== 'undefined' &&
                typeof Business.getCurrentLiveAddress === 'function'
              ) {
                _addr = Business.getCurrentLiveAddress();
              }
            } catch (_) {
              /* 起動直後で cache 未確立等 → 非表示のまま */
            }
            _locEl.textContent = _addr || '';
          }
        }
      }
      setInterval(updateClock, 1000);
      updateClock();

      // ─── 業務管理ダッシュボード更新（2026/05/01追加） ───
      // screenIdle の5項目（総走行距離・実車総距離・営業回数・売上）を Business から表示
      // 業務未開始時はゼロ表示・業務中はリアルタイム集計値を表示
      function updateBusinessDashboard() {
        if (typeof Business === 'undefined') return;
        try {
          const r = Business.getReport();
          const elTotal = document.getElementById('totalDist');
          const elActual = document.getElementById('todayDist');
          const elCount = document.getElementById('todayCount');
          const elFare = document.getElementById('fareTotalYen');
          // ★設計変更宣言 (2026-05-14・実車完了後ホーム集計表示の最終更新修正):
          //   旧: Business state のみで DOM 更新 → 何らかの理由で state.actual_total_m=0 / trip_count=0
          //       のままだと、setInterval(1s) が DOM を 0 に上書きし続け実車完了後の更新が反映されない
          //       (司さん実機 2026-05-14 09:45 報告事象)
          //   新: Business state と global accumulator (todayDist/todayCount・renderFare で更新済) を
          //       Math.max で取って表示・どちらか欠けても確実に値が表示される (安全側上書きなし)
          //   絶対ルール準拠: 集計値の "正値" を残す方向 (誤って 0 に戻さない) ・課金本体は無影響
          const actualM = Math.max(
            r.actual_total_m || 0,
            typeof todayDist === 'number' ? todayDist : 0
          );
          const tripN = Math.max(
            r.trip_count || 0,
            typeof todayCount === 'number' ? todayCount : 0
          );
          // ★設計変更宣言 (2026-05-14・本日売上にも global fallback 追加):
          //   旧: elFare は r.fare_total_yen のみ → onTripEnd 失敗時に ¥0 で固まる
          //   新: Math.max(r.fare_total_yen, todayFareYen) で renderFare 蓄積値を fallback (dist/count と同パターン)
          const fareYen = Math.max(
            r.fare_total_yen || 0,
            typeof todayFareYen === 'number' ? todayFareYen : 0
          );
          // ★総走行距離にも他の3つと同じ命綱を付ける (2026-08-08)★
          //   0 に落ちても、同じ業務の中で一度出た正の値より下げない。
          //   拾う相手は ★総走行距離そのもの★（実車 todayDist ではない＝別の嘘を作らない）。
          const totalM = Math.max(r.total_distance_m || 0, lastGoodTotalM);
          lastGoodTotalM = totalM;
          if (elTotal) elTotal.textContent = (totalM / 1000).toFixed(2);
          if (elActual) elActual.textContent = (actualM / 1000).toFixed(2);
          if (elCount) elCount.textContent = tripN;
          if (elFare) elFare.textContent = fareYen.toLocaleString();
        } catch (e) {
          console.error('[Dashboard] update error:', e);
        }
      }
      // ★件1 (2026-06-20) 総走行距離の "20m飛び" 解消 = 表示更新だけ 1Hz→5Hz★
      //   値そのものは getReport().total_distance_m = business_display_distance_m (平滑済・
      //   課金距離 display_distance_m と同じ平滑系) を読んでおり滑らか。荒れの正体は
      //   refresh 周期が 1Hz で、走行 20m/s 時に毎tick 約20m ずつ飛んで見えること。
      //   課金距離メーターは rAF(60Hz) 再描画で滑らかに見える。本ダッシュボードを 200ms
      //   (5Hz) に上げると増分≈4m となり課金距離より細かく滑らかに表示される。
      //   ★距離/課金/過大ゼロ は不可侵 — 本変更は表示の再描画頻度のみ (値計算は無改変)★
      setInterval(updateBusinessDashboard, 200);
      updateBusinessDashboard();

      // ─── GPS（代行開始時に初めて起動） ───
      // (2026-05-10) gpsStarted / _lastGpsLogAt / _gpsCallbackCount は
      // script 先頭に移動済 (TDZ 対策・startGPS が appState 等を参照する前に確実に初期化)
      function startGPS() {
        if (gpsStarted) {
          if (typeof dlog === 'function') dlog('[GPS] startGPS: 既に起動済（スキップ）');
          return;
        }
        gpsStarted = true;
        if (typeof dlog === 'function') dlog('[GPS] startGPS: watchPosition 開始');
        // ★設計変更宣言 (2026-05-13・sticky gate 修正): GPS.start() が同期例外で失敗した時
        //   旧: gpsStarted=true がそのまま残り、以降の startGPS が全て「既に起動済」で skip
        //       → 業務開始フロー (L2846) からの startGPS が永久 dead → badge「GPS待機」固定
        //   新: 失敗時に gpsStarted=false にロールバック → 次回 startGPS で再試行可能
        //       (低リスク: 例外が起きた時のみ flag を戻す・正常系の二重起動防止は維持)
        try {
          GPS.start(function (g) {
            try {
              _gpsCallbackCount++;
              // ★起動計測ログ Phase 0 (2026-05-25): GPS first fix mark (= 初回 callback のみ・read-only)
              if (_gpsCallbackCount === 1) {
                try {
                  if (
                    typeof performance !== 'undefined' &&
                    typeof performance.mark === 'function'
                  ) {
                    performance.mark('first-gps-fix');
                  }
                } catch (_) {
                  /* 業務影響ゼロ・graceful skip */
                }
              }
              // ★設計変更宣言 (2026-05-13・大改修 C10): GPS 初回 fix 通知
              //   pipeline の Phase D (waitForGPS) を resolve
              // ★設計変更宣言 (2026-05-16・Step7・現在地県を渡して cache 自動補修):
              //   notifyGpsFix に lat/lng/accuracy を渡し、pipeline 側で
              //   RegionHelper.getCurrentPref → 該当県の cache miss 自動 retry を起動。
              //   オンライン時のみ動作・オフラインでは silent skip (= 業務継続性最優先)。
              if (window._mmPipeline && !window._mmPipeline.ready.gpsAcquired) {
                try {
                  window._mmPipeline.notifyGpsFix(g.lat, g.lng, g.accuracy);
                } catch (_) {}
              }
              // 5秒に1回のペースで動作確認ログ（スパム防止）
              const now = Date.now();
              if (now - _lastGpsLogAt > 5000) {
                _lastGpsLogAt = now;
                if (typeof dlog === 'function') {
                  dlog(
                    '[GPS] 位置取得 #' +
                      _gpsCallbackCount +
                      ' lat=' +
                      g.lat.toFixed(5) +
                      ' lng=' +
                      g.lng.toFixed(5) +
                      ' 精度=' +
                      parseFloat(g.accuracy).toFixed(0) +
                      'm' +
                      ' 速度=' +
                      (g.speed_kmh != null ? g.speed_kmh.toFixed(1) + 'km/h' : 'N/A') +
                      ' state=' +
                      appState
                  );
                }
              }
              const dot = document.getElementById('gpsDot');
              dot.className = 'gps-dot ok';
              dot.title = 'GPS 精度 ' + parseFloat(g.accuracy).toFixed(0) + 'm';
              // ★精度数字は表示しない(司さん指示・繋がってるかはドット色だけ)。
              //   精度値は debug パネル用に dot の data 属性に保持。gpsAcc ラベルは「GPS」固定。
              dot.dataset.acc = parseFloat(g.accuracy).toFixed(0);
              const _gpsAccEl = document.getElementById('gpsAcc');
              if (_gpsAccEl) _gpsAccEl.textContent = 'GPS';
              // 起動時warm up（2026/04/30追加）：常にGPSをMeterに渡す
              // 代行開始前でもlastWarmupGpsを保持・押した瞬間に即時計測開始
              if (typeof Meter.updateGpsOnly === 'function') Meter.updateGpsOnly(g);
              // B6 (2026-05-09): 停車に変化したら Worker B にヒント送って _gpsBuffer クリア
              if (g.isStationary && !window._lastStationary && _mmWorker) {
                try {
                  _mmWorker.postMessage({ type: 'stationaryHint' });
                } catch (_) {}
              }
              window._lastStationary = !!g.isStationary;
              // P3 (2026-05-09): 常時 Meter.update を呼出
              //   Meter は state.running=false 中は加算しないので副作用なし。
              //   業務外でも Worker B に GPS が流れて MM がウォームアップされる
              //   (snap miss/skip カウントは加算されるが課金には影響しない)
              Meter.update(g);
              // 業務中の総走行距離計測（2026/05/04 夜・修正）
              // business.js は onGps を公開しており state.active 中なら total_distance_m に加算する
              // 実車中・空車中問わず業務全体の距離を計測する設計
              if (typeof Business !== 'undefined' && typeof Business.onGps === 'function') {
                Business.onGps(g);
              }
              // ★メーターの控えを端末に書く (2026-08-04)★
              //   司さん「オフラインで走って ★画面を閉じて★ 家で業務終了」→ 距離が0で上がった。
              //   meter.js は距離も料金も端末に保存していない（localStorage 参照3件は全部
              //   車両プロファイル）。閉じた瞬間に消えるので、ここで1秒ごとに控える。
              //   ★1秒★＝business.js の保存と同じ間隔（5秒だと時速50kmで約70m＝金額が消える）。
              //   実測 287バイト・0.0008ミリ秒。距離の計算には割り込まない（呼ぶだけ）。
              _saveMeterSnapshot();
              // ★設計変更宣言 (2026-05-23・住所② 現在地ライブ表示・raw GPS 配信):
              //   走行中 / 停止中 を問わず・1Hz で・raw GPS を Business に通知・常時表示 source。
              //   表示専用 (= distance_m / Meter / Worker B 完全無関係)。
              if (typeof Business !== 'undefined' && typeof Business.notifyRawGps === 'function') {
                try {
                  Business.notifyRawGps(g.lat, g.lng);
                } catch (_) {
                  // Business 未 load・notifyRawGps 未実装 等 → graceful skip
                }
              }
              // S2 (2026-05-10) 業務開始忘れ検出: 2026-05-23 Phase 1・お節介ルール適用・削除済
              // ★設計変更宣言 (2026-05-23・Phase 2・restoreBanner 簡略化):
              //   単独「✅ 走行データを復元しました」表示は・Phase 1 で・撤去 (= 自明・冗長)。
              //   GPS 再取得後・実 距離加算 (= addedM > 0) を検知した時のみ・初めて show class 追加+
              //   「+Xm・¥Y 補完」追記で・表示する (= user の・操作判断に必要な事実通知のみ)。
              if (window._restoreDistanceM != null) {
                const cur = Meter.getState();
                const addedM = Math.round(cur.distance_m - window._restoreDistanceM);
                const addedYen = cur.fare_yen - window._restoreFareYen;
                if (addedM > 0) {
                  const banner = document.getElementById('restoreBanner');
                  banner.textContent =
                    '✅ 走行データを復元しました（+' +
                    addedM +
                    'm・¥' +
                    addedYen.toLocaleString() +
                    '補完）';
                  banner.classList.add('show');
                  window._restoreDistanceM = null;
                  window._restoreFareYen = null;
                }
              }
              // ★設計変更宣言 (2026-05-17・RegionLoader 撤去): RegionLoader.ensureLoaded 呼出削除。
              //   js/region-loader.js は存在せず・どこからも代入されないため永続 undefined。
              //   meter.js 側の inline snap / tunnel-bridge polyline 経路は全削除済 (= consumer 不在)。
              // ★設計変更宣言 (2026-05-13・大改修 C11): GPS callback 内の旧経路呼出を削除
              //   MMDataPipeline (C10) が起動時に全 47 県ロード済のため、走行中の追加 load は不要。
              //   旧 M1: _autoLoadNearbyRoads(g.lat, g.lng);  ← 削除済
              // TestMode 走行中位置記録は H-3 対応で削除済
            } catch (e) {
              console.error('GPS callback error:', e);
            }
          });
        } catch (e) {
          console.error('GPS start error:', e);
          // ★設計変更宣言 (2026-05-13・sticky gate 修正): 例外時に gpsStarted を false へ戻す
          gpsStarted = false;
          if (typeof dlog === 'function')
            dlog(
              '[GPS] startGPS: GPS.start 失敗 → gpsStarted=false にロールバック (' +
                ((e && e.message) || e) +
                ')'
            );
        }
      }

