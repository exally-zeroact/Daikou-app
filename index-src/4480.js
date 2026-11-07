          // ★★業務開始の 時に 繋ぎに 行く★★ 2026-09-08（司さん「めんどくさいことやらすな」）
          //   ★押す 回数は 増やさない★＝もともと 押す ボタンに ぶら下げるだけ
          window._obdGyoumuKaishiDeTsunagu = function () {
            if (!O || typeof O.isSupported !== 'function' || !O.isSupported()) return;
            if (O.isConnected && O.isConnected()) return; // もう 繋がっている
            if (O.getStatus && O.getStatus() === 'connecting') return; // 繋ぎに 行っている
            // ★前に OBD を 使った 端末だけ★（使っていない 人に 一覧を 出さない）
            if (!_obdWasConnected) return;
            // ★人が 押した この 瞬間に 呼ぶ★（後ろで 待つと 選べなく なる）
            try {
              O.connect().catch(function () {
                /* 選ぶのを やめても 業務は 始まる */
              });
            } catch (_) {
              /* 業務は 止めない */
            }
          };
          // ★起動時 自動接続 (2026-06-18・司さん要望「1回繋いだら自動で繋がる」)★:
          //   前回ペアリング済みデバイスへ navigator.bluetooth.getDevices() で選択ダイアログ無しに自動接続。
          //   切れても自動再接続(obd-client内 _scheduleReconnect)。Android Chromeのみ・失敗は静かにidle(手動connect可)。
          if (O.isSupported() && typeof O.tryAutoConnect === 'function') {
            O.tryAutoConnect()
              .then(function (ok) {
                // ★★黙って 諦めない★★ 2026-09-08
                //   前は 失敗を 握りつぶしていた ので
                //   ★繋がっていない 事に 気づけなかった★
                // ★★起動した だけで 帯を 出すのを やめました★★ 2026-09-09
                //   ★司さん★「この警告だして 設定とか ホームの位置変えるなや」
                //   ★前★ 開いた だけで 赤帯「OBDは 業務開始の 時に つなぎます」
                //   ★今★ ★何も 出さない★（業務開始で 繋ぐ のは そのまま）
                void ok;
              })
              .catch(function () {
                /* 自動接続不可は 業務開始の 時に 繋ぐ */
              });
          }
          // 速度表示 + 距離源インジケータを 500ms 毎に更新 (鮮度切れは GPS 扱い)
          setInterval(function () {
            var sp = O.getSpeed();
            if (speedEl) speedEl.textContent = sp.valid ? sp.kmh + ' km/h' : '— km/h';
            // 実際に距離を駆動しているのは「flag ON かつ OBD鮮度OK」の時だけ(=gps.jsの判定と一致)
            var obdDriving = window.OBD_DRIVE_DISTANCE === true && sp.valid;
            if (sourceEl) {
              sourceEl.textContent = obdDriving ? '🟢 OBD (車輪速度)' : '📡 GPS';
              sourceEl.style.color = obdDriving ? '#34c759' : '#007aff';
            }
            // ★青バーチップ: 接続状態は #obdDot の色だけで示す (緑=接続済 / 半透明白=未接続)★
            //   ラベルは常に「OBD」固定 (速度はメーター本体に表示・ここでは重複させない)。
            var obdDot = document.getElementById('obdDot');
            if (obdDot) obdDot.className = _obdConnected ? 'gps-dot ok' : 'gps-dot';
            // ★司さん2026-06-27: 接続中はチップ自体を緑ベタ塗り(connectedクラス)で示す。
            //   緑で一目で分かるのでレ点(✓)は不要・ラベルは常に「OBD」。
            var obdChipEl = document.getElementById('obdChip');
            if (obdChipEl) obdChipEl.classList.toggle('connected', !!_obdConnected);
            // ★OBD切断 再接続バー(全画面・司さん2026-06-30「全部の画面に途切れたら出して」)★
            //   一度繋いだ後(_obdWasConnected)に切断したら、猶予4s(自動再接続の余地)後に
            //   全画面の赤バー+赤チップ「OBD 再接続」で再接続を促す。手動切断/未接続/非対応では出さない。
            if (_obdConnected && !_obdWasConnected) {
              _obdWasConnected = true;
              _obdTsunaidaHozon(true); // ★読み直しても 覚えている★
            }
            // ★★この 業務で 一度でも 繋がったら 立てる★★ 2026-09-10
            if (_obdConnected) _konoGyoumuHozon(true);
            var _obdSupported = typeof O.isSupported === 'function' && O.isSupported();
            // ★★帯は 業務が 始まってから★★ 2026-09-09（実測）
            //   ★司さん★「この警告だして 設定とか ホームの位置 変えるなや」
            //   ★前★ 条件は「いつか 一度でも 使った」だけだった
            //     ⇒ ★開いた だけで 4秒後に 「OBDが切れました」★（何も 切れて いない）
            //   ★今★ ★業務中★の 時だけ 出す。
            //   ★訳★ 2026-06-30 の 指示は「★途切れたら★ 出して」。
            //     まだ 繋いで いないのは 途切れて いない。
            //     守るのは ★走っている 途中に 切れて 距離が 黙って 減る★ 事。
            //     始まる 前は 距離を 測って いないので 守る 物が 無い。
            var _gyoumuChuDaKa = false;
            try {
              var _bs =
                typeof Business !== 'undefined' && typeof Business.getState === 'function'
                  ? Business.getState()
                  : null;
              // ★★start_time だけでは 足りない★★ 2026-09-10（実測）
              //   ★業務終了しても start_time は ★残ります★
              //     （Business.end() は active=false / ended=true に するだけ。
              //      「業務再開」ボタンを 出す 為 わざと 残している。index.html:9120）
              //   ★実測★ 終わった 状態（active:false, ended:true）で
              //     ★帯が 出た★ ⇒ 仕事が 終わった 後に
              //     「OBDが切れました」と 言い続ける。
              //   ⇒ ★active も 見る★（今 本当に 走っているか）
              _gyoumuChuDaKa = !!(_bs && _bs.start_time && _bs.active && !_bs.ended);
            } catch (_) {
              /* 分からない 時は 出さない */
            }
            // ★★この 業務で 繋いだ のに 今 切れている★★ の時だけ 出す
            //   2026-09-10（指示役の 監査①・実測で 再現）
            //   ★前★ _obdWasConnected＝「いつか 一度でも 使った」だけ
            //     ⇒ ★今日 挿さない だけで 「切れました」★
            //   ★今★ ★この 業務で 繋いだ★ 事を 要る
            var _obdDropped =
              _obdSupported &&
              !_obdConnected &&
              _obdWasConnected &&
              _gyoumuChuDaKa &&
              _konoGyoumuDeTsunaidaKa();
            if (_obdDropped) {
              if (_obdDropSince == null) _obdDropSince = Date.now();
            } else {
              _obdDropSince = null;
            }
            var _showRecon =
              _obdDropped && _obdDropSince != null && Date.now() - _obdDropSince > 4000;
            // ★★繋いでいる 途中は 帯に 進み具合を 出す★★ 2026-09-08
            var _tsunagichu = _obdSupported && O.getStatus && O.getStatus() === 'connecting';
            var reconBar = document.getElementById('obdReconnectBar');
            if (reconBar) {
              reconBar.style.display = _showRecon || _tsunagichu ? 'flex' : 'none';
              if (_tsunagichu || window._obdSusumiJi) {
                var _ji = window._obdSusumiJi || 'つないでいます';
                var _ato = window._obdSusumiMade
                  ? Math.max(0, Math.round((window._obdSusumiMade - Date.now()) / 1000))
                  : 0;
                reconBar.textContent = _tsunagichu
                  ? '⏳ OBD ' + _ji + (_ato > 0 ? '（あと 約' + _ato + '秒）' : '')
                  : _ji;
              } else {
                reconBar.textContent = '⚠ OBDが切れました — タップで再接続';
              }
              // ★★青バーの すぐ下に ★必ず★ 浮かせる★★ 2026-09-09
              //   ★司さん★「設定とか ホームの 位置 変えるなや」
              //   ★前★ 切れた 時だけ top を 入れていたので、
              //     進み具合を 出す 時は top:auto ＝★置き場所が 成り行き任せ★だった。
              //   ★今★ ★いつでも 同じ 所★（青バーの 真下に 重ねる）
              var _ab = document.getElementById('appbar');
              var _shita = _ab ? Math.round(_ab.getBoundingClientRect().bottom) : 0;
              reconBar.style.top = (_shita > 0 ? _shita : 0) + 'px';
            }
            // ★帯を すぐ 書き直せる ように 外へ 出す★ 2026-09-08
            window._obdBarKakinaosu = window._obdBarKakinaosu || function () {};
            if (obdChipEl) obdChipEl.classList.toggle('reconnect', _showRecon || _tsunagichu);
            var obdChipLabelEl = document.getElementById('obdChipLabel');
            if (obdChipLabelEl) obdChipLabelEl.textContent = _showRecon ? 'OBD 再接続' : 'OBD';
            // ★業務開始画面のOBD接続ボタン: 接続済=緑/未接続=青枠で状態を反映(司さん2026-06-27)
            var bizObd = document.getElementById('bizObdConnect');
            if (bizObd) {
              if (_obdConnected) {
                bizObd.textContent = '✅ OBD接続済';
                bizObd.style.background = '#34c759';
                bizObd.style.borderColor = '#34c759';
                bizObd.style.color = '#fff';
              } else {
                bizObd.textContent = '🔌 OBDを接続';
                bizObd.style.background = '#fff';
                bizObd.style.borderColor = '#007aff';
                bizObd.style.color = '#007aff';
              }
            }

            // ── ★OBD切断警告 判定 (3ティアの ティアC と同じ境界)★ ──
            var drivingScreen = (function () {
              var s = document.getElementById('screenDriving');
              return !!(s && s.style.display !== 'none');
            })();
            if (!drivingScreen) {
              // 業務(走行画面)外 = 警告も「直近健全」記録もリセット (トリップ跨ぎで持ち越さない)。
              _obdLastGoodT = null;
              _obdWarnOn = false;
              _obdClearSince = null;
            } else {
              if (obdDriving) _obdLastGoodT = Date.now(); // OBDで正常駆動中=直近健全時刻を更新
              var linkUp =
                typeof O.isConnected === 'function' ? O.isConnected() === true : sp.valid;
              // OBDが「メインで走っていた(=_obdLastGoodT有り)」のに今駆動できていない:
              //   本当の切断(リンク断)は1.5s猶予(GATTイベント遅延吸収)、応答途絶(リンク生存)は6s猶予。
              var lostMs = _obdLastGoodT != null ? Date.now() - _obdLastGoodT : -1;
              var obdLost =
                _obdLastGoodT != null &&
                ((!linkUp && lostMs > 1500) || (linkUp && sp.ageMs > OBD_HOLD_MS_UI));
              if (obdLost) {
                if (!_obdWarnOn) {
                  _obdWarnOn = true; // 立ち上がりで1回だけバイブ(オフライン動作・復帰では鳴らさない)
                  try {
                    if (navigator.vibrate) navigator.vibrate(200);
                  } catch (_) {}
                }
                _obdClearSince = null;
              } else if (_obdWarnOn) {
                // 健全に戻った → 2s 連続安定でのみ解除(再接続チカチカ防止)。
                if (sp.valid && linkUp) {
                  if (_obdClearSince == null) _obdClearSince = Date.now();
                  if (Date.now() - _obdClearSince >= 2000) {
                    _obdWarnOn = false;
                    _obdClearSince = null;
                  }
                } else {
                  _obdClearSince = null; // まだ不安定 → 解除タイマーリセット
                }
              }
            }

            // ★走行中バッジ: 計測源を一目で。警告中は赤で最優先表示★
            if (driveBadge) {
              if (_obdWarnOn) {
                driveBadge.textContent = '⚠️ OBD切断→GPS(再接続中…)';
                driveBadge.style.color = '#e11d48';
              } else {
                driveBadge.textContent = obdDriving ? '🟢 OBD(車輪速度)' : '📡 GPS';
                driveBadge.style.color = obdDriving ? '#34c759' : '#007aff';
              }
            }
            // ★初回オンボーディング誘導: OBD接続/未接続を500ms毎に反映(idleで未完了時のみ表示)★
            if (typeof window._updateSetupGuide === 'function') window._updateSetupGuide();
          }, 500);
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', bindObdUI);
        } else {
          bindObdUI();
        }
      })();
