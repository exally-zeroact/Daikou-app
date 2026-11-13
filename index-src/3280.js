      // ★設計変更宣言 (2026-05-14・本日売上 global fallback):
      //   旧: updateBusinessDashboard は Business state のみ参照・onTripEnd 失敗時 ¥0 で固まる事象あり
      //   新: renderFare で todayFareYen += total を蓄積・updateBusinessDashboard で Math.max fallback
      let todayFareYen = 0;
      let uiTimer = null;
      // ★設計変更宣言 (2026-05-24・案 B・rAF 描画ループ・60Hz 高頻度描画):
      //   司さん指示「バッテリーは気にしなくてよい・出来る最高峰で滑らかに」 採用。
      //   既存 setInterval (= L6296・100ms) と並行追加・driveDist/driveFare/totalDist のみ rAF 60Hz 更新。
      //   重い処理 (= localStorage save / Firebase 送信 / waypointCard) は・既存 setInterval 維持 (= 分離)。
      //   getState 内・予測補間ロジック (= velocity/predicted_target/display 追従) は・1 byte 不変。
      //   rAF 仕様: visibilitychange 自動 stop/resume (= 追加 logic 不要)。
      //   前回値 textContent 比較で・無駄 DOM 書込 防止。
      let _rafDisplayId = null;
      let _lastDriveDistKm = null;
      let _lastDriveFareYen = null;
      let _lastTotalDistKm = null;
      // ★古スマホ対応 ⑤ (2026-05-30・display refresh 適応間引き・CPU/発熱低減):
      //   rAF は最大 60Hz で _renderMeterReadout (= getState 予測補間 + textContent 比較) を呼ぶ。
      //   速度変化が小さい (= 定速 / 停車) 局面では 2〜4Hz で十分滑らか。差分が小さい frame は
      //   描画を間引き、加減速 (= 速度変化大) の局面だけ高頻度描画する。
      //   ★絶対不可侵★: 本間引きは ★表示読み出し層のみ★。GPS 実測点の ingest / distance_m /
      //     calcFare には一切触れない (= 距離 1 byte 不変)。getState 予測補間は now ベースのため
      //     frame を skip しても次回描画で時間差を吸収し連続表示になる。
      const _DISP_THROTTLE_MS = 250; // 定速時の最小描画間隔 (= 4Hz)
      const _DISP_VEL_EPS_KMH = 1.5; // 速度変化がこの kmh 未満なら「変化小」とみなす
      let _dispLastRenderMs = 0;
      let _dispLastDistKmNum = 0;
      let _dispLastVelKmh = 0;
      let vehicleId = 'v1';

      // GPS 状態 (旧 line 2254-2257)
      let gpsStarted = false;
      let _lastGpsLogAt = 0;
      let _gpsCallbackCount = 0;

      // 停車検出 (旧 line 4214-4215) → 2026-05-24 stopCandidateBanner 削除に伴い・本変数も撤去
      //   isStationary 判定本体 (= window._lastStationary / Meter._isStationary 等) は・触らず

      // MM 先読み 1 回限定フラグ (旧 line 4321)
      let _preloadDone = false;

      // ★設計変更宣言 (2026-05-10): sensor_denied_v2 / _showSensorBannerIfDeniedV2 /
      //   sensor_denied_once migration を全削除し、本番 (Daikou-app) と同じシンプル
      //   仕様に戻す。
      //   旧: localStorage.sensor_denied_v2 で拒否履歴を gate して banner 表示
      //   新: 「iOS PWA + sessionStorage.sensor_permission_active !== '1'」だけで
      //       orange banner を表示 (本番 Daikou-app と完全一致)
      //   起動時 banner 表示は line ~4218 の iOS PWA boot IIFE で行う

      // ★設計変更宣言 (2026-05-14・performance.navigation.type ベースの fresh load 判定に置換):
      //   旧: document.referrer が同 origin でなければ fresh load 扱いで sensor_permission_active をクリア
      //       問題: iOS PWA snapshot 機構で sessionStorage が消えないケースを referrer で代用していたが、
      //             SPA 化で MPA 遷移が減り referrer ベースの判定が不安定化・iOS PWA で誤判定発生
      //   新: PerformanceNavigationTiming (modern API) の entry.type を見て:
      //       - 'navigate' (新規ロード / タスクキル後起動 / アドレスバー入力) → sensorGranted + sensor_permission_active を統一クリア
      //       - 'reload' (F5 / SW controllerchange 経由の reload) → クリアしない
      //       - 'back_forward' (履歴ナビ) → クリアしない
      //     これにより iOS PWA のタスクキル → 再起動で確実に許可ページから入る (sessionStorage が消えなくても明示的クリアで保証)
      //     Legacy フォールバック: performance.navigation.type (deprecated・iOS Safari でも動く)
      //   業務中・空車中・実車中の orange banner 処理 (sensor_permission_active を参照) は無変更・
      //   このクリアは「許可ページに必ず一度戻す」目的のみ
      //
      // ★設計変更宣言 (2026-05-14・bottom-nav 経由 MPA navigation で誤クリアされる事象修正):
      //   バグ: 設定保存 → location.href='index.html' (settings.html L829) は navigation.type='navigate' に
      //        該当するため、本ブロックが sensor_permission_active を消し、Business.load() の active 復元路
      //        (L3766-3779) で screenIdle/screenDriving にオレンジバナーが誤表示されていた。
      //   修正: navigate 判定に「referrer が同一 origin でない」AND 条件を追加。
      //        - bottom-nav 経由 (settings.html → index.html): referrer = 同 origin → クリアしない (= 業務継続)
      //        - 真のコールドスタート / PWA タスクキル後: referrer = '' → クリア (= 許可ページ強制経由)
      //        - reload / back_forward: 元から非クリア (既存動作維持)
      //   MA-6 で bottom-nav を showOverlay() に切替えれば本条件分岐は不要になるが、phase 完了まで暫定。
      try {
        let _navType = 'navigate';
        try {
          const _entries =
            performance.getEntriesByType && performance.getEntriesByType('navigation');
          if (_entries && _entries.length > 0 && _entries[0].type) {
            _navType = _entries[0].type;
          } else if (performance.navigation) {
            const _t = performance.navigation.type;
            if (_t === 0) _navType = 'navigate';
            else if (_t === 1) _navType = 'reload';
            else if (_t === 2) _navType = 'back_forward';
          }
        } catch (_) {}
        // 同一 origin referrer 判定 (MPA 内部遷移を fresh load から除外)
        let _sameOriginReferrer = false;
        try {
          if (document.referrer) {
            const _ref = new URL(document.referrer);
            _sameOriginReferrer = _ref.origin === location.origin;
          }
        } catch (_) {}
        if (_navType === 'navigate' && !_sameOriginReferrer) {
          sessionStorage.removeItem('sensor_permission_active');
          sessionStorage.removeItem('sensorGranted');
          if (typeof dlog === 'function') {
            dlog(
              '[Sensor] navigation.type=navigate + referrer 別 origin → sensorGranted + sensor_permission_active 統一クリア'
            );
          }
        } else {
          if (typeof dlog === 'function') {
            dlog(
              '[Sensor] navigation.type=' +
                _navType +
                ' / sameOrigin=' +
                _sameOriginReferrer +
                ' → flag 保持'
            );
          }
        }
      } catch (_) {}

      // ★設計変更宣言 (2026-05-14・許可ページ初期表示問題修正):
      //   navigation.type クリア直後に updateStartButtonsGate を即時呼出。
      //   旧: クリアした後・最初の updateStartButtonsGate 呼出が warmup 完了 (L1853 area・async 数秒〜数十秒) まで
      //       走らないため、それまで btn-business-start (CSS default visible) + L3733 startup routing の
      //       updateResumeFromStartVisibility で業務再開ボタンが見えてしまう状態が継続していた
      //   新: フラグクリア直後に即時 updateStartButtonsGate → sensorGranted=null なら btnPerm 表示 / 他は非表示
      //       function 宣言は同一 <script> 内 L3937・hoisting により L1547 から呼出可能
      //   DOM 要素は script 上 (L1146 area) に既に存在するので getElementById は成功
      try {
        if (typeof updateStartButtonsGate === 'function') updateStartButtonsGate();
        if (typeof dlog === 'function') dlog('[Sensor] 起動直後の updateStartButtonsGate 即時呼出');
      } catch (_) {}

      // ★設計変更宣言 (2026-05-10): user gesture 直近時刻を記録
      //   blockIfSensorNotGranted が「user gesture 起因」かを判定するため
      //   document への click listener で _lastUserGestureAt を更新
      //   capture phase + passive で UI 干渉なし
      window._lastUserGestureAt = null;
      try {
        document.addEventListener(
          'click',
          function () {
            window._lastUserGestureAt = Date.now();
          },
          { capture: true, passive: true }
        );
        document.addEventListener(
          'touchstart',
          function () {
            window._lastUserGestureAt = Date.now();
          },
          { capture: true, passive: true }
        );
      } catch (_) {}

      // ★設計変更宣言 (2026-05-10): 業務開始ボタンの bottom-line safety guard
      //   旧: P6 setInterval (script 末尾) のみで disable/enable を制御
      //       → script 中盤で halt すると setInterval が register されず
      //         MM 0/5 でもボタンが押せて ReferenceError 発生
      //   新: 宣言直後に最小限の guard setInterval を register
      //       → script 中盤の halt があっても確実に動作
      // ★設計変更宣言 (2026-05-14・業務開始ボタンのグレーアウト撤去):
      //   旧: roadsOk === 0 (MM 道路データ未ロード) で業務開始ボタンを opacity:0.4 + disabled
      //       「絶対ルール準拠: 道路距離 0 件で業務開始 = inline fallback で GPS 直線距離課金リスク」
      //        を理由に gate していた
      //   新: 司さん指示「業務開始ボタンは常時青・常時押せる状態」に従い setInterval を全削除
      //   絶対ルール準拠は meter.js 側で担保:
      //   - roads 未 load → _inlineSnapAndIncrement が null を返す → state.distance_m 加算なし
      //   - GPS 直線距離は使わない (絶対ルール) ・距離 0 のまま据え置きで安全
      //   ボタンの押下可否は ON/OFF 切替ではなく、押された後の挙動 (meter.js の null 据え置き) で保証する。

      function _setupMmWorker(reason) {
        try {
          _mmWorker = new Worker('js/map-matcher.js');
        } catch (e) {
          console.warn('[MM] worker 起動失敗・既存インライン経路で稼働:', e.message);
          _mmWorker = null;
          window._mmWorker = null;
          return;
        }
        _mmWorker.addEventListener('error', function (err) {
          console.error('[MM] worker error:', (err && err.message) || err);
          // エラー時は Meter 側を fallback に切替してから再起動を予約
          if (typeof Meter !== 'undefined' && Meter.setMapMatcher) {
            Meter.setMapMatcher(null);
          }
          try {
            _mmWorker.terminate();
          } catch (e) {}
          _mmWorker = null;
          window._mmWorker = null;
          if (_mmWorkerRestartTimer) {
            clearTimeout(_mmWorkerRestartTimer);
          }
          _mmWorkerRestartTimer = setTimeout(function () {
            _mmWorkerRestartTimer = null;
            if (typeof dlog === 'function') dlog('[MM] worker 自動再起動を試行（reason: error）');
            _setupMmWorker('error-recover');
          }, _MM_WORKER_RESTART_DELAY_MS);
        });
        _mmWorker.addEventListener('message', _mmWorkerOnMessage);
        if (typeof Meter !== 'undefined' && Meter.setMapMatcher) {
          Meter.setMapMatcher(_mmWorker);
        }
        // ★経由の前後の記録 (2026-11-13)★: mmResult（距離の増えの入口）を写すだけ。
        //   Meter の後に付ける＝距離を足した後に走る。worker を作り直すたびにここを通る＝付け直し。
        try {
          if (window.KeiyuKiroku && typeof window.KeiyuKiroku.attachMm === 'function') {
            window.KeiyuKiroku.attachMm(_mmWorker);
          }
        } catch (_) {}
        // ★設計変更宣言 (2026-05-18・configPlatform 配線完了 / G6 残課題解消):
        //   旧: configPlatform 未送信 → iOS でも Viterbi N=15 で起動 (= 初回 commit ラグ 16 秒)
        //   新: _setupMmWorker (init / 再起動 両経路) で Worker B に platform 通知
        //       → iOS は VITERBI_N_MIN (=10) で起動・初回 commit ラグ 11 秒に改善
        //   Android は isIOS=false 送信・Worker B 側 handler が no-op (= 既存挙動維持)
        _mmWorker.postMessage({ type: 'configPlatform', isIOS: _isIOS });
        // ★設計変更宣言 (2026-05-13・大改修 C11): 旧 _mmReforwardAllState() 呼出を削除
        //   再起動時の state 再 forward は新パイプライン (MMDataPipeline) の責務に移譲予定
        window._mmWorker = _mmWorker;
        if (typeof dlog === 'function') {
          dlog('[MM] worker B ' + (reason === 'init' ? '起動' : '再起動') + '・Meter 注入完了');
        }
        // ★設計変更宣言 (2026-06-05・★Worker 再起動時の roads 再 forward・しまなみ SE 距離フリーズ根治★):
        //   init 以外 (= visibility ping 応答なし / error 等で Worker を作り直した場合)、新 Worker は
        //   道路データ 0 件で起動する (旧実装は再 load しない → 全 snap 失敗で distance 永久フリーズ。
        //   実機 SE: 34km 走行で 1.6km=−95%)。MMDataPipeline に load 済データの再送を依頼する。
        //   絶対ルール準拠: pipeline の既存 load 経路を呼ぶだけ・distance_m / calcFare は 1 byte 不変。
        if (
          reason !== 'init' &&
          window._mmPipeline &&
          typeof window._mmPipeline.reforwardToWorker === 'function'
        ) {
          try {
            window._mmPipeline.reforwardToWorker(_mmWorker).catch(function (e) {
              if (typeof dlog === 'function') {
                dlog('[MM] roads 再 forward 失敗: ' + (e && e.message));
              }
            });
          } catch (e) {
            if (typeof dlog === 'function') {
              dlog('[MM] roads 再 forward 例外: ' + (e && e.message));
            }
          }
        }
      }

      // ★設計変更宣言 (2026-05-13・大改修 C11): _mmReforwardAllState 関数を全削除
      //   旧経路 (_forwardRoadsToMmWorker / _forwardDemToMmWorker /
      //   _forwardBackboneToMmWorker / _forwardedPrefs) と一緒に削除。
      //   再起動時の state 再 forward は新パイプライン (MMDataPipeline) の責務へ。

      // メッセージハンドラを別関数に分離（addEventListener / removeEventListener 整合性）
      function _mmWorkerOnMessage(e) {
        const m = e.data;
        if (!m) return;
        // ★設計変更宣言 (2026-05-13・大改修 C10): MM warmup 通知
        //   committed=true (snap commit 成功) を 1 回受信したら pipeline に通知
        //   Phase E (waitForMMWarmup) を resolve
        if (
          m.type === 'mmResult' &&
          m.committed &&
          window._mmPipeline &&
          !window._mmPipeline.ready.mmWarmed
        ) {
          try {
            window._mmPipeline.notifyMMCommit();
          } catch (_) {
            // pipeline 未 ready 等は・致命傷ではない・graceful skip
          }
        }
        // ★設計変更宣言 (2026-05-23・住所① 案 C 高精度版・B 配線・map-matched snap 位置を Business に通知):
        //   Worker B が既に postMessage 済の snap 座標 (= mmResult.snap.snapLat / snapLng) を
        //   Business 側に・1 行 通知。Business._safeGetNearestAddress が・PIP 入力に・優先使用。
        //   業務は・読むだけ・Worker B / meter.js / map-matcher.js 本体は 1 byte 不変。
        //   distance_m / 課金 / Meter.reset には・完全無関係 (= 表示専用)。
        if (m.type === 'mmResult') {
          // ★1km自動較正K 見える化 (2026-06-26・トースト=青バー非接触・一時表示)★:
          //   判定は純関数 KCalib.decideCalibToast(対立監査P0/P1是正済=完了は1回だけ/業務・県跨ぎで再表示/
          //   『この区間のK』文言)。autoCalibK OFF は calibStatus=null=何も出ない(byte不変)。
          if (
            m.calibStatus &&
            typeof window.KCalib !== 'undefined' &&
            window.KCalib.decideCalibToast
          ) {
            try {
              var _ct = window.KCalib.decideCalibToast(m.calibStatus, window._calibToastState);
              window._calibToastState = _ct.state;
              if (_ct.toast && typeof showToast === 'function') showToast(_ct.toast);
              if (_ct.long && typeof showToastLong === 'function') showToastLong(_ct.long);
            } catch (_) {
              /* 見える化失敗は距離/課金に無関係 */
            }
          }
          // ★2026-07-03 Fix B配線(対立監査P1-①是正)★: degraded(較正エンジン未ロード=較正Kが
          //   乗らず生OBD∫vで過小課金)を検知して window フラグに反映。従来は無音で過小のまま走ってた
          //   (実機事故の真因)。_updateCalibGate が永続バナー警告＋代行開始ゲート閉鎖に使う=無音再発防止。
          window._autoCalibKDegraded = !!(
            m.calibStatus &&
            m.calibStatus.requested === true &&
            m.calibStatus.degraded === true
          );
          // ★2026-07-03 自己診断trace(足す①): 直近のcalibStatusをwindowに保存=debug-traceがmetaに焼く★
          window._lastCalibStatus = m.calibStatus || null;
          // ★「見えなかった分」を 置くだけ (2026-09-03)★
          //   business.js が 業務開始で 控え、業務終了で 差を出して 履歴に 入れます。
          //   ★ここでは 何も 計算しません／距離にも 料金にも 触りません★
          //   ★取れない時は null★（0 を 作らない＝「本当に 0 だった」と 読まれない様に）
          window._lastMienai = m.mienai || null;
          // ★2026-07-04 距離内訳計装: 距離増分を「OBD∫v駆動 vs GPS(その他)駆動」で分けて累積★。
          //   同経路ブレの残り源(OBD有効点のGPS弦漏れ)を実走traceで数値化する用。距離/課金に無関与(読むだけ集計)。
          if (typeof m.pipelineDeltaM === 'number' && m.pipelineDeltaM > 0) {
            if (m.pipelineDeltaSrc === 'obd')
              window._cumObdM = (window._cumObdM || 0) + m.pipelineDeltaM;
            else window._cumGpsM = (window._cumGpsM || 0) + m.pipelineDeltaM;
          }
          // ★2026-07-03 Fix B広げる(③の穴を塞ぐ): degraded(較正器ロード失敗)だけでなく
          //   「保存calibKs≥3=本来Kが乗るはず なのに実行時 active≠true(=生∫vで走ってる)」も掴む。
          //   復元漏れ等でKが黙って乗ってない状態を検知→代行開始ブロック＋警告=黙って過小課金を不可能に。
          try {
            var _acar =
              window.VehRegistry && window.VehRegistry.getActive
                ? window.VehRegistry.getActive(localStorage)
                : null;
            var _savedKn = _acar && Array.isArray(_acar.calibKs) ? _acar.calibKs.length : 0;
            var _rawNotApplied = !!(
              window.DK_AUTO_CALIB_K && // K有効
              window.OBD_DRIVE_DISTANCE && // OBD駆動中(KはOBD駆動時のみ意味)
              _savedKn >= 3 && // この車は較正済(本来Kが乗る)
              m.calibStatus && // workerがcalibStatus報告済(起動直後のnullで誤爆しない)
              m.calibStatus.active !== true // なのにKが乗ってない=異常
            );
            // ★対立監査P1-a是正: 単発フリッカー(configVehicle復元前の1tick等)で誤ブロックしないよう
            //   3連続 mmResult で active!==true の時だけ確定=接続直後のtransientを吸収★。
            window._notAppliedStreak = _rawNotApplied ? (window._notAppliedStreak || 0) + 1 : 0;
            window._autoCalibKNotApplied = window._notAppliedStreak >= 3;
          } catch (_) {
            window._autoCalibKNotApplied = false;
            window._notAppliedStreak = 0;
          }
          // ★STEP3 K自動保存 (2026-06-26)★: 較正器が貯めた健全窓Ks を選択中の車に永続保存。
          //   窓数が変わった時だけ書く(localStorage頻書防止)→次回その車を選ぶと restoreKs で即「✓較正済」。
          if (
            m.calibStatus &&
            Array.isArray(m.calibStatus.Ks) &&
            typeof m.calibStatus.windows === 'number' &&
            window.VehRegistry
          ) {
            try {
              // ★較正バナー用: 良GPS累積km(あと約◯km表示)★
              if (typeof m.calibStatus.accKm === 'number') window._calibAccKm = m.calibStatus.accKm;
              // ★監査P0是正: 保存先は「worker が今較正してる車id」(calibStatus.vehicleId)★。
              //   getActiveId だと走行中の車切替で worker未切替の旧Ksが新車に混入する。worker idに紐づけ根治。
              var _wid = m.calibStatus.vehicleId || null;
              if (window._calibSavedVid !== _wid) {
                // 車が変わった=保存カウンタをリセット(新車の窓を取りこぼさない)
                window._calibSavedVid = _wid;
                window._calibSavedN = -1;
              }
              if (_wid && m.calibStatus.windows !== window._calibSavedN) {
                window._calibSavedN = m.calibStatus.windows;
                window.VehRegistry.setCalibKs(localStorage, _wid, m.calibStatus.Ks);
                if (window.DK_VEHICLE_PROFILE && window.DK_VEHICLE_PROFILE.id === _wid)
                  window.DK_VEHICLE_PROFILE.calibKs = m.calibStatus.Ks.slice();
                if (typeof window._renderVehList === 'function') window._renderVehList();
                if (typeof window._updateBizCarSelect === 'function') window._updateBizCarSelect();
              }
            } catch (_) {
              /* K保存失敗は距離/課金に無関係(次tickで再試行) */
            }
          }
          // ★較正ゲート: 代行開始ボタンのグレー表示を較正進捗に追従(3窓で解除)★
          if (typeof window._updateCalibGate === 'function') window._updateCalibGate();
          if (typeof window._updateSetupGuide === 'function') window._updateSetupGuide();
          var _snapOk =
            m.snap && typeof m.snap.snapLat === 'number' && typeof m.snap.snapLng === 'number';
          if (_snapOk) {
            try {
              if (typeof Business !== 'undefined' && typeof Business.notifyMMSnap === 'function') {
                Business.notifyMMSnap(m.snap.snapLat, m.snap.snapLng);
              }
            } catch (_) {
              // Business 未 load・notifyMMSnap 未実装 等 → graceful skip
            }
            // ★診断 (2026-06-20): snap復帰ログ — 住所②フリーズ(snap停止)の真因を次走traceで特定する用。
            if (window._mmSnapMissN > 0) {
              if (typeof dlog === 'function')
                dlog('[MMSNAP] 復帰 (snap停止 ' + window._mmSnapMissN + '点ぶり)');
              window._mmSnapMissN = 0;
            }
          } else {
            // ★診断 (2026-06-20): snap欠落=候補ゼロ(GPSが読込済み道路から遠い/橋・島でroad未カバー)。
            //   notifyMMSnap が呼ばれず _lastMMSnap が凍結→住所②が張り付く真因。★距離/課金には完全無関与(ログのみ)★。
            window._mmSnapMissN = (window._mmSnapMissN || 0) + 1;
            if (
              typeof dlog === 'function' &&
              (window._mmSnapMissN === 1 || window._mmSnapMissN % 10 === 0)
            )
              dlog(
                '[MMSNAP] miss×' + window._mmSnapMissN + ' (snap停止中=候補ゼロ・住所凍結リスク)'
              );
          }
        }
        if (typeof dlog !== 'function') return;
        if (m.type === 'roadsLoaded') {
          dlog(
            '[MM] worker roads ' +
              (m.ok ? 'loaded' : 'fail') +
              ': ' +
              m.pref +
              (m.ok ? ' (' + m.numRoads + '本)' : ' err=' + m.error)
          );
        } else if (m.type === 'demLoaded') {
          // MM-5: DEM 受信ログ
          dlog(
            '[MM] worker DEM ' +
              (m.ok ? 'loaded' : 'fail') +
              (m.ok ? ' (cells=' + m.cells + ' size=' + m.sizeMB + 'MB)' : ' err=' + m.error)
          );
        } else if (m.type === 'backboneLoaded') {
          // Phase B: backbone graph 受信ログ
          dlog(
            '[MM] backbone ' +
              (m.ok ? 'loaded' : 'fail') +
              (m.ok ? ' (nodes=' + m.numNodes + ' edges=' + m.numEdges + ')' : ' err=' + m.error)
          );
        } else if (m.type === 'tileStats') {
          dlog(
            '[MM] tile cache ' +
              m.cacheSize +
              '/' +
              m.cacheMax +
              ' pinned=' +
              m.pinnedCount +
              ' inflight=' +
              (m.inflight || 0) +
              ' hit=' +
              m.hitCount +
              ' miss=' +
              m.missCount +
              ' hitRate=' +
              ((m.hitRate || 0) * 100).toFixed(1) +
              '%' +
              ' backbone=' +
              m.backboneLoaded
          );
        } else if (m.type === 'requestTile') {
          // Phase B runtime: Worker B からタイル取得依頼 → RoadGraphTileLoader で fetch
          if (typeof RoadGraphTileLoader !== 'undefined') {
            RoadGraphTileLoader.loadTile(m.pref, m.tx, m.ty)
              .then(function (tile) {
                if (_mmWorker) {
                  try {
                    _mmWorker.postMessage({
                      type: tile ? 'loadTile' : 'tileNotFound',
                      pref: m.pref,
                      tx: m.tx,
                      ty: m.ty,
                      tileData: tile || null,
                    });
                  } catch (e) {}
                }
              })
              .catch(function () {
                if (_mmWorker) {
                  try {
                    _mmWorker.postMessage({
                      type: 'tileNotFound',
                      pref: m.pref,
                      tx: m.tx,
                      ty: m.ty,
                    });
                  } catch (e) {}
                }
              });
          }
        } else if (m.type === 'mcmShrink') {
          // MM-7: MCM 窓自動縮小通知
          dlog(
            '[MCM] window shrunk: N=' +
              m.from +
              ' → N=' +
              m.to +
              ' (p99=' +
              m.p99.toFixed(1) +
              'ms)'
          );
        } else if (m.type === 'mm7Stats') {
          // M-3: visibility 復帰時 ping への応答（pong 代わり）
          _mmHealthPongAt = Date.now();
          // MM-7: MCM/pheromone/grid 統計（debug 用 probe で取得）
          // ★設計変更宣言 (2026-05-17・Worker B decode 確認手段の追加):
          //   loaded=N県/M本 を末尾に追記。pheromone_prefs (Firebase cross-user 由来) と
          //   loaded_prefs_count (実 decode 済 県数) を区別して表示可能にする。
          dlog(
            '[MM-7] N=' +
              m.mcm_window_size +
              '/' +
              m.mcm_window_max +
              ' shrunk=' +
              m.mcm_shrunk +
              ' pheromone=' +
              m.pheromone_roads_count +
              ' roads (' +
              m.pheromone_prefs +
              ' prefs)' +
              ' grid=' +
              m.grid_cells_count +
              '/' +
              m.grid_cells_max +
              ' cells' +
              ' worker_p99=' +
              m.worker_p99_ms.toFixed(2) +
              'ms' +
              ' loaded=' +
              (m.loaded_prefs_count != null ? m.loaded_prefs_count : '?') +
              '県/' +
              (m.loaded_roads_total != null ? m.loaded_roads_total : '?') +
              '本'
          );
        }
      }

