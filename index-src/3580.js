      // 起動時の業務管理初期化外でも、許可済みかチェックしてバナー表示
      // （Business 未定義の場合や、active 業務中でも未許可ならバナー出す）
      try {
        showSensorBannerIfNeeded();
      } catch (e) {
        console.error('[Sensor] init banner error:', e);
      }

      // ★設計変更宣言 (2026-05-10): 起動時 GPS 自動起動を撤廃
      //   旧: sessionStorage active='1' なら起動時に即 startGPS()
      //   新: GPS は btnSensorPermission 押下経由でのみ起動する設計に統一
      //   user gesture 経由でのみ navigator.geolocation を呼ぶ厳格化

      // ─── PWAバナー（ホーム画面追加促進） ───
      (function () {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isInstalled = window.navigator.standalone === true;
        const isDismissed = localStorage.getItem('pwa_banner_dismissed');
        if (isIOS && !isInstalled && !isDismissed) {
          document.getElementById('pwaBanner').classList.add('show');
        }
      })();

      function closePwaBanner() {
        document.getElementById('pwaBanner').classList.remove('show');
        localStorage.setItem('pwa_banner_dismissed', '1');
      }

      function showPwaInstructions() {
        alert(
          '① 画面下の「共有」ボタン（□↑）をタップ\n② 「ホーム画面に追加」を選択\n③「追加」をタップ\n\nホーム画面のアイコンから起動するとコンパス・ジャイロが使えます！'
        );
      }

      // ─── 入れてください の帯 / 入れ方 の窓 ───
      function closeApkBanner() {
        // ★「二度と出さない」にはしない★ 2026-08-25
        //   前は localStorage に「もう出さない」を書いていた。
        //   ＝一度 ✕ を押した端末は ★入っていないのに 何も出ない★ まま
        //     業務開始だけ押せない、という一番わかりにくい形になる。
        //   今は その場で閉じるだけ。開き直すか 業務開始を押せば また出る。
        document.getElementById('apkBanner').classList.remove('show');
      }
      function showApkInstall() {
        document.getElementById('apkModal').classList.add('show');
      }
      function closeApkModal() {
        document.getElementById('apkModal').classList.remove('show');
      }
      // ★入っていない時に「押す物ひとつ」で入れる★ 2026-08-25（司さん指示）
      //   ▼考え方
      //     ・Chrome は「入れられる」と判断した時に beforeinstallprompt をくれる。
      //       ★それを取っておいて、こちらのボタンで出す★＝メニュー（⋮）を探させない。
      //     ・入れられない端末（iPhoneなど）は prompt が来ないので、その時だけ手順を出す。
      //     ・★入っていない時は 閉じても また出す★（業務開始が押せない＝仕事にならない為）。
      //       閉じたまま忘れる方が困る。
      var _dkInstallPrompt = null;
      function dkIsStandalone() {
        try {
          return (
            window.navigator.standalone === true ||
            (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
          );
        } catch (_) {
          return false;
        }
      }
      function dkShowInstallBanner() {
        try {
          if (dkIsStandalone()) return; // 入っている人には出さない
          var el = document.getElementById('apkBanner');
          if (!el) return;
          var btn = document.getElementById('pwaInstallBtn');
          var sub = document.getElementById('pwaBannerSub');
          if (_dkInstallPrompt) {
            // ★押すだけで入る★
            if (btn) btn.textContent = '入れる';
            if (sub) sub.textContent = '入れないと 業務開始が押せません（今は URL欄が出ています）';
          } else {
            // ★押すだけでは入らない端末★＝その時だけ 手順を出す
            if (btn) btn.textContent = '入れ方';
            if (sub) sub.textContent = '入れないと 業務開始が押せません（入れ方を見る）';
          }
          el.classList.add('show');
        } catch (_) {}
      }
      window.addEventListener('beforeinstallprompt', function (e) {
        try {
          e.preventDefault(); // ★Chrome任せの出し方を止めて こちらのボタンで出す★
          _dkInstallPrompt = e;
          dkShowInstallBanner();
        } catch (_) {}
      });
      window.addEventListener('appinstalled', function () {
        try {
          _dkInstallPrompt = null;
          var el = document.getElementById('apkBanner');
          if (el) el.classList.remove('show');
          if (typeof showToast === 'function')
            showToast('入りました。ホーム画面のダイコメから開いてください');
        } catch (_) {}
      });
      function dkInstallApp() {
        try {
          if (_dkInstallPrompt) {
            _dkInstallPrompt.prompt();
            _dkInstallPrompt.userChoice
              .then(function () {
                _dkInstallPrompt = null;
              })
              .catch(function () {
                _dkInstallPrompt = null;
              });
            return;
          }
          showApkInstall(); // 押すだけでは入らない端末＝手順を出す
        } catch (_) {}
      }
      (function () {
        try {
          // ★入っていなければ 出す（Androidだけに絞らない）★
          //   iPhone も 入っていないと 業務開始が押せないので 同じように案内する。
          if (!dkIsStandalone()) dkShowInstallBanner();
        } catch (e) {}
      })();

      // ★設計変更宣言 (2026-05-13・Phase 6-2): DakomeDL モジュール全削除
      //   旧 47県 DL UI 制御モジュール (DakomeDL IIFE・約 730 行)。
      //   役割は全て新パイプライン (MMDataPipeline) に移管完了:
      //   - 47県 DL → MMDataPipeline.warmup の Phase B
      //   - cache 検証 → SW staleWhileRevalidate + cache.put + cachePutFailed 通知
      //   - 欠落復旧 → _mmPipeline.enqueueRetry (Phase 1 修正1-B)
      //   - DL 完了マーク → 不要 (新パイプラインは IndexedDB 使わず)
      //   削除対象内訳:
      //   - DakomeDL IIFE 全体 (~730 行)
      //   - 内部 recovery 関数群 (Phase 6-3 該当): _verifyAndRecoverRoadsCache /
      //     _recoverMissingPrefs / _cleanupQueriedRoadsCacheEntries / _detectCacheEviction
      //   残置: consumer (dataUpdateBanner 等) は Phase 6-4・6-5 で書換予定

      // ★設計変更宣言 (2026-05-11): データ更新バナー (businessStart 7 日経過時のみ表示)
      //   仕様:
      //   - 表示条件: appState='businessStart' AND iOS PWA AND oldest pref >7日前
      //                AND snooze 24h 経過済
      //   - WiFi 検出 (navigator.connection.type==='wifi' or downlink>5Mbps) で自動 DL
      //   - × タップで 24h スヌーズ
      //   - 業務開始ボタン押下で自動非表示 (snooze なし)
      //   - 業務中 (idle/driving/fare) は絶対表示しない
      //   - 完了で自動消滅・snooze 記録なし
      // ★設計変更宣言 (2026-05-13・Phase 6-5): dataUpdateBanner 簡易化
      //   旧: 7 日経過で「更新通知」バナー表示 + 全 47 県再 DL + 更新件数表示
      //        DakomeDL.getAllPrefectures / markPrefDone / PREFECTURES に依存
      //   新: DakomeDL 依存を全削除・「7 日経過判定 + 再 DL」機能を一時停止
      //        meta.json ベース差分検知の実装まで checkAndShow / show は no-op
      //        HTML (dataUpdateBannerWrap / dataUpdateBanner) は残置・hide も維持
      //        将来 meta.json 実装時に _shouldShow / startDownload を新方式で復活可能
      // ★設計変更宣言 (2026-05-13): DataUpdateBanner の no-op method 群を整理
      //   機能停止中 (Phase 6-5) で show / startDownload / checkAndShow / _isOnWifi
      //   は全て no-op だった → 全削除。close-btn が呼ぶ hide のみ残置。
      //   visibilitychange / online listener も checkAndShow 呼出のみだったので削除。
      //   meta.json 実装時に新方式で復活予定。
      const DataUpdateBanner = (function () {
        function hide() {
          const wrap = document.getElementById('dataUpdateBannerWrap');
          if (wrap) wrap.classList.remove('show');
        }
        return { hide };
      })();

      // グローバル関数として close-btn onclick から呼べるよう公開
      function hideDataUpdateBanner() {
        DataUpdateBanner.hide();
      }

      // ─── 月次更新トースト UI 制御 ───
      const DakomeUpdateToast = (function () {
        const TOAST_DURATION_MS = 2500;
        let hideTimer = null;

        function show() {
          const t = document.getElementById('dlUpdateToast');
          if (!t) return;
          if (!t.classList.contains('show')) {
            t.classList.remove('fade-out');
            t.classList.add('show');
          }
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(hide, TOAST_DURATION_MS);
        }

        function hide() {
          const t = document.getElementById('dlUpdateToast');
          if (!t) return;
          t.classList.add('fade-out');
          setTimeout(() => {
            t.classList.remove('show');
            t.classList.remove('fade-out');
          }, 300);
          if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
          }
        }

        return { show, hide };
      })();

      function onDlToastTap() {
        DakomeUpdateToast.hide();
      }

      // ★設計変更宣言 (2026-05-13・Phase 5): DakomeDL.init() 呼出 standalone IIFE を削除
      //   役割は新パイプライン (MMDataPipeline.warmup) に完全移管済。
      //   DakomeDL モジュール自体は Phase 6 で削除予定 (consumer がまだ参照しているため残置)。

      // ★2026-07-23 司さん裁定「起動オンボーディングはいらない」: チュートリアル(ようこそ/センサー許可/
      //   ホーム画面追加 の3画面)を markup/CSS/JS ごと完全撤去。センサー許可は業務開始画面の既存ブロックで要求。

      // ★設計変更宣言 (2026-05-13・許可/業務開始ボタンの排他表示):
      //   ユーザー指摘: 業務開始ボタンが先に出て押すと許可ダイアログ→再度業務開始
      //   → 望ましいフロー: ダウンロード完了 → 許可ボタンのみ → 許可 → 業務開始のみ
      //   集約関数 updateStartButtonsGate で permission 状態に応じて両ボタンを切替。
      //   呼出: (1) warmup 完了時 (2) requestSensorPermission の granted callback
      //        (3) blockIfSensorNotGranted (画面タップで再評価)
      function updateStartButtonsGate() {
        // ★設計変更宣言 (2026-05-14・sessionStorage 'sensorGranted' フラグ管理に変更):
        //   旧: needs (DeviceOrientation 必要) + sensor_permission_active / compass_granted / motion_granted
        //       (localStorage で permission を永続化・タスクキル後も granted 扱い)
        //   新: sessionStorage.getItem('sensorGranted') === '1' のみで判定
        //       タスクキル後は sessionStorage がクリア → 必ず許可ページ (センサー許可ボタンのみ) を経由
        //       業務中・空車中・実車中の orange banner 処理 (sensor_permission_active 等) は無変更
        //   sensorGranted は requestSensorPermission() 成功時のみセット (このセッション限り有効)
        const granted = sessionStorage.getItem('sensorGranted') === '1';
        const btnPerm = document.getElementById('btnSensorPermission');
        const note = document.getElementById('sensorPermissionNote');
        const btnStart = document.querySelector('#screenBusinessStart .btn-business-start');
        // ★設計変更宣言 (2026-05-14・screenBusinessStart 2 状態化):
        //   未許可: btnSensorPermission のみ表示・他は全て非表示 (業務開始 / 業務再開 / 但し書き)
        //   許可済: btn-business-start 表示・業務再開系は updateResumeFromStartVisibility に委譲
        const btnResume = document.getElementById('btnResumeFromStart');
        const resumeNote = document.getElementById('resumeNote');
        if (granted) {
          if (btnPerm) btnPerm.style.display = 'none';
          if (note) note.style.display = 'none';
          if (btnStart) btnStart.style.display = '';
          // 業務再開ボタンと但し書きは limbo state 判定に委ねる
          if (typeof updateResumeFromStartVisibility === 'function') {
            try {
              updateResumeFromStartVisibility();
            } catch (_) {}
          }
        } else {
          if (btnPerm) btnPerm.style.display = 'block';
          if (note) note.style.display = 'block';
          if (btnStart) btnStart.style.display = 'none';
          // 未許可時は業務再開ボタンと但し書きも完全非表示
          if (btnResume) btnResume.style.display = 'none';
          if (resumeNote) resumeNote.style.display = 'none';
        }
      }

