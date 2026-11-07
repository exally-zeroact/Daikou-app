  // ★★手当・控除の 内わけを 合計の 塊の 右の 空きへ★★ 2026-10-23
  //   司さん「手当や控除がある時は合計金額の右に空いてるスペースにどのぐらいの数入れれるか出して」
  //   1行に 1つ（働いた分／＋手当／−控除／＝差引支給）を 上から 6行・入りきらない 時は 右の 列へ。
  //   空きの 幅と 一番 長い 行の 幅から 入る 数を 出し、越える 時は 今まで 通り 見出しの 下の 行に 出す
  var MIGI_GYOU = 6;
  var MIGI_PX = 13;
  function adjMigi(e, areaW) {
    var nashi = { ok: false, cap: 0, html: '', n: 0 };
    if (!e || !(e.teate || e.koujo)) return nashi;
    var mj = meisaiJiGyou(e); // ★本人の「明細を コピー」と 同じ 行★（2026-10-25）
    var gyou = mj.gyou;
    var owari = mj.owari;
    var haba = _textW(owari, MIGI_PX, 700);
    gyou.forEach(function (g) {
      haba = Math.max(haba, _textW(g, MIGI_PX, 400));
    });
    haba = Math.ceil(haba) + 2;
    var GAP = 12;
    var retsu = Math.floor((areaW + GAP) / (haba + GAP));
    if (!(retsu > 0)) retsu = 0;
    var cap = retsu * MIGI_GYOU;
    var n = gyou.length + 1;
    if (n > cap) return { ok: false, cap: cap, html: '', n: n };
    var html =
      '<div style="display:grid;grid-auto-flow:column;grid-template-rows:repeat(' +
      MIGI_GYOU +
      ',auto);column-gap:' +
      GAP +
      'px;justify-content:start;font-size:' +
      MIGI_PX +
      'px;line-height:1.2;color:#14243d;white-space:nowrap;">' +
      gyou
        .map(function (g) {
          return '<div>' + esc(g) + '</div>';
        })
        .join('') +
      '<div style="font-weight:700;">' +
      esc(owari) +
      '</div></div>';
    return { ok: true, cap: cap, html: html, n: n };
  }
  // 合計の 塊の 幅（見出しの 字の 大きさと 同じ 数で 測る）
  function goukeiHaba(e, tate) {
    return (
      (tate ? 14 : 20) * 2 +
      2 +
      _textW('合計', 15, 700) +
      (tate ? 10 : 14) * 2 +
      _textW('¥' + yen(e.totalPay), tate ? 28 : 34, 800) +
      _textW(hrs(e.totalHours) + ' 時間', tate ? 17 : 20, 800)
    );
  }

  // ★日の 欄と 差引支給の 1円の ずれの 注記は 明細の 紙に 出さない★ 2026-10-23
  //   司さん「たまに赤丸の説明書きがいらない」（件G の 丸めの 注記・払う 額は 変えない）
  // uw … 内わけ（手当・控除の 行）の 置き方：既定＝見出しの 下／'nashi'＝載せない／'dake'＝内わけだけの 紙
  function _buildPaperSheet(e, showCarSales, allCars, from, to, maiNo, maiN, carFrom, carTo, uw) {
    var cars = showCarSales ? _paperCars(e, allCars) : [];
    // ★★車の 行が 1枚に 入らない 時は 次の 紙へ★★ 2026-10-07（司さん「前からある2つもやれ」・対立役：
    //   車 9台＋内わけ 1行 で 紙の 下が 切れた）＝★字も 行の 高さも 変えず★ 車の 行を 分ける。番号は 続き
    var carOff = carFrom || 0;
    cars = cars.slice(carOff, carTo === undefined ? cars.length : carTo);
    // ★画面と 同じ 1本を使う★（紙で 別に書くと 画面と紙で 違う数が出る）
    var F = SLIP_F;

    // 出す行（見出し＋金額＋時間＋売上n＋時間（全台））
    var rows = [];
    rows.push({ lbl: '金額', get: F.pay, aka: payByFloor }); // ★最低保証の日は 赤★
    rows.push({ lbl: '時間', get: F.hours });
    cars.forEach(function (x, n) {
      rows.push({
        lbl: '売上' + (n + 1 + carOff),
        sub: x.car.label, // ★車名は 小さい2行目★＝列を広げない
        get: function (c) {
          return F.car(c, x.i);
        },
      });
    });
    // ★項目は 2行★ 2026-10-23（司さん「時間（全台）を売上のように2行にしてコンパクトに」）＝列・行の 幅を 取らない
    rows.push({
      lbl: '時間（全台）',
      ji: '時間',
      sub: '（全台）',
      subNobasu: '（全台）',
      get: F.pool,
    });

    // ★この紙に載せる日★（1枚に入らない時は 何枚かに分ける・下の _maisu を見て）
    var allCells = e.cells;
    var cells = allCells.slice(from || 0, to === undefined ? allCells.length : to);
    var days = cells.length;
    var PAD = 18; // 板の左右の余白(px)
    var tableW = SHEET_W - PAD * 2;

    // ★字の大きさは 決め打ち★（★行の高さで つじつまを合わせない★）
    //   板の 12px = 紙の 9pt。★本文15px=11.25pt／2行目13px=9.75pt★＝どちらも 9pt以上。
    var fontPx = 15;
    var subPx = 13;
    // ★行を 詰めた★ 2026-10-23（司さん「全部の幅と数字の大きさを大きくしてるからもったいなくないか」）
    //   50 → 38（紙 28.5pt）。字は 15px（9pt 以上）の まま・車の 番号の 2行目も 入る
    var rowH = 38; // 板38px

    // ★左の項目列 … 幅は「中身が入るだけ」／詰めるのは 余白★
    //   前は「表幅の15%」で決めていた（指示役が取り消し）。
    //   ⇒ ★項目の字を 実際に測って★ ＋ ★内側の余白 LABEL_PAD★ だけ。
    var LABEL_PAD = 6; // 項目の字の 左右の余白(px)＝紙で 4.5pt
    //   ★車名（2行目）で 列を広げない★（指示役 2026-08-26）
    //     広げると 日付の列が痩せて ★日付や金額が欠ける★。長い車名は ★2行に折る★。
    //     実測：27字「事務所の裏に置いてある予備の軽自動車（黒）8627号車」
    //       直す前 … 項目の列 104→★326px★（表幅の30%）／日付の列 98→76px
    //       直した後 … 項目の列は ★104pxのまま★／車名は 2行
    // ★★1枚で 終わる 様に 字の 大きさを 自動で 合わせる★★ 2026-10-14
    //   司さん「給料明細もなんで2つに分かれるんどぼけ １枚で終わるように自動調整しろってゆうとったろが」
    //   前は 字を 15px に 決め打ちし、入らない 日は 次の 紙へ 送っていた（10日 が 9日＋1日 の 2枚）。
    //   ⇒ その 紙の 日が 全部 入るまで 字を 15px から 0.5px ずつ 小さく する。
    //     ★下限は 13px（PDF で 9.09pt）★＝一番 小さい 字 ≧9pt の 決まりは 守る。
    //     13px でも 入らない 時（31日 まとめ 等）だけ 紙を 分ける（_maisu）。
    var LABEL_MAX = Math.floor(tableW * 0.3);
    var CELL_PAD = 8;
    var labelInk, labelW, labelKake, minColW;
    // 引数の 名前は 外と 同じ fontPx（その 大きさで 測る）
    var hakaru = function (fontPx) {
      var li = 0;
      rows.forEach(function (r) {
        li = Math.max(li, _textW(r.ji || r.lbl, fontPx, 700));
        if (r.subNobasu) li = Math.max(li, _textW(r.subNobasu, subPx, 400));
      });
      li = Math.max(li, _textW('日付', fontPx, 700));
      // ★字が欠けない★＝測った幅を 切り捨てず 上に丸める（＋枠線1px）
      var lw = Math.ceil(li) + LABEL_PAD * 2 + 2;
      // 車名が とても長い時だけ 上限（それでも ★日付の列より 表を壊さない★）
      var kake = lw > LABEL_MAX; // ★欠けたか★＝見張りが数で見る
      if (kake) lw = LABEL_MAX;
      // ★1つの日の列に 最低いる幅★＝★その日の一番長い字★＋余白（＝字を欠けさせない）
      var mc = 0;
      cells.forEach(function (c) {
        mc = Math.max(mc, _textW(mdw(c.date), fontPx, 700));
        rows.forEach(function (r) {
          mc = Math.max(mc, _textW(r.get(c), fontPx, 400));
        });
      });
      mc = Math.ceil(mc) + CELL_PAD * 2 + 2;
      labelInk = li;
      labelW = lw;
      labelKake = kake;
      minColW = mc;
      return mc * days <= tableW - lw;
    };
    // 板の 13px ＝ PDF で 9.09pt（紙に 置く 倍率は 0.75 で なく 0.699＝js/kami-egaku.js の bai：
    //   min((842-40)/1123, (595-40)/794)。12px だと 8.39pt で 9pt を 割る＝対立役 10-14）
    var FONT_MIN = 13;
    while (!hakaru(fontPx) && fontPx > FONT_MIN) {
      fontPx = Math.max(FONT_MIN, fontPx - 0.5);
    }
    // ★横 1列に 入らない ⇒ 紙を 縦に 使い 日付を 左の 縦・項目を 上の 横に★ 2026-10-23
    // ★毎日（日払い）の 1日も 同じ 縦の 形★ 2026-10-23（司さん「日払いも上行に項目で左端に日付にして」）
    var tate = days === 1 || !hakaru(fontPx);
    var habaDame = false;
    var tateDateW = 0;
    var tateColW = [];
    if (tate) {
      tableW = SHEET_H - PAD * 2;
      CELL_PAD = 4; // 数字は 中央揃え＝左右の 余白は 少しで 足りる（車の 列を 多く 入れる）
      var hakaruTate = function (f) {
        var dw = _textW('日付', f, 700);
        cells.forEach(function (c) {
          dw = Math.max(dw, _textW(hiTate(c, cells), f, 700));
        });
        tateDateW = Math.ceil(dw) + CELL_PAD * 2 + 2;
        tateColW = rows.map(function (r) {
          var w = _textW(r.ji || r.lbl, f, 700);
          if (r.subNobasu) w = Math.max(w, _textW(r.subNobasu, subPx, 400));
          cells.forEach(function (c) {
            w = Math.max(w, _textW(r.get(c), f, 400));
          });
          return Math.ceil(w) + CELL_PAD * 2 + 2;
        });
        var goukei = tateDateW;
        tateColW.forEach(function (w) {
          goukei += w;
        });
        return goukei <= tableW;
      };
      fontPx = 15;
      while (!hakaruTate(fontPx) && fontPx > FONT_MIN) {
        fontPx = Math.max(FONT_MIN, fontPx - 0.5);
      }
      habaDame = !hakaruTate(fontPx);
      // ★日付の 列にも ゆとり★ 2026-10-23（司さん「余白あるんやけんもう少しゆったり幅を持たせろ」）＝余りから 最大 20px
      var tsukau0 = tateDateW;
      tateColW.forEach(function (w) {
        tsukau0 += w;
      });
      tateDateW += Math.max(0, Math.min(20, tableW - tsukau0));
      // 項目の 列は 同じ 幅（一番 広い 列が 入る なら 全部 その 幅で 紙の 幅いっぱい）
      var hiroi = Math.max.apply(null, tateColW.length ? tateColW : [0]);
      var hitoshi = tateColW.length ? Math.floor((tableW - tateDateW) / tateColW.length) : 0;
      if (hitoshi >= hiroi)
        tateColW = tateColW.map(function () {
          return hitoshi;
        });
      // 余りは 項目の 列に 均して 配る（表は 紙の 幅いっぱい＝合計の 塊の 中心と 揃う）
      var tsukatta = tateDateW;
      tateColW.forEach(function (w) {
        tsukatta += w;
      });
      var amari = tableW - tsukatta;
      if (amari > 0 && tateColW.length) {
        var tasu = Math.floor(amari / tateColW.length);
        tateColW = tateColW.map(function (w) {
          return w + tasu;
        });
        tateColW[tateColW.length - 1] += amari - tasu * tateColW.length;
      }
      labelW = tateDateW;
      minColW = Math.min.apply(null, tateColW.length ? tateColW : [0]);
    }
    // 2行目（車の 番号）も 同じ だけ 小さく（下限 13px）
    subPx = Math.max(FONT_MIN, subPx - (15 - fontPx));

    // ★★行の 高さと 項目の 列の 幅は 中身の 数で 自動で 決める★★ 2026-10-23
    //   司さん「見せる売上の数ごとに幅を自動調整されるようにしとけよ」
    //   紙の 高さ − 見出し − 内わけの 行 を 行の 数で 割る（少ない 時は ゆったり・多い 時は 詰める）
    // ★見出しの 左に 要る 幅★（期間の 字・名前・給料明細 の 一番 長い 物）
    //   真ん中の 合計に 届く 時（縦の 紙で 名前が 長い・合計が 7桁 等）は 左を その 幅に し 合計は 右へ ずらす＝重ねない
    //   届かない 時は 今まで 通り 左右 同じ 幅（合計は 真ん中＝司さん 08-25 の 決め）
    var gHaba = goukeiHaba(e, tate);
    var hidariIru =
      Math.ceil(
        Math.max(
          _textW('給料明細', 20, 800) +
            (maiN > 1 ? _textW('　（' + maiNo + '/' + maiN + '枚目）', 13, 400) : 0),
          _textW(PERIOD.label + '　' + PERIOD.rangeLabel, 15, 400),
          _textW(e.name + '　殿', 24, 800)
        )
      ) + 4;
    var hanbun = (tableW - gHaba - 32) / 2;
    var hidariW = hidariIru > hanbun ? hidariIru : 0; // 0＝左右 同じ 幅
    // 右の 空き＝表の 幅 − 合計の 塊 − 間 2つ − 左
    var migiW = hidariW ? tableW - gHaba - 32 - hidariW : hanbun;
    var migi =
      uw === 'nashi' || uw === 'dake' ? { ok: false, cap: 0, html: '', n: 0 } : adjMigi(e, migiW);
    var ueGyou = uw === 'nashi' ? '' : adjGyou(e, migi.ok);
    // 見出しの 下の 行の 高さ＝字の 幅から 折り返す 行の 数を 出す（手当・控除が 多いと 2〜3行に なる）
    var ueH = 0;
    (ueGyou.match(/<div[^>]*>[\s\S]*?<\/div>/g) || []).forEach(function (d) {
      var ji = d.replace(/<[^>]+>/g, '');
      ueH += Math.ceil(_textW(ji, 15, 400) / (tableW * 0.85)) * 19 + 12; // 折り返しは 語の 切れ目で 起きる＝ゆとりを 見る
    });
    var aki = (tate ? SHEET_W : SHEET_H) - PAD * 2 - 96 - ueH - 8;
    if (tate) {
      // 縦の 紙：日の 行（30〜40px）
      var hiTakasa = Math.floor((aki - TATE_HEAD_H) / days);
      rowH = Math.max(TATE_ROW_H, Math.min(40, hiTakasa));
    } else {
      // 横の 紙：項目の 行（38〜50px）
      var gyouTakasa = Math.floor(aki / (rows.length + 1));
      rowH = Math.max(38, Math.min(50, gyouTakasa));
      // ★項目の 列にも ゆとり★（司さん「日付の列に余白あるんやけんもう少しゆったり幅を持たせろ」）
      //   日の 列の 要る 幅を 引いた 余りから 最大 40px（字が 欠けた 時の 上限は 越えない）
      if (!labelKake)
        labelW = Math.min(
          LABEL_MAX,
          labelW + Math.max(0, Math.min(40, tableW - labelW - minColW * days))
        );
    }

    var dayW = Math.floor((tableW - labelW) / days);
    var headH = 96; // 見出し（給料明細／名前／期間／合計）の高さ(px)

    var el = document.createElement('div');
    el.style.cssText =
      'position:fixed;left:-10000px;top:0;background:#ffffff;box-sizing:border-box;' +
      'width:' +
      (tate ? SHEET_H : SHEET_W) +
      'px;height:' +
      (tate ? SHEET_W : SHEET_H) +
      'px;padding:' +
      PAD +
      'px;' +
      // ★★字体は PDF と 同じ 物★★ 2026-09-26
      //   紙は pdf-lib で BIZ UDP ゴシックを 描く（js/kami-egaku.js）。
      //   ★画面の 並べ方を そのまま 紙に 写す★作りなので、
      //   別の 字体で 並べると ★字幅が ずれて 重なる★。
      //   ★実測 2026-09-26★ Noto のままだと
      //     「¥18,500」と「8.50 時間」が 重なって 出た（絵で 見つけた）。
      "font-family:'DKKami','Noto Sans JP',sans-serif;color:#333333;";

    // ── 見出し（画面と同じ並び：給料明細 → 名前 → 合計）──
    var head =
      '<div style="display:flex;align-items:center;gap:16px;height:' +
      headH +
      'px;">' +
      // ★名前と 何月分の 場所は どの 形でも 同じ★ 2026-10-23（司さん「全パターン名前の場所と何月分とかの項目の場所を固定しろ」）
      //   左に 上から 給料明細／何月分 期間／名前 殿（合計の 塊は 真ん中の まま）
      (hidariW
        ? '<div style="flex:0 0 ' +
          hidariW +
          'px;min-width:0;display:flex;flex-direction:column;gap:2px;">'
        : '<div style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:2px;">') +
      '<div><div style="font-size:20px;font-weight:800;color:#14243d;white-space:nowrap;">給料明細' +
      // ★2枚以上に分かれた時だけ 何枚めかを出す★（2026-10-23 期間の 字の 後ろから 給料明細の 横へ＝期間の 行を 短く）
      (maiN > 1
        ? '<span style="font-size:13px;font-weight:400;color:#5a6b82;">　（' +
          maiNo +
          '/' +
          maiN +
          '枚目）</span>'
        : '') +
      '</div>' +
      '<div style="font-size:15px;margin-top:4px;white-space:nowrap;">' +
      esc(PERIOD.label) +
      '　' +
      esc(PERIOD.rangeLabel) +
      '</div></div>' +
      '<div style="font-size:24px;font-weight:800;color:#14243d;white-space:nowrap;">' +
      esc(e.name) +
      '　殿</div>' +
      '</div>' +
      '<div style="flex:0 0 auto;border:1px solid #dbe7f7;background:#f7fbff;' +
      'border-radius:10px;padding:' +
      (tate ? '8px 14px' : '10px 20px') +
      ';white-space:nowrap;">' +
      '<span style="font-size:15px;color:#5a6b82;font-weight:700;">合計</span>' +
      // 縦の 紙は 幅が 狭い＝合計の 字を 少し 小さく（7桁でも 期間・名前と 重ならない）
      '<span style="font-size:' +
      (tate ? 28 : 34) +
      'px;font-weight:800;color:#14243d;margin-left:' +
      (tate ? 10 : 14) +
      'px;">¥' +
      yen(e.totalPay) +
      '</span>' +
      '<span style="font-size:' +
      (tate ? 17 : 20) +
      'px;font-weight:800;color:#14243d;margin-left:' +
      (tate ? 10 : 14) +
      'px;">' +
      hrs(e.totalHours) +
      ' 時間</span>' +
      '</div>' +
      // ★合計の塊は 見出しの ★中心★★（司さん 2026-08-25 決定・8/26 再確認）
      //   ・左（給料明細／期間／名前）と 右 を ★同じ幅の詰め物★で挟む＝真ん中に来る
      //   ・★この詰め物を外すと 右端に貼り付く★（8/26 に一度 外して 突き返された）
      //   ・指示役の「表の右端にピタリ」は ★司さんの決定が先★なので 取り消し
      '<div style="flex:1 1 0;min-width:0;align-self:center;">' +
      (migi.ok ? migi.html : '') +
      '</div>' +
      '</div>' +
      (uw === 'nashi' ? '' : adjGyou(e, migi.ok));

    // ── 表 ──
    var TD =
      'border:1px solid #999999;padding:0 8px;height:' +
      rowH +
      'px;' +
      'font-size:' +
      fontPx +
      'px;line-height:1.15;';
    var TH =
      'border:1px solid #999999;height:' +
      rowH +
      'px;line-height:1.15;' +
      'font-size:' +
      fontPx +
      'px;' +
      // ★詰めるのは 余白★（幅ではない）＝指示役 2026-08-26
      'padding:0 ' +
      LABEL_PAD +
      'px;' +
      // ★項目（日付／金額／時間／売上n／時間（全台））は 中央揃え★ 2026-08-26 司さん
      'background:#f7fbff;text-align:center;color:#333333;font-weight:700;' +
      'width:' +
      labelW +
      'px;max-width:' +
      labelW +
      'px;overflow:hidden;';
    var t =
      '<table style="width:100%;border-collapse:collapse;table-layout:fixed;">' +
      '<colgroup><col style="width:' +
      labelW +
      'px"><col span="' +
      days +
      '" style="width:' +
      dayW +
      'px"></colgroup><tbody>';
    t += '<tr><th style="' + TH + '">日付</th>';
    cells.forEach(function (c) {
      t +=
        '<th style="' +
        TD +
        'background:#f7fbff;text-align:center;font-weight:700;white-space:nowrap;">' +
        mdw(c.date) +
        '</th>';
    });
    t += '</tr>';
    rows.forEach(function (r) {
      t +=
        '<tr><th style="' +
        TH +
        '"><div style="white-space:nowrap;">' +
        esc(r.ji || r.lbl) +
        '</div>' +
        (r.sub
          ? '<div style="font-size:' +
            subPx +
            // ★折り返す★＝画面のCSS（tbody th は白空白を折り返さない）を 打ち消す
            'px;font-weight:400;color:#5a6b82;line-height:1.15;white-space:normal;' +
            // ★2行まで★（行の高さ50pxに 15px＋13px×2＝47px で収まる）
            'max-height:' +
            Math.round(subPx * 1.15 * 2) +
            'px;overflow:hidden;word-break:break-all;">' +
            esc(_fit2(r.sub, subPx, labelW - LABEL_PAD * 2 - 2, 2)) +
            '</div>'
          : '') +
        '</th>';
      cells.forEach(function (c) {
        var aka = r.aka && r.aka(c);
        t +=
          '<td style="' +
          TD +
          'text-align:center;white-space:nowrap;' +
          (aka ? 'color:' + SLIP_RED + ';font-weight:700;' : '') +
          '">' +
          r.get(c) +
          '</td>';
      });
      t += '</tr>';
    });
    t += '</tbody></table>';

    if (tate) {
      // ★縦の 表★：上の 横＝項目（金額・時間・売上n・時間（全台））／左の 縦＝日付（1日 1行）
      var TDT =
        'border:1px solid #999999;padding:0 ' +
        CELL_PAD +
        'px;height:' +
        rowH +
        'px;font-size:' +
        fontPx +
        'px;line-height:1.15;';
      var KOU = 'background:#f7fbff;text-align:center;font-weight:700;color:#333333;';
      t =
        '<table style="width:100%;border-collapse:collapse;table-layout:fixed;">' +
        '<colgroup><col style="width:' +
        tateDateW +
        'px">' +
        tateColW
          .map(function (w) {
            return '<col style="width:' + w + 'px">';
          })
          .join('') +
        '</colgroup><tbody>';
      t += '<tr><th style="' + TDT + 'height:' + TATE_HEAD_H + 'px;' + KOU + '">日付</th>';
      rows.forEach(function (r, i) {
        t +=
          '<th style="' +
          TDT +
          'height:' +
          TATE_HEAD_H +
          'px;' +
          KOU +
          'overflow:hidden;"><div style="white-space:nowrap;">' +
          esc(r.ji || r.lbl) +
          '</div>' +
          (r.sub
            ? '<div style="font-size:' +
              subPx +
              'px;font-weight:400;color:#5a6b82;line-height:1.15;white-space:normal;max-height:' +
              Math.round(subPx * 1.15 * 2) +
              'px;overflow:hidden;word-break:break-all;">' +
              esc(_fit2(r.sub, subPx, tateColW[i] - CELL_PAD * 2 - 2, 2)) +
              '</div>'
            : '') +
          '</th>';
      });
      t += '</tr>';
      cells.forEach(function (c) {
        t += '<tr><th style="' + TDT + KOU + 'white-space:nowrap;">' + hiTate(c, cells) + '</th>';
        rows.forEach(function (r) {
          var aka = r.aka && r.aka(c);
          t +=
            '<td style="' +
            TDT +
            'text-align:center;white-space:nowrap;' +
            (aka ? 'color:' + SLIP_RED + ';font-weight:700;' : '') +
            '">' +
            r.get(c) +
            '</td>';
        });
        t += '</tr>';
      });
      t += '</tbody></table>';
    }
    el.innerHTML = head + (uw === 'dake' ? '' : t);
    // ★測れるように 印を付ける★（見張りが 数で確かめる為）
    el.setAttribute('data-paper', '1');
    el.setAttribute('data-label-w', String(labelW));
    el.setAttribute('data-day-w', String(dayW));
    el.setAttribute('data-row-h', String(rowH));
    el.setAttribute('data-label-pad', String(LABEL_PAD));
    el.setAttribute('data-min-col-w', String(minColW));
    el.setAttribute('data-usable-w', String(tableW - labelW));
    el.setAttribute('data-days', String(days));
    el.setAttribute('data-muki', tate ? 'tate' : 'yoko');
    el.setAttribute('data-sheet-h', String(tate ? SHEET_W : SHEET_H));
    el.setAttribute('data-haba-dame', habaDame ? '1' : '0');
    el.setAttribute('data-migi', migi.ok ? '1' : '0');
    el.setAttribute('data-migi-cap', String(migi.cap));
    el.setAttribute('data-label-ink', String(Math.ceil(labelInk)));
    el.setAttribute('data-label-kake', labelKake ? '1' : '0');
    el.setAttribute('data-font-px', String(fontPx));
    el.setAttribute('data-sub-px', String(subPx));
    el.setAttribute('data-rows', String(rows.length + 1));
    return el;
  }

  // ★何枚に分けるか★＝1枚に入る日の数から出す
  //   ★62日ぶんの期間まで作れる★（js/payroll-period.js:128 days<=62／月まとめは28〜31日）
  //   実測：本物の10日・11日 → 1枚／31日 → 3枚（★字は 9pt以上のまま★）
  // ★組んだ 紙の 本当の 高さ★（画面の 外に 1度 置いて 測る）
  function _takasa(el) {
    el.style.position = 'absolute';
    el.style.left = '-99999px';
    el.style.top = '0';
    el.style.visibility = 'hidden';
    document.body.appendChild(el);
    var h = el.scrollHeight;
    el.remove();
    return h;
  }
  function _maisu(e, showCarSales, allCars) {
    var probe = _buildPaperSheet(e, showCarSales, allCars, 0, e.cells.length);
    var hairu = Math.floor(
      +probe.getAttribute('data-usable-w') / +probe.getAttribute('data-min-col-w')
    );
    var per = hairu > 1 ? hairu : 1;
    // ★縦の 紙（1日 1行）は 1枚に 31日まで★ 2026-10-23（司さん「月1回やったら1枚やろが」）
    if (probe.getAttribute('data-muki') === 'tate') per = Math.min(e.cells.length, TATE_MAI);
    var mai = Math.ceil(e.cells.length / per);
    var n = mai > 1 ? mai : 1;
    // ★★縦（車の 行）の 分け方★★ 2026-10-07
    //   紙の 高さ − 上下の 余白 − 見出し − 内わけの 行 に 入る 行の 数から、決まった 4行
    //   （日付・金額・時間・時間（全台））を 引いた 分が 1枚に 入る 車の 数
    //   ★★見積もりは 使わず 組んだ 紙の 高さを 測る★★（対立役 10-07：内わけが 折り返すと 26px の
    //     見積もりより 高く なり 800〜876px で 切れた）＝入るまで 1台ずつ 減らす
    var nCars = showCarSales ? _paperCars(e, allCars).length : 0;
    var carPer = nCars > 0 ? nCars : 1;
    var to0 = Math.min(e.cells.length, per);
    while (
      carPer > 1 &&
      _hamideru(_buildPaperSheet(e, showCarSales, allCars, 0, to0, 1, 1, 0, carPer))
    ) {
      carPer--;
    }
    // ★★車 1台（車が 無い 人も）でも 入らない ⇒ 内わけを 自分の 紙へ★★ 2026-10-07
    //   （対立役：手当・控除が 長いと 黙って 切れた。止めずに 内わけを 別の 紙に 送る＝金額は 1つも 消さない）
    //   ★人ごとに 必ず 1回 測る★（車が 0台・1台の 人は 上の ループが 回らない）
    var betsu = false;
    if (_hamideru(_buildPaperSheet(e, showCarSales, allCars, 0, to0, 1, 1, 0, carPer))) {
      betsu = true;
      carPer = nCars > 0 ? nCars : 1;
      while (
        carPer > 1 &&
        _hamideru(_buildPaperSheet(e, showCarSales, allCars, 0, to0, 1, 1, 0, carPer, 'nashi'))
      ) {
        carPer--;
      }
    }
    var carN = nCars > 0 ? Math.ceil(nCars / carPer) : 1;
    // ★内わけだけの 紙も 入らない（手当・控除が 長く 多い）⇒ はみ出す★（対立役 10-07：66件 で 差引支給が 紙の 外へ）
    //   ＝明細の PDF を 止めて 知らせる（司さんの 決め「計算できなければ 止めて 警告」の 向き）
    var hamidasu =
      betsu && _hamideru(_buildPaperSheet(e, showCarSales, allCars, 0, to0, 1, 1, 0, 0, 'dake'));
    return {
      per: per,
      n: n,
      carPer: carPer,
      carN: carN,
      betsu: betsu,
      hamidasu: hamidasu,
    };
  }

  // ★返らない時に 永久に待たない★（指示役 2026-08-26）
  //   ＝押した人は「PDFを作っています…」のまま ★何も起きない★。
  //   ⇒ ★PDF_TIMEOUT_MS で 打ち切って エラーにする★
  //   ★2026-09-26 実測★ 1人 0.3秒／3人 0.1秒（字体を 軽くする 2回描きを 含む）
  //     ＝絵にしていた 頃より ★速い★。30秒は 十分 余裕が 在る。
  //     （集計の 9種を 出す js/kami-pdf.js と 同じ 30秒に 揃えた）
  var PDF_TIMEOUT_MS = 30000;
  // ★明細の PDF を 出す★ 時間切れ（PDF_TIMEOUT_MS）は 作り終える（dekita）まで＝共有の 画面の 待ちは 数えない 2026-11-06
  //   （LINE で 相手を 選ぶ 間に 30秒 過ぎると「PDFは出していません」と 嘘に なる・設計前 対立役 止1）
  //   作る 所が 返らない 時は 今まで 通り 時間切れ（e2e kyuryo-paper「永久に待たない」）。字は _withTimeout と 同じ
  function _dasuMachi(E, itas, title, kai) {
    var tid = null;
    return new Promise(function (ok, ng) {
      tid = setTimeout(function () {
        ng(new Error('PDF が ' + PDF_TIMEOUT_MS + 'ms で返りませんでした'));
      }, PDF_TIMEOUT_MS);
      E.dasu(itas, title, KAMI_KATA, {
        kai: kai,
        dekita: function () {
          clearTimeout(tid);
        },
      }).then(
        function (v) {
          clearTimeout(tid);
          ok(v);
        },
        function (e) {
          clearTimeout(tid);
          ng(e);
        }
      );
    });
  }
  function _withTimeout(pr, ms, name) {
    var tid = null;
    return Promise.race([
      pr.then(function (v) {
        clearTimeout(tid);
        return v;
      }),
      new Promise(function (_, ng) {
        tid = setTimeout(function () {
          ng(new Error(name + ' が ' + ms + 'ms で返りませんでした'));
        }, ms);
      }),
    ]);
  }

