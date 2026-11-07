      // P6 (2026-05-09): idle 画面 MM 準備状況インジケータ 1Hz 更新
      //   _forwardedPrefs Set のサイズを業務開始ボタン下に表示
      //   5 県以上 forward 済 + 直近 mmResult あれば「準備完了」緑表示
      //
      // ★設計変更宣言 (2026-05-10): MM データ読込前の業務開始ガード追加
      //   businessStart 画面で _forwardedPrefs.size === 0 の間は
      //   業務開始ボタンを disabled にして「データ読み込み中です (X/5県)」表示。
      //   1 県以上 forward 済になり次第 enabled に戻す。
      //   理由: MM 道路データが 0 件のまま業務開始すると、Worker B に snap 候補が
      //         無く inline fallback (= GPS 直線距離禁止ルールの境界) に依存してしまう。
      //         絶対ルール「道路距離課金」を担保するため、最低 1 県の forward を待つ。
      setInterval(function () {
        const ind = document.getElementById('mmReadyIndicator');
        if (!ind) return;
        // ★設計変更宣言 (2026-05-10): mmReadyIndicator も全面見直し
        //   旧: MM 準備完了 / 準備中 / 0/5 等を常時表示
        //   新: 通常時は完全非表示・「⚠ 位置情報の精度が低下しています」のみ
        //       表示条件: forwarded === 0 が 30 秒継続のとき
        //   「課金」ワードは UX 不安要因のため全削除
        if (appState !== 'idle' && appState !== 'businessStart') {
          ind.style.display = 'none';
          return;
        }
        // ★設計変更宣言 (2026-05-13・gate 修正): 旧 _forwardedPrefs.size から
        //   新パイプライン参照に書換 (mmReadyIndicator + business start button)
        const forwarded =
          window._mmPipeline && window._mmPipeline.stats ? window._mmPipeline.stats.roadsOk : 0;
        const now = Date.now();
        if (forwarded > 0) {
          window._mmReadyZeroSince = null;
          ind.style.display = 'none';
        } else {
          if (window._mmReadyZeroSince == null) window._mmReadyZeroSince = now;
          if (now - window._mmReadyZeroSince >= 30000) {
            ind.textContent = '⚠ 位置情報の精度が低下しています';
            ind.style.background = '#FDECEA';
            ind.style.color = '#C0392B';
            ind.style.display = 'block';
          } else {
            ind.style.display = 'none';
          }
        }
        // ★設計変更宣言 (2026-05-14): 業務開始ボタンの enable/disable (グレーアウト) 撤去
        //   絶対ルール準拠は meter.js の inline snap miss 据え置きで担保・本 gate は不要
      }, 1000);

      // ★設計変更宣言 (2026-05-10): _preloadRoadsForBusinessStart を全削除
      //   旧: businessStart 画面遷移時に getCurrentPosition() を自動発火して
      //       MM データを先読み
      //   新: 自動 GPS 発火を全廃する設計に従い getCurrentPosition 経路を撤廃
      //       (btnSensorPermission 押下経由でのみ navigator.geolocation を呼ぶ)
      //   先読み機能は失われるが、btnSensorPermission → startGPS → GPS callback
      //   → _autoLoadNearbyRoads という従来 path で MM データ load される

      // ─── ストレージ永続化（2026/04/30追加：オフライン業務でデータ消失防止） ───
      // iOS のキャッシュ自動削除を防ぐ・道路データ等を永続的に保持
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage
          .persist()
          .then(function (persisted) {
            dlog(
              '[Storage] 永続化:',
              persisted ? '成功（キャッシュ保護）' : '不可（PWA未追加など）'
            );
          })
          .catch(function (err) {
            dlog('[Storage] 永続化エラー:', err.message);
          });
      }

      // ─── Wi-Fi 接続時の test-results 自動 push (2026-05-09 追加) ─────────
      // 走行終了して事務所に戻り Wi-Fi が掴めたら、IndexedDB に貯めた
      // data/test-results/latest.json のスナップショットを GitHub Contents API で push する。
      // 操作は不要・連続 push を防ぐためデバウンス + 24h 内重複ハッシュ skip。
      //
      // PAT は localStorage 'daikou_gh_pat' に保存 (UI 未提供・必要に応じて DevTools で投入)
      // 未設定なら一切走らない (= 通常ユーザーには無影響)
      //
      // IndexedDB ストア daikome_test_results: { id: 'latest', json: '...stringified...' }
      (function setupTestResultsAutoPush() {
        const GH_OWNER = 'exally-zeroact';
        const GH_REPO = 'Daikou-app-test';
        const GH_BRANCH = 'main';
        const GH_PATH = 'data/test-results/latest.json';
        const TR_DB = 'daikome_test_results';
        const TR_STORE = 'kv';
        const COOLDOWN_MS = 5 * 60 * 1000; // 5 分以内の連続 push は抑制

        let _busy = false;
        let _lastPushAt = 0;
        let _lastPushedHash = null;

        function _hash(s) {
          let h = 0;
          for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h + s.charCodeAt(i)) | 0;
          }
          return h.toString(16);
        }
        function _isWifi() {
          const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
          if (!c) return false;
          if (c.type) return c.type === 'wifi' || c.type === 'ethernet';
          // type 取れないブラウザは effectiveType=4g かつ saveData=false を Wi-Fi 相当扱い
          return c.effectiveType === '4g' && !c.saveData;
        }
        function _openDb() {
          return new Promise(function (resolve, reject) {
            const req = indexedDB.open(TR_DB, 1);
            req.onupgradeneeded = function (e) {
              const db = e.target.result;
              if (!db.objectStoreNames.contains(TR_STORE)) db.createObjectStore(TR_STORE);
            };
            req.onsuccess = function () {
              resolve(req.result);
            };
            req.onerror = function () {
              reject(req.error);
            };
          });
        }
        function _readLatest() {
          return _openDb().then(function (db) {
            return new Promise(function (resolve) {
              const tx = db.transaction(TR_STORE, 'readonly');
              const store = tx.objectStore(TR_STORE);
              const req = store.get('latest');
              req.onsuccess = function () {
                db.close();
                resolve(req.result || null);
              };
              req.onerror = function () {
                db.close();
                resolve(null);
              };
            });
          });
        }
        // 公開: 端末側 OBD/ground-truth 計測ループ等が完了したら呼ぶ
        // payload は schema 互換 JSON object (replay-mm.js が出力するもの相当)
        window.saveTestResultsLocally = function (payload) {
          return _openDb()
            .then(function (db) {
              return new Promise(function (resolve, reject) {
                const tx = db.transaction(TR_STORE, 'readwrite');
                const store = tx.objectStore(TR_STORE);
                const req = store.put(
                  { json: JSON.stringify(payload), savedAt: Date.now() },
                  'latest'
                );
                req.onsuccess = function () {
                  db.close();
                  resolve(true);
                };
                req.onerror = function () {
                  db.close();
                  reject(req.error);
                };
              });
            })
            .then(function () {
              tryPush(false);
            });
        };

        async function tryPush(triggeredByConnChange) {
          if (_busy) return;
          const pat = (function () {
            try {
              return localStorage.getItem('daikou_gh_pat') || '';
            } catch (_) {
              return '';
            }
          })();
          if (!pat) return; // PAT 無し → 自動 push 機能 OFF
          if (!navigator.onLine) return;
          if (!_isWifi()) return;
          if (Date.now() - _lastPushAt < COOLDOWN_MS) return;
          const rec = await _readLatest();
          if (!rec || !rec.json) return;
          const hash = _hash(rec.json);
          if (hash === _lastPushedHash) return; // 内容変化なし

          _busy = true;
          try {
            const apiUrl =
              'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + GH_PATH;
            // 既存 file の sha を取得 (上書き update に必要)
            const headRes = await fetch(apiUrl + '?ref=' + GH_BRANCH, {
              headers: { Authorization: 'token ' + pat, Accept: 'application/vnd.github+json' },
            });
            let sha = null;
            if (headRes.ok) {
              const j = await headRes.json();
              sha = j.sha || null;
            } else if (headRes.status !== 404) {
              throw new Error('lookup HTTP ' + headRes.status);
            }
            const body = {
              message: 'chore(test-results): auto-push from device [skip ci]',
              content: btoa(unescape(encodeURIComponent(rec.json))),
              branch: GH_BRANCH,
            };
            if (sha) body.sha = sha;
            const putRes = await fetch(apiUrl, {
              method: 'PUT',
              headers: {
                Authorization: 'token ' + pat,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
            });
            if (!putRes.ok) throw new Error('put HTTP ' + putRes.status);
            _lastPushAt = Date.now();
            _lastPushedHash = hash;
            if (typeof dlog === 'function')
              dlog(
                '[TestPush] uploaded test-results (' +
                  (triggeredByConnChange ? 'wifi' : 'manual') +
                  ')'
              );
          } catch (e) {
            if (typeof dlog === 'function') dlog('[TestPush] failed: ' + ((e && e.message) || e));
          } finally {
            _busy = false;
          }
        }

        // 接続状態変化を監視
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn && conn.addEventListener)
          conn.addEventListener('change', function () {
            tryPush(true);
          });
        window.addEventListener('online', function () {
          tryPush(true);
        });
        // 初回起動時にも 1 回チェック
        setTimeout(function () {
          tryPush(false);
        }, 8000);
      })();

      // ★設計変更宣言 (2026-05-15・住所取得 retry: 解決時の UI 即時更新):
      //   business.js の _scheduleAddressRetry が成功時に発火する CustomEvent を listen し、
      //   料金画面 (screenFare) 表示中なら routeCard を再描画する。
      //   waypointCard は startUiTimer の 500ms ループで current_trip に自動同期するため
      //   ここでは routeCard のみ即時反映する (= screenFare 表示中に start/waypoint/end のいずれかが
      //   遅延解決した場合の経路カード更新)。
      //   絶対ルール準拠: try/catch で例外を吸収・retry 解決時の UI 表示で業務継続性は不変。
      window.addEventListener('business:address-resolved', function (e) {
        try {
          if (typeof renderRouteCard === 'function' && appState === 'fare') {
            renderRouteCard();
          }
        } catch (_) {}
      });

