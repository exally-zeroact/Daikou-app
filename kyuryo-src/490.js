  // ★★選んだ 形の 本当の 区切りを 出す（言葉で 説明しない）★★
  function kikanDashiwake() {
    var m = ($('pMode') || {}).value || '';
    var show = function (id, on) {
      if ($(id)) $(id).style.display = on ? '' : 'none';
    };
    show('pShimeHiRow', m === 'tsuki1');
    show('pNarabeRow', m === 'narabe');
    show('pYoubiRow', m === 'shuu');
    var ms = $('pMsg');
    var y = shimeKataYomu();
    var kosu = false;
    if (y.kata) {
      // 月を またぐ 期が 在るか（何月分を 決めないと 区切れない）
      var t = PayrollPeriod.seiki(Object.assign({}, y.kata, { nazuke: 'shime' }));
      // ★28・29・30日締めは「締めた 日の 月の 分」だけ＝欄を 出さない★（司さん 10-19）
      kosu =
        !!t.ok &&
        (t.kata.kind === 'shuu' ||
          (t.kata.kind === 'tsuki' &&
            t.kata.hi[t.kata.hi.length - 1] !== 0 &&
            !t.kata.hi.some(function (h) {
              return h >= 28;
            })));
    }
    show('pNazukeRow', kosu);
    // ★★保存の 下の 説明（#pSetsumei）は 選んで いる 払い方の 確かめの 字★★ 2026-10-24
    //   司さん「締め日の下の区切りの説明書きいらん。月2回に変えても保存するボタンの下の説明書が変わらない。
    //   この説明書は選択したものに関してリアルタイムで確認のための説明書として変わるようにしろ」
    //   ⇒ #pMsg（払い方の 下）は 区切りの 一覧を やめ、保存 できない 訳（空く 月・記録が 読めない）だけ
    //   ⇒ #pSetsumei は 欄の 形から 1文（月3回の 時だけ 実物の「月別」シートの 一文も）＋切り替わりの 短い 期
    var se = $('pSetsumei');
    var setsu = function (ji, tsuika) {
      if (!se) return;
      se.textContent = ji;
      if (tsuika) {
        var b = document.createElement('div');
        b.style.marginTop = '4px';
        b.textContent = tsuika;
        se.appendChild(b);
      }
    };
    if (ms) ms.textContent = '';
    // ★設定を 読めない 時は 欄の 形（月3回 等）を 言い切らない★（テンプレの 上の 字と 揃える・対立役）
    if (SET && SET.yomenai) {
      setsu('給料の 設定を 読めませんでした（開き直してください）。');
      return;
    }
    if (y.dame) {
      setsu(y.dame);
      return;
    }
    var r = y.kata ? PayrollPeriod.seiki(y.kata) : { ok: true, kata: { kind: 'thirds' } };
    if (!r.ok) {
      setsu(r.riyuu);
      return;
    }
    var hs = haraiSetsumei(r.kata);
    var bun = hs ? hs.bun : '';
    if (r.kata.kind === 'thirds')
      bun +=
        '実物の「月別」シートの バ1〜10 / バ11〜20 / バ21〜31 が この3回で、バ21〜31 は' +
        '給料明細（21日〜末日）の 人数ぶんの 合計と 一致します。';
    // ★記録と 合わせた 区切り★（何日から 2026-10-19＝選んだ 日から この 形に した 時の 本当の 区切り・切り替わりの 短い 期も 出る）
    var zen = shimeMitoshi(y.kata);
    if (zen && zen.dame) {
      setsu(bun);
      if (ms) ms.textContent = zen.riyuu || '締めの 記録が 読めません';
      return;
    }
    // ★切り替わりの 月★＝記録 込みの 区切りが 今までの 区切りとも 欄の 形だけの 区切りとも 違う 月だけ 出す
    //   （短い 期を 黙らない・shime-rireki ⑦／今までと 同じ 月は 出さない・対立役）
    var ima = jstNow();
    var ym = { year: ima.getFullYear(), month: ima.getMonth() + 1 };
    var hh = shimeHi();
    if (hh) ym = { year: Number(hh.slice(0, 4)), month: Number(hh.slice(5, 7)) };
    var kawari = [];
    var retsu = shimeRetsuKata();
    var imamade = retsu ? PayrollPeriod.rirekiKata(retsu, RAW.shimeRireki) : null;
    if (imamade && imamade.dame) imamade = null;
    if (zen)
      [-1, 0, 1].forEach(function (z) {
        var t2 = PayrollPeriod.shift(ym, z);
        var kiri = function (kk) {
          var ps = PayrollPeriod.periodsOf(t2.year, t2.month, { kata: kk });
          if (ps.length === 1 && ps[0].aki) return '給料が 無くなります';
          if (ps.length > 6) return ps.length + '回'; // 毎日 等（並べると 長すぎる）
          return ps
            .map(function (p) {
              return p.rangeLabel;
            })
            .join(' ／ ');
        };
        var a = kiri(zen);
        if (a !== kiri(r.kata) && (!imamade || a !== kiri(imamade)))
          kawari.push(t2.month + '月分は ' + (a || '締める 給料 なし'));
      });
    setsu(bun, kawari.length ? '切り替わりで ' + kawari.join('、') + ' に なります。' : '');
    // ★この 変え方で 空く 月＝保存 できない★（保存の 時は 倉庫から 読み直して もう一度 確かめる）
    var akiMae = shimeAkiNo(shimeRetsuKata(), RAW.shimeRireki) || [];
    var akiF = (zen ? PayrollPeriod.akiTsuki(zen) : []).filter(function (x) {
      return akiMae.indexOf(x) < 0;
    });
    if (ms && akiF.length) ms.textContent = shimeAkiBun(akiF) + 'この ままでは 保存できません。';
  }
  (function wireKikan() {
    ['pMode', 'pShimeHi', 'pNarabe', 'pYoubi', 'pNazuke'].forEach(function (id) {
      var n = $(id);
      if (!n) return;
      n.addEventListener('change', kikanDashiwake);
      n.addEventListener('input', kikanDashiwake);
      // ★欄を 触ったか★（触って いない 時は 日付が 在っても 記録を 書かない・対立役 直4）
      n.addEventListener('change', function () {
        SHIME_SAWATTA = true;
      });
      n.addEventListener('input', function () {
        SHIME_SAWATTA = true;
      });
    });
    if ($('pHi'))
      $('pHi').addEventListener('change', function () {
        hiHiGawari();
        SHIME_HI = $('pHi').value || '';
        hiOboeKaku('shime', 'kaisha', SHIME_HI);
        shimeKataIreru();
        renderShimeRireki();
      });
    if ($('pRirekiBtn'))
      $('pRirekiBtn').onclick = function () {
        SHIME_RIREKI_HIRAKU = !SHIME_RIREKI_HIRAKU;
        renderShimeRireki();
      };
  })();
