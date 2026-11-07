  // ★★本人の 画面の 計算が 転んだ 時は 前の 期の 額を 出さない・PDF も 作らない★★ 2026-10-22
  //   前：受け皿が 無く、転ぶと 前の 期の 紙と 札が 残り、PDF の ボタンは 生きて いて 別の 期の 名前の PDF を 渡した（対立役）
  var HN_KEISAN_NG = false;
  var HN_KEISAN_NG_BUN =
    'この 期間の 明細を 計算できませんでした。画面を 開き直してください（直らない 時は 会社に 知らせてください）。';
  function hnKeisan() {
    try {
      recalc();
      HN_KEISAN_NG = false;
      return true;
    } catch (e) {
      // eslint-disable-next-line no-console -- 2026-11-07 html から 出した 前からの 行（中身は 変えない・件2 で 直す）
      if (window.console) console.warn('[本人の 計算]', e);
      HN_KEISAN_NG = true;
      REP = null;
      hnPdfSuteru();
      honninTomeru(HN_KEISAN_NG_BUN, true);
      return false;
    }
  }

