/* font-slim.js — ★使う字だけ 形を 残した 字体を 作る★（借り物ゼロ・自前）
 * ==============================================================================
 * ★なぜ（2026-09-05 司さん）★
 *   「請求書1枚で 重すぎるやろが／ええとこ200kBぐらいのもんやろが／構造がおかしいんやろが」
 *   実測 … 実物の 請求書PDF 327本の 中央値 ★0.31MB★ に対し うちは ★2.94MB（9.4倍）★。
 *   PDFの ★94%が 字体★（BIZUDPGothic-Regular.ttf 4,669,688B・13,932字）を
 *   ★1通の 紙に 丸ごと 同梱★していた。代行請求アプリも ★同じ pdf-lib（sha256 一致）★で 同じ。
 *
 * ★なぜ pdf-lib の subset を 使わないか（2026-09-05 絵で 再現）★
 *   embedFont(..., {subset:true}) は 38,713B まで 小さくなるが ★字が 落ちる★。
 *   Windowsの PDF描画で 絵に して 見たら
 *     「株式会社ダイコメ運輸 御中」→ ★「株式 コメ 御」★／「請 求 書」は ★丸ごと 消えた★。
 *   ★埋まった字体を ほどいて「形が 入っているか」を 数える検査は 緑を 出した＝嘘だった★。
 *   （[[feedback_numbers_green_but_open_the_picture]]）
 *
 * ★ここの やり方（★番号を 1つも 動かさない★）★
 *   ・字の 番号（glyph id）は ★元のまま★。並べ替えない・詰め直さない。
 *   ・cmap（字→番号）も hmtx（字送り）も maxp も ★そのまま 写す★。
 *   ・★glyf（形）だけ★ 使わない字を 空に して、loca（形の 目次）を 作り直す。
 *   ⇒ 合成の字（部品を 組み合わせる字）の 参照先も ★番号が 動かないので 壊れない★。
 *     間引きで 字が 落ちる余地が ★構造として 無い★。
 *   ⇒ 消えるのは glyf だけ（4,250,140B の 91%）。cmap/hmtx は 残るが よく 圧縮される。
 *
 * ★使わない字を 空にするだけ★なので、
 *   ・pdf-lib へは ★subset:false★ のまま 渡す（壊れている 道を 通らない）
 *   ・作れなかった時は ★null を返す★＝呼ぶ側は 丸ごとの 字体に 戻す（黙って 落とさない）
 *
 * 【利用】window.FontSlim.slim(bytes, gids) ／ require('./font-slim.js').slim(...)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FontSlim = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function u8(b) { return (b instanceof Uint8Array) ? b : new Uint8Array(b); }
  function rU16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function rI16(b, o) { var v = rU16(b, o); return v > 0x7fff ? v - 0x10000 : v; }
  function rU32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function wU16(b, o, v) { b[o] = (v >>> 8) & 0xff; b[o + 1] = v & 0xff; }
  function wU32(b, o, v) { b[o] = (v >>> 24) & 0xff; b[o + 1] = (v >>> 16) & 0xff; b[o + 2] = (v >>> 8) & 0xff; b[o + 3] = v & 0xff; }

  /** sfnt の table 一覧を 読む */
  function readTables(b) {
    var tag = rU32(b, 0);
    /* 0x00010000 = TrueType ／ 'true' ／ 'ttcf'(集合体は 扱わない) ／ 'OTTO'(CFF＝glyfが無い) */
    if (tag !== 0x00010000 && tag !== 0x74727565) return null;
    var n = rU16(b, 4), t = {};
    for (var i = 0; i < n; i++) {
      var o = 12 + 16 * i;
      var nm = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
      t[nm] = { off: rU32(b, o + 8), len: rU32(b, o + 12) };
    }
    return t;
  }

  /** loca（形の 目次）を 読む */
  function readLoca(b, t, numGlyphs, longFmt) {
    var o = t.loca.off, a = new Array(numGlyphs + 1), i;
    if (longFmt) { for (i = 0; i <= numGlyphs; i++) a[i] = rU32(b, o + 4 * i); }
    else { for (i = 0; i <= numGlyphs; i++) a[i] = rU16(b, o + 2 * i) * 2; }
    return a;
  }

  /** ★合成の字が 使う 部品も 一緒に 残す★（部品を 落とすと ★その字だけ 空になる★） */
  function withParts(b, glyfOff, loca, keep, numGlyphs) {
    var out = {}, stack = [], g;
    for (g in keep) if (keep[g]) { out[g] = true; stack.push(Number(g)); }
    var mawari = 0;
    while (stack.length) {
      if (++mawari > 200000) break;                 /* ★回り続けない★（壊れた字体の 保険） */
      var gid = stack.pop();
      if (gid < 0 || gid >= numGlyphs) continue;
      var s = glyfOff + loca[gid], e = glyfOff + loca[gid + 1];
      if (e - s < 10) continue;                      /* 空の字 */
      if (rI16(b, s) >= 0) continue;                 /* 単体の字＝部品を 持たない */
      var p = s + 10;
      for (;;) {
        if (p + 4 > e) break;
        var flags = rU16(b, p), sub = rU16(b, p + 2);
        p += 4;
        if (!out[sub]) { out[sub] = true; stack.push(sub); }
        p += (flags & 0x0001) ? 4 : 2;               /* ARG_1_AND_2_ARE_WORDS */
        if (flags & 0x0008) p += 2;                  /* WE_HAVE_A_SCALE */
        else if (flags & 0x0040) p += 4;             /* X_AND_Y_SCALE */
        else if (flags & 0x0080) p += 8;             /* TWO_BY_TWO */
        if (!(flags & 0x0020)) break;                /* MORE_COMPONENTS */
      }
    }
    return out;
  }

  /* ── ★字→番号の 対応表(cmap)も 使う分だけに する★ ──
     ★番号は 元のまま★なので ここも 壊れようが 無い（引ける字が 減るだけ）。
     元の cmap は 202,987B ＝間引いた 字体の 45%。使う字だけなら 数KBで 済む。
     ★引けなくなった字は sanitize が 〓 に する★＝黙って 消えるのではなく 目で 見える。 */
  function buildCmap(pairs) {
    /* pairs = [[codePoint, gid], …]（昇順・BMPのみ format4 / それ以外は format12） */
    var bmp = [], full = [];
    pairs.forEach(function (p) { (p[0] <= 0xFFFF ? bmp : full).push(p); });
    bmp.sort(function (a, b) { return a[0] - b[0]; });
    full.sort(function (a, b) { return a[0] - b[0]; });
    /* format 4 … 1字1区間で 素直に 作る（区間を 詰めるより ★間違えない★方を 取る） */
    var segs = bmp.map(function (p) { return { s: p[0], e: p[0], g: p[1] }; });
    segs.push({ s: 0xFFFF, e: 0xFFFF, g: 0 });          /* 決まりの 終端 */
    var segN = segs.length;
    var f4len = 16 + segN * 8;
    var f4 = new Uint8Array(f4len);
    wU16(f4, 0, 4); wU16(f4, 2, f4len); wU16(f4, 4, 0);
    var sc = segN * 2;
    var p2 = 1; while (p2 * 2 <= segN) p2 *= 2;
    wU16(f4, 6, sc); wU16(f4, 8, p2 * 2);
    wU16(f4, 10, Math.round(Math.log(p2) / Math.LN2)); wU16(f4, 12, sc - p2 * 2);
    var i;
    for (i = 0; i < segN; i++) wU16(f4, 14 + i * 2, segs[i].e);
    wU16(f4, 14 + segN * 2, 0);                          /* reservedPad */
    for (i = 0; i < segN; i++) wU16(f4, 16 + segN * 2 + i * 2, segs[i].s);
    for (i = 0; i < segN; i++) {
      var d = (segs[i].g - segs[i].s) & 0xffff;          /* idDelta */
      wU16(f4, 16 + segN * 4 + i * 2, d);
    }
    for (i = 0; i < segN; i++) wU16(f4, 16 + segN * 6 + i * 2, 0);   /* idRangeOffset */
    var subs = [{ pid: 3, eid: 1, buf: f4 }];
    if (full.length) {
      var all = bmp.concat(full);
      var f12len = 16 + all.length * 12;
      var f12 = new Uint8Array(f12len);
      wU16(f12, 0, 12); wU16(f12, 2, 0);
      wU32(f12, 4, f12len); wU32(f12, 8, 0); wU32(f12, 12, all.length);
      for (i = 0; i < all.length; i++) {
        var o = 16 + i * 12;
        wU32(f12, o, all[i][0]); wU32(f12, o + 4, all[i][0]); wU32(f12, o + 8, all[i][1]);
      }
      subs.push({ pid: 3, eid: 10, buf: f12 });
    }
    var head = 4 + subs.length * 8, off = head, k;
    for (k = 0; k < subs.length; k++) { subs[k].off = off; off += subs[k].buf.length; }
    var out = new Uint8Array(off);
    wU16(out, 0, 0); wU16(out, 2, subs.length);
    for (k = 0; k < subs.length; k++) {
      wU16(out, 4 + k * 8, subs[k].pid); wU16(out, 6 + k * 8, subs[k].eid);
      wU32(out, 8 + k * 8, subs[k].off);
      out.set(subs[k].buf, subs[k].off);
    }
    return out;
  }

  var CHECK_TAGS = ['head'];

  /**
   * ★使う字だけ 形を 残した 字体を 作る★
   * @param {Uint8Array|ArrayBuffer} bytes 元の ttf
   * @param {number[]} gids 残す 字の 番号（0＝.notdef は 自動で 足す）
   * @returns {Uint8Array|null} 作れなければ null（呼ぶ側は 丸ごとに 戻す）
   */
  /**
   * @param {object} [opt] ★試験だけが 使う★ … { noParts:true } で
   *   ★合成の 部品を 足す 仕掛けを 外す★（見張りが 本当に それを 見ているかを 確かめる為）。
   *   ★本番の 道からは 渡さない★（呼び手は 3引数）。
   */
  function slim(bytes, gids, pairs, opt) {
    try {
      var b = u8(bytes);
      var t = readTables(b);
      if (!t || !t.glyf || !t.loca || !t.head || !t.maxp) return null;
      var numGlyphs = rU16(b, t.maxp.off + 4);
      var longFmt = rI16(b, t.head.off + 50) === 1;
      var loca = readLoca(b, t, numGlyphs, longFmt);
      /* 目次が 壊れていたら 触らない（黙って 変な字体を 作らない） */
      for (var q = 0; q < numGlyphs; q++) if (loca[q + 1] < loca[q]) return null;
      if (loca[numGlyphs] > t.glyf.len) return null;

      var keep = { 0: true };
      for (var i = 0; i < gids.length; i++) {
        var g = Number(gids[i]);
        if (g >= 0 && g < numGlyphs) keep[g] = true;
      }
      if (!(opt && opt.noParts)) keep = withParts(b, t.glyf.off, loca, keep, numGlyphs);

      /* ── 新しい glyf と loca を 組む（★番号は 動かさない★） ── */
      var newLoca = new Array(numGlyphs + 1);
      var size = 0, k;
      for (k = 0; k < numGlyphs; k++) {
        newLoca[k] = size;
        if (keep[k]) {
          var n = loca[k + 1] - loca[k];
          size += n + ((4 - (n % 4)) % 4);           /* 4の倍数に そろえる */
        }
      }
      newLoca[numGlyphs] = size;
      var glyf = new Uint8Array(size);
      for (k = 0; k < numGlyphs; k++) {
        if (!keep[k]) continue;
        var s2 = t.glyf.off + loca[k], e2 = t.glyf.off + loca[k + 1];
        if (e2 > b.length) return null;
        glyf.set(b.subarray(s2, e2), newLoca[k]);
      }
      var locaBuf = new Uint8Array(4 * (numGlyphs + 1));
      for (k = 0; k <= numGlyphs; k++) wU32(locaBuf, 4 * k, newLoca[k]);

      /* ── head を 写して indexToLocFormat を long(1) に ── */
      var head = b.slice(t.head.off, t.head.off + t.head.len);
      wU16(head, 50, 1);
      wU32(head, 8, 0);                              /* checkSumAdjustment は 後で 入れる */

      /* ★字→番号の 対応表も 使う分だけに★（渡された時だけ・番号は 元のまま） */
      var cmapNew = null;
      if (pairs && pairs.length) {
        try {
          var ok = pairs.filter(function (p) { return p && p[1] > 0 && p[1] < numGlyphs && keep[p[1]]; });
          if (ok.length) cmapNew = buildCmap(ok);
        } catch (e3) { cmapNew = null; }
      }

      /* ── 出す table を 決める（★形と 関係の 無い 飾りは 落とす★） ── */
      var SUTERU = { DSIG: 1, LTSH: 1, hdmx: 1, VDMX: 1, gasp: 1, 'cvt ': 0, fpgm: 0, prep: 0 };
      var tags = [];
      for (var nm in t) if (!SUTERU[nm]) tags.push(nm);
      tags.sort();

      var body = {};
      for (var x = 0; x < tags.length; x++) {
        var tg = tags[x];
        if (tg === 'glyf') body[tg] = glyf;
        else if (tg === 'loca') body[tg] = locaBuf;
        else if (tg === 'head') body[tg] = head;
        else if (tg === 'cmap' && cmapNew) body[tg] = cmapNew;
        else body[tg] = b.subarray(t[tg].off, t[tg].off + t[tg].len);
      }

      /* ── sfnt を 組み直す ── */
      var num = tags.length;
      var pow2 = 1; while (pow2 * 2 <= num) pow2 *= 2;
      var searchRange = pow2 * 16;
      var entrySelector = Math.round(Math.log(pow2) / Math.LN2);
      var rangeShift = num * 16 - searchRange;
      var headerLen = 12 + 16 * num;
      var total = headerLen, off = headerLen, offs = {};
      for (x = 0; x < tags.length; x++) {
        offs[tags[x]] = off;
        var L = body[tags[x]].length;
        off += L + ((4 - (L % 4)) % 4);
      }
      total = off;
      var out = new Uint8Array(total);
      wU32(out, 0, 0x00010000);
      wU16(out, 4, num); wU16(out, 6, searchRange);
      wU16(out, 8, entrySelector); wU16(out, 10, rangeShift);
      for (x = 0; x < tags.length; x++) {
        var o2 = 12 + 16 * x, tt = tags[x], buf = body[tt];
        out[o2] = tt.charCodeAt(0); out[o2 + 1] = tt.charCodeAt(1);
        out[o2 + 2] = tt.charCodeAt(2); out[o2 + 3] = tt.charCodeAt(3);
        out.set(buf, offs[tt]);
        wU32(out, o2 + 8, offs[tt]);
        wU32(out, o2 + 12, buf.length);
        wU32(out, o2 + 4, sum(out, offs[tt], buf.length));
      }
      /* head の checkSumAdjustment（読み手が 見る所が 在る） */
      var headOff = offs.head;
      wU32(out, headOff + 8, 0);
      var whole = sum(out, 0, out.length);
      wU32(out, headOff + 8, (0xB1B0AFBA - whole) >>> 0);
      /* head の table checksum も 入れ直す */
      for (x = 0; x < tags.length; x++) {
        if (tags[x] !== 'head') continue;
        wU32(out, 12 + 16 * x + 4, sum(out, headOff, body.head.length));
      }
      return out;
    } catch (e) {
      return null;                                   /* ★作れなければ 丸ごとに 戻す★ */
    }
  }

  function sum(b, off, len) {
    var s = 0, end = off + len - (len % 4);
    for (var i = off; i < end; i += 4) s = (s + rU32(b, i)) >>> 0;
    if (len % 4) {
      var last = 0;
      for (var j = 0; j < 4; j++) last = (last << 8) | (b[end + j] || 0);
      s = (s + (last >>> 0)) >>> 0;
    }
    return s >>> 0;
  }

  return { slim: slim, _readTables: readTables, CHECK_TAGS: CHECK_TAGS };
}));
