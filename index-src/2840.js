      // ★2026-07-03 自己診断trace(足す①): SWが掴んでるビルド名を window.DK_SW_CACHE に取得★。
      //   trace meta に焼く=旧キャッシュのコードで走ってないかを実機traceで判定できる。
      //   設定画面を開かなくても起動時に一度取る。best-effort(失敗しても距離/課金に無関係)。
      (function () {
        function _fetchSwCache(retries) {
          try {
            if (!('serviceWorker' in navigator)) return;
            var c = navigator.serviceWorker.controller;
            if (!c) {
              if (retries > 0)
                setTimeout(function () {
                  _fetchSwCache(retries - 1);
                }, 1500);
              return;
            }
            var ch = new MessageChannel();
            ch.port1.onmessage = function (ev) {
              if (ev && ev.data && ev.data.type === 'CACHE_NAME' && ev.data.value)
                window.DK_SW_CACHE = ev.data.value;
            };
            c.postMessage({ type: 'GET_CACHE_NAME' }, [ch.port2]);
          } catch (_) {
            /* best-effort */
          }
        }
        if (document.readyState === 'complete') _fetchSwCache(5);
        else
          window.addEventListener('load', function () {
            _fetchSwCache(5);
          });
      })();
