  // ★★払い方の 名前と 区切りの 言葉（ここ 1か所）★★ 2026-10-24（司さん「保存するボタンの下の説明書が変わらない。
  //   選択したものに関してリアルタイムで確認のための説明書として変わるようにしろ」「テンプレの上に今の給料設定は何日締めです」）
  //   kata は seiki を 通した 形（thirds／tsuki／shuu／hi）。返り＝{ na: 名前, bun: 確かめの 一文 }・読めない 形は null
  function haraiNa(kata) {
    if (!kata) return null;
    if (kata.kind === 'thirds') return '月3回（10日・20日・末日締め）';
    if (kata.kind === 'hi') return '毎日';
    if (kata.kind === 'shuu') return '週1回（' + YOUBI_NA[kata.youbi] + '曜締め）';
    if (kata.kind !== 'tsuki' || !Array.isArray(kata.hi) || !kata.hi.length) return null;
    return (
      '月' +
      kata.hi.length +
      '回（' +
      kata.hi
        .map(function (h) {
          return h === 0 ? '末日' : h + '日';
        })
        .join('・') +
      '締め）'
    );
  }
  function haraiSetsumei(kata) {
    var na = haraiNa(kata);
    if (!na) return null;
    if (kata.kind === 'thirds')
      return {
        na: na,
        bun: na + '：1日〜10日／11日〜20日／21日〜末日の3回で明細を出します。',
      };
    if (kata.kind === 'hi') return { na: na, bun: na + '：1日ごとに明細を出します。' };
    var nz = kata.nazuke === 'hajime' ? '始まった日の月の分' : '締めた日の月の分';
    if (kata.kind === 'shuu')
      return {
        na: na,
        bun:
          na +
          '：' +
          YOUBI_NA[(kata.youbi + 1) % 7] +
          '曜〜' +
          YOUBI_NA[kata.youbi] +
          '曜の1週ごとに明細を出します（' +
          nz +
          '）。',
      };
    var hi = kata.hi;
    var n = hi.length;
    var matsu = hi[n - 1] === 0; // 最後が 末日＝月を またがない
    var ku = [];
    for (var i = 0; i < n; i++) {
      var owari = hi[i] === 0 ? '末日' : hi[i] + '日';
      var hajime =
        i > 0 ? hi[i - 1] + 1 + '日' : matsu ? '1日' : '前の月の' + (hi[n - 1] + 1) + '日';
      ku.push(hajime + '〜' + owari);
    }
    return {
      na: na,
      bun:
        na +
        '：' +
        ku.join('／') +
        'の' +
        n +
        '回で明細を出します' +
        (matsu ? '' : '（' + nz + '）') +
        '。',
    };
  }
  function renderShimeRireki() {
    var l = Array.isArray(RAW.shimeRireki)
      ? RAW.shimeRireki.slice().sort(function (a, b) {
          return a.from_date < b.from_date ? -1 : a.from_date > b.from_date ? 1 : 0;
        })
      : null;
    if ($('pHi') && $('pHi').value !== shimeHi()) $('pHi').value = shimeHi();
    if ($('pRirekiBtn')) $('pRirekiBtn').textContent = '記録 ' + (l ? l.length : '?');
    var hi = shimeHi();
    var chui = '';
    if (!l) chui = '締めの 変えた 記録を 読めませんでした。開き直してください（保存しません）。';
    else if (hi) {
      chui = hi + ' から 次の 記録の 日まで、この 払い方で 区切ります。';
      var tsugi = l
        .map(function (x) {
          return String(x.from_date).slice(0, 10);
        })
        .filter(function (d) {
          return d > hi;
        })[0];
      if (tsugi) chui += '（' + tsugi + ' の 記録まで）';
      chui += ' 切り替わりの 期は 短く なります。';
    } else if (l.length)
      chui =
        '空（最初から）＝ ' +
        String(l[0].from_date).slice(0, 10) +
        ' より 前の 日だけ 変わります。';
    // ★記録が 無い 時の 空＝今までの 全部の 月が 変わる★ 2026-10-24（前は 何も 出さず 黙って 全部の 月を 書き換えた・対立役 B／司さん「おけ」）
    else chui = '空（最初から）＝ 今までの 全部の 月の 払い方が 変わります。';
    if ($('pHiChui')) $('pHiChui').textContent = chui;
    var box = $('pRireki');
    if (!box) return;
    box.style.display = SHIME_RIREKI_HIRAKU ? '' : 'none';
    if (!SHIME_RIREKI_HIRAKU) return;
    var h =
      '<div class="rireki-waku"><b>締めの 変えた 記録</b>（その 日から 次の 記録の 日まで 効く。一番 古い 記録より 前は 最初からの 払い方）' +
      '<div class="th-sub">形を 直す 時は「何日から」に その 日を 入れて 払い方を 選び直し「保存する」</div>';
    if (!l) h += '<div class="rolewarn">記録を 読めませんでした。開き直してください。</div>';
    else if (!l.length) h += '<div class="th-sub">まだ 記録は ありません。</div>';
    (l || []).forEach(function (x) {
      h +=
        '<div class="rireki-r"><input type="date" data-sk-hi="' +
        esc(x.rireki_id) +
        '" value="' +
        esc(String(x.from_date).slice(0, 10)) +
        '"> から ' +
        esc(shimeNoNa(x.value)) +
        ' <button class="btn ghost" type="button" data-sk-del="' +
        esc(x.rireki_id) +
        '">消す</button></div>';
    });
    box.innerHTML = h + '</div>';
    Array.prototype.forEach.call(box.querySelectorAll('[data-sk-hi]'), function (i) {
      i.onchange = function () {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(i.value)) return showErr('日付を 入れてください。');
        var skId = i.getAttribute('data-sk-hi');
        var skHi = i.value;
        shimeAkiMonRows(function (rows) {
          return rows.map(function (x) {
            return x && x.rireki_id === skId ? Object.assign({}, x, { from_date: skHi }) : x;
          });
        })
          .then(function (aki) {
            if (aki) return { tome: aki };
            return rirekiKaku('dk_shime_rireki?rireki_id=eq.' + encodeURIComponent(skId), 'PATCH', {
              from_date: skHi,
            });
          })
          .then(function (x) {
            if (!x || !x.tome)
              return shimeRirekiOwari('日付を 直せませんでした。', '日付を 直しました')(x);
            // ★止めた＝倉庫の 日付に 戻して 訳を 出す★
            return shimeRirekiYomiNaoshi().then(function () {
              showErr(x.tome);
            });
          })
          .catch(function () {
            // 訳は 読み直し（loadPeriod が 字を 消す）の 後に 出す
            return shimeRirekiYomiNaoshi().then(function () {
              showErr('日付を 直せませんでした。');
            });
          });
      };
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-sk-del]'), function (b) {
      b.onclick = function () {
        var skId = b.getAttribute('data-sk-del');
        shimeAkiMonRows(function (rows) {
          return rows.filter(function (x) {
            return !(x && x.rireki_id === skId);
          });
        })
          .then(function (aki) {
            if (aki) return { tome: aki };
            return rirekiKaku('dk_shime_rireki?rireki_id=eq.' + encodeURIComponent(skId), 'DELETE');
          })
          .then(function (x) {
            if (!x || !x.tome) return shimeRirekiOwari('消せませんでした。', '消しました')(x);
            return shimeRirekiYomiNaoshi().then(function () {
              showErr(x.tome);
            });
          })
          .catch(function () {
            // 訳は 読み直し（loadPeriod が 字を 消す）の 後に 出す
            return shimeRirekiYomiNaoshi().then(function () {
              showErr('消せませんでした。');
            });
          });
      };
    });
  }
  //   nokosu＝欄を 倉庫の 形に 戻さない（書けなかった 時＝選んだ 形を 残して もう一度 押せる・対立役 3回目 直1）
  function shimeRirekiYomiNaoshi(nokosu) {
    var y = { tried: 0, failed: 0 };
    return DKSession.softList(
      SESS,
      kaishaDake('dk_shime_rireki?select=*&order=from_date.asc&limit=100000'),
      y
    ).then(function (rows) {
      RAW.shimeRireki = y.failed > 0 ? null : rows || [];
      recalc();
      shimeKataIreru(!nokosu);
      renderShimeRireki();
      loadPeriod(); // 期が 変わる
      return RAW.shimeRireki;
    });
  }
  function shimeRirekiOwari(msg, flashMsg) {
    return function (x) {
      if (!x.ok) {
        // ★読み直し（loadPeriod が 字を 消す）の 後に 訳を 出す★（前は 訳が すぐ 消えた・2026-10-19）
        return shimeRirekiYomiNaoshi().then(function () {
          if (x && x.r && x.r.status === 409)
            showErr('その 日には もう 締めの 記録が 在ります。そちらを 直すか 消してください。');
          else if (x && x.zero) showErr(msg + '（書けた 行が ありません。開き直してください）');
          else saveErr(msg, x && x.r);
        });
      }
      showErr('');
      return shimeRirekiYomiNaoshi().then(function () {
        if (flashMsg) flash('setSaved', flashMsg);
      });
    };
  }
