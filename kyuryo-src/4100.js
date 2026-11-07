  // ★★期間を 通した 乗った人の 入れ漏れの 帯★★ 2026-10-23（時数は 入力の 画面へ 移した＝ここは 確かめる 所・対立役 A-6）
  //   前は「時数を入れる」の 日の 帯（hibar）が 出していた。判じは js/jisuu-hozon.js の 1か所（入力の 画面と 同じ）
  //   日を 押すと 入力の 画面の その 日へ 行く（?hi=）。読めない 物が 在る 期は 印を 出さない（自分の 車に 嘘の 印を 出さない）
  function noriMoreObi() {
    if (HONNIN || !PERIOD || !CTX) return '';
    if ((SET && SET.yomenai) || (LOAD && LOAD.failed > 0)) {
      return (
        '<div class="card noprint nori-obi"><span class="note" style="margin:0">' +
        '読めない 記録が あるので、乗った人の 入れ漏れは 確かめていません。</span></div>'
      );
    }
    var more = (PERIOD.dates || []).filter(function (d) {
      var r = JisuuHozon.noriNashi(CTX, d);
      return r.cars.length + r.hito.length > 0;
    });
    if (!more.length) {
      return (
        '<div class="card noprint nori-obi nori-obi-ok"><span class="note" style="margin:0">' +
        'この 期間に 乗った人の 入れ漏れは ありません。</span></div>'
      );
    }
    return (
      '<div class="card noprint nori-obi"><div class="nnari">給料が出る人の居ない車・記録の無い車の人がいる日：' +
      more
        .map(function (d) {
          return (
            '<a class="nnhi" href="nyuryoku.html?hi=' +
            d +
            '">' +
            +d.slice(5, 7) +
            '/' +
            +d.slice(8, 10) +
            '</a>'
          );
        })
        .join('') +
      '</div><div class="note" style="margin:4px 0 0">日を 押すと 入力の 画面の その 日へ 行きます（車を 開いて 乗った人と 時数を 入れます）。</div></div>'
    );
  }
