      // ★設計変更宣言 (2026-05-10): 同名 extras をグループ化・押下回数 / 累計を表示
      //   旧: 1 加算 = 1 行、削除は ✕
      //   新: 同名+同金額をグループ化「{name} +¥{amount} ×{count} = ¥{total}」、削除はグループ末尾 1 件
      function renderExtras() {
        const el = document.getElementById('extrasList');
        const lbl = document.getElementById('extrasSectionLabel');
        if (!extras || extras.length === 0) {
          el.innerHTML = '';
          if (lbl) lbl.style.display = 'none';
          return;
        }
        if (lbl) lbl.style.display = 'block';
        // name+amount でグループ化 + 最後の index を保持 (削除時に末尾を消す)
        const groups = new Map();
        extras.forEach((e, i) => {
          const key = e.name + '|' + e.amount;
          if (!groups.has(key)) {
            groups.set(key, { name: e.name, amount: e.amount, count: 0, lastIdx: i });
          }
          const g = groups.get(key);
          g.count++;
          g.lastIdx = i;
        });
        el.innerHTML = Array.from(groups.values())
          .map(
            (g) =>
              `<div class="extra-item" style="display:flex;justify-content:space-between;align-items:center;">
      <span>${g.name}<span style="font-size:11px;color:#8E8E93;margin-left:6px;font-family:'DM Mono',monospace;">×${g.count}</span></span>
      <div style="display:flex;align-items:center;gap:6px;">
        <span>+¥${(g.amount * g.count).toLocaleString()}</span>
        <button class="extra-del-btn" onclick="removeExtra(${g.lastIdx})">✕</button>
      </div>
    </div>`
          )
          .join('');
      }

      function removeExtra(i) {
        extras.splice(i, 1);
        renderExtras();
      }

      // ─── 値引き 一覧表示 + 削除 (追加料金と同型・-¥表示) ───
      function renderDiscounts() {
        const el = document.getElementById('discountsList');
        const lbl = document.getElementById('discountsSectionLabel');
        if (!el) return;
        if (!discounts || discounts.length === 0) {
          el.innerHTML = '';
          if (lbl) lbl.style.display = 'none';
          return;
        }
        if (lbl) lbl.style.display = 'block';
        const groups = new Map();
        discounts.forEach((d, i) => {
          const key = d.name + '|' + d.amount;
          if (!groups.has(key)) {
            groups.set(key, { name: d.name, amount: d.amount, count: 0, lastIdx: i });
          }
          const g = groups.get(key);
          g.count++;
          g.lastIdx = i;
        });
        el.innerHTML = Array.from(groups.values())
          .map(
            (g) =>
              `<div class="extra-item" style="display:flex;justify-content:space-between;align-items:center;">
      <span>${g.name}<span style="font-size:11px;color:#8E8E93;margin-left:6px;font-family:'DM Mono',monospace;">×${g.count}</span></span>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="color:#5856d6;">-¥${(g.amount * g.count).toLocaleString()}</span>
        <button class="extra-del-btn" onclick="removeDiscount(${g.lastIdx})">✕</button>
      </div>
    </div>`
          )
          .join('');
      }
      function removeDiscount(i) {
        discounts.splice(i, 1);
        renderDiscounts();
      }

      function fmt(sec) {
        return (
          Math.floor(sec / 60)
            .toString()
            .padStart(2, '0') +
          ':' +
          (sec % 60).toString().padStart(2, '0')
        );
      }

      // ─── センサー許可チェック共通関数（2026/05/01追加・更新） ───
      // iOS PWA でセンサー未許可なら：
      //   1. requestSensorPermission() 発火（ダイアログ表示・重複防止フラグあり）
      //   2. バナー表示
      //   3. return true でブロック
      // 全ボタン関数の冒頭で「if(blockIfSensorNotGranted()) return;」と呼ぶ
      // 戻り値：true=ブロックした（呼出元は処理中止）/ false=通過OK
      function blockIfSensorNotGranted() {
        // ★設計変更宣言 (2026-05-13): 画面タップ毎に許可/業務開始ボタンの排他表示を再評価
        try {
          if (typeof updateStartButtonsGate === 'function') updateStartButtonsGate();
        } catch (_) {}
        // iOS PWA 以外は常に通過（Android・PC・Safari通常モードは未許可ブロックしない）
        // 2026/05/02：_isIOS 未定義リスク対策で直接判定
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        if (!isIOS) return false;
        if (window.navigator.standalone !== true) return false;
        // ★設計変更宣言 (2026-05-14・フラグ統一): sessionStorage 'sensorGranted' を一次判定に追加
        //   updateStartButtonsGate と blockIfSensorNotGranted の両方が sensorGranted を見るように統一。
        //   後方互換のため sensor_permission_active も OR で見る (旧 onSensorRestoreTap 経路で立つケース対応)
        if (
          sessionStorage.getItem('sensorGranted') === '1' ||
          sessionStorage.getItem('sensor_permission_active') === '1'
        ) {
          window._compassGranted = true;
          window._motionGranted = true;
          return false;
        }
        // 許可済みなら通過
        if (window._compassGranted && window._motionGranted) return false;

        // 未許可：バナー表示 + 「センサーを許可する」青ボタン表示でブロック
        showSensorBannerIfNeeded();
        // ★設計変更宣言 (2026-05-10): user gesture context でない場合は
        //   requestSensorPermission() を自動発火しない (DL 完了 → 自動 onBusinessStart
        //   からの呼出で iOS PWA の reject → orange バナー誤表示を防ぐ)
        //   user gesture 判定: 直近 1 秒以内に画面 onclick が走っていたか
        //   (window._lastUserGestureAt は body click handler で記録)
        const now = Date.now();
        const userGestureRecent =
          window._lastUserGestureAt != null && now - window._lastUserGestureAt < 1000;
        if (userGestureRecent && !window._sensorRequestInFlight) {
          window._sensorRequestInFlight = true;
          try {
            requestSensorPermission();
          } catch (e) {
            console.error('requestSensorPermission error:', e);
          } finally {
            // 連打防止：500ms 後にフラグ解除（ダイアログ処理中の再呼出防止）
            setTimeout(() => {
              window._sensorRequestInFlight = false;
            }, 500);
          }
          if (typeof dlog === 'function') dlog('[Sensor] blocked + dialog fired (user gesture)');
        } else {
          if (typeof dlog === 'function') dlog('[Sensor] blocked (no dialog・user gesture 待ち)');
        }
        return true;
      }

      // バナー表示のみ（ダイアログは発火しない・起動時/画面遷移時用）
      function showSensorBannerIfNeeded() {
        // ★設計変更宣言 (2026-05-10): screenBusinessStart 内の「センサーを許可する」ボタン表示制御も統合
        //   iOS PWA 未許可時のみボタン+説明文を表示・許可後は非表示
        const _btnSP = document.getElementById('btnSensorPermission');
        const _noteSP = document.getElementById('sensorPermissionNote');
        // iOS PWA 以外は表示しない（他環境ではバナー出ない）
        // 2026/05/02：_isIOS が未定義の可能性（呼出順序問題）対策で直接判定
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        if (!isIOS) {
          if (_btnSP) _btnSP.style.display = 'none';
          if (_noteSP) _noteSP.style.display = 'none';
          return;
        }
        if (window.navigator.standalone !== true) {
          if (_btnSP) _btnSP.style.display = 'none';
          if (_noteSP) _noteSP.style.display = 'none';
          return;
        }
        // 2026/05/04 夜・修正：sessionStorage で同 session 内の permission 維持を判定
        //   sensor_permission_active='1' があれば同 session 内 → permission 維持されてる
        if (sessionStorage.getItem('sensor_permission_active') === '1') {
          window._compassGranted = true;
          window._motionGranted = true;
          const banner = document.getElementById('sensorRestoreBanner');
          if (banner && banner.style.display !== 'none') {
            banner.style.display = 'none';
            if (typeof dlog === 'function') dlog('[Sensor] 同session内: バナー非表示');
          }
          if (_btnSP) _btnSP.style.display = 'none';
          if (_noteSP) _noteSP.style.display = 'none';
          return;
        }
        // 許可済みなら：既にバナー出てたら消す（2026/05/02追加・許可後の残留バナー対策）
        if (window._compassGranted && window._motionGranted) {
          const banner = document.getElementById('sensorRestoreBanner');
          if (banner && banner.style.display !== 'none') {
            banner.style.display = 'none';
            if (typeof dlog === 'function') dlog('[Sensor] 許可済み: バナー強制非表示');
          }
          if (_btnSP) _btnSP.style.display = 'none';
          if (_noteSP) _noteSP.style.display = 'none';
          return;
        }
        // ★設計変更宣言 (2026-05-10): v2 flag check を削除し本番と同じシンプル仕様に統一
        //   iOS PWA 未許可時は orange banner を表示 + 青ボタンも表示
        //   (条件は呼出元で iOS/standalone/sessionStorage チェック済み)
        // ★設計変更宣言 (2026-05-10): DL 中 / DL 完了直後は banner 抑制
        //   - dl-overlay 表示中 (display:flex): DL UI 優先で banner 出さない
        //   - sessionStorage.dl_just_completed='1': DL 完了直後の businessStart 画面で
        //     orange banner が即座に出るのを防ぐ (許可後にクリアされる)
        const _dlO2 = document.getElementById('dlOverlay');
        if (_dlO2 && _dlO2.style.display === 'flex') {
          if (typeof dlog === 'function') dlog('[Sensor] DL 中 → banner 抑制');
          return;
        }
        if (sessionStorage.getItem('dl_just_completed') === '1') {
          if (typeof dlog === 'function') dlog('[Sensor] DL 完了直後 → banner 抑制');
          return;
        }
        // ★設計変更宣言 (2026-05-10): businessStart 画面では青ボタンを表示・orange banner のみ抑制
        const _bs = document.getElementById('screenBusinessStart');
        if (_bs && _bs.style.display !== 'none') {
          const _btn = document.getElementById('btnSensorPermission');
          if (_btn) _btn.style.display = 'block';
          if (typeof dlog === 'function')
            dlog('[Sensor] businessStart 中 → 青ボタン表示・orange 抑制');
          return;
        }
        const banner = document.getElementById('sensorRestoreBanner');
        if (banner) {
          banner.style.display = 'block';
          setTimeout(() => banner.scrollIntoView({ behavior: 'smooth', block: 'end' }), 100);
        }
        // 「センサーを許可する」青ボタンも未許可なら常に表示
        if (_btnSP) _btnSP.style.display = 'inline-block';
        if (_noteSP) _noteSP.style.display = 'block';
        if (typeof dlog === 'function') dlog('[Sensor] banner shown');
      }

      // ─── メインボタン ───
      function onMainBtn() {
        // 全ボタン共通：iOS PWA でセンサー未許可ならバナー表示してブロック
        if (blockIfSensorNotGranted()) return;
        // 第1層：iOS PWA で許可済みフラグありの場合、念のため permission 再確認（2026/04/30追加）
        // → granted なら何も起きない（ダイアログ出ない・体験変わらず）
        // → permission期限切れなら自動でダイアログ → ユーザー許可で復活
        if (
          _isIOS &&
          window.navigator.standalone === true &&
          window._compassGranted &&
          window._motionGranted
        ) {
          refreshSensorPermission();
        }
        if (appState === 'idle') {
          // ★較正ゲート(司さん要望2026-06-26): 未較正の車では代行開始(=課金距離)させない=未較正課金ゼロ★
          //   autoCalibK ON×OBD接続中×未較正(calibKs<3窓)のみブロック。業務開始/客まで走るのは可(その間に較正)。
          if (typeof window._calibGateBlocked === 'function' && window._calibGateBlocked()) {
            if (typeof showToastLong === 'function')
              showToastLong(
                'OBD較正中 ' +
                  (window._calibGateProgress ? window._calibGateProgress() : '') +
                  '\nもう少し走ると代行開始できます\n(較正済みになるまで課金は始めません)'
              );
            return;
          }
          // 代行開始
          appState = 'driving';
          extras = [];
          discounts = [];
          surchargeOn = false;
          // UI更新を先に行う
          showScreen('driving');
          document.getElementById('appbarTitle').textContent = '代行中';
          // 仕事開始時刻を記録（自動リセット判定用）
          localStorage.setItem('daikou_last_start', Date.now().toString());
          // ★ R3: Wake Lock API + NoSleep fallback (= 画面消灯防止・user gesture 内で発火)
          acquireWakeLock();
          // 暗転タイマーをクリア・画面を戻す
          if (dimTimer) {
            clearTimeout(dimTimer);
            dimTimer = null;
          }
          document.documentElement.style.filter = '';
          // GPS・計算・Firebase
          startGPS();
          try {
            Meter.start();
          } catch (e) {
            console.error('Meter start error:', e);
          }
          // ★設計変更宣言 (2026-05-15・経由地点 + 住所表示機能):
          //   Meter.start 直後に Business.onTripStart で出発地住所を取得し current_trip を初期化。
          //   現在地は Meter.getState().last_gps (warmup GPS 由来) から取得。null なら住所も null。
          //   絶対ルール準拠: 住所取得失敗でも代行開始は止めない (try/catch で例外を呑む)。
          try {
            if (typeof Business !== 'undefined' && typeof Business.onTripStart === 'function') {
              const _ms = Meter.getState();
              const _lat =
                _ms && _ms.last_gps && typeof _ms.last_gps.lat === 'number'
                  ? _ms.last_gps.lat
                  : null;
              const _lng =
                _ms && _ms.last_gps && typeof _ms.last_gps.lng === 'number'
                  ? _ms.last_gps.lng
                  : null;
              Business.onTripStart(_lat, _lng, null);
            }
            if (typeof updateWaypointCardUI === 'function') updateWaypointCardUI();
          } catch (e) {
            console.error('Business onTripStart error:', e);
          }
          try {
            FB.startSession(Meter.getFareConfig());
          } catch (e) {
            console.error('FB session error:', e);
          }
          // TestMode 走行開始記録は H-3 対応で削除済
          startUiTimer();
          // fareConfig v2: 業務開始で surcharge ボタン群を表示
          try {
            if (typeof renderSurchargeButtons === 'function') renderSurchargeButtons();
          } catch (_) {}
        } else if (appState === 'driving') {
          // 実車中はメインボタン非表示（仕様2026/05/01）→ ここに来ない想定だが保険
        } else if (appState === 'fare') {
          // 支払画面 → 精算終了（onIdle に委譲・既存ロジック流用）
          onIdle();
        }
      }

      // ─── 業務管理ボタン処理（2026/05/01追加） ───

