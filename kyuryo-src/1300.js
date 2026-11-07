  // ============================================================
  // ★★従業員へ 配る（QR・URL・全員分の印刷・作り直す）★★ 2026-09-03
  //   ★秘密（初回コード）は 窓に 出していない★ので ★倉庫の 関数から 受け取る★。
  //   ★お金には 触りません★（配る為の 鍵だけ）
  // ============================================================
  var HAIFU = [];

  function haifuUrl(x) {
    // ★配る URL★ … 同じ画面の ★本人モード★へ（?t= と 初回コード ?c=）
    //   ★初回コードは パスワードを 決めていない人だけ★（決めた人には 付けない）
    // ★★先は いつも 事務所の 公開の 住所★★ 2026-10-19（司さん「QRも送るもおれのパソコンがネットに
    //   繋がってないと使えん仕様にすんなや ほかのユーザーが使えるように考えろや」）
    //   ★前★ 今 開いている 画面の 住所（location.href）＝パソコンの 中や 別の 住所から 開くと そこを 指した
    //   ★今★ DKConfig.OFFICE_BASE（テスト線は テストの 住所・本番は 本番の 住所＝1か所で 決まる）
    //   読めない 時だけ 今の 住所（前と 同じ）
    var ofc = window.DKConfig && window.DKConfig.OFFICE_BASE;
    var b = ofc
      ? String(ofc).replace(/\/+$/, '') + '/kyuryo.html'
      : location.href.split('?')[0].split('#')[0];
    // ★LINE の 中の ブラウザで 開かない★ 2026-11-01（司さん「他のサービスの扱いを調べろ」）
    //   LINE の トークで 押すと LINE の 中の ブラウザで 開く＝PDF の 保存（blob の a download）が 効かない 端末が 在る
    //   （Android の WebView は blob: を 落とせない）。LINE 公式の openExternalBrowser=1 を 付けると
    //   Safari／Chrome で 開く（LINE から 開く 全部の URL で 効く・LIFF だけ 効かない＝うちは LIFF でない）。
    //   カメラの QR・メール等 LINE 以外では 何も しない 字（本人の 画面は t と c だけ 読む）
    return (
      b +
      '?t=' +
      encodeURIComponent(x.token) +
      (x.init_code ? '&c=' + encodeURIComponent(x.init_code) : '') +
      '&openExternalBrowser=1'
    );
  }

  function qrSvg(text, cell) {
    try {
      var qr = window.qrcode(0, 'M');
      qr.addData(String(text));
      qr.make();
      return qr.createSvgTag({ cellSize: cell || 4, margin: 2 });
    } catch (e) {
      return '';
    }
  }

