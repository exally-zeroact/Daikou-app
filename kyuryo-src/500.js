  // ★★締めの 形の「何日から」★★ 2026-10-19（docs/nannichi-kara-shime.md）
  //   記録は dk_shime_rireki（列 period_shime に 置かない＝古い 版の 画面が 保存しても 消えない）
  //   日付が 在る 保存＝列の 締めは 変えず、欄の 形が その 日の 形と 違えば 記録を 書く／空＝列を 直す
  var SHIME_HI = null; // 選んだ 日（null＝まだ 選んで いない＝今日・''＝最初から）
  var SHIME_SAWATTA = false; // 締めの 欄を 触ったか
  var SHIME_RIREKI_HIRAKU = false;
  function shimeHi() {
    hiHiGawari();
    if (SHIME_HI !== null) return SHIME_HI;
    var o = hiOboeHiku('shime', 'kaisha'); // ★その 日の うちに 選んだ 日★（2026-10-25）
    SHIME_HI = o !== null ? o : kyouJst(); // ★この 窓で 最初に 描いた 日に 固定★（empHi と 同じ・対立役 S1）
    return SHIME_HI;
  }
  // 列の 形（記録より 前の 日）。読めなければ null
  //   ★設定の 行が 無い 会社は 計算と 同じ yomu で 月3回★ 2026-10-25（前は null＝既定の「今日から」で 保存すると
  //   「最初からの 払い方が 読めない」で 必ず 止まった）。止めるのは 通信で 読めなかった（yomenai）時だけ
  function shimeRetsuKata() {
    if (SET && SET.yomenai) return null;
    var y = PayrollPeriod.yomu(SET);
    return y && y.ok ? y.kata : null;
  }
  // 選んだ 日に 効く 形（計算と 同じ 引き方）。空・読めない＝null（列の 形を 出す）
  function shimeNoHiKata(hi) {
    if (!hi || !Array.isArray(RAW.shimeRireki)) return null;
    var b = shimeRetsuKata();
    if (!b) return null;
    var k = PayrollPeriod.rirekiKata(b, RAW.shimeRireki);
    if (!k || k.dame) return null;
    return PayrollPeriod.kataNoHi(k, hi);
  }
  // 欄の 形（raw）を 選んだ 日から 入れた 時の 区切り（記録 込み）。日付が 空＝欄の 形を 列に した 時
  function shimeMitoshi(rawKata) {
    if (!Array.isArray(RAW.shimeRireki)) return null;
    var hi = shimeHi();
    var mine = rawKata || { kind: 'tsuki', hi: [10, 20, 0] };
    if (!hi) {
      var t = PayrollPeriod.seiki(mine);
      if (!t.ok) return null;
      return PayrollPeriod.rirekiKata(t.kata, RAW.shimeRireki);
    }
    var b = shimeRetsuKata();
    if (!b) return null;
    var rows = RAW.shimeRireki
      .filter(function (x) {
        return x && String(x.from_date).slice(0, 10) !== hi;
      })
      .concat([{ from_date: hi, value: mine }]);
    return PayrollPeriod.rirekiKata(b, rows);
  }
  var YOUBI_NA = ['日', '月', '火', '水', '木', '金', '土'];
  // 形の 字（記録の 一覧）
  function shimeNoNa(v) {
    var t = PayrollPeriod.seiki(v);
    if (!t.ok) return '読めない 形（' + t.riyuu + '）＝消してください';
    var k = t.kata;
    var nz = k.nazuke === 'hajime' ? '・始まった 日の 月の 分' : '';
    if (k.kind === 'thirds') return '月3回（10日・20日・末日 締め）';
    if (k.kind === 'hi') return '毎日';
    if (k.kind === 'shuu') return '週1回（' + YOUBI_NA[k.youbi] + '曜 締め' + nz + '）';
    var hiJi = k.hi
      .map(function (h) {
        return h === 0 ? '末日' : h + '日';
      })
      .join('・');
    var kosu = k.hi[k.hi.length - 1] !== 0;
    return (
      '締め日 ' +
      hiJi +
      (kosu ? (k.nazuke === 'hajime' ? '・始まった 日の 月の 分' : '・締めた 日の 月の 分') : '')
    );
  }
