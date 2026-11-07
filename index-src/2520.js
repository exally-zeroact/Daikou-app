      if (typeof DaikomeABConfig !== 'undefined') {
        try {
          // ★設計変更宣言 (2026-05-18・㉒ 配線完成): Firebase RC instance を取得して
          // initABConfig({ firebaseRC }) に渡す。これで Remote Config console の値が
          // hash assign より優先される (= サーバー override 有効化)。
          var __rcInstance = null;
          if (typeof firebase !== 'undefined' && typeof firebase.remoteConfig === 'function') {
            try {
              __rcInstance = firebase.remoteConfig();
              // 開発中は短い fetch interval・本番は 1 時間 (= Firebase 推奨)
              __rcInstance.settings = {
                minimumFetchIntervalMillis: location.hostname === 'localhost' ? 0 : 3600000,
                fetchTimeoutMillis: 60000,
              };
              // default 値も注入 (= fetch 前にも hash assign 経由で動作可能)
              __rcInstance.defaultConfig = {
                viterbi_n_ios: 10,
                fare_display_mode: 'classic',
                warmup_retry_count: 3,
              };
            } catch (e) {
              console.warn('[ABConfig] Firebase RC instance 取得失敗:', e.message);
              __rcInstance = null;
            }
          }
          var __abPromise = DaikomeABConfig.initABConfig({ firebaseRC: __rcInstance });
          if (__abPromise && typeof __abPromise.catch === 'function') {
            __abPromise.catch(function (e) {
              console.warn('[ABConfig] init failed:', e.message);
            });
          }
        } catch (e) {
          console.warn('[ABConfig] init error:', e.message);
        }
      }
