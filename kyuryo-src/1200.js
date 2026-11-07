  // ★★本人の 明細を 見せる★★（選んだ 範囲の PDF を 描いた 絵・記録が 無い 期間は ¥0 の 紙）
  function honninKami() {
    var box = document.getElementById('slips');
    if (!box) return;
    hnBarKaku();
    // 計算が 転んだ 間は 描かない（前の 期の 額を 出さない）
    if (HN_KEISAN_NG) return honninTomeru(HN_KEISAN_NG_BUN, true);
    // 売上の 直しが 読めない 業務が 在れば 本人の 明細も 出さない（事務所と 同じ 門）2026-10-14
    if (kyuDameBun(CTX)) {
      box.innerHTML = '<div class="card"><div class="msg">' + esc(kyuDameBun(CTX)) + '</div></div>';
      return;
    }
    var h = hnHaniNoKi();
    if (h.dame) {
      box.innerHTML =
        '<div id="hnKami"><div class="card"><div class="msg">' + esc(h.dame) + '</div></div></div>';
      return;
    }
    // ★期間を 替えた 時は 同じ 枠に 覆いを 足す★（見本 generateInvoices(immediate)＝前の 絵を 覆いの 下に 残す・
    //   設計前 対立役 S2）。月を 替えた 時は honninTsuki が 箱ごと「読み込み中…」に する（古い 月の 紙を 見せない）
    var mado = document.getElementById('hnKami');
    if (!mado || !mado.classList.contains('sheet-scale')) {
      box.innerHTML = '<div id="hnKami" class="sheet-scale"></div>';
      mado = document.getElementById('hnKami');
    }
    hnMiseSuteru();
    // 同じ 中身の 絵が 手元に 在れば 入れ直す だけ（見本の 作り置き＝_invCache）
    if (HN_MISE && HN_MISE.no === HN_NO && HN_MISE.inner) {
      if (HN_MISE.inner.parentNode !== mado) {
        mado.innerHTML = '';
        mado.appendChild(HN_MISE.inner);
      }
      mado.classList.remove('inv-loading');
      mado.setAttribute('data-hn-no', String(HN_NO));
      hnMiseFit();
      return;
    }
    mado.classList.add('inv-loading'); // 白い 画面で なく すぐ「作成中」を 出す（見本と 同じ）
    // ★PDF は 見せる 時に 作る★（どの 端末も・押したら すぐ 出る 為にも なる）
    if (hnPdfAru()) hnMiseru(HN_PDF);
    else if (HN_PDF_CHU !== HN_NO) hnPdfTsukuru();
  }

