  // ★★横 1列に 入らない 期間は 紙を 縦に 使い 日付を 左の 縦・項目を 上の 横に した 表 1枚★★ 2026-10-23
  //   司さん「なんで明細を全部10日で区切っとんど 月1回やったら1枚やろが 週一でも7日区切りとか」
  //         「紙を縦に使うのは項目と日付を入れ替えて日付を左端の縦にして項目を上の横にして作成しろ」
  //   前は 横の 紙に 入る 日（約 11日）ごとに 次の 紙へ 送った＝月1回（31日）が 3枚・月2回（16日）が 2枚。
  //   今は A4縦（板 794×1123）に 1日 1行（31日 でも 1枚）。車が 多くても 無くても 同じ 形（車は 上の 横の 列）。
  //   ★横 1列に 入る 期間（月3回の 10〜11日・週の 7日・毎日）は 今までの 紙と 1文字も 変えない★
  var TATE_MAI = 31; // 縦の 紙 1枚に 載せる 一番 多い 日。越える 期間（日数で 切る 昔の 形の 62日 等）だけ 紙を 分ける
  var TATE_ROW_H = 26; // 縦の 紙の 1日の 行の 一番 低い 高さ（板 26px・字 13px が 入る）
  var TATE_HEAD_H = 46; // 縦の 紙の 項目の 行の 高さ（車の 番号の 2行目が 入る）
  // ★組んだ 紙が その 紙の 高さに 入るか★（縦の 紙は 高さ 1123・横は 794）
  // ★縦の 紙の 日付★ 2026-10-23（司さん「日付をもう少しコンパクトに」）
  //   1行目と 月が 変わる 日だけ「10/1(木)」・ほかは「2(金)」（何月かは 上の 行で 分かる）
  function hiTate(c, cells) {
    var i = cells.indexOf(c);
    var m = String(c.date).slice(5, 7);
    if (i <= 0 || String(cells[i - 1].date).slice(5, 7) !== m) return mdw(c.date);
    return mdw(c.date).replace(/^\d+\//, '');
  }
  // ★画面に 並べる 時の 紙の 大きさ★（縦の 紙は 794×1123・横は 1123×794＝紙ごとに 違う）
  function kamiWH(el) {
    var t = el && el.getAttribute && el.getAttribute('data-muki') === 'tate';
    return { w: t ? SHEET_H : SHEET_W, h: t ? SHEET_W : SHEET_H };
  }
  // 1枚ずつ 画面の 幅に 合わせて 縮める（枠の 高さも その 紙の 高さ から）
  function kamiNobasu(waku, haba) {
    var el = waku.firstElementChild;
    var wh = kamiWH(el);
    var sc = Math.min(1, (haba - 2) / wh.w);
    el.style.transform = 'scale(' + sc + ')';
    waku.style.height = Math.ceil(wh.h * sc) + 'px';
    return sc;
  }
  function _hamideru(el) {
    var lim = +el.getAttribute('data-sheet-h') || SHEET_H;
    // 縦の 紙で 車の 列が 横に 入らない 時も「入らない」（車の 列を 次の 紙へ 分ける）
    if (el.getAttribute('data-haba-dame') === '1') return true;
    return _takasa(el) > lim;
  }

  // ★明細の字の作り方は ここ1本★（★画面も 紙も 同じ物を使う★）
  //   前は 画面と紙で 別々に書いていた＝★片方だけ直すと 画面と紙で 数が食い違う★。
  //   （見張り tests/unit/kyuryo-slip-all-days.test.js「字の作り方は 1本（F）」）
  // ★その日の金額が「最低保証」で出た物か★ 2026-08-26（司さん）
  //   司さん「最低保証の時給になったら 金額の数字を赤文字で表示させてた」
  //     例）最低保証 1,000円／時 で 金額÷時間 が 1,000円ちょうど付近 → その金額は赤
  //   ★割り算で当てない★＝エンジンが ★どちらで出したか★を持っている。
  //     js/daiko-payroll.js:169 usedFloor = (最低保証の額 >= 歩合の額)
  //     js/payroll-daily.js:512 で 1日ごとに そのまま運ばれてくる。
  //   実測（本物の倉庫の行）… 4日とも usedFloor=true
  //     太郎 8/1 ¥9,000÷9.00h=1,000（保証1,000）／8/2 ¥9,500÷9.50h=1,000
  //     次郎 8/1 ¥7,000÷7.00h=1,000 ／ 三郎 8/2 ¥11,400÷9.50h=1,200（その人だけ1,200）
  //   ★0円の日は 赤にしない★（決め方が入っていないだけの日まで赤くなる）
  var SLIP_RED = '#e0483d'; // --danger（このアプリが元から使っている赤）
  function payByFloor(c) {
    return !!(c && c.usedFloor && c.pay > 0);
  }

  var SLIP_F = {
    pay: function (c) {
      return c.pay === null ? '' : yen(c.pay);
    },
    hours: function (c) {
      return c.hours === null ? '' : hrs(c.hours);
    },
    car: function (c, i) {
      return c.carSales[i] === null ? '' : yen(c.carSales[i]);
    },
    pool: function (c) {
      return c.poolHours === null ? '' : hrs(c.poolHours);
    },
  };

  // ★字の幅を 実際に測る★（列の幅を ★中身が入るだけ★ にする為）
  //   ＝「表幅の◯%」で決めると ★字が欠ける／逆に 余って間延びする★。
  var _measCtx = null;
  function _textW(text, px, weight) {
    if (!_measCtx) _measCtx = document.createElement('canvas').getContext('2d');
    // ★紙と 同じ 字体で 測る★ 2026-10-08（対立役：前は 'Noto Sans JP' だけで 測り、描く 字（DKKami・端末の 控え）と
    //   違う 幅で 列を 決めた＝字体が 替わると 字が 列から はみ出し得た）
    _measCtx.font = (weight || 400) + ' ' + px + "px 'DKKami', 'Noto Sans JP', sans-serif";
    return _measCtx.measureText(String(text || '')).width;
  }

  // ★2行に収まらない車名は 自分で切って「…」を付ける★
  //   overflow:hidden だけだと ★黙って 途中で消える★＝紙を見た人は
  //   「これで全部」と読む。切ったなら ★切ったと分かる形★で出す。
  function _fit2(text, px, lineW, lines) {
    var t = String(text || '');
    if (_textW(t, px, 400) <= lineW * lines) return t;
    var dots = _textW('…', px, 400);
    var kagiri = lineW * lines - dots;
    var n = t.length;
    while (n > 0 && _textW(t.slice(0, n), px, 400) > kagiri) n--;
    return t.slice(0, n) + '…';
  }

