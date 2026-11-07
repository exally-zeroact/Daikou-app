      (function () {
        'use strict';
        function bindObdUI() {
          // ★L-2 監査修正: 二重 bind / setInterval 多重起動を防ぐ再入ガード
          if (window.__obdUiBound) return;
          window.__obdUiBound = true;
          var statusEl = document.getElementById('obdStatus');
          var speedEl = document.getElementById('obdSpeed');
          var sourceEl = document.getElementById('obdSource');
          var noteEl = document.getElementById('obdNote');
          var btnC = document.getElementById('btnObdConnect');
          var btnD = document.getElementById('btnObdDisconnect');
          // ★青バー常駐 OBD チップ + 走行中 距離源バッジ (2026-06-08)★
          var obdChip = document.getElementById('obdChip');
          var chipLabel = document.getElementById('obdChipLabel');
          var driveBadge = document.getElementById('obdDriveBadge');
          // ★随伴車情報カード (2026-06-09・VIN紐付け・固定1台)★
          var vehVinEl = document.getElementById('vehVin');
          var vehMakerEl = document.getElementById('vehMaker');
          var vehModelEl = document.getElementById('vehModel');
          var vehKatashikiEl = document.getElementById('vehKatashiki');
          var vehTireEl = document.getElementById('vehTire');
          var vehTireCurrentEl = document.getElementById('vehTireCurrent');
          var vehNameEl = document.getElementById('vehName'); // ★車の名前(自由・識別用)★
          var vehCalibStatusEl = document.getElementById('vehCalibStatus'); // ★較正状態表示★
          var vehTireRatioDispEl = document.getElementById('vehTireRatioDisp');
          var vehObdCapEl = document.getElementById('vehObdCap');
          var btnVehSave = document.getElementById('btnVehSave');
          // ★タイヤ円周比ヘルパ (2026-06-17)★: OBD車速はECUが工場タイヤ円周で換算済み=
          //   真距離 = OBD × (今の円周 ÷ 工場円周)。比 = 今÷工場(タイヤ大→実距離増→比>1で上げる)。
          //   規格表記 例 195/65R15 → 直径mm = リム×25.4 + 2×幅×(扁平/100)、円周 = 直径×π。
          function _parseTireSize(s) {
            if (!s || typeof s !== 'string') return null;
            var m = s.match(/(\d{2,3})\s*\/\s*(\d{2,3})\s*[Rr]\s*(\d{1,2})/);
            if (!m) return null;
            var w = parseInt(m[1], 10),
              ar = parseInt(m[2], 10),
              rim = parseInt(m[3], 10);
            if (!(w > 0) || !(ar > 0) || !(rim > 0)) return null;
            return { width: w, aspect: ar, rim: rim };
          }
          function _tireCircMm(spec) {
            if (!spec) return 0;
            var diaMm = spec.rim * 25.4 + 2 * spec.width * (spec.aspect / 100);
            return diaMm * Math.PI;
          }
          // factory/current 両方有効なら 今÷工場、current空なら 1.0。健全域[0.80,1.25]外は 1.0(+警告)。
          function _computeTireRatio(factoryStr, currentStr) {
            var fc = _parseTireSize(factoryStr);
            var cu = _parseTireSize(currentStr);
            if (!fc) return 1.0; // 工場サイズ未入力=補正なし
            if (!cu) return 1.0; // 今のサイズ空=未交換=恒等
            var cf = _tireCircMm(fc),
              cc = _tireCircMm(cu);
            if (!(cf > 0) || !(cc > 0)) return 1.0;
            var r = cc / cf; // ★今÷工場★
            if (!(r >= 0.8 && r <= 1.25)) {
              try {
                if (typeof dlog === 'function')
                  dlog('[OBD-TIRE] ratio out of band, clamped to 1.0: ' + r);
              } catch (_) {
                /* ignore */
              }
              return 1.0;
            }
            return r;
          }
          function _refreshTireRatioDisp() {
            try {
              var r = _computeTireRatio(
                vehTireEl ? vehTireEl.value : '',
                vehTireCurrentEl ? vehTireCurrentEl.value : ''
              );
              if (vehTireRatioDispEl) vehTireRatioDispEl.textContent = '×' + r.toFixed(3);
            } catch (_) {
              /* ignore */
            }
          }
          if (vehTireEl) vehTireEl.addEventListener('input', _refreshTireRatioDisp);
          if (vehTireCurrentEl) vehTireCurrentEl.addEventListener('input', _refreshTireRatioDisp);
          // ★工場サイズ初回ロック反映 + 今サイズ復元 + 比表示更新★(保存/起動/VIN切替で共通呼出)。
          function _applyTireProfileToUI(prof) {
            try {
              prof = prof || {};
              if (vehTireEl) {
                // ★工場タイヤは常に変更可能(司さん要望2026-06-23): 以前は初回確定後ロックしてたが、
                //   車を替える/誤入力を直す/未知車テストのため、いつでも編集できるようにした。
                //   保存時は「入力が空でない時だけ上書き・空なら前の値を維持」で誤クリアを防ぐ。
                vehTireEl.value = prof.tire || '';
                vehTireEl.readOnly = false;
                vehTireEl.style.background = '';
              }
              if (vehTireCurrentEl) vehTireCurrentEl.value = prof.tireCurrent || '';
              _refreshTireRatioDisp();
            } catch (_) {
              /* ignore */
            }
          }
          var vehSaveNoteEl = document.getElementById('vehSaveNote');
          // ★随伴車別 k(メーター定数)校正UI (2026-06-09)★
          var vehKValueEl = document.getElementById('vehKValue');
          var vehCertMeterReadEl = document.getElementById('vehCertMeterReadM');
          var vehLastBusinessDistEl = document.getElementById('vehLastBusinessDistM');
          var btnVehCalibrate = document.getElementById('btnVehCalibrate');
          var vehCalibrateNoteEl = document.getElementById('vehCalibrateNote');
          var _curVin = ''; // 接続中随伴車のVIN(保存キー)
          function _renderVehK() {
            try {
              var p = JSON.parse(localStorage.getItem('dk_veh_active') || 'null');
              var k = p && typeof p.k === 'number' ? p.k : 1.0;
              if (vehKValueEl) vehKValueEl.textContent = k.toFixed(3);
              if (vehLastBusinessDistEl) {
                var bd =
                  typeof Meter !== 'undefined' && Meter.getState
                    ? Meter.getState().business_distance_m || 0
                    : 0;
                vehLastBusinessDistEl.textContent =
                  bd > 0 ? (bd / 1000).toFixed(2) + ' km' : '—(業務終了後に表示)';
              }
            } catch (_) {
              /* ignore */
            }
          }
          // ELM327 0902(VIN)生応答 → 17桁ASCII VIN を抽出
          function _parseVin(raw) {
            if (!raw) return '';
            var c = String(raw).replace(/[\s>]/g, '').toUpperCase();
            var out = '';
            var i = 0;
            // "4902" 区切りの後ろのバイト列を ASCII 化(印字可能のみ)
            while ((i = c.indexOf('4902', i)) >= 0) {
              var seg = c.substr(i + 4);
              for (var j = 0; j + 1 < seg.length; j += 2) {
                var b = seg.substr(j, 2);
                if (!/^[0-9A-F]{2}$/.test(b)) break;
                var code = parseInt(b, 16);
                if (code >= 0x20 && code <= 0x7e) {
                  var ch = String.fromCharCode(code);
                  if (/[A-HJ-NPR-Z0-9]/.test(ch)) out += ch; // VINは I/O/Q 不使用
                }
                if (out.length >= 17) break;
              }
              if (out.length >= 17) break;
              i += 4;
            }
            return out.slice(0, 17);
          }
          // VIN WMI(先頭3桁) → メーカー/年式(簡易・日本車中心)
          function _vinInfo(vin) {
            if (!vin || vin.length < 11) return { maker: '', year: '' };
            var wmi = vin.substr(0, 3);
            var map = {
              JT: 'トヨタ',
              JF: 'スバル',
              JH: 'ホンダ',
              JN: '日産',
              JM: 'マツダ',
              JS: 'スズキ',
              JD: 'ダイハツ',
              JY: 'ヤマハ',
              JL: 'いすゞ',
              JT2: 'トヨタ',
              JTM: 'トヨタ',
              JTD: 'トヨタ',
              JTE: 'トヨタ',
              JTN: 'トヨタ',
              JHM: 'ホンダ',
              JHL: 'ホンダ',
              JN1: '日産',
              JN8: '日産',
              JN6: '日産',
              JM1: 'マツダ',
              JM3: 'マツダ',
              JF1: 'スバル',
              JF2: 'スバル',
            };
            var maker = map[wmi] || map[wmi.substr(0, 2)] || wmi;
            // ★10桁目=年式コード (ISO 3779 標準・決まった30年周期=DB/更新不要で新年式に自動対応)★
            //   コード順 (I/O/Q/U/Z と 0 は不使用) を index 化し 2010+index。2010〜2039 を恒久カバー
            //   (30年周期ゆえ以降も同アルゴリズムで継続)。旧ハードコード(2026頭打ち)を置換。
            var yc = vin.charAt(9);
            var YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789'; // 30コード
            var yi = YEAR_CODES.indexOf(yc);
            var year = yi >= 0 ? String(2010 + yi) : '';
            return { maker: maker, year: year };
          }
          if (btnVehSave) {
            btnVehSave.addEventListener('click', function () {
              // ★VINは必須にしない (クローンELM327で多フレームVINが取れない事が多い)★。
              //   固定随伴車なので「手動登録」を主キーにし、VINは取れたらボーナスで併記。
              try {
                var info = _curVin ? _vinInfo(_curVin) : { maker: '', year: '' };
                // ★学習済 k を保存で消さない★: 既存 profile から k と較正メタを継承。
                var _prev = JSON.parse(localStorage.getItem('dk_veh_active') || 'null');
                var prof = {
                  vin: _curVin || '',
                  maker: info.maker,
                  year: info.year,
                  model: vehModelEl ? vehModelEl.value.trim() : '',
                  katashiki: vehKatashikiEl ? vehKatashikiEl.value.trim() : '',
                  // ★車の名前(自由・識別用)★: 空なら前値維持。名前は表示用でキーでない=改名してもKは保持。
                  name:
                    vehNameEl && vehNameEl.value.trim()
                      ? vehNameEl.value.trim()
                      : _prev && _prev.name
                        ? _prev.name
                        : '',
                  // ★1km自動較正Kの永続(健全窓Ks)★: 保存で消さず継承(較正完了データを保持)。
                  calibKs: _prev && Array.isArray(_prev.calibKs) ? _prev.calibKs : [],
                  // ★工場タイヤ=変更可能(司さん要望2026-06-23)★: 入力が空でなければ今の値で上書き、
                  //   空なら前の値を維持(誤クリア防止)。以前の「初回ロック・上書き禁止」を廃止。
                  tire:
                    vehTireEl && vehTireEl.value.trim()
                      ? vehTireEl.value.trim()
                      : _prev && _prev.tire
                        ? _prev.tire
                        : '',
                  // 今のタイヤ(交換した場合のみ・毎回上書き可・空=未交換)
                  tireCurrent: vehTireCurrentEl ? vehTireCurrentEl.value.trim() : '',
                  k: _prev && typeof _prev.k === 'number' ? _prev.k : 1.0,
                  k_samples: _prev && _prev.k_samples ? _prev.k_samples : 0,
                  savedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
                };
                // ★タイヤ円周比(今÷工場)を確定して保存★。pipeline vEff段で乗算され距離を物理補正。
                prof.tireRatio = _computeTireRatio(prof.tire, prof.tireCurrent);
                if (!prof.model && !prof.katashiki) {
                  if (vehSaveNoteEl)
                    vehSaveNoteEl.textContent = '車種か型式を入力してから保存してください';
                  return;
                }
                // ★主キー= dk_veh_active(固定随伴車の現役登録)。VINがあれば dk_veh_<VIN> にも保存。★
                localStorage.setItem('dk_veh_active', JSON.stringify(prof));
                if (_curVin) localStorage.setItem('dk_veh_' + _curVin, JSON.stringify(prof));
                // ★多台レジストリにも保存 (2026-06-26)★: 編集中の車(_editingVehId)を更新・無ければ新規追加。
                //   id を prof に焼いて active に設定。較正Ks(calibKs)は prof が継承済(消さない)。
                try {
                  if (window.VehRegistry) {
                    var _carToSave = Object.assign({}, prof);
                    if (window._editingVehId) _carToSave.id = window._editingVehId;
                    var _savedCar = window.VehRegistry.save(localStorage, _carToSave);
                    window._editingVehId = _savedCar.id;
                    window.VehRegistry.setActive(localStorage, _savedCar.id);
                    prof.id = _savedCar.id;
                    localStorage.setItem('dk_veh_active', JSON.stringify(_savedCar));
                    if (typeof window._renderVehList === 'function') window._renderVehList();
                    if (typeof window._updateBizCarSelect === 'function')
                      window._updateBizCarSelect();
                  }
                } catch (_) {
                  /* レジストリ保存失敗は単一保存で機能継続 */
                }
                // ★trace に焼く + ログ出力 (型式別解析用・VIN無くても効く)★
                window.DK_VEHICLE_PROFILE = prof;
