  // ★★紙の 重さ（実測）★★
  //   2026-09-06 絵だった頃 … 3人ぶん 340,594B（1人 約 111kB）
  //   2026-09-26 字に した 後 … 下の 見張りが 毎回 測る
  //   ★司さんの 目安★「請求書は ええとこ 200kBぐらいのもんやろが」
  //
  // ★紙の 余白★ 四方 20pt。★縦横 同じ 倍率で 縮めて 真ん中★に 置く
  //   （前の 絵は 縦と横を 別々に 引き伸ばして ★ 2% 歪んでいた★）
  var KAMI_KATA = {
    yoko: { w: PAPER_W, h: PAPER_H, bw: SHEET_W, bh: SHEET_H, pad: PAPER_MARGIN },
    tate: { w: PAPER_H, h: PAPER_W, bw: SHEET_H, bh: SHEET_W, pad: PAPER_MARGIN },
  };

  // ★぀1人ぶんの 板を 作る★（1枚に 入らない 期間は ★分けて 何枚か★）
  //   ★字を小さくして押し込む事はしない★＝入らないなら 紙を増やす。
  function _empSheets(e, cars) {
    var m = _maisu(e, showCarSalesNow(), cars);
    var out = [];
    var zen = m.n * m.carN + (m.betsu ? 1 : 0);
    for (var k = 0; k < m.carN; k++) {
      for (var i = 0; i < m.n; i++) {
        var from = i * m.per;
        var to = Math.min(e.cells.length, from + m.per);
        out.push({
          el: _buildPaperSheet(
            e,
            showCarSalesNow(),
            cars,
            from,
            to,
            out.length + 1,
            zen,
            k * m.carPer,
            (k + 1) * m.carPer,
            m.betsu ? 'nashi' : undefined
          ),
          muki: 'yoko',
        });
      }
    }
    // ★内わけだけの 紙★（最後に 1枚）
    if (m.betsu)
      out.push({
        el: _buildPaperSheet(
          e,
          showCarSalesNow(),
          cars,
          0,
          Math.min(e.cells.length, m.per),
          out.length + 1,
          zen,
          0,
          0,
          'dake'
        ),
        muki: 'yoko',
      });
    // ★紙の 向きは 組んだ 紙が 決める★ 2026-10-23（横 1列に 入らない 期間は 縦）
    out.forEach(function (x) {
      x.muki = x.el.getAttribute('data-muki') === 'tate' ? 'tate' : 'yoko';
    });
    return out;
  }

  // ★出なかった時の知らせ★（★中身を 場合で書き分ける★）
  //   前は どちらでも「道具が読めませんでした」と出していた＝★時間切れの時は 嘘★（実測）。
  //   ・道具が読めない … ★保険で印刷★（何も出ないよりまし・URLと日付は付いてしまう）
  //   ・時間切れ ……… ★印刷に落とさない★
  //       印刷で出る紙は ★司さんが 8/25 に突き返した物★（URL・日付・見切れ）。
  //       ＝出さない方がまし。起きた事を そのまま出す。
  function _pdfShippai(err) {
    showMsg('');
    var jikangire = String((err && err.message) || err || '').indexOf('PDF が ') === 0;
    if (jikangire) {
      showErr(
        '紙を作るのに ' +
          Math.round(PDF_TIMEOUT_MS / 1000) +
          '秒 かかっても終わりませんでした。PDFは出していません。'
      );
      return;
    }
    showErr('PDFの道具が読めませんでした。印刷で出します。');
    try {
      window.print();
    } catch (_) {
      /* これ以上は打つ手なし */
    }
  }

