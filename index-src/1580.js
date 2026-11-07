      // ━━ S1 (2026-05-10): 複数タブ guard ━━
      //   BroadcastChannel で他タブを検知・閲覧専用モード切替
      //   先発タブは継続稼働・後発タブが閲覧専用化
      //   絶対ルール「過剰課金 = クレーム」防止: 同 trip の二重課金を防ぐ
      (function () {
        if (typeof BroadcastChannel === 'undefined') return; // 古いブラウザは guard なし
        const TAB_ID = (function () {
          if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
          return 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        })();
        const ch = new BroadcastChannel('daikome-tab-guard');
        let _readOnly = false;

        function _enterReadOnly() {
          if (_readOnly) return;
          _readOnly = true;
          window._tabReadOnly = true;
          const banner = document.getElementById('multiTabGuardBanner');
          if (banner) banner.style.display = 'block';
          // 業務開始ボタンを無効化
          const startBtn = document.querySelector('.btn-business-start');
          if (startBtn) {
            startBtn.disabled = true;
            startBtn.style.opacity = '0.4';
            startBtn.style.pointerEvents = 'none';
          }
          const resumeBtn = document.getElementById('btnResumeFromStart');
          if (resumeBtn) {
            resumeBtn.disabled = true;
            resumeBtn.style.opacity = '0.4';
            resumeBtn.style.pointerEvents = 'none';
          }
          if (typeof dlog === 'function') dlog('[TabGuard] 閲覧専用モード起動');
        }
        function _exitReadOnly() {
          if (!_readOnly) return;
          _readOnly = false;
          window._tabReadOnly = false;
          const banner = document.getElementById('multiTabGuardBanner');
          if (banner) banner.style.display = 'none';
          const startBtn = document.querySelector('.btn-business-start');
          if (startBtn) {
            startBtn.disabled = false;
            startBtn.style.opacity = '';
            startBtn.style.pointerEvents = '';
          }
          const resumeBtn = document.getElementById('btnResumeFromStart');
          if (resumeBtn) {
            resumeBtn.disabled = false;
            resumeBtn.style.opacity = '';
            resumeBtn.style.pointerEvents = '';
          }
          if (typeof dlog === 'function') dlog('[TabGuard] 閲覧専用モード解除');
        }

        ch.addEventListener('message', function (e) {
          const m = e && e.data;
          if (!m || !m.type) return;
          if (m.tabId === TAB_ID) return; // 自タブの message は無視
          if (m.type === 'tab-open') {
            // 他タブが起動した・自タブが先発なら ack を返して相手を read-only に
            // 自タブが既に read-only なら何もしない (= 先発がさらに優位)
            if (!_readOnly) {
              ch.postMessage({ type: 'tab-ack', tabId: TAB_ID });
            }
          } else if (m.type === 'tab-ack') {
            // 自タブの tab-open に他タブが ack を返した = 先発がいる → 閲覧専用化
            _enterReadOnly();
          } else if (m.type === 'tab-close') {
            // 他タブが閉じた・read-only なら解除
            if (_readOnly) _exitReadOnly();
          }
        });

        // 起動時に他タブの存在をチェック
        ch.postMessage({ type: 'tab-open', tabId: TAB_ID });

        // タブ閉じる時に通知
        window.addEventListener('beforeunload', function () {
          try {
            ch.postMessage({ type: 'tab-close', tabId: TAB_ID });
          } catch (_) {}
        });

        window._daikomeTabId = TAB_ID;
      })();

      // ━━ DataReadyGate (2026-05-26): 初回データ DL 完了まで業務開始系ボタン disabled ━━
      //   司さん指摘 (2026-05-26 実機): dlOverlay は X4 方式 E で Phase A 完了で hide されるが
      //   background load (= 47 県 roads + 282 件 aux) は 33 秒継続する。
      //   その間に「センサーを許可」「業務開始」「代行開始」 が押せると
      //   不完全データで業務開始 → 住所取得失敗 / MM 失敗 リスク。
      //
      //   対応:
      //     ・起動時 marker (= localStorage daikome_warmup_v1) 確認・あれば即 active (= 2 回目以降)
      //     ・なし (= 初回) → 全 5 ボタン disabled + 進捗 hint 表示
      //     ・window._mmPipeline._bgLoadDone を 1 秒 polling
      //     ・完了で 全 5 ボタン active + 「準備完了」 3 秒表示 → fade out
      //
      //   絶対ルール準拠:
      //     ・mm-data-pipeline.js / sw.js: 1byte 不変 (= 既存 _bgLoadDone field 参照のみ)
      //     ・calcFare / distance_m / running gate / Worker B: 1byte 不変
      //     ・お節介バナー禁止: 機能要件 (= 必須表示) で抵触なし
      //     ・JS コメント内バッククォート: 禁止遵守 (= シングルクォートのみ)
      //
      //   既存 TabGuard (= L3478) と同じ disabled パターン (= disabled 属性 + opacity 0.4 + pointer-events none)
      //   既存 dlOverlay と同じく timeout なし (= オフライン哲学: 初回 DL は通信前提・既存 enqueueRetry で救済)
      (function setupDataReadyGate() {
        const STORAGE_KEY = 'daikome_warmup_v1';
        const POLL_INTERVAL_MS = 1000;
        const TOTAL_FILES = 47 + 282; // 47 県 roads + 282 件 aux (= mm-data-pipeline.js 仕様)
        let _gateActive = false;
        let _pollTimer = null;

        // ★2026-08-07 実バグ修正: 押せないのに見た目が普通のままだった★
        //   旧: ここで el.style.opacity='0.4' を直接書いていた。
        //       ところが _updateCalibGate (較正ゲート) が同じボタンに
        //       el.style.opacity = '' を毎回書き込むため ★薄さが即座に消される★。
        //       結果 ＝ 見た目は普通の青いボタン・押しても何も起きない
        //       （実測: 版がズレた状態で opacity=1 / pointer-events=none / disabled=true）。
        //   新: class を付け外しする。CSS 側を !important にしてあるので
        //       あとから inline style を書かれても薄さが消えない。
        function _applyDisabled(el, disabled) {
          if (!el) return;
          if (disabled) {
            el.disabled = true;
            el.classList.add('dk-gate-off');
          } else {
            el.disabled = false;
            el.classList.remove('dk-gate-off');
            el.style.opacity = '';
            el.style.pointerEvents = '';
          }
        }

        function _setButtonGate(disabled) {
          // 個別 id: btnSensorPermission / btnResumeFromStart / btnMain (= landscape 代行開始)
          const ids = ['btnSensorPermission', 'btnResumeFromStart', 'btnMain'];
          // class: .btn-business-start (= 業務開始) / .btn-main-idle-portrait (= portrait 代行開始)
          const sels = ['.btn-business-start', '.btn-main-idle-portrait'];
          ids.forEach(function (id) {
            _applyDisabled(document.getElementById(id), disabled);
          });
          sels.forEach(function (sel) {
            const list = document.querySelectorAll(sel);
            for (let i = 0; i < list.length; i++) _applyDisabled(list[i], disabled);
          });
        }

        function _setHint(text, kind) {
          const el = document.getElementById('dataReadyHint');
          if (!el) return;
          if (!text) {
            el.style.display = 'none';
            return;
          }
          el.textContent = text;
          el.style.display = 'block';
          // kind: 'progress' (青) / 'complete' (緑)
          if (kind === 'complete') {
            el.style.color = '#34c759';
            el.style.background = 'rgba(52, 199, 89, 0.1)';
          } else {
            el.style.color = '#007aff';
            el.style.background = 'rgba(0, 122, 255, 0.08)';
          }
        }

        function _calcProgress() {
          try {
            if (!window._mmPipeline || !window._mmPipeline.stats) return null;
            const s = window._mmPipeline.stats;
            const rawDone = (s.roadsOk || 0) + (s.auxOk || 0);
            // ★司さん2026-06-27: 定数329は古く実ロードは376まで続く→従来は329で100%表示後も
            //   読み込み継続=「100%で止まって遅い」誤認。完了(_bgLoadDone)まで最大99%・完了で100%に
            //   して、100%=実完了=ボタン解除と同時にする(体感ラグ解消)。fraction(376/329)も廃止。
            const pct = _checkBgLoadDone()
              ? 100
              : Math.min(99, Math.round((rawDone / TOTAL_FILES) * 100));
            return { pct: pct };
          } catch (_) {
            return null;
          }
        }

        function _checkBgLoadDone() {
          try {
            return !!(window._mmPipeline && window._mmPipeline._bgLoadDone === true);
          } catch (_) {
            return false;
          }
        }

        function _markerOk() {
          try {
            const m = localStorage.getItem(STORAGE_KEY);
            if (!m) return false;
            const p = JSON.parse(m);
            const expected = (window.DataRegistry && window.DataRegistry.VERSION) || '0';
            return !!(p && p.version === expected);
          } catch (_) {
            return false;
          }
        }

        function _isStandalone() {
          try {
            return (
              window.navigator.standalone === true ||
              (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
            );
          } catch (_) {
            return false;
          }
        }

        function _updateProgress() {
          const p = _calcProgress();
          if (p) {
            _setHint('📥 初回データ準備中 ' + p.pct + '%', 'progress');
          } else {
            _setHint('📥 初回データ準備中...', 'progress');
          }
        }

        function _releaseGate() {
          if (!_gateActive) return;
          _gateActive = false;
          if (_pollTimer) {
            clearInterval(_pollTimer);
            _pollTimer = null;
          }
          _setButtonGate(false);
          _setHint('✅ 準備完了', 'complete');
          setTimeout(function () {
            _setHint(null);
          }, 3000);
          if (typeof dlog === 'function')
            dlog('[DataReadyGate] 全データ準備完了・ボタン active 化');
        }

        function _engageGate() {
          if (_gateActive) return;
          _gateActive = true;
          _setButtonGate(true);
          _updateProgress();
          if (typeof dlog === 'function') dlog('[DataReadyGate] 初回 DL 中・ボタン disabled');
          _pollTimer = setInterval(function () {
            // ★2026-08-08: 印が合った時点でも開ける★
            //   _markerOk() は DataRegistry の版と比べる。DataRegistry が★遅れて来る★と
            //   起動時の判定では「版が違う」になってゲートが閉じ、道データが既に揃っている起動では
            //   _bgLoadDone が来ないので ★二度と開かなかった★（＝代行開始が押せないまま）。
            //   ここで毎秒 印を見直すことで、遅れて来ても必ず開く。
            if (_checkBgLoadDone() || _markerOk()) {
              _releaseGate();
            } else {
              _updateProgress();
            }
          }, POLL_INTERVAL_MS);
        }

        function _init() {
          // 非 PWA (= ブラウザ閲覧) は・dlOverlay と同じく gate skip (= 業務しない前提)
          if (!_isStandalone()) {
            if (typeof dlog === 'function') dlog('[DataReadyGate] 非 standalone・gate skip');
            return;
          }
          // 2 回目以降 (= marker あり) は・gate skip (= 起動最速化 方式 E ec61fff4 と整合)
          if (_markerOk()) {
            if (typeof dlog === 'function')
              dlog('[DataReadyGate] marker あり・gate skip (2 回目以降)');
            return;
          }
          // 既に bg load 完了している場合 (= race 救済) も skip
          if (_checkBgLoadDone()) {
            if (typeof dlog === 'function') dlog('[DataReadyGate] 既に bg 完了・gate skip');
            return;
          }
          // 初回 DL 中: gate engage
          _engageGate();
        }

        // _mmPipeline は・index.html L5496 で・window._mmPipeline = new MMDataPipeline(...) で初期化
        // _init は・DOM 構築済 + _mmPipeline 初期化済 の・両方を待つ必要あり
        function _scheduleInit() {
          let _tries = 0;
          const _waitTimer = setInterval(function () {
            _tries++;
            // ★2026-08-08: DataRegistry も待つ★
            //   _init() は _markerOk() で版を比べて「掛けるか掛けないか」を決める。
            //   DataRegistry がまだ無いと比べる相手が '0' になり、★正常な端末でもゲートが閉じる★。
            //   決める前に来るのを待つ（来なくても _tries の上限で必ず先へ進む＝止まらない）。
            if ((window._mmPipeline && window.DataRegistry) || _tries > 30) {
              clearInterval(_waitTimer);
              _init();
            }
          }, 500);
        }

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', _scheduleInit);
        } else {
          _scheduleInit();
        }
      })();

      // ━━ S2 業務開始忘れ警告: 2026-05-23 Phase 1 で・お節介ルール適用・完全削除 ━━
      //   旧仕様 (2026-05-10): GPS 5km/h+ 10 秒継続 + 業務外 で・「業務開始していますか?」問いかけ表示
      //   削除理由: 「お節介バナー全面禁止」恒久ルール (= 2026-05-23 制定) 該当
      //   業務開始フローへの影響: なし (= 既存の・業務開始 button 経路 onBusinessStart() で・通常 trigger)

      // ━━ S3 (2026-05-10): 1 trip 上限警告 (500km 超) ━━
      let _tripLimitWarningShown = false;
      function _checkTripLimit() {
        if (typeof Meter === 'undefined') return;
        const state = Meter.getState();
        if (!state.running) {
          if (_tripLimitWarningShown) {
            const b = document.getElementById('tripLimitWarningBanner');
            if (b) b.style.display = 'none';
            _tripLimitWarningShown = false;
          }
          return;
        }
        if (state.distance_m > 500000 && !_tripLimitWarningShown) {
          const b = document.getElementById('tripLimitWarningBanner');
          if (b) b.style.display = 'block';
          _tripLimitWarningShown = true;
          if (typeof dlog === 'function') dlog('[TripLimit] 500km 超過警告表示');
        }
      }
      // 30 秒ごとにチェック
      setInterval(_checkTripLimit, 30000);
