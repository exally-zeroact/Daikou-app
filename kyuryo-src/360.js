  // ★★1人ぶん★★
  // ★読み込み中は 作らない★（押した 時の 期で 作る）
  function yomikomichuTomeru() {
    // 期の 計算が 転んだ 時も 作らない（前の 期の 額で 新しい 月の 明細を 作った・対立役 3回目 止め-1）
    if (KEISAN_NG) {
      showErr(KEISAN_NG_JI);
      return true;
    }
    if (!LP_YOMICHU) return false;
    showErr('まだ 読み込み中です。読み終わってから もう一度 押してください。');
    return true;
  }
  function printOne(ei) {
    if (yomikomichuTomeru()) return;
    // 売上の 直しが 読めない 業務が 在れば 明細の PDF を 作らない（画面の 明細と 同じ 門）2026-10-14
    if (kyuDameBun(CTX)) return showErr(kyuDameBun(CTX));
    var kiOne = PERIOD;
    if (DKSession.loadFailed(LOAD)) {
      yomiNaoshiObi(); // ★帯を 出す★（押す 所が 無い 文で 止めない・対立役 10-07）
      showErr(
        '読めなかった 物が あるので 明細の PDF は 作りません。上の「もう一度読む」を 押してください。'
      );
      return;
    }
    var box = document.getElementById('slip-' + ei);
    var emp = REP && REP.employees ? REP.employees[ei] : null;
    if (!box || !emp) {
      showErr('その人の明細が見つかりません。');
      return;
    }
    // ★中身から作った名前★（保存する時の既定のファイル名になる）
    var ym = String(YM.year) + '-' + String(YM.month).padStart(2, '0');
    var title = '給料明細_' + ym + '_' + String(emp.name || '');

    showMsg('PDFを作っています…');
    var kai1 = window.PdfOkuru ? PdfOkuru.kesu() : null;
    var dougu1 = false;
    loadPdfLibs()
      .then(function (E) {
        dougu1 = true;
        // ★はみ出す 人は 作らない★ 2026-10-08（printAll と 同じ 門・対立役：printOne だけ 門が 無かった）
        if (hamiTomeru([emp], kiOne)) return null;
        // ★時間切れは 作る 所だけ★（共有の 画面の 待ちを 包まない・_dasuMachi・対立役 止1 2026-11-06）
        return _dasuMachi(E, _empSheets(emp, slipCars(REP.cars, emp.employee_id)), title, kai1);
      })
      .then(function (x) {
        showMsg(meisaiBun(x));
      })
      .catch(function (err) {
        // ★印刷の 保険へ 落ちる 時も はみ出す 人は 止める・道具を 読めた 後の 失敗は 印刷しない★
        pdfAtoshimatsu([emp], dougu1, err, kiOne);
      });
  }
  window.printOne = printOne;

