  // ★2026-08-08: 断られた時に「どの会社に書こうとして断られたか」まで出す★
  //   司さんの申告では 赤字が「手で入れた分を保存できませんでした。」だけで、
  //   ★相手の会社が分からないので誰も原因に辿り着けなかった★（実際は検証ゴミの会社だった）。
  //   401/403 は倉庫が「その会社には書けない」と言っている時なので、会社名を添える。
  // ★★2026-09-06（司さん「明細にだすのチェック外しても保存されない」）★★
  //   ★倉庫は 断る時に ★理由★ を 返しています。それを 捨てていました★
  //   ⇒ 画面には「保存できませんでした。」しか 出ず、★誰も 原因に 辿り着けない★
  //   ⇒ 会社の 決まり「黙って 落とすな」に 真正面から 当たる。
  //   ★今★ 倉庫の 言い分（message / details / hint）を ★そのまま 出す★。
  function saveErr(msg, r) {
    try {
      var st = r && r.status;
      if (st === 401 || st === 403) {
        var nm = (COMPANY && COMPANY.name) || '(会社が選ばれていません)';
        return showErr(msg + ' ' + nm + ' には書き込めません。');
      }
    } catch (_) {
      /* 名前が出せなくても、元の言い方はそのまま出す */
    }
    // ★理由を 読みに行く★（読めなくても 元の言い方は 必ず 出す）
    try {
      if (r && typeof r.text === 'function') {
        r.text()
          .then(function (t) {
            var wake = '';
            try {
              var j = JSON.parse(t);
              wake = [j.message, j.details, j.hint].filter(Boolean).join(' / ');
            } catch (_) {
              wake = String(t || '').slice(0, 200);
            }
            showErr(msg + (r.status ? ' [' + r.status + ']' : '') + (wake ? ' ' + wake : ''));
          })
          .catch(function () {
            showErr(msg);
          });
        return;
      }
    } catch (_) {
      /* 読めなくても 下で 元の言い方を 出す */
    }
    return showErr(msg);
  }
  function showMsg(m) {
    $('msg').textContent = m || '';
    $('msg').style.display = m ? 'block' : 'none';
  }
  function flash(id, t) {
    $(id).textContent = t;
    setTimeout(function () {
      $(id).textContent = '';
    }, 1600);
  }
  function yen(v) {
    if (v === null || v === undefined || !isFinite(v)) return '';
    return Math.round(v).toLocaleString();
  }
  function hrs(v) {
    if (v === null || v === undefined || !isFinite(v)) return '';
    return (Math.round(v * 100) / 100).toFixed(2);
  }
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  function mdw(dateStr) {
    var p = String(dateStr).split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return +p[1] + '/' + +p[2] + '(' + WD[d.getDay()] + ')';
  }
  function num(v) {
    var x = parseFloat(v);
    return isFinite(x) ? x : 0;
  }

