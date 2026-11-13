      // 待機画面の5項目ダッシュボード更新は updateBusinessDashboard()（上で定義済）が担当
      // 1秒ごとに自動更新中
      // ★設計変更宣言 (2026-05-15・経由地点 + 住所表示機能・UI 関数群):
      //   onWaypointBtn      : 経由地点ボタン押下 → Business.onWaypoint → トースト + UI 更新
      //   updateWaypointCardUI: waypointCard の件数バッジ・recorded クラスを current_trip と同期
      //   renderRouteCard    : screenFare の routeCard に start→waypoints→end を 「→」 連結描画
      //   _escapeHtmlForRoute: route-body に住所文字列を入れる際の XSS 対策 (innerHTML 経路)
      //   絶対ルール準拠: 住所取得失敗 (null) でも記録自体は実行・トーストでフィードバック・
      //                  代行開始/確定/経由記録のいずれも例外で止めない (try/catch で吸収)。
      function onWaypointBtn() {
        if (typeof blockIfSensorNotGranted === 'function' && blockIfSensorNotGranted()) return;
        if (appState !== 'driving') return;
        if (typeof Business === 'undefined' || typeof Business.onWaypoint !== 'function') return;
        // ★経由の前後の記録 (2026-11-13)★: 押した前後30秒を端末に残す（写すだけ・距離は触らない）
        //   司さん 11/11「経由を押したら距離が増えた」＝再現0 → 次に起きた時の数を残す。
        try {
          if (window.KeiyuKiroku && typeof window.KeiyuKiroku.mark === 'function')
            window.KeiyuKiroku.mark();
        } catch (_) {}
        let lat = null;
        let lng = null;
        try {
          const ms = Meter.getState();
          if (ms && ms.last_gps && typeof ms.last_gps.lat === 'number') {
            lat = ms.last_gps.lat;
            lng = ms.last_gps.lng;
          }
        } catch (_) {}
        let addr = null;
        try {
          addr = Business.onWaypoint(lat, lng, null);
        } catch (e) {
          console.error('[Business] onWaypoint error:', e);
        }
        if (typeof showToast === 'function') {
          if (addr) {
            showToast('✓ ' + addr + ' を記録しました');
          } else {
            showToast('⚠ 住所を取得できませんでした');
          }
        }
        try {
          if (navigator && typeof navigator.vibrate === 'function') navigator.vibrate(10);
        } catch (_) {}
        updateWaypointCardUI();
        // ★経由の前後の記録 (2026-11-13)★: 押した処理の長さ（ms）を付ける（js/keiyu-kiroku.js）
        try {
          if (window.KeiyuKiroku && typeof window.KeiyuKiroku.markEnd === 'function')
            window.KeiyuKiroku.markEnd();
        } catch (_) {}
      }
      function updateWaypointCardUI() {
        // ★設計変更宣言 (2026-05-16・waypointCard 表示拡張・出発地+経由地連結):
        //   wp-title を Business.getCurrentTrip() の start_address と waypoints から動的構築。
        //   ・出発地未取得: 「📍 出発地取得中...」
        //   ・経由 0 件 + 出発地あり: 「📍 ○○町 から出発」
        //   ・経由 N 件 + 出発地あり: 「📍 ○○町 → △△町 → ... 」(矢印連結)
        //   ・住所 null の項目は「⚠ 位置不明」と表示 (route-warn 風)
        //   wp-sub もカウントに応じて文言を変える ("タップで経由地点を追加（N件）")。
        //   startUiTimer (500ms) で毎回呼ばれるため retry で住所が遅延取得されても自動追従。
        const card = document.getElementById('waypointCard');
        const titleEl = document.getElementById('waypointTitle');
        const badge = document.getElementById('waypointBadge');
        const sub = document.getElementById('waypointSub');
        if (!card) return;
        let count = 0;
        let startAddr = null;
        let waypoints = [];
        try {
          if (typeof Business !== 'undefined' && typeof Business.getCurrentTrip === 'function') {
            const ct = Business.getCurrentTrip();
            if (ct) {
              startAddr = ct.start_address;
              if (Array.isArray(ct.waypoints)) {
                waypoints = ct.waypoints;
                count = waypoints.length;
              }
            }
          }
        } catch (_) {}

        // ★設計変更宣言 (2026-05-23・住所② 現在地ライブ表示・常時表示版・作り直し):
        //   wp-title の・末尾に・常時 「→ 📡 現在地住所(現在地)」を追記。
        //   Business.getCurrentLiveAddress() が・3 段 fallback (= snap fresh → snap stale → raw GPS)
        //   で・走行中も停止中も・町名レベルで・必ず返す。
        //   重複回避は・撤去 (= 「本町 → 本町(現在地)」 も・許容・「(現在地)」 サフィックスで自然)。
        //   出発地取得中 case は・「📍 出発地取得中... → 📡 ○○(現在地)」 と表示。
        let liveAddr = null;
        try {
          if (
            typeof Business !== 'undefined' &&
            typeof Business.getCurrentLiveAddress === 'function'
          ) {
            liveAddr = Business.getCurrentLiveAddress();
          }
        } catch (_) {
          // getCurrentLiveAddress 失敗・全 cache null 等 → null fallback (= 起動直後のみ)
        }

        // wp-title 構築
        if (titleEl) {
          const ESC = typeof _escapeHtmlForRoute === 'function' ? _escapeHtmlForRoute : String;
          const WARN = '<span class="route-warn">⚠ 位置不明</span>';
          const LIVE_SEP = ' <span class="route-sep">→</span> ';
          // 常時末尾表示 (= 重複回避なし)・「(現在地)」 サフィックスで自然
          // ★2026-07-18 司さん指示: 住所のアイコン(📍/📡)を除去
          const liveSuffix = liveAddr
            ? LIVE_SEP +
              '<span class="route-live">' +
              ESC(liveAddr) +
              '<span class="route-live-tag">(現在地)</span></span>'
            : '';
          if (!startAddr && count === 0) {
            // 代行開始直後で出発地住所がまだ取得できていない (retry 待ち)
            if (liveAddr) {
              titleEl.innerHTML = '出発地取得中...' + liveSuffix;
            } else {
              titleEl.textContent = '出発地取得中...';
            }
          } else if (count === 0) {
            titleEl.innerHTML = ESC(startAddr) + ' から出発' + liveSuffix;
          } else {
            // 出発地 → 経由 1 → 経由 2 → ... を矢印連結 + 末尾 現在地
            const parts = [];
            parts.push(startAddr ? ESC(startAddr) : WARN);
            for (const wp of waypoints) {
              const a = wp && wp.address;
              parts.push(a ? ESC(a) : WARN);
            }
            titleEl.innerHTML = parts.join(' <span class="route-sep">→</span> ') + liveSuffix;
          }
        }

        // wp-sub / .recorded / badge
        // ★設計変更宣言 (2026-05-23・「タップ」 だけ赤文字・誘目強化):
        //   wp-sub 内の・先頭 カタカナ 「タップ」 を <span class="wp-sub-tap">…</span> で・赤強調。
        //   配色: #e11d48 (= rose-600・hex 直値・CSS 変数禁止ルール準拠)。
        if (count > 0) {
          card.classList.add('recorded');
          if (sub) {
            sub.innerHTML =
              '<span class="wp-sub-tap">タップ</span>で経由地点を追加（' + count + '件）';
          }
        } else {
          card.classList.remove('recorded');
          if (sub) {
            sub.innerHTML = '<span class="wp-sub-tap">タップ</span>で現在地の住所を記録';
          }
        }
        if (badge) badge.textContent = String(count);
      }
      function _escapeHtmlForRoute(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
      }
      function renderRouteCard() {
        const card = document.getElementById('routeCard');
        const body = document.getElementById('routeCardBody');
        if (!card || !body) return;
        let trip = null;
        try {
          if (typeof Business !== 'undefined' && typeof Business.getCurrentTrip === 'function') {
            trip = Business.getCurrentTrip();
          }
        } catch (_) {}
        if (!trip) {
          card.style.display = 'none';
          return;
        }
        const startAddr = trip.start_address;
        const endAddr = trip.end_address;
        // 両端 (start/end) とも null → 経路カードを非表示 (合計料金の主役を維持)
        if (!startAddr && !endAddr) {
          card.style.display = 'none';
          return;
        }
        const parts = [];
        parts.push(
          startAddr ? _escapeHtmlForRoute(startAddr) : '<span class="route-warn">⚠ 位置不明</span>'
        );
        if (Array.isArray(trip.waypoints)) {
          trip.waypoints.forEach((wp) => {
            const a = wp && wp.address;
            parts.push(a ? _escapeHtmlForRoute(a) : '<span class="route-warn">⚠ 位置不明</span>');
          });
        }
        parts.push(
          endAddr ? _escapeHtmlForRoute(endAddr) : '<span class="route-warn">⚠ 位置不明</span>'
        );
        body.innerHTML = parts.join('<span class="route-sep">→</span>');
        card.style.display = 'flex';
      }

      function renderFare(s, fare, extraTotal, total) {
        document.getElementById('fareTotalAmount').textContent = total.toLocaleString();
        // ★設計変更宣言 (2026-05-15・経由地点 + 住所表示機能):
        //   Business.getCurrentTrip() から経路を描画。両端 null 時は内部で非表示にする。
        try {
          renderRouteCard();
        } catch (e) {
          console.error('[RouteCard] render error:', e);
        }
        const cfg = Meter.getFareConfig();
        // ★設計変更宣言 (2026-05-16・Step2・renderFare 表示値を Tier 2 込みに統一):
        //   旧: 走行距離 = s.distance_m / 距離料金 = s.fare_yen - base_fare
        //       (= Tier 1 のみ・走行中の driveDist / driveFare との乖離発生)
        //   新: 走行距離 = (s.distance_m + s.tier2_pending_m)
        //       距離料金 = calcFare(distance_for_calc) - base_fare
        //   効果: 走行中表示と確定画面の整合性確保
        //   絶対ルール準拠:
        //     ・state.distance_m / state.fare_yen / calcFare は不変
        //     ・onSend 側の fare 引数も同じ式 (Step2 で統一済)
        //     ・「課金確定値」は state.distance_m ベースで Meter 内に保持されたまま
        // ★ Phase 3: display_distance_m (= Reconciliation 同期値) を採用
        const distance_for_calc = s.display_distance_m || s.distance_m || 0;
        const rawFareForDisplay = Meter.calcFare(distance_for_calc);
        // ★2026-07-18 司さん指示: 走行距離は合計料金の隣/下に大表示(fareDist)。内訳からは除外(重複回避)。
        const _fd = document.getElementById('fareDist');
        if (_fd) _fd.textContent = (distance_for_calc / 1000).toFixed(2);
        let html = '';
        html += row('経過時間', Math.floor(s.elapsed_sec / 60) + '分');
        html += '<hr class="breakdown-divider">';
        html += row('基本料金', '¥' + cfg.base_fare.toLocaleString());
        html += row('距離料金', '¥' + (rawFareForDisplay - cfg.base_fare).toLocaleString());
        if (surchargeOn) {
          const diff = fare - rawFareForDisplay;
          html += row('割増', '+¥' + diff.toLocaleString(), 'surcharge');
        }
        extras.forEach((e) => {
          html += row(e.name, '+¥' + e.amount.toLocaleString(), 'extra');
        });
        if (Array.isArray(discounts)) {
          discounts.forEach((d) => {
            html += row(d.name, '-¥' + (d.amount || 0).toLocaleString(), 'discount');
          });
        }
        document.getElementById('breakdown').innerHTML = html;

        // 今日の実績・履歴は1回だけ保存
        // ★設計変更宣言 (2026-05-23・履歴3個重複バグ修正・A 案 trip_key 冪等化):
        //   旧: histSaved=false が・cancelFare で reset → 「確定 → 走行に戻る → 再確定」
        //       反復で・hist.push が・N 回 走り・3 個重複・todayFareYen 水増し。
        //   新: hist entry に・trip_key (= current_trip.start_time) を付与・直前 entry の
        //       trip_key と一致なら・上書き update (= 同一 trip の・再確定 = 最新値)。
        //       todayDist / todayCount / todayFareYen も・差分 計算で・水増し防止。
        //   絶対ルール準拠:
        //     ✓ distance_m / calcFare / Meter.reset / state.trips (business.js) は・1 byte も・触らない
        //     ✓ hist (= daikou_history) の・保存 logic のみ変更
        //     ✓ trip_key 欠落 既存 entry は・「別 trip 扱い」自然 fallback (= 後方互換)
        //   既存 3 個重複 entry の・cleanup は・別 STOP (= 誤判定リスク回避・修正 1+2 先行)
        if (!histSaved) {
          // ★保存済みの 印は 書けた 時だけ 立てる★（_jouShaKirokuHozon の 返事で・先に 立てると 途中で 転んだ 時に 黙る）
          const now = new Date();
          // ★2026-07-04 日跨ぎ業務を割らない (司さん指示)★: 履歴の日付キーは「精算時刻」でなく
          //   ★業務(セッション)開始日★で統一する。=業務開始〜業務終了の全乗車が同じ日セクションに入る
          //   (旧: now.toDateString()=精算時刻の日付→深夜0時跨ぎで同一業務が前日/当日に割れていた)。
          //   業務開始時刻 = Business.getState().start_time(business.js state.start_time)。未取得は now に fallback。
          let _bizStartTs = null;
          try {
            _bizStartTs =
              typeof Business !== 'undefined' && Business.getState
                ? Business.getState().start_time
                : null;
          } catch (_) {
            _bizStartTs = null;
          }
          const _keyDate =
            typeof _bizStartTs === 'number' && _bizStartTs > 0 ? new Date(_bizStartTs) : now;
          const histKey = 'daikou_history_' + _keyDate.toDateString();
          // ★読めない 履歴（壊れた 字・配列でない）は 書けない 時と 同じに 扱う★（黙らない・転ばない）
          let hist = null;
          try {
            hist = JSON.parse(localStorage.getItem(histKey) || '[]');
          } catch (_) {
            hist = null;
          }
          if (!Array.isArray(hist)) hist = null;
          // ★設計変更宣言 (2026-05-16・履歴画面 経路表示・hist エントリに住所追加):
          //   Business.getCurrentTrip() から start_address / waypoints / end_address を取得し
          //   hist エントリに保存。null フィールドは undefined のまま保存 (_hist_render が
          //   未取得時は表示スキップ判定する)。住所取得失敗でも distance/fare は保存される
          //   (絶対ルール: 業務継続性最優先)。
          let _trip = null;
          try {
            if (typeof Business !== 'undefined' && typeof Business.getCurrentTrip === 'function') {
              _trip = Business.getCurrentTrip();
            }
          } catch (_) {
            // Business 未 load 等 → trip null fallback
          }
          const newEntry = {
            time:
              now.getHours().toString().padStart(2, '0') +
              ':' +
              now.getMinutes().toString().padStart(2, '0'),
            // ★設計変更宣言 (2026-06-20・履歴に時刻表示): 開始/経由/清算終了 の時刻を保存。
            //   start_time = 代行開始ボタン押下時刻 (onTripStart)・end_time = 清算確定時刻 (=now)。
            //   waypoints[].timestamp = 経由地点ボタン押下時刻。旧 entry に無ければ render 側で
            //   ride.time (HH:MM) に fallback (後方互換)。距離/課金は不可侵 (表示専用)。
            start_time: _trip && _trip.start_time ? _trip.start_time : null,
            end_time: now.getTime(),
            distance_m: Math.round(s.distance_m),
            fare: total,
            // ★あとから直せるように、内訳を残す (2026-08-05)★
            //   司さん「その業務押したら追加料金や値引きや請求書などちゃんと編集できな」
            //   ★meter_fare = 走った分の料金(割増を掛けたあと)★
            //   これが無いと、直す時に「合計から戻し計算」しか出来ず、
            //   値引きが入っていた古い履歴で走った分を取り違える。
            meter_fare: fare,
            surcharge: surchargeOn,
            extras: [...extras],
            discounts: Array.isArray(discounts) ? [...discounts] : [], // ★今まで残していなかった★
            // ★請求先も残す★（履歴から付け替えできるように）
            customer_id: _trip ? _trip.customer_id || null : null,
            customer_name: _trip ? _trip.customer_name || null : null,
            customer_note: _trip ? _trip.customer_note || null : null, // 誰が乗ったか
            start_address: _trip ? _trip.start_address || null : null,
            end_address: _trip ? _trip.end_address || null : null,
            waypoints:
              _trip && Array.isArray(_trip.waypoints)
                ? _trip.waypoints.map(function (w) {
                    return {
                      address: (w && w.address) || null,
                      timestamp: w && w.timestamp ? w.timestamp : null,
                    };
                  })
                : [],
            // ★ trip_key: current_trip.start_time (= 1 trip の・unique id)
            //   反復確定で・同 key → 上書き update / 別 trip → 別 key で push
            trip_key: _trip && _trip.start_time ? _trip.start_time : null,
          };
          const r = hist
            ? _historyDedupeUpsert(
                hist,
                newEntry,
                { dist: todayDist, count: todayCount, fareYen: todayFareYen },
                s.distance_m,
                total
              )
            : null;
          // ★乗車の 記録の 保存は _jouShaKirokuHozon に 任せる★（10-11・書けた 物だけ 手元の 合計に 映す）
          const st = r
            ? _jouShaKirokuHozon(localStorage, histKey, r, lastGoodTotalM)
            : { kekka: 'rireki-dame', susumeru: false, histSaved: false, kyouMiHozon: false };
          if (st.susumeru) {
            todayDist = r.today.dist;
            todayCount = r.today.count;
            todayFareYen = r.today.fareYen;
          }
          histSaved = st.histSaved;
          _kyouMiHozon = st.kyouMiHozon;
          if (st.kekka === 'ok') _histHozonShippaiShirase = false;
          else if (!_histHozonShippaiShirase) {
            _histHozonShippaiShirase = true;
            showToastLong(
              st.kekka === 'rireki-dame'
                ? 'この 乗車の 履歴が 保存できませんでした（端末の 空きが 足りない 等）。\n今日の 合計には まだ 足していません。この 画面の 間は もう一度 書きます。'
                : '今日の 合計が 保存できませんでした（端末の 空きが 足りない 等）。\n乗車の 履歴は 残っています。この 画面の 間は もう一度 書きます。'
            );
          }
        } else if (_kyouMiHozon) {
          // 履歴は 書けて 今日の 合計だけ 転んだ＝今日の 合計だけ 書き直す
          if (_kyouWoKaku(localStorage, todayDist, todayCount, todayFareYen, lastGoodTotalM))
            _kyouMiHozon = false;
        }
      }
