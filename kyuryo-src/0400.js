  // ★★2026-10-01＝「隠す物を 並べる」から「出す物だけ 出す」に 変えた★★
  //
  //   ★司さん★「LINEで給料明細送った画面になんで赤丸のところが見えるんど
  //              個別で送ったんやけん人とか選べたらいかんやろが」
  //
  //   ★何が 起きていたか★
  //     ここは ★隠す物の 名前を 並べた 名簿★ だった:
  //       tabs / monthCard / paneHours / paneEmp / paneSet / printCard / jimushoLinks
  //     2026-09-25 に 足した「PDFで 見る（給料表）」(#kamiCard) は
  //     ★paneSlip の 中★ に 在り、★名簿に 入っていなかった★。
  //     ⇒ 本人に 配った リンクの 画面に
  //       ★「月ごと（全体）」「日ごと（全員）」「個別（選んだ人）」が 出ていた★
  //       ＝★他人を 選べる 口が 本人に 見えていた★。
  //
  //   ★名簿に 足すだけでは 直らない★
  //     次に カードを 足した 人が また 名簿を 忘れる。同じ事が 起きる。
  //     （今日 SQLの門でも 同じ形を 踏んだ＝黒名簿は 終わらない）
  //   ⇒ ★出してよい 物だけ 出す（白名簿）★ に した。
  //     新しい カードを 足しても ★既定で 出ない★。
  // ★止まった・作り直された 時の 字★ 2026-10-20（docs/pw-4keta.md）
  var HONNIN_TOMATTA_BUN =
    '3回 続けて 間違えたので 止めました。会社（事務所）に、リンクを 作り直して もらってください。';
  var HONNIN_TSUKURINAOSHI_BUN =
    'この リンクは 作り直されました。会社から 新しい リンク（QR）を もらってください。';
  // 入口の 箱を 訳だけに する（欄と ボタンを 出さない）
  function honninTomeru(bun, barNokosu) {
    var box = document.getElementById('slips');
    if (box) box.innerHTML = '<div class="card"><div class="msg">' + esc(bun) + '</div></div>';
    var bar = document.getElementById('hnBar');
    if (bar && !barNokosu) bar.hidden = true; // 見られない（止めた・作り直した）時は 月も 選ばせない
  }
  function honninErr(t) {
    var e = document.getElementById('hnErr');
    if (!e) return;
    e.style.display = t ? '' : 'none';
    e.textContent = t || '';
  }
