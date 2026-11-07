      // ★設計変更宣言 (2026-05-12): ライフサイクル heartbeat 実装 (P0 - iOS RAM 検証代替)
      //   目的: Mac なし環境で iOS PWA の OOM kill / 予期せぬ終了を間接検知
      //   仕組み:
      //     1. 5 秒ごとに localStorage に Date.now() を書込
      //     2. 起動時に前回の値と現在時刻を比較
      //     3. gap が 30 秒 〜 24 時間の範囲 = 想定外終了 (OOM 疑い) と判定
      //     4. Firebase の 'crash_reports/{sessionId}' に statistics を記録
      //   UI 影響: なし (サイレント動作)
      //   業務状態に関わらず常時稼働 (idle/driving/fare 全て)
      (function _initLifecycleHeartbeat() {
        const HEARTBEAT_KEY = 'daikou_last_alive_at';
        const HEARTBEAT_INTERVAL_MS = 5000;
        const GAP_MIN_MS = 30 * 1000; // 30 秒以上の gap で疑い
        const GAP_MAX_MS = 24 * 60 * 60 * 1000; // 24 時間以上は除外 (通常の長期未起動)

        // 5 秒ごと heartbeat 書込 (DOMContentLoaded を待たない・即座に開始)
        function _writeHeartbeat() {
          try {
            localStorage.setItem(HEARTBEAT_KEY, Date.now().toString());
          } catch (_) {}
        }
        setInterval(_writeHeartbeat, HEARTBEAT_INTERVAL_MS);
        // 初回も即座に 1 回書込 (起動直後 → 5 秒以内終了でも痕跡を残す)
        _writeHeartbeat();

        // 起動時クラッシュ検知 (DOMContentLoaded 後・FB 初期化を少し待ってから記録)
        function _checkCrashAndReport() {
          let lastAlive = 0;
          try {
            lastAlive = parseInt(localStorage.getItem(HEARTBEAT_KEY) || '0', 10);
          } catch (_) {}
          if (!lastAlive) return;
          const gap = Date.now() - lastAlive;
          if (gap <= GAP_MIN_MS || gap >= GAP_MAX_MS) return;

          const gapSec = Math.round(gap / 1000);
          if (typeof dlog === 'function') {
            dlog('[Lifecycle] 想定外の終了検知: gap=' + gapSec + 's');
          }

          // Firebase 'crash_reports/{sessionId}' に記録 (失敗しても無視)
          try {
            const sid =
              typeof FB !== 'undefined' && typeof FB.getSessionId === 'function'
                ? FB.getSessionId() || 'crash_' + Date.now()
                : 'crash_' + Date.now();
            if (typeof firebase !== 'undefined' && firebase.database) {
              firebase
                .database()
                .ref('crash_reports/' + sid)
                .set({
                  timestamp: Date.now(),
                  gap_sec: gapSec,
                  user_agent: navigator.userAgent,
                  device_memory: navigator.deviceMemory || 0,
                })
                .catch(function () {});
            }
          } catch (_) {}
        }

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function () {
            setTimeout(_checkCrashAndReport, 2000); // FB init 安定化を 2 秒待つ
          });
        } else {
          setTimeout(_checkCrashAndReport, 2000);
        }
      })();

      // ★設計変更宣言 (2026-05-14・MA-2 SPA overlay JS API・呼出元なし・Console テスト用):
      //   MA-1 で追加した #overlayHistory / #overlaySettings / #overlayHelp を切替する API。
      //   呼出元はまだ追加しない (MA-6 で bottom-nav onclick から呼ぶ時に初めて配線)。
      //   仕様:
      //   - showOverlay(name): 該当 overlay に .show + aria-hidden='false'・他は逆。
      //                       bottom-nav の .nav-item.active を該当 button (index) に移動。
      //   - hideAllOverlays(): 全 overlay の .show 削除・aria-hidden='true'・nav active を業務 (index 0) へ。
      //   nav-item の順序: [0]業務 / [1]使い方 / [2]設定 (2026-05-23・ナビ再設計・履歴タブ削除)。
      //   履歴 overlay は・nav slot を持たない (= screenIdle 内 .btn-history 等で到達)。
      //   showOverlay('history') 時は・_setNavActive 呼出をスキップし、業務タブ active を維持。
      (function () {
        const _OVERLAYS = {
          history: 'overlayHistory',
          settings: 'overlaySettings',
          help: 'overlayHelp',
          fare: 'overlayFare',
        };
        // ★設計変更宣言 (2026-05-15・MA Phase D): fare overlay は bottom-nav slot を持たない
        //   (overlaySettings 内「料金設定」リンク経由でのみ到達)・_NAV_INDEX 未登録のままで OK。
        // ★設計変更宣言 (2026-05-23・ナビ再設計): history も・nav slot 撤廃。
        //   showOverlay('history') / showOverlay('fare') は・_setNavActive 呼出をスキップ。
        const _NAV_INDEX = { help: 1, settings: 2 };

        function _setNavActive(idx) {
          // ★2026-06-05: ナビを appbar に移設したため selector を .appbar-nav に変更
          const items = document.querySelectorAll('.appbar-nav .nav-item');
          items.forEach(function (btn, i) {
            if (i === idx) btn.classList.add('active');
            else btn.classList.remove('active');
          });
        }

        window.showOverlay = function (name) {
          const targetId = _OVERLAYS[name];
          if (!targetId) {
            if (typeof dlog === 'function') dlog('[SPA] showOverlay: unknown name=' + name);
            return;
          }
          Object.keys(_OVERLAYS).forEach(function (key) {
            const el = document.getElementById(_OVERLAYS[key]);
            if (!el) return;
            if (_OVERLAYS[key] === targetId) {
              el.classList.add('show');
              el.setAttribute('aria-hidden', 'false');
            } else {
              el.classList.remove('show');
              el.setAttribute('aria-hidden', 'true');
            }
          });
          const idx = _NAV_INDEX[name];
          if (typeof idx === 'number') _setNavActive(idx);
          // ★設計変更宣言 (2026-05-14・MA-5): history overlay は表示の都度 fresh data に再描画。
          //   onTripEnd で daikou_history_<today> に追記されるため、表示時点の値を反映する必要がある。
          //   help / settings は静的 / 起動時 init で十分なので refresh hook を持たない (拡張時は同パターンで追加可能)。
          if (name === 'history' && typeof window._hist_render === 'function') {
            try {
              window._hist_render();
            } catch (e) {
              console.error('[SPA] _hist_render error:', e);
            }
          }
          // ★設計変更宣言 (2026-05-15・MA Phase D): fare overlay は表示の都度 fresh fareConfig を再描画。
          //   Firebase / localStorage の fareConfig が他経路で更新されている可能性があるため
          //   showOverlay 時に毎回 _fare_load() で再ロード + 全タブ render。
          if (name === 'fare' && typeof window._fare_load === 'function') {
            try {
              window._fare_load();
            } catch (e) {
              console.error('[SPA] _fare_load error:', e);
            }
          }
          if (typeof dlog === 'function') dlog('[SPA] showOverlay: ' + name);
        };

        window.hideAllOverlays = function () {
          Object.keys(_OVERLAYS).forEach(function (key) {
            const el = document.getElementById(_OVERLAYS[key]);
            if (!el) return;
            el.classList.remove('show');
            el.setAttribute('aria-hidden', 'true');
          });
          _setNavActive(0); // 業務ボタンに active を戻す
          if (typeof dlog === 'function') dlog('[SPA] hideAllOverlays');
        };

        // ★設計変更宣言 (2026-05-24・端末ライセンス未登録ゲート画面 開閉):
        //   spa-overlay 機構を流用 (= 既存 history/help/settings と同方式)・但し _OVERLAYS には登録しない
        //   (= nav 連動なし・独立 overlay)。
        //   showLicenseGate(info): info.message + device_id を表示・overlay show
        //   hideLicenseGate(): overlay hide
        window.showLicenseGate = function (info) {
          const el = document.getElementById('overlayLicenseGate');
          if (!el) return;
          const msgEl = document.getElementById('licenseGateMessage');
          if (msgEl && info && info.message) msgEl.textContent = info.message;
          const idEl = document.getElementById('licenseGateDeviceId');
          if (idEl) {
            let _did = '';
            try {
              if (window.LicenseActivate && window.LicenseActivate.deviceId)
                _did = window.LicenseActivate.deviceId();
            } catch (_) {
              /* ignore */
            }
            if (!_did) {
              try {
                if (window.License && window.License.getDeviceId)
                  _did = window.License.getDeviceId();
              } catch (_) {
                /* ignore */
              }
            }
            idEl.textContent = _did || '(不明)';
          }
          el.classList.add('show');
          el.setAttribute('aria-hidden', 'false');
        };

        window.hideLicenseGate = function () {
          const el = document.getElementById('overlayLicenseGate');
          if (!el) return;
          el.classList.remove('show');
          el.setAttribute('aria-hidden', 'true');
        };

        // 起動時・License 初期化 (= 非 block・promise・cache 更新のみ) + 設定のライセンスUI配線
        //   ・WiFi 接続あれば・Supabase 問い合わせ・cache 更新 / オフライン時は既存cache
        //   ・設定の #licenseCard: 端末ID表示/コピー・ゲートON/OFF・状態・再認証
        (function () {
          function _fmtLicState(st) {
            const m = {
              licensed: '✅ 有効',
              grace: '⚠ 猶予中(期限切れ・要再認証)',
              expired: '⛔ 期限切れ',
              unregistered: '未登録',
              unknown: '確認中…',
            };
            return m[st] || st;
          }
          window._updateLicenseUI = function () {
            try {
              if (typeof window.License === 'undefined') return;
              const idEl = document.getElementById('licDeviceId');
              if (idEl) idEl.textContent = window.License.getDeviceId();
              const stEl = document.getElementById('licState');
              if (stEl) stEl.textContent = _fmtLicState(window.License.getState().state);
              const tg = document.getElementById('licGateToggle');
              if (tg) tg.checked = localStorage.getItem('DK_LICENSE_GATE_ON') === '1';
            } catch (_) {
              /* 表示のみ */
            }
          };
          function _wireLicenseUI() {
            // ★コード活性化(2026-06-30・ドライバー端末・ログイン不要)★
            const actBtn = document.getElementById('licActivateBtn');
            const actMsg = document.getElementById('licActivateMsg');
            function _setActMsg(t, ok) {
              if (actMsg) {
                actMsg.textContent = t || '';
                actMsg.style.color = ok === false ? '#ff3b30' : ok ? '#34c759' : '#8e8e93';
              }
            }
            if (actBtn)
              actBtn.onclick = function () {
                const codeEl = document.getElementById('licActivateCode');
                const code = ((codeEl && codeEl.value) || '').trim().toUpperCase();
                if (!code) {
                  _setActMsg('コードを入れてください', false);
                  return;
                }
                if (typeof window.License === 'undefined' || !window.License.activate) {
                  _setActMsg('ライセンス機能が未読込', false);
                  return;
                }
                _setActMsg('有効化中…');
                window.License.activate(code).then(function (r) {
                  if (r && r.ok) {
                    _setActMsg('✅ 有効化しました', true);
                    if (window._updateLicenseUI) window._updateLicenseUI();
                    if (codeEl) codeEl.value = '';
                  } else {
                    const reason = r && r.reason;
                    const msg =
                      reason === 'full'
                        ? '契約台数がいっぱいです（' +
                          (r.seat_limit || '') +
                          '台）。台数を増やしてください'
                        : reason === 'expired'
                          ? '契約が期限切れです'
                          : reason === 'invalid'
                            ? 'コードが正しくありません'
                            : reason === 'network'
                              ? '通信エラー（電波を確認）'
                              : '有効化できませんでした';
                    _setActMsg('⚠ ' + msg, false);
                  }
                });
              };
            const copyBtn = document.getElementById('licCopyBtn');
            if (copyBtn)
              copyBtn.onclick = function () {
                try {
                  const id =
                    typeof window.License !== 'undefined' ? window.License.getDeviceId() : '';
                  if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(id).then(function () {
                      if (typeof showToast === 'function') showToast('端末IDをコピーしました');
                    });
                  } else if (typeof showToast === 'function') {
                    showToast(id);
                  }
                } catch (_) {
                  /* ignore */
                }
              };
            const tg = document.getElementById('licGateToggle');
            if (tg)
              tg.onchange = function () {
                try {
                  if (tg.checked) localStorage.setItem('DK_LICENSE_GATE_ON', '1');
                  else localStorage.removeItem('DK_LICENSE_GATE_ON');
                  if (typeof showToast === 'function')
                    showToast('ライセンスゲート: ' + (tg.checked ? 'ON(有効)' : 'OFF'));
                } catch (_) {
                  /* ignore */
                }
              };
            const rf = document.getElementById('licRefreshBtn');
            if (rf)
              rf.onclick = function () {
                try {
                  if (typeof showToast === 'function') showToast('オンライン確認中…');
                  if (typeof window.License !== 'undefined' && window.License.refresh) {
                    window.License.refresh().then(function () {
                      window._updateLicenseUI();
                      if (typeof showToast === 'function') showToast('再認証 完了');
                    });
                  }
                } catch (_) {
                  /* ignore */
                }
              };
            // 起動時 online 認証 → UI 反映
            if (
              typeof window.License !== 'undefined' &&
              typeof window.License.init === 'function'
            ) {
              try {
                window.License.init().then(function () {
                  window._updateLicenseUI();
                });
              } catch (_) {
                window._updateLicenseUI();
              }
            }
            // ★会社URL/Ed25519署名方式(STEP3) 起動処理★
            _initLicenseActivate();
          }
          // 活性化結果の表示(客/ドライバー向け・平易)
          function _showActivateResult(r) {
            if (!r || typeof showToast !== 'function') return;
            if (r.ok) showToast('✅ この端末を有効化しました');
            else if (r.reason === 'seat_limit')
              showToast(
                '⚠ 契約台数(' + (r.seat_limit || '') + '台)に達しています。事務所にご確認ください'
              );
            else if (r.reason === 'invalid_url') showToast('⚠ 有効化リンクが正しくありません');
            else if (r.reason === 'offline') showToast('⚠ ネットに繋がる所で開いてください');
            else showToast('⚠ 有効化できませんでした');
          }
          function _initLicenseActivate() {
            if (typeof window.LicenseActivate === 'undefined') return;
            let _c = null;
            try {
              _c = new URLSearchParams(location.search).get('c');
            } catch (_) {
              _c = null;
            }
            function _after() {
              try {
                if (typeof window._updateLicenseBanner === 'function')
                  window._updateLicenseBanner();
              } catch (_) {
                /* ignore */
              }
              // ★実績のクラウド送信を起動 (2026-07-31・事務所機能の土台)★
              //   ライセンス処理の後に呼ぶ = 会社url_tokenが揃ってから送る。
              //   裏で走るだけ・失敗しても何も起きない(次回再送)。業務は絶対に止めない。
              try {
                if (window.JobSync && typeof window.JobSync.init === 'function') {
                  window.JobSync.init();
                }
              } catch (_) {
                /* ignore */
              }
              // ★★較正の 控えを 戻す★★ 2026-09-19（司さん「今のが壊れんようにきっちりやれや」）
              //   ★手元に 1台でも 車が 在れば 何も しません★（VehBackup が 中で 見ている）
              //   ＝今 動いている 端末は ★1バイトも 変わらない★。
              //   効くのは ★データを 消した／機種変した 直後の 空の 端末★ だけ。
              //   車ごとの URL（&d=席）で 同じ席に 戻るので ★その車の 較正が 戻る★。
              //   失敗しても 何も しない（圏外・控え無し）＝業務は 止めない。
              try {
                if (
                  window.VehBackup &&
                  window.LicenseActivate &&
                  typeof window.LicenseActivate.companyId === 'function'
                ) {
                  var _co = window.LicenseActivate.companyId();
                  if (_co) window.VehBackup.modosu(_co, window.LicenseActivate.deviceId());
                }
              } catch (_) {
                /* ignore */
              }
              // ★請求先マスタ(請求書で選ぶ会社一覧)を取ってくる (2026-08-01)★
              //   代行請求書アプリの companies が唯一の正。裏で取るだけ・失敗しても何も起きない。
              try {
                if (window.CustomerMaster && typeof window.CustomerMaster.init === 'function') {
                  window.CustomerMaster.init();
                }
              } catch (_) {
                /* ignore */
              }
            }
            if (_c) {
              // ★★車ごとの URL（&d=席の番号）を 引き継ぐ★★ 2026-09-19（司さん）
              //   ★c（会社）が 在る 時だけ★ 受ける＝d だけ 流れてきても 乗っ取られない。
              //   引き継ぐと 倉庫からは ★同じ 端末が 戻ってきただけ★ に 見える
              //   ⇒ ★席は 増えない／事務所で 外す 手間が 要らない★。
              //   ★activate より 前★ に 呼ぶ（activate が 自分の 番号を 読む 前に 差し替える）。
              try {
                const _d = new URLSearchParams(location.search).get('d');
                if (_d && typeof window.LicenseActivate.adoptDeviceId === 'function') {
                  window.LicenseActivate.adoptDeviceId(_d);
                }
              } catch (_) {
                /* ignore */
              }
              try {
                window.LicenseActivate.activate(_c).then(function (r) {
                  _showActivateResult(r);
                  _after();
                  try {
                    const u = new URL(location.href);
                    u.searchParams.delete('c'); // ?c= を履歴/共有に残さない
                    u.searchParams.delete('d'); // ★席の番号も 残さない★（人に 見せない）
                    history.replaceState(null, '', u.pathname + u.search + u.hash);
                  } catch (_) {
                    /* ignore */
                  }
                });
              } catch (_) {
                /* ignore */
              }
            } else {
              try {
                window.LicenseActivate.init().then(_after);
              } catch (_) {
                _after();
              }
            }
          }
          // 業務開始画面の期限警告バナー(残り≤7日/期限切れ時のみ・非ブロック)
          window._updateLicenseBanner = function () {
            try {
              const el = document.getElementById('licenseBanner');
              if (!el || typeof window.LicenseActivate === 'undefined') return;
              const gateOn = localStorage.getItem('DK_LICENSE_GATE_ON') === '1';
              // ゲートOFF かつ 会社未登録端末は無関係 → 非表示(自社運用で邪魔しない)
              if (!gateOn && !window.LicenseActivate.hasCompany()) {
                el.style.display = 'none';
                return;
              }
              const s = window.LicenseActivate.getState();
              if (s.state === 'warning' || s.state === 'expired') {
                const msgEl = document.getElementById('licenseBannerMsg');
                if (msgEl)
                  msgEl.textContent = s.message || 'Wi-Fiのある所でダイコメを開いてください';
                el.style.display = 'block';
              } else {
                el.style.display = 'none';
              }
            } catch (_) {
              /* 表示のみ */
            }
          };
          function _wireLicenseBannerBtn() {
            const btn = document.getElementById('licenseBannerSync');
            if (!btn || typeof window.LicenseActivate === 'undefined') return;
            btn.onclick = function () {
              if (typeof showToast === 'function') showToast('更新中…');
              try {
                window.LicenseActivate.sync().then(function (r) {
                  if (r && r.ok) {
                    if (typeof showToast === 'function') showToast('✅ 更新しました');
                  } else if (r && r.reason === 'offline') {
                    if (typeof showToast === 'function')
                      showToast('⚠ Wi-Fiのある所で押してください');
                  } else {
                    if (typeof showToast === 'function') showToast('⚠ 更新できませんでした');
                  }
                  window._updateLicenseBanner();
                });
              } catch (_) {
                /* ignore */
              }
            };
          }
          const _origInitLA = _initLicenseActivate;
          _initLicenseActivate = function () {
            _origInitLA();
            _wireLicenseBannerBtn();
          };
          if (document.readyState === 'loading')
            document.addEventListener('DOMContentLoaded', _wireLicenseUI);
          else _wireLicenseUI();
        })();

        // ★端末管理(管理者)の 配線は ここから 外しました★ 2026-08-31
        //   同じ物が 事務所に 有り、端末は QR/会社URL で 入るので ログインが 要りません。
        //   （詳しい理由は 下の 設定画面の 所に 書いてあります）

        // ★設計変更宣言 (2026-05-15・Phase E・ESC ハンドラ追加):
        //   ESC キー押下で現在 .spa-overlay.show 状態のオーバーレイを閉じる。
        //   従来は appbar-back ボタン (overlay 内左上 ＜) か bottom-nav 業務タブのみで close 可能だった。
        //   PC キーボードでの UX 向上。モバイルでは ESC 入力経路がない (代替手段あり) のため影響なし。
        //   業務継続性: hideAllOverlays は overlay class 操作のみ・GPS / Meter / Worker B には無影響。
        //   業務中 (driving) の ESC でも業務に影響なし (overlay 自体は業務継続中も普通に閉じる)。
        document.addEventListener('keydown', function (e) {
          if (e.key !== 'Escape') return;
          const shown = document.querySelector('.spa-overlay.show');
          if (shown) {
            window.hideAllOverlays();
            e.preventDefault();
          }
        });
      })();

