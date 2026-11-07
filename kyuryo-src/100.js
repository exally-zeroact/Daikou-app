  // ★★本人の 明細の 画面＝代行請求書と 同じ 作り★★ 2026-10-29 司さん
  //   「赤丸のどこが代行請求書と同じ作りなんどぼけ勝手にごちゃごちゃさすなや記録なくても押せる開くようにしろや」
  //   「PDFで保存/送ると印刷のボタンは同じ画面が開かれるんやけん1つのボタンにして印刷/送るにまとめろ 給料明細の画面も一緒にしろや」
  //   ・上の 並び（#hnBar）＝［月］［期間（1か月分／期間ごと）］の 選ぶ 欄 2つ ＋「📄 印刷 / 送る」1つ（代行請求書の 請求書の 欄と 同じ）
  //     ＝#slips の 外に 置く（辞めた 後の 月・締めが 読めない 等で #slips を 訳に 替えても 月を 選べる・対立役 止4）
  //   ・紙は 選んだ 範囲を 出す。記録が 無い 期間も ¥0 の 紙を 出し PDF も 作れる（前の「記録は ありません」は 無くした）
  //   ・前の 画面の 中の 見る 窓・「明細を コピー」「字で 送る」・期間の 札・［この 期間｜1か月分］の 切り替えは 無くした
  //   ・作るのは 事務所と 同じ 紙（_empSheets）と 同じ 道具（KamiEgaku＝代行請求書と 同じ pdf-lib・軽い 字体）
  //   ・★月・範囲を 替えたら 作った PDF を 捨てる★（HN_NO が 印・作っている 途中に 替えても 古い 物を 渡さない）
  var HN_NO = 0; // 月・範囲を 替えた 回数
  function hnHani() {
    return HN_HANI === 'tsuki' && PERIODS && PERIODS.length > 1 ? 'tsuki' : 'ki';
  }
  // ★月の 選ぶ 欄の 月★＝今日の 期の 月（HN_SAKI）か 今月の 遅い 方から 24か月 前まで（HN_SAKI が 無くても 今月まで 並べる）
  function hnTsukiNarabi() {
    var now = jstNow();
    var hate = now.getFullYear() * 12 + now.getMonth();
    if (HN_SAKI) hate = Math.max(hate, HN_SAKI.year * 12 + HN_SAKI.month - 1);
    var out = [];
    for (var i = 0; i < 24; i++) {
      var k = hate - i;
      out.push({ year: Math.floor(k / 12), month: (k % 12) + 1 });
    }
    return out;
  }
  // ★上の 並びを 描く★（月の 読みが 終わる 前でも 月は 選べる・期間は 読めた 月だけ）
  function hnBarKaku() {
    var bar = document.getElementById('hnBar');
    if (!bar) return;
    bar.hidden = false;
    var tsuki = hnTsukiNarabi();
    var aru = tsuki.some(function (t) {
      return t.year === HN_Y && t.month === HN_M;
    });
    if (!aru) tsuki.push({ year: HN_Y, month: HN_M });
    var yometa = HN_YOMI === HN_Y + '-' + HN_M && PERIODS && PERIODS.length;
    var ki = '';
    if (yometa) {
      if (PERIODS.length > 1)
        ki +=
          '<option value="tsuki"' + (hnHani() === 'tsuki' ? ' selected' : '') + '>1か月分</option>';
      for (var k = 0; k < PERIODS.length; k++)
        ki +=
          '<option value="' +
          k +
          '"' +
          (hnHani() === 'ki' && k === PIDX ? ' selected' : '') +
          '>' +
          esc(String(PERIODS[k].rangeLabel || k + 1 + '枚目').replace(/\s*〜\s*/g, '〜')) +
          '</option>';
    } else ki = '<option value="">―</option>';
    bar.innerHTML =
      '<div class="hn-filterbar">' +
      '<select class="hn-fselect" id="hnTsukiSel" aria-label="月">' +
      tsuki
        .map(function (t) {
          return (
            '<option value="' +
            t.year +
            '-' +
            t.month +
            '"' +
            (t.year === HN_Y && t.month === HN_M ? ' selected' : '') +
            '>' +
            t.year +
            '年' +
            t.month +
            '月</option>'
          );
        })
        .join('') +
      '</select>' +
      '<select class="hn-fselect" id="hnKikanSel" aria-label="期間"' +
      (yometa && PERIODS.length > 1 ? '' : ' disabled') +
      '>' +
      ki +
      '</select></div>' +
      '<button class="hn-btn-p" id="hnPdf" type="button">' +
      esc(hnPdfJi()) +
      '</button>' +
      '<div class="msg hn-pdf-err" id="hnPdfErr" hidden></div>' +
      '<div class="msg hn-pdf-annai" id="hnPdfAnnai" hidden></div>';
    hnPdfBotan();
    document.getElementById('hnPdf').onclick = honninPdf;
    document.getElementById('hnTsukiSel').onchange = function () {
      var v = String(this.value).split('-');
      var y = Number(v[0]);
      var m = Number(v[1]);
      if (!(y > 0 && m > 0)) return;
      honninTsuki((y - HN_Y) * 12 + (m - HN_M));
    };
    document.getElementById('hnKikanSel').onchange = function () {
      var v = this.value;
      if (v === 'tsuki') {
        HN_HANI = 'tsuki';
        hnPdfSuteru();
        honninKami();
        return;
      }
      if (v !== '') honninKikan(Number(v));
    };
  }
  // ★1つの 期間の 本人の 行★ → { e, rp } ／ 止める 時は { dame: 字 }
  //   ①report の 行が 在れば それ
  //   ②行が 無くて その 期間に 本人の 記録（時間・手当・控除）が 在る＝計算が 転んだ＝止める（¥0 に 倒さない・対立役 止5）
  //   ③記録が 無い＝勤め始めの 印（ctx.honnin）を 外した 写しで 回して ¥0 の 行を 作る（記録なくても 開く・司さん 10-29）
  //     辞めた 人も 写しの 中では 今いる 人と して 回す（辞めた 後の 記録の 無い 期も ¥0・2026-10-30）
  //     写しでも 行が 無い・写しの 行に 働いた 日／手当・控除が 在る 時は 止める
  function hnKiNoE(p) {
    var rp = PayrollDaily.report((p && p.dates) || [], CTX);
    var e = rp && rp.employees ? rp.employees[0] : null;
    if (e) return { e: e, rp: rp };
    var hd = (CTX && CTX.hoursByDate) || {};
    var ad = (CTX && CTX.adjByDate) || {};
    var kiroku = ((p && p.dates) || []).some(function (d) {
      return (hd[d] && Object.keys(hd[d]).length) || (ad[d] && ad[d].length);
    });
    var keisanNg = {
      dame:
        String((p && p.rangeLabel) || '') +
        ' の 明細を 計算できませんでした。画面を 開き直してください（直らない 時は 会社に 知らせてください）。',
    };
    if (kiroku) return keisanNg;
    // ★辞めた 人（active=false）も 今いる 人と して 回す★ 2026-10-30（本番前の 対立役 止1：report は 辞めた 人の 行を
    //   記録の 在る 期しか 返さず、記録の 無い 期で「計算できませんでした・会社に知らせて」と 嘘が 出た・1か月分も 止まった）
    //   ＝写しの 中の 本人の 札だけ 替える（本物の CTX と RAW は 触らない）。¥0 か どうかは 下の 門が 見る
    var rp2 = PayrollDaily.report(
      (p && p.dates) || [],
      Object.assign({}, CTX, {
        honnin: false,
        _hajime: null,
        employees: ((CTX && CTX.employees) || []).map(function (x) {
          return Object.assign({}, x, { active: true });
        }),
      })
    );
    var e2 = rp2 && rp2.employees ? rp2.employees[0] : null;
    if (!e2) return keisanNg;
    if (e2.workedDays > 0 || (e2.adj || []).length > 0) return keisanNg;
    return { e: e2, rp: rp2 };
  }
  // 今の 範囲の 期間と 行 → { ki: [{ p, e, rp }] } ／ { dame }
  function hnHaniNoKi() {
    if (HN_KEISAN_NG || !CTX) return { dame: HN_KEISAN_NG_BUN };
    if (kyuDameBun(CTX)) return { dame: kyuDameBun(CTX) };
    var ps = hnHani() === 'tsuki' ? PERIODS || [] : PERIOD ? [PERIOD] : [];
    if (!ps.length) return { dame: 'この 月に 締める 給料は ありません。' };
    var ki = [];
    for (var i = 0; i < ps.length; i++) {
      var r = hnKiNoE(ps[i]);
      if (r.dame) return r;
      ki.push({ p: ps[i], e: r.e, rp: r.rp });
    }
    return { ki: ki };
  }
  // ★明細の 紙と 同じ 字の 行★（働いた 分／＋手当／−控除／＝差引支給）＝紙の 内わけ（adjMigi）が 使う
  function meisaiJiGyou(e) {
    var gyou = ['働いた 分 ¥' + yen(e.kasegi)];
    (e.adj || []).forEach(function (a) {
      var na = a.label || (a.kind === 'koujo' ? '控除' : '手当');
      gyou.push((a.kind === 'koujo' ? '− ' : '＋ ') + na + ' ¥' + yen(a.yen));
    });
    return { gyou: gyou, owari: '＝ 差引 支給 ¥' + yen(e.totalPay) };
  }
  // ★期間ごとに 紙を 組む★（見出しは その 期間＝PERIOD を 一時 替えて finally で 戻す＝テンプレの 見本 tplMihon と 同じ 形）
  function hnKiNoKami(k, hami) {
    var mae = PERIOD;
    try {
      PERIOD = k.p;
      var cars = slipCars(k.rp.cars, k.e.employee_id);
      if (hami && _maisu(k.e, showCarSalesNow(), cars).hamidasu) hami.push(k);
      return _empSheets(k.e, cars);
    } finally {
      PERIOD = mae;
    }
  }
  var HN_PDF = null; // 作った PDF { no, blob, name }
  var HN_PDF_CHU = -1; // 作っている 途中の 印（HN_NO と 同じ 時だけ 作っている 途中）
  var HN_PDF_MATSU = -1; // 押されて 出来上がりを 待つ 印（HN_NO と 同じ 時だけ・出来たら そのまま 出す）
  // ★出した 後 1秒は 止める 印★（連打で 2本 出さない）。時刻の 差で 測らない＝端末の 時計が 戻ると 押せないまま 残る
  //   （試験の 止めた 時計でも 同じ＝テスト線 E2E okuru ② が 30秒 押せず 赤 10-31）。タイマーで 外す
  var HN_PDF_TOMETA = false;
  var HN_RENDA_MS = 1000;
  function hnPdfSuteru() {
    if (window.PdfOkuru) PdfOkuru.kesu(); // ★選び直した＝前の 紙の「送る・印刷する」の 帯を 消す（送らない）★
    HN_NO++;
    HN_PDF = null;
    HN_PDF_CHU = -1;
    HN_PDF_MATSU = -1;
    hnPdfBotan();
    hnMiseSuteru();
  }
  function hnPdfAru() {
    return !!(HN_PDF && HN_PDF.no === HN_NO);
  }
  // ★ボタンの 字は 代行請求書と 同じ★ 2026-10-31 司さん「なんなんPDFを作ってますって 代行請求書アプリの請求/集計の作りを見ろや」
  //   ＝裏で 作っている 間も「📄 印刷 / 送る」の まま 押せる。押して 待つ 間だけ「PDF作成中…」（見本 exportInvoicePDF と 同じ 字）
  //   前は ホーム画面の アプリで 紙を 描いた とたん 裏の 作りで「PDFを 作っています…」に なり 押せなかった
  function hnPdfJi() {
    if (HN_PDF_MATSU === HN_NO && !hnPdfAru()) return 'PDF作成中…';
    return '📄 印刷 / 送る';
  }
  function hnPdfBotan() {
    var b = document.getElementById('hnPdf');
    if (!b) return;
    // ★同じ 字・同じ 止めは 書き直さない★（textContent は 同じ 字でも 字の 節を 替える。
    //   WebKit は 押し始めた 時の 字の 節を click の 的に 持つ＝押している 間に 節が 替わると click を 出さない
    //   （iPhone の 形も PC の 形も 0 回・chromium は 1 回＝対立役 10-31 測り）。裏の 作りが 終わった 時に
    //   押した 人の 押しが 消える。本番 CI webkit ④b の 最初の 押しで 保存 0・30秒 10-31）
    var ji = hnPdfJi();
    if (b.textContent !== ji) b.textContent = ji;
    var yometa = HN_YOMI === HN_Y + '-' + HN_M && PERIODS && PERIODS.length;
    var tome = !!(!yometa || (HN_PDF_MATSU === HN_NO && !hnPdfAru()) || HN_PDF_TOMETA);
    if (b.disabled !== tome) b.disabled = tome;
  }
  // ★訳は ボタンの すぐ 下に 出す★（#err は 画面の 一番 上＝下で 押した 人には 見えない・対立役）
  function hnPdfErr(bun) {
    var el = document.getElementById('hnPdfErr');
    if (!el) return;
    el.textContent = bun || '';
    el.hidden = !bun;
  }
  // ★案内（間違いでは ない＝赤く しない）★ 上の 並びに 置く（消えない 所・対立役 止2）
  function hnAnnai(bun) {
    var el = document.getElementById('hnPdfAnnai');
    if (!el) return;
    el.textContent = bun || '';
    el.hidden = !bun;
  }
  // ★名前は 本人が 見ている 月から★（期間が 2つ以上の 月は 期間も 付ける・1か月分は「1か月分」）
  function hnPdfNamae(emp) {
    var nm = '給料明細_' + HN_Y + '-' + String(HN_M).padStart(2, '0');
    if (hnHani() === 'tsuki') nm += '_1か月分';
    else if (PERIODS && PERIODS.length > 1 && PERIOD)
      nm += '_' + String(PERIOD.start).slice(5) + '〜' + String(PERIOD.end).slice(5);
    nm += '_' + String((emp && emp.name) || '');
    return nm.replace(/[\\/:*?"<>|]/g, '_') + '.pdf';
  }
  // ★出す★ 2026-11-06 司さんの 答え B（代行請求書 本番 bdecd29 と 同じ・js/pdf-okuru.js）
  //   iPhone・iPad＝共有の 画面に ★PDF と 字（text）だけ★ 渡す（url・title は 付けない）。
  //   保存の 道（a download）で 開いた PDF の 画面から 共有すると blob:https://… の URL も 届いた（司さん 11-04）。
  //   ★files だけ（字 無し）の 古い 形には 戻さない★（10-30「LINEないやないか」＝その 形は LINE が 並ばない。
  //   files＋text は 司さんの 実機で LINE に 字と PDF が 届いた 11-06）。
  //   Android・PC・共有が 無い 端末＝今までの 道（下の 保存／窓）
  // ★出した 後 1秒は ボタンを 止める★（見本は 押すと 作り終わるまで 止める＝連打で 2本 出ない。
  //   こちらは 裏で 作り済みなら すぐ 出る＝止めが 無いと ダブルクリックで 2本 保存・本番前 対立役 止1 10-31）
  function hnPdfDasu(p) {
    if (HN_PDF_TOMETA) return;
    HN_PDF_TOMETA = true;
    // ★外す タイマーは 保存より 先に★（保存が 転ぶと 印が 立った まま＝黙って 出なく なる・対立役 注1 10-31）
    setTimeout(function () {
      HN_PDF_TOMETA = false;
      hnPdfBotan();
    }, HN_RENDA_MS);
    hnPdfBotan();
    // ★iPhone・iPad＝共有へ★ 作り済みなら click の 中で そのまま 共有を 開く（then を 挟まない＝押した 扱いが 切れない）
    //   作り待ちの 後で 断られた（NotAllowedError）＝帯「送る・印刷する」
    //   ★共有が 無い iPhone（tsukaeru が 偽）は 下の 今の 道を その 場で＝押した 手の 中で 保存（約束を 待たない・e2e ⑯）★
    if (window.PdfOkuru && PdfOkuru.tsukaeru(window.navigator)) {
      var miss0 = window.KamiEgaku ? window.KamiEgaku.missingBun(p.missing) : '';
      PdfOkuru.okuru(p.blob, p.name, PdfOkuru.namaeJi(p.name), window, {
        chui: miss0,
        hiraku: function () {
          hnPdfHozon(p);
        },
        // ★押した 頭で 前の 帯を 消す★（見本 exportInvoicePDF と 同じ・残ると 同じ PDF を 2回 送れる・作った後の 対立役 止3）
        kai: PdfOkuru.kesu(),
      })
        .then(function (ok) {
          if (ok.how === 'none') return hnPdfImaNoMichi(p);
          hnAnnai(PdfOkuru.bun(ok.how, miss0) || '');
        })
        .catch(function (e) {
          // ★見本 exportInvoicePDF の catch と 同じ 字★（黙って 終わらない・作った後の 対立役 注3）
          hnPdfErr('PDF作成に失敗：' + (e && e.message ? e.message : e));
        });
      return;
    }
    hnPdfImaNoMichi(p);
  }
  // ★今までの 道★（Android・PC・共有が 無い iPhone）
  function hnPdfImaNoMichi(p) {
    try {
      // ★スマホは 保存（PDF の 画面が 開き 共有から 送る・プリント）／PC は 新しい 窓で 開く（印刷も 保存も そこから）★
      //   見本 exportInvoicePDF（daikou-seikyu）の !insatsuSumaho の 道と 同じ 2026-11-01（司さん 指示②）
      //   PC で 保存だけに すると ダウンロード欄に 入るだけで 印刷の 画面が 出ない。窓を 止められたら 保存に 落とす
      var pcMado = false;
      if (!insatsuSumaho()) {
        var url = URL.createObjectURL(new Blob([p.blob], { type: 'application/pdf' }));
        pcMado = !!window.open(url, '_blank');
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 60000);
      }
      if (!pcMado) hnPdfHozon(p);
      // ★案内の 字は 見本 exportInvoicePDF の toast と 1字も 違えない★（2026-11-01 見本との違い②）
      //   出せない 字 ⇒ その 知らせだけ／窓で 開いた ⇒「開きました」／保存（スマホ・PC で 窓を 止められた）⇒「作成しました」
      //   前は 保存の 時だけ 長い 案内（共有（□↑）・ダウンロード・LINE の 中）を 出していた＝見本に 無い 違い
      var miss = window.KamiEgaku ? window.KamiEgaku.missingBun(p.missing) : '';
      hnAnnai(
        miss
          ? miss
          : pcMado
            ? 'PDFを開きました（印刷・保存は その画面から）'
            : 'PDFを作成しました（開いた画面の共有から 送る・プリント）'
      );
    } catch (e) {
      // ★見本 exportInvoicePDF の catch と 同じ 字★（見本との違い③ 2026-11-01）
      hnPdfErr('PDF作成に失敗：' + (e && e.message ? e.message : e));
    }
  }
  // スマホ・タブレット・ホーム画面の アプリ＝保存の 道（新しい 窓は 戻れなく なる 端末が 在る）
  //   ★見本 daikou-seikyu の insatsuSumaho を 1行も 変えずに 写した★（違いを 作るな＝司さん 10-31）
  function insatsuSumaho() {
    try {
      var n = window.navigator || {};
      if (n.standalone === true) return true;
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      var ua = String(n.userAgent || '');
      if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua)) return true;
      return /Macintosh/.test(ua) && (n.maxTouchPoints || 0) > 1; // iPadOS の Safari
    } catch (_) {
      return true;
    }
  }
  // ★「印刷 / 送る」★ 押すと 選んだ 範囲の PDF を そのまま 出す（代行請求書の「印刷 / 送る」と 同じ 1回）
  //   紙を 描いた 時に 裏で 作っておく（どの 端末も・見本は 月を 選んだ 時に 作る）＝押したら すぐ 出る。
  //   出来て いなければ「PDF作成中…」で 待ち 作り終わってから 出す（裏の 作りが 失敗した 後は 作り直す・対立役 止1 10-30）
  function honninPdf() {
    hnPdfErr('');
    hnAnnai('');
    if (hnPdfAru()) return hnPdfDasu(HN_PDF);
    HN_PDF_MATSU = HN_NO;
    if (HN_PDF_CHU === HN_NO) return hnPdfBotan();
    hnPdfTsukuru();
  }
  function hnPdfTsukuru() {
    var h = hnHaniNoKi();
    if (h.dame) {
      if (HN_PDF_MATSU === HN_NO) {
        HN_PDF_MATSU = -1;
        // ★待つ 印を 外したら ボタンも 戻す★（転んだ 後は REP が 無く 描き直しが 走らない＝字が「PDF作成中…」の まま 残り得る・2026-10-31）
        hnPdfBotan();
        hnPdfErr(h.dame);
      }
      return;
    }
    var emp = h.ki[0].e;
    var no = HN_NO;
    var dougu = false;
    HN_PDF_CHU = no;
    hnPdfBotan();
    // ★道具の 読み込みにも 時間切れ★（字体 約 4.7MB・電波が 止まると「作っています…」の まま 押せなくなる・対立役 軽2）
    _withTimeout(loadPdfLibs(), PDF_TIMEOUT_MS, '道具')
      .then(function (E) {
        dougu = true;
        if (no !== HN_NO) return null;
        if (typeof E.tsukuru !== 'function') throw new Error('PDF の 道具が 古い');
        // ★字体を 読んだ 後で 測る★（事務所の hamiTomeru と 同じ・控えの 字体で 測ると 食い違う）
        var hami = [];
        var sheets = [];
        h.ki.forEach(function (k) {
          sheets = sheets.concat(hnKiNoKami(k, hami));
        });
        if (hami.length)
          throw new Error(
            'hamidasu:' + (h.ki.length > 1 ? String(hami[0].p.rangeLabel || '') : '')
          );
        return _withTimeout(E.tsukuru(sheets, KAMI_KATA), PDF_TIMEOUT_MS, 'PDF');
      })
      .then(function (d) {
        if (HN_PDF_CHU === no) HN_PDF_CHU = -1;
        if (no !== HN_NO || !d) return; // 替えた 後に できた 物は 捨てる
        HN_PDF = { no: no, blob: d.blob, name: hnPdfNamae(emp), missing: d.missing || [] };
        var matsu = HN_PDF_MATSU === no;
        if (matsu) HN_PDF_MATSU = -1;
        hnPdfBotan();
        if (matsu) hnPdfDasu(HN_PDF);
        hnMiseru(HN_PDF); // ★出来た PDF を そのまま 絵に★（見本 renderInvoicePreviewPDF）
      })
      .catch(function (err) {
        if (HN_PDF_CHU === no) HN_PDF_CHU = -1;
        // ★訳は 押して 待つ 人に だけ★（見本 exportInvoicePDF も 押した 時だけ 訳を 出す）2026-10-31（本番前 対立役 注1：
        //   裏の 作りが 全端末に なり、押していない 人にも「通信・紙に 入らない」が ボタンの 下に 出た）
        //   押していない 時は 黙って 捨てる＝押せば 作り直し、転べば その 時に 訳を 出す
        var matsu = HN_PDF_MATSU === no;
        if (matsu) HN_PDF_MATSU = -1;
        if (no !== HN_NO) return;
        hnPdfBotan();
        var wake = hnPdfWake(err, dougu);
        // ★絵の 所にも 訳★（見本 _doGenerateInvoices の catch＝「プレビュー作成に失敗：…」を .li-empty で）
        //   紙に 入らない（hamidasu）時も 同じ＝切れた 紙は 見せない（見本と 同じ・設計前 対立役 N5 10-31）
        hnMiseKara('プレビュー作成に失敗：' + wake);
        if (!matsu) {
          // eslint-disable-next-line no-console -- 2026-11-07 html から 出した 前からの 行（中身は 変えない・件2 で 直す）
          if (window.console) console.warn('[本人の PDF 裏の 作り]', err);
          return;
        }
        // ★ボタンの 下の 字は 見本 exportInvoicePDF の catch と 同じ「PDF作成に失敗：」＋訳★（見本との違い③ 2026-11-01）
        //   道具（字体・pdf-lib）が 読めない 時も 同じ＝見本も 押した 後に 読む 道具（loadAssets）で 転ぶと この catch。
        //   見本の「読み込み待ちです」は 押す 前の 確かめ（InvoicePDF が 未定義）＝うちには 当たる 場面が 無い（設計前 対立役 止1）
        hnPdfErr('PDF作成に失敗：' + wake);
      });
  }
  // ★作れなかった 訳★（ボタンの 下＝「PDF作成に失敗：」の 後ろ・絵の 所＝「プレビュー作成に失敗：」の 後ろ）
  //   見本の e.message に 当たる 所＝訳だけ（「もう一度 押してください」は 見本に 無い・見本との違い③ 2026-11-01）
  function hnPdfWake(err, dougu) {
    var m = String((err && err.message) || err || '');
    if (m.indexOf('hamidasu:') === 0)
      return (
        (m.slice(9) ? m.slice(9) + ' の ' : '') +
        '手当・控除が 多すぎて 明細の 紙に 入りません（会社に 知らせてください）'
      );
    if (m.indexOf('PDF が ') === 0)
      return (
        '紙を 作るのに ' + Math.round(PDF_TIMEOUT_MS / 1000) + '秒 かかっても 終わりませんでした'
      );
    if (m === 'PDF の 道具が 古い')
      return 'PDF の 道具が 古い（この 画面を 一度 閉じて 開き直してください）';
    if (!dougu) return 'PDF の 道具を 読めませんでした（通信）';
    return m;
  }
  // ★保存（ダウンロード）★ 見本の InvoicePDF.save（invoice-pdf.js）と 同じ 形＝a の download で 名前つきで 落とす
  //   ★ホーム画面の アプリでも これ★（2026-10-30・見本と 同じ。前の 心配＝戻れなく なる 事故は サーバーの 生ファイルへの a で、
  //   ここは blob の PDF＝見本の 代行請求書の コードも ホーム画面で 同じ 道・iPhone の ホーム画面で 戻れるかは 実機では 未測定）
  //   URL は 60秒 残す（保存の 画面を 待つ 間に 消すと 白い 窓に なり得る・対立役 S2）
  function hnPdfHozon(p) {
    var url = URL.createObjectURL(p.blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = p.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 60000);
    // 案内の 字は 呼ぶ 側（hnPdfDasu）が 見本と 同じ 字で 出す（見本 InvoicePDF.save も 字を 出さない）
  }

