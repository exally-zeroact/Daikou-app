      (function () {
        try {
          // ★2026-07-03 実機事故の根治: 永続OFFキーを廃止★。
          //   旧: ?autocalibk=off が localStorage 'DK_AUTO_CALIB_K_OFF' に永続 → 一度踏むと
          //   どのバージョンに更新しても autoCalibK が黙って無効化され、生OBD∫vで過小課金(事故の真因)。
          //   新: (a)起動毎にOFFキーを必ず消す=焼き付き自動治癒 (b)?autocalibk=off はこのセッション
          //   限りのデバッグ用(永続させない) (c)ドライバーはURLに何も付けなくてもKが常時ON。
          try {
            localStorage.removeItem('DK_AUTO_CALIB_K_OFF'); // ★焼き付き治癒(既存の永続OFFを解除)
          } catch (_) {
            /* best-effort */
          }
          var p = new URLSearchParams(location.search).get('autocalibk');
          window.DK_AUTO_CALIB_K = p !== 'off'; // 素で常時ON。?autocalibk=off はセッション限定OFF(永続なし)。
        } catch (_) {
          window.DK_AUTO_CALIB_K = true;
        }
      })();
