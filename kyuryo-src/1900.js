  // ★★配る 札を 描き直す★★ 2026-10-24（給料の 設定の 配る 一覧は 外した＝司さん「配るは明細からできるからのけろ」）
  //   今 描く 所は 退職者ページの 開いた 配る 箱と、明細の 見せる 窓（作り直しの 後）だけ
  function renderHaifu() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-yame-box]'), function (box) {
      if (box.style.display === 'none') return;
      yameHaifuNuru(box, box.getAttribute('data-yame-box'));
    });
  }

  // ★配ってある人の 札★（前と 同じ 中身）
  function haifuFuda(x) {
    return (function (x) {
      var url = haifuUrl(x);
      return (
        '<div class="card" style="margin:10px 0 0">' +
        '<div style="font-weight:800">' +
        esc(x.name || '') +
        '　殿' +
        (yametaHito(x.employee_id)
          ? '<span class="note" style="margin-left:6px">（退職）</span>'
          : '') +
        '</div>' +
        '<div class="note" style="margin:2px 0 8px">' +
        (x.tomatta
          ? '<span class="rolewarn">3回 続けて 間違えて 止まっています。「作り直す」で 新しい リンク（QR）を 配ってください（古い リンクは 使えなく なります）。</span>'
          : x.pw_ari
            ? 'もう 自分の パスワードを 決めています（このQRは そのまま 使えます）'
            : 'まだ パスワードを 決めていません（このQRから 決めます）') +
        '</div>' +
        // ★★一覧には QR も URL も 出しません★★ 2026-09-04（司さん）
        //   「★一気に 見せる メリット ないやろが★」
        //   ・その場で 読ませるのは ★1人ずつ（大きく 見せる）★
        //   ・一覧の 小さい QR（152px）は ★離れて 読めない★＝使い道が 無い
        //   ・★リンクが 鍵★＝7人ぶんを 一度に 出すと
        //     ★その場に 居る 誰でも 全員ぶんを 撮れる★
        //   ⇒ 一覧は ★名前と 様子と ボタンだけ★。URL は「送る」で 渡す。
        '<div>' +
        '<div style="flex:1 1 200px;min-width:0">' +
        // ★★初回コードは 画面に 出しません★★ 2026-09-04（司さん）
        //   「初回コードなんか Rakunally でやってなかろが」
        //   ★Rakunally の 実物（kyuyo/js/app.js:4301）★ も
        //   ★コードそのものは 1文字も 出さず★、?c= に 埋めるだけです。
        //   ⇒ ★出すと 事務所の 人が 見えてしまう★／★本人が 打つ 必要も 無い★
        //   ⇒ ★渡すのは リンク（QR）1つだけ★＝★リンクが 鍵★
        (x.init_code
          ? '<div class="note" style="margin:0 0 6px">この リンク（QR）を 開くと 本人が パスワードを 決めます。<b>リンクは 本人にだけ 渡してください</b>（リンクが 鍵です）。</div>'
          : '') +
        // ★★本命は これ＝その場で 読ませる★★ 2026-09-04（司さん）
        //   「QRコードは 見せるだけで ええやろが」
        //   ★紙も 送信も 要りません★。押すと 画面いっぱいの QR が 出ます。
        // ★★ボタンは 箱に 入れる★★ 2026-09-04（司さん）
        //   「前から 色んな アプリで いよるけど なんで ボタンが 引っ付くんど」
        //   ★裸で 並べると 折り返した時に 上下が くっつきます★
        //   （字の 間の 空白 1つ ぶんしか 空かない・縦は 0）
        //   ⇒ ★flex + gap の 箱に 入れる★＝横も 縦も 同じだけ 空く
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:2px">' +
        '<button class="btn chi" type="button" data-hmise="' +
        esc(x.employee_id) +
        '">大きく 見せる</button>' +
        // ★★「コピー」→「送る」★★ 2026-09-04（司さん「送るに 変えて」）
        //   ・使える台（スマホ等）… ★共有シートが 出る★（LINE・メール等を 選ぶ）
        //   ・使えない台 ………… ★コピーに 落ちる★（今までと 同じ）
        //   ★誰の 分か 名前も 一緒に 送る★（渡し間違いを 防ぐ）
        // ★data-url-mihari … 見張りが 中身を 確かめる 為の 印★
        //   （画面には 出しません／送る 中身は haifuOkuru が 作ります）
        '<button class="btn sub2 chi" type="button" data-hokuru="' +
        esc(x.employee_id) +
        '" data-url-mihari="' +
        esc(url) +
        '">送る</button>' +
        '<button class="btn sub2 chi" type="button" data-hsai="' +
        esc(x.employee_id) +
        '">作り直す</button>' +
        '</div>' +
        '</div></div></div>'
      );
    })(x);
  }

  // ★明細の 札から 押された時★（1か所で 受ける）
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var q = t && t.getAttribute && t.getAttribute('data-meisai-qr');
    if (q) meisaiQr(q);
    var mo = t.getAttribute && t.getAttribute('data-meisai-okuru');
    if (mo) meisaiOkuru(mo);
    var ma = t.getAttribute && t.getAttribute('data-meisai-adj');
    if (ma) adjHiraku(ma);
    var ad = t.getAttribute && t.getAttribute('data-adj-del');
    if (ad) adjKesu(ad);
    var aa = t.getAttribute && t.getAttribute('data-adj-add');
    if (aa) adjTasu(aa);
  });

