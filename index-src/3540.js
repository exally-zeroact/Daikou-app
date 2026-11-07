      // ─── 代行キャンセル (取消: 距離も料金も加算しない・2026-07-25 司さん要望) ───
      //   代行中に押すと、現在のtripを記録せず破棄して空車へ戻る (Business.onTripEnd を呼ばない)。
      function onCancelTrip() {
        // ★センサーの許可は要求しない (2026-08-07・司さん指摘)★
        //   iPhoneは一度アプリを離れると許可が切れる。終わらせる操作で止めると詰む。
        if (appState !== 'driving' && appState !== 'fare') return;
        if (!confirm('この代行を取消します。距離も料金も加算されません。よろしいですか？')) return;
        // メーター停止+trip reset (distance_m/料金を破棄) ・記録(onTripEnd)はしない
        try {
          Meter.stop();
        } catch (_) {}
        if (uiTimer) {
          clearInterval(uiTimer);
          uiTimer = null;
        }
        if (typeof stopRafDisplay === 'function') stopRafDisplay();
        appState = 'idle';
        extras = [];
        discounts = [];
        surchargeOn = false;
        histSaved = false;
        try {
          Meter.reset();
        } catch (_) {}
        localStorage.removeItem('daikou_driving_state');
        const _rb = document.getElementById('restoreBanner');
        if (_rb) _rb.classList.remove('show');
        try {
          FB.setIdle();
        } catch (_) {}
        showScreen('idle');
        try {
          updateBusinessDashboard();
        } catch (_) {}
        const _title = document.getElementById('appbarTitle');
        if (_title) _title.textContent = '空　車';
        const _si = document.getElementById('surchargeInfo');
        if (_si) _si.style.display = 'none';
        if (typeof updateSurchargeBadge === 'function') updateSurchargeBadge();
        if (typeof showToast === 'function') showToast('代行を取消しました');
      }

      // ─── 画面切替 ───
      // 2026/05/01 仕様：画面ごとに表示するボタンを show クラスで制御
      //   業務未開始(businessStart) : 専用画面・[業務開始] のみ
      //   業務終了画面(businessReport) : 日報 + [続ける]/[終了]
      //   待機(idle)   : btn-main [代行開始]
      //   実車(driving): btn-row [追加料金][確定]
      //   支払(fare)   : btn-back-portrait（縦画面）+ btn-back-landscape（横画面）+ btn-main [精算終了]
      function showScreen(name) {
        document.getElementById('screenIdle').style.display = name === 'idle' ? 'flex' : 'none';
        document.getElementById('screenDriving').style.display =
          name === 'driving' ? 'block' : 'none';
        document.getElementById('screenFare').style.display = name === 'fare' ? 'block' : 'none';
        // 2026/05/01追加：業務管理画面
        const elBStart = document.getElementById('screenBusinessStart');
        const elBReport = document.getElementById('screenBusinessReport');
        if (elBStart) elBStart.style.display = name === 'businessStart' ? 'flex' : 'none';
        if (elBReport) elBReport.style.display = name === 'businessReport' ? 'flex' : 'none';
        // ★今日の車 選択ストリップを更新(業務開始画面を出す時)★
        if (name === 'businessStart' && typeof window._updateBizCarSelect === 'function')
          window._updateBizCarSelect();
        if (typeof window._updateCalibGate === 'function') window._updateCalibGate(); // ★代行開始の較正ゲート表示更新★
        if (typeof window._updateSetupGuide === 'function') window._updateSetupGuide(); // ★初回オンボーディング誘導更新★

        // ★設計変更宣言 (2026-05-24・横画面サイドレール + grid・iOS Safari :has() bug 回避):
        //   body.classList で screen 状態を class detection 化。既存 :has() rule は・触らず並記。
        //   理由: iOS Safari の :has() + style 属性 selector mutation 後 再評価されない既知 bug
        //         (= L2685 既存コメント根拠) を・class mutation 経由で・安全に・回避。
        //   - body.screen-idle / body.screen-businessstart 横画面 → サイドレール 64px 表示
        //   - body.screen-businessstart 横画面 → grid-template-columns: 1fr (= 大ボタン中央配置確保)
        //   - body.screen-driving / body.screen-fare → サイドレール非表示維持 (= 運転中ナビ不要)
        const _body = document.body;
        if (_body && _body.classList) {
          _body.classList.toggle('screen-idle', name === 'idle');
          _body.classList.toggle('screen-driving', name === 'driving');
          _body.classList.toggle('screen-fare', name === 'fare');
          _body.classList.toggle('screen-businessstart', name === 'businessStart');
          _body.classList.toggle('screen-businessreport', name === 'businessReport');
        }

        // 全ボタンのリセット
        const btnMain = document.getElementById('btnMain');
        const btnRow = document.getElementById('btnRow');
        const btnBackP = document.getElementById('btnBackPortrait');
        const btnBackL = document.getElementById('btnBackLandscape');
        const btnResumeL = document.getElementById('btnResumeLandscape');
        const btnConfirmL = document.getElementById('btnConfirmLandscape');
        if (btnMain) btnMain.classList.remove('show');
        if (btnRow) btnRow.classList.remove('show');
        if (btnBackP) btnBackP.classList.remove('show');
        if (btnBackL) btnBackL.classList.remove('show');
        if (btnResumeL) btnResumeL.classList.remove('show');
        if (btnConfirmL) btnConfirmL.classList.remove('show');
        const _bdcReset = document.getElementById('btnDrivingConfirm');
        if (_bdcReset) _bdcReset.classList.remove('show');

        // 画面ごとの表示
        if (name === 'idle') {
          if (btnMain) {
            btnMain.textContent = '代行開始';
            btnMain.classList.add('show');
          }
        } else if (name === 'driving') {
          if (btnRow) btnRow.classList.add('show');
          const _bdc = document.getElementById('btnDrivingConfirm');
          if (_bdc) _bdc.classList.add('show');
        } else if (name === 'fare') {
          if (btnMain) {
            btnMain.textContent = '精算終了';
            btnMain.classList.add('show');
          }
          if (btnBackP) btnBackP.classList.add('show');
          if (btnBackL) btnBackL.classList.add('show');
        } else if (name === 'businessReport') {
          // 2026/05/01：横画面では右側 btn-area に[続ける]/[終了]を表示
          //    縦画面では screenBusinessReport 内のボタンが既に表示される
          if (btnResumeL) btnResumeL.classList.add('show');
          if (btnConfirmL) btnConfirmL.classList.add('show');
        }
        // businessStart は btn-area のボタン全部非表示（リセットだけ）
      }
      // 起動直後の初期状態にも上記表示制御を即適用
      // ★設計変更宣言 (2026-05-10): btnMain (代行開始) を無条件で .show する処理を削除
      //   旧: 起動時に btnMain.classList.add('show') を呼ぶ
      //       → businessStart 画面表示中も 代行開始 ボタンが見えてしまうバグ
      //   新: btnMain の表示制御は showScreen('idle') のみが管理
      //       (showScreen は Business init で適切な画面に対して必ず呼ばれる)
      //   row/back ボタンの reset は initial state として残す
      (function _initBtnVisibility() {
        const btnMain = document.getElementById('btnMain');
        const btnRow = document.getElementById('btnRow');
        const btnBackP = document.getElementById('btnBackPortrait');
        const btnBackL = document.getElementById('btnBackLandscape');
        if (btnRow) btnRow.classList.remove('show');
        if (btnBackP) btnBackP.classList.remove('show');
        if (btnBackL) btnBackL.classList.remove('show');
        // 念のため btnMain のテキストを「代行開始」に揃え・.show は付与しない
        if (btnMain) {
          btnMain.textContent = '代行開始';
          btnMain.classList.remove('show');
        }
      })();

      // ─── VisibilityChange：裏に回った瞬間を確実に保存（層2） ───
      document.addEventListener('visibilitychange', function () {
        if (document.hidden && appState === 'driving') {
          try {
            const s = Meter.getState();
            const ms = Meter.getState();
            let fare = s.fare_yen;
            if (surchargeOn) fare = Math.round(fare * surchargeRate);
            const extraTotal = extras.reduce((a, b) => a + b.amount, 0);
            const total = Math.max(0, fare + extraTotal - _discountTotal());
            const mmStats2 = typeof Meter.getMMStats === 'function' ? Meter.getMMStats() : null;
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
                // F2: MM stats 同時保存
                mm_distance_m: mmStats2 ? mmStats2.mm_distance_m : 0,
                distance_source: mmStats2 ? mmStats2.distance_source : null,
                mm_snap_rate: mmStats2 ? mmStats2.snap_rate : 0,
              })
            );
            dlog('[復元] 裏に回った瞬間を保存');
          } catch (e) {
            console.error('[復元] visibilitychange保存エラー:', e);
          }
        }
        // 業務状態を保存（裏回し時・タスクキル前の最後のチャンス）
        // 2026/05/04 夜・追加：司さん指摘「タスクキルしたら総走行距離が0に戻る」
        // 1秒throttle save（onGps内）の取りこぼし対策・確実に永続化する
        if (
          document.hidden &&
          typeof Business !== 'undefined' &&
          typeof Business.save === 'function'
        ) {
          try {
            Business.save();
            if (typeof dlog === 'function') dlog('[Business] visibilitychange save');
          } catch (e) {
            console.error('[Business] visibilitychange save エラー:', e);
          }
        }
      });

      // ─── Phase A-1 (2026-05-20): Page Lifecycle API 初期化 ───
      // 既存 visibilitychange handler を補完して pagehide / freeze / resume / pageshow を捕捉。
      // pagehide / freeze は bfcache 直前の最終チャンス・既存 daikou_driving_state + Business.save を呼ぶ。
      // 復元は既存 Business.load + drivingState restore 経路に任せる (= 新規復元経路なし)。
      try {
        if (typeof PageLifecycle !== 'undefined' && typeof PageLifecycle.init === 'function') {
          PageLifecycle.init();
        }
      } catch (e) {
        console.error('[page-lifecycle] init error:', e);
      }

      // 起動時センサーバナー表示は「センサー未許可バナー（PWA起動時）」ロジックに統合（2026/04/30）
      // drivingState の有無に関係なく、未許可なら起動のたびにバナー表示

      // ★設計変更宣言 (2026-05-10): loadSettings() を try/catch で防御
      //   旧: 素裸で呼出・JSON.parse 失敗等で script 全体が halt
      //       → 後続 const (_isIOS 等) が TDZ → onBusinessStart で ReferenceError
      //   新: try/catch で守り、上流 halt を防止
      try {
        loadSettings();
      } catch (e) {
        console.error('[loadSettings] error:', e && e.message, e && e.stack);
      }
      try {
        FB.setIdle();
      } catch (e) {
        console.error('FB setIdle error:', e);
      }

      // ─── ★メーターの控え（端末に覚える）2026-08-04★ ───────────────
      //   司さん「オフラインで走って ★画面を閉じて★ 家で業務終了」→ 距離が0で上がった。
      //   meter.js は距離も料金も端末に保存していない（localStorage 参照3件は全部 車両プロファイル）。
      //   ここで控えて、起動時に戻す。★距離・料金の計算そのものには触っていない★。
      function _meterCtx() {
        let bs = null;
        try {
          const s = Business.getState();
          bs = s && s.start_time ? s.start_time : null;
        } catch (_) {
          bs = null;
        }
        let ts = null;
        try {
          const t = Business.getCurrentTrip && Business.getCurrentTrip();
          ts = t && typeof t.start_time === 'number' ? t.start_time : null;
        } catch (_) {
          ts = null;
        }
        return { businessStart: bs, tripStart: ts, now: Date.now() };
      }

      function _saveMeterSnapshot() {
        try {
          if (typeof MeterPersist === 'undefined' || typeof Meter === 'undefined') return;
          MeterPersist.save(null, Meter.getState(), _meterCtx());
        } catch (_) {
          /* ★控えが書けなくても業務は止めない★ */
        }
      }

