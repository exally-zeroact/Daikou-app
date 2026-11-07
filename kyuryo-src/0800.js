  // ★★今日を 含む 期の 月★★ 2026-10-07（対立役 G：始まった月の分 で 20日締め なら 10/7 の 期は 9月分）
  //   ＝最初に 開く 月・本人が 進める 一番 先の 月
  function kyouNoTsuki(kata) {
    var t = jstNow();
    var ima = { year: t.getFullYear(), month: t.getMonth() + 1 };
    if (!kata || kata.dame) return ima;
    var k =
      t.getFullYear() +
      '-' +
      String(t.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(t.getDate()).padStart(2, '0');
    var zure = [0, -1, 1];
    for (var i = 0; i < zure.length; i++) {
      var ym = PayrollPeriod.shift(ima, zure[i]);
      var ps = PayrollPeriod.periodsOf(ym.year, ym.month, { kata: kata });
      for (var j = 0; j < ps.length; j++) if (ps[j].start <= k && k <= ps[j].end) return ym;
    }
    return ima;
  }
  var YM_KIMETA = false; // ★最初の 1回だけ 今日の 期の 月へ★
  var HN_SAKI = null; // ★本人が 進める 一番 先の 月★
  var HN_KIMETA = false;

  // ★期間（同じ月の 中の 1〜3枚目）を 選ぶ★
  function honninKikan(i) {
    if (!PERIODS || !PERIODS[i]) return;
    PIDX = i;
    PERIOD = PERIODS[i];
    HN_HANI = i; // 範囲＝この 期間
    hnPdfSuteru(); // ★前の 期間の PDF を 渡さない★
    if (!hnKeisan()) return;
    honninKami();
  }
