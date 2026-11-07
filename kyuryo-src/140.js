  // ★★画面いっぱいの QR を 出す★★ 2026-09-04（司さん）
  //   ★その場で 本人の スマホに 読ませて 終わり★（紙も 送信も 要らない）
  //   ★大きさは 窓に 合わせる★＝パソコンでも スマホでも 読める
  //   ★どこを 押しても 閉じる★／★Esc でも 閉じる★
  // ★大きい 窓を 出す（中身は 呼ぶ側が 決める）★
  function haifuMado(naka) {
    if (window.PdfOkuru) PdfOkuru.kesu(); // ★窓の 上に「送る・印刷する」の 帯を 残さない★
    var furui = document.getElementById('haifuMise');
    if (furui) furui.parentNode.removeChild(furui);
    var d = document.createElement('div');
    d.id = 'haifuMise';
    d.className = 'noprint';
    d.setAttribute(
      'style',
      'position:fixed;inset:0;z-index:9999;background:#fff;' +
        'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;cursor:pointer'
    );
    d.innerHTML = naka;
    function tojiru() {
      if (d.parentNode) d.parentNode.removeChild(d);
      document.removeEventListener('keydown', kii);
    }
    function kii(ev) {
      if (ev.key === 'Escape') tojiru();
    }
    d.onclick = tojiru;
    document.addEventListener('keydown', kii);
    document.body.appendChild(d);
    return d;
  }

  function haifuMiseru(eid) {
    if (window.PdfOkuru) PdfOkuru.kesu(); // ★QR の 窓（z9999）の 上に 帯を 残さない★（作った後の 対立役 止1）
    var x = null;
    for (var i = 0; i < HAIFU.length; i++) {
      if (String(HAIFU[i].employee_id) === String(eid)) x = HAIFU[i];
    }
    if (!x) {
      // ★★黙って 何も 起きない のを やめる★★ 2026-09-04
      //   ★押したのに 無反応★は「壊れている」と 同じに 見えます。
      //   （その人が 配る 一覧に 居ない＝「従業員」から 外れている 等）
      haifuMado(
        '<div id="haifuMiseNai" style="font-weight:800;font-size:18px;text-align:center;max-width:20em">' +
          'この人の QR は 作れませんでした</div>' +
          '<div class="note" style="text-align:center;max-width:22em">' +
          '通信を 確かめて、もう一度 押してください。</div>' +
          '<div class="note">（どこかを 押すと 閉じます）</div>'
      );
      return;
    }
    // ★$() は 使いません★＝この 箱は ★その場で 作る★物で HTML に 書いていない
    //   （$() の 相手は HTML に 在る事、という 見張りが 在る）
    var furui = document.getElementById('haifuMise');
    if (furui) furui.parentNode.removeChild(furui);
    // ★窓の 短い方に 合わせる★（はみ出さない・小さすぎない）
    var mijikai = Math.min(window.innerWidth, window.innerHeight);
    var haba = Math.max(240, Math.min(560, Math.round(mijikai * 0.72)));
    var d = document.createElement('div');
    d.id = 'haifuMise';
    d.className = 'noprint';
    d.setAttribute(
      'style',
      'position:fixed;inset:0;z-index:9999;background:#fff;' +
        'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;cursor:pointer'
    );
    d.setAttribute('data-eid', String(eid));
    // ★★止まった 人・作り直しも この 窓で★★ 2026-10-24（給料の 設定の 配る 一覧を 外した＝司さん「配るは明細からできるからのけろ」）
    //   前は「3回 続けて 間違えて 止まっています」と「作り直す」が 一覧に しか 無かった＝明細から 見せると 使えない QR が 出た
    //   ★止まって いる 時は QR を 出さない★（古い リンクは 開いても 止まって いる）
    var saiBtn = function (ji, ghost) {
      return (
        '<button class="btn' +
        (ghost ? ' ghost' : '') +
        '" type="button" data-mado-sai="' +
        esc(String(eid)) +
        '" style="cursor:pointer">' +
        ji +
        '</button>'
      );
    };
    d.innerHTML =
      '<div style="font-weight:800;font-size:20px">' +
      esc(x.name || '') +
      '　殿</div>' +
      (x.tomatta
        ? '<div class="rolewarn" id="haifuMiseTomatta" style="max-width:22em;text-align:center">' +
          '3回 続けて 間違えて 止まっています。この リンク（QR）は もう 使えません。' +
          '「作り直す」で 新しい リンク（QR）に してください。</div>' +
          saiBtn('作り直す')
        : '<div id="haifuMiseQr" data-url-mihari="' +
          esc(haifuUrl(x)) +
          '" style="width:' +
          haba +
          'px;height:' +
          haba +
          'px">' +
          qrSvg(haifuUrl(x), 8) +
          '</div>' +
          '<div class="note" style="text-align:center;max-width:22em">' +
          (x.pw_ari
            ? 'スマホの カメラで この QR を 読んでください。'
            : 'スマホの カメラで この QR を 読んで、自分の パスワードを 決めてください。') +
          '</div>' +
          '<div class="note" style="text-align:center;max-width:24em">' +
          'リンクが 鍵です。本人にだけ 渡してください。<br />忘れた・漏れた 時は 作り直す' +
          '（前の リンクは 使えなく なります）</div>' +
          saiBtn('リンクを 作り直す', true)) +
      '<div class="note">（ほかの 所を 押すと 閉じます）</div>';
    var sb = d.querySelector('[data-mado-sai]');
    if (sb)
      sb.onclick = function (ev) {
        ev.stopPropagation(); // ★押しても 窓を 閉じない★
        // 止まって いない 時は 生きて いる リンクを 殺す＝1度 確かめる（止まって いる 時は もう 使えない ので 聞かない）
        if (
          !x.tomatta &&
          !window.confirm('作り直すと 前の リンク（QR）は 使えなく なります。作り直しますか？')
        )
          return;
        haifuSaihakkou(eid, sb);
      };
    // ★中の QR を 箱いっぱいに 広げる★（svg は そのままだと 元の 大きさ）
    var sv = d.querySelector('#haifuMiseQr svg');
    if (sv) {
      sv.setAttribute('width', '100%');
      sv.setAttribute('height', '100%');
      sv.style.width = '100%';
      sv.style.height = '100%';
      sv.style.display = 'block';
    }
    function tojiru() {
      if (d.parentNode) d.parentNode.removeChild(d);
      document.removeEventListener('keydown', kii);
    }
    function kii(ev) {
      if (ev.key === 'Escape') tojiru();
    }
    d.onclick = tojiru;
    document.addEventListener('keydown', kii);
    document.body.appendChild(d);
  }

