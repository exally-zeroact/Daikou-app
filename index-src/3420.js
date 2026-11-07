      // [業務開始] 押下：Business.start() 発火 → 待機画面へ
      // 2026/05/01 仕様変更：[業務開始] で GPS・センサー許可・NoSleep を発火
      //   司さん仕様「業務開始から1日の総距離もほしい」に合致
      //   業務開始 = 1日の業務スタート = 全GPS情報を取り始める
      function onBusinessStart() {
        // ★★OBD を ここで 繋ぐ（押す 回数を 増やさない）★★ 2026-09-08
        //   ★司さん★「ユーザーにめんどくさいことやらすな」
        //   ★訳★ 起動時の 自動接続は ★端末の 設定次第で 黙って 失敗する★。
        //     すると 運転手は 毎回「OBDを接続」を 押して 一覧から 選ぶ 羽目に なる。
        //   ⇒ ★もともと 必ず 押す この ボタンに ぶら下げる★
        //     ・Web Bluetooth は ★人が 押した 瞬間★でないと 機械を 選べない 決まり
        //       なので ★一番 先に★ 呼ぶ（後ろで 待つと 権利が 切れる）
        //     ・★前に OBD を 使った 端末だけ★（使っていない 人には 何も 出さない）
        //     ・★業務開始は 絶対に 止めない★（選ぶのを やめても そのまま 始まる）
        try {
          // ★★業務の 頃合いを 一度 消す★★ 2026-09-10（指示役の 監査①）
          //   ★この 業務で 繋いだか★ を 始めに 戻す。
          //   ⇒ 昨日の 印を 引きずって ★切れて いないのに 警告★ を 出さない。
          try {
            window._obdGyoumuKaishiDeShirushiKesu();
          } catch (_) {
            /* 印が 消せなくても 業務は 始める */
          }
          window._obdGyoumuKaishiDeTsunagu();
        } catch (_) {
          /* 繋げなくても 業務は 始める */
        }
        // ★起動計測ログ Phase 0 (2026-05-25): 業務開始 button 押下 mark (= read-only)
        try {
          if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
            performance.mark('first-business-start-click');
          }
        } catch (_) {
          /* 業務影響ゼロ・graceful skip */
        }
        // S1 (2026-05-10): 閲覧専用モードでは業務開始不可
        if (window._tabReadOnly) {
          showToast('別のタブで業務中です');
          return;
        }
        // ★設計変更宣言 (2026-05-24・端末ライセンス台数 gate):
        //   js/license.js の・LicenseGate で・cache 期限内 / grace 中なら・allowed
        //   未登録 / expired 時は・showLicenseGate で・ゲート画面表示・業務開始 block
        //   絶対ルール準拠: distance_m / 課金距離ロジックには・触れない
        try {
          // ★ライセンスゲート (2026-07-27・会社URL/Ed25519署名方式 STEP3配線)。
          //   DK_LICENSE_GATE_ON==='1' の端末だけ発動(既定OFF=自社運用/未設定端末は一切ブロックしない)。
          //   ★running(業務中/客乗せ中)は LicenseActivate 側で常に allowed=絶対止めない★。距離/課金に不触。
          let _running_lic = false;
          try {
            _running_lic = !!(
              window.Meter &&
              window.Meter.getState &&
              window.Meter.getState().running
            );
          } catch (_e) {
            /* ignore */
          }
          if (
            localStorage.getItem('DK_LICENSE_GATE_ON') === '1' &&
            typeof window.LicenseActivate !== 'undefined' &&
            typeof window.LicenseActivate.checkBeforeBusinessStart === 'function'
          ) {
            const _lic = window.LicenseActivate.checkBeforeBusinessStart(_running_lic);
            if (!_lic.allowed) {
              if (typeof window.showLicenseGate === 'function') {
                window.showLicenseGate(_lic);
              } else {
                showToast(_lic.message || 'ライセンス認証エラー');
              }
              if (typeof dlog === 'function')
                dlog('[Business] start blocked: license ' + _lic.state);
              return;
            }
          }
        } catch (_) {
          // License module 未 load 等の・致命傷ではない・graceful skip (= 既存挙動維持)
        }
        // ★設計変更宣言 (2026-05-12): 全 OS で PWA standalone 必須化
        //   理由: 非 PWA (iOS Safari ブラウザ・Android Chrome ブラウザ) では
        //         道路データ DL (47県/204MB) が DakomeDL.init() 起動時の
        //         standalone ガードにより未実行
        //         → MM 不可・GPS 直線距離課金に劣化 → 絶対ルール
        //         「道路ジオメトリに沿った距離で課金」違反
        //   判定:
        //     iOS Safari PWA      → navigator.standalone === true
        //     Android Chrome PWA  → matchMedia('(display-mode: standalone)').matches
        //   非 standalone → ホーム画面追加を促してブロック
        try {
          const _bsIsStandalone =
            window.navigator.standalone === true ||
            (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
          if (!_bsIsStandalone) {
            // ★止めるだけにしない★ 2026-08-25（司さん「それやったら最初から誘導しろや」）
            //   前は この言葉だけ＝★何をどう押すのか分からない★
            //   → その場で ★押す物ひとつ★の案内を出す（メニューを探させない）
            showToast('アプリとして入れてから業務開始してください（下の「入れる」を押す）');
            try {
              if (typeof dkShowInstallBanner === 'function') dkShowInstallBanner();
            } catch (_) {}
            if (typeof dlog === 'function') dlog('[Business] start blocked: not PWA standalone');
            return;
          }
        } catch (_) {}
        // 全ボタン共通：センサー未許可ならバナー表示してブロック（2026/05/01）
        if (blockIfSensorNotGranted()) return;
        if (typeof Business === 'undefined') {
          console.error('[Business] not loaded');
          showToast('業務開始に失敗しました (Business 未ロード)');
          return;
        }
        try {
          // 業務開始時は許可済み前提（blockIfSensorNotGranted で未許可は弾いてる）
          // 念のため iOS PWA で permission 期限切れチェック
          if (
            _isIOS &&
            window.navigator.standalone === true &&
            window._compassGranted &&
            window._motionGranted
          ) {
            refreshSensorPermission();
          }
          // Business 状態を active に
          Business.start();
          _maeShirase(); // ★持ち越し（前の 業務が 事務所へ 未送信）を 知らせる (10-11)★
          // ★設計変更宣言 (2026-05-14・業務リセット仕様変更):
          //   旧: autoResetCheck (時刻ベース・12:00 等で発火) で表示値リセット
          //   新: 代行開始ボタン押下時 (= ここ) でホーム画面の集計表示を全部 0 にリセット
          //       Business.start() が既に state を 0 初期化済・updateBusinessDashboard が 1 秒間隔で
          //       DOM に反映するが、ユーザーに即時感を与えるため明示的に DOM + 集計 globals を 0 化。
          //   resume() 経由 (onResumeFromStart / onBusinessResume) はリセット対象外・前業務を引き継ぐ。
          try {
            todayDist = 0;
            todayCount = 0;
            todayFareYen = 0;
            lastGoodTotalM = 0; // ★業務が変わったので命綱も 0 に戻す★
            const _today = new Date().toDateString();
            localStorage.setItem(
              'daikou_today',
              JSON.stringify({ date: _today, dist: 0, count: 0, fare: 0, total: 0 })
            );
            // ★監査MAJOR修正 (2026-06-20・深夜営業で当日履歴が消える根治):
            //   旧: ここで removeItem('daikou_history_'+_today) し、同日2業務目の「代行開始」で
            //       当日の全乗車履歴(午後分など)を永久削除していた。daikou_history_<date> は
            //       履歴オーバーレイ(_hist_render)が読む唯一の乗車単位ストアで、退避先(業務単位
            //       レポート daikou_business_history)は表示経路が dead。∴ 2026-06-06 要件
            //       「履歴は全業務記録(20回でも30回でも)」と矛盾し、深夜跨ぎ営業でデータ消失。
            //   新: removeItem を撤去。新業務の集計表示リセットは globals(todayDist/Count/FareYen)
            //       + daikou_today + DOM の 0 化で完結し、乗車履歴は cleanOldHistoryKeys(30日
            //       retention)に保持を委ねる。履歴オーバーレイは時刻順に全乗車を並べる設計のため
            //       業務跨ぎでも乗車単位で正しく表示される。distance_m/課金は不可侵(表示リセットのみ)。
            const _elTotal = document.getElementById('totalDist');
            if (_elTotal) _elTotal.textContent = '0.00';
            const _elActual = document.getElementById('todayDist');
            if (_elActual) _elActual.textContent = '0.00';
            const _elCount = document.getElementById('todayCount');
            if (_elCount) _elCount.textContent = '0';
            const _elFare = document.getElementById('fareTotalYen');
            if (_elFare) _elFare.textContent = '0';
            if (typeof dlog === 'function')
              dlog('[Business] 代行開始リセット: 総走行/実車/営業/売上 → 0');
          } catch (e) {
            console.error('[Business] 代行開始リセットエラー:', e);
          }
          // ★設計変更宣言 (2026-05-11): 業務開始押下でデータ更新バナーを自動非表示
          //   snooze 記録なし (= 翌業務サイクルで再判定・古いデータ未更新を忘れさせない)
          try {
            if (typeof DataUpdateBanner !== 'undefined') DataUpdateBanner.hide(false);
          } catch (_) {}
          // ★ R3: Wake Lock API + NoSleep fallback (= 画面消灯防止・user gesture 内で発火)
          acquireWakeLock();
          // ★設計変更宣言 (2026-05-19・B-1・業務開始時 warmup GPS prime):
          //   warmup で取得済の GPS を Meter.state.last_gps に prime → 業務開始直後の
          //   最初の GPS update から haversine 加算可能 (= 業務開始ラグ最小化)。
          //   warmup が 5 秒以上古い場合は内部で false 返却・無害。
          try {
            if (typeof Meter !== 'undefined' && typeof Meter.primeFromWarmup === 'function') {
              const _primed = Meter.primeFromWarmup();
              if (typeof dlog === 'function') {
                dlog('[Business] warmup prime: ' + (_primed ? 'OK' : 'skip (no valid warmup)'));
              }
            }
          } catch (_) {}
          // 暗転タイマーリセット
          if (dimTimer) {
            clearTimeout(dimTimer);
            dimTimer = null;
          }
          document.documentElement.style.filter = '';
          // GPS 起動（業務全体で総走行距離を計測するため）
          // ★設計変更宣言 (2026-05-13・診断): 実機で「watchPosition 開始」ログが出ない事象を可視化
          //   startGPS が真に呼ばれていないのか / 早期 return (gpsStarted=true) で skip なのかを区別
          if (typeof dlog === 'function')
            dlog('[Business] startGPS 呼出前 gpsStarted=' + gpsStarted);
          startGPS();
          if (typeof dlog === 'function')
            dlog('[Business] startGPS 呼出後 gpsStarted=' + gpsStarted);
          // 画面遷移
          appState = 'idle';
          showScreen('idle');
          const _appbarEl = document.getElementById('appbarTitle');
          if (_appbarEl) _appbarEl.textContent = '空　車';
          updateBusinessDashboard();
          if (typeof dlog === 'function') dlog('[Business] start (GPS/NoSleep activated)');
        } catch (e) {
          // ★設計変更宣言 (2026-05-10): エラー詳細を Eruda に出るように改善
          //   旧: console.error('[Business] start error:', e) → Eruda は "ReferenceError {}" のみ表示
          //   新: e.message と e.stack を文字列で出力 → 実際の変数名/行番号が見える
          console.error(
            '[Business] start error:',
            (e && e.message) || String(e),
            (e && e.stack) || '(no stack)'
          );
          showToast('業務開始に失敗しました');
        }
      }

      // [業務終了] 押下：Business.end() 発火 → 日報画面へ
      function onBusinessEnd() {
        // S3 (2026-05-10): 業務終了の確認 dialog (誤操作防止)
        if (!confirm('業務を終了します。よろしいですか?')) return;
        // ★センサーの許可は要求しない (2026-08-07・司さん指摘)★
        //   司さん「事務所に戻るとOBDきれるのに警告のせいで業務終了が押せない」
        //   iPhoneのアプリは★一度離れて戻るとセンサーの許可が切れる★。
        //   その状態で業務終了を押すと、ここで止められて
        //   「センサーを許可して」の警告が出るだけ＝★終われない★。
        //   ★終わらせる操作に加速度センサーは要らない★（もう測った分を締めるだけ）。
        //   許可が要るのは「これから測り始める」操作（業務開始・代行開始・再開）だけ。
        if (typeof Business === 'undefined') return;
        // 実車中・支払中は業務終了不可（保険・本来 screenIdle のみ表示なのでここに来ない）
        if (appState === 'driving' || appState === 'fare') {
          showToast('実車中・支払中は業務終了できません');
          return;
        }
        try {
          // B7 (2026-05-09): Worker B Viterbi 窓を flush して残値を distance_m に加算
          if (typeof Meter !== 'undefined' && typeof Meter.businessEnd === 'function') {
            Meter.businessEnd();
          }
          Business.end();
          _syncAfterEnd(); // ★業務終了で送る（これが無いと上がるのは翌日）★
          // fareConfig v2: 業務終了で surcharge ボタン群を非表示
          try {
            if (typeof renderSurchargeButtons === 'function') renderSurchargeButtons();
          } catch (_) {}
          // GPS / センサー蓄積を停止（D案・2026/05/06）
          //   日報画面では位置・加速度・ジャイロを使わないので即停止
          //   [続ける]で再開された時は onBusinessResume 側で startGPS() し直す
          stopGPS();
          appState = 'businessReport';
          renderBusinessReport();
          showScreen('businessReport');
          document.getElementById('appbarTitle').textContent = '業務報告';
          if (typeof dlog === 'function') dlog('[Business] end');
        } catch (e) {
          console.error('[Business] end error:', e);
          showToast('業務終了に失敗しました');
        }
      }

