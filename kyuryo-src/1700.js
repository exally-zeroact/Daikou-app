  // ★★明細の「送る」★★ 2026-09-04（司さん「ないやないか」）
  //   ★まだ 配っていない時は その場で 配ってから 送る★
  //   中身は 設定タブの「送る」と ★同じ 1か所★（決まりを 2つに しない）
  // ★辞めた 人にも QR・送るを 出す★ 2026-10-17 司さん「向こうが URL 消すまで 見れないかん・退職者のページからでもURLの配付ができないかん」
  //   （10-16 に 入れた「辞めた 人には 出さない」は 外した。倉庫の 1人ぶん・作り直しも 辞めた 人を 通す 様に した）
  // 辞めた 人か（名簿の active が false）
  function yametaHito(eid) {
    var e = (RAW.employees || []).filter(function (x) {
      return x.employee_id === eid;
    })[0];
    return !!e && e.active === false;
  }
  function meisaiOkuru(eid) {
    if (!eid) return;
    var x = null;
    for (var i = 0; i < HAIFU.length; i++) {
      if (String(HAIFU[i].employee_id) === String(eid)) x = HAIFU[i];
    }
    if (x) {
      haifuOkuru(x, document.querySelector('[data-meisai-okuru="' + eid + '"]'));
      return;
    }
    haifuHitori(eid).then(function () {
      for (var i = 0; i < HAIFU.length; i++) {
        if (String(HAIFU[i].employee_id) === String(eid)) {
          haifuOkuru(HAIFU[i], document.querySelector('[data-meisai-okuru="' + eid + '"]'));
          return;
        }
      }
      haifuMado(
        '<div style="font-weight:800;font-size:18px;text-align:center;max-width:20em">' +
          'この人の リンクは 作れませんでした</div>' +
          '<div class="note" style="text-align:center;max-width:22em">' +
          '通信を 確かめて、もう一度 押してください。</div>' +
          '<div class="note">（どこかを 押すと 閉じます）</div>'
      );
    });
  }

  function meisaiQr(eid) {
    if (!eid) return;
    // ★控えに 居ても 見せる 前に 取り直す★ 2026-10-20（対立役 本番前 N1）
    haifuMiseruAtarashiku(eid);
  }

  // 配るの 訳を 画面の 上（#err）に 出した 時の 字（消す 時は、この 字が まだ 出ている 時だけ 消す）
  var HAIFU_TOP = '';
  // ★2026-10-24 給料の 設定の 配る 一覧（と その 赤字の 箱）を 外した＝訳は いつも 画面の 上（#err）に 出す★
  function haifuErr(t) {
    // ★配る 一覧が 見えていない 画面（退職者ページ 等）でも 訳を 出す★ 2026-10-17（対立役 N1）
    if (t) {
      showErr(t);
      HAIFU_TOP = t;
      return;
    }
    // ★消す 時は 自分が 出した 字だけ 消す★（押し直して 通っても 赤字が 残った・対立役 直す1。
    //   前の 直しは 保存の 失敗 等 他の 訳まで 消し、直った 様に 見えた・対立役 10-17）
    var top = $('err');
    if (HAIFU_TOP && top && top.textContent === HAIFU_TOP) showErr('');
    HAIFU_TOP = '';
  }

