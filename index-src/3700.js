      // ★設計変更宣言 (2026-05-14・MA-5 history overlay 動作 JS):
      //   元 history.html の <script> ロジック (本日の trip を localStorage から読込・描画) を
      //   index.html に取り込み。daikou_history_<today.toDateString()> を読み、
      //   summary-card + ride-list を動的構築する。
      //   公開関数は window._hist_render に attach し、showOverlay('history') 経路から
      //   呼び出して overlay 表示時に最新データへ再描画する (session 中の onTripEnd で
      //   localStorage 追記された分も即時反映)。
      //   元 history.html の load() は DOMContentLoaded 直後に 1 回だけ呼ばれていたが、
      //   overlay は表示の都度 fresh data が要るので呼出契機を「showOverlay 時」に変更。
      (function () {
        function _hist_render() {
          const wrap = document.getElementById('_hist_wrap');
          const emptyMsg = document.getElementById('_hist_emptyMsg');
          if (!wrap || !emptyMsg) return;
          // 既存の dynamic 追加 (date-header / summary-card / ride-list) を一旦撤去し emptyMsg だけ残す
          Array.prototype.slice.call(wrap.children).forEach(function (ch) {
            if (ch !== emptyMsg) wrap.removeChild(ch);
          });
          emptyMsg.style.display = 'flex';

          // ★設計変更宣言 (2026-06-06・司さん指示「全業務記録」・日跨ぎ対応):
          //   旧: 今日の daikou_history_<日付> キー 1 つだけ読み込み → 日付をまたぐと前夜分が見えなかった。
          //   新: 保持中の全 daikou_history_<日付> キーをマージし、日付セクション(新しい日が上・各日内は
          //       保存順=時系列)で表示。上部 summary は表示中の全 ride を合算。
          const PREFIX_FOR_EDIT = 'daikou_history_'; // 直す時に使う鍵の前半
          let buckets = [];
          try {
            const PREFIX = 'daikou_history_';
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (!k || !k.startsWith(PREFIX)) continue;
              let arr = [];
              try {
                arr = JSON.parse(localStorage.getItem(k) || '[]');
              } catch (_) {
                arr = [];
              }
              if (!Array.isArray(arr) || arr.length === 0) continue;
              const ds = k.slice(PREFIX.length);
              const t = Date.parse(ds);
              buckets.push({ dateStr: ds, t: Number.isFinite(t) ? t : 0, rides: arr });
            }
          } catch (e) {
            if (typeof dlog === 'function')
              dlog('[History] localStorage 読込エラー: ' + (e && e.message));
            return;
          }
          if (buckets.length === 0) return;
          buckets.sort(function (a, b) {
            return b.t - a.t;
          }); // 新しい日が上

          emptyMsg.style.display = 'none';

          const days = ['日', '月', '火', '水', '木', '金', '土'];
          function _fmtDateHeader(t, fallback) {
            const d = Number.isFinite(t) && t > 0 ? new Date(t) : null;
            if (!d) return fallback || '';
            return (
              d.getFullYear() +
              '年' +
              (d.getMonth() + 1) +
              '月' +
              d.getDate() +
              '日（' +
              days[d.getDay()] +
              '）'
            );
          }

          // ★2026-07-04 司さん指示: サマリー(走行回数/総距離/総売上)を「その日ごと」に★
          //   (旧: 表示中の全 ride=30日ぶんを合算していた → 各日セクションにその日の合算を出す)。
          function _daySummaryHtml(rides) {
            const cnt = rides.length;
            const dist = rides.reduce(function (a, b) {
              return a + (b.distance_m || 0);
            }, 0);
            const fare = rides.reduce(function (a, b) {
              return a + (b.fare || 0);
            }, 0);
            return (
              '<div class="summary-item"><div class="summary-label">走行回数</div>' +
              '<div class="summary-value">' +
              cnt +
              '<span class="summary-unit">回</span></div></div>' +
              '<div class="summary-item"><div class="summary-label">総距離</div>' +
              '<div class="summary-value">' +
              (dist / 1000).toFixed(1) +
              '<span class="summary-unit">km</span></div></div>' +
              '<div class="summary-item"><div class="summary-label">総売上</div>' +
              '<div class="summary-value" style="color:#111;">¥' +
              fare.toLocaleString() +
              '</div></div>'
            );
          }

          // ★設計変更宣言 (2026-05-16・履歴画面 経路表示):
          //   ride.start_address / end_address / waypoints[] が記録されている ride のみ
          //   ride-left 内に経路行を追加表示 (「南江戸町 → 道後温泉 → 三津浜」形式)。
          //   start/end 両方 null の古い ride は経路行を表示しない (= 既存 UI と同じ)。
          //   null 個別項目は ⚠ 位置不明 (route-warn) でレンダリング。
          //   XSS 対策: 住所文字列は _escapeHtmlForRoute で escape する。
          function _histEscape(s) {
            if (typeof _escapeHtmlForRoute === 'function') return _escapeHtmlForRoute(s);
            return String(s).replace(/[&<>"']/g, function (c) {
              return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
          }
          function _buildRouteHtml(ride) {
            const startAddr = ride && ride.start_address;
            const endAddr = ride && ride.end_address;
            if (!startAddr && !endAddr) return ''; // 旧 ride or 完全 miss → 経路行非表示
            const WARN = '<span class="route-warn">⚠ 位置不明</span>';
            const parts = [];
            parts.push(startAddr ? _histEscape(startAddr) : WARN);
            if (Array.isArray(ride.waypoints)) {
              ride.waypoints.forEach(function (wp) {
                const a = wp && wp.address;
                parts.push(a ? _histEscape(a) : WARN);
              });
            }
            parts.push(endAddr ? _histEscape(endAddr) : WARN);
            return (
              '<div class="ride-route">' + parts.join('<span class="route-sep">→</span>') + '</div>'
            );
          }
          // ★設計変更宣言 (2026-06-20・履歴に時刻表示): 開始/経由/清算終了 の時刻行を作る。
          //   ms → "HH:MM"。旧 entry (start_time/end_time/waypoint.timestamp 無し) は
          //   ride.time(HH:MM・清算時刻) 1個に fallback して後方互換を保つ。
          function _fmtClock(ms) {
            if (!ms || !Number.isFinite(ms)) return null;
            const d = new Date(ms);
            return (
              String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
            );
          }
          function _buildTimesHtml(ride) {
            const start = _fmtClock(ride.start_time);
            const end = _fmtClock(ride.end_time);
            const wpTimes = Array.isArray(ride.waypoints)
              ? ride.waypoints.map(function (w) {
                  return _fmtClock(w && w.timestamp);
                })
              : [];
            const hasWp = wpTimes.some(Boolean);
            if (!start && !end && !hasWp) {
              // 旧 entry: 清算時刻 (ride.time) のみ表示
              return ride.time
                ? '<div class="ride-times"><span class="t-seg"><span class="t-lbl">終了</span>' +
                    _histEscape(ride.time) +
                    '</span></div>'
                : '';
            }
            const seg = function (lbl, val, cls) {
              return (
                '<span class="t-seg ' +
                (cls || '') +
                '"><span class="t-lbl">' +
                lbl +
                '</span>' +
                val +
                '</span>'
              );
            };
            const segs = [];
            if (start) segs.push(seg('開始', start, ''));
            wpTimes.forEach(function (t) {
              if (t) segs.push(seg('経由', t, 't-wp'));
            });
            if (end) segs.push(seg('終了', end, ''));
            return (
              '<div class="ride-times">' + segs.join('<span class="t-arrow">→</span>') + '</div>'
            );
          }
          buckets.forEach(function (bucket) {
            const dateHeader = document.createElement('div');
            dateHeader.className = 'date-header';
            dateHeader.textContent = _fmtDateHeader(bucket.t, bucket.dateStr);
            wrap.appendChild(dateHeader);
            // ★2026-07-04: その日ごとのサマリー(走行回数/総距離/総売上)を日付ヘッダ直下に★
            const daySummary = document.createElement('div');
            daySummary.className = 'summary-card';
            daySummary.innerHTML = _daySummaryHtml(bucket.rides);
            wrap.appendChild(daySummary);
            const list = document.createElement('div');
            list.className = 'ride-list';
            // ★2026-07-04 並び順: 最近の乗車を1番上に (司さん指示)★。保存は時系列(古→新)なので
            //   ★逆順で描画★=新しい乗車が上。回目(N回目)は保存順のindex(j+1)で時系列を維持(1回目=その日の最初)。
            for (let j = bucket.rides.length - 1; j >= 0; j--) {
              const ride = bucket.rides[j];
              const i = j; // 回目=時系列(保存順)。表示は逆順でも回目は不変。
              const item = document.createElement('div');
              item.className = 'ride-item';
              // ★押したら直せる (2026-08-05・司さん指示)★
              //   trip_key が無い古い履歴は突き合わせられないので押せなくする
              //   （押せてしまうと「直したのに反映されない」が起きる）。
              // ★2026-10-22 司さん「運転手の修正はその日の営業だけ」＝業務中・その日の 代行だけ 押せる★
              //   判じは js/trip-edit.js の naoseru 1か所（開く 時・保存の 時も 同じ 物）
              if (
                ride.trip_key &&
                typeof window._te_naoseru === 'function' &&
                window._te_naoseru(ride.trip_key).ok
              ) {
                item.className += ' tappable';
                item.dataset.tripKey = String(ride.trip_key);
                item.dataset.rideKey = PREFIX_FOR_EDIT + bucket.dateStr;
              }
              let extrasText = '';
              if (ride.extras && ride.extras.length > 0) {
                extrasText = ride.extras
                  .map(function (e) {
                    return _histEscape(e.name) + ' +¥' + (e.amount || 0).toLocaleString();
                  })
                  .join('　');
              }
              // ★値引き・請求先も出す (2026-08-05)★ 直せるようにした以上、見えないと直したか分からない
              if (Array.isArray(ride.discounts) && ride.discounts.length > 0) {
                extrasText =
                  (extrasText ? extrasText + '　' : '') +
                  ride.discounts
                    .map(function (d) {
                      return (
                        '<span class="r-d">' +
                        _histEscape(d.name) +
                        ' -¥' +
                        (d.amount || 0).toLocaleString() +
                        '</span>'
                      );
                    })
                    .join('　');
              }
              if (ride.customer_id && ride.customer_name) {
                extrasText =
                  (extrasText ? extrasText + '　' : '') +
                  '<span class="r-i">請求書: ' +
                  _histEscape(ride.customer_name) +
                  // ★誰が乗ったか (2026-08-05)★ 出ていないと選び忘れに気づけない
                  (ride.customer_note ? '（' + _histEscape(ride.customer_note) + '）' : '') +
                  '</span>';
              }
              if (ride.surcharge) extrasText = (extrasText ? extrasText + '　' : '') + '割増あり';
              if (ride.edited_at)
                extrasText =
                  (extrasText ? extrasText + '　' : '') +
                  '<span class="ride-edited">修正済み</span>';
              const routeHtml = _buildRouteHtml(ride);
              const timesHtml = _buildTimesHtml(ride);
              // ★2026-07-05 司さん指示: 走行(距離)を左下→右カラム(金額の上)へ移動=右で距離/金額を縦バランス。
              //   左は 回目/時刻/住所 になり余白が空く→住所(.ride-route)を大きく表示(CSS側)。
              item.innerHTML =
                '<div class="ride-left">' +
                '<div class="ride-num">' +
                (i + 1) +
                '回目</div>' +
                timesHtml +
                (extrasText ? '<div class="ride-extras">' + extrasText + '</div>' : '') +
                routeHtml +
                '</div>' +
                '<div class="ride-right">' +
                '<div class="ride-dist"><b>' +
                ((ride.distance_m || 0) / 1000).toFixed(2) +
                '</b> km</div>' +
                '<div class="ride-fare">¥' +
                (ride.fare || 0).toLocaleString() +
                '</div>' +
                '</div>';
              list.appendChild(item);
            }
            wrap.appendChild(list);
          });
          if (typeof dlog === 'function')
            dlog(
              '[History] render: ' +
                buckets.reduce(function (a, b) {
                  return a + b.rides.length;
                }, 0) +
                ' rides / ' +
                buckets.length +
                ' days'
            );
        }
        window._hist_render = _hist_render;

        // ★履歴の代行を押したら直すシートを開く (2026-08-05・司さん指示)★
        //   1件ずつに onclick を書かず、親で受ける（描き直しても効き続ける）。
        document.addEventListener('click', function (ev) {
          try {
            const item = ev.target && ev.target.closest && ev.target.closest('.ride-item.tappable');
            if (!item) return;
            if (!document.getElementById('overlayHistory').contains(item)) return;
            if (typeof window._te_open === 'function') {
              window._te_open(item.dataset.rideKey, Number(item.dataset.tripKey));
            }
          } catch (_) {
            /* 履歴表示は絶対に止めない */
          }
        });
      })();

