      // ─── 確定ボタン（旧Send）───
      function onSend() {
        // ★センサーの許可は要求しない (2026-08-07・司さん指摘)★
        //   iPhoneは一度アプリを離れると許可が切れる。終わらせる操作で止めると詰む。
        if (appState === 'driving') {
          // Driving中に確定を押したら → 確定画面へ（カウントは継続）
          appState = 'fare';
          histSaved = false;
          _histHozonShippaiShirase = false; // 新しい 乗車＝保存の 失敗の 知らせを もう一度 出せる
          _kyouMiHozon = false;
          // ★支払タイミング latch (2026-05-30・司さん方針「支払時点 メーター=実距離=料金 厳密一致」)★:
          //   確定画面の料金は calcFare(display) で算出する。catch-up 途中だと display<実距離
          //   (= 過少方向・過大請求は出ないが厳密一致せず)。確定の瞬間に display=distance_m へ latch し
          //   メーター=実距離=料金 を一致させる。distance_m/calcFare 式は不変 (display 層のみ)。
          // ★2026-07-23 過大請求根治★: 確定後もメーターが動き続けて総額が伸びる問題を根治。
          //   freezeBilling で display latch に加えて distance_m の加算も停止(精算終了/走行に戻るまで)。
          if (typeof Meter.freezeBilling === 'function') Meter.freezeBilling();
          else if (typeof Meter.latchDisplay === 'function') Meter.latchDisplay();
          _saveMeterSnapshot(); // ★確定を すぐ 控えに 書く★（10-12・次の GPS の 前に 落ちても 確定が 戻る）
          const s = Meter.getState();
          // ★設計変更宣言 (2026-05-16・Step2・renderFare 計算式を startUiTimer と統一):
          //   旧: let fare = s.fare_yen (= state.fare_yen ・Tier 1 commit ベース)
          //   新: let fare = Meter.calcFare(distance_m + tier2_pending_m) (= 走行中表示と同一式)
          //   効果: 確定画面の合計料金が走行中表示と一致・「走行中 ¥1,800 → 確定時 ¥1,700」
          //         の乖離を解消。
          //   絶対ルール準拠:
          //     ・state.fare_yen / state.distance_m は完全不変
          //     ・「課金確定値」は依然 state.fare_yen に保持されている (= 確定時に変わらない)
          //     ・本変更は確定画面の「表示金額」だけ統一する
          //     ・FB.endSession へ送る total は本表示値ベース (= 客に見える金額 = サーバー送信値)
          // ★ Phase 3: display_distance_m を採用
          let fare = Meter.calcFare(s.display_distance_m || s.distance_m || 0);
          if (surchargeOn) fare = Math.round(fare * surchargeRate);
          let extraTotal = extras.reduce((a, b) => a + b.amount, 0);
          let total = Math.max(0, fare + extraTotal - _discountTotal());
          // ★設計変更宣言 (2026-05-15・経由地点 + 住所表示機能):
          //   確定ボタン押下時に到着地住所を取得し current_trip.end_address に保持する。
          //   renderFare が getCurrentTrip 経由で経路カードを描画する直前に呼ぶ必要がある。
          //   絶対ルール準拠: 住所取得失敗 (null) でも renderFare は実行され料金画面は表示される。
          try {
            if (typeof Business !== 'undefined' && typeof Business.setEndAddress === 'function') {
              const _lat = s.last_gps && typeof s.last_gps.lat === 'number' ? s.last_gps.lat : null;
              const _lng = s.last_gps && typeof s.last_gps.lng === 'number' ? s.last_gps.lng : null;
              Business.setEndAddress(_lat, _lng, null);
            }
          } catch (e) {
            console.error('Business setEndAddress error:', e);
          }
          // Firebaseにfinished送信（サブ機に料金表示）
          try {
            FB.endSession({
              distance_m: s.distance_m,
              fare_yen: total,
              elapsed_sec: s.elapsed_sec,
            });
            FB.updateVehicle({
              status: 'finished',
              session: {
                distance_m: Math.round(s.distance_m),
                fare_yen: total,
                elapsed_sec: s.elapsed_sec,
              },
            });
          } catch (e) {
            console.error(e);
          }
          renderFare(s, fare, extraTotal, total);
          showScreen('fare');
          document.getElementById('appbarTitle').textContent = '料　金';
        } else if (appState === 'fare') {
          // 確定画面で再押し → 何もしない（キャンセルで戻るだけ）
        }
      }

      // OSRM補正関数は削除（2026/04/26）
      // 理由：公開API依存ゼロ化・スケール無制限化・将来1000社規模でも安定
      // 代替：GPS + IMU融合エンジン（imu.js）で精度を保つ

      // ─── 画面暗転解除 ───
      function wakeScreen() {
        if (document.documentElement.style.filter === 'brightness(0)') {
          document.documentElement.style.filter = '';
          // タイマーリセット（もう5時間）
          if (dimTimer) {
            clearTimeout(dimTimer);
            dimTimer = null;
          }
          dimTimer = setTimeout(
            function () {
              document.documentElement.style.filter = 'brightness(0)';
            },
            DIM_MINUTES * 60 * 1000
          );
          // 走行中・確定中なら復帰補正を発火
          // ★設計変更宣言 (2026-05-23・Phase 1・page resume 時 単独 show 撤去・お節介ルール適用):
          //   旧: page resume 時に・「✅ 走行データを復元しました」単独 show + textContent
          //   新: _restoreDistanceM / _restoreFareYen は・保持 (= GPS 再取得後 補完検知に・必要)・
          //       banner show は・行わず・補完検知時 (= addedM > 0) のみ・初めて show する。
          if (appState === 'driving' || appState === 'fare') {
            const s = Meter.getState();
            window._restoreDistanceM = s.distance_m;
            window._restoreFareYen = s.fare_yen;
          }
        }
      }

      // ─── トースト通知 ───
      let _toastTimer = null; // ★単一#toast共有タイマー(重なり時の途中消え防止・対立監査P1)★
      function showToast(msg) {
        const t = document.getElementById('toast');
        // ★style初期化: showToastLong の左寄せ/13px/行間1.8 の残留を毎回クリア(対立監査P1)★
        t.style.whiteSpace = '';
        t.style.textAlign = '';
        t.style.fontSize = '';
        t.style.lineHeight = '';
        t.textContent = msg;
        t.classList.add('show');
        if (_toastTimer) clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => {
          t.classList.remove('show');
        }, 2000);
      }

      // ─── 長めのトースト（走行サマリー用・5秒・改行対応） ───
      function showToastLong(msg) {
        const t = document.getElementById('toast');
        t.style.whiteSpace = 'pre-line';
        t.style.textAlign = 'left';
        t.style.fontSize = '13px';
        t.style.lineHeight = '1.8';
        t.textContent = msg;
        t.classList.add('show');
        if (_toastTimer) clearTimeout(_toastTimer); // ★共有タイマー(重なり時の途中消え防止・対立監査P1)★
        _toastTimer = setTimeout(() => {
          t.classList.remove('show');
          t.style.whiteSpace = '';
          t.style.textAlign = '';
          t.style.fontSize = '';
          t.style.lineHeight = '';
        }, 5000);
      }

      // ─── 確定キャンセル：Drivingに戻る（カウント継続） ───
      function cancelFare() {
        // 全ボタン共通：センサー未許可ならバナー表示してブロック
        if (blockIfSensorNotGranted()) return;
        appState = 'driving';
        histSaved = false; // 再走行するので保存フラグリセット
        // ★2026-07-23★: 確定で凍結した課金距離を解除し再走行分を再び計上 (running は維持のまま)
        if (typeof Meter.unfreezeBilling === 'function') Meter.unfreezeBilling();
        _saveMeterSnapshot(); // ★走行に 戻った 事を すぐ 控えに 書く★（10-12・古い 確定で 戻らない）
        // Meterは止めていないのでresume不要
        try {
          FB.updateVehicle({ status: 'driving' });
        } catch (e) {
          console.error(e);
        }
        showScreen('driving');
        document.getElementById('appbarTitle').textContent = '代行中';
      }

      // ─── 割増トグル (旧式: 単一 surchargeOn) ───
      function toggleSurcharge() {
        surchargeOn = !surchargeOn;
        updateSurchargeBadge();
      }
      function updateSurchargeBadge() {
        const badge = document.getElementById('surchargeBadge');
        const appbar = document.getElementById('appbar');
        if (!surchargeEnabled) {
          badge.style.display = 'none';
          // ★青バー1段: 割増バッジ非表示時は通常(読みやすい)サイズへ戻す★
          if (appbar) appbar.classList.remove('appbar--surcharge');
          return;
        }
        badge.style.display = 'flex';
        // ★割増バッジが青バーに加わる分・バーを少し詰めて1段を死守(2026-06-20)★
        if (appbar) appbar.classList.add('appbar--surcharge');
        // デフォルトOFF：グレー、押してON：赤。★ON/OFFは色で示し文字は「割増」のみ(青バー1段死守・2026-06-20)★
        badge.style.background = surchargeOn ? '#FF3B30' : '#8E8E93';
        document.getElementById('surchargeLabel').textContent = '割増';
      }

      // ─── fareConfig v2 (2026-05-10): 動的 surcharge ボタン群 ───
      function renderSurchargeButtons() {
        const group = document.getElementById('surchargeGroup');
        const multEl = document.getElementById('surchargeMult');
        if (!group || typeof Meter === 'undefined') return;
        const cfg = typeof Meter.getFareConfig === 'function' ? Meter.getFareConfig() : null;
        if (!cfg || !Array.isArray(cfg.surcharges) || cfg.surcharges.length === 0) {
          group.classList.remove('show');
          return;
        }
        // ボタンを再描画
        // multiplier element 以外を全削除して再生成
        const multClone = multEl;
        group.innerHTML = '';
        const active =
          typeof Meter.getActiveSurcharges === 'function'
            ? new Set(Meter.getActiveSurcharges())
            : new Set();
        cfg.surcharges.forEach((s) => {
          if (!s || !s.id) return;
          const btn = document.createElement('button');
          btn.className = 'surcharge-btn' + (active.has(s.id) ? ' on' : '');
          btn.textContent = (s.name || '割増') + ' ×' + s.rate;
          if (active.has(s.id)) {
            btn.style.background = s.color || '#007AFF';
            btn.style.borderColor = s.color || '#007AFF';
          }
          btn.onclick = function () {
            if (typeof Meter.toggleSurcharge === 'function') Meter.toggleSurcharge(s.id);
            renderSurchargeButtons();
          };
          group.appendChild(btn);
        });
        group.appendChild(multClone);
        // multiplier 更新
        const mul =
          typeof Meter.getSurchargeMultiplier === 'function' ? Meter.getSurchargeMultiplier() : 1.0;
        if (multClone) multClone.textContent = '×' + mul.toFixed(2);
        // 業務中のみ表示
        const ms = typeof Meter.getState === 'function' ? Meter.getState() : null;
        if (ms && ms.running) group.classList.add('show');
        else group.classList.remove('show');
      }
      // 業務開始/終了時に再描画
      window.renderSurchargeButtons = renderSurchargeButtons;

      // ─── 追加料金モーダル ───
      function openExtraModal() {
        // 全ボタン共通：センサー未許可ならバナー表示してブロック
        if (blockIfSensorNotGranted()) return;
        const items = JSON.parse(localStorage.getItem('daikou_extras') || '[]');
        const el = document.getElementById('modalItems');
        el.innerHTML = items
          .map(
            (item, i) =>
              `<div class="modal-item" onclick="addExtra(${i})">
      <span class="modal-item-name">${item.name}</span>
      <span class="modal-item-price">${Number(item.amount) < 0 ? '使えません（値引きで登録）' : '+¥' + (Number(item.amount) || 0).toLocaleString()}</span>
    </div>`
          )
          .join('');
        document.getElementById('customAmount').value = '';
        document.getElementById('modalOverlay').classList.add('show');
      }

      function closeExtraModal() {
        document.getElementById('modalOverlay').classList.remove('show');
      }

