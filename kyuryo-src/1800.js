  // ★★一覧は 従業員 全員★★ 2026-09-04（司さん「従業員毎に 配るんやないんか」）
  //   ★配る前から 名前が 出ます★（誰に 配ってあるかが 一目で 分かる）
  //   鍵が 出来ている人 … 〔大きく 見せる〕〔送る〕〔作り直す〕
  //   まだの人 ……………… 〔配る〕（★その人だけ★）
  function haifuHito(eid) {
    for (var i = 0; i < HAIFU.length; i++) {
      if (String(HAIFU[i].employee_id) === String(eid)) return HAIFU[i];
    }
    return null;
  }

  // ★画面に 戻った 時に 配る 一覧を 取り直す★ 2026-10-20（別の 端末で 作り直した 後に 古い リンクを 送らない・対立役 本番前 直2）
  //   「送る」は 押した その 場で 共有の 窓を 開く 決まり（待つと 開かない）ので、押す 前に 新しく して おく
  var HAIFU_TORINAOSHI = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || HONNIN || !HAIFU.length) return;
    if (Date.now() - HAIFU_TORINAOSHI < 30000) return;
    HAIFU_TORINAOSHI = Date.now();
    HAIFU.slice().forEach(function (x) {
      if (x && x.employee_id) haifuHitori(x.employee_id, true);
    });
  });
