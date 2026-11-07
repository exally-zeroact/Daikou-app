      // NoSleep自前実装（WakeLock API優先・AudioContextフォールバック）
      class NoSleep {
        constructor() {
          this._wakeLock = null;
          this._audioCtx = null;
          this._enabled = false;
          // ★設計変更宣言 (2026-05-13・#7): _relock を 1 度だけ bind してリスナー leak 防止
          //   旧: enable/disable で this._relock.bind(this) を毎回新生 →
          //       removeEventListener が効かず leak していた
          this._boundRelock = this._relock.bind(this);
        }
        // ★設計変更宣言 (2026-05-13・#7): Android Chrome の OS auto-release 対応
        //   screen lock 等で OS が WakeLock を release した時、画面が visible なら即時再取得。
        //   既存 visibilitychange 経路だけでは「画面 ON のままバックグラウンド化 → 再 visible 時」
        //   しか relock しないため、Android で画面消灯が起きるケースを補完する。
        _attachReleaseRetry(w) {
          if (!w || typeof w.addEventListener !== 'function') return;
          const self = this;
          w.addEventListener('release', function () {
            if (typeof dlog === 'function') dlog('[NoSleep] WakeLock released (OS)');
            if (document.visibilityState === 'visible' && self._enabled) {
              navigator.wakeLock
                .request('screen')
                .then(function (w2) {
                  self._wakeLock = w2;
                  self._attachReleaseRetry(w2);
                  if (typeof dlog === 'function') dlog('[NoSleep] WakeLock 再取得 (release event)');
                })
                .catch(function (e) {
                  if (typeof dlog === 'function') dlog('[NoSleep] 再取得失敗: ' + (e && e.message));
                });
            }
          });
        }
        async enable() {
          if (this._enabled) return;
          // ① WakeLock API（iOS 16.4+ / Chrome 84+）
          if ('wakeLock' in navigator) {
            try {
              this._wakeLock = await navigator.wakeLock.request('screen');
              this._enabled = true;
              dlog('[NoSleep] WakeLock有効');
              // ★設計変更宣言 (2026-05-13・#7): OS auto-release 検知 listener を sentinel に追加
              this._attachReleaseRetry(this._wakeLock);
              // 画面表示時に再取得 (bound ref で leak 防止)
              document.addEventListener('visibilitychange', this._boundRelock);
              return;
            } catch (e) {
              dlog('[NoSleep] WakeLock失敗:', e.message);
            }
          }
          // ② AudioContextフォールバック（iOS 15以前）
          try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
              this._audioCtx = new AC();
              const osc = this._audioCtx.createOscillator();
              const gain = this._audioCtx.createGain();
              gain.gain.value = 0.001; // 極小音（完全無音だとiOSがスリープさせる）
              osc.connect(gain);
              gain.connect(this._audioCtx.destination);
              osc.start();
              this._enabled = true;
              dlog('[NoSleep] AudioContext有効');
              return;
            }
          } catch (e) {
            dlog('[NoSleep] AudioContext失敗:', e.message);
          }
          dlog('[NoSleep] 全フォールバック失敗');
        }
        async _relock() {
          if (document.visibilityState === 'visible' && this._wakeLock) {
            try {
              this._wakeLock = await navigator.wakeLock.request('screen');
              // ★設計変更宣言 (2026-05-13・#7): 再取得した sentinel にも release listener を貼り直す
              this._attachReleaseRetry(this._wakeLock);
            } catch (e) {}
          }
        }
        disable() {
          if (!this._enabled) return;
          document.removeEventListener('visibilitychange', this._boundRelock);
          if (this._wakeLock) {
            try {
              this._wakeLock.release();
            } catch (e) {}
            this._wakeLock = null;
          }
          if (this._audioCtx) {
            try {
              this._audioCtx.close();
            } catch (e) {}
            this._audioCtx = null;
          }
          this._enabled = false;
          dlog('[NoSleep] 解除');
        }
      }
