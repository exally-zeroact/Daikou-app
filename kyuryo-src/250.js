  //   ここに 在った 押し口（btnPrint・btnPrintSel・kamiTsuki/kamiHi/kamiKojin/kamiNen と その 道具）は 消した。
  //   1人ずつの PDF は その人の 紙を 押す（printAll([id])）／「送る」。代わりに #haraiCard（その 期に 渡す 給料の 合計）。
  // ★★名前で 選ぶ★★ 2026-10-03（司さん「月と名前で選んでPDFで見れるように」）
  //   HITO＝選んだ 人の employee_id（''＝全員）。明細が この人だけに なる（2026-11-06 から 上の 合計は 全員の まま）。
  var HITO = '';
  function hitoErabiTsukuru() {
    var s = $('hitoSel');
    if (!s || HONNIN) return;
    var hito = REP && REP.employees ? REP.employees : [];
    if (
      HITO &&
      !hito.some(function (e) {
        return String(e.employee_id) === HITO;
      })
    )
      HITO = '';
    var h = '<option value="">全員（' + hito.length + '人）</option>';
    hito.forEach(function (e) {
      var id = String(e.employee_id);
      h +=
        '<option value="' +
        esc(id) +
        '"' +
        (id === HITO ? ' selected' : '') +
        '>' +
        esc(e.name || '') +
        '</option>';
    });
    s.innerHTML = h;
  }
  if ($('hitoSel')) {
    $('hitoSel').onchange = function () {
      HITO = this.value || '';
      renderSlips();
      nurikae();
    };
  }
  // ★描き直した／人を 選び直した＝前の 紙の 帯を 消す（送らない）★
  //   2026-11-06 チェック（選んだ人を 印刷）は 消した が ★帯を 消す 所は 残す★（renderSlips と 名前の 選び直しから 呼ぶ・設計前 対立役 止3）
  function nurikae() {
    if (window.PdfOkuru) PdfOkuru.kesu();
  }
  $('prevM').onclick = function () {
    YM_KIMETA = true; // ★押した 月を 守る★（設定を 読み終わる 前でも 今日の 月へ 戻さない・対立役 10-07）
    YM = PayrollPeriod.shift(YM, -1);
    PIDX = 0;
    loadPeriod();
  };
  $('nextM').onclick = function () {
    YM_KIMETA = true;
    YM = PayrollPeriod.shift(YM, 1);
    PIDX = 0;
    loadPeriod();
  };
