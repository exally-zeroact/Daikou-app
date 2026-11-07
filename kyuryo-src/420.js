  // ★★その 期に 渡す 給料の 合計（#haraiCard）★★ 2026-11-06（司さん「切り替える度に その時に 渡す 給料の 合計」）
  //   額＝REP.harai（明細の 差引支給を 人ごとに 丸めて 全員 足した 額・js/payroll-daily.js haraiGoukei）
  //   ＝下の「みんなの給料」・月次集計の 回の 額と 同じ 数（ここで 足し直さない）。名前を 選んでも 全員の 合計。
  //   ★出さない★ 本人の 画面／読み込み中（REP は 前の 期の まま・対立役 止2）／読めなかった 物が 在る（控除の 抜けた 額・止1）／
  //              計算が 転んだ／計算 できない 人が 居る（kyuDameBun）／期が 無い／0人／額が 数で ない
  //   門は 明細の PDF（printAll）と 同じ 物に 揃える。
  function haraiKakusu() {
    var c = $('haraiCard');
    if (c) c.hidden = true;
  }
  function haraiNuru() {
    var c = $('haraiCard');
    if (!c) return;
    if (
      HONNIN ||
      LP_YOMICHU ||
      KEISAN_NG ||
      !PERIOD ||
      !REP ||
      !REP.employees ||
      !REP.employees.length ||
      DKSession.loadFailed(LOAD) ||
      kyuDameBun(CTX) ||
      !isFinite(REP.harai)
    ) {
      c.hidden = true;
      return;
    }
    $('haraiKi').textContent = PERIOD.rangeLabel + ' の 分　全員に 渡す 給料';
    $('haraiGaku').textContent = '¥' + yen(REP.harai);
    // ★差引支給が マイナスの 人が 居れば 一言★ 2026-11-06（作った後 対立役 注2）
    //   額は「みんなの給料」と 同じ（マイナスも 足す）＝額は 変えない（変えるなら お金の 決め＝司さんに 訊く）。字だけ 足す
    var minus = REP.employees.filter(function (e) {
      return PayrollDaily.haraiGaku(e.totalPay) < 0;
    }).length;
    $('haraiNote').textContent =
      REP.employees.length +
      '人ぶん（明細の 差引支給の 合計）' +
      (minus ? '・差引支給が マイナスの 人 ' + minus + '人を 含みます' : '');
    c.hidden = false;
  }
  function renderSlips() {
    haraiNuru();
    if (KEISAN_NG) {
      $('slips').innerHTML = '';
      showErr(KEISAN_NG_JI);
      return;
    }
    var SHOW_CAR_SALES = showCarSalesNow();
    var box = $('slips');
    // ★名前の 選ぶ欄を 今の 人で 作り直す★（いなくなった人を 選んだままに しない・0人の 時も）
    hitoErabiTsukuru();
    if (!REP || !REP.employees.length) {
      // 本人の 画面で 0人＝その 月に 働いた 日も 手当・控除も 無い（辞めた 人など）＝「登録して」は 嘘に なる
      // 事務所で 人は 居るのに 0人＝全員 この 期間より 後に 勤め始めた（「登録して」は 嘘・D の 本番前の 叩き N1）2026-10-20
      box.innerHTML = HONNIN
        ? '<div class="card"><div class="msg">この 月は 働いた 日が ありません。</div></div>'
        : CTX && CTX.employees.length
          ? '<div class="card"><div class="msg">この 期間に 勤めて いた 人は いません。</div></div>'
          : '<div class="card"><div class="msg">まず「従業員」で人を登録してください。</div></div>';
      return;
    }
    var ubDame = kyuDameBun(CTX);
    if (ubDame) {
      box.innerHTML =
        noriMoreObi() + '<div class="card"><div class="msg">' + esc(ubDame) + '</div></div>';
      return;
    }
    var html = noriMoreObi() + adjChui();
    // ★描き直した＝前の 紙の 帯を 消す（送らない）★（チェックと「選んだ人を 印刷」は 2026-11-06 に 消した・帯を 消す 所は 残す）
    setTimeout(nurikae, 0);
    REP.employees.forEach(function (e, ei) {
      // ★名前で 選んでいれば その人だけ★ 2026-10-03
      if (HITO && String(e.employee_id) !== HITO) return;
      // ★出す車は 人ごとに決まる★（その人の指定が無ければ 会社の決まりどおり）
      var cars = slipCars(REP.cars, e.employee_id);
      // ★★事務所の 画面＝紙の 上は 1行だけ★★ 2026-10-05（司さん「くどくど 見せとんど」）
      //   名前・期間・合計は ★紙の 中に 書いてある★＝重ねて 出さない。名前と 渡し方だけ。
      if (!HONNIN) {
        html +=
          '<div class="slip" id="slip-' +
          ei +
          '"><div class="kami-ue noprint">' +
          // ★印刷する 人の チェックは 消した★ 2026-11-06（「選んだ人を 印刷」を 消した＝押しても 何も 起きない 欄に なる）
          '<span class="kami-ue-na" data-emp="' +
          esc(String(e.employee_id)) +
          '">' +
          esc(e.name) +
          '</span>' +
          '<div class="kami-ue-btn">' +
          '<button class="btn ghost" data-meisai-qr="' +
          esc(e.employee_id || '') +
          '">QRを 見せる</button>' +
          '<button class="btn ghost" data-meisai-okuru="' +
          esc(e.employee_id || '') +
          '">送る</button>' +
          // ★手当・控除★ 2026-10-06（司さん「ア」）
          '<button class="btn ghost" data-meisai-adj="' +
          esc(e.employee_id || '') +
          '">手当・控除</button>' +
          '</div></div>' +
          '<div class="adj-panel noprint" data-adj-panel="' +
          esc(e.employee_id || '') +
          '" style="display:none"></div>';
      } else {
        html +=
          '<div class="slip" id="slip-' +
          ei +
          '"><div class="shead">' +
          // ★左のかたまり★（題＋期間＋名前）
          //   ★名前は「給料明細」のすぐ右★ 2026-08-25（司さん「赤丸の所に名前もってきて」）
          '<div class="sh-l">' +
          '<div><div class="title">給料明細</div>' +
          '<div>' +
          esc(PERIOD.label) +
          '　' +
          esc(PERIOD.rangeLabel) +
          '</div></div>' +
          '<div class="who">' +
          esc(e.name) +
          '　殿</div>' +
          '</div>' +
          // ★合計は 行の 真ん中★ 2026-08-25（司さん「金額は赤丸の中心ぐらいに」）
          //   左のかたまりと 右のかたまりを ★同じ幅★にして 合計を真ん中に置く。
          //   （余った所の真ん中では ★右に寄って見える★＝1度 それで直っていなかった）
          '<div class="sums">合計<span class="big">¥' +
          yen(e.totalPay) +
          '</span><span class="mid">' +
          hrs(e.totalHours) +
          ' 時間</span></div>' +
          // ★右のかたまり★（幅合わせ＋その人の QR）
          //   ★紙でもボタンが消えるだけで この箱は残す★＝紙でも真ん中がずれない
          '<div class="sh-r">' +
          // ★★「この人のPDF」を やめました★★ 2026-09-04（司さん）
          //   「明細の この人のPDFを 消して QRコードか URLを 配るボタン 作って」
          //   ⇒ ★紙を 作って 送るのでは なく、その場で QR を 見せる★
          //   ★本人の 画面（?t=）には 出しません★＝配るのは 事務所の 仕事
          // ★★明細にも「送る」を 出します★★ 2026-09-04（司さん「ないやないか」）
          //   ★渡し方の 2つ（見せる／送る）は 同じ 場所に 並べる★
          //   ★ボタンは 箱に 入れる★（裸で 並べると 折り返しで くっつく）
          (HONNIN
            ? ''
            : '<div class="noprint" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end">' +
              '<button class="btn ghost noprint" data-meisai-qr="' +
              esc(e.employee_id || '') +
              '">QRを 見せる</button>' +
              '<button class="btn ghost noprint" data-meisai-okuru="' +
              esc(e.employee_id || '') +
              '">送る</button>' +
              '</div>') +
          '</div>' +
          '</div>';
      }

      // ★字の作り方は ここ1本★（横＝紙 と 縦＝スマホ画面 で 二度書かない）
      //   2026-08-25：司さん「なんで2日分しか載せてないんど」
      //   実物は 1期＝10〜11日ぶん。横に並べると スマホでは ★2日ぶんしか見えない★。
      var F = SLIP_F;

      // ★★事務所の 画面は ★PDF と 同じ 紙★を そのまま 見せる★★ 2026-10-05
      //   司さん「PDFつくっとんやけんそれを見せろや」「何をくどくど訳わからんこと見せとんど」
      //   ★前★ 紙とは 別に 画面用の 横の表・縦の一覧を 組んでいた（＝PDF と 違う 物）。
      //   ⇒ 紙（__paper.build＝印刷・PDF と 同じ _buildPaperSheet）を 入れる 枠だけ 置き、
      //     描いた 後に kamiMadoNuru() が 埋める。本人の 画面（HONNIN）は 今まで 通り。
      if (!HONNIN) {
        html += '<div class="kami-mado" data-ei="' + ei + '"></div>';
      } else {
        // ───────── 横（今まで通り・★紙はこれ★）─────────
        html += '<div class="yoko scroller"><table><tbody>';

        // eslint-disable-next-line no-inner-declarations -- 2026-11-07 html から 出した 前からの 行（中身は 変えない・件2 で 直す）
        function row(label, get, aka) {
          var s = '<tr><th>' + esc(label) + '</th>';
          e.cells.forEach(function (c) {
            // ★赤にするかは payByFloor 1か所で決める★（画面と紙で 食い違わない）
            s += '<td' + (aka && payByFloor(c) ? ' class="floor"' : '') + '>' + get(c) + '</td>';
          });
          return s + '</tr>';
        }

        // 日付
        html += '<tr><th>日付</th>';
        e.cells.forEach(function (c) {
          html += '<th>' + mdw(c.date) + '</th>';
        });
        html += '</tr>';

        html += row('金額', F.pay, true); // ★最低保証で出た日は 赤★
        html += row('時間', F.hours);
        // ★車ごとの売上を載せるか（社長が決める・既定は載せる）★ 2026-08-25
        if (SHOW_CAR_SALES) {
          cars.forEach(function (x, n) {
            html += row('売上' + (n + 1) + '（' + x.car.label + '）', function (c) {
              return F.car(c, x.i);
            });
          });
        }
        html += row('時間（全台）', F.pool);

        html += '</tbody></table></div>';

        // ───────── 縦（★スマホの画面だけ★・1日1行で 全部の日が見える）─────────
        //   紙は ★1バイトも変えない★。出し分けは CSS（@media）だけ。
        html += '<div class="tate">';
        e.cells.forEach(function (c) {
          var pay = F.pay(c);
          var hh = F.hours(c);
          var yasumi = pay === '' && hh === '';
          html +=
            '<div class="d' +
            (yasumi ? ' off' : '') +
            '"><div class="dh"><b>' +
            mdw(c.date) +
            '</b>' +
            (yasumi
              ? '<span class="dn">—</span>'
              : '<span' +
                (payByFloor(c) ? ' class="floor"' : '') +
                '>¥' +
                pay +
                '</span><span>' +
                hh +
                ' 時間</span>') +
            '</div></div>';
          // ★スマホの一覧は 金額と時間だけ★ 2026-08-25（司さん
          //   「この一覧の所は 赤丸の部分除けて 金額と時間だけにして スマートにしろ」）
          //   売上・時間（全台）は ★紙（PDF）には 今までどおり出る★。
          //   ＝この画面は「いくら・何時間」を ざっと見る所、紙が 渡す物。
        });
        html += '</div>';
      }

      html += '</div>';
    });

    // ★会社に残る分（オーナーの 取り分）★ ★人の 名前は 出さない★（司さん 2026-09-04）
    // ★★本人モードでは 出しません★★ 2026-09-03
    //   ★従業員に 会社の 取り分・みんなの給料・売上合計を 見せない★
    //   ★絵を 開いて 見たら 本人の 画面に 出ていた★（数字だけ 見ていたら 気づかなかった）
    if (HONNIN) {
      box.innerHTML = html;
      return;
    }
    // ★★給料と 会社に残る分は 明細の 差引支給（人ごとに 丸めた 額）から★★ 2026-10-23 件G
    //   みんなの給料＝明細の 差引支給を 全員分 足した 額（REP.harai）＝月次集計の 回の 額と 同じ
    //   会社に残る分＝売上 − みんなの給料 − 積立（REP.nokori・決まりは js/payroll-daily.js の 1か所）
    html +=
      '<div class="card noprint"><b>会社に残る分</b>　¥' +
      yen(REP.nokori) +
      // ★売上・積立は 自分の 車も 入れた 全部★ 2026-10-23 件G（月次集計と 同じ 数・売上 − 給料 − 積立 ＝ 会社に残る分）
      '<div class="note">売上合計 ¥' +
      yen(REP.uriageZen) +
      '　／　積立 ¥' +
      yen(REP.reserveTotal + REP.reserveOwnerTotal) +
      '　／　みんなの給料 ¥' +
      yen(REP.harai) +
      '　／　時数合計 ' +
      hrs(REP.poolHoursTotal) +
      ' 時間</div></div>';
    // ★箱の 高さを 保って 入れ替える★ 2026-10-23（入れ替えた 直後は 紙の 箱が 空＝ページが 短く なり、
    //   幅を 測る 所で 巻いた 位置が その 底へ 詰められた。webkit 390×664 で 1147→469・kami-maki-zurenai）
    var tamotsu = box.offsetHeight;
    if (tamotsu) box.style.minHeight = tamotsu + 'px';
    box.innerHTML = html;
    kamiMadoNuru();
    box.style.minHeight = '';
  }

  // ★幅が 変わったら 紙を 描き直す★（10-05 対立役：PC で 開いて 窓を 縮めると 紙の 右が 切れた）
  // ★描いた 時の 幅（kamiMadoNuru が 残す data-haba）と 比べる★ 2026-10-23
  //   前は「前の 幅＝0」から 数え、iPhone の 幅の 同じ resize（帯の 伸び縮み・板の 開け閉め）で 全員の 紙を
  //   作り直して 巻いた 位置が 飛んだ（tests/e2e/kami-maki-zurenai.spec.js）
  window.addEventListener('resize', function () {
    if (HONNIN || TAB !== 'slip' || !REP) return;
    var b = $('slips');
    var w = b ? b.clientWidth : 0;
    if (!w || String(w) === b.getAttribute('data-haba')) return;
    clearTimeout(window.__slipT);
    window.__slipT = setTimeout(renderSlips, 150);
  });
  // ★本人の 画面は 幅が 変わったら 縮め直す だけ★ 2026-10-31（見本 _onViewportChange → fitInvoice と 同じ 3つの 合図）
  //   絵（本物の PDF）は 幅で 変わらない＝作り直さない（前は HTML の 紙を 幅ごとに 組み直していた）
  function hnMiseKawatta() {
    if (HONNIN) hnMiseFit();
  }
  window.addEventListener('resize', hnMiseKawatta);
  window.addEventListener('orientationchange', hnMiseKawatta);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', hnMiseKawatta);
