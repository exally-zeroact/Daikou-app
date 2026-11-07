  // ============================================================
  // ★★本人の 明細の 絵＝本物の PDF を pdf.js で 描く★★ 2026-10-31（司さん 指示①
  //   「代行請求書アプリの請求/集計の作りを見ろや 何回もゆわすな」）
  //   見本＝daikou-seikyu の ensurePdfjs／generateInvoices(immediate)／renderInvoicePreviewPDF／fitInvoice／_invEmpty。
  //   前は HTML の 紙（PDF を 作る 前の 板）を 縮めて 見せていた＝押して 出る PDF と 別の 物を 見せていた
  // ============================================================
  // pdf.js は vendor から 遅れて 読む（CDN を 使わない＝見本と 同じ 版・同じ バイト）
  var _pdfjsReady = null;
  function ensurePdfjs() {
    if (_pdfjsReady) return _pdfjsReady;
    _pdfjsReady = new Promise(function (res, rej) {
      if (window.pdfjsLib) return res(window.pdfjsLib);
      var s = document.createElement('script');
      s.src = 'vendor/pdf.min.js';
      s.onload = function () {
        res(window.pdfjsLib);
      };
      s.onerror = function () {
        rej(new Error('pdf.js読込失敗'));
      };
      document.head.appendChild(s);
    }).then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      return lib;
    });
    return _pdfjsReady;
  }
  // 描き終えた 絵の 束（今の HN_NO の 1束 だけ 持つ・設計前 対立役 N3）
  var HN_MISE = { no: -1, inner: null };
  var HN_MISE_SEQ = 0;
  var HN_MISE_FURUI = {};
  // ★捨てた 絵の canvas は 0 に して 放す★（iPhone の canvas の 総量に 溜めない・対立役 N2/N3）
  function hnMiseHanasu(inner) {
    if (!inner) return;
    Array.prototype.forEach.call(inner.querySelectorAll('canvas'), function (c) {
      c.width = 0;
      c.height = 0;
    });
    if (inner.parentNode) inner.parentNode.removeChild(inner);
  }
  // 画面から 外れた 束（月を 替えた・止めた 文に 替わった）を 放す
  //   ★HN_MISE が 置かれる 前にも 呼ばれる★（札の 道は 読み込みの 途中で hnPdfSuteru を 呼ぶ＝var は まだ undefined）
  function hnMiseSuteru() {
    if (HN_MISE && HN_MISE.inner && !HN_MISE.inner.isConnected) {
      hnMiseHanasu(HN_MISE.inner);
      HN_MISE = { no: -1, inner: null };
    }
  }
  // 見本 fitInvoice と 同じ＝720px の 紙を 枠の 幅に 縮め、縮めた 後の 高さを 枠に 入れる
  function hnMiseFit() {
    var out = document.getElementById('hnKami');
    if (!out) return;
    var inner = out.querySelector('.inv-scale-inner');
    if (!inner) return;
    if (out.clientWidth <= 0) return; // 見えない 間は scale(0) を 当てない
    var s = Math.min(1, out.clientWidth / 720);
    inner.style.transform = 'scale(' + s + ')';
    out.style.height = inner.offsetHeight * s + 'px';
  }
  // 見本 _invEmpty と 同じ＝絵の 所に 訳だけ（.li-empty）
  function hnMiseKara(msg) {
    var out = document.getElementById('hnKami');
    if (!out) return;
    HN_MISE_SEQ++;
    var old = HN_MISE && HN_MISE.inner;
    HN_MISE = { no: -1, inner: null };
    out.classList.remove('inv-loading');
    out.removeAttribute('data-hn-no');
    out.innerHTML = '<div class="li-empty">' + esc(msg) + '</div>';
    out.style.height = '';
    hnMiseHanasu(old);
  }
  // 見本 renderInvoicePreviewPDF と 同じ＝1ページ＝1枚の canvas（scale 2）を .sheet.sheet-pdf で 包む。
  //   全ページ 描き終えてから 入れ替える（前の 絵は 覆いの 下に 残す＝ちらつかない）
  function hnMiseru(p) {
    var seq = ++HN_MISE_SEQ;
    var no = p.no;
    var pdf = null;
    function furui() {
      return seq !== HN_MISE_SEQ || no !== HN_NO;
    }
    var inner = document.createElement('div');
    inner.className = 'inv-scale-inner';
    return ensurePdfjs()
      .then(function (pdfjs) {
        if (furui()) return null;
        // ★毎回 新しい 写し★（pdf.js は 渡した 配列を 外す＝同じ blob を 出す 道と 食い合わない）
        return p.blob.arrayBuffer().then(function (buf) {
          if (furui()) return null;
          return pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
        });
      })
      .then(function (d) {
        if (!d) return false;
        pdf = d;
        var jun = Promise.resolve();
        for (var n = 1; n <= pdf.numPages; n++)
          (function (pn) {
            jun = jun.then(function () {
              if (furui()) throw HN_MISE_FURUI;
              return pdf.getPage(pn).then(function (pg) {
                var vp = pg.getViewport({ scale: 2 }); // 高い 解像度＝印刷でも くっきり（見本と 同じ）
                var cv = document.createElement('canvas');
                cv.width = vp.width;
                cv.height = vp.height;
                cv.className = 'inv-pdf-canvas';
                var sheet = document.createElement('div');
                sheet.className = 'sheet sheet-pdf';
                sheet.dataset.page = pn;
                sheet.appendChild(cv);
                inner.appendChild(sheet);
                return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
              });
            });
          })(n);
        return jun.then(function () {
          return true;
        });
      })
      .then(function (ok) {
        if (!ok || furui()) return hnMiseHanasu(inner);
        // ★入れる 枠は 描き終えた 後で 取り直す★（待つ 間に 止めた 文・月替えで 箱が 替わる・対立役 N2）
        var out = document.getElementById('hnKami');
        if (!out) return hnMiseHanasu(inner);
        var old = HN_MISE && HN_MISE.inner;
        out.innerHTML = '';
        out.appendChild(inner);
        if (old && old !== inner) hnMiseHanasu(old);
        HN_MISE = { no: no, inner: inner };
        out.setAttribute('data-hn-no', String(no)); // 描き終えた 印（試験が 待つ）
        out.classList.remove('inv-loading');
        hnMiseFit();
      })
      .catch(function (e) {
        hnMiseHanasu(inner);
        if (e === HN_MISE_FURUI || furui()) return;
        hnMiseKara('プレビュー作成に失敗：' + (e && e.message ? e.message : e));
      })
      .then(function () {
        if (pdf)
          try {
            pdf.destroy();
          } catch (_) {
            /* もう 放した */
          }
      });
  }

