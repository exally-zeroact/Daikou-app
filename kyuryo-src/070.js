  // ★★払い方（締め）が 読めない 時の 文★★ 2026-10-07（金額を 出さずに 止める）
  function shimeDameBun(kata) {
    // ★通信で 読めなかった 時は「選び直して」でなく「開き直して」★（対立役：選び直して 保存すると 本物の 設定が 既定で 上書き）
    if (kata && kata.tsushin === true && kata.kiroku === true)
      return '締めの 変えた 記録を 読めなかったので 止めました（通信）。もう一度 開いてください。';
    if (kata && kata.tsushin === true)
      return '給料の 設定を 読めなかったので 止めました（通信）。もう一度 開いてください。';
    return (
      '給料の 払い方の 設定が 読めないので 止めました（' +
      ((kata && kata.riyuu) || '払い方の 設定が 読めません') +
      '）。「給料の 設定」で 払い方を 選び直してください。'
    );
  }
  // ★今日を 含む 期の 番号★（無ければ 0）＝今月を 開いた 時に 今の 期を 出す
  function kyouNoKi(ps) {
    var t = jstNow();
    var k =
      t.getFullYear() +
      '-' +
      String(t.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(t.getDate()).padStart(2, '0');
    for (var i = 0; i < (ps || []).length; i++) if (ps[i].start <= k && k <= ps[i].end) return i;
    return 0;
  }

