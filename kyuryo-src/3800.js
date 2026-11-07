  //   今 入っている 字体で 測る（PDF の 道具を 読んだ 後なら DKKami・読めなかった 時は 控えの 字体＝印刷も その 字体）
  // ★★PDF の 失敗の 後始末（印刷の 保険へ 落とすか）★★ 2026-10-08
  //   道具を 読めた 後の 失敗（紙を 組めない・PDF を 作れない）は 印刷に 落とさず 止める
  //   （前は「PDFの道具が読めませんでした。印刷で出します。」と 嘘の 文で 画面の 写しを 印刷した・対立役）
  function pdfAtoshimatsu(boxes, dougu, err, ki) {
    if (hamiTomeru(boxes, ki)) return;
    var m = String((err && err.message) || err || '');
    if (dougu && m.indexOf('PDF が ') !== 0) {
      showMsg('');
      showErr(
        '明細の 紙を 作れませんでした（' +
          m +
          '）。PDF は 出していません。もう一度 押してください。'
      );
      return;
    }
    _pdfShippai(err);
  }
  function hamiTomeru(boxes, ki) {
    // ★押した 後に 画面（月・期）が 変わった ⇒ 止める★（古い 人で 門を 素通りしない・対立役 3-b）
    // ★押した 時の 期と 今の 期が 違う・読み込み中 も「変わった」★（対立役 10-08 A：期を 変えた 読み込み中に
    //   新しい 期の 名前で 古い 期の 明細が 出た）
    var kawatta =
      LP_YOMICHU ||
      (ki !== undefined && ki !== PERIOD) ||
      boxes.some(function (b) {
        return !REP || REP.employees.indexOf(b) < 0;
      });
    if (kawatta) {
      showMsg('');
      showErr('画面が 変わったので 明細の PDF は 作りません。もう一度 押してください。');
      return true;
    }
    var hami;
    try {
      hami = boxes.filter(function (b) {
        var ei = REP.employees.indexOf(b);
        return ei >= 0 && window.__paper && window.__paper.maisu(ei).hamidasu;
      });
    } catch (e) {
      // ★測れない（紙を 組めない）時も 止める★ 2026-10-08（前は 投げて「PDFを作っています…」の まま 止まった・対立役）
      showMsg('');
      showErr(
        '明細の 紙を 組めませんでした（' +
          (e && e.message ? e.message : e) +
          '）。明細の PDF は 作りません。もう一度 開いてください。'
      );
      return true;
    }
    if (!hami.length) return false;
    showMsg('');
    showErr(
      hami
        .map(function (b) {
          return b.name;
        })
        .join('・') +
        ' さんの 手当・控除が 多すぎて 明細の 紙に 入りません。明細の PDF は 作りません（手当・控除を まとめてください）。'
    );
    return true;
  }
