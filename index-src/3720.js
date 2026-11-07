      // ============================================================
      // ★あとから代行を直す（追加料金・値引き・請求書）★ 2026-08-05
      //
      //   司さん「その業務押したら追加料金や値引きや請求書などちゃんと編集できな
      //           忘れとる時があると思うから」
      //
      //   ▼絶対にやらないこと
      //     ・距離を触る            … distance_m は読むだけ
      //     ・走った分の料金を作り直す … meter_fare をそのまま持ち回る
      //     ・走行中の extras/discounts を書き換える … ここは履歴専用の変数で閉じる
      //   ▼金額の計算・保存は js/trip-edit.js（テスト済み）に任せる。ここは画面だけ。
      // ============================================================
      (function () {
        let _cur = null; // { rideKey, tripKey, ride, extras, discounts, customer, before }
        let _pickMode = null;

        const _esc = (s) =>
          String(s == null ? '' : s).replace(
            /[&<>"']/g,
            (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
          );
        const _yen = (n) => '¥' + Math.round(Number(n) || 0).toLocaleString();
        const _readJson = (k, d) => {
          try {
            const raw = localStorage.getItem(k);
            return raw ? JSON.parse(raw) : d;
          } catch (_) {
            return d;
          }
        };

        function _findRide(rideKey, tripKey) {
          const list = _readJson(rideKey, []);
          if (!Array.isArray(list)) return null;
          return list.find((r) => r && Number(r.trip_key) === Number(tripKey)) || null;
        }

        // ★直せるか（その日の 営業だけ・2026-10-22）★ 控えは Business から 読む（倉庫の 字は 古い 事が 在る）
        window._te_naoseru = function (tripKey) {
          if (typeof TripEdit === 'undefined' || typeof TripEdit.naoseru !== 'function')
            return { ok: false, reason: 'eigyou_owari' };
          let st = null;
          try {
            st = typeof Business !== 'undefined' && Business.getState ? Business.getState() : null;
          } catch (_) {
            st = null;
          }
          return TripEdit.naoseru({
            tripKey: tripKey,
            state: st,
            history: _readJson('daikou_business_history', []),
            now: Date.now(),
            readOnly: !!window._tabReadOnly,
          });
        };
        function _te_naosenai(reason) {
          if (typeof window._showToast === 'function')
            window._showToast(TripEdit.naosenaiBun(reason));
        }

        window._te_open = function (rideKey, tripKey) {
          if (typeof TripEdit === 'undefined') return;
          const nao = window._te_naoseru(tripKey);
          if (!nao.ok) return _te_naosenai(nao.reason);
          const ride = _findRide(rideKey, tripKey);
          if (!ride) {
            if (typeof window._showToast === 'function')
              window._showToast('この代行が見つかりません');
            return;
          }
          _cur = {
            rideKey: rideKey,
            tripKey: tripKey,
            ride: ride,
            before: Number(ride.fare) || 0,
            extras: Array.isArray(ride.extras) ? ride.extras.slice() : [],
            discounts: Array.isArray(ride.discounts) ? ride.discounts.slice() : [],
            customer: ride.customer_id
              ? { customer_id: ride.customer_id, customer_name: ride.customer_name || '' }
              : null,
            customerNote: ride.customer_note || null, // 誰が乗ったか
          };
          // 直せない所（見せるだけ）
          const km = ((ride.distance_m || 0) / 1000).toFixed(2);
          document.getElementById('teDist').textContent = km + ' km';
          document.getElementById('teBase').textContent = _yen(TripEdit.meterFareOf(ride));
          const when =
            (ride.start_time
              ? new Date(ride.start_time).toLocaleString('ja-JP', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : ride.time || '') + ' の代行';
          document.getElementById('teTitle').textContent = when;
          const route = [ride.start_address, ride.end_address]
            .filter(Boolean)
            .map(_esc)
            .join(' → ');
          document.getElementById('teRoute').innerHTML = route;
          _te_render();
          document.getElementById('tripEditOverlay').classList.add('show');
        };

        window._te_close = function () {
          document.getElementById('tripEditOverlay').classList.remove('show');
          _cur = null;
        };

        function _te_render() {
          if (!_cur) return;
          const rows = (list, minus) =>
            list
              .map(
                (x, i) =>
                  '<div class="te-row"><span>' +
                  _esc(x.name) +
                  '</span><span class="te-amt' +
                  (minus ? ' minus' : '') +
                  '">' +
                  (minus ? '-' : '+') +
                  _yen(x.amount) +
                  '</span><span class="te-x" onclick="_te_del(\'' +
                  (minus ? 'discount' : 'extra') +
                  "'," +
                  i +
                  ')">✕</span></div>'
              )
              .join('');
          document.getElementById('teExtras').innerHTML = rows(_cur.extras, false);
          document.getElementById('teDiscounts').innerHTML = rows(_cur.discounts, true);
          // ★誰が乗ったか(会長/社長/専務など)も出す (2026-08-05)★
          //   聞く会社なのに未選択なら赤く「誰？」と出す。押せばその場で選べる。
          let noteHtml = '';
          if (_cur.customer) {
            const g = _te_noteGroupsOf(_cur.customer.customer_id);
            if (g.length) {
              noteHtml = _cur.customerNote
                ? '<span class="te-note-pick" onclick="_te_pick(\'note\')" style="margin-left:8px;color:#007aff;font-weight:700;">' +
                  _esc(_cur.customerNote) +
                  '</span>'
                : '<span class="te-note-pick" onclick="_te_pick(\'note\')" style="margin-left:8px;color:#ff3b30;font-weight:700;">誰？</span>';
            }
          }
          document.getElementById('teCustomer').innerHTML = _cur.customer
            ? '<div class="te-row"><span>' +
              _esc(_cur.customer.customer_name) +
              noteHtml +
              '</span><span class="te-x" onclick="_te_del(\'customer\',0)">✕</span></div>'
            : '';

          const total = TripEdit.totalOf(
            TripEdit.meterFareOf(_cur.ride),
            _cur.extras,
            _cur.discounts
          );
          document.getElementById('teTotal').textContent = _yen(total);
          const d = total - _cur.before;
          document.getElementById('teDiff').textContent =
            d === 0 ? '' : d > 0 ? '直す前より +' + _yen(d) : '直す前より -' + _yen(-d);
        }

        window._te_del = function (kind, i) {
          if (!_cur) return;
          if (kind === 'customer') {
            _cur.customer = null;
            _cur.customerNote = null; // 現金に戻すなら誰が乗ったかも消す
          } else if (kind === 'discount') _cur.discounts.splice(i, 1);
          else _cur.extras.splice(i, 1);
          _te_render();
        };

        // その会社が「誰が乗ったか」を聞く会社かどうか（聞かない会社は空配列）
        function _te_noteGroupsOf(customerId) {
          try {
            const c = _readJson('dk_customers_cache', []).filter(function (x) {
              return x && x.customer_id === customerId;
            })[0];
            return c && Array.isArray(c.note_groups) ? c.note_groups : [];
          } catch (_) {
            return [];
          }
        }

        // ─── 選ぶ画面（追加料金／値引き／請求先／誰が乗ったか で使い回す）───
        window._te_pick = function (mode) {
          if (!_cur) return;
          _pickMode = mode;
          const el = document.getElementById('tePickItems');
          const custom = document.getElementById('tePickCustom');
          let html = '';
          if (mode === 'note') {
            document.getElementById('tePickTitle').textContent = '誰が乗った？';
            custom.style.display = 'none';
            const groups = _cur.customer ? _te_noteGroupsOf(_cur.customer.customer_id) : [];
            _pickList = groups.map(function (g) {
              return { name: g };
            });
            html = _pickList.length
              ? _pickList
                  .map(
                    (x, i) =>
                      '<div class="modal-item" onclick="_te_pickItem(' +
                      i +
                      ')"><span class="modal-item-name">' +
                      _esc(x.name) +
                      '</span><span class="modal-item-price">' +
                      (_cur.customerNote === x.name ? '選択中' : '') +
                      '</span></div>'
                  )
                  .join('')
              : '<div class="modal-item" style="justify-content:center;color:#8e8e93">分け方が登録されていません</div>';
          } else if (mode === 'customer') {
            document.getElementById('tePickTitle').textContent = '請求書の会社を選ぶ';
            custom.style.display = 'none';
            const list = _readJson('dk_customers_cache', []).filter(
              (c) => c && c.name && c.active !== false
            );
            html = list.length
              ? list
                  .map(
                    (c, i) =>
                      '<div class="modal-item" onclick="_te_pickItem(' +
                      i +
                      ')"><span class="modal-item-name">' +
                      _esc(c.name) +
                      '</span><span class="modal-item-price">' +
                      (_cur.customer && _cur.customer.customer_id === c.customer_id
                        ? '選択中'
                        : '') +
                      '</span></div>'
                  )
                  .join('')
              : '<div class="modal-item" style="justify-content:center;color:#8e8e93">請求書の会社が登録されていません</div>';
            _pickList = list;
          } else {
            const isD = mode === 'discount';
            document.getElementById('tePickTitle').textContent = isD
              ? '値引きを選ぶ'
              : '追加料金を選ぶ';
            custom.style.display = '';
            document.getElementById('tePickAmount').value = '';
            const items = _readJson(isD ? 'daikou_discounts' : 'daikou_extras', []);
            _pickList = Array.isArray(items) ? items : [];
            html = _pickList.length
              ? _pickList
                  .map(
                    (x, i) =>
                      '<div class="modal-item" onclick="_te_pickItem(' +
                      i +
                      ')"><span class="modal-item-name">' +
                      _esc(x.name) +
                      '</span><span class="modal-item-price">' +
                      // 前に 保存した 負の 見本も 効く 額で 出す（値引きは 大きさ・マイナスの 追加料金は「使えません」）
                      (isD
                        ? _yen(Math.abs(Number(x.amount) || 0))
                        : Number(x.amount) < 0
                          ? '使えません（値引きで登録）'
                          : _yen(Number(x.amount) || 0)) +
                      '</span></div>'
                  )
                  .join('')
              : '<div class="modal-item" style="justify-content:center;color:#8e8e93">登録がありません（下の任意入力で足せます）</div>';
          }
          el.innerHTML = html;
          document.getElementById('tePickOverlay').classList.add('show');
        };
        let _pickList = [];

        window._te_pickClose = function () {
          document.getElementById('tePickOverlay').classList.remove('show');
        };

        window._te_pickItem = function (i) {
          if (!_cur) return;
          const x = _pickList[i];
          if (!x) return;
          if (_pickMode === 'note') {
            _cur.customerNote = x.name;
          } else if (_pickMode === 'customer') {
            _cur.customer = { customer_id: x.customer_id, customer_name: x.name };
            _cur.customerNote = null; // 会社を変えたら誰が乗ったかは消す（前の客のが残ったら事故）
          } else if (_pickMode === 'discount') {
            // ★値引きは 必ず 下げる・追加料金は 下げない★（10-11）
            _cur.discounts.push({ name: x.name, amount: Math.abs(Number(x.amount) || 0) });
          } else {
            if ((Number(x.amount) || 0) < 0) {
              if (typeof showToast === 'function')
                showToast('マイナスの 追加料金は 使えません（値引きで 登録してください）');
              return;
            }
            _cur.extras.push({ name: x.name, amount: Number(x.amount) || 0 });
          }
          window._te_pickClose();
          _te_render();
        };

        window._te_pickCustom = function () {
          if (!_cur) return;
          const v = Math.round(Number(document.getElementById('tePickAmount').value) || 0);
          if (v <= 0) return;
          if (_pickMode === 'discount') _cur.discounts.push({ name: '値引き', amount: v });
          else _cur.extras.push({ name: '追加料金', amount: v });
          window._te_pickClose();
          _te_render();
        };

        // ─── 直す（保存）───
        window._te_save = function () {
          if (!_cur || typeof TripEdit === 'undefined') return;
          // ★開いて いる 間に 業務終了・正午を 越えた 時は 保存しない（2026-10-22）★
          const nao = window._te_naoseru(_cur.tripKey);
          if (!nao.ok) {
            window._te_close();
            return _te_naosenai(nao.reason);
          }
          let r = null;
          try {
            r = TripEdit.apply({
              rideKey: _cur.rideKey,
              tripKey: _cur.tripKey,
              edit: {
                extras: _cur.extras,
                discounts: _cur.discounts,
                customer: _cur.customer,
                customerNote: _cur.customerNote || null, // 誰が乗ったか
                now: Date.now(),
              },
              readOnly: !!window._tabReadOnly,
            });
          } catch (_) {
            r = null; // 書けない（空きが 無い 等）＝知らせて 抜ける
          }
          if (
            r &&
            !r.ok &&
            r.reason &&
            r.reason !== 'hozon_dekinai' &&
            r.reason !== 'ride_not_found' &&
            r.reason !== 'bad_key'
          ) {
            window._te_close();
            return _te_naosenai(r.reason);
          }
          if (!r || !r.ok) {
            if (typeof window._showToast === 'function') window._showToast('直せませんでした');
            return;
          }
          window._te_close();
          try {
            if (typeof window._hist_render === 'function') window._hist_render();
          } catch (_) {}
          // 今の業務を直したなら、待機画面の集計も合わせる
          try {
            if (typeof updateBusinessDashboard === 'function') updateBusinessDashboard();
          } catch (_) {}
          // ★直しを事務所へ届ける★（送信済みの印は TripEdit が外している）
          let msg = '直しました　' + _yen(r.total);
          if (r.resend) {
            msg += '　事務所へ送り直します';
            try {
              if (window.JobSync && typeof JobSync.sync === 'function') JobSync.sync();
            } catch (_) {}
          } else if (!r.linkedToShift) {
            msg += '（この画面だけ）';
          }
          if (typeof window._showToast === 'function') window._showToast(msg);
        };
      })();

