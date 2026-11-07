      // ─── MM-2 (2026-05-08): 実機評価インフラ ──────────────────────
      // DEBUG.enabled の時のみ画面右下に MM 統計バッジを常時表示
      // 2 秒ごとに Meter.getMMStats() を読み snap_rate / skip_rate /
      // mm_distance_m / p99_latency_ms を更新
      (function _initMmStatsBadge() {
        if (typeof DEBUG === 'undefined' || !DEBUG.enabled) return;
        // ★設計変更宣言 (2026-06-06・司さん指示「計測データが代行開始で出るのが邪魔」):
        //   開発用 HUD 3 種 (右下ステータスバッジ / mmEventLog / Worker B RAM パネル) は
        //   既定で完全非表示にする。テスト機でも司さんには見えない。
        //   自分(開発)が必要な時だけ ?hud=1 で表示 (localStorage に永続・?hud=0 で解除)。
        //   ★Firebase debug-trace のアップロードは本 gate と無関係に継続 = 実機 trace は従来通り取得可。
        const _hudEnabled = (function () {
          try {
            if (location.search.includes('hud=1')) {
              localStorage.setItem('daikome_show_hud', '1');
              return true;
            }
            if (location.search.includes('hud=0')) {
              localStorage.removeItem('daikome_show_hud');
              return false;
            }
            return localStorage.getItem('daikome_show_hud') === '1';
          } catch (_) {
            return false;
          }
        })();
        if (!_hudEnabled) return;
        const badge = document.createElement('div');
        badge.id = 'mmStatsBadge';
        badge.style.cssText =
          'position:fixed;right:8px;bottom:8px;z-index:9000;' +
          'background:rgba(0,0,0,0.72);color:#fff;font-family:monospace;' +
          'font-size:10px;padding:6px 8px;border-radius:6px;line-height:1.4;' +
          'pointer-events:none;white-space:nowrap;letter-spacing:0.3px;';
        badge.textContent = 'MM init...';
        document.body.appendChild(badge);
        setInterval(function () {
          // ★設計変更宣言 (2026-05-13): 業務中 (Meter.getState().running) のみ表示
          badge.style.display =
            typeof Meter !== 'undefined' && Meter.getState && Meter.getState().running
              ? ''
              : 'none';
          if (typeof Meter === 'undefined' || !Meter.getMMStats) return;
          const s = Meter.getMMStats();
          const snapPct = (s.snap_rate * 100).toFixed(0);
          const skipPct = (s.skip_rate * 100).toFixed(1);
          const mmKm = (s.mm_distance_m / 1000).toFixed(2);
          const dKm = (s.distance_m / 1000).toFixed(2);
          const p99 = s.p99_latency_ms.toFixed(1);
          const ac = s.avg_candidates.toFixed(1);
          const w = s.worker_active ? 'W' : 'I'; // W=worker / I=inline
          const mcm = s.mcm_window_size && s.mcm_window_size > 0 ? ' N=' + s.mcm_window_size : '';
          // RAM 実測（performance.memory は Chromium 系のみ）
          let ramStr = '';
          if (performance && performance.memory) {
            const heapMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
            const limitMB = (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(0);
            ramStr = ' main=' + heapMB + '/' + limitMB + 'MB';
          }
          badge.textContent =
            '[' +
            w +
            '] src=' +
            (s.distance_source || '?') +
            ' snap=' +
            snapPct +
            '% skip=' +
            skipPct +
            '%' +
            ' mm=' +
            mmKm +
            'km d=' +
            dKm +
            'km' +
            ' p99=' +
            p99 +
            'ms cand=' +
            ac +
            mcm +
            ramStr;
        }, 2000);

        // ─── D2 (2026-05-09): 直近 mmResult 20 件オーバーレイ (DEBUG 限定) ──
        //   Worker B → main の mmResult メッセージを傍受して画面右下にスクロール表示
        //   候補数・採用 emission・mmIncrementM が GPS step 単位で見える
        const mmLog = document.createElement('div');
        mmLog.id = 'mmEventLog';
        mmLog.style.cssText =
          'position:fixed;right:8px;bottom:32px;z-index:8999;' +
          'background:rgba(0,0,0,0.72);color:#9fe;font-family:monospace;' +
          'font-size:9px;padding:6px 8px;border-radius:6px;line-height:1.35;' +
          'pointer-events:none;white-space:pre;letter-spacing:0.2px;' +
          'max-width:60vw;max-height:32vh;overflow:hidden;';
        mmLog.textContent = 'mmResult 受信待ち';
        document.body.appendChild(mmLog);
        const _mmEvents = []; // 直近 20 件 (新→古)
        function _pushMmEvent(line) {
          _mmEvents.unshift(line);
          if (_mmEvents.length > 20) _mmEvents.pop();
          mmLog.textContent = _mmEvents.join('\n');
        }
        // 既存 _mmWorkerOnMessage と並行する独立 listener (worker 再起動毎に貼り直す必要あり)
        function _attachMmEventLog() {
          if (!_mmWorker) return;
          _mmWorker.addEventListener('message', function (ev) {
            const m = ev && ev.data;
            if (!m || m.type !== 'mmResult') return;
            const inc = (m.mmIncrementM != null ? m.mmIncrementM.toFixed(1) : '0').padStart(6);
            const cand = (m.candidatesCount != null ? m.candidatesCount : 0).toString().padStart(2);
            const emit = m.pickedEmission != null ? m.pickedEmission.toFixed(2) : '0.00';
            const lat = (m.latencyMs != null ? m.latencyMs.toFixed(1) : '?').padStart(4);
            const flag = m.committed ? 'C' : m.snapped ? 's' : m.skipped ? 'X' : '-';
            const r = m._reason ? (' ' + m._reason).slice(0, 18) : '';
            _pushMmEvent(
              '[' +
                flag +
                '] inc=' +
                inc +
                'm cand=' +
                cand +
                ' e=' +
                emit +
                ' lat=' +
                lat +
                'ms' +
                r
            );
          });
        }
        _attachMmEventLog();
        // Worker 再起動時に再 attach (window._mmWorker が変わったら検知)
        let _mmEventLogWorkerRef = window._mmWorker;
        setInterval(function () {
          // ★設計変更宣言 (2026-05-13): 業務中 (Meter.getState().running) のみ表示
          mmLog.style.display =
            typeof Meter !== 'undefined' && Meter.getState && Meter.getState().running
              ? ''
              : 'none';
          if (window._mmWorker !== _mmEventLogWorkerRef) {
            _mmEventLogWorkerRef = window._mmWorker;
            _attachMmEventLog();
            _pushMmEvent('--- Worker 再起動・log re-attached ---');
          }
        }, 3000);

        // ─── 詳細 RAM パネル（DEBUG 限定・タップで開閉）────────────────
        // Worker B / 各 graph / pheromone / grid / DEM の RAM 内訳を可視化
        const ramPanel = document.createElement('div');
        ramPanel.id = 'mmRamPanel';
        ramPanel.style.cssText =
          'position:fixed;left:8px;bottom:36px;z-index:9000;' +
          'background:rgba(0,0,0,0.85);color:#fff;font-family:monospace;' +
          'font-size:10px;padding:8px 10px;border-radius:6px;line-height:1.5;' +
          'max-width:80vw;display:none;white-space:pre;letter-spacing:0.3px;';
        document.body.appendChild(ramPanel);

        // バッジタップで RAM パネル開閉
        badge.style.pointerEvents = 'auto';
        badge.style.cursor = 'pointer';
        badge.addEventListener('click', function () {
          ramPanel.style.display = ramPanel.style.display === 'none' ? 'block' : 'none';
          if (ramPanel.style.display === 'block') _refreshRamPanel();
        });

        // RAM パネル更新（5 秒ごと + 開閉時に即更新）
        const _ramSnapshot = {
          workerMm7: null,
          workerTile: null,
          mainHeap: null,
        };
        function _refreshRamPanel() {
          if (!_mmWorker) return;
          try {
            _mmWorker.postMessage({ type: 'getMm7Stats' });
          } catch (e) {}
          try {
            _mmWorker.postMessage({ type: 'getTileStats' });
          } catch (e) {}
          setTimeout(_renderRamPanel, 200);
        }
        function _renderRamPanel() {
          const lines = ['=== Worker B RAM 計測 ==='];
          if (performance && performance.memory) {
            const heapMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
            const limitMB = (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(0);
            lines.push('main heap : ' + heapMB + ' / ' + limitMB + ' MB');
          } else {
            lines.push('main heap : N/A (Chromium 限定)');
          }
          if (_ramSnapshot.workerMm7) {
            const m = _ramSnapshot.workerMm7;
            lines.push(
              'MCM       : N=' +
                m.mcm_window_size +
                '/' +
                m.mcm_window_max +
                (m.mcm_shrunk ? ' [shrunk]' : '')
            );
            lines.push(
              'pheromone : ' + m.pheromone_roads_count + ' roads (' + m.pheromone_prefs + ' prefs)'
            );
            lines.push('grid bias : ' + m.grid_cells_count + ' / ' + m.grid_cells_max + ' cells');
            lines.push('worker p99: ' + m.worker_p99_ms.toFixed(2) + ' ms');
          }
          if (_ramSnapshot.workerTile) {
            const m = _ramSnapshot.workerTile;
            lines.push(
              'TileCache : ' + m.cacheSize + ' / ' + m.cacheMax + ' pinned=' + m.pinnedCount
            );
            lines.push('Backbone  : ' + (m.backboneLoaded ? m.backboneNodes + ' nodes' : 'OFF'));
          }
          lines.push('=== タップで閉じる ===');
          ramPanel.textContent = lines.join('\n');
        }

        // mmStats / tileStats 受信時に snapshot 更新
        _mmWorker &&
          _mmWorker.addEventListener('message', function (e) {
            const m = e.data;
            if (!m) return;
            if (m.type === 'mm7Stats') _ramSnapshot.workerMm7 = m;
            else if (m.type === 'tileStats') _ramSnapshot.workerTile = m;
          });

        // 5 秒ごとに自動更新（開いている時のみ）
        setInterval(function () {
          if (ramPanel.style.display === 'block') _refreshRamPanel();
        }, 5000);
      })();

      // ★設計変更宣言 (2026-05-13・大改修 C11): 旧読み込みコード一括削除
      //   削除対象:
      //   - _forwardRoadsToMmWorker (window.ROADS_{PREF} 経由 worker forward)
      //   - _decodeDeltaVarintB64 / _loadOneAttrFile / _autoLoadNearbyAttrs
      //     (road-attrs / road-flood / road-jizen / road-yobo の script タグ load)
      //   - _autoLoadNearbyRoads (関数定義・全 47 県常時ロード版)
      //   - _forwardDemToMmWorker + DemLoader.load IIFE
      //   - _forwardBackboneToMmWorker + _loadBackbone IIFE
      //   これらは新パイプライン (MMDataPipeline.warmup・C10) に役割を移譲。
      //   data-loader.js が cache 直接読出、data-registry.js が宣言的 metadata、
      //   mm-data-pipeline.js が段階的ロード制御を担う。
      //   consumer 側 (RegionLoader 利用箇所等) は後 commit で書き直す前提。

      // ─── 状態 ───
      // (2026-05-10) appState 〜 vehicleId は script 先頭に移動済 (TDZ 対策)

      // ─── リロード復元 ───
      function checkDrivingRestore() {
        try {
          const raw = localStorage.getItem('daikou_driving_state');
          if (!raw) return;
          const saved = JSON.parse(raw);
          // 24時間超は無効・削除
          if (Date.now() - saved.saved_at > 24 * 60 * 60 * 1000) {
            localStorage.removeItem('daikou_driving_state');
            return;
          }
          // 走行状態を復元
          appState = 'driving';
          Meter.start();
          Meter.setDistance(saved.distance_m);
          // ★復元時 latch: 確定済み実距離なので display を即一致 (= 0→target crawl 回避・overshoot なし)。
          if (typeof Meter.latchDisplay === 'function') Meter.latchDisplay();
          // ★設計変更宣言 (2026-05-19・B-3・代行中タスクキル elapsed_sec 復元):
          //   Meter.start() で elapsed_accumulated_sec=0 化される直後に・saved 値で再 prime。
          //   タスクキル前の経過時間が連続して継続される (= 業務継続性向上)。
          if (
            typeof saved.elapsed_sec === 'number' &&
            saved.elapsed_sec > 0 &&
            typeof Meter.setElapsedAccumulated === 'function'
          ) {
            Meter.setElapsedAccumulated(saved.elapsed_sec * 1000);
          }
          // 最終GPS状態をセット（層3・GPS消失補完を復元後に自動発火させる）
          if (saved.last_lat && saved.last_gps_at) {
            Meter.setLastGps(
              saved.last_lat,
              saved.last_lng,
              saved.last_altitude,
              saved.last_speed_kmh,
              saved.last_gps_at
            );
          }
          // 補完検知用：復元時の距離を保持（GPS再取得後にバナーを更新）
          window._restoreDistanceM = saved.distance_m;
          window._restoreFareYen = saved.fare_yen;
          showScreen('driving');
          document.getElementById('appbarTitle').textContent = '代行中';
          // ★設計変更宣言 (2026-05-10): 自動 startGPS() を削除
          //   GPS は btnSensorPermission 押下経由でのみ起動する設計に変更
          //   旧: startGPS();  ← 自動発火 (driving 復元時)
          startUiTimer();
          // ★設計変更宣言 (2026-05-23・Phase 1・restoreBanner 単独 show 撤去・お節介ルール適用):
          //   旧: 「✅ 走行データを復元しました」単独 show (= 自明・冗長・走行画面が・既に・走行状態 表示)
          //   新: 初回 show は・行わず・GPS 再取得後・addedM > 0 検知時のみ・初めて show (= L6092)
          dlog('[復元] 走行を再開しました');
          // ★設計変更宣言 (2026-05-14・checkDrivingRestore での GPS 自動起動を復活):
          //   2026-05-10 (d7a47fd8) で「user gesture 必須」として startGPS() を削除したが、
          //   iOS PWA standalone では geolocation permission は永続化されており user gesture
          //   なしで watchPosition が動作する (=当時の設計判断は iOS PWA の geolocation permission
          //   挙動の誤認に基づくものだった)。
          //   タスクキル後のセンサー許可状態は sensorRestoreBanner 経由のオレンジバナーで取得済み・
          //   業務継続最優先 (絶対ルール「業務中メーター止めない」) の観点から実車画面復元時は
          //   即座に GPS を起動すべき。
          //   sensorGranted の状態に関わらず無条件で startGPS() を呼ぶ。
          //   gpsStarted gate により二重起動は防止 (起動済の場合は早期 return)。
          //   旧経路 (2026-05-10 削除): startGPS();   を本コミットで復活。
          if (!gpsStarted) {
            try {
              startGPS();
              if (typeof dlog === 'function') dlog('[復元] 自動 startGPS');
            } catch (_) {}
          }
          // 2026/05/02：iOS PWA なら「センサー再起動」バナー表示
          //   タスクキルで DeviceMotion/Orientation リスナーが消失してるため
          //   司さんがボタン押下時に user gesture で全部復活させる
          const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
          if (isIOS && window.navigator.standalone === true) {
            // ★設計変更宣言 (2026-05-10): businessStart 画面では青ボタンを表示・orange banner のみ抑制
            const _bs = document.getElementById('screenBusinessStart');
            const _onBsScreen = _bs && _bs.style.display !== 'none';
            if (_onBsScreen) {
              const _btn = document.getElementById('btnSensorPermission');
              if (_btn) _btn.style.display = 'block';
              if (typeof dlog === 'function')
                dlog('[復元] businessStart 中 → 青ボタン表示・orange 抑制');
            } else {
              const sensorBanner = document.getElementById('sensorRestoreBanner');
              if (sensorBanner) sensorBanner.style.display = 'block';
              if (typeof dlog === 'function') dlog('[復元] センサー再起動バナー表示');
            }
          }
        } catch (e) {
          console.error('[復元] エラー:', e);
          localStorage.removeItem('daikou_driving_state');
        }
      }

