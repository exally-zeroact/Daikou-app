                // ★★較正の 控えを 雲に 預ける★★ 2026-09-19（司さん）
                //   ★裏で 送るだけ★＝失敗しても 何も 起きない（圏外でも 保存は 済んでいる）。
                //   ★中身は 作り変えない★（tireRatio と k は 距離に 掛かる）。
                try {
                  if (
                    window.VehBackup &&
                    window.LicenseActivate &&
                    typeof window.LicenseActivate.companyId === 'function'
                  ) {
                    var _co2 = window.LicenseActivate.companyId();
                    if (_co2) window.VehBackup.azukeru(_co2, window.LicenseActivate.deviceId());
                  }
                } catch (_) {
                  /* ignore */
                }
                if (typeof window._syncWorkerVehicle === 'function') window._syncWorkerVehicle(); // ★保存後 worker._vehicleId 同期(ON時のみ)★
                _applyTireProfileToUI(prof); // 工場サイズロック + 比表示更新(worker反映は次の業務開始で)
                try {
                  if (typeof dlog === 'function') dlog('[OBD-VEHICLE] ' + JSON.stringify(prof));
                } catch (_) {
                  /* ignore */
                }
                if (vehSaveNoteEl)
                  vehSaveNoteEl.textContent =
                    '✓ 保存しました(随伴車登録・恒久・trace焼込' +
                    (_curVin ? '・VIN併記' : '・VINは後で自動付与') +
                    ')';
              } catch (e) {
                if (vehSaveNoteEl)
                  vehSaveNoteEl.textContent = '保存失敗: ' + ((e && e.message) || e);
              }
            });
          }
          // ★随伴車を削除(司さん要望2026-06-23・「消してもタスクキルで復活」根治)★
          //   真因: 起動時 _loadActiveVehicle() が localStorage の dk_veh_active を復元するため、
          //   フィールドを空にしただけでは localStorage に残り、タスクキルで前の車(アルト等)が復活した。
          //   この削除は localStorage(dk_veh_active + dk_veh_<VIN>)を実消去し恒久的に消す。
          var btnVehDelete = document.getElementById('btnVehDelete');
          if (btnVehDelete) {
            btnVehDelete.addEventListener('click', function () {
              if (
                typeof window.confirm === 'function' &&
                !window.confirm('登録した随伴車(車種/型式/タイヤ)を削除します。よろしいですか？')
              )
                return;
              try {
                var _prev = JSON.parse(localStorage.getItem('dk_veh_active') || 'null');
                localStorage.removeItem('dk_veh_active');
                if (_curVin) localStorage.removeItem('dk_veh_' + _curVin);
                if (_prev && _prev.vin) localStorage.removeItem('dk_veh_' + _prev.vin);
                window.DK_VEHICLE_PROFILE = null;
                if (vehModelEl) vehModelEl.value = '';
                if (vehKatashikiEl) vehKatashikiEl.value = '';
                if (vehTireEl) {
                  vehTireEl.value = '';
                  vehTireEl.readOnly = false;
                  vehTireEl.style.background = '';
                }
                if (vehTireCurrentEl) vehTireCurrentEl.value = '';
                if (vehTireRatioDispEl) vehTireRatioDispEl.textContent = '×1.000';
                if (typeof _refreshTireRatioDisp === 'function') _refreshTireRatioDisp();
                try {
                  if (typeof dlog === 'function')
                    dlog('[OBD-VEHICLE-DELETE] ' + JSON.stringify(_prev || {}));
                } catch (_) {
                  /* ignore */
                }
                if (vehSaveNoteEl)
                  vehSaveNoteEl.textContent = '✓ 削除しました(タスクキルしても復活しません)';
              } catch (e) {
                if (vehSaveNoteEl)
                  vehSaveNoteEl.textContent = '削除失敗: ' + ((e && e.message) || e);
              }
            });
          }
          // ★真距離(196号KP/基準巻尺)で k を較正 (随伴車別器差・業務終了後・DM Lightは非推奨)★
          if (btnVehCalibrate) {
            btnVehCalibrate.addEventListener('click', function () {
              try {
                if (typeof Meter === 'undefined' || !Meter.calibrateVehicleK) {
                  if (vehCalibrateNoteEl) vehCalibrateNoteEl.textContent = 'メーター未初期化';
                  return;
                }
                var km = vehCertMeterReadEl ? parseFloat(vehCertMeterReadEl.value) : NaN;
                if (!(km > 0)) {
                  if (vehCalibrateNoteEl)
                    vehCalibrateNoteEl.textContent = '真距離(km)を入力してください';
                  return;
                }
                var r = Meter.calibrateVehicleK(km * 1000); // km→m
                if (r && r.ok) {
                  if (vehCalibrateNoteEl)
                    vehCalibrateNoteEl.textContent =
                      '✓ k=' +
                      r.k.toFixed(4) +
                      ' に較正(' +
                      (r.sampleCount || 1) +
                      '回目・過大ゼロ維持)';
                  _renderVehK();
                } else {
                  var why =
                    r && r.reason === 'business_too_short'
                      ? '業務距離が短すぎ(1km未満)'
                      : r && r.reason === 'outlier_jump'
                        ? '1業務で5%超の急変=反映せず(誤入力/異常走行)'
                        : '較正できず(' + ((r && r.reason) || '不明') + ')';
                  if (vehCalibrateNoteEl) vehCalibrateNoteEl.textContent = '✗ ' + why;
                }
              } catch (e) {
                if (vehCalibrateNoteEl)
                  vehCalibrateNoteEl.textContent = '較正失敗: ' + ((e && e.message) || e);
              }
            });
          }
          // ★ABS輪速 自動検出ステータス(read-only・ユーザー操作なし・距離未配線)★:
          //   普段の走行中に obd-client が自動でABS輪速を傍受(_wsAuto)。検出結果(probeイベント)を
          //   ここで表示するだけ。ユーザーは何もしない。実ID/分解能の確定はログ送信後のオフライン解析。
          var wheelSpeedStatusEl = document.getElementById('wheelSpeedStatus');
          if (wheelSpeedStatusEl) {
            wheelSpeedStatusEl.textContent =
              window.OBDClient && window.OBDClient.isConnected && window.OBDClient.isConnected()
                ? '自動検出中…'
                : '—(OBD接続で開始)';
            try {
              if (window.OBDClient && window.OBDClient.on) {
                window.OBDClient.on('probe', function (p) {
                  // ★②③確定: 端末内識別が確定 → VIN別にlocalStorage保存(⑤)+状態表示★(距離未配線)
                  if (p && p.wheelspeedIdentified && p.wheelspeedIdentified.confirmed) {
                    var m = p.wheelspeedIdentified;
                    // ★S1/S3: VIN が取れた車だけ保存(active共有フォールバック廃止=別車誤適用を断つ)。
                    //   マッピングに vin を焼き、復元時に照合する。VIN無し(クローンELM等)はセッション内のみ★
                    if (_curVin) {
                      try {
                        m.vin = _curVin;
                        localStorage.setItem('dk_wsmap_' + _curVin, JSON.stringify(m));
                      } catch (_) {
                        /* ignore */
                      }
                    }
                    var who =
                      m.seedMatch && m.seedMatch.length ? m.seedMatch.join('/') : '未収録車';
                    wheelSpeedStatusEl.textContent =
                      '✓確定 ' +
                      who +
                      '(' +
                      m.id +
                      ' ' +
                      Number(m.kmhPerLSB).toFixed(3) +
                      'km/h刻み R²' +
                      Number(m.r2).toFixed(3) +
                      ')';
                    return;
                  }
                  // 捕捉サマリ(途中経過の表示のみ)
                  var res = p && p.wheelspeed;
                  if (!res) return;
                  var ids = res.ids || [];
                  var seedHit = null;
                  try {
                    var M = window.OBDWheelSpeedMap;
                    if (M && M.lookupById) {
                      for (var i = 0; i < ids.length; i++) {
                        var s = M.lookupById(ids[i].id);
                        if (s) {
                          seedHit = { id: ids[i].id, makers: s.makers };
                          break;
                        }
                      }
                    }
                  } catch (_) {
                    /* ignore */
                  }
                  if (seedHit) {
                    wheelSpeedStatusEl.textContent =
                      '検出中 ' + seedHit.makers.join('/') + '(' + seedHit.id + ')…';
                  } else if ((res.frameCount || 0) > 0) {
                    wheelSpeedStatusEl.textContent = '検出中(候補ID解析中)';
                  } else {
                    wheelSpeedStatusEl.textContent = '標準(010D)・輪速なし';
                  }
                });
                // ★S2: 切断/idle/error で _curVin をリセット(別車誤bind=前車VINキーへ次車を上書き を断つ)★
                window.OBDClient.on('status', function (st) {
                  if (st === 'disconnected' || st === 'idle' || st === 'error') {
                    _curVin = '';
                    if (wheelSpeedStatusEl) wheelSpeedStatusEl.textContent = '—(OBD接続で開始)';
                    // ★監査M3/M4: 切断でCAN輪速メーターのUIライブタイマーをclear+ボタン同期★。
                    //   obd-client側は _onDisconnected で _cwStreaming を畳む。UIはここでleak解消。
                    if (typeof window._st_cwClearLive === 'function') window._st_cwClearLive();
                    if (typeof window._st_renderCanWheel === 'function')
                      window._st_renderCanWheel();
                  }
                });
                // ★監査M3: canwheel emit を購読しUIを単一真実源(getCanWheelMeter().on)へ同期★。
                window.OBDClient.on('canwheel', function () {
                  try {
                    var mm = window.OBDClient.getCanWheelMeter();
                    if (!mm.on && typeof window._st_cwClearLive === 'function')
                      window._st_cwClearLive();
                    if (typeof window._st_renderCanWheel === 'function')
                      window._st_renderCanWheel();
                  } catch (_) {
                    /* ignore */
                  }
                });
              }
            } catch (_) {
              /* ignore */
            }
          }
          _renderVehK();
          // ★起動時: 登録済の現役随伴車を復元 → フィールド表示 + trace に焼く★
          //   VIN/OBD が無くても(iPhone・OBD未接続でも)全 trace に車両タグが付く=型式別解析が常に成立。
          (function _loadActiveVehicle() {
            try {
              var p = JSON.parse(localStorage.getItem('dk_veh_active') || 'null');
              if (p) {
                if (vehModelEl && !vehModelEl.value) vehModelEl.value = p.model || '';
                if (vehNameEl && !vehNameEl.value) vehNameEl.value = p.name || '';
                // ★較正状態表示★: 健全窓Ksが3以上=較正済(中央値K表示)・未満=未較正。
                if (vehCalibStatusEl) {
                  var _ks = p && Array.isArray(p.calibKs) ? p.calibKs : [];
                  if (_ks.length >= 3 && window.KCalib && window.KCalib.median) {
                    vehCalibStatusEl.textContent =
                      '✓ 較正済 K=' + window.KCalib.median(_ks).toFixed(3);
                    vehCalibStatusEl.style.color = '#34c759';
                  } else {
                    vehCalibStatusEl.textContent = '⚠ 未較正';
                    vehCalibStatusEl.style.color = '#ff9500';
                  }
                }
                if (vehKatashikiEl && !vehKatashikiEl.value)
                  vehKatashikiEl.value = p.katashiki || '';
                if (vehTireEl && !vehTireEl.value) vehTireEl.value = p.tire || '';
                window.DK_VEHICLE_PROFILE = p;
                _applyTireProfileToUI(p); // 工場サイズロック表示 + 今サイズ + 比表示を復元
                if (vehSaveNoteEl)
                  vehSaveNoteEl.textContent =
                    '登録済の随伴車を読込 (' + (p.model || p.katashiki || '') + ')';
              }
            } catch (_) {
              /* ignore */
            }
          })();
          // ★今日の車 選択ストリップ更新 (業務開始画面・dk_veh_active から名前+較正状態を反映)★
          window._updateBizCarSelect = function () {
            try {
              var nameEl = document.getElementById('bizCarName');
              var calibEl = document.getElementById('bizCarCalib');
              if (!nameEl || !calibEl) return;
              // ★監査shouldFix是正: レジストリのactive車から読む(K自動保存後の最新calibKsを反映・旧キー直読の不整合解消)★
              var pv =
                window.VehRegistry && window.VehRegistry.getActive
                  ? window.VehRegistry.getActive(localStorage)
                  : JSON.parse(localStorage.getItem('dk_veh_active') || 'null');
              nameEl.textContent =
                pv && pv.name
                  ? pv.name
                  : pv && (pv.model || pv.katashiki)
                    ? pv.model || pv.katashiki
                    : '未登録';
              var ks = pv && Array.isArray(pv.calibKs) ? pv.calibKs : [];
              if (ks.length >= 3 && window.KCalib && window.KCalib.median) {
                calibEl.textContent = '✓較正済 K=' + window.KCalib.median(ks).toFixed(3);
                calibEl.style.color = '#34c759';
              } else {
                calibEl.textContent = '⚠未較正';
                calibEl.style.color = '#ff9500';
              }
            } catch (_) {
              /* 表示更新失敗は無害(距離/課金に無関係) */
            }
          };
          window._updateBizCarSelect();
          // ★車の管理(多台リスト)描画＋操作 (2026-06-26)★: VehRegistry を使って一覧/追加/選択/削除。
          function _esc(s) {
            return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
              return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
            });
          }
          function _carStatusText(car) {
            var ks = car && Array.isArray(car.calibKs) ? car.calibKs : [];
            if (ks.length >= 3 && window.KCalib && window.KCalib.median)
              return { t: '✓ 較正済 K=' + window.KCalib.median(ks).toFixed(3), c: '#34c759' };
            return { t: '⚠ 未較正', c: '#ff9500' };
          }
          // ★監査P1是正: 車を切り替えた瞬間に worker._vehicleId を同期(K混入防止)★。
          //   autoCalibK ON時のみ configVehicle 送信=OFFは何もしない=byte完全不変。
          window._syncWorkerVehicle = function () {
            if (window.DK_AUTO_CALIB_K && typeof Meter !== 'undefined' && Meter._postVehicleK) {
              try {
                Meter._postVehicleK();
              } catch (_) {
                /* 同期失敗は次業務開始で回復 */
              }
            }
          };
          // ★較正ゲート(司さん要望2026-06-26): 未較正の車では代行開始(=課金距離)させない=未較正課金ゼロ★
          //   ブロック条件: autoCalibK ON かつ OBD接続中(=新方式作動) かつ active車が未較正(calibKs<3窓)。
          //   OFF/OBD未接続(=GPSで従来と同一)はブロックしない=従来通り開始可。失敗時もブロックしない(営業止めない側)。
          window._calibGateBlocked = function () {
            try {
              // ★2026-07-03 Fix B配線: degraded(較正エンジン未ロード)/notApplied(較正済なのにKが乗ってない)は
              //   代行開始させない★=未較正課金ゼロと同じ思想(過小の距離で課金を始めさせない)。更新/再起動で復旧。
              if (window._autoCalibKDegraded === true || window._autoCalibKNotApplied === true)
                return true;
              if (!window.DK_AUTO_CALIB_K) return false;
              if (!window.OBD_DRIVE_DISTANCE) return false;
              var car =
                window.VehRegistry && window.VehRegistry.getActive
                  ? window.VehRegistry.getActive(localStorage)
                  : null;
              var ks = car && Array.isArray(car.calibKs) ? car.calibKs : [];
              return ks.length < 3;
            } catch (_) {
              return false;
            }
          };
          // 較正進捗 n/3 (代行開始ブロック中の案内用)。
          window._calibGateProgress = function () {
            try {
              var car =
                window.VehRegistry && window.VehRegistry.getActive
                  ? window.VehRegistry.getActive(localStorage)
                  : null;
              var ks = car && Array.isArray(car.calibKs) ? car.calibKs : [];
              return Math.min(ks.length, 3) + '/3';
            } catch (_) {
              return '0/3';
            }
          };
          // 代行開始ボタンのグレー表示を較正状態に追従(ブロック中=薄く)。mmResult/画面表示時に呼ぶ。
          window._updateCalibGate = function () {
            try {
              var blocked = window._calibGateBlocked();
              var b = document.getElementById('btnMain');
              if (b) b.style.opacity = blocked ? '0.4' : '';
              var pb = document.querySelector('.btn-main-idle-portrait');
              if (pb) pb.style.opacity = blocked ? '0.4' : '';
              // ★較正中の常時バナー(司さん「分からん」対策)★: ブロック中だけ進捗を青バーの下に常時表示。
              //   一時トーストでなく"今ずっと較正中"が一目で分かる。距離/課金に無関係。
              var ban = document.getElementById('calibBanner');
              if (!ban) {
                ban = document.createElement('div');
                ban.id = 'calibBanner';
                ban.style.cssText =
                  'position:fixed;top:60%;left:50%;transform:translateX(-50%);z-index:60;display:none;' +
                  'background:#ff9500;color:#fff;font-size:13px;font-weight:700;padding:8px 18px;white-space:nowrap;' +
                  'border-radius:16px;box-shadow:0 2px 10px rgba(0,0,0,.3);max-width:94vw;text-align:center;';
                document.body.appendChild(ban);
              }
              if (blocked) {
                // ★位置=代行開始ボタンの少し下(司さん要望)★: 表示中のボタンの直下に置く。
                var _bm =
                  b && b.offsetParent !== null
                    ? b
                    : document.querySelector('.btn-main-idle-portrait');
                try {
                  var _r = _bm ? _bm.getBoundingClientRect() : null;
                  if (_r && _r.height > 0) {
                    ban.style.top = _r.bottom + 12 + 'px';
                    ban.style.bottom = 'auto';
                  }
                } catch (_p) {
                  /* 位置計算失敗は既定top */
                }
                var _n = 0;
                try {
                  var _c =
                    window.VehRegistry && window.VehRegistry.getActive
                      ? window.VehRegistry.getActive(localStorage)
                      : null;
                  _n = _c && Array.isArray(_c.calibKs) ? Math.min(_c.calibKs.length, 3) : 0;
                } catch (_e) {
                  _n = 0;
                }
                var _rem =
                  typeof window._calibAccKm === 'number'
                    ? Math.max(0.1, 3 - window._calibAccKm).toFixed(1)
                    : String(3 - _n);
                if (window._autoCalibKDegraded === true || window._autoCalibKNotApplied === true) {
                  // ★2026-07-03 Fix B: 較正済なのにKが乗ってない(未ロード/復元漏れ)。較正中でなく"故障"→赤+更新誘導★
                  ban.textContent =
                    '⚠ 較正Kが未適用：距離が過小になります。アプリを更新/再起動してください';
                  ban.style.background = '#ff3b30';
                } else {
                  ban.textContent = '🔧 OBD較正中 ' + _n + '/3（あと約' + _rem + 'km）';
                  ban.style.background = '#ff9500';
                }
                ban.style.display = 'block';
              } else {
                ban.style.display = 'none';
              }
            } catch (_) {
              /* 表示のみ・距離/課金に無関係 */
            }
          };
          // ★初回オンボーディング誘導 (2026-06-27)★: ホームに「車登録→OBD接続→較正」のチェックリスト。
          //   全部済めば自動で消える。autoCalibK時のみ。距離/課金に無関係。
          window._updateSetupGuide = function () {
            try {
              var el = document.getElementById('setupGuide');
              if (!el) return;
              if (!window.DK_AUTO_CALIB_K) {
                el.style.display = 'none';
                return;
              }
              var car =
                window.VehRegistry && window.VehRegistry.getActive
                  ? window.VehRegistry.getActive(localStorage)
                  : null;
              var hasCar = !!(car && (car.name || car.model || car.katashiki));
              var obdOn = !!window.OBD_DRIVE_DISTANCE;
              var ks = car && Array.isArray(car.calibKs) ? car.calibKs : [];
              var calibrated = ks.length >= 3;
              if (hasCar && obdOn && calibrated) {
                el.style.display = 'none'; // 全部済=ガイド不要
                return;
              }
              // ★1文字ずつ縦に割れないようにする★ 2026-08-25（実測 375px）
              //   前 … 「① 車を登録」が ★57 x 37（＝2行に割れる）★
              //         「② OBDを接続」75 x 37 ／「③ 較正走行」66 x 37
              //   原因 … 3つを横1列(flex)に並べていたので、狭いと ★字の方が潰される★
              //   直し … ★印と見出しは 折り返さない・縮めない★／説明は ★次の行★へ。
              //          （この形は 給料の画面でも 同じ日に踏んだ）
              function row(done, label, hint) {
                return (
                  '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;padding:4px 0;">' +
                  '<span style="font-size:15px;flex:0 0 auto;">' +
                  (done ? '✅' : '⬜') +
                  '</span><span style="font-weight:600;white-space:nowrap;flex:0 0 auto;">' +
                  label +
                  '</span><span style="color:#8c8c8c;font-size:12px;flex:1 1 100%;padding-left:23px;">' +
                  hint +
                  '</span></div>'
                );
              }
              var stepsEl = document.getElementById('setupSteps');
              if (stepsEl)
                stepsEl.innerHTML =
                  row(
                    hasCar,
                    '① 車を登録',
                    hasCar ? car.name || car.model || '登録済' : '名前＋工場タイヤ(ドアのシール)'
                  ) +
                  row(obdOn, '② OBDを接続', obdOn ? '接続中' : '下の「OBDを接続」ボタン') +
                  row(calibrated, '③ 較正走行', calibrated ? '較正済' : '見通しの良い道で走るだけ');
              var regBtn = document.getElementById('setupRegBtn');
              if (regBtn) regBtn.style.display = hasCar ? 'none' : 'block';
              el.style.display = 'block';
            } catch (_) {
              /* 表示のみ・距離/課金に無関係 */
            }
          };
          // ★今日の車 ドロップダウン(その場で選択/追加・設定に飛ばない・司さん要望2026-06-27)★
          function _bizSelectCar(id) {
            try {
              if (!window.VehRegistry) return;
              window.VehRegistry.setActive(localStorage, id);
              var car = window.VehRegistry.get(localStorage, id);
              if (car) {
                window.DK_VEHICLE_PROFILE = car;
                try {
                  localStorage.setItem('dk_veh_active', JSON.stringify(car));
                } catch (_e) {
                  /* ignore */
                }
                if (typeof _loadCarIntoCard === 'function') _loadCarIntoCard(car);
              }
              if (typeof window._syncWorkerVehicle === 'function') window._syncWorkerVehicle();
              if (typeof window._closeBizCarModal === 'function') window._closeBizCarModal();
              if (typeof window._updateBizCarSelect === 'function') window._updateBizCarSelect();
              if (typeof window._renderVehList === 'function') window._renderVehList();
              if (typeof window._updateCalibGate === 'function') window._updateCalibGate();
              if (typeof window._updateSetupGuide === 'function') window._updateSetupGuide();
            } catch (_) {
              /* 選択失敗は無害 */
            }
          }
          // ★司さん2026-06-27: モーダルから車を削除(設定の車管理🗑と同じ本処理・確認はインラインで実施済)。
          function _bizDeleteCar(id) {
            try {
              if (!window.VehRegistry) return;
              var car = window.VehRegistry.get(localStorage, id);
              window.VehRegistry.remove(localStorage, id);
              // VIN紐付けバックアップも消す(同VIN再追加で削除車の古いKs蘇生防止・設定削除と挙動統一)。
              if (car && car.vin) {
                try {
                  localStorage.removeItem('dk_veh_' + car.vin);
                } catch (_v) {
                  /* ignore */
                }
              }
              var act = window.VehRegistry.getActive(localStorage);
              window.DK_VEHICLE_PROFILE = act || null;
              try {
                if (act) localStorage.setItem('dk_veh_active', JSON.stringify(act));
                else localStorage.removeItem('dk_veh_active');
              } catch (_s) {
                /* ignore */
              }
              if (typeof window._syncWorkerVehicle === 'function') window._syncWorkerVehicle();
              window._renderBizCarDropdown();
              if (typeof window._updateBizCarSelect === 'function') window._updateBizCarSelect();
              if (typeof window._renderVehList === 'function') window._renderVehList();
              if (typeof window._updateCalibGate === 'function') window._updateCalibGate();
              if (typeof window._updateSetupGuide === 'function') window._updateSetupGuide();
            } catch (_) {
              /* 削除失敗は無害 */
            }
          }
          window._renderBizCarDropdown = function () {
            try {
              var dd = document.getElementById('bizCarDropdown');
              if (!dd || !window.VehRegistry) return;
              var cars = window.VehRegistry.list(localStorage);
              var activeId = window.VehRegistry.getActiveId(localStorage);
              var html = '';
              cars.forEach(function (car) {
                var st = _carStatusText(car);
                var sel = car.id === activeId;
                html +=
                  '<div class="bizCarOpt" data-carid="' +
                  _esc(car.id) +
                  '" style="display:flex;align-items:center;gap:8px;padding:11px 14px;cursor:pointer;border-top:1px solid #eee;background:' +
                  (sel ? '#eff6ff' : '#fff') +
                  ';"><span style="flex:1;font-weight:700;font-size:14px;">' +
                  (sel ? '🔵 ' : '⚪ ') +
                  '🚗 ' +
                  _esc(car.name || car.model || car.id) +
                  '</span><span style="font-size:11px;font-weight:600;color:' +
                  st.c +
                  ';">' +
                  _esc(st.t) +
                  '</span><span class="bizCarDel" data-carid="' +
                  _esc(car.id) +
                  '" title="削除" style="font-size:16px;color:#ff3b30;padding:2px 2px 2px 8px;cursor:pointer;">🗑</span></div>';
              });
              html +=
                '<div id="bizCarAddRow" style="padding:11px 14px;cursor:pointer;border-top:1px solid #eee;color:#007aff;font-weight:700;font-size:14px;text-align:center;">＋ 車を追加</div>' +
                '<div id="bizCarAddForm" style="display:none;padding:11px 14px;border-top:1px solid #eee;background:#f7f7f9;">' +
                '<input id="bizAddName" placeholder="車の名前(例:アルト)" style="width:100%;padding:7px 9px;border:1px solid #d1d1d6;border-radius:7px;font-size: 16px;margin-bottom:6px;box-sizing:border-box;-webkit-appearance:none;height:34px;"/>' +
                '<div style="font-size:11px;color:#8c8c8c;margin-bottom:4px;line-height:1.4;">工場タイヤ（<b>運転席ドアのシール</b>のサイズ）</div>' +
                '<input id="bizAddTire" placeholder="例:155/65R14" style="width:100%;padding:7px 9px;border:1px solid #d1d1d6;border-radius:7px;font-size: 16px;margin-bottom:8px;box-sizing:border-box;-webkit-appearance:none;height:34px;"/>' +
                '<div style="font-size:11px;color:#8c8c8c;margin-bottom:4px;line-height:1.4;">今のタイヤ（<b>サイズが違う場合のみ</b>・替えてなければ空欄）</div>' +
                '<input id="bizAddTireCurrent" placeholder="例:165/55R15" style="width:100%;padding:7px 9px;border:1px solid #d1d1d6;border-radius:7px;font-size: 16px;margin-bottom:8px;box-sizing:border-box;-webkit-appearance:none;height:34px;"/>' +
                '<button id="bizAddSave" type="button" style="width:100%;padding:9px;background:#007aff;color:#fff;border:none;border-radius:7px;font-weight:700;font-size:14px;cursor:pointer;">追加して選択</button></div>';
              dd.innerHTML = html;
              Array.prototype.forEach.call(dd.querySelectorAll('.bizCarOpt'), function (opt) {
                opt.onclick = function () {
                  _bizSelectCar(opt.getAttribute('data-carid'));
                };
              });
              // ★司さん2026-06-27: 各車の🗑→押し間違え防止のインライン確認(削除/キャンセルがパッと出る)。
              //   設定に行かずモーダルで完結。削除はその車の較正Kも消えるので必ず確認を挟む。
              Array.prototype.forEach.call(dd.querySelectorAll('.bizCarDel'), function (delEl) {
                delEl.onclick = function (ev) {
                  ev.stopPropagation();
                  var cid = delEl.getAttribute('data-carid');
                  var rowEl = delEl.parentNode;
                  if (!rowEl) return;
                  rowEl.onclick = null; // 確認中は行タップでの選択を無効化
                  rowEl.style.background = '#fff5f5';
                  rowEl.innerHTML =
                    '<span style="flex:1;font-size:13px;font-weight:700;color:#ff3b30;">この車を削除？</span>' +
                    '<button class="bizDelYes" type="button" style="padding:6px 12px;background:#ff3b30;color:#fff;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;">削除</button>' +
                    '<button class="bizDelNo" type="button" style="padding:6px 12px;background:#f2f2f7;color:#333;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;">キャンセル</button>';
                  var yes = rowEl.querySelector('.bizDelYes');
                  var no = rowEl.querySelector('.bizDelNo');
                  if (yes)
                    yes.onclick = function (e2) {
                      e2.stopPropagation();
                      _bizDeleteCar(cid);
                    };
                  if (no)
                    no.onclick = function (e2) {
                      e2.stopPropagation();
                      window._renderBizCarDropdown();
                    };
                };
              });
              var addRow = document.getElementById('bizCarAddRow');
              if (addRow)
                addRow.onclick = function () {
                  var f = document.getElementById('bizCarAddForm');
                  if (f) {
                    f.style.display = f.style.display === 'none' ? 'block' : 'none';
                    var n = document.getElementById('bizAddName');
                    if (n && f.style.display === 'block') n.focus();
                  }
                };
              var saveBtn = document.getElementById('bizAddSave');
              if (saveBtn)
                saveBtn.onclick = function () {
                  var nm = ((document.getElementById('bizAddName') || {}).value || '').trim();
                  var tr = ((document.getElementById('bizAddTire') || {}).value || '').trim();
                  var trc = (
                    (document.getElementById('bizAddTireCurrent') || {}).value || ''
                  ).trim();
                  if (!nm) {
                    var n = document.getElementById('bizAddName');
                    if (n) n.focus();
                    return;
                  }
                  // 今のタイヤ(交換)がサイズ違いなら円周比で補正。設定の車管理と同じ_computeTireRatioを流用。
                  var ratio =
                    typeof _computeTireRatio === 'function' ? _computeTireRatio(tr, trc) : 1.0;
                  var saved = window.VehRegistry.save(localStorage, {
                    name: nm,
                    tire: tr,
                    tireCurrent: trc,
                    tireRatio: ratio,
                  });
                  _bizSelectCar(saved.id);
                };
            } catch (_) {
              /* 描画失敗は無害 */
            }
          };
          window._closeBizCarModal = function () {
            try {
              var modal = document.getElementById('bizCarModal');
              if (modal) modal.style.display = 'none';
            } catch (_) {
              /* ignore */
            }
          };
          // 「変更▼」: 今日の車モーダルを開く(車の選択/追加)。
          window._toggleBizCarDropdown = function () {
            try {
              var modal = document.getElementById('bizCarModal');
              if (!modal) return;
              if (!modal.style.display || modal.style.display === 'none') {
                window._renderBizCarDropdown();
                modal.style.display = 'flex';
              } else {
                modal.style.display = 'none';
              }
            } catch (_) {
              /* ignore */
            }
          };
          // ★司さん2026-06-27: 「車を登録する」はモーダルを開いて登録フォーム(名前/タイヤ)を即展開。
          window._openBizCarAdd = function () {
            try {
              var modal = document.getElementById('bizCarModal');
              if (!modal) return;
              window._renderBizCarDropdown();
              modal.style.display = 'flex';
              var form = document.getElementById('bizCarAddForm');
              if (form) form.style.display = 'block';
              var n = document.getElementById('bizAddName');
              if (n) {
                try {
                  n.focus();
                } catch (_f) {
                  /* focus失敗は無害 */
                }
              }
            } catch (_) {
              /* ignore */
            }
          };
          function _loadCarIntoCard(car) {
            if (!car) return;
            window._editingVehId = car.id || null;
            if (vehNameEl) vehNameEl.value = car.name || '';
            if (vehModelEl) vehModelEl.value = car.model || '';
            if (vehKatashikiEl) vehKatashikiEl.value = car.katashiki || '';
            if (vehTireEl) vehTireEl.value = car.tire || '';
            if (vehTireCurrentEl) vehTireCurrentEl.value = car.tireCurrent || '';
            if (vehCalibStatusEl) {
              var st = _carStatusText(car);
              vehCalibStatusEl.textContent = st.t;
              vehCalibStatusEl.style.color = st.c;
            }
            if (typeof _applyTireProfileToUI === 'function') _applyTireProfileToUI(car);
          }
          function _newCarInCard() {
            window._editingVehId = null;
            [vehNameEl, vehModelEl, vehKatashikiEl, vehTireEl, vehTireCurrentEl].forEach(
              function (e) {
                if (e) e.value = '';
              }
            );
            if (vehCalibStatusEl) {
              vehCalibStatusEl.textContent = '⚠ 未較正';
              vehCalibStatusEl.style.color = '#ff9500';
            }
            if (vehNameEl) vehNameEl.focus();
          }
          window._renderVehList = function () {
            try {
              if (!window.VehRegistry) return;
              var rowsEl = document.getElementById('vehListRows');
              if (!rowsEl) return;
              var cars = window.VehRegistry.list(localStorage);
              var activeId = window.VehRegistry.getActiveId(localStorage);
              rowsEl.innerHTML = '';
              if (!cars.length) {
                rowsEl.innerHTML =
                  '<div style="color:#8e8e93;padding:6px 2px;">まだ車がありません。「＋車を追加」で登録してください。</div>';
              }
              cars.forEach(function (car) {
                var st = _carStatusText(car);
                var sel = car.id === activeId;
                var row = document.createElement('div');
                row.style.cssText =
                  'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;border-radius:9px;margin-bottom:6px;background:#fff;border:1px solid ' +
                  (sel ? '#007aff' : '#e5e5ea') +
                  ';';
                var left = document.createElement('div');
                left.style.cssText = 'flex:1;cursor:pointer;';
                left.innerHTML =
                  '<div style="font-weight:700;">' +
                  (sel ? '🔵 ' : '⚪ ') +
                  '🚗 ' +
                  _esc(car.name || car.model || car.id) +
                  '</div><div style="font-size:11px;font-weight:600;color:' +
                  st.c +
                  ';margin-top:2px;">' +
                  st.t +
                  '</div>';
                left.onclick = function () {
                  window.VehRegistry.setActive(localStorage, car.id);
                  try {
                    localStorage.setItem('dk_veh_active', JSON.stringify(car));
                  } catch (_) {
                    /* ignore */
                  }
                  window.DK_VEHICLE_PROFILE = car;
                  window._syncWorkerVehicle(); // ★worker._vehicleId 即同期(K混入防止・ON時のみ)★
                  _loadCarIntoCard(car);
                  window._renderVehList();
                  if (typeof window._updateBizCarSelect === 'function')
                    window._updateBizCarSelect();
                };
                var del = document.createElement('div');
                del.textContent = '🗑';
                del.style.cssText = 'cursor:pointer;font-size:16px;color:#ff3b30;padding:4px 6px;';
                del.onclick = function (ev) {
                  ev.stopPropagation();
                  if (!window.confirm((car.name || 'この車') + ' を削除しますか？')) return;
                  window.VehRegistry.remove(localStorage, car.id);
                  // ★監査P1是正: VIN紐付けバックアップも消す(同VIN再追加で削除車の古いKs蘇生を防ぐ・btnVehDeleteと挙動統一)。
                  if (car.vin) {
                    try {
                      localStorage.removeItem('dk_veh_' + car.vin);
                    } catch (_) {
                      /* ignore */
                    }
                  }
                  if (window._editingVehId === car.id) _newCarInCard();
                  var act = window.VehRegistry.getActive(localStorage);
                  // ★監査P1是正: 削除後の新active車を本体プロファイルにも反映★(取り残しで旧車にK保存/送信を防ぐ)。
                  window.DK_VEHICLE_PROFILE = act || null;
                  window._syncWorkerVehicle(); // ★worker._vehicleId 即同期★
                  try {
                    if (act) localStorage.setItem('dk_veh_active', JSON.stringify(act));
                    else localStorage.removeItem('dk_veh_active');
                  } catch (_) {
                    /* ignore */
                  }
                  window._renderVehList();
                  if (typeof window._updateBizCarSelect === 'function')
                    window._updateBizCarSelect();
                };
                row.appendChild(left);
                row.appendChild(del);
                rowsEl.appendChild(row);
              });
              // ★監査shouldFix stale是正: 編集カードの較正状態も最新calibKsで更新★
              //   (K自動保存→_renderVehList→ここで設定カードも✓較正済に変わる・「較正済なのに⚠」根治)
              if (vehCalibStatusEl && window._editingVehId) {
                var _ec = window.VehRegistry.get(localStorage, window._editingVehId);
                if (_ec) {
                  var _est = _carStatusText(_ec);
                  vehCalibStatusEl.textContent = _est.t;
                  vehCalibStatusEl.style.color = _est.c;
                }
              }
            } catch (_) {
              /* 描画失敗は距離/課金に無関係 */
            }
          };
          var _vehAddBtnEl = document.getElementById('vehAddBtn');
          if (_vehAddBtnEl)
            _vehAddBtnEl.addEventListener('click', function () {
              _newCarInCard();
            });
          // 初期: 旧単一→リスト移行して描画 + active を編集カードに読込
          try {
            if (window.VehRegistry) {
              window.VehRegistry.migrate(localStorage);
              var _act0 = window.VehRegistry.getActive(localStorage);
              if (_act0) {
                window.DK_VEHICLE_PROFILE = _act0; // ★active車(id+calibKs付き)を本体に=業務開始のrestoreKs用★
                _loadCarIntoCard(_act0);
              }
              window._renderVehList();
            }
          } catch (_) {
            /* ignore */
          }
          if (typeof window.OBDClient === 'undefined') {
            // OBDClient 未 load → 何もしない (要素は静的初期表示のまま)
            if (noteEl) noteEl.textContent = 'OBD モジュール未ロード';
            return;
          }
          var O = window.OBDClient;
          var _obdConnected = false; // 接続状態 (ホームピルのトグル判定用)
          // ★OBD切断警告 状態 (2026-06-19・OBD真メイン化・監査 weh3uqdjj)★:
          //   OBDが距離メインで走っていた最中に「本当の切断(GATTリンク断)or 応答途絶(6s超)」を
          //   検知したら走行バッジを赤の警告にする。瞬断(数百ms〜数s・リンク生存)は gps.js 3ティアが
          //   OBD保持するので警告しない=ここの判定境界も同じ。点灯即時/消灯はOBD健全2s継続後(ヒステ
          //   リシス=再接続チカチカ防止)。OBD_DRIVE_DISTANCE は切断で false 化するため警告のゲートに
          //   使えない → 「直近にOBDで駆動していた時刻」_obdLastGoodT を基準にする(手動切断/業務終了でnull)。
          var OBD_HOLD_MS_UI = 6000; // gps.js OBD_COAST_HOLD_MS と同値(応答途絶=本当の切断とみなす猶予)
          var _obdLastGoodT = null; // OBDが距離メインで健全だった直近時刻 (null=OBD非駆動/手動切断/業務外)
          var _obdWarnOn = false; // 警告表示中フラグ
          // ★OBD切断 再接続バー(全画面・司さん2026-06-30): 一度繋いだ後の途切れを検知して全画面に再接続を促す。
