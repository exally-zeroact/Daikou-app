  //   ★まだ 配っていない時は その場で 配ってから 見せます★
  //   （事務所の 人に「先に 設定を 開け」と 言わせない）
  // ★★「送る」の 中身は ここ 1か所★★ 2026-09-04
  //   ★明細からも 設定からも 同じ 物を 使う★（決まりを 2つに しない）
  //   ・使える台（スマホ等）… ★共有シートが 出る★（LINE・メール等を 選ぶ）
  //   ・使えない台 ………… ★コピーに 落ちる★
  function haifuOkuru(x, botan) {
    if (!x) return;
    // ★止まった 人の リンクは 送らない★ 2026-10-24（対立役 S3：送っても 開くと 止まって いる＝同じ 死んだ リンクが 何度も 届く）
    //   ⇒ 見せる 窓で「止まっています」と「作り直す」を 出す
    if (x.tomatta) {
      haifuMiseru(x.employee_id);
      return;
    }
    var url = haifuUrl(x);
    // ★誰の 分か 分かる 文にする★（渡し間違いを 防ぐ）
    var bun =
      (x.name || '') +
      'さん の 給料明細です。' +
      'この リンクは 本人にだけ お使いください（リンクが 鍵です）。';
    function moji(t) {
      if (botan) botan.textContent = t;
    }
    if (typeof navigator.share === 'function') {
      moji('送っています…');
      navigator
        .share({ title: '給料明細', text: bun, url: url })
        .catch(function () {
          // ★やめた／送れなかった★ … 黙って 元に 戻す（責めない）
        })
        .then(function () {
          moji('送る');
        });
      return;
    }
    // ★使えない台★ … コピーに 落ちる
    try {
      navigator.clipboard.writeText(bun + ' ' + url);
      moji('コピーしました');
    } catch (e) {
      moji('コピーできません');
    }
    setTimeout(function () {
      moji('送る');
    }, 1500);
  }

