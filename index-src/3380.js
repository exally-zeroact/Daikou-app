      // ─── #1+6 (2026-05-13): GPS error 状態を gpsAcc バッジに反映 ────────────
      // ★設計変更宣言 (2026-05-13):
      //   旧: GPS callback (L2371) 成功時のみ badge を「精度Xm」に更新
      //       denied / unavailable / timeout 等で callback 不発時は「GPS待機」のまま固まり
      //       ユーザに何が起きたか伝わらない (= 残バグ #1+6)
      //   新: GPS.onStatusChange でエラー状態を badge に反映
      //       granted は既存 callback が「精度Xm」を入れるので触らない
      //       (state.distance_m / fare_yen / GPS state machine への影響なし・UI 表示のみ)
      (function () {
        if (typeof GPS === 'undefined' || !GPS.onStatusChange) return;
        GPS.onStatusChange(function (s) {
          // ★繋がってるかはドット色だけで示す(司さん指示・精度数字/エラー文言は出さない)。
          //   エラー時はドットを淡色(gps-dot=未接続)に戻し、理由は title(長押しヒント)に持たせる。
          const dot = document.getElementById('gpsDot');
          if (!dot || !s || !s.state) return;
          if (s.state === 'denied' || s.state === 'unavailable' || s.state === 'timeout') {
            dot.className = 'gps-dot'; // 淡色=未接続/不良
            dot.title =
              s.state === 'denied'
                ? 'GPS拒否'
                : s.state === 'unavailable'
                  ? 'GPS信号弱'
                  : 'GPS待機中';
          }
          // granted: 既存 callback が dot を 'gps-dot ok'(緑)+ title 精度 に更新するので何もしない
        });
      })();

      // 業務終了時の GPS 停止（D案・2026/05/06）
      //   - watchPosition を解除（バッテリー節約）
      //   - DeviceMotion / DeviceOrientation のリスナー自体は残したまま、
      //     gps.js 側の _isBizActive=false でデータ蓄積をスキップする
      //     （iOS PWA で remove → re-add すると2回目以降センサーが動かないため）
      //   - gpsStarted を false に戻すことで、resume 時の startGPS() が再実行できる
      function stopGPS() {
        if (!gpsStarted) {
          if (typeof dlog === 'function') dlog('[GPS] stopGPS: 既に停止済（スキップ）');
          return;
        }
        gpsStarted = false;
        if (typeof dlog === 'function') dlog('[GPS] stopGPS: watchPosition 解除');
        try {
          GPS.stop();
        } catch (e) {
          console.error('GPS stop error:', e);
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      //  距離 / 料金メーター読み出し部 (白紙書き直し・2026-05-30・clean-rebuild-pipeline)
      // ───────────────────────────────────────────────────────────────────
      //  ★表示契約 (= getState() を唯一の信源とする)★
      //    driveDist  = Meter.getState().display_distance_m  (滑らか 10m 先取り表示)
      //    driveFare  = Meter.calcFare(display_distance_m) + surcharge + extras
      //    totalDist  = Business.getReport().total_distance_m
      //                 (= Meter.business_display_distance_m を信源とする業務滑らか総走行)
      //  ★絶対不可侵★ display は表示専用。本読み出し部は distance_m (課金値) を一切
      //    読み替えず・課金経路にも一切書き込まない (= read-only)。display_distance_m は
      //    getState 内の予測補間で distance_m を最大 10m 滑らかに先取りする (= 採択済の
      //    「10m 先取り」契約・project_daikome_display_interp.md)。最終課金額は
      //    calcFare(distance_m) で確定し distance_m は不可侵。
      //  ★並列統合フェーズの参照表示 (= 旧「新計測」span) は本白紙版に存在しない★
      //
      //  _renderMeterReadout(): driveDist / driveFare / totalDist を 1 回読み出す共通関数。
      //    textContent 前回値比較で無駄 DOM 書込を skip する。rAF (60Hz) と
      //    setInterval (100ms) の双方から呼ぶが、比較 skip で二重書込のコストはゼロ。
      // cachedState: 呼出側 (_rafDisplayTick) が同一 tick で既に取得済の getState 戻り値。
      //   渡された場合は再取得しない (= getState の二重呼出 / 補間二重前進を防ぐ・値は完全同一)。
      function _renderMeterReadout(cachedState) {
        if (typeof Meter === 'undefined' || typeof Meter.getState !== 'function') return;
        const s = cachedState || Meter.getState();

        // 表示距離 = catch-up display (= distance_m へ「下から」滑らかに追従・★実距離を超えない★)。
        // ★司さん確定方針 (2026-05-30)★: display ≤ distance_m (overshoot ゼロ)。停車/確定で
        //   latch し display = distance_m に一致。課金は calcFare(display) だが display ≤ 実距離
        //   ゆえ過大請求は起きず、latch により支払時 メーター=実距離=料金 が一致する。
        // ここでの fallback (|| s.distance_m) は getState が display を未算出の極初期のみ。
        const displayDistM = s.display_distance_m || s.distance_m || 0;

        // driveDist
        const distKm = (displayDistM / 1000).toFixed(2);
        if (distKm !== _lastDriveDistKm) {
          const elDist = document.getElementById('driveDist');
          if (elDist) elDist.textContent = distKm;
          _lastDriveDistKm = distKm;
        }

        // driveFare = calcFare(display) + surcharge + extras (= 表示専用再計算・calcFare 不変)
        let fare = Meter.calcFare(displayDistM);
        if (typeof surchargeOn !== 'undefined' && surchargeOn) {
          fare = Math.round(fare * surchargeRate);
        }
        const extraTotal =
          typeof extras !== 'undefined' && Array.isArray(extras)
            ? extras.reduce((a, b) => a + b.amount, 0)
            : 0;
        const fareStr = Math.max(0, fare + extraTotal - _discountTotal()).toLocaleString();
        if (fareStr !== _lastDriveFareYen) {
          const elFare = document.getElementById('driveFare');
          if (elFare) elFare.textContent = fareStr;
          _lastDriveFareYen = fareStr;
        }

        // totalDist = 業務総走行 (= business_display_distance_m 信源・getReport 経由)
        if (typeof Business !== 'undefined' && typeof Business.getReport === 'function') {
          try {
            const r = Business.getReport();
            const totalDistKm = ((r.total_distance_m || 0) / 1000).toFixed(2);
            if (totalDistKm !== _lastTotalDistKm) {
              const elTotal = document.getElementById('totalDist');
              if (elTotal) elTotal.textContent = totalDistKm;
              _lastTotalDistKm = totalDistKm;
            }
          } catch (_) {
            /* Business.getReport 失敗・graceful skip */
          }
        }
      }

      // ─── rAF 描画ループ (= 60Hz 滑らか化・読み出しは _renderMeterReadout 一本化) ───
      //   getState 内予測補間は now=Date.now() ベースで rAF 高頻度でも滑らか連続。
      //   表示不変時は textContent 比較で DOM 書込ゼロ。★課金経路 1 byte 不変★
      function _rafDisplayTick() {
        try {
          // ★⑤ 適応間引き★: 速度変化が小さい局面は最大 4Hz に間引く (= CPU/発熱低減)。
          //   加減速 (= 速度変化大) の局面は full rate (60Hz) 描画で滑らかさを保つ。
          //   ★距離値・getState には skip frame で一切触れない (= 表示読み出し層のみ・CPU 節約)。
          //   getState 予測補間は now ベースのため frame skip しても次描画で時間差を吸収し連続表示。
          const nowMs = Date.now();
          const sinceMs = nowMs - _dispLastRenderMs;
          // ★走行中 (running=true) は間引き無効 = full rAF 60Hz★ (2026-05-30・「止まって動いて」
          //   脈動の根治): 等速ペース catch-up で display が 1 秒かけて滑らかに進むため、4Hz 間引き
          //   は連続移動を階段化 (= 脈動増幅) する。走行中は毎 frame 描画して滑らかさを最優先する。
          //   間引き (CPU/発熱低減) は ★停車中 / 省電力 (= running=false)★ の時だけ適用する。
          //   ★距離値・getState・calcFare には一切触れない (= 表示読み出し頻度のみの変更)★。
          // ★getState は本 tick で 1 回だけ取得★ (2026-05-30・MINOR 省電力修正): running 判定と
          //   描画 (_renderMeterReadout) で同一戻り値を共有し二重呼出を排除 (render frame で従来 2 回
          //   → 1 回)。getState 内補間は now ベースで 1 tick = 1 回前進ゆえ値・表示は完全不変
          //   (= 検証済 bit/overshoot/脈動 結果に影響なし・純粋な無駄呼出削減)。
          const st =
            typeof Meter !== 'undefined' && typeof Meter.getState === 'function'
              ? Meter.getState()
              : null;
          const isRunning = !!(st && st.running);
          // ★監査M6: 業務(課金)走行中フラグを汎用globalへミラー。obd-client(距離コア非依存・Meter非参照)が
          //   これを見てCAN輪速メーター/プローブの業務中起動を弾く=課金距離源(OBD速度)をATMAで止めない。
          window.OBD_BUSINESS_RUNNING = isRunning;
          // 直近 ★描画 frame★ の表示距離から proxy 速度 (km/h) を算出し、その変化で間引き判定。
          const dtH = sinceMs / 3600000;
          // _renderMeterReadout が更新する _lastDriveDistKm (= 文字列 km) を数値化して使う。
          const curDistKmNum = _lastDriveDistKm != null ? parseFloat(_lastDriveDistKm) || 0 : 0;
          const velKmh =
            dtH > 0 && _dispLastRenderMs > 0
              ? Math.abs(curDistKmNum - _dispLastDistKmNum) / dtH
              : 0;
          const velChange = Math.abs(velKmh - _dispLastVelKmh);
          // 走行中以外で・速度変化が小さく・直近描画から _DISP_THROTTLE_MS 未満なら本 frame は間引く。
          if (
            !isRunning &&
            _dispLastRenderMs > 0 &&
            velChange < _DISP_VEL_EPS_KMH &&
            sinceMs < _DISP_THROTTLE_MS
          ) {
            // skip: 本 frame は描画しない (= DOM 書込/calcFare を省く)。次 frame で再判定。
            //   getState は running 判定で 1 回呼んだのみ (= 従来同等・補間 1 回前進)。
          } else {
            _renderMeterReadout(st);
            _dispLastVelKmh = velKmh;
            _dispLastDistKmNum = _lastDriveDistKm != null ? parseFloat(_lastDriveDistKm) || 0 : 0;
            _dispLastRenderMs = nowMs;
          }
        } catch (_) {
          /* rAF tick エラー・graceful skip・次 frame 継続 */
        }
        _rafDisplayId = requestAnimationFrame(_rafDisplayTick);
      }

      function startRafDisplay() {
        if (_rafDisplayId !== null) return; // 既に走行中
        if (typeof requestAnimationFrame === 'undefined') return; // 環境非対応
        _rafDisplayId = requestAnimationFrame(_rafDisplayTick);
      }

      function stopRafDisplay() {
        if (_rafDisplayId === null) return;
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(_rafDisplayId);
        }
        _rafDisplayId = null;
        _lastDriveDistKm = null;
        _lastDriveFareYen = null;
        _lastTotalDistKm = null;
      }

      // ─── UIタイマー ───
      function startUiTimer() {
        // ★設計変更宣言 (2026-05-24・表示層 滑らか化・refresh 高頻度):
        //   旧: 500ms (= 2Hz)・GPS 1Hz の・2 倍・stair-step 体感「カクカク」
        //   新: 100ms (= 10Hz)・予測補間 (= Meter display) を・10Hz で・滑らか反映
        //   バッテリー影響: getState 計算 5× 増 (= ~30 行追加・軽量)・体感影響小
        //   実距離計算頻度 (= GPS 1Hz / Worker B 受信時) は・変更なし
        //   絶対ルール準拠: 実距離値・課金経路・1 byte 不変・表示頻度のみ高頻度化
        // ★設計変更宣言 (2026-05-24・案 B・rAF 60Hz 描画並行追加):
        //   startUiTimer 内で・rAF 描画ループも・並行 start (= driveDist/driveFare/totalDist のみ高頻度)
        //   既存 setInterval (= 100ms) は・1 byte 不変・重い処理 (save 等) は・既存維持。
        //   rAF / setInterval 二重更新は・textContent 比較で・無駄 DOM 書込ゼロ。
        startRafDisplay();
        uiTimer = setInterval(() => {
          const s = Meter.getState();
          // ★クラッシュ修正 (2026-05-30・Sentry DAIKOME-4 "Can't find variable: total")★:
          //   _renderMeterReadout 一本化時に fare/extraTotal/total の算出ブロックが消え、
          //   下記 6947/6948/6953/6969/6981 の参照だけが残り走行中 ReferenceError。算出を復元。
          //   ★課金経路不変: calcFare(display) は表示・FB送信・localStorage 用で従来同一式★。

          let fare = Meter.calcFare(s.display_distance_m || s.distance_m || 0);
          if (surchargeOn) fare = Math.round(fare * surchargeRate);
          const extraTotal = extras.reduce((a, b) => a + b.amount, 0);
          const total = Math.max(0, fare + extraTotal - _discountTotal());
          // 距離 / 料金 / 業務総走行の読み出しは rAF と共通の _renderMeterReadout() に一本化
          // (= driveDist=display_distance_m 滑らか・driveFare=calcFare(display)+surcharge+extras・
          //    totalDist=Business.getReport().total_distance_m)。textContent 比較で二重書込なし。
          // ★課金経路・calcFare・distance_m は 1 byte 不変・display は表示専用 (最大 10m 先取り)★
          _renderMeterReadout();
          // ★設計変更宣言 (2026-05-15・住所取得 retry UI 自動追従):
          //   addresses-fine-jp.js 24.6MB の defer load 完了前に押された経由地点は
          //   Business 側の _scheduleAddressRetry が 1〜5 秒後に解決する。本タイマで
          //   毎 500ms current_trip を読み waypointCard の件数バッジ・recorded 状態を
          //   同期し、住所が遅延入力されても UI が自動追従するようにする。
          try {
            if (typeof updateWaypointCardUI === 'function') updateWaypointCardUI();
          } catch (_) {}

          // ★設計変更宣言 (2026-05-10): driveSource を全面見直し
          //   旧: 通常 (mm/inline/gap/gps 各状態) を逐一テキスト表示・「課金」単語あり
          //   新: 通常時は完全非表示・「⚠ 位置情報の精度が低下しています」のみ
          //       表示条件: _forwardedPrefs.size === 0 が 30 秒継続のとき (= 真のエラー)
          //   「課金」ワードは UX 不安要因のため全削除 (絶対ルール「道路距離課金」は
          //   コード側で担保済み・表示は要らない)
          try {
            const src = document.getElementById('driveSource');
            if (src) {
              // ★設計変更宣言 (2026-05-13・gate 修正): 旧 _forwardedPrefs.size から
              //   新パイプライン参照に書換 (driving 画面 driveSource warning)
              const forwarded =
                window._mmPipeline && window._mmPipeline.stats
                  ? window._mmPipeline.stats.roadsOk
                  : 0;
              const now = Date.now();
              if (forwarded > 0) {
                window._mmZeroSince = null;
                src.style.display = 'none';
              } else {
                if (window._mmZeroSince == null) window._mmZeroSince = now;
                if (now - window._mmZeroSince >= 30000) {
                  src.textContent = '⚠ 位置情報の精度が低下しています';
                  src.style.background = '#FDECEA';
                  src.style.color = '#C0392B';
                  src.style.display = 'block';
                } else {
                  src.style.display = 'none';
                }
              }
            }
          } catch (_) {}

          // 確定画面でもリアルタイム更新
          if (appState === 'fare') {
            document.getElementById('fareTotalAmount').textContent = total.toLocaleString();
            renderFare(s, fare, extraTotal, total);
          }

          if (surchargeOn) {
            const base = s.fare_yen;
            const diff = fare - base;
            document.getElementById('surchargeInfo').style.display = 'block';
            document.getElementById('surchargeInfo').textContent =
              '+' + diff.toLocaleString() + '円（割増）';
          } else {
            document.getElementById('surchargeInfo').style.display = 'none';
          }

          renderExtras();
          renderDiscounts();

          // Firebase送信（2秒ごと）
          // ★Firebase が 止まっても 走行の 刻みを 止めない★ 2026-09-01
          //   ★実測★… FB を 消して この行を 呼ぶと ReferenceError。
          //   ここは ★走行中 2秒ごと★に 通るので、落ちると ★走行の 表示が 止まります★。
          if (s.elapsed_sec % 2 === 0 && typeof FB !== 'undefined' && FB.updateVehicle) {
            FB.updateVehicle({
              status: 'driving',
              session: {
                distance_m: Math.round(s.distance_m),
                fare_yen: total,
                elapsed_sec: s.elapsed_sec,
              },
            });
          }
          // 走行状態をlocalStorageに保存（リロード復元用）
          // ★書けない 時（端末の 保存場所が 一杯 等）は ここで 捕まえる★（10-11）
          //   前は 捕まえず 毎秒10回 例外が 上がっていた。運転手への 知らせは 同じ 時に 落ちる
          //   Business.save の onHozonShippai（1業務に1回）が 出す＝ここでは 新しく 出さない。
          try {
            const ms = Meter.getState();
            const mmStats = typeof Meter.getMMStats === 'function' ? Meter.getMMStats() : null;
            localStorage.setItem(
              'daikou_driving_state',
              JSON.stringify({
                distance_m: s.distance_m,
                fare_yen: total,
                saved_at: Date.now(),
                last_lat: ms.last_gps ? ms.last_gps.lat : null,
                last_lng: ms.last_gps ? ms.last_gps.lng : null,
                last_altitude: ms.last_gps ? ms.last_gps.altitude : null,
                last_speed_kmh: ms.last_speed_kmh || 0,
                last_gps_at: ms.last_timestamp || null,
                // ★ B-3 (2026-05-19): elapsed_sec 保存 (= 代行中タスクキル復帰で経過時間継続)
                elapsed_sec: s.elapsed_sec || 0,
                // F2 (2026-05-09): MM stats を併せて保存・復元時の動作確認用
                mm_distance_m: mmStats ? mmStats.mm_distance_m : 0,
                distance_source: mmStats ? mmStats.distance_source : null,
                mm_snap_rate: mmStats ? mmStats.snap_rate : 0,
              })
            );
          } catch (_) {
            /* 刻みは 止めない */
          }
        }, 100);
      }

