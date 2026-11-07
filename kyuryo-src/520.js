  // ★★月が 空く 締めの 変え方は 書かない★★ 2026-10-19（docs/nannichi-kara-shime.md「月が 空く 件」）
  //   給料は 毎月 払う 決まり（労基法24条）。★今より 空く 月が 増える 時だけ★ 止める（月の 組で 比べる・対立役 直4）
  //   比べる 元は ★書く 直前に 倉庫から 読み直した 記録★（古い タブの 控えで 判じない）
  function shimeAkiNo(retsu, rows) {
    if (!retsu) return null;
    var k = PayrollPeriod.rirekiKata(retsu, rows);
    if (!k || k.dame) return null;
    return PayrollPeriod.akiTsuki(k);
  }
  function shimeAkiFueta(retsuMae, rowsMae, retsuAto, rowsAto) {
    var ato = shimeAkiNo(retsuAto, rowsAto);
    if (!ato) return [];
    var mae = shimeAkiNo(retsuMae, rowsMae) || [];
    return ato.filter(function (x) {
      return mae.indexOf(x) < 0;
    });
  }
  function shimeAkiBun(l) {
    return (
      'この 変え方だと ' +
      l
        .map(function (x) {
          return Number(x.slice(0, 4)) + '年' + Number(x.slice(5, 7)) + '月分';
        })
        .join('・') +
      'の 給料が 無くなります（給料は 毎月 払う 決まり）。'
    );
  }
  function shimeRowsYomu() {
    var y = { tried: 0, failed: 0 };
    return DKSession.softList(
      SESS,
      kaishaDake('dk_shime_rireki?select=*&order=from_date.asc&limit=100000'),
      y
    ).then(function (rows) {
      if (y.failed > 0)
        throw new Error(
          '締めの 変えた 記録を 読み直せませんでした（通信）。保存していません。もう一度 押してください。'
        );
      return rows || [];
    });
  }
  function shimeHiTasu(hi, k) {
    var d = new Date(
      Number(hi.slice(0, 4)),
      Number(hi.slice(5, 7)) - 1,
      Number(hi.slice(8, 10)) + k
    );
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }
  //   保存の 前の 門：返り＝'' 通す／字＝止める 訳
  //   hi＝何日から（空＝最初から＝列）・kaku＝記録を 書く 保存か・rawKata＝欄の 形
  function shimeAkiMon(hi, kaku, rawKata) {
    if (hi && !kaku) return Promise.resolve('');
    var mine = rawKata || { kind: 'tsuki', hi: [10, 20, 0] };
    var t = PayrollPeriod.seiki(mine);
    if (!t.ok) return Promise.resolve('');
    var retsu = shimeRetsuKata();
    return shimeRowsYomu().then(function (rows) {
      if (!hi) {
        var f0 = shimeAkiFueta(retsu, rows, t.kata, rows);
        return f0.length
          ? shimeAkiBun(f0) +
              '最初からの 払い方か 何月分の 呼び方を 選び直してください。設定も 保存していません。'
          : '';
      }
      var ato = function (d) {
        return rows
          .filter(function (x) {
            return x && String(x.from_date).slice(0, 10) !== d;
          })
          .concat([{ from_date: d, value: mine }]);
      };
      // 前の 側（今の 記録）は 候補ごとに 変わらない＝1回だけ 数える（対立役 本番前3 直A）
      var akiIma = shimeAkiNo(retsu, rows) || [];
      var fuetaKa = function (d) {
        var aa = shimeAkiNo(retsu, ato(d));
        return (aa || []).filter(function (x) {
          return akiIma.indexOf(x) < 0;
        });
      };
      var f = fuetaKa(hi);
      if (!f.length) return '';
      // ★空かない 一番 近い 日を 出す★（「選び直して」だけだと 当てずっぽう・対立役 直2）
      var chika = '';
      //   ★探すのは 0.6秒 まで★（1回の 比べは 記録の 数の 2乗で 重い＝記録 20件で 1回 約0.1秒・全部 試すと 十数秒 固まる・対立役 本番前2 直A）
      var owari = Date.now() + 600;
      for (var k = 1; k <= 62 && !chika && Date.now() < owari; k++) {
        [k, -k].forEach(function (z) {
          if (chika || Date.now() >= owari) return;
          var d = shimeHiTasu(hi, z);
          if (!fuetaKa(d).length) chika = d;
        });
      }
      return (
        shimeAkiBun(f) +
        (chika
          ? '変える 日を ' +
            Number(chika.slice(5, 7)) +
            '/' +
            Number(chika.slice(8, 10)) +
            ' に すると 空きません。'
          : '') +
        '変える 日か 何月分の 呼び方を 選び直してください。設定も 保存していません。'
      );
    });
  }
  //   記録の 日付を 直す・消す 前の 門（rowsAto＝倉庫から 読み直した 行を 変えた 物）
  function shimeAkiMonRows(henkou) {
    var retsu = shimeRetsuKata();
    return shimeRowsYomu().then(function (rows) {
      var f = shimeAkiFueta(retsu, rows, retsu, henkou(rows));
      return f.length ? shimeAkiBun(f) + '別の 日に するか、払い方を 先に 直してください。' : '';
    });
  }
  // ★保存の 後に 締めの 記録を 書く★（倉庫の 今の 記録を 読み直して 比べる・同じ 形なら 書かない＝対立役 直4）
  //   返り：'' ＝書いた／書かなくて よかった ・ 字＝書けなかった 訳 ・ {aki}＝空く 月が 増える＝書かなかった
  function shimeKirokuKaku(hi, rawKata) {
    var y = { tried: 0, failed: 0 };
    var mine = rawKata || { kind: 'tsuki', hi: [10, 20, 0] };
    return DKSession.softList(
      SESS,
      kaishaDake('dk_shime_rireki?select=*&order=from_date.asc&limit=100000'),
      y
    ).then(function (rows) {
      if (y.failed > 0) return '締めの 記録を 読み直せませんでした（通信）';
      RAW.shimeRireki = rows || [];
      var b = shimeRetsuKata();
      var k = b ? PayrollPeriod.rirekiKata(b, RAW.shimeRireki) : null;
      var t = PayrollPeriod.seiki(mine);
      if (!t.ok) return t.riyuu;
      if (k && !k.dame && JSON.stringify(PayrollPeriod.kataNoHi(k, hi)) === JSON.stringify(t.kata))
        return '';
      // ★書く 直前の 記録で もう一度 空く 月を 比べる★（門の 後に 別の タブが 書いた 時・対立役 本番前 直3）
      var aki = shimeAkiFueta(
        b,
        RAW.shimeRireki,
        b,
        RAW.shimeRireki
          .filter(function (x) {
            return x && String(x.from_date).slice(0, 10) !== hi;
          })
          .concat([{ from_date: hi, value: mine }])
      );
      if (aki.length) return { aki: shimeAkiBun(aki) };
      return DKSession.rest(SESS, 'dk_shime_rireki?on_conflict=company_id,from_date', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ company_id: COMPANY.company_id, from_date: hi, value: mine }),
      }).then(function (r) {
        if (r && (r.status === 401 || r.status === 403))
          return 'ログインが 切れました。ログインし直してください';
        if (!r || !r.ok) return '倉庫が 断りました（' + (r ? r.status : '?') + '）';
        return r.json().then(function (j) {
          return Array.isArray(j) && j.length === 1 ? '' : '書けた 行が ありません';
        });
      });
    });
  }
