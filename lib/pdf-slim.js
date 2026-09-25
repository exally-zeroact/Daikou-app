/* pdf-slim.js — ★どのアプリでも 使える「字体を 軽くして PDFを 作る」受け皿★
 * ==============================================================================
 * ★なぜ（2026-09-05 司さん）★
 *   「請求書1枚で 重すぎるやろが／ええとこ200kBぐらいのもんやろが／構造がおかしいんやろが」
 *   「代行請求書の…8月分の方も 今みたら 3MBぐらいある／おかしいやろ」
 *   「★全アプリ共通やろが／請求書に限らず PDFにするとき★」
 *
 * ★実測（2026-09-05）★
 *   PDFの 94%が 字体。BIZUDPGothic-Regular.ttf ＝4,669,688B・13,932字を
 *   ★1通の紙に 丸ごと 同梱★していた（紙の中身は 7KB）。
 *   直した後 … 請求書1通 ★3,087,087B → 88,558B（35分の1）★／絵は ★1画素も 違わない★
 *
 * ★pdf-lib の 間引き(subset:true)は 使えない★（絵で 再現ずみ）
 *   「株式会社ダイコメ運輸 御中」→「株式 コメ 御」／「請 求 書」は 丸ごと 消えた。
 *   ⇒ ★lib/font-slim.js（番号を 1つも 動かさない やり方）を 使う★。
 *
 * ★この受け皿が やる事★
 *   ① 紙を ★2回 描く★。1回目は ★使う字を 拾うだけ★（保存しない＝重い書き出しは しない）。
 *   ② 拾った字だけ 形を 残した 字体を 作る。
 *   ③ 2回目は その字体で 描いて 保存する。
 *   ★描く側の コードは 1行も 変えなくてよい★
 *   ＝紙(page)の drawText を そっと 挟んで 字を 拾うので、
 *     「描きながら 字が 決まる」作りの アプリでも そのまま 使える。
 *   ★作れなければ 丸ごとの 字体で 出す★＝軽くする為に 字を 落とさない。
 *
 * 【使い方】
 *   var bytes = await PdfSlim.build({
 *     PDFLib: PDFLib, fontkit: fontkit, fontBytes: ttfBytes,
 *     draw: function (doc, font) { …紙を 描く（addPage / drawText）… }
 *   });
 *
 * 【利用】window.PdfSlim ／ require('./pdf-slim.js')
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./font-slim.js'));
  else root.PdfSlim = factory(root.FontSlim);
}(typeof self !== 'undefined' ? self : this, function (FontSlim) {
  'use strict';

  /** ★紙に 置いた字を そっと 拾う★（描く側の コードは 触らない） */
  function hookDoc(doc, sink) {
    var add = doc.addPage.bind(doc);
    doc.addPage = function () {
      var page = add.apply(null, arguments);
      var dt = page.drawText.bind(page);
      page.drawText = function (s, o) { sink(String(s == null ? '' : s)); return dt(s, o); };
      return page;
    };
    return doc;
  }

  /** 拾った字 → 字の番号と 対応表 */
  function mojiToGid(fontkit, fontBytes, moji) {
    var fk = fontkit.create(fontBytes);
    var gid = { 0: true }, pairs = [], mita = {};
    /* ★字体が 持っていない字の 代わり★も 一緒に 残す（アプリごとに 違うので 両方） */
    var zen = moji + '〓?';
    for (var i = 0; i < zen.length; i++) {
      var cp = zen.codePointAt(i);
      if (cp > 0xFFFF) i++;                       /* サロゲートは 2つで 1字 */
      if (mita[cp]) continue;
      mita[cp] = true;
      try {
        var gs = fk.layout(String.fromCodePoint(cp)).glyphs;
        for (var k = 0; k < gs.length; k++) gid[gs[k].id] = true;
      } catch (e) { /* 出せない字は アプリ側が 印に する */ }
      try {
        var g1 = fk.glyphForCodePoint(cp);
        if (g1 && g1.id > 0) { gid[g1.id] = true; pairs.push([cp, g1.id]); }
      } catch (e2) { /* 同上 */ }
    }
    return { gids: Object.keys(gid).map(Number), pairs: pairs };
  }

  var _last = null;
  /** ★どれだけ 軽く できたか★（報告と 見張りが 読む） */
  function lastInfo() { return _last; }

  /**
   * ★字体を 軽くして PDFを 作る★
   * @param {object} o
   *   o.PDFLib / o.fontkit / o.fontBytes … 借りている 道具と 字体
   *   o.draw(doc, font) … 紙を 描く（2回 呼ばれる。★2回とも 同じ物を 描く事★）
   *   o.slim … false で 今までどおり 丸ごと（測り比べ用）
   * @returns {Promise<Uint8Array>}
   */
  /** ★渡す前に 必ず 写す★
   *  pdf-lib の embedFont は 渡した バイト列を そのまま 抱え込む。
   *  ★同じ物を 2回 渡すと 2回目が「Unknown font format」で 落ちる★（2026-09-05 代行で 実測）。
   *  ＝紙を 2回 描く この作りでは ★毎回 別の 写しを 渡す★。 */
  function copy(b) {
    var u = (b instanceof Uint8Array) ? b : new Uint8Array(b);
    var c = new Uint8Array(u.length);
    c.set(u);
    return c;
  }

  function build(o) {
    var PDFLib = o.PDFLib, fontkit = o.fontkit, draw = o.draw;
    /* ★呼び手の 字体には 触らない★
       pdf-lib の embedFont も fontkit.create も ★渡された バイト列を そのまま 抱え込み、
       中で 書き換える事が ある★。
       ★2026-09-05 代行で 実測★ … 描く側が fontkit.create(a.fontBytes) を 呼んでいて、
       その後 同じ物から 作った 字体が「Unknown font format」に なった。
       ⇒ ★ここで 1本 写しを 取り、以後 それを 元本として 毎回 更に 写して 渡す★。 */
    var fontBytes = copy(o.fontBytes);
    var moji = [];
    var t0 = (typeof Date !== 'undefined') ? Date.now() : 0;
    return Promise.resolve()
      .then(function () {
        if (o.slim === false) return null;
        /* ── ① 1回目＝使う字を 拾うだけ（保存しない） ── */
        return PDFLib.PDFDocument.create().then(function (d1) {
          d1.registerFontkit(fontkit);
          return d1.embedFont(copy(fontBytes), { subset: false }).then(function (f1) {
            hookDoc(d1, function (s) { moji.push(s); });
            return Promise.resolve(draw(d1, f1)).then(function () { return true; });
          });
        }).catch(function () { return null; });        /* 拾えなければ 丸ごとで 出す */
      })
      .then(function (hirota) {
        var slim = null, ji = 0;
        if (hirota && FontSlim && moji.length) {
          try {
            var m = mojiToGid(fontkit, copy(fontBytes), moji.join(''));
            ji = m.pairs.length;
            slim = FontSlim.slim(copy(fontBytes), m.gids, m.pairs);
          } catch (e) { slim = null; }
        }
        /* ── ③ 2回目＝その字体で 本番の 紙を 作る ── */
        return PDFLib.PDFDocument.create().then(function (d2) {
          d2.registerFontkit(fontkit);
          return d2.embedFont(copy(slim || fontBytes), { subset: false }).then(function (f2) {
            return Promise.resolve(draw(d2, f2)).then(function () { return d2.save(); });
          });
        }).then(function (bytes) {
          _last = { moto: fontBytes.length, ato: slim ? slim.length : fontBytes.length,
            ji: ji, pdf: bytes.length, marugoto: !slim,
            ms: ((typeof Date !== 'undefined') ? Date.now() : 0) - t0 };
          return bytes;
        });
      });
  }

  return { build: build, lastInfo: lastInfo, _hookDoc: hookDoc, _mojiToGid: mojiToGid };
}));
