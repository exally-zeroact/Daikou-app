          // ★★読み直しても 覚えている★★ 2026-09-06（司さん「距離が少なめに出た」）
          //   ★前★ ただの変数＝★画面を 読み直すと 0 に 戻る★
          //     ⇒ 新しい版が 来て 読み直した 後、OBD は 切れているのに
          //       ★「この画面で 一度も 繋いでいない」扱いで 赤バーが 出ない★
          //     ⇒★運転手は 切れた事に 気づけない／距離だけ 少なくなる★
          //   ★今★ 端末に 覚える。★手で 切っても 消さない★ 2026-11-08（OBD の 繋ぎの 作り直し・司さんの 直）＝次の 業務開始で 自動で 繋ぎに 行く。手で 切った後に 帯を 出さないのは この 業務の 印（_konoGyoumuHozon）の 方で 守る
          //   ★距離にも 料金にも 触りません★（警告を 出すか 出さないか だけ）
          var _OBD_TSUNAIDA_KEY = 'dk_obd_tsunaida';
          function _obdTsunaidaHozon(v) {
            try {
              if (v) localStorage.setItem(_OBD_TSUNAIDA_KEY, '1');
              else localStorage.removeItem(_OBD_TSUNAIDA_KEY);
            } catch (_) {
              /* 覚えられなくても 業務は 止めない */
            }
          }
          var _obdWasConnected = (function () {
            try {
              return localStorage.getItem(_OBD_TSUNAIDA_KEY) === '1';
            } catch (_) {
              return false;
            }
          })(); // 一度でも接続したか(手動切断/未接続では再接続バーを出さない用)
          var _obdDropSince = null; // _obdWasConnected中に切断へ入った時刻(猶予4s判定・null=切断でない)
          // ★★この 業務で 繋いだか★★ 2026-09-10（指示役の 監査①）
          //   ★実測で 見つかった 誤報★
          //     昨日 OBD を 使った 端末が 今日 ★OBD を 挿さず★ 業務開始 すると
          //     4秒後に「OBDが切れました」が 出ていた。
          //     ★何も 切れて いない★（今日 一度も 繋いでいない だけ）
          //   ★病気の 元★ _obdWasConnected は
          //     ★「いつか 一度でも 使った」★（localStorage）で
          //     ★「今回の 業務で」では ない★。
          //   ⇒ ★別の 印★を 持つ。
          //   ★別の 印に した 訳＝★意味を 分ける 為★
          //     ★いつか 一度でも 使った★（dk_obd_tsunaida）
          //     ★この 業務で 繋いだ★（dk_obd_kono_gyoumu）
          //   ★実測（2026-09-10）★ dk_obd_tsunaida は
          //     ①帯の 判定と ②★業務開始で 繋ぎに 行くかの 門★（_obdGyoumuKaishiDeTsunagu の
          //     `if (!_obdWasConnected) return;`）の ★2か所★で 使う。
          //     ★起動時の tryAutoConnect は この 印を 見ていません★
          //     （getDevices と dk_obd_device_id を 見ている）。
          var _KONO_GYOUMU_KEY = 'dk_obd_kono_gyoumu';
          // ★★読み直しても 消えない 所に 持つ★★ 2026-09-10（指示役の 追い監査）
          //   ★前★ ただの var＝★メモリの 上★
          //     ⇒ リロード／タスクキルで false に 戻る
          //     ⇒ その後 本当に 切れても ★帯が 出ない★
          //     ⇒ ★守ると 決めた 当の 物が 読み直し 1回で 死ぬ★
          //   ★今★ localStorage に 持つ（start_time と 同じ 寿命）
          function _konoGyoumuHozon(v) {
            try {
              if (v) localStorage.setItem(_KONO_GYOUMU_KEY, '1');
              else localStorage.removeItem(_KONO_GYOUMU_KEY);
            } catch (_) {
              /* 覚えられなくても 業務は 止めない */
            }
          }
          function _konoGyoumuDeTsunaidaKa() {
            try {
              return localStorage.getItem(_KONO_GYOUMU_KEY) === '1';
            } catch (_) {
              return false;
            }
          }
          window._obdGyoumuKaishiDeShirushiKesu = function () {
            _konoGyoumuHozon(false);
          };
          var _obdClearSince = null; // 警告解除ヒステリシスの安定開始時刻
          var JA = {
            idle: '未接続',
            connecting: '接続中…',
            connected: '接続済み',
            disconnected: '切断されました',
            error: 'エラー',
          };
          if (!O.isSupported()) {
            if (noteEl)
              noteEl.textContent =
                'この端末は Web Bluetooth 非対応 (Android Chrome で開いてください)';
            if (btnC) {
              btnC.disabled = true;
              btnC.style.opacity = '0.5';
            }
            // 青バーチップも非対応表示 (iPhone 等)
            if (chipLabel) chipLabel.textContent = 'OBD';
            if (obdChip) {
              obdChip.classList.add('is-disabled');
              obdChip.title = 'OBDはAndroid Chromeのみ対応';
            }
          }
          // ★★2026-11-08★★ 設定の「接続済み」も 車と 話せてから（本番前 叩き直しの 止め1）。
          //   機械に 繋いで 車と 話す 間（hanasu）・車が 黙る 間（kuruma_machi）は チップと 同じ「OBD 待ち」。
          //   ★connected の 知らせの 時の 段は まだ okosu（繋ぎ直しは tsunagi_naoshi）＝段が hanasu に なるのは 後★
          //   ⇒ connected の 間は 段が tsunagatta に なるまで「OBD 待ち」（繋いだ 瞬間に「接続済み」を 出さない）。
          //   tsunagatta に なっても status の 知らせは 来ないので 500ms 毎の 書き直しで「接続済み」に する
          var _obdStatusJi = function (s) {
            if (s === 'connected' && O.getDan && O.getDan() !== 'tsunagatta') return 'OBD 待ち';
            return JA[s] || s;
          };
          O.on('status', function (s) {
            if (statusEl) statusEl.textContent = _obdStatusJi(s);
            _obdConnected = s === 'connected';
            // ★★OBD メイン距離源 (2026-06-10・司さん裁定)★★:
            //   OBD = 車輪回転距離 = タクシー認定の基準ローラーが測る量。接続中は OBD を ★メイン距離源★
            //   にする (∫v(OBD)×k)。トンネルも車輪速度で連続・滑らか (GPS 不要)。未接続/鮮度切れ/iPhone は
            //   GPS(smoothedRawMode)へ自然フォールバック。
            //   ★k 補正 (車別)★: OBD 生∫v(k=1) は実車で系統過小。今日(0610b)の真距離(国交省RTKキロ
            //   ポスト)採点で OBD∫v=業務1 -2.07% / 業務2 -2.50% と確定 → この随伴車の校正 k≈1.02
            //   (自動推定 1.0212 / 1.0257・真距離校正値。★暫定 1.04 は過大方向に外していたので撤回★)。
            //   ★k=1.02 の適用は OBD が距離源の区間に限定する (= 条件付き)★: OBD∫v は系統過小ゆえ
            //   ×1.02 で真値以下に収まる (業務1 -0.12% / 業務2 -0.55%・truedist-kp-gate.js 実証)。一方
            //   GPS フォールバック区間 (鮮度切れ/トンネル出口/iPhone) は既に ≒0% (生GPS +0.07%/-0.48%) で、
            //   ここに ×1.02 を掛けると過大化し ★never-over 違反★ になる。よって meter の単一 _activeVehicleK
            //   (全 rawDelta に一律乗算) に 1.02 を ★直接ハードコードしない★。OBD 源別 k は距離コア (map-matcher
            //   /pipeline-distance) が OBD 駆動区間フラグを mmResult に surface した後に条件付き適用する設計
            //   (距離コア=GPS班 担当・本班は非衝突で触らない)。それまで本番 k は安全側 1.0 を維持し、
            //   1.02 は ★truedist-kp-gate.js の校正基準値★ と本コメントの根拠として確定保持する。
            //   meter の VK_MAX=1.01 ハードクランプは GPS/OBD 双方の ★過大ゼロ天井★ として不変。
            //   raw ∫v(k=1) も並行記録される (pipeline bd.obdRawM・精度突合用)。
            window.OBD_DRIVE_DISTANCE = _obdConnected === true;
            // ★2026-07-03 対立監査P1-a是正: OBD接続時に保存K(restoreKs)をworkerへ再注入する★。
            //   接続直後の「較正済なのに worker がまだ復元前=active=false」transient を潰し、
            //   Fix Bの誤ブロック(較正済ドライバーの代行開始を一瞬止める)を根治。configVehicleで即confident化。
            if (
              _obdConnected &&
              window.DK_AUTO_CALIB_K &&
              typeof Meter !== 'undefined' &&
              Meter._postVehicleK
            ) {
              try {
                Meter._postVehicleK();
              } catch (_) {
                /* 次業務開始で回復 */
              }
            }
          });
          O.on('error', function (msg) {
            if (noteEl) noteEl.textContent = 'エラー: ' + msg;
            // ★★帯に 出すのは ★日本語の 訳★だけ★★ 2026-09-09
            //   ★司さん★「なんで 英語に かわったんど」
            //   ★実物で 出ていた 字★
            //     "User cancelled the requestDevice() chooser."
            //     ＝ブラウザが 返す 生の 英語。
            //   ★やめたのは 間違いでは ない★ので ★何も 出さない★。
            //   日本語で 書いた 訳だけ 帯に 出す。
            var _m = String(msg || '');
            var _nihongo = /[\u3040-\u30ff\u4e00-\u9faf]/.test(_m);
            window._obdSusumiJi = _nihongo ? _m : '';
            window._obdSusumiMade = 0;
            if (typeof window._obdBarKakinaosu === 'function') window._obdBarKakinaosu();
          });
          // ★★今 何を していて あと 何秒か★★ 2026-09-08（司さん「直せや」）
          //   ★測った 訳★ 繋ぐのに 最悪 ★約80秒★ かかるのに 画面が 無言だった
          //     ⇒ 途中で 押し直す ⇒ 最初から やり直し ⇒ ★余計に 繋がらない★
          O.on('susumi', function (x) {
            if (!x) return;
            window._obdSusumiJi = String(x.ji || '');
            window._obdSusumiMade = x.nokori_ms > 0 ? Date.now() + x.nokori_ms : 0;
            if (typeof window._obdBarKakinaosu === 'function') window._obdBarKakinaosu();
          });
          // ★OBD距離能力プローブ結果 (2026-06-09・随伴車Tier判定)★:
          //   接続時に1回、この車が高分解能オドメーター(01A6)を出すか等を判定し現地表示。
          //   生応答は console.log('[OBD-PROBE]...') で debug-log-uploader が Firebase へ上げる。
          O.on('probe', function (res) {
            try {
              var d = (res && res.decoded) || {};
              var msg;
              if (d.odometer_supported === true) {
                msg =
                  '🎯 この車: 標準オドメーター対応! ' +
                  (d.odometer_km != null ? d.odometer_km.toFixed(1) + 'km ' : '') +
                  '→ OBDで距離直結可(メーター級)';
              } else if (d.odometer_supported === false) {
                msg = '📡 標準オドメーター(01A6)は非対応';
                if (d.dist_since_clear_km != null)
                  msg += ' / 0131距離=' + d.dist_since_clear_km + 'km(1km粗い)';
                msg += ' → 距離はGPS';
              } else {
                msg = 'OBD距離能力プローブ完了 (結果はログに記録)';
              }
              if (noteEl) noteEl.textContent = msg + ' ※詳細はログ送信で解析';
              // ── 随伴車カードに反映 (VIN/メーカー/距離能力 + 保存プロファイル読込) ──
              var q = (res && res.queries) || {};
              var vin = q.vin_0902 ? _parseVin(q.vin_0902.raw) : '';
              _curVin = vin;
              if (vehVinEl) vehVinEl.textContent = vin || '(VIN取得できず)';
              // ★⑤ 保存済み輪速マッピングを復元 → applyして再discovery不要(オフライン)★(距離未配線)
              //   S1/S3: ★VINがある車だけ★(active共有フォールバック廃止)・保存vinと現VIN一致時のみapply(別車誤適用封じ)。
              try {
                if (vin && window.OBDClient && window.OBDClient.applyWheelSpeedMapping) {
                  var savedWs = localStorage.getItem('dk_wsmap_' + vin);
                  if (savedWs) {
                    var wsM = JSON.parse(savedWs);
                    if (
                      wsM &&
                      (!wsM.vin || wsM.vin === vin) &&
                      window.OBDClient.applyWheelSpeedMapping(wsM)
                    ) {
                      var wsStatusEl = document.getElementById('wheelSpeedStatus');
                      if (wsStatusEl)
                        wsStatusEl.textContent =
                          '✓登録済 ' +
                          (wsM.seedMatch && wsM.seedMatch.length
                            ? wsM.seedMatch.join('/')
                            : '未収録車') +
                          '(' +
                          wsM.id +
                          ')';
                    }
                  }
                }
              } catch (_) {
                /* ignore */
              }
              if (vin) {
                var info = _vinInfo(vin);
                if (vehMakerEl)
                  vehMakerEl.textContent =
                    (info.maker || '?') + (info.year ? ' / ' + info.year : '');
                // ★VINゲート (監査①是正・本番阻止級)★: base起点は ★接続中VINに対応するprofile★。
                //   同一VIN=既存(手動登録/k)を継続。★別VIN=その車のVINキーprofileを復元(無ければ新規=k無し)★。
                //   こうしないと前車の器差k/k_samplesを新車に継承し、別車の器差Kで距離を焼く=過大ゼロ前提崩壊。
                var prev = window.DK_VEHICLE_PROFILE || {};
                var base;
                if (prev.vin && prev.vin === vin) {
                  base = prev; // 同一随伴車=登録/較正kを継続
                } else {
                  // 別車 or 初回: その車のVINキーprofileを復元(=その車のk)。無ければ新規(k無し=未較正=自動)。
                  base = {};
                  try {
                    var savedVeh = localStorage.getItem('dk_veh_' + vin);
                    if (savedVeh) base = JSON.parse(savedVeh) || {};
                  } catch (_) {
                    base = {};
                  }
                }
                base.vin = vin;
                base.maker = info.maker || base.maker;
                base.year = info.year || base.year;
                base.obdOdoSupported = d.odometer_supported === true;
                base.obdOdoKm = d.odometer_km != null ? d.odometer_km : null;
                window.DK_VEHICLE_PROFILE = base;
                _applyTireProfileToUI(base); // ★VIN別の工場タイヤ/比に切替(各車のロック独立)★
                // VINが取れたら VINキーにも保存(将来の自動復元用)。active も最新化。
                try {
                  localStorage.setItem('dk_veh_active', JSON.stringify(base));
                  if (vin) localStorage.setItem('dk_veh_' + vin, JSON.stringify(base));
                } catch (_) {
                  /* ignore */
                }
              }
              if (vehObdCapEl) {
                if (d.odometer_supported === true)
                  vehObdCapEl.textContent = '🎯 Tier1 オドメーター直結可';
                else if (d.dist_since_clear_km != null)
                  vehObdCapEl.textContent = '📡 Tier3 (0131 1km/速度のみ)→GPS';
                else vehObdCapEl.textContent = '📡 Tier3 (010D速度のみ)→GPS';
              }
            } catch (_) {
              /* 表示失敗は無視 (ログには残っている) */
            }
          });
          function doConnect() {
            if (noteEl) noteEl.textContent = '';
            O.connect().catch(function () {
              /* status/error は on() 経由で表示済 */
            });
          }
