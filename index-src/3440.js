      // [続ける] 押下：Business.resume() 発火 → 待機画面へ
      function onBusinessResume() {
        // 全ボタン共通：センサー未許可ならバナー表示してブロック
        if (blockIfSensorNotGranted()) return;
        if (typeof Business === 'undefined') return;
        // ★設計変更宣言 (2026-05-14・canResume 撤去残骸を除去):
        //   旧: Business.canResume() を呼んでいたが commit 8ad6b9a2 で削除済 → TypeError で
        //       state.active=false のまま limbo に取り残され onTripEnd が ignored される事象 (本日売上 ¥0) の根因
        //   新: Business.resume() を直接呼出・false 返値で再開不可と判定 (3 時間 gate は撤去済)
        try {
          const _resumed = Business.resume();
          if (!_resumed) {
            showToast('再開できる業務がありません');
            return;
          }
          // F3 (2026-05-09): Worker B 健全性 ping → 不調なら再起動して再 forward
          //   3 時間後再開で Worker が kill されている可能性に対応
          if (typeof _mmHealthCheck === 'function') _mmHealthCheck();
          // GPS / センサー蓄積を再開（D案・2026/05/06）
          //   onBusinessEnd で stopGPS() している分を起こし直す。
          //   リスナーは生きているので _isBizActive を true に戻すだけで蓄積復活。
          startGPS();
          appState = 'idle';
          showScreen('idle');
          document.getElementById('appbarTitle').textContent = '空　車';
          updateBusinessDashboard();
          if (typeof dlog === 'function') dlog('[Business] resume');
        } catch (e) {
          console.error('[Business] resume error:', e);
          showToast('再開に失敗しました');
        }
      }

      // 業務開始画面の「前回の業務を引き継ぐ場合」ボタン押下
      // ★設計変更宣言 (2026-05-14): 履歴 restore ベースから現在 state resume() ベースに変更
      //   旧: getLastEndedBusiness() で履歴最新を取得 + 3h 以内チェック + restoreFromHistory
      //   新: Business.getState() で limbo (start_time !== null && !active) なら Business.resume() を呼出
      //       3 時間制限なし・履歴復元は不要 (state がそのまま残っているため)
      function onResumeFromStart() {
        // 全ボタン共通：センサー未許可ならバナー表示してブロック
        if (blockIfSensorNotGranted()) return;
        if (typeof Business === 'undefined') return;
        try {
          const bs = Business.getState();
          if (!bs || bs.start_time === null || bs.active) {
            showToast('再開できる業務がありません');
            return;
          }
          const resumed = Business.resume();
          if (!resumed) {
            showToast('業務の復元に失敗しました');
            return;
          }
          // 許可済み前提（blockIfSensorNotGranted で未許可は弾いてる）
          // 念のため iOS PWA で permission 期限切れチェック
          if (
            _isIOS &&
            window.navigator.standalone === true &&
            window._compassGranted &&
            window._motionGranted
          ) {
            refreshSensorPermission();
          }
          // ★ R3: Wake Lock API + NoSleep fallback (= 画面消灯防止・user gesture 内で発火)
          acquireWakeLock();
          if (dimTimer) {
            clearTimeout(dimTimer);
            dimTimer = null;
          }
          document.documentElement.style.filter = '';
          startGPS();
          appState = 'idle';
          showScreen('idle');
          document.getElementById('appbarTitle').textContent = '空　車';
          updateBusinessDashboard();
          if (typeof dlog === 'function') dlog('[Business] resume from start screen');
        } catch (e) {
          console.error('[Business] resumeFromStart error:', e);
          showToast('再開に失敗しました');
        }
      }

      // 直前に終了した業務（履歴の最新）を取得
      function getLastEndedBusiness() {
        try {
          const histRaw = localStorage.getItem('daikou_business_history');
          if (!histRaw) return null;
          const hist = JSON.parse(histRaw);
          if (!Array.isArray(hist) || hist.length === 0) return null;
          // end_time が最新のものを取得（履歴は unshift で新しい順なので [0] でもOK）
          const latest = hist[0];
          if (!latest || !latest.end_time) return null;
          // 互換のため ended_at も付与
          return { ...latest, ended_at: latest.end_time };
        } catch (e) {
          console.error('[Business] getLastEndedBusiness error:', e);
          return null;
        }
      }

      // [履歴]ボタン押下：history overlay 表示（センサー未許可ならブロック）
      // ★設計変更宣言 (2026-05-15・Phase B): location.href='history.html' (MPA + redirect 経由)
      //   → window.showOverlay('history') (SPA seamless) に切替。
      //   page reload 発生せず GPS / Meter / MM Worker / WakeLock 継続稼働。
      //   showOverlay 未定義環境 (旧 cache 等) は location.href fallback (= MA-7 redirect 経由 / 着地)。
      function onHistory() {
        // ★センサーの許可は要求しない (2026-08-07)★ 見るだけの画面。
        if (typeof window.showOverlay === 'function') {
          window.showOverlay('history');
        } else {
          location.href = 'history.html';
        }
      }

      // 業務開始画面の「前回の業務を引き継ぐ場合」ボタンの表示制御
      // 起動時 + onBusinessConfirm（[終了]押下後）の両方で呼ばれる
      // ★設計変更宣言 (2026-05-14): 3 時間履歴ベースから現在 state ベースに変更
      //   旧: getLastEndedBusiness() で履歴を見て 3h 以内なら表示
      //   新: Business.getState() で limbo (start_time !== null && !active) なら常時表示
      function updateResumeFromStartVisibility() {
        try {
          if (typeof Business === 'undefined') return;
          const btn = document.getElementById('btnResumeFromStart');
          const note = document.getElementById('resumeNote');
          if (!btn || !note) return;
          // ★設計変更宣言 (2026-05-14・許可ページ優先):
          //   sensorGranted 未セット (= 許可ページ表示中) では resume button + note は絶対表示しない。
          //   updateStartButtonsGate の未許可分岐と整合・「許可ページの中身が複数表示される」事象を回避。
          const _granted = sessionStorage.getItem('sensorGranted') === '1';
          if (!_granted) {
            btn.style.display = 'none';
            note.style.display = 'none';
            if (typeof dlog === 'function')
              dlog('[Business] resume button: hidden (sensor 未許可・許可ページ表示中)');
            return;
          }
          const bs = Business.getState();
          if (bs && bs.start_time !== null && !bs.active) {
            btn.style.display = 'block';
            note.style.display = 'block';
            if (typeof dlog === 'function') dlog('[Business] resume button: visible (limbo state)');
          } else {
            btn.style.display = 'none';
            note.style.display = 'none';
            if (typeof dlog === 'function') dlog('[Business] resume button: hidden');
          }
        } catch (e) {
          console.error('[Business] updateResumeFromStartVisibility error:', e);
        }
      }

      // [終了] 押下：Business.abandon() 発火 → 業務開始画面へ
      function onBusinessConfirm() {
        // ★センサーの許可は要求しない (2026-08-07)★ 終わらせる操作なので不要。
        //   ここで止めると、業務終了の次の一手でまた進めなくなる。
        if (typeof Business === 'undefined') return;
        try {
          // ★設計変更宣言 (2026-05-14・業務終了確定を abandon → end に変更):
          //   旧: Business.abandon() → 履歴 push + state 完全リセット (start_time=null)
          //       → 結果: 業務再開ボタンの表示条件 (start_time !== null && !active) を満たさず・出番なし
          //   新: Business.end() → state.active=false / state.ended=true / start_time 維持 (limbo state)
          //       履歴の確定 push は次の Business.start() 内の abandon() で実施 (二重 push 回避)
          //       （2026-10-11〜 start() は abandon() を 呼ばず、積めない 時は 持ち越す）
          //       → 結果: businessStart 画面に戻った時に updateResumeFromStartVisibility が
          //               「前回の業務を引き継ぐ場合は」note + 業務再開ボタンを表示する
          Business.end();
          _syncAfterEnd(); // ★業務終了で送る（これが無いと上がるのは翌日）★
          appState = 'businessStart';
          showScreen('businessStart');
          document.getElementById('appbarTitle').textContent = 'ダイコメ';
          // limbo state (start_time !== null && !active) なので業務再開ボタンが表示される
          updateResumeFromStartVisibility();
          // ★ R3: Wake Lock + NoSleep 解除（業務終了確定でバッテリー節約）
          //   業務開始 → acquire / 業務終了確定 → release の自然なライフサイクル
          releaseWakeLock();
          if (typeof dlog === 'function') dlog('[WakeLock] 業務終了で解除');
          if (typeof dlog === 'function')
            dlog('[Business] end (limbo・next start で abandon して履歴 push)');
        } catch (e) {
          console.error('[Business] end error:', e);
          showToast('終了処理に失敗しました');
        }
      }

      // 業務終了画面の日報描画（report-card 内に動的生成）
      function renderBusinessReport() {
        if (typeof Business === 'undefined') return;
        const r = Business.getReport();
        if (!r) {
          document.getElementById('reportCard').innerHTML =
            '<div class="report-row"><span class="lbl">業務データがありません</span></div>';
          return;
        }
        // 業務時間（開始〜終了）
        const fmt = (ts) => {
          if (!ts) return '--:--';
          const d = new Date(ts);
          return (
            d.getHours().toString().padStart(2, '0') +
            ':' +
            d.getMinutes().toString().padStart(2, '0')
          );
        };
        const startTime = fmt(r.start_time);
        const endTime = fmt(r.end_time);
        const durMin =
          r.start_time && r.end_time ? Math.floor((r.end_time - r.start_time) / 60000) : 0;
        const durH = Math.floor(durMin / 60);
        const durM = durMin % 60;
        const durStr = durH > 0 ? durH + '時間' + durM + '分' : durM + '分';
        // 距離
        const totalKm = (r.total_distance_m / 1000).toFixed(2);
        const actualKm = (r.actual_total_m / 1000).toFixed(2);
        const emptyKm = ((r.total_distance_m - r.actual_total_m) / 1000).toFixed(2);
        const occupancy =
          r.total_distance_m > 0 ? Math.round((r.actual_total_m / r.total_distance_m) * 100) : 0;
        // 売上
        const fareYen = r.fare_total_yen.toLocaleString();
        const tripCount = r.trip_count;
        // HTML 生成
        let html = '';
        html +=
          '<div class="report-row large"><span class="lbl">本日売上</span><span class="val">¥' +
          fareYen +
          '</span></div>';
        html += '<hr class="report-divider">';
        html +=
          '<div class="report-row"><span class="lbl">業務時間</span><span class="val">' +
          startTime +
          ' - ' +
          endTime +
          '（' +
          durStr +
          '）</span></div>';
        html +=
          '<div class="report-row"><span class="lbl">営業回数</span><span class="val">' +
          tripCount +
          ' 回</span></div>';
        html += '<hr class="report-divider">';
        html +=
          '<div class="report-row"><span class="lbl">総走行距離</span><span class="val">' +
          totalKm +
          ' km</span></div>';
        html +=
          '<div class="report-row"><span class="lbl">実車距離</span><span class="val">' +
          actualKm +
          ' km</span></div>';
        // ★設計変更宣言 (2026-05-20・司さん指示・空車距離 行削除):
        //   旧: 「空車距離」行を表示 (= emptyKm = total - actual)
        //   新: 削除・総走行距離・実車距離・実車率 のみ表示。
        //   注: emptyKm 算出ロジック (= L6929 周辺) は他に影響なし・維持。
        html +=
          '<div class="report-row"><span class="lbl">実車率</span><span class="val">' +
          occupancy +
          ' %</span></div>';
        document.getElementById('reportCard').innerHTML = html;
      }

