  //   司さん「全パターンをPDFで見て選べるようにして 選ばせ方や見せ方は代行請求書アプリの見せ方を真似て」
  //   見本は 作り物で なく 今の 月の 本当の 記録（代行請求書と 同じ）で、その 払い方の 区切りの 紙を 組む。
  // ★★払い方の 種類ごとに 1つ★★ 2026-10-24（司さん「月1回のテンプレは給料設定があるんやから1個でええやろ。
  //   月2回、3回、週一も一緒や。同じものを並べてどうするんのど」「今の給料設定は何日締めです。変えたい時は給料設定から変更して下さい」）
  //   前は 12通り（締め日違い・何月分違いの 同じ 払い方が 並んだ）＋押すと 給料の 設定の 欄に 入れた
  //   ⇒ 種類（月1回・月2回・月3回・週1回・毎日）ごとに 1枚。今の 設定と 同じ 種類は 今の 設定の 締め日で、他は 既定の 締め日で 組む
  //   ⇒ 押すと その 払い方を 給料の 設定の 欄に 入れる（10-24 司さん「テンプレから選択して変えれないのはなぜか」・書くのは 給料の 設定の 保存 1つ）
  var TPL_KITEI = [
    { shurui: 'tsuki1', raw: { kind: 'tsuki', hi: [0] } },
    { shurui: 'tsuki2', raw: { kind: 'tsuki', hi: [15, 0] } },
    { shurui: 'tsuki3', raw: { kind: 'tsuki', hi: [10, 20, 0] } },
    { shurui: 'shuu', raw: { kind: 'shuu', youbi: 0, nazuke: 'shime' } },
    { shurui: 'hi', raw: { kind: 'hi' } },
  ];
  // 形（seiki を 通した 物）→ 種類
  function tplShurui(k) {
    if (!k) return '';
    if (k.kind === 'thirds') return 'tsuki3';
    if (k.kind === 'tsuki') return 'tsuki' + k.hi.length;
    return k.kind;
  }
  // ★今の 給料の 設定の 形（今日に 効く 形）★ 読めない 時は dame（既定を 黙って 出さない）
  function tplImaKata() {
    if (!SET_YONDA) return { dame: '給料の 設定を 読み込み中です' };
    var y = PayrollPeriod.yomu(SET);
    if (!y || !y.ok) return { dame: '給料の 設定を 読めませんでした（開き直してください）' };
    // ★記録が 読めない・壊れて いる 時に 列の 形へ 黙って 落ちない★（対立役 S1：shimeNoHiKata は null で 返す＝|| で 列の 形が 出た）
    var rk = PayrollPeriod.rirekiKata(y.kata, RAW.shimeRireki);
    if (!rk || rk.dame)
      return {
        dame: '給料の 設定（締めを 変えた 記録）を 読めませんでした（開き直してください）',
      };
    var k = PayrollPeriod.kataNoHi(rk, kyouJst());
    var t = k.kind === 'thirds' ? { ok: true, kata: k } : PayrollPeriod.seiki(k);
    if (!t.ok || !haraiNa(t.kata))
      return { dame: '給料の 設定を 読めませんでした（開き直してください）' };
    return { kata: t.kata };
  }
  // 見本の 並び（種類ごとに 1つ）。今の 形が 既定に 無い 種類（月4回 等）なら その 種類を 足す
  function tplNarabi() {
    var ima = tplImaKata().kata || null;
    var imaS = tplShurui(ima);
    var imaRaw = ima && ima.kind === 'thirds' ? { kind: 'tsuki', hi: [10, 20, 0] } : ima;
    var l = TPL_KITEI.map(function (t) {
      return t.shurui === imaS ? { shurui: t.shurui, raw: imaRaw } : t;
    });
    if (
      ima &&
      !TPL_KITEI.some(function (t) {
        return t.shurui === imaS;
      })
    )
      l.push({ shurui: imaS, raw: imaRaw });
    return l.map(function (t) {
      var r = PayrollPeriod.seiki(t.raw);
      var hs = r.ok ? haraiSetsumei(r.kata) : null;
      return {
        shurui: t.shurui,
        raw: t.raw,
        na: hs ? hs.na : '',
        desc: hs ? hs.bun.slice(hs.bun.indexOf('：') + 1) : '',
      };
    });
  }
  // 見本の 形（raw）
  function tplKata(t) {
    return t.raw;
  }
  function tplOnaji(a, b) {
    if (!a || !b || a.kind !== b.kind) return false;
    if (a.kind === 'tsuki') return a.hi.join(',') === b.hi.join(',') && a.nazuke === b.nazuke;
    if (a.kind === 'shuu') return a.youbi === b.youbi && a.nazuke === b.nazuke;
    return true;
  }
  // ★見本の 材料★ 前の 月の 頭（の 7日 前）〜 次の 月の 末 を 1回 読む（明細と 同じ 表・同じ 絞り方）
  //   明細の 材料（CTX）は 今 開いて いる 区切りの 範囲 だけ＝それで 月1回 等を 組むと 時間と 額が 足りない（対立役 止2）
  function tplYmd(d) {
    return (
      d.getFullYear() +
      '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) +
      '-' +
      ('0' + d.getDate()).slice(-2)
    );
  }
  // ★読む 範囲＝見本の 候補（種類ごとの 1枚・2026-10-24 までは 12通り）（前の 月・今の 月の 区切り）の 一番 早い 始まり 〜 一番 遅い 終わり★
  //   決め打ち（前の 月の 頭の 7日前）だと 20日締め（締めた 日の 月の 分）の 前の 月の 区切り（2つ 前の 月の 21日〜）を 覆わず
  //   見本の 頭の 3〜4日が 抜けた（対立役 止A）
  function tplHani(ym) {
    var kara = null;
    var made = null;
    tplNarabi().forEach(function (t) {
      var r = PayrollPeriod.seiki(tplKata(t));
      if (!r.ok) return;
      [-1, 0].forEach(function (z) {
        var t2 = PayrollPeriod.shift(ym, z);
        (PayrollPeriod.periodsOf(t2.year, t2.month, { kata: r.kata }) || []).forEach(function (p) {
          if (!kara || p.start < kara) kara = p.start;
          if (!made || p.end > made) made = p.end;
        });
      });
    });
    return { kara: kara, made: made };
  }
  var TPL_ZAIRYO = null; // { key, pr }
  function tplZairyo() {
    var hani = tplHani(YM);
    var kara = hani.kara;
    var made = hani.made;
    var key = kara + '|' + made + '|' + LP_NO;
    if (TPL_ZAIRYO && TPL_ZAIRYO.key === key) return TPL_ZAIRYO.pr;
    var st = DKSession.newLoadState();
    var yomu = function (path) {
      return DKSession.softList(SESS, kaishaDake(path), st);
    };
    var toD = new Date(+made.slice(0, 4), +made.slice(5, 7) - 1, +made.slice(8, 10) + 1);
    var pr = Promise.all([
      yomu(
        'dk_shifts?select=shift_id,device_id,started_at,ended_at,elapsed_sec,fare_total_yen,trip_count,actual_total_m,total_distance_m,excluded' +
          '&started_at=gte.' +
          encodeURIComponent(kara + 'T00:00:00+09:00') +
          '&started_at=lt.' +
          encodeURIComponent(tplYmd(toD) + 'T00:00:00+09:00') +
          '&order=started_at.asc&limit=5000'
      ),
      yomu('dk_shift_edits?select=*&limit=5000'),
      yomu(
        'dk_work_hours?select=*&work_date=gte.' + kara + '&work_date=lte.' + made + '&limit=5000'
      ),
      yomu(
        'dk_manual_days?select=*&work_date=gte.' + kara + '&work_date=lte.' + made + '&limit=5000'
      ),
      yomu(
        'dk_pay_adjustments?select=*&work_date=gte.' +
          kara +
          '&work_date=lte.' +
          made +
          '&order=work_date.asc,adj_id.asc&limit=5000'
      ),
    ]).then(function (res) {
      // ★1つでも 読めなければ 見本を 出さない★（足りない 材料で 額を 出さない）
      if (DKSession.loadFailed(st)) return { dame: true };
      var ctx = PayrollDaily.buildCtx(
        Object.assign({}, RAW, {
          shifts: res[0] || [],
          edits: res[1] || [],
          workHours: res[2] || [],
          manualDays: res[3] || [],
          adjustments: res[4] || [],
          yakuRireki: yakuRirekiNoIma(),
        })
      );
      return { ctx: ctx };
    });
    TPL_ZAIRYO = { key: key, pr: pr };
    return pr;
  }
  // 見本の 紙に 載せる 名前（作り物・本当の 人の 名前は 出さない）
  var TPL_MIHON_NA = '見本 太郎';
  // 見本の 紙（前の 月・今の 月の 区切りで 働いた 日が 一番 多い 区切り・その 区切りで 時間が 一番 多い 人）
  function tplMihon(t, ctx) {
    var CTX = ctx; // 見本の 材料（明細の CTX とは 別）
    var r = PayrollPeriod.seiki(tplKata(t));
    if (!r.ok || !CTX || !YM) return null;
    // 前の 月と 今の 月の 区切りから 選ぶ（始まった 日の 月の 分 は 今の 月の 分が まだ 始まって いない 事が ある）
    var ps = [];
    [-1, 0].forEach(function (z) {
      var t2 = PayrollPeriod.shift(YM, z);
      ps = ps.concat(PayrollPeriod.periodsOf(t2.year, t2.month, { kata: r.kata }) || []);
    });
    var hd = (CTX && CTX.hoursByDate) || {};
    var p = null;
    var best = -1;
    ps.forEach(function (q) {
      var n = (q.dates || []).filter(function (d) {
        return hd[d] && Object.keys(hd[d]).length;
      }).length;
      if (n > best) {
        best = n;
        p = q;
      }
    });
    if (!p || best <= 0) return null;
    var rp = PayrollDaily.report(p.dates, CTX);
    var es = (rp && rp.employees) || [];
    if (!es.length) return null;
    var e0 = es.slice().sort(function (a, b) {
      return (b.totalHours || 0) - (a.totalHours || 0);
    })[0];
    // ★見本に 本当の 名前を 載せない★ 2026-10-24（司さん「テンプレに実名を勝手に使うな」）
    //   手当・控除の 名目も 自由な 字（人の 名前・いきさつが 入り得る）＝「手当」「控除」に 替える（額は そのまま・対立役 S2）
    var e = Object.assign({}, e0, {
      name: TPL_MIHON_NA,
      adj: (e0.adj || []).map(function (a) {
        return Object.assign({}, a, { label: a.kind === 'koujo' ? '控除' : '手当' });
      }),
    });
    var mae = PERIOD;
    var sheets;
    try {
      PERIOD = p; // 紙の 見出し（何月分・期間）は その 区切り
      sheets = _empSheets(e, slipCars(rp.cars, e.employee_id));
    } finally {
      PERIOD = mae;
    }
    // ★見本の 印★（本物の 明細と 取り違えない＝画面にも PDF にも 載る・対立役 止C）
    //   紙の 下の 余白（18px）に 13px（PDF で 9pt 以上）の 赤い 字（上の 余白だと「給料明細」に くっついた）
    sheets.forEach(function (x) {
      var m = document.createElement('div');
      m.className = 'tpl-mihon-ji';
      m.style.cssText =
        'position:absolute;left:0;right:0;bottom:2px;text-align:center;font-size:13px;line-height:15px;' +
        'font-weight:700;color:#c0392b;white-space:nowrap;';
      m.textContent = '見本（払い方を 選ぶ ための 紙です・本物の 明細では ありません）';
      x.el.style.position = x.el.style.position || 'relative';
      x.el.insertBefore(m, x.el.firstChild);
    });
    return { sheets: sheets, p: p, e: e };
  }
  function renderTpl() {
    var g = $('tplGrid');
    if (!g) return;
    // ★★上の 字＝今の 給料の 設定★★ 2026-10-24（司さん「給料設定を読み込んで今の給料設定は何日締めです。
    //   変えたい時は給料設定から変更して下さい。みたいに載せろ」）。読めない 時は 既定を 黙って 出さない
    var imaY = tplImaKata();
    var ue = $('tplIma');
    if (ue) {
      var imaNa = imaY.kata ? haraiNa(imaY.kata) : '';
      ue.innerHTML =
        (imaY.kata
          ? '今の 給料の 設定は <b>' + esc(imaNa) + '</b> です。'
          : '<span class="rolewarn">' + esc(imaY.dame) + '</span>') +
        // ★テンプレを 押して 選べる★ 2026-10-24（司さん「テンプレから選択して変えれないのはなぜか」）
        '下の テンプレを 押すと その 払い方が <button type="button" class="linkbtn" data-tpl-settei="1" style="padding: 0 2px">給料の 設定</button> に 入ります（「保存する」を 押すまで 変わりません）。';
      var sb = ue.querySelector('[data-tpl-settei]');
      if (sb)
        sb.onclick = function () {
          tplSetteiHe();
        };
    }
    var ima = imaY.kata || null;
    var narabi = (TPL_NARABI = tplNarabi());
    g.innerHTML = narabi
      .map(function (t, i) {
        var r = PayrollPeriod.seiki(tplKata(t));
        var on = !!ima && r.ok && tplOnaji(ima, r.kata);
        return (
          '<div class="tpl-card' +
          (on ? ' on' : '') +
          '" data-shurui="' +
          esc(t.shurui) +
          '" data-tpl="' +
          i +
          '"><div class="tpl-badge">✓</div><div class="tpl-thumb" data-tpl-thumb="' +
          i +
          '"><span class="tpl-thumb-msg">見本を 作っています…</span></div><div class="tpl-meta"><div class="tpl-name">' +
          esc(t.na) +
          '</div><div class="tpl-desc">' +
          esc(t.desc) +
          (on ? '（今の 払い方）' : '') +
          '</div><button class="tpl-pdf" type="button" data-tpl-pdf="' +
          i +
          '">PDFで 見る</button></div></div>'
        );
      })
      .join('');
    var mihon = {};
    var thumbs = g.querySelectorAll('[data-tpl-thumb]');
    var dasuMsg = function (ji) {
      Array.prototype.forEach.call(thumbs, function (box) {
        box.innerHTML = '<span class="tpl-thumb-msg">' + ji + '</span>';
      });
    };
    // ★明細が 止まる 時は 見本も 出さない★（明細と 同じ 門・対立役 止2 の ついで）
    var tome =
      KEISAN_NG || !CTX
        ? '明細を 計算 できて いない ので<br />見本は 出しません'
        : LP_YOMICHU
          ? '読み込み中です'
          : DKSession.loadFailed(LOAD) || kyuDameBun(CTX)
            ? '明細が 止まって いる ので<br />見本は 出しません'
            : '';
    var hyouji = Number(g.getAttribute('data-gen') || 0) + 1;
    g.setAttribute('data-gen', String(hyouji));
    var oku = function (ctx) {
      // ★見本の 材料にも 明細と 同じ 止め★（今の 区切りの 外に 読めない 売上の 直し 等が 在る 時・対立役 止B）
      var tomeZ = kyuDameBunHoka(ctx);
      if (tomeZ)
        return dasuMsg('見本の 期間に 計算 できない 所が ある ので<br />見本は 出しません');
      Array.prototype.forEach.call(thumbs, function (box) {
        var i = Number(box.getAttribute('data-tpl-thumb'));
        var m = null;
        try {
          m = tplMihon(narabi[i], ctx);
        } catch (_) {
          m = null;
        }
        mihon[i] = m;
        if (!m || !m.sheets.length) {
          box.innerHTML =
            '<span class="tpl-thumb-msg">この 月に 時数が 入ると<br />ここに 実際の 紙が 出ます</span>';
          return;
        }
        // ★札には 写しを 縮めて 置く★（元の 紙は PDF へ そのまま 渡す＝縮めた 紙を PDF に 描かない・札から 紙を 抜かない・対立役 止1）
        var el = m.sheets[0].el.cloneNode(true);
        var wh = kamiWH(el);
        var bw = box.clientWidth || 150;
        var bh = box.clientHeight || bw * 1.414;
        var sc = Math.min(bw / wh.w, bh / wh.h);
        el.style.position = 'absolute';
        el.style.left = Math.round((bw - wh.w * sc) / 2) + 'px';
        el.style.top = Math.round((bh - wh.h * sc) / 2) + 'px';
        el.style.width = wh.w + 'px';
        el.style.transformOrigin = 'top left';
        el.style.transform = 'scale(' + sc + ')';
        el.style.boxShadow = '0 0 0 1px #e3eaf2';
        box.innerHTML = '';
        box.appendChild(el);
      });
    };
    if (tome) dasuMsg(tome);
    else
      tplZairyo()
        .then(function (z) {
          // 読み終える 前に 描き直した・別の タブへ 行った ⇒ 置かない
          if (TAB !== 'tpl' || g.getAttribute('data-gen') !== String(hyouji)) return;
          if (!z || z.dame) return dasuMsg('記録を 読めなかった ので<br />見本は 出しません');
          oku(z.ctx);
        })
        .catch(function () {
          if (g.getAttribute('data-gen') === String(hyouji))
            dasuMsg('記録を 読めなかった ので<br />見本は 出しません');
        });
    // ★札を 押す＝その 払い方を 給料の 設定の 欄に 入れる★（PDF の ボタンは 選ばない）
    Array.prototype.forEach.call(g.querySelectorAll('.tpl-card[data-tpl]'), function (c) {
      c.onclick = function () {
        tplErabu(narabi[Number(c.getAttribute('data-tpl'))]);
      };
    });
    Array.prototype.forEach.call(g.querySelectorAll('[data-tpl-pdf]'), function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation(); // ★PDF を 見るだけ＝選ばない★
        var i = Number(b.getAttribute('data-tpl-pdf'));
        var m = mihon[i];
        if (!m || !m.sheets.length)
          return showErr('この 月に 時数が 無いので 見本の 紙を 作れません。');
        showMsg('PDFを作っています…（見本）');
        var kai2 = window.PdfOkuru ? PdfOkuru.kesu() : null;
        loadPdfLibs()
          .then(function (E) {
            return _dasuMachi(E, m.sheets, '給料明細_見本_' + narabi[i].na, kai2);
          })
          .then(function (x) {
            showMsg(meisaiBun(x));
          })
          .catch(function () {
            showMsg('');
            showErr('見本の PDF を 作れませんでした。もう一度 押してください。');
          });
      };
    });
  }
  // ★給料の 設定へ 移る★（書く 道は 給料の 設定の 保存 1つ・2026-10-24）
  // eslint-disable-next-line no-unused-vars -- 2026-11-07 html から 出した 前からの 行（中身は 変えない・件2 で 直す）
  var TPL_NARABI = [];
  // ★選ぶ＝給料の 設定の 払い方の 欄に 入れて 開く★ 2026-10-24（司さん「テンプレから選択して変えれないのはなぜか」）
  //   倉庫へは 書かない（保存は 給料の 設定の「保存する」＝何日からも そこで 決める）
  function tplErabu(t) {
    if (!t || !t.raw) return;
    // ★設定を 読めない 時は 入れない★（保存も 止まる＝「入れました」が 嘘に なる・対立役 N4）
    var imaY = tplImaKata();
    if (imaY.dame) return showErr(imaY.dame);
    tplSetteiHe();
    var raw = t.raw;
    // 月3回（10日・20日・末日）は 欄の「月3回」で 出す（締め日を 並べる で 出さない）
    var sanKai = raw.kind === 'tsuki' && Array.isArray(raw.hi) && raw.hi.join(',') === '10,20,0';
    shimeRanNiIreru(sanKai ? null : raw, sanKai ? 'thirds' : 'shime');
    // ★欄を 触った 印★（手で 選んだ 時と 同じ＝保存で 何日からの 記録を 書く・何日からを 変えても 欄を 戻さない）
    SHIME_SAWATTA = true;
    kikanDashiwake();
    showMsg(
      'テンプレの「' +
        t.na +
        '」を 入れました。「何日から」を 決めて「保存する」を 押すと 変わります。'
    );
  }
  function tplSetteiHe() {
    TAB = 'set';
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) {
      x.className = 'tab' + (x.getAttribute('data-tab') === 'set' ? ' on' : '');
    });
    render();
    if ($('pMode') && $('pMode').scrollIntoView) $('pMode').scrollIntoView({ block: 'center' });
  }

  function printAll(dake) {
    if (yomikomichuTomeru()) return;
    var kiAll = PERIOD;
    if ((!dake || !dake.length) && HITO) dake = [HITO]; // ★名前で 選んだ人だけ（10-03）★
    // ★数えるのは 人の数★（画面の枚数ではない＝紙は人ごとに組む）
    var zenin = REP && REP.employees ? REP.employees : [];
    var boxes =
      dake && dake.length
        ? zenin.filter(function (e) {
            return dake.indexOf(String(e.employee_id)) >= 0;
          })
        : zenin;
    // 売上の 直しが 読めない 業務が 在れば 明細の PDF を 作らない（画面の 明細と 同じ 門）2026-10-14
    if (kyuDameBun(CTX)) return showErr(kyuDameBun(CTX));
    // ★「選んだ人」で 呼ばれたのに 選びが 空＝★全員には しない★（10-03 対立役：前は 全員ぶん 出た）
    if (Array.isArray(dake) && !dake.length) {
      showErr('選んだ人が いません。明細の チェックで 選んでください。');
      return;
    }
    if (!boxes.length) {
      showErr(dake && dake.length ? '選んだ人の 明細が ありません。' : '明細がありません。');
      return;
    }
    // ★★読めなかった 物が 在る 時は 明細の PDF を 作らない★★ 2026-10-07（対立役：手当・控除が 読めないと
    //   控除の 無い 明細が 出た＝司さん「計算できなければ 止めて 警告」）
    if (DKSession.loadFailed(LOAD)) {
      yomiNaoshiObi(); // ★帯を 出す★（押す 所が 無い 文で 止めない・対立役 10-07）
      showErr(
        '読めなかった 物が あるので 明細の PDF は 作りません。上の「もう一度読む」を 押してください。'
      );
      return;
    }
    var ym = String(YM.year) + '-' + String(YM.month).padStart(2, '0');
    showMsg('PDFを作っています…（' + boxes.length + '人ぶん）');
    // ★PDF の 道具が 読めず 印刷の 保険へ 落ちる 時も はみ出す 人が 居れば 止める★（対立役 10-07 4回目：
    //   門を 道具の 後へ 移したら 道具が 読めない 時に 門を 通らず 切れた 明細が 印刷に 出た）
    var dougu = false;
    var shippai = function (err) {
      pdfAtoshimatsu(boxes, dougu, err, kiAll);
    };
    var kai3 = window.PdfOkuru ? PdfOkuru.kesu() : null;
    loadPdfLibs()
      .then(function (E) {
        dougu = true;
        // ★手当・控除が 紙に 入りきらない 人が 居れば 作らない★ 2026-10-07（差引支給が 紙の 外に 出る）
        //   ★PDF の 字体を 読んだ 後で 測る★（前は 控えの 字体で 測り「入るのに 止める」事が あった・対立役 B）
        //   止める 時は 投げない（投げると 印刷の 保険へ 落ちる）＝文を 出して 抜ける
        if (hamiTomeru(boxes, kiAll)) return null;
        var mai = [];
        boxes.forEach(function (e2) {
          mai = mai.concat(_empSheets(e2, slipCars(REP.cars, e2.employee_id)));
        });
        return _dasuMachi(E, mai, '給料明細_' + ym, kai3);
      })
      .then(function (x) {
        showMsg(meisaiBun(x));
      })
      .catch(shippai);
  }
  window.printAll = printAll;
  // ★明細の PDF を 出した 後の 字★ 出せない 字（見本と 同じ 字・2026-10-31）＋iPhone・iPad の 共有の 字（how ごと）
  function meisaiBun(x) {
    if (!x) return '';
    var miss = window.KamiEgaku ? window.KamiEgaku.missingBun(x.missing) : '';
    var w = window.PdfOkuru ? PdfOkuru.bun(x.how, miss) : null;
    return w !== null ? w : miss;
  }

  // ★見張りが 実際に紙を組んで 数を測る為の入口★ 2026-08-26
  //   ＝★ソースを読むだけの見張りにしない★（読むだけの見張りは 何度も嘘をついた）。
  //   組むだけ・返すだけ＝画面も倉庫も 1文字も動かさない。
  window.__paper = {
    build: function (ei, from, to, no, n) {
      var e = REP.employees[ei];
      return _buildPaperSheet(
        e,
        showCarSalesNow(),
        slipCars(REP.cars, e.employee_id),
        from,
        to,
        no,
        n
      );
    },
    // ★1人ぶんの 紙を 全部（日と 車の 両方で 分けた 後）★ 2026-10-07（見張りが 高さと 売上n を 数える）
    sheets: function (ei) {
      var e = REP.employees[ei];
      return _empSheets(e, slipCars(REP.cars, e.employee_id)).map(function (x) {
        return x.el;
      });
    },
    // テンプレの 見本を 読む 範囲（見張りが 12通りの 区切りを 全部 覆うかを 数える）
    tplHani: function (y, m) {
      return { hani: tplHani({ year: y, month: m }), n: tplNarabi().length };
    },
    tplKiri: function (y, m) {
      var out = [];
      tplNarabi().forEach(function (t) {
        var r = PayrollPeriod.seiki(tplKata(t));
        if (!r.ok) return;
        [-1, 0].forEach(function (z) {
          var t2 = PayrollPeriod.shift({ year: y, month: m }, z);
          (PayrollPeriod.periodsOf(t2.year, t2.month, { kata: r.kata }) || []).forEach(
            function (p) {
              out.push({ k: t.shurui, start: p.start, end: p.end });
            }
          );
        });
      });
      return out;
    },
    maisu: function (ei) {
      var e = REP.employees[ei];
      return _maisu(e, showCarSalesNow(), slipCars(REP.cars, e.employee_id));
    },
    ninzu: function () {
      return REP && REP.employees ? REP.employees.length : 0;
    },
    hi: function (ei) {
      return REP.employees[ei].cells.length;
    },
    emp: function (ei) {
      return REP.employees[ei];
    },
    cars: function () {
      return REP.cars;
    },
    // ★紙に 出す 車（明細に出す 印で 絞った 後）★ 2026-09-06
    //   ★見張りが「選んだ 車の 行が 出るか」を 数える 為★
    slipCars: function (ei) {
      var e = REP.employees[ei || 0];
      return slipCars(REP.cars, e.employee_id);
    },
    timeoutMs: function () {
      return PDF_TIMEOUT_MS;
    },
  };

  // ★どの車を 給料明細に出すか★ 2026-08-25（司さん「個別で見せる見せないも選べたら最高」）
  //   ・持ち場は ★車の棚（dk_device_labels.show_in_slip）★＝新しい棚を作らない
  //   ・★空（まだ決めていない）＝出す★＝今までと同じ見た目
  //   ・決めるのは 社長・会社ごと（「車の名前と並び」の表で1台ずつ）
  //   ・判定は ★ここ1か所★（設定の画面と 明細で 食い違わない）
  function carShowsInSlip(deviceId) {
    var hit = null;
    (RAW.labels || []).forEach(function (l) {
      if (l && l.device_id === deviceId) hit = l;
    });
    return !(hit && hit.show_in_slip === false);
  }

  // ★その人だけの車の指定★ 2026-08-25
  //   司さん「個人個人で給料明細に載せるかも選びたいんや
  //           山田太郎は車1、山田花子は車2と3とかカスタムしたい」
  //   ・持ち場は ★人の棚（dk_employees.slip_cars）★＝新しい棚を作らない
  //   ・★空（打っていない）＝会社の決まりどおり★＝今までと同じ見た目
  //   ・入っていれば ★その人は その車だけ★
  function empSlipCars(employeeId) {
    var hit = null;
    (RAW.employees || []).forEach(function (x) {
      if (x && x.employee_id === employeeId) hit = x;
    });
    var v = hit && hit.slip_cars;
    if (!v) return null;
    try {
      if (typeof v === 'string') v = JSON.parse(v); // 倉庫から文字で返る事がある
    } catch (_) {
      return null;
    }
    return v && v.length ? v : null;
  }

  // ★明細に出す車だけを 並び順のまま 取り出す★
  //   元の並びの何番目か（i）も一緒に持つ＝売上の数字を取り違えない。
  //   出す物だけで「売上1・売上2…」と番号を振り直す（間が抜けない）。
  //   ★決める順番は ここ1か所★
  //     ①その人の指定が在れば その車だけ
  //     ②無ければ 会社の「明細に出す」（車ごと）
  function slipCars(cars, employeeId) {
    var mine = empSlipCars(employeeId);
    var out = [];
    (cars || []).forEach(function (car, i) {
      var ok = mine ? mine.indexOf(car.device_id) >= 0 : carShowsInSlip(car.device_id);
      if (ok) out.push({ car: car, i: i });
    });
    return out;
  }

