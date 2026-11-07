      // 起動（H-1: 失敗しても自動再起動が回るので例外で止めない）
      _setupMmWorker('init');

      // ★設計変更宣言 (2026-05-13・大改修 C10): 新パイプライン稼働
      //   MMDataPipeline で全データロード + GPS + MM warmup を段階的に制御
      //   旧 _autoLoadNearbyRoads 起動 kick は並行で残置 (C11 で削除予定)
      //   warmup() は fire-and-forget で起動・結果は ready フラグで参照
      // ★設計変更宣言 (2026-05-13・Phase 4 / C12): dlOverlay 流用 ローディング UI
      //   新パイプライン (MMDataPipeline) の進捗を dlOverlay に反映。
      //   Phase 進行表現 (2026-05-13・Phase D/E は warmup から除外で再配分):
      //     Phase A (global):       0% →  20%  "全国共通データ読込中... X/20"
      //     Phase B (roads):       20% →  50%  "X/47 県完了"
      //     Phase C (aux-*):       50% → 100%  "補助データ読込中... X/282"
      //     ※ GPS / MM warmup は「業務開始」ボタンで startGPS() 呼出後に発生する
      //       通常フローに任せる (仕様: index.html:2739 参照)
      function _updatePipelineProgressUI(p) {
        try {
          const fill = document.getElementById('dlProgressFill');
          const text = document.getElementById('dlProgressText');
          if (!fill || !text) return;
          let phaseLabel = '';
          let phaseStart = 0;
          let phaseRange = 0;
          if (p.phase === 'global') {
            phaseLabel = '全国共通データ読込中... ' + p.current + '/' + p.total;
            phaseStart = 0;
            phaseRange = 20;
          } else if (p.phase === 'roads') {
            phaseLabel = p.current + '/' + p.total + ' 県完了';
            phaseStart = 20;
            phaseRange = 30;
          } else if (p.phase && p.phase.indexOf('aux-') === 0) {
            // ★設計変更宣言 (2026-05-13・Phase C 累計化):
            //   旧: 種別 (tunnels/bridges/...) ごとに 1/47 → 47/47 でリセット表示
            //   新: 6 種 × 47 = 282 件の全体累計を smooth に表示
            //   stats.auxOk は各 kind 完了後に 47 ずつ加算 → 現在 kind 内は stagnant
            //   stats.auxOk + p.current で正確な累計 (1→282) を算出
            //   Phase D/E を warmup から外したので Phase C を 50% → 100% に再配分。
            const _auxOk =
              window._mmPipeline && window._mmPipeline.stats ? window._mmPipeline.stats.auxOk : 0;
            const _cum = _auxOk + p.current;
            const _TOTAL_AUX = 282; // 47 県 × 6 種
            phaseLabel = '補助データ読込中... ' + _cum + '/' + _TOTAL_AUX;
            phaseStart = 50;
            phaseRange = 50;
            const _auxPct = phaseStart + (_cum / _TOTAL_AUX) * phaseRange;
            fill.style.width = Math.min(100, Math.max(5, _auxPct)).toFixed(1) + '%';
            text.textContent = phaseLabel;
            return;
          } else {
            phaseLabel = p.phase + ' ' + p.current + '/' + p.total;
          }
          const phasePct = phaseStart + (p.total > 0 ? (p.current / p.total) * phaseRange : 0);
          fill.style.width = Math.min(100, Math.max(5, phasePct)).toFixed(1) + '%';
          text.textContent = phaseLabel;
        } catch (_) {}
      }

      try {
        if (typeof MMDataPipeline === 'function' && typeof DataLoader !== 'undefined') {
          window._mmPipeline = new MMDataPipeline({
            worker: _mmWorker,
            loader: DataLoader,
            onProgress: function (p) {
              if (typeof dlog === 'function') {
                dlog(
                  '[Pipeline] ' + p.phase + ' ' + p.current + '/' + p.total + ' ' + (p.label || '')
                );
              }
              _updatePipelineProgressUI(p);
              // ★設計変更宣言 (2026-05-13・Phase C 早期 hide 撤去):
              //   旧: aux 282/282 で 500ms 後 hide → Phase D (GPS) / Phase E (MM warmup)
              //       完了前に業務画面が見える矛盾 (ユーザー指摘の根本原因)
              //   新: hide は warmup().then の Phase E 完了後のみ
              //   ユーザー指示「データ揃ってから業務画面」を厳格に履行
            },
          });
          setTimeout(function () {
            const _isStandalone =
              window.navigator.standalone === true ||
              (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

            // ★ helper: dlOverlay を即 hide
            const _hideOverlay = function () {
              try {
                const _ov = document.getElementById('dlOverlay');
                if (_ov) {
                  _ov.style.display = 'none';
                  _ov.classList.remove('show');
                }
              } catch (_) {}
            };

            // ★設計変更宣言 (2026-05-13・非 PWA は即 hide):
            //   ブラウザ閲覧 (非 PWA) では overlay を出さず即 hide。warmup も skip。
            if (!_isStandalone) {
              _hideOverlay();
              if (typeof dlog === 'function')
                dlog('[Pipeline] 非 standalone・warmup skip + overlay 即 hide');
              return;
            }

            // ★設計変更宣言 (2026-05-13・warmup 完了マーカー check):
            //   旧: 毎回 overlay 表示 + warmup 全実行 → 履歴→戻るで毎回チラつき
            //   新: localStorage 'daikome_warmup_v1' を確認・version 一致なら
            //       overlay 即 hide + warmup を bg で実行 (cache 復元・SW 経由)
            //   無 or 旧 version: overlay 表示 + warmup blocking → 完了で hide + マーカー更新
            //   bg warmup 中も loadFromCache は ms 単位なので業務に影響なし。
            let _markerOk = false;
            try {
              const _m = localStorage.getItem('daikome_warmup_v1');
              if (_m) {
                const _p = JSON.parse(_m);
                const _expected = (window.DataRegistry && window.DataRegistry.VERSION) || '0';
                _markerOk = _p && _p.version === _expected;
                if (typeof dlog === 'function') {
                  dlog(
                    '[Pipeline] マーカー確認 version=' +
                      (_p && _p.version) +
                      ' expected=' +
                      _expected +
                      ' overlay=' +
                      (_markerOk ? 'skip' : 'show')
                  );
                }
              } else {
                if (typeof dlog === 'function') dlog('[Pipeline] マーカー無 (初回) overlay=show');
              }
            } catch (_) {}

            if (_markerOk) {
              // 完了済 → overlay 即 hide + warmup bg (cache 復元目的)
              _hideOverlay();
              try {
                window._mmPipeline.warmup().catch(function (e) {
                  console.warn('[Pipeline] warmup error (bg):', e && e.message);
                });
              } catch (e) {
                console.warn('[Pipeline] warmup throw (bg):', e && e.message);
              }
              return;
            }

            // 初回 or 旧 version: overlay 維持 + warmup blocking
            try {
              const _loading = document.getElementById('dlStateLoading');
              if (_loading) _loading.classList.add('show');
              const _complete = document.getElementById('dlStateComplete');
              if (_complete) _complete.classList.remove('show');
              const _text0 = document.getElementById('dlProgressText');
              if (_text0) _text0.textContent = '全国地図データを準備中...';
              const _fill0 = document.getElementById('dlProgressFill');
              if (_fill0) _fill0.style.width = '5%';
            } catch (_) {}
            try {
              window._mmPipeline
                .warmup()
                .then(function () {
                  // ★起動計測ログ Phase 0 (2026-05-25): MMDataPipeline warmup 完了 mark (= read-only)
                  try {
                    if (
                      typeof performance !== 'undefined' &&
                      typeof performance.mark === 'function'
                    ) {
                      performance.mark('mm-warmup-done');
                    }
                  } catch (_) {
                    /* 業務影響ゼロ・graceful skip */
                  }
                  // ★ warmup 完了で進捗を 100% に固定 + 完了文言
                  try {
                    const fill = document.getElementById('dlProgressFill');
                    const text = document.getElementById('dlProgressText');
                    if (fill) fill.style.width = '100%';
                    if (text) text.textContent = '準備完了';
                  } catch (_) {}
                  if (typeof dlog === 'function') dlog('[Pipeline] UI 完了表示');
                  setTimeout(function () {
                    _hideOverlay();
                    // ★設計変更宣言 (2026-05-13): warmup 完了直後に許可/業務開始ボタンを切替
                    //   未許可なら許可ボタンのみ・許可済なら業務開始ボタンのみ表示
                    try {
                      if (typeof updateStartButtonsGate === 'function') updateStartButtonsGate();
                    } catch (_) {}
                  }, 800);
                })
                .catch(function (e) {
                  console.warn('[Pipeline] warmup error:', e && e.message);
                });
            } catch (e) {
              console.warn('[Pipeline] warmup throw:', e && e.message);
            }
          }, 0);
        } else {
          if (typeof dlog === 'function')
            dlog('[Pipeline] 依存未満で起動 skip (MMDataPipeline or DataLoader 未定義)');
        }
      } catch (e) {
        console.warn('[Pipeline] init err:', e && e.message);
      }

      // ★設計変更宣言 (2026-05-13・大改修 C11): boot-fast IIFE を全削除
      //   last_gps ベースの roads warm-up は MMDataPipeline (C10) で代替。
      //   起動時に全 47 県を新パイプラインがロードするため、位置依存の
      //   早期 warm-up は不要。_bootRaw / _bootLat / _bootLng 等の関連
      //   変数も全廃。

      // ─── M-3: Page Visibility 復帰時 Worker B 生存確認 ───
      // document.visibilityState が visible になったら ping を送り、
      // 一定時間（3 秒）応答がなければ Worker を再起動する。
      // (2026-05-10) _mmHealthPongAt / _mmHealthPingAt / _MM_HEALTH_TIMEOUT_MS は
      // script 先頭に移動済 (TDZ 対策)
      function _mmHealthCheck() {
        if (!_mmWorker) {
          if (typeof dlog === 'function') dlog('[MM] visibility 復帰: worker 不在 → 再起動');
          if (_mmWorkerRestartTimer) {
            clearTimeout(_mmWorkerRestartTimer);
            _mmWorkerRestartTimer = null;
          }
          _setupMmWorker('visibility-recover');
          return;
        }
        _mmHealthPingAt = Date.now();
        try {
          _mmWorker.postMessage({ type: 'getMm7Stats' });
        } catch (e) {}
        setTimeout(function () {
          if (_mmHealthPongAt < _mmHealthPingAt) {
            // pong 未着 → worker が応答不能と判断して再起動
            if (typeof dlog === 'function') dlog('[MM] visibility ping 応答なし → worker 再起動');
            try {
              if (_mmWorker) _mmWorker.terminate();
            } catch (e) {}
            _mmWorker = null;
            window._mmWorker = null;
            if (typeof Meter !== 'undefined' && Meter.setMapMatcher) {
              Meter.setMapMatcher(null);
            }
            _setupMmWorker('visibility-timeout');
          }
        }, _MM_HEALTH_TIMEOUT_MS);
      }
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
          _mmHealthCheck();
          // P7 (2026-05-09): iOS PWA backgrounded → resume race 短縮
          //   visibility 復帰で last GPS から roads 再 warm を発火
          //   Worker が kill されてた場合は _setupMmWorker 経由で _forwardedPrefs.clear→
          //   全ROADS_<PREF> 再 forward が動くが、新規 pref が必要なら _autoLoadNearbyRoads
          //   が補完
          try {
            const lastDriving = localStorage.getItem('daikou_driving_state');
            if (lastDriving) {
              const d = JSON.parse(lastDriving);
              if (
                d &&
                typeof d.last_lat === 'number' &&
                typeof d.last_lng === 'number' &&
                typeof _autoLoadNearbyRoads === 'function'
              ) {
                _autoLoadNearbyRoads(d.last_lat, d.last_lng);
              }
            }
          } catch (e) {}
        }
      });

