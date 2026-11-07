      function requestSensorPermission() {
        // 2026/05/02：tSensorBtn / sensorPermBtn 削除済み
        // 旧バージョンでチュートリアル/バナーにあったボタンの処理を削除
        const promises = [];
        let compassGranted = false;
        let motionGranted = false;

        // iOS：requestPermissionが必要
        if (
          typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function'
        ) {
          promises.push(
            DeviceOrientationEvent.requestPermission()
              .then((state) => {
                dlog('[GPS] コンパス許可:', state);
                if (state === 'granted') compassGranted = true;
              })
              .catch((e) => dlog('[GPS] コンパス許可エラー:', e.message))
          );
        } else {
          compassGranted = true;
        }

        if (
          typeof DeviceMotionEvent !== 'undefined' &&
          typeof DeviceMotionEvent.requestPermission === 'function'
        ) {
          promises.push(
            DeviceMotionEvent.requestPermission()
              .then((state) => {
                dlog('[GPS] ジャイロ許可:', state);
                if (state === 'granted') motionGranted = true;
              })
              .catch((e) => dlog('[GPS] ジャイロ許可エラー:', e.message))
          );
        } else {
          motionGranted = true;
        }

        Promise.allSettled(promises).then(() => {
          const allGranted = compassGranted && motionGranted;

          if (allGranted) {
            window._compassGranted = true;
            window._motionGranted = true;
            localStorage.setItem('compass_granted', '1');
            localStorage.setItem('motion_granted', '1');
            // 2026/05/04 夜・追加：同 session 内のページ遷移で permission 維持を判定するため
            sessionStorage.setItem('sensor_permission_active', '1');
            // ★設計変更宣言 (2026-05-14): updateStartButtonsGate の primary フラグ
            //   タスクキル後は sessionStorage がクリア → 次回起動時に必ず許可ページを経由する設計
            sessionStorage.setItem('sensorGranted', '1');
            // ★設計変更宣言 (2026-05-10): 許可後は dl_just_completed flag を削除
            //   (banner 抑制条件を解除・許可されれば banner も不要になる)
            try {
              sessionStorage.removeItem('dl_just_completed');
            } catch (_) {}
            // 2026/05/02：バナーから許可ボタン削除済み・即座に非表示
            const banner = document.getElementById('sensorRestoreBanner');
            if (banner && banner.style.display !== 'none') {
              banner.style.display = 'none';
            }
            // ★設計変更宣言 (2026-05-10): screenBusinessStart の許可ボタンも非表示
            const _btnSP = document.getElementById('btnSensorPermission');
            const _noteSP = document.getElementById('sensorPermissionNote');
            if (_btnSP) _btnSP.style.display = 'none';
            if (_noteSP) _noteSP.style.display = 'none';
            // ★設計変更宣言 (2026-05-13): 許可後に業務開始ボタンを表示
            try {
              updateStartButtonsGate();
            } catch (_) {}
            // GPS も同時起動（2026/05/04 夜・追加）
            // 司さん指示「GPSは許可はずれんって分かったんやけんコードで常に作動するようにしろや」
            try {
              startGPS();
              if (typeof dlog === 'function') dlog('[GPS] requestSensorPermission後に起動');
            } catch (e) {
              console.error('[GPS] 起動エラー:', e);
            }

            // ★設計変更宣言 (2026-05-10): センサー許可後に近隣道路データを先読み
            //   getCurrentPosition で 1 回だけ位置取得 → _autoLoadNearbyRoads で
            //   roads-{pref}.js 5 県分を Worker B に forward
            //   user gesture 経由 (btnSensorPermission 押下) なので iOS PWA でも動作
            try {
              if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                  function (pos) {
                    try {
                      if (pos && pos.coords && typeof _autoLoadNearbyRoads === 'function') {
                        _autoLoadNearbyRoads(pos.coords.latitude, pos.coords.longitude);
                        if (typeof dlog === 'function')
                          dlog('[MM] preload roads after permission grant');
                      }
                    } catch (_) {}
                  },
                  function () {},
                  { enableHighAccuracy: true, timeout: 10000 }
                );
              }
            } catch (_) {}
          } else {
            // 許可失敗（iOSキャンセル or user gesture 不足）：バナーをそのまま表示
            // ★設計変更宣言 (2026-05-10): businessStart 画面では青ボタン表示・orange 抑制
            const _bs = document.getElementById('screenBusinessStart');
            const _onBs = _bs && _bs.style.display !== 'none';
            if (_onBs) {
              const _btn = document.getElementById('btnSensorPermission');
              if (_btn) _btn.style.display = 'block';
              dlog('[GPS] センサー許可失敗・businessStart 中 → 青ボタン表示');
            } else {
              const banner = document.getElementById('sensorRestoreBanner');
              if (banner) {
                banner.style.display = 'block';
              }
              dlog('[GPS] センサー許可失敗・バナー表示');
            }
          }
        });
      }

      // ─── 第1層：センサー permission 再確認（2026/04/30追加） ───
      // iOSのPWAでpermissionが切れる現象をカバー
      // 既に許可済みなら即grantedが返る（ダイアログ出ない・ユーザー体験変わらず）
      // 期限切れの場合は自動でダイアログ → ユーザー許可でセンサー復活
      function refreshSensorPermission() {
        // コンパス permission 再確認
        if (
          typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function'
        ) {
          DeviceOrientationEvent.requestPermission()
            .then((state) => {
              if (state === 'granted') {
                dlog('[GPS] コンパス permission 再確認OK:', state);
              } else {
                // permission切れ → フラグもクリア
                window._compassGranted = false;
                localStorage.removeItem('compass_granted');
                dlog('[GPS] コンパス permission 期限切れ検知:', state);
              }
            })
            .catch((e) => dlog('[GPS] コンパス permission 再確認エラー:', e.message));
        }
        // 加速度 permission 再確認
        if (
          typeof DeviceMotionEvent !== 'undefined' &&
          typeof DeviceMotionEvent.requestPermission === 'function'
        ) {
          DeviceMotionEvent.requestPermission()
            .then((state) => {
              if (state === 'granted') {
                dlog('[GPS] 加速度 permission 再確認OK:', state);
              } else {
                window._motionGranted = false;
                localStorage.removeItem('motion_granted');
                dlog('[GPS] 加速度 permission 期限切れ検知:', state);
              }
            })
            .catch((e) => dlog('[GPS] 加速度 permission 再確認エラー:', e.message));
        }
      }

      // ─── デバイス判定 ───
      // (2026-05-10) const _isIOS / _isAndroid は script 先頭に移動済 (TDZ 対策)

      // 2026/05/02：confirmAndroidSensor 削除（バナーから呼出ボタン削除済み・未使用関数）

      // ─── センサー未許可バナー（起動時・未許可なら毎回表示） ───
      // 2026/04/30 修正：standalone チェック削除（PWA・Safari どちらでも動作）
      //                 drivingState ロジックを統合（重複削除）
      (function () {
        // PC（iOS でも Android でもない）はスキップ
        if (!_isIOS && !_isAndroid) return;

        if (_isAndroid) {
          // Android：自動許可済み
          window._compassGranted = true;
          window._motionGranted = true;
          localStorage.setItem('compass_granted', '1');
          localStorage.setItem('motion_granted', '1');
          // 2026/05/02：confirmAndroidSensor 関数削除に伴い・初回バナー表示時に自動フラグセット
          if (!localStorage.getItem('android_sensor_confirmed')) {
            localStorage.setItem('android_sensor_confirmed', '1');
            // 初回のみバナー表示（一度きり・10秒で自動非表示）
            const banner = document.getElementById('sensorRestoreBanner');
            if (banner) {
              banner.style.display = 'block';
              setTimeout(() => {
                banner.style.display = 'none';
              }, 10000);
            }
          }
          return;
        }

        if (_isIOS && window.navigator.standalone === true) {
          // ★設計変更宣言 (2026-05-10): standalone === true 条件を追加し iOS PWA 限定化
          //   旧: if(_isIOS) のみで Safari 通常モードでも banner 出ていた
          //   新: PWA standalone のみで banner 表示・Safari 通常モードは出さない
          //   本番 (Daikou-app) と同じシンプル仕様に統一
          //   fresh load 判定 + sensor_permission_active のクリアは script 先頭で
          //   済んでいる (showSensorBannerIfNeeded より早く実行する必要があるため)
          if (sessionStorage.getItem('sensor_permission_active') === '1') {
            // 同 session 内 (設定画面遷移後など)：バナー出さない
            return;
          }
          // ★設計変更宣言 (2026-05-10): DL 中 / DL 完了直後は orange banner を出さない
          //   - dl-overlay が表示中 (display:flex) なら DL UI が前面・banner 出すと醜悪
          //   - sessionStorage.dl_just_completed='1' (showCompleteBanner 直後) なら
          //     businessStart 画面遷移後でも一旦 banner 抑制 (許可後にクリアされる)
          const _dlO = document.getElementById('dlOverlay');
          if (_dlO && _dlO.style.display === 'flex') return;
          if (sessionStorage.getItem('dl_just_completed') === '1') return;
          // ★設計変更宣言 (2026-05-10): businessStart 画面では青ボタンを表示・orange のみ抑制
          const _bs = document.getElementById('screenBusinessStart');
          if (_bs && _bs.style.display !== 'none') {
            const _btn = document.getElementById('btnSensorPermission');
            if (_btn) _btn.style.display = 'block';
            return;
          }
          document.getElementById('sensorRestoreBanner').style.display = 'block';
          return;
        }

        // PC：バナー非表示・ブロックなし
        dlog('[GPS] PC：センサースキップ');
      })();

      // ─── PWA起動時センサー状態復元 ───
      // 2026/05/03 修正：iOS PWA では DeviceMotion/Orientation の permission は
      //   session 毎に失効するため、localStorage の値は実態と乖離する。
      //   旧コード：localStorage に '1' があれば window._compassGranted = true 等
      //             → タスクキル後でも「許可済み」扱いでバナー出ず → 司さん「出てこんやないか」
      //   新コード：iOS PWA は起動時必ず未許可扱いから始めて、user gesture
      //             （バナーの「センサーを再起動する」ボタン）で実 permission を再取得する
      //             Android は自動許可なので localStorage 復元のままでOK
      // ─── 起動時の許可フラグ初期化（2026/05/04 夜・修正） ───
      // 5/3 修正：「iOS PWA は起動時必ず未許可扱い」（タスクキル後の問題対策）
      // 5/4 夜の問題：設定画面 → 戻るたびにバナー表示
      //   - settings.html → save → location.href='index.html' は同 session 内のページ遷移
      //   - DeviceMotion permission は同 session 内では維持されている
      //   - なのに無条件 false にしてバナー出てた（過剰反応）
      // 修正方針：sessionStorage を活用
      //   - sessionStorage はタスクキルで消える・ページ遷移で残る性質
      //   - 同 session 内で一度許可済みなら維持
      //   - タスクキル後の新規 session なら未許可扱い（5/3 の意図維持）
      (function () {
        if (window.navigator.standalone !== true) return;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        if (isIOS) {
          // 同 session 内なら sessionStorage に許可マークが残ってる
          if (sessionStorage.getItem('sensor_permission_active') === '1') {
            // ページ遷移後の復帰：permission は維持されてる
            window._compassGranted = true;
            window._motionGranted = true;
          } else {
            // 新規 session（タスクキル後・初回起動）：未許可扱い
            window._compassGranted = false;
            window._motionGranted = false;
          }
          return;
        }
        // Android：自動許可なので localStorage から復元してOK
        if (localStorage.getItem('compass_granted')) window._compassGranted = true;
        if (localStorage.getItem('motion_granted')) window._motionGranted = true;
      })();

