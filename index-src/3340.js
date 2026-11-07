      // ─── 復元時のセンサー再起動（2026/05/02・最適化版） ───
      // 業務中タスクキル → 起動 → 復元 → このボタンを司さんが押す
      // onclick イベント内で同期的に requestPermission を呼ぶことで user gesture が確実に伝わる
      // 押した瞬間に全部復活：許可ダイアログ → リスナー再登録 → NoSleep起動
      function onSensorRestoreTap() {
        if (typeof dlog === 'function') dlog('[復元] センサー再起動ボタン押下');

        // ★ R3: Wake Lock API + NoSleep fallback (= user gesture 内で発火)
        acquireWakeLock();

        // DeviceOrientation 許可（同期的に呼ぶ・user gesture 必須）
        if (
          typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function'
        ) {
          DeviceOrientationEvent.requestPermission()
            .then((state) => {
              if (typeof dlog === 'function') dlog('[復元] コンパス許可: ' + state);
              if (state === 'granted') {
                window._compassGranted = true;
                localStorage.setItem('compass_granted', '1');
                // 2026/05/04 夜・追加：同 session 内のページ遷移で permission 維持を判定するため
                if (window._motionGranted) {
                  sessionStorage.setItem('sensor_permission_active', '1');
                  // ★設計変更宣言 (2026-05-14・フラグ統一): sensorGranted も同時にセット
                  sessionStorage.setItem('sensorGranted', '1');
                }
                // リスナー再登録
                if (typeof GPS !== 'undefined' && typeof GPS.startCompass === 'function') {
                  GPS.startCompass();
                }
                // 2026/05/04 夜・追加：許可完了後にバナー強制非表示（ダイアログ中の再表示対策）
                const banner = document.getElementById('sensorRestoreBanner');
                if (banner) banner.style.display = 'none';
              }
            })
            .catch((e) => {
              if (typeof dlog === 'function') dlog('[復元] コンパス許可エラー: ' + e.message);
            });
        }

        // DeviceMotion 許可（同期的に呼ぶ・user gesture 必須）
        if (
          typeof DeviceMotionEvent !== 'undefined' &&
          typeof DeviceMotionEvent.requestPermission === 'function'
        ) {
          DeviceMotionEvent.requestPermission()
            .then((state) => {
              if (typeof dlog === 'function') dlog('[復元] 加速度許可: ' + state);
              if (state === 'granted') {
                window._motionGranted = true;
                localStorage.setItem('motion_granted', '1');
                // 2026/05/04 夜・追加：同 session 内のページ遷移で permission 維持を判定するため
                if (window._compassGranted) {
                  sessionStorage.setItem('sensor_permission_active', '1');
                  // ★設計変更宣言 (2026-05-14・フラグ統一): sensorGranted も同時にセット
                  sessionStorage.setItem('sensorGranted', '1');
                }
                // リスナー再登録
                if (typeof GPS !== 'undefined' && typeof GPS.startMotion === 'function') {
                  GPS.startMotion();
                }
                // 2026/05/04 夜・追加：許可完了後にバナー強制非表示（ダイアログ中の再表示対策）
                const banner = document.getElementById('sensorRestoreBanner');
                if (banner) banner.style.display = 'none';
              }
            })
            .catch((e) => {
              if (typeof dlog === 'function') dlog('[復元] 加速度許可エラー: ' + e.message);
            });
        }

        // バナー非表示
        const banner = document.getElementById('sensorRestoreBanner');
        if (banner) banner.style.display = 'none';

        // GPS も同時に起動（2026/05/04 夜・追加）
        // 司さん指示：「GPSは許可はずれんって分かったんやけんコードで常に作動するようにしろや」
        // センサー許可した瞬間から GPS も動く（業務全体で総走行距離計測のため）
        try {
          startGPS();
          if (typeof dlog === 'function') dlog('[復元] GPS 起動');
        } catch (e) {
          console.error('[復元] GPS起動エラー:', e);
        }
      }

      // ─── 設定読み込み ───
      function loadSettings() {
        // ★★★代行の 距離係数は ★一番 先に★ 当てる★★★ 2026-09-06（司さん「距離が少ない」）
        //   ★なぜ ここに 移したか（実測で 見つけた 落とし穴）★
        //     この係数は 前は ★この関数の 終わりの方（旧7620行）★で 当てていました。
        //     ところが 手前に ★try で 守られていない `JSON.parse`★ が 在ります
        //     （`daikou_settings` を 読む所）。そこが 1回でも こければ
        //       ・呼ぶ側（旧10418行）が try/catch で ★黙って 飲み込む★
        //       ・⇒ ★この行まで 来ない★ ⇒ 係数は 既定の ★1.0 のまま★
        //     ★1.0 のままだと 2つ 同時に 起きます★
        //       ①代行の +0.85% が 乗らない
        //       ②js/meter.js:137 `daikouMode: _daikouDistFactor > 1.0` が ★false★ に なり、
        //         pipeline の OBD天井の 分位が ★p50 → p25★ に 落ちる。
        //         ★その差は コードに 実測で 書いてある＝「実走検証で -16%判明」★
        //         （js/pipeline-distance.js 199行）
        //     ⇒★★合わせて 約 -17%。画面にも 記録にも 何も 出ません★★
        //   ★だから 何より 先に 当てる★＝手前に 何が 在っても 影響を 受けない。
        //   ★数字は 1つも 変えていません（1.0085 のまま・当てる 順番だけ）★
        if (typeof Meter !== 'undefined' && typeof Meter.setDaikouDistanceFactor === 'function') {
          Meter.setDaikouDistanceFactor(1.0085);
        }
        // ★★料金表（2026-08-30・Firebase → Supabase）★★
        //   ①★まず 手元の 写しを 当てる（通信 0回）★＝★圏外でも 料金が 出る★
        //   ②その後で 倉庫から 取り直す。取れなければ ①のまま（★写しは 消さない★）
        try {
          Meter.setFareConfig(FareConfigStore.yomuOffline().config);
        } catch (e) {
          console.error('[料金表] 写しの読み込み失敗:', e);
        }
        try {
          FareConfigStore.torikomu().then((r) => {
            if (r && r.ok) Meter.setFareConfig(r.config);
          });
        } catch (e) {
          console.error('[料金表] 取り直し失敗:', e);
        }

        // ★設計変更宣言 (2026-05-10): デフォルト extras 全削除
        //   旧: 外車/MT車/左ハンドル/深夜割増/迎車料金/キャンセル料 をプリセット
        //   新: 空配列・ユーザーが fare.html や追加料金モーダルから自由に追加
        if (localStorage.getItem('daikou_extras') === null) {
          localStorage.setItem('daikou_extras', JSON.stringify([]));
        }
        if (localStorage.getItem('daikou_discounts') === null) {
          localStorage.setItem('daikou_discounts', JSON.stringify([])); // ★値引きプリセット(空で開始)
        }

        // ★★ここで こけても 後ろを 止めない★★ 2026-09-06（司さん）
        //   `daikou_settings` が 壊れていると JSON.parse が こけます。
        //   前は それが ★関数ごと 落とし★、呼ぶ側の try/catch が 黙って 飲み込み、
        //   後ろの 設定が まるごと 当たっていませんでした（★何も 出ない★）。
        //   ⇒ ★ここだけで 受け止めて 先へ 進む★／★出来なかった事は 記録に 出す★
        const s = localStorage.getItem('daikou_settings');
        try {
          if (s) {
            const obj = JSON.parse(s);
            surchargeEnabled = obj.surchargeEnabled || false;
            surchargeRate = obj.surchargeRate || 1.2;
            vehicleId = obj.vehicleId || 'v1';
            // localStorageから料金設定も読み込む（Firebase未接続時の保険）
            if (obj.baseFare) {
              Meter.setFareConfig({
                base_fare: obj.baseFare || 1300,
                base_distance_m: obj.baseDistanceM || 1000,
                add_distance_m: obj.addDistanceM || 420,
                add_fare: obj.addFare || 100,
              });
            }
          }
        } catch (e) {
          // ★黙って 飲み込まない★（何が こけたか 分かるように 残す）
          console.error('[設定] daikou_settings が 読めません:', e);
        }
        // ★代行距離係数(現行の狙い=DM Light基準 +0.2%着地)をシステム固定値で自動適用 (2026-06-18/06-22/07-04更新)★:
        //   距離計算式に乗算し distance_m をメーター機(随伴車DM)基準に着地→料金/表示/総走行が追従。料金には係数を掛けない。
        //   ※現行の狙いは「DM+0.2%」(DM Light基準・過大ゼロ非拘束)。以下は逆算根拠のchangelog。
        //   旧 1.011=メーター−0.2%(2026-06-17)。旧「0%へ」は2026-06-22時点の根拠(現行は+0.2%狙い)。
        //   ★旧1.013★: モコ(MG33S)"factory K経路"実機(2026-06-22)で +0.2% 逆算した値。
        //   ★2026-07-04 再較正 → 1.0085★: その後 autoCalibK(1km自動較正・学習K≒1.022)が距離の
        //   本線になりベースが上がったため、旧1.013では実機モコで平均+0.64%(業務別 +0.39/+0.99/+0.56%・
        //   e92a515実走trace実測)に浮いた。autoCalibK経路のベース(平均DM-0.65%相当)に合わせ 1.013→1.0085
        //   に再較正 → projection: 0.99353×1.0085=1.00197=+0.20%(=DM Light基準ど真ん中)。下記7062の予告通り。
        //   テストツール tests/tools/daiko-dm-target-gate.js で実画面値較正。操作者は触らない。
        //   ★タクシー認定運用は 1.0(過大ゼロ法要件・distance_m≤真距離)へ=この行を1.0に=コード/管理者変更★。
        //   ※注: モード変更(autoCalibK/p50等)後は実走traceのdiag+DM実測で本係数を再較正する(今回がその再較正)。
        if (typeof Meter !== 'undefined' && typeof Meter.setDaikouDistanceFactor === 'function') {
          Meter.setDaikouDistanceFactor(1.0085);
        }
        const td = localStorage.getItem('daikou_today');
        if (td) {
          const obj = JSON.parse(td);
          const today = new Date().toDateString();
          if (obj.date === today) {
            todayDist = obj.dist || 0;
            todayCount = obj.count || 0;
            todayFareYen = obj.fare || 0;
            lastGoodTotalM = obj.total || 0; // ★総走行距離の命綱も戻す★
          }
        }
        // ★Firebase が 止まっても ここで 落ちない★ 2026-09-01
        //   ★実測★… FB を 消して この行を 呼ぶと ReferenceError で 落ち、
        //   ★この下の「今日の 距離」の 表示まで 止まりました★。
        //   他の 12か所は 元から 守られていたので ★同じ形★に 揃えます。
        //   （料金・距離には 影響 ありません＝FB を 消しても calcFare は 同じ 2,300円）
        if (typeof FB !== 'undefined' && typeof FB.setVehicleId === 'function') {
          try {
            FB.setVehicleId(vehicleId);
          } catch (_) {
            /* noop - 送れなくても 業務は 続ける */
          }
        }
        document.getElementById('todayDist').textContent = (todayDist / 1000).toFixed(2);
        document.getElementById('todayCount').textContent = todayCount;
        updateSurchargeBadge(); // ★割増バッジの表示/非表示 + 青バー1段クラスを一括同期★

        // ★設計変更宣言 (2026-05-14): autoResetCheck 撤去・代行開始ボタン押下時リセットに統一
        // リロード復元チェック
        checkDrivingRestore();
        // 古い日付の履歴キーを削除（今日以外は不要）
        cleanOldHistoryKeys();

        // ★設計変更宣言 (2026-05-14・MA-8): loadUserRegions() 撤去
        //   daikou_user_regions / daikou_user_auto_region は旧 settings.html (現 redirect stub) で
        //   書込まれていた deprecated localStorage キー。現行 UI には書込経路がなく永続的に null。
        //   関数本体は _forwardRoadsToMmWorker (C11 大改修で削除済) を呼ぶため、もし saved が
        //   非 null なら ReferenceError で落ちる dead code でもあった。
        //   活動エリアロードは MMDataPipeline (C10) に完全移管済。

        // P2 (2026-05-09): 起動時 last-GPS warm-up
        //   localStorage から最後の GPS を復元 → 即時 _autoLoadNearbyRoads 発火
        //   → センサー許可前 (= GPS 未取得) でも近隣 5 県の roads を script タグ load
        //   → 業務開始ボタン押下時には Worker B に decoders 充填済み
        try {
          const lastDriving = localStorage.getItem('daikou_driving_state');
          const lastBusiness = localStorage.getItem('daikou_business_state');
          let lat = null,
            lng = null;
          if (lastDriving) {
            const d = JSON.parse(lastDriving);
            if (d && typeof d.last_lat === 'number' && typeof d.last_lng === 'number') {
              lat = d.last_lat;
              lng = d.last_lng;
            }
          }
          if ((lat == null || lng == null) && lastBusiness) {
            const b = JSON.parse(lastBusiness);
            if (b && b.last_gps && typeof b.last_gps.lat === 'number') {
              lat = b.last_gps.lat;
              lng = b.last_gps.lng;
            }
          }
          if (lat != null && lng != null) {
            // ★設計変更宣言 (2026-05-10): 旧 setTimeout 500ms → 0ms に短縮
            //   _mmWorker は line 1599 _setupMmWorker で初期化済・RegionLoader は
            //   src 経由 load 済 → 500ms 待つ理由なし
            //   _autoLoadNearbyRoads は _forwardedPrefs.has で重複防止しているので
            //   line 1600 fast-path との二重呼出も safe
            // ★設計変更宣言 (2026-05-10): iOS の場合は PWA standalone のみ実行
            //   iOS Safari (非 PWA) では GPS 関連処理 skip
            const _ls_isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            const _ls_gpsAllowed = !_ls_isIOS || window.navigator.standalone === true;
            if (_ls_gpsAllowed) {
              setTimeout(function () {
                if (typeof _autoLoadNearbyRoads === 'function') {
                  _autoLoadNearbyRoads(lat, lng);
                  if (typeof dlog === 'function')
                    dlog(
                      '[boot] roads warm-up at last GPS ' + lat.toFixed(4) + ',' + lng.toFixed(4)
                    );
                }
              }, 0);
            }
          }
        } catch (e) {
          if (typeof dlog === 'function') dlog('[boot] warm-up error: ' + e.message);
        }
      }

      // ★設計変更宣言 (2026-05-14・MA-8): loadUserRegions 関数定義を撤去。
      //   daikou_user_regions / daikou_user_auto_region は旧 settings.html (現 redirect stub) で
      //   書込まれていた deprecated localStorage キー。MMDataPipeline (C10) に役割移管済で本関数は
      //   完全に dead code (内部の _forwardRoadsToMmWorker は C11 で削除済のため呼出時に
      //   ReferenceError も内包していた)。

