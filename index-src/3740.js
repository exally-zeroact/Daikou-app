      // ★設計変更宣言 (2026-05-15・MA Phase D・fare overlay 動作 JS):
      //   元 fare.html (L936-1846) の <script> ロジックを index.html に取り込み。
      //   公開関数は window._fare_ prefix で attach し業務側 (Meter / FB / Business) との衝突を回避。
      //   旧 fare.html の `function saveAll()` 等は本 IIFE 内に閉じ込めて window._fare_saveAll に export。
      //   _fare_load() を showOverlay('fare') 経路から呼出し fresh fareConfig を都度ロード。
      (function () {
        const COLOR_PRESETS = [
          '#007AFF',
          '#1c1c1e',
          '#FF9500',
          '#FF3B30',
          '#A0287A',
          '#007AFF',
          '#FFCC00',
          '#FF6B9D',
        ];
        const $ = (id) => document.getElementById(id);
        let fc = {
          version: 2,
          base_fare: 1300,
          base_distance_m: 1000,
          add_fare: 100,
          add_distance_m: 420,
          tiers: [],
          tiersEnabled: false,
          surcharges: [],
          minFare: null,
          maxFare: null,
          rounding: 10,
          autoSurcharges: {
            night: { enabled: false, from: 22, to: 5, rate: 1.2 },
            weekend: { enabled: false, rate: 1.1 },
            winter: { enabled: false, from: '12-15', to: '03-15', rate: 1.1 },
          },
          vehicles: [],
          vehiclesEnabled: false,
          wait: { enabled: false, freeMins: 5, ratePerMin: 100 },
          zones: [],
          zonesEnabled: false,
        };
        let extraItems = [];
        let _previewActiveSurcharges = new Set();
        let _tabsBound = false;

        function _qsa(sel) {
          return Array.prototype.slice.call(document.querySelectorAll('#overlayFare ' + sel));
        }
        function _bindTabsOnce() {
          if (_tabsBound) return;
          _tabsBound = true;
          _qsa('.tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
              const tab = btn.dataset.tab;
              _qsa('.tab-btn').forEach((b) => b.classList.remove('active'));
              btn.classList.add('active');
              _qsa('.tab-pane').forEach((p) => p.classList.remove('active'));
              const pane = document.querySelector(
                '#overlayFare .tab-pane[data-pane="' + tab + '"]'
              );
              if (pane) pane.classList.add('active');
              if (tab === 'preview') updatePreview();
              if (tab === 'auto') updateAutoStatus();
            });
          });
        }
        function bindToggle(elId, getter, setter) {
          const el = $(elId);
          if (!el) return;
          if (getter()) el.classList.add('on');
          else el.classList.remove('on');
          el.onclick = () => {
            setter(!getter());
            if (getter()) el.classList.add('on');
            else el.classList.remove('on');
            if (elId.indexOf('_fare_auto') === 0) updateAutoStatus();
          };
        }

        // ━━ 基本タブ ━━
        function loadBasic() {
          $('_fare_baseFare').value = fc.base_fare;
          $('_fare_baseDistance').value = fc.base_distance_m;
          $('_fare_addFare').value = fc.add_fare;
          $('_fare_addDistance').value = fc.add_distance_m;
          $('_fare_minFare').value = fc.minFare != null ? fc.minFare : '';
          $('_fare_maxFare').value = fc.maxFare != null ? fc.maxFare : '';
          _qsa('#_fare_roundingPills .pill').forEach((p) => {
            if (parseInt(p.dataset.val, 10) === fc.rounding) p.classList.add('selected');
            else p.classList.remove('selected');
            p.onclick = () => {
              fc.rounding = parseInt(p.dataset.val, 10);
              _qsa('#_fare_roundingPills .pill').forEach((x) => x.classList.remove('selected'));
              p.classList.add('selected');
            };
          });
        }
        function saveBasic() {
          fc.base_fare = parseInt($('_fare_baseFare').value, 10) || 0;
          fc.base_distance_m = parseInt($('_fare_baseDistance').value, 10) || 0;
          fc.add_fare = parseInt($('_fare_addFare').value, 10) || 0;
          fc.add_distance_m = parseInt($('_fare_addDistance').value, 10) || 0;
          const mn = $('_fare_minFare').value;
          fc.minFare = mn === '' ? null : parseInt(mn, 10);
          const mx = $('_fare_maxFare').value;
          fc.maxFare = mx === '' ? null : parseInt(mx, 10);
        }

        // ━━ 段階タブ ━━
        function renderTiers() {
          const root = $('_fare_tiersList');
          if (!root) return;
          root.innerHTML = '';
          (fc.tiers || []).forEach((t, i) => {
            const card = document.createElement('div');
            card.className = 'item-card';
            card.innerHTML =
              '<div class="item-card-row"><span class="form-label">区間 ' +
              (i + 1) +
              '</span><button class="btn-del" data-i="' +
              i +
              '">削除</button></div>' +
              '<div class="item-card-row"><span class="form-label">から</span><input class="form-input" type="number" data-key="from_m" value="' +
              (t.from_m || 0) +
              '"><span class="form-unit">m</span></div>' +
              '<div class="item-card-row"><span class="form-label">まで</span><input class="form-input" type="number" data-key="to_m" value="' +
              (t.to_m == null ? '' : t.to_m) +
              '" placeholder="∞"><span class="form-unit">m</span></div>' +
              '<div class="item-card-row"><span class="form-label">加算料金</span><input class="form-input" type="number" data-key="add_fare" value="' +
              (t.add_fare || 0) +
              '"><span class="form-unit">円</span></div>' +
              '<div class="item-card-row"><span class="form-label">加算距離</span><input class="form-input" type="number" data-key="add_distance_m" value="' +
              (t.add_distance_m || 0) +
              '"><span class="form-unit">m</span></div>';
            card.querySelectorAll('input').forEach((inp) => {
              inp.oninput = () => {
                const k = inp.dataset.key;
                const v = inp.value;
                if (k === 'to_m') fc.tiers[i].to_m = v === '' ? null : parseInt(v, 10);
                else fc.tiers[i][k] = parseInt(v, 10) || 0;
                if (k === 'to_m' && fc.tiers[i + 1]) {
                  fc.tiers[i + 1].from_m = fc.tiers[i].to_m || 0;
                  renderTiers();
                }
              };
            });
            card.querySelector('.btn-del').onclick = () => {
              fc.tiers.splice(i, 1);
              renderTiers();
            };
            root.appendChild(card);
          });
        }
        function addTier() {
          if (!fc.tiers) fc.tiers = [];
          const last = fc.tiers[fc.tiers.length - 1];
          const fromM = last ? last.to_m || 0 : fc.base_distance_m || 1000;
          fc.tiers.push({ from_m: fromM, to_m: null, add_fare: 100, add_distance_m: 300 });
          renderTiers();
        }

        // ━━ 割増タブ ━━
        function renderSurcharges() {
          const root = $('_fare_surchargesList');
          if (!root) return;
          root.innerHTML = '';
          (fc.surcharges || []).forEach((s, i) => {
            const card = document.createElement('div');
            card.className = 'item-card';
            let colorHtml = '<div class="color-picker">';
            COLOR_PRESETS.forEach((c) => {
              const sel = c === s.color ? ' selected' : '';
              colorHtml +=
                '<div class="color-swatch' +
                sel +
                '" style="background:' +
                c +
                '" data-color="' +
                c +
                '"></div>';
            });
            colorHtml += '</div>';
            card.innerHTML =
              '<div class="item-card-row"><span class="form-label">割増 ' +
              (i + 1) +
              '</span><button class="btn-del" data-i="' +
              i +
              '">削除</button></div>' +
              '<div class="item-card-row"><span class="form-label">業務開始時 ON</span><div class="toggle ' +
              (s.active_default ? 'on' : '') +
              '" data-toggle="active_default"></div></div>' +
              '<div class="item-card-row"><span class="form-label">名称</span><input class="form-input text wide" data-key="name" value="' +
              (s.name || '') +
              '"></div>' +
              '<div class="item-card-row"><span class="form-label">倍率</span><input class="form-input" type="number" step="0.05" min="1.0" max="3.0" data-key="rate" value="' +
              (s.rate || 1.2) +
              '"><span class="form-unit">倍</span></div>' +
              '<div class="item-card-row"><span class="form-label">色</span>' +
              colorHtml +
              '</div>';
            card.querySelectorAll('input').forEach((inp) => {
              inp.oninput = () => {
                const k = inp.dataset.key;
                if (k === 'rate') fc.surcharges[i].rate = parseFloat(inp.value) || 1.0;
                else fc.surcharges[i][k] = inp.value;
              };
            });
            card.querySelectorAll('.color-swatch').forEach((sw) => {
              sw.onclick = () => {
                fc.surcharges[i].color = sw.dataset.color;
                card
                  .querySelectorAll('.color-swatch')
                  .forEach((x) => x.classList.remove('selected'));
                sw.classList.add('selected');
              };
            });
            card.querySelector('.toggle[data-toggle="active_default"]').onclick = (e) => {
              fc.surcharges[i].active_default = !fc.surcharges[i].active_default;
              e.currentTarget.classList.toggle('on');
            };
            card.querySelector('.btn-del').onclick = () => {
              fc.surcharges.splice(i, 1);
              renderSurcharges();
            };
            root.appendChild(card);
          });
        }
        function addSurcharge() {
          if (!fc.surcharges) fc.surcharges = [];
          const id = 'sc_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
          fc.surcharges.push({
            id: id,
            name: '割増' + (fc.surcharges.length + 1),
            rate: 1.2,
            color: COLOR_PRESETS[fc.surcharges.length % COLOR_PRESETS.length],
            active_default: false,
          });
          renderSurcharges();
        }

        // ━━ 自動割増タブ ━━
        function loadAuto() {
          const a = fc.autoSurcharges || {};
          $('_fare_autoNightFrom').value = a.night && a.night.from != null ? a.night.from : 22;
          $('_fare_autoNightTo').value = a.night && a.night.to != null ? a.night.to : 5;
          $('_fare_autoNightRate').value = (a.night && a.night.rate) || 1.2;
          $('_fare_autoWeekendRate').value = (a.weekend && a.weekend.rate) || 1.1;
          $('_fare_autoWinterFrom').value = (a.winter && a.winter.from) || '12-15';
          $('_fare_autoWinterTo').value = (a.winter && a.winter.to) || '03-15';
          $('_fare_autoWinterRate').value = (a.winter && a.winter.rate) || 1.1;
          [
            '_fare_autoNightFrom',
            '_fare_autoNightTo',
            '_fare_autoNightRate',
            '_fare_autoWeekendRate',
            '_fare_autoWinterFrom',
            '_fare_autoWinterTo',
            '_fare_autoWinterRate',
          ].forEach((k) => {
            const el = $(k);
            if (!el) return;
            el.oninput = () => {
              saveAuto();
              updateAutoStatus();
            };
          });
        }
        function saveAuto() {
          const a = fc.autoSurcharges || (fc.autoSurcharges = {});
          a.night = a.night || {};
          a.weekend = a.weekend || {};
          a.winter = a.winter || {};
          a.night.from = parseInt($('_fare_autoNightFrom').value, 10);
          a.night.to = parseInt($('_fare_autoNightTo').value, 10);
          a.night.rate = parseFloat($('_fare_autoNightRate').value) || 1.2;
          a.weekend.rate = parseFloat($('_fare_autoWeekendRate').value) || 1.1;
          a.winter.from = $('_fare_autoWinterFrom').value || '12-15';
          a.winter.to = $('_fare_autoWinterTo').value || '03-15';
          a.winter.rate = parseFloat($('_fare_autoWinterRate').value) || 1.1;
        }
        function updateAutoStatus() {
          const a = fc.autoSurcharges || {};
          const now = new Date();
          // ★判じは js/fare-calc.js の tekiyou 1か所★ 2026-10-08（日本時間・土日／冬は 業務を 始めた 日＝メーターと 同じ）
          const _bs =
            typeof Business !== 'undefined' && Business.getState ? Business.getState() : null;
          const _tk = FareCalc.tekiyou(fc, now, _bs && _bs.active ? _bs.start_time : null);
          const nE = $('_fare_autoNightStatus');
          if (nE) {
            if (a.night && a.night.enabled) {
              const inRange = _tk.night;
              nE.textContent = inRange ? '現在 適用中 ×' + (a.night.rate || 1.2) : '現在 適用外';
              nE.classList.toggle('inactive', !inRange);
            } else {
              nE.textContent = 'OFF';
              nE.classList.add('inactive');
            }
          }
          const wE = $('_fare_autoWeekendStatus');
          if (wE) {
            if (a.weekend && a.weekend.enabled) {
              const inRange = _tk.weekend;
              wE.textContent = inRange ? '現在 適用中 ×' + (a.weekend.rate || 1.1) : '現在 適用外';
              wE.classList.toggle('inactive', !inRange);
            } else {
              wE.textContent = 'OFF';
              wE.classList.add('inactive');
            }
          }
          const xE = $('_fare_autoWinterStatus');
          if (xE) {
            if (a.winter && a.winter.enabled) {
              const inRange = _tk.winter;
              xE.textContent = inRange ? '現在 適用中 ×' + (a.winter.rate || 1.1) : '現在 適用外';
              xE.classList.toggle('inactive', !inRange);
            } else {
              xE.textContent = 'OFF';
              xE.classList.add('inactive');
            }
          }
        }

        // ━━ 車種タブ ━━
        function renderVehicles() {
          const root = $('_fare_vehiclesList');
          if (!root) return;
          root.innerHTML = '';
          (fc.vehicles || []).forEach((v, i) => {
            const card = document.createElement('div');
            card.className = 'item-card';
            card.innerHTML =
              '<div class="item-card-row"><span class="form-label">車種 ' +
              (i + 1) +
              '</span><button class="btn-del" data-i="' +
              i +
              '">削除</button></div>' +
              '<div class="item-card-row"><span class="form-label">デフォルト選択</span><div class="toggle ' +
              (v.default ? 'on' : '') +
              '" data-toggle="default"></div></div>' +
              '<div class="item-card-row"><span class="form-label">名称</span><input class="form-input text wide" data-key="name" value="' +
              (v.name || '') +
              '"></div>' +
              '<div class="item-card-row"><span class="form-label">倍率</span><input class="form-input" type="number" step="0.05" min="0.5" max="3.0" data-key="multiplier" value="' +
              (v.multiplier || 1.0) +
              '"><span class="form-unit">倍</span></div>' +
              '<div class="item-card-row"><span class="form-label">追加料金</span><input class="form-input" type="number" data-key="addon" value="' +
              (v.addon || 0) +
              '"><span class="form-unit">円</span></div>';
            card.querySelectorAll('input').forEach((inp) => {
              inp.oninput = () => {
                const k = inp.dataset.key;
                if (k === 'multiplier') fc.vehicles[i].multiplier = parseFloat(inp.value) || 1.0;
                else if (k === 'addon') fc.vehicles[i].addon = parseInt(inp.value, 10) || 0;
                else fc.vehicles[i][k] = inp.value;
              };
            });
            card.querySelector('.toggle[data-toggle="default"]').onclick = () => {
              (fc.vehicles || []).forEach((x) => (x.default = false));
              fc.vehicles[i].default = true;
              renderVehicles();
            };
            card.querySelector('.btn-del').onclick = () => {
              fc.vehicles.splice(i, 1);
              renderVehicles();
            };
            root.appendChild(card);
          });
        }
        function addVehicle() {
          if (!fc.vehicles) fc.vehicles = [];
          const id = 'v_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
          fc.vehicles.push({
            id: id,
            name: '車種' + (fc.vehicles.length + 1),
            multiplier: 1.0,
            addon: 0,
            default: fc.vehicles.length === 0,
          });
          renderVehicles();
        }

        // ━━ ★距離別の 料金（何km で いくら）★ 2026-09-01 ━━
        //   ★司さん「前にあった何キロ走ったら何円の料金一覧表は？」★
        //   ★計算は ここに 書きません★… js/fare-calc.js（★メーターの 料金と 同じ 1か所★）を 呼ぶ。
        //   ⇒ ★表に 出る 金額と 実際に 取る 金額が ずれません★
        //   ★時間で 変わる 割増（深夜・土日・冬）も 入った 今の 金額★を 出します
        //   （下に その事を 書きます＝★数字だけ 見て 誤解しない為★）
        function _fareKmHyou() {
          const tb = $('_fare_kmhyou');
          const note = $('_fare_kmhyouNote');
          if (!tb) return;
          tb.innerHTML = '';
          let c = null;
          try {
            c = Meter.getFareConfig();
          } catch (_) {
            c = null;
          }
          if (!c) {
            if (note) note.textContent = '料金表が まだ 取れていません。';
            return;
          }
          const base = typeof c.base_distance_m === 'number' ? c.base_distance_m : 1000;
          const add = c.add_distance_m > 0 ? c.add_distance_m : 420;
          const MAX = 22000;
          const now = new Date();
          const li = [];
          for (let d = base; d <= MAX; d += add) li.push(d);
          if (li[li.length - 1] < MAX) li.push(MAX);
          li.forEach((d, i) => {
            let en = null;
            try {
              /* global FareCalc */
              en = FareCalc.keisan(d, c, null, new Set(), 0, now);
            } catch (_) {
              en = null;
            }
            const tr = document.createElement('tr');
            const t1 = document.createElement('td');
            t1.textContent =
              (i === 0 ? '最初の ' : '') + (d >= 1000 ? (d / 1000).toFixed(2) + ' km' : d + ' m');
            const t2 = document.createElement('td');
            t2.textContent = en == null ? '—' : en.toLocaleString('ja-JP') + '円';
            tr.appendChild(t1);
            tr.appendChild(t2);
            tb.appendChild(tr);
          });
          if (note) {
            note.textContent =
              '今の 時間で 出した 金額です（深夜・土日・冬の 割増が 効く 時間帯なら その分も 入っています）。' +
              '待ち時間・追加料金・値引きは 入っていません。';
          }
        }

        // ━━ ★今の 料金表を 字で 出す（読むだけ）★ 2026-09-01 ━━
        //   ★司さん「料金表が見れたええやろ」★
        //   ★お金の 計算は ここに 書きません★（読んだ 中身を そのまま 並べるだけ）。
        //   数字の 出どころは ★Meter.getFareConfig()★＝実際に 料金を 出している 物。
        //   ⇒ ★画面に 出る 数字と 実際に 使う 数字が ずれません★
        function _fareYomu() {
          const el = $('_fare_yomu');
          if (!el) return;
          let c = null;
          try {
            c = Meter.getFareConfig();
          } catch (_) {
            c = null;
          }
          if (!c) {
            el.textContent = '料金表が まだ 取れていません。';
            return;
          }
          const yen = (n) => (typeof n === 'number' ? n.toLocaleString('ja-JP') + '円' : '—');
          const m = (n) => (typeof n === 'number' ? n.toLocaleString('ja-JP') + 'm' : '—');
          const gyou = [];
          const ire = (na, at) => gyou.push([na, at]);

          ire('最初の 料金', yen(c.base_fare));
          ire('その 料金で 走れる 距離', m(c.base_distance_m));
          ire('その先 上がる 料金', yen(c.add_fare));
          ire('上がる ごとの 距離', m(c.add_distance_m));
          ire('端数の 丸め', (c.rounding || 1) + '円ごと');

          // ★印が 偽なら 段階を 出さない★＝メーター（fare-calc の keisan）と 揃える（10-11）
          if (c.tiersEnabled !== false && Array.isArray(c.tiers) && c.tiers.length) {
            c.tiers.forEach((t, i) => {
              ire(
                '段階 ' + (i + 1),
                m(t.from_m) +
                  ' 〜 ' +
                  (t.to_m == null ? 'ずっと' : m(t.to_m)) +
                  '／' +
                  m(t.add_distance_m) +
                  ' ごとに +' +
                  yen(t.add_fare)
              );
            });
          }
          if (Array.isArray(c.surcharges) && c.surcharges.length) {
            c.surcharges.forEach((x) =>
              ire('割増（手で 押す）', (x.name || '—') + ' ' + x.rate + '倍')
            );
          }
          const a = c.autoSurcharges || {};
          if (a.night && a.night.enabled)
            ire('深夜の 割増', a.night.from + '時 〜 ' + a.night.to + '時 ' + a.night.rate + '倍');
          if (a.weekend && a.weekend.enabled) ire('土日の 割増', a.weekend.rate + '倍');
          if (a.winter && a.winter.enabled)
            ire('冬の 割増', a.winter.from + ' 〜 ' + a.winter.to + ' ' + a.winter.rate + '倍');
          (Array.isArray(a.kikan) ? a.kikan : []).forEach((k) =>
            ire((k.name || '期間') + 'の 割増', k.from + ' 〜 ' + k.to + ' ' + k.rate + '倍')
          );
          if (c.vehiclesEnabled && Array.isArray(c.vehicles) && c.vehicles.length) {
            c.vehicles.forEach((v) =>
              ire('車種', (v.name || '—') + ' ' + (v.multiplier || 1) + '倍 ＋' + yen(v.addon || 0))
            );
          }
          if (c.wait && c.wait.enabled)
            ire(
              '待ち時間',
              (c.wait.freeMins || 0) + '分まで 無料／その先 1分 ' + yen(c.wait.ratePerMin || 0)
            );
          if (typeof c.minFare === 'number') ire('これより 安くしない', yen(c.minFare));
          if (typeof c.maxFare === 'number') ire('これより 高くしない', yen(c.maxFare));

          el.innerHTML = '';
          gyou.forEach(([na, at]) => {
            const r = document.createElement('div');
            r.className = 'yomu-gyou';
            const l = document.createElement('span');
            l.className = 'yomu-na';
            l.textContent = na;
            const v = document.createElement('span');
            v.className = 'yomu-at';
            v.textContent = at;
            r.appendChild(l);
            r.appendChild(v);
            el.appendChild(r);
          });
        }

        // ━━ 待機タブ ━━
        function loadWait() {
          const w = fc.wait || {};
          $('_fare_waitFreeMins').value = typeof w.freeMins === 'number' ? w.freeMins : 5;
          $('_fare_waitRate').value = typeof w.ratePerMin === 'number' ? w.ratePerMin : 100;
          $('_fare_waitFreeMins').oninput = () => {
            fc.wait.freeMins = parseInt($('_fare_waitFreeMins').value, 10) || 0;
          };
          $('_fare_waitRate').oninput = () => {
            fc.wait.ratePerMin = parseInt($('_fare_waitRate').value, 10) || 0;
          };
        }

        // ━━ 区間タブ ━━
        function renderZones() {
          const root = $('_fare_zonesList');
          if (!root) return;
          root.innerHTML = '';
          (fc.zones || []).forEach((z, i) => {
            const card = document.createElement('div');
            card.className = 'item-card';
            card.innerHTML =
              '<div class="item-card-row"><span class="form-label">区間 ' +
              (i + 1) +
              '</span><button class="btn-del" data-i="' +
              i +
              '">削除</button></div>' +
              '<div class="item-card-row"><span class="form-label">名称</span><input class="form-input text wide" data-key="name" value="' +
              (z.name || '') +
              '"></div>' +
              '<div class="item-card-row"><span class="form-label">固定料金</span><input class="form-input" type="number" data-key="fare" value="' +
              (z.fare || 0) +
              '"><span class="form-unit">円</span></div>';
            card.querySelectorAll('input').forEach((inp) => {
              inp.oninput = () => {
                const k = inp.dataset.key;
                if (k === 'fare') fc.zones[i].fare = parseInt(inp.value, 10) || 0;
                else fc.zones[i][k] = inp.value;
              };
            });
            card.querySelector('.btn-del').onclick = () => {
              fc.zones.splice(i, 1);
              renderZones();
            };
            root.appendChild(card);
          });
        }
        function addZone() {
          if (!fc.zones) fc.zones = [];
          fc.zones.push({ name: '区間' + (fc.zones.length + 1), fare: 5000 });
          renderZones();
        }

        // ━━ 追加料金タブ ━━
        function loadExtras() {
          try {
            const raw = localStorage.getItem('daikou_extras');
            extraItems = raw ? JSON.parse(raw) || [] : [];
          } catch (_) {
            extraItems = [];
          }
          renderExtraItems();
        }
        function renderExtraItems() {
          const el = $('_fare_extraItems');
          if (!el) return;
          el.innerHTML = extraItems
            .map(
              (item, i) =>
                '<div class="extra-item">' +
                '<input class="extra-name" type="text" value="' +
                String(item.name || '').replace(/"/g, '&quot;') +
                '" placeholder="項目名（例：迎車料金）" oninput="window._fare_setExtraName(' +
                i +
                ',this.value)">' +
                '<div class="extra-item-row">' +
                '<input class="extra-amount" type="number" value="' +
                (item.amount || '') +
                '" placeholder="0" min="0" inputmode="numeric" oninput="window._fare_setExtraAmount(' +
                i +
                ',this.value)">' +
                '<span class="extra-unit">円</span>' +
                '<button class="extra-del" onclick="window._fare_removeExtra(' +
                i +
                ')">削除</button>' +
                '</div></div>'
            )
            .join('');
        }
        // ★★追加料金・値引きは 直した その場で 端末に 残す（2026-10-09）★★
        //   09-01 に 保存ボタンを 隠してから（料金表は 事務所からだけ）、
        //   ★ここで 足した 項目は どこにも 書かれず 開き直すと 消えていました★（実測 0件）。
        //   ⇒ 足す・消す・打つ たびに 書く（押す ボタンは 要らない）
        function addExtraItem() {
          extraItems.push({ name: '', amount: 0 });
          renderExtraItems();
          saveExtras();
        }
        function removeExtra(i) {
          extraItems.splice(i, 1);
          renderExtraItems();
          saveExtras();
        }
        function saveExtras() {
          // ★保存に 失敗したら 黙らずに 知らせる★（端末の 空きが 足りない 等・10-11）
          //   前は catch で 飲み込み、運転手は 保存できたと 思い込んだ（開き直すと 前の 見本に 戻っていた）
          try {
            localStorage.setItem('daikou_extras', JSON.stringify(extraItems));
            return true;
          } catch (_) {
            showToast(
              '保存できませんでした（端末の 空きが 足りない 等）。もう一度 入れ直してください'
            );
            return false;
          }
        }

        // ━━ 値引き (追加料金と同型・プリセット管理) ━━
        let discountItems = [];
        function loadDiscounts() {
          try {
            const raw = localStorage.getItem('daikou_discounts');
            discountItems = raw ? JSON.parse(raw) || [] : [];
          } catch (_) {
            discountItems = [];
          }
          renderDiscountItems();
        }
        function renderDiscountItems() {
          const el = $('_fare_discountItems');
          if (!el) return;
          el.innerHTML = discountItems
            .map(
              (item, i) =>
                '<div class="extra-item">' +
                '<input class="extra-name" type="text" value="' +
                String(item.name || '').replace(/"/g, '&quot;') +
                '" placeholder="項目名（例：常連割）" oninput="window._fare_setDiscountName(' +
                i +
                ',this.value)">' +
                '<div class="extra-item-row">' +
                '<input class="extra-amount" type="number" value="' +
                (item.amount ? Math.abs(Number(item.amount) || 0) : '') +
                '" placeholder="0" min="0" inputmode="numeric" oninput="window._fare_setDiscountAmount(' +
                i +
                ',this.value)">' +
                '<span class="extra-unit">円</span>' +
                '<button class="extra-del" onclick="window._fare_removeDiscount(' +
                i +
                ')">削除</button>' +
                '</div></div>'
            )
            .join('');
        }
        function addDiscountItem() {
          discountItems.push({ name: '', amount: 0 });
          renderDiscountItems();
          saveDiscounts();
        }
        function removeDiscountCfg(i) {
          discountItems.splice(i, 1);
          renderDiscountItems();
          saveDiscounts();
        }
        function saveDiscounts() {
          // ★保存に 失敗したら 黙らずに 知らせる★（端末の 空きが 足りない 等・10-11）
          //   前は catch で 飲み込み、運転手は 保存できたと 思い込んだ（開き直すと 前の 見本に 戻っていた）
          try {
            localStorage.setItem('daikou_discounts', JSON.stringify(discountItems));
            return true;
          } catch (_) {
            showToast(
              '保存できませんでした（端末の 空きが 足りない 等）。もう一度 入れ直してください'
            );
            return false;
          }
        }

        // ━━ プレビュータブ ━━
        function renderPreviewSurcharges() {
          const root = $('_fare_previewSurcharges');
          if (!root) return;
          root.innerHTML = '';
          (fc.surcharges || []).forEach((s) => {
            if (!s.id) return;
            const wrap = document.createElement('label');
            wrap.style.cssText =
              'display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:14px;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!s.active_default;
            if (s.active_default) _previewActiveSurcharges.add(s.id);
            cb.onchange = () => {
              if (cb.checked) _previewActiveSurcharges.add(s.id);
              else _previewActiveSurcharges.delete(s.id);
              updatePreview();
            };
            const dot = document.createElement('span');
            dot.style.cssText =
              'display:inline-block;width:14px;height:14px;border-radius:50%;background:' +
              (s.color || '#007AFF') +
              ';';
            const txt = document.createElement('span');
            txt.textContent = s.name + ' ×' + s.rate;
            wrap.appendChild(cb);
            wrap.appendChild(dot);
            wrap.appendChild(txt);
            root.appendChild(wrap);
          });
        }
        function _calcFareForPreview(distanceM) {
          let fare;
          if (Array.isArray(fc.tiers) && fc.tiers.length > 0 && fc.tiersEnabled !== false) {
            if (distanceM <= fc.base_distance_m) {
              fare = fc.base_fare;
            } else {
              fare = fc.base_fare;
              for (const t of fc.tiers) {
                if (!t || typeof t.from_m !== 'number') continue;
                if (distanceM <= t.from_m) continue;
                const tierEnd = t.to_m == null ? distanceM : Math.min(distanceM, t.to_m);
                const tierDist = tierEnd - t.from_m;
                if (tierDist <= 0) continue;
                const ad = t.add_distance_m > 0 ? t.add_distance_m : 1;
                const af = t.add_fare || 0;
                const steps = Math.floor(tierDist / ad) + 1;
                fare += steps * af;
                if (t.to_m == null) break;
                if (distanceM <= t.to_m) break;
              }
            }
          } else {
            // ★ Phase 1000m 境界 (meter.js と同期・<= 採用)
            if (distanceM <= fc.base_distance_m) fare = fc.base_fare;
            else {
              const extra = distanceM - fc.base_distance_m;
              const steps = Math.floor(extra / fc.add_distance_m) + 1;
              fare = fc.base_fare + steps * fc.add_fare;
            }
          }
          return fare;
        }
        function _roundFare(fare) {
          if (typeof fc.minFare === 'number' && fc.minFare > 0 && fare < fc.minFare)
            fare = fc.minFare;
          if (typeof fc.maxFare === 'number' && fc.maxFare > 0 && fare > fc.maxFare)
            fare = fc.maxFare;
          const unit = typeof fc.rounding === 'number' && fc.rounding > 0 ? fc.rounding : 1;
          if (unit > 1) fare = Math.round(fare / unit) * unit;
          else fare = Math.round(fare);
          return fare;
        }
        function updatePreview() {
          renderPreviewSurcharges();
          let mul = 1.0;
          (fc.surcharges || []).forEach((s) => {
            if (_previewActiveSurcharges.has(s.id) && typeof s.rate === 'number') mul *= s.rate;
          });
          const a = fc.autoSurcharges || {};
          const now = new Date();
          // ★判じは js/fare-calc.js の tekiyou 1か所★ 2026-10-08（日本時間・土日／冬は 業務を 始めた 日＝メーターと 同じ）
          const _bs =
            typeof Business !== 'undefined' && Business.getState ? Business.getState() : null;
          const _tk = FareCalc.tekiyou(fc, now, _bs && _bs.active ? _bs.start_time : null);
          // ★倍率も メーターと 同じ 関数（重なりの 掛け方・期間も 含む）＝写しを 作らない★
          mul *= FareCalc._autoMul(fc, now, _bs && _bs.active ? _bs.start_time : null);
          $('_fare_previewMultiplier').textContent = '適用倍率 ×' + mul.toFixed(2);

          const baseD =
            typeof fc.base_distance_m === 'number' && fc.base_distance_m > 0
              ? fc.base_distance_m
              : 1000;
          const addD =
            typeof fc.add_distance_m === 'number' && fc.add_distance_m > 0
              ? fc.add_distance_m
              : 420;
          // ★設計変更宣言 (2026-05-15・修正3・プレビューテーブル全段列挙化):
          //   旧: stepsToShow=[0,1,2,3,5,10,15,20,30,50] の飛び飛び 10 段表示で
          //       _calcFareForPreview の +1 step 計算と相まって 1420m → ¥1500
          //       と表示され ¥1400 が消失していた事象を解消。
          //   新: 旧形式 (tiersEnabled=false) では baseFare + n*addFare の純粋線形列挙で
          //       n=0..maxN まで全段 (~22000m 程度) を順次表示・段間 ¥100 ずつ確実に増える。
          //       tiersEnabled=true の場合は従来の _calcFareForPreview を使用 (段階定義は
          //       ユーザーの自由なので飛び飛び表示しない・連続段表示)。
          //   絶対ルール「指示された箇所のみ」遵守: 本変更は overlayFare 確認タブの
          //   プレビューテーブル生成ロジックのみ・meter.js の calcFare 本体は無変更。
          const tbody = $('_fare_previewTbody');
          tbody.innerHTML = '';
          const useTiers =
            Array.isArray(fc.tiers) && fc.tiers.length > 0 && fc.tiersEnabled !== false;
          const MAX_DIST_M = 22000;
          if (useTiers) {
            // tiers 経路: 旧式 stepsToShow を維持 (段階定義はユーザー設定なので飛び飛び表示)
            const stepsToShow = [0, 1, 2, 3, 5, 10, 15, 20, 30, 50];
            stepsToShow.forEach((n) => {
              const d = baseD + n * addD;
              if (d > MAX_DIST_M) return;
              const fare = _calcFareForPreview(d) * mul;
              const rounded = _roundFare(fare);
              const label =
                n === 0
                  ? '初乗り (' + d.toLocaleString() + 'm)'
                  : (d >= 1000 ? (d / 1000).toFixed(2) + 'km' : d + 'm') + ' (+' + n + '段)';
              const tr = document.createElement('tr');
              tr.innerHTML = '<td>' + label + '</td><td>¥' + rounded.toLocaleString() + '</td>';
              tbody.appendChild(tr);
            });
          } else {
            // 旧形式 (base + add) 純粋線形列挙: n=0 で base_fare・以降 n*add_fare 加算
            const maxN = addD > 0 ? Math.floor((MAX_DIST_M - baseD) / addD) : 0;
            for (let n = 0; n <= maxN; n++) {
              const d = baseD + n * addD;
              const fare = (fc.base_fare + n * fc.add_fare) * mul;
              const rounded = _roundFare(fare);
              const label =
                n === 0
                  ? '初乗り (' + d.toLocaleString() + 'm)'
                  : (d >= 1000 ? (d / 1000).toFixed(2) + 'km' : d + 'm') + ' (+' + n + '段)';
              const tr = document.createElement('tr');
              tr.innerHTML = '<td>' + label + '</td><td>¥' + rounded.toLocaleString() + '</td>';
              tbody.appendChild(tr);
            }
          }

          const ps = $('_fare_previewAutoStatus');
          if (ps) {
            const items = [];
            if (a.night && a.night.enabled && _tk.night) items.push('深夜 ×' + a.night.rate);
            if (a.weekend && a.weekend.enabled && _tk.weekend)
              items.push('週末 ×' + a.weekend.rate);
            if (a.winter && a.winter.enabled && _tk.winter) items.push('冬季 ×' + a.winter.rate);
            _tk.kikan.forEach((k) => items.push((k.name || '期間') + ' ×' + k.rate));
            ps.textContent = items.length ? '自動適用中: ' + items.join(' / ') : '自動適用なし';
            ps.style.color = items.length ? '#007AFF' : '#999';
            ps.style.fontFamily = 'DM Mono,monospace';
            ps.style.fontSize = '12px';
          }
          _renderPreviewDetails();
        }
        function _renderPreviewDetails() {
          const esc = (s) =>
            String(s == null ? '' : s).replace(
              /[<>&"]/g,
              (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]
            );
          const yen = (n) => '¥' + (Number(n) || 0).toLocaleString();
          const m = (n) => (Number(n) || 0).toLocaleString() + 'm';
          const elBasic = $('_fare_previewBasic');
          if (elBasic)
            elBasic.innerHTML =
              '初乗り: ' +
              yen(fc.base_fare) +
              ' / ' +
              m(fc.base_distance_m) +
              '<br>加算: ' +
              yen(fc.add_fare) +
              ' / ' +
              m(fc.add_distance_m);
          const elTiers = $('_fare_previewTiers');
          if (elTiers) {
            if (!fc.tiersEnabled || !Array.isArray(fc.tiers) || fc.tiers.length === 0)
              elTiers.innerHTML = '<span style="color:#999;">使用しない</span>';
            else
              elTiers.innerHTML = fc.tiers
                .map(
                  (t, i) =>
                    i +
                    1 +
                    '. ' +
                    (t.from_m || 0) +
                    'm 〜 ' +
                    (t.to_m == null ? '∞' : t.to_m + 'm') +
                    ' : ' +
                    yen(t.add_fare) +
                    ' / ' +
                    m(t.add_distance_m)
                )
                .join('<br>');
          }
          const elSur = $('_fare_previewSurchargesList');
          if (elSur) {
            if (!Array.isArray(fc.surcharges) || fc.surcharges.length === 0)
              elSur.innerHTML = '<span style="color:#999;">未設定</span>';
            else
              elSur.innerHTML = fc.surcharges
                .map(
                  (s) =>
                    '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' +
                    (s.color || '#007AFF') +
                    ';vertical-align:middle;margin-right:6px;"></span>' +
                    esc(s.name) +
                    ' ×' +
                    (s.rate || 1.0)
                )
                .join('<br>');
          }
          const elAuto = $('_fare_previewAutoList');
          if (elAuto) {
            const a = fc.autoSurcharges || {};
            const lines = [];
            if (a.night)
              lines.push(
                '深夜: ' +
                  (a.night.enabled
                    ? '×' + a.night.rate + ' (' + a.night.from + '時〜' + a.night.to + '時)'
                    : '<span style="color:#999;">OFF</span>')
              );
            if (a.weekend)
              lines.push(
                '週末: ' +
                  (a.weekend.enabled
                    ? '×' + a.weekend.rate + ' (土日)'
                    : '<span style="color:#999;">OFF</span>')
              );
            if (a.winter)
              lines.push(
                '冬季: ' +
                  (a.winter.enabled
                    ? '×' + a.winter.rate + ' (' + a.winter.from + ' 〜 ' + a.winter.to + ')'
                    : '<span style="color:#999;">OFF</span>')
              );
            elAuto.innerHTML = lines.length
              ? lines.join('<br>')
              : '<span style="color:#999;">未設定</span>';
          }
          const elVeh = $('_fare_previewVehicles');
          if (elVeh) {
            if (!fc.vehiclesEnabled || !Array.isArray(fc.vehicles) || fc.vehicles.length === 0)
              elVeh.innerHTML = '<span style="color:#999;">使用しない</span>';
            else
              elVeh.innerHTML = fc.vehicles
                .map(
                  (v) =>
                    esc(v.name) +
                    ' ×' +
                    (v.multiplier || 1.0) +
                    (v.addon ? ' +' + yen(v.addon) : '') +
                    (v.default ? ' <span style="color:#007AFF;">(デフォルト)</span>' : '')
                )
                .join('<br>');
          }
          const elWait = $('_fare_previewWait');
          if (elWait) {
            const w = fc.wait || {};
            elWait.innerHTML = w.enabled
              ? '無料: 最初の ' +
                (w.freeMins || 0) +
                ' 分<br>料金: ' +
                yen(w.ratePerMin || 0) +
                ' / 分'
              : '<span style="color:#999;">使用しない</span>';
          }
          const elZones = $('_fare_previewZones');
          if (elZones) {
            if (!fc.zonesEnabled || !Array.isArray(fc.zones) || fc.zones.length === 0)
              elZones.innerHTML = '<span style="color:#999;">使用しない</span>';
            else
              elZones.innerHTML = fc.zones
                .map(
                  (z) => esc(z.from || '?') + ' → ' + esc(z.to || '?') + ' : ' + yen(z.fare || 0)
                )
                .join('<br>');
          }
          const elEx = $('_fare_previewExtras');
          if (elEx) {
            if (!Array.isArray(extraItems) || extraItems.length === 0)
              elEx.innerHTML = '<span style="color:#999;">未設定</span>';
            else
              elEx.innerHTML =
                extraItems
                  .filter((x) => x && x.name)
                  .map((x) => esc(x.name) + ' : ' + yen(x.amount || 0))
                  .join('<br>') || '<span style="color:#999;">未設定</span>';
          }
          const elLim = $('_fare_previewLimits');
          if (elLim) {
            const minF =
              typeof fc.minFare === 'number' && fc.minFare > 0
                ? yen(fc.minFare)
                : '<span style="color:#999;">なし</span>';
            const maxF =
              typeof fc.maxFare === 'number' && fc.maxFare > 0
                ? yen(fc.maxFare)
                : '<span style="color:#999;">なし</span>';
            const rnd =
              typeof fc.rounding === 'number' && fc.rounding > 0
                ? fc.rounding + '円' + (fc.rounding === 1 ? ' (丸めなし)' : ' 単位で切り上げ')
                : '1円 (丸めなし)';
            elLim.innerHTML = '下限: ' + minF + '<br>上限: ' + maxF + '<br>丸め: ' + rnd;
          }
        }

        // ━━ ロード / 保存 (Meter / FB / localStorage 連携) ━━
        function _initAll() {
          _bindTabsOnce();
          // ★今の 料金表を 字で 出す（読むだけ）★ 2026-09-01
          _fareYomu();
          _fareKmHyou();
          loadBasic();
          renderTiers();
          renderSurcharges();
          loadAuto();
          renderVehicles();
          loadWait();
          renderZones();
          loadExtras();
          loadDiscounts();
          bindToggle(
            '_fare_tiersEnabledToggle',
            () => fc.tiersEnabled,
            (v) => (fc.tiersEnabled = v)
          );
          bindToggle(
            '_fare_autoNightToggle',
            () => fc.autoSurcharges.night.enabled,
            (v) => (fc.autoSurcharges.night.enabled = v)
          );
          bindToggle(
            '_fare_autoWeekendToggle',
            () => fc.autoSurcharges.weekend.enabled,
            (v) => (fc.autoSurcharges.weekend.enabled = v)
          );
          bindToggle(
            '_fare_autoWinterToggle',
            () => fc.autoSurcharges.winter.enabled,
            (v) => (fc.autoSurcharges.winter.enabled = v)
          );
          bindToggle(
            '_fare_vehiclesEnabledToggle',
            () => fc.vehiclesEnabled,
            (v) => (fc.vehiclesEnabled = v)
          );
          bindToggle(
            '_fare_waitEnabledToggle',
            () => fc.wait.enabled,
            (v) => (fc.wait.enabled = v)
          );
          bindToggle(
            '_fare_zonesEnabledToggle',
            () => fc.zonesEnabled,
            (v) => (fc.zonesEnabled = v)
          );
          updateAutoStatus();
        }
        function load() {
          // ★★料金表（2026-08-30・Firebase → Supabase）★★
          //   ★写しで すぐ 描く★（圏外でも 設定画面が 空にならない）→ 取れたら 描き直す
          function ateru(cfg) {
            Object.assign(fc, cfg);
            if (typeof fc.tiersEnabled === 'undefined')
              fc.tiersEnabled = fc.tiers && fc.tiers.length > 0;
            if (typeof fc.zonesEnabled === 'undefined')
              fc.zonesEnabled = fc.zones && fc.zones.length > 0;
            _initAll();
          }
          if (typeof FareConfigStore === 'undefined') {
            _initAll();
            return;
          }
          const utsushi = FareConfigStore.yomuOffline();
          ateru(utsushi.config);
          itsunoFuda(utsushi);
          FareConfigStore.torikomu().then((r) => {
            if (r && r.ok) ateru(r.config);
            // ★取り直しても 取れなくても 出し直す★（古いままの時こそ 見せたい）
            itsunoFuda(FareConfigStore.yomuOffline());
          });
        }

        // ★★いつの 料金表かを 出す（2026-08-30・監査役の指摘）★★
        //   ★言葉は 部品が 作ります★（2つの画面で 別々に 書かない＝食い違いを 作らない）
        //   ★2026-08-30 追記（監査役の指摘）★
        //     ★「最後に 変えたのは 誰・いつ」も ★同じ箱に 2行目★として 出す★
        //     ★記録は 前から 持っていたのに 誰も 見ていませんでした★
        //     ⇒★勝手に 変えても 誰にも 分からない、が 終わります★
        function itsunoFuda(v) {
          const el = $('_fare_itsuno');
          if (!el || typeof FareConfigStore === 'undefined') return;
          // ★★1行だけ に しました★★ 2026-09-01（司さん「この赤丸いらんことない？」）
          //   ・「最後に 変えた人」は 出しません＝★メーターからは もう 変えられない★ので
          //     運転手には 要らない 字（事務所の「料金表」に 出ています）
          //   ・「いつ 取ったか」は ★残します★＝★古い 料金表で 走っていないか★は 大事
          el.textContent = v && v.fuda ? v.fuda : FareConfigStore.fudaMoji(v);
          const furui = !!(v && v.furusa && v.furusa.furui);
          const wakaranai = !(v && v.totta_at);
          // ★この画面は 色の 変数を 1つも 使っていません★ので、
          //   ★既にある 注意の 箱（.apk-modal-warn）と 同じ 色★に そろえます。
          //   （新しい色を 作らない＝画面の中で 浮かない）
          const chuui = furui || wakaranai;
          el.style.background = chuui ? '#fff8e1' : '#f2f2f7';
          el.style.color = chuui ? '#7a4a00' : '#333';
          el.style.border = chuui ? '1px solid #f59e0b' : '1px solid #d1d1d6';
        }
        // ★★料金表は ここから 書かない（2026-10-09）★★
        //   司さん 2026-09-01「事務所からだけにしたんやないんか」。前は 隠れた 入力欄から
        //   料金表を 組み直し ★倉庫へ 丸ごと 書いていました★（kakuMeter）＝端末の 写しが 古いと
        //   ★事務所で 後から 入れた 期間の割増・重なり・下限などを 古い物で 上書き★。
        //   ここで 残すのは 端末ごとの 追加料金・値引き だけ。
        function saveAll() {
          // ★両方 書けた 時だけ「保存しました」★（10-11・前は 失敗の 知らせを 上書きしていた）
          const a = saveExtras();
          const b = saveDiscounts();
          if (a && b) showToast('保存しました');
        }
        function showToast(msg) {
          const t = $('_fare_toast');
          if (!t) return;
          t.textContent = msg;
          t.classList.add('show');
          setTimeout(() => t.classList.remove('show'), 2000);
        }

        // 公開 API (window._fare_ prefix)
        window._fare_load = load;
        window._fare_saveAll = saveAll;
        window._fare_addTier = addTier;
        window._fare_addSurcharge = addSurcharge;
        window._fare_addVehicle = addVehicle;
        window._fare_addZone = addZone;
        window._fare_addExtraItem = addExtraItem;
        window._fare_removeExtra = removeExtra;
        window._fare_setExtraName = function (i, v) {
          if (extraItems[i]) extraItems[i].name = v;
          saveExtras();
        };
        window._fare_setExtraAmount = function (i, v) {
          // ★マイナスの 追加料金は 入れずに 知らせる★（黙って 0 に しない・10-11）
          //   「-」だけ 打った 途中は 欄の 値が 空＝保存しない（途中で 0 を 保存しない）
          if (String(v).trim() === '') return;
          const n = parseInt(v, 10) || 0;
          if (n < 0) {
            showToast('マイナスの 追加料金は 使えません（値引きで 登録してください）');
            return;
          }
          if (extraItems[i]) extraItems[i].amount = n;
          saveExtras();
        };
        window._fare_addDiscountItem = addDiscountItem;
        window._fare_removeDiscount = removeDiscountCfg;
        window._fare_setDiscountName = function (i, v) {
          if (discountItems[i]) discountItems[i].name = v;
          saveDiscounts();
        };
        window._fare_setDiscountAmount = function (i, v) {
          // ★値引きは 打った数の 大きさで 持つ★（-500 も 500円の 値引き・10-11）
          if (discountItems[i]) discountItems[i].amount = Math.abs(parseInt(v, 10) || 0);
          saveDiscounts();
        };
      })();
