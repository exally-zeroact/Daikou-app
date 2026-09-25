'use strict';
// ============================================================
// ★★紙の 中身（9種）— ★どの画面も この1本から 組む★★★ 2026-09-25
//
//   ★司さんが 決めた 事（この 順に 効く）★
//     ・売上表は ★お金の 欄だけ★（売上／現金／請求書／電子決済／経費）
//     ・★回数と 距離は 別の 紙★
//     ・日付の 横に ★曜日★／★日曜の 列だけ 薄い 赤★（土曜は 付けない）
//     ・金額は ★円のまま★（千円に しない）
//     ・給料表は ★月ごと／年ごと／日ごと全員／個別★
//
//   ★渡す 物（ぜんぶ 呼ぶ側が 作る＝ここに 焼き付けない）★
//     k = { name, year, month, settings:{period_start_day, period_days, reserve_pool_rate},
//           kinds:[{label, hiku}], denshi:true/false }
//
//   ★1枚に 入る 数は js/kami-kumu.js の HITO_1MAI / KURUMA_2RETSU★（実測の 値）
//   ★見張り★ tests/unit/kami-hyou.test.js
// ============================================================

(function (global) {
  /* eslint-disable no-undef */
  const K = global.KamiKumu || (typeof require === 'function' ? require('./kami-kumu.js') : null);
  /* eslint-enable no-undef */

  function en(v) {
    return K.en(v);
  }
  function esc(s) {
    return K.esc(s);
  }
  function n(v) {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  }
  function km(v) {
    return v === null || v === undefined
      ? '<span class="z">—</span>'
      : n(v).toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  function kaz(v) {
    return v === null || v === undefined || n(v) === 0
      ? '<span class="z">—</span>'
      : String(Math.round(n(v)));
  }
  function ym(k) {
    return k.year + '年 ' + k.month + '月';
  }
  // ★日が 行の 表＝日付の 横に 曜日★（司さん「日付の横に曜日（月、火など）も入れて」）
  //   見出しが 日に なる 表（日×人）は K.thHi が 曜日を 付ける。
  function hiJi(k, d) {
    return (
      k.month + '/' + d + '<span class="yb">' + K.YOUBI[K.youbi(k.year, k.month, d)] + '</span>'
    );
  }

  // ── ①月次集計（A4縦）──────────────────────────────
  function getsuji(k, d) {
    const hiku = (k.kinds || [])
      .filter(function (x) {
        return x.hiku;
      })
      .map(function (x) {
        return x.label;
      });
    // ★期間の 名前は 画面が 出した 物を 優先★（GetsujiAgg の rangeLabel）
    //   ＝同じ 区切りを 2か所で 作らない（食い違いの もと）
    const ki =
      d.kyuryoNamae && d.kyuryoNamae.length ? d.kyuryoNamae : K.kikan(k.year, k.month, k.settings);
    let h =
      K.atama(k, '月次集計', ym(k)) +
      '<div class="big">' +
      K.box('売上', en(d.uriage)) +
      K.box('給料', en(d.kyuryo)) +
      K.box('会社に残る分', en(d.nokori), true) +
      '</div>';

    h +=
      '<h2>① 売上</h2>' +
      K.hyou(
        ['<th>項目</th>', '<th>金額</th>', '<th>内わけ</th>'],
        [
          '<tr><td>売上</td><td>' +
            en(d.uriage) +
            '</td><td class="z">メーターの合計 − 実費</td></tr>',
          '<tr><td>経費（実費）</td><td>' +
            en(d.keihi) +
            '</td><td class="z">' +
            (hiku.length ? esc(hiku.join('・')) : '引く物なし') +
            '</td></tr>',
          '<tr><td>請求書</td><td>' +
            en(d.seikyu) +
            '</td><td class="z">まだ 現金に なっていない</td></tr>',
          '<tr><td>電子決済</td><td>' +
            en(d.denshi) +
            '</td><td class="z">' +
            (k.denshi ? 'まだ 現金に なっていない' : '使っていません') +
            '</td></tr>',
        ],
        '<tr class="sum"><td>現金</td><td>' +
          en(d.genkin) +
          '</td><td class="z">売上 − 請求書 − 電子決済</td></tr>'
      );

    const kg = ki.map(function (na, i) {
      return '<tr><td>' + esc(na) + '</td><td>' + en((d.kyuryoKikan || [])[i]) + '</td></tr>';
    });
    const tsumi = n(d.tsumitate);
    const ritsu = n((k.settings || {}).reserve_pool_rate) * 100;
    h +=
      '<div class="futatsu"><div><h2>② 給料（払う回ごと）</h2>' +
      K.hyou(
        ['<th>期間</th>', '<th>金額</th>'],
        kg,
        '<tr class="sum"><td>合計</td><td>' + en(d.kyuryo) + '</td></tr>'
      ) +
      '</div><div><h2>③ 会社に残る分</h2>' +
      K.hyou(
        ['<th>項目</th>', '<th>金額</th>'],
        [
          '<tr><td>売上</td><td>' + en(d.uriage) + '</td></tr>',
          '<tr><td>− 給料</td><td>' + en(d.kyuryo) + '</td></tr>',
          '<tr><td>− 積立金' +
            (ritsu ? '（' + Math.round(ritsu * 10) / 10 + '%）' : '') +
            '</td><td>' +
            en(tsumi) +
            '</td></tr>',
        ],
        '<tr class="sum"><td>会社に残る分</td><td>' + en(d.nokori) + '</td></tr>'
      ) +
      '</div></div>';

    const cars = d.cars || [];
    const rows = cars.map(function (c) {
      return (
        '<tr><td>' +
        esc(c.name) +
        '</td><td>' +
        en(c.uriage) +
        '</td><td>' +
        en(c.jippi) +
        '</td></tr>'
      );
    });
    const sum =
      '<tr class="sum"><td>合計</td><td>' + en(d.uriage) + '</td><td>' + en(d.keihi) + '</td></tr>';
    const ths = ['<th>車</th>', '<th>売上</th>', '<th>実費</th>'];
    h +=
      '<h2>④ 車ごと</h2>' +
      (cars.length < K.KURUMA_2RETSU
        ? K.hyou(ths, rows, sum)
        : '<div class="nibun"><div>' +
          K.hyou(ths, rows.slice(0, Math.ceil(rows.length / 2))) +
          '</div><div>' +
          K.hyou(ths, rows.slice(Math.ceil(rows.length / 2)), sum) +
          '</div></div>');

    h += K.ashi(k, '月次集計', ym(k));
    return [{ el: K.ita('tate', h), muki: 'tate' }];
  }

  // ── ②売上表・月ごと（A4横）★お金だけ★ ──────────────
  function uriageTsuki(k, d) {
    const last = K.matsubi(k.year, k.month);
    const cars = d.cars || [];
    let h =
      K.atama(k, '売上表（月ごと）', ym(k)) +
      '<div class="big">' +
      K.box('売上', en(d.uriage)) +
      K.box('現金', en(d.genkin)) +
      K.box('請求書', en(d.seikyu), true) +
      K.box('電子決済', en(d.denshi)) +
      K.box('経費', en(d.keihi)) +
      '</div>';

    const kths = [
      '<th>車</th>',
      '<th>売上</th>',
      '<th>現金</th>',
      '<th>請求書</th>',
      '<th>電子決済</th>',
      '<th>経費</th>',
    ];
    const krows = cars.map(function (c) {
      return (
        '<tr><td>' +
        esc(c.name) +
        '</td><td>' +
        en(c.uriage) +
        '</td><td>' +
        en(c.genkin) +
        '</td><td>' +
        en(c.seikyu) +
        '</td><td>' +
        en(c.denshi) +
        '</td><td>' +
        en(c.jippi) +
        '</td></tr>'
      );
    });
    const ksum =
      '<tr class="sum"><td>合計</td><td>' +
      en(d.uriage) +
      '</td><td>' +
      en(d.genkin) +
      '</td><td>' +
      en(d.seikyu) +
      '</td><td>' +
      en(d.denshi) +
      '</td><td>' +
      en(d.keihi) +
      '</td></tr>';
    h +=
      '<h2>車ごと</h2>' +
      (cars.length < K.KURUMA_2RETSU
        ? K.hyou(kths, krows, ksum)
        : '<div class="nibun"><div>' +
          K.hyou(kths, krows.slice(0, Math.ceil(krows.length / 2))) +
          '</div><div>' +
          K.hyou(kths, krows.slice(Math.ceil(krows.length / 2)), ksum) +
          '</div></div>');

    const hths = [
      '<th>日</th>',
      '<th>売上</th>',
      '<th>現金</th>',
      '<th>請求書</th>',
      '<th>電子決済</th>',
      '<th>経費</th>',
    ];
    function han(a, b, sm) {
      const rs = [];
      for (let i = a; i <= b; i++) {
        const x = (d.hi || {})[i] || {};
        rs.push(
          '<tr>' +
            K.tdHi(k.year, k.month, i, hiJi(k, i)) +
            K.tdHi(k.year, k.month, i, en(x.uriage)) +
            K.tdHi(k.year, k.month, i, en(x.genkin)) +
            K.tdHi(k.year, k.month, i, en(x.seikyu)) +
            K.tdHi(k.year, k.month, i, en(x.denshi)) +
            K.tdHi(k.year, k.month, i, en(x.keihi)) +
            '</tr>'
        );
      }
      return K.hyou(
        hths,
        rs,
        sm
          ? '<tr class="sum"><td>合計</td><td>' +
              en(d.uriage) +
              '</td><td>' +
              en(d.genkin) +
              '</td><td>' +
              en(d.seikyu) +
              '</td><td>' +
              en(d.denshi) +
              '</td><td>' +
              en(d.keihi) +
              '</td></tr>'
          : null
      );
    }
    const naka = Math.ceil(last / 2);
    h +=
      '<h2>日ごと</h2><div class="nibun"><div>' +
      han(1, naka, false) +
      '</div><div>' +
      han(naka + 1, last, true) +
      '</div></div>';
    h += K.ashi(k, '売上表（月ごと）', ym(k), '売上＝メーターの合計 − 選んだ実費');
    return [{ el: K.ita('yoko', h), muki: 'yoko' }];
  }

  // ── ③売上表・年ごと（A4縦）─────────────────────────
  function uriageNen(k, d) {
    const t = d.total || {};
    const rows = [];
    for (let i = 1; i <= 12; i++) {
      const x = (d.tsuki || {})[i];
      rows.push(
        '<tr><td>' +
          i +
          '月</td><td>' +
          en(x ? x.uriage : null) +
          '</td><td>' +
          en(x ? x.genkin : null) +
          '</td><td>' +
          en(x ? x.seikyu : null) +
          '</td><td>' +
          en(x ? x.denshi : null) +
          '</td><td>' +
          en(x ? x.keihi : null) +
          '</td></tr>'
      );
    }
    const h =
      K.atama(k, '売上表（年ごと）', k.year + '年') +
      '<div class="big">' +
      K.box('売上', en(t.uriage)) +
      K.box('現金', en(t.genkin)) +
      K.box('請求書', en(t.seikyu), true) +
      '</div>' +
      '<h2>月ごと</h2>' +
      K.hyou(
        [
          '<th>月</th>',
          '<th>売上</th>',
          '<th>現金</th>',
          '<th>請求書</th>',
          '<th>電子決済</th>',
          '<th>経費</th>',
        ],
        rows,
        '<tr class="sum"><td>合計</td><td>' +
          en(t.uriage) +
          '</td><td>' +
          en(t.genkin) +
          '</td><td>' +
          en(t.seikyu) +
          '</td><td>' +
          en(t.denshi) +
          '</td><td>' +
          en(t.keihi) +
          '</td></tr>'
      ) +
      K.ashi(k, '売上表（年ごと）', k.year + '年');
    return [{ el: K.ita('tate', h), muki: 'tate' }];
  }

  // ── ④回数・距離（月ごと）A4横 ★別の 紙★ ────────────
  function soukouTsuki(k, d) {
    const last = K.matsubi(k.year, k.month);
    const cars = d.cars || [];
    const kara = n(d.sou) - n(d.jissha);
    let h =
      K.atama(k, '回数・距離（月ごと）', ym(k)) +
      '<div class="big">' +
      K.box('回数', kaz(d.kaisuu)) +
      K.box('実車 km', km(d.jissha)) +
      K.box('総走行 km', km(d.sou)) +
      K.box('迎え・戻り km', km(kara), true) +
      '</div>';
    const ths = [
      '<th>車</th>',
      '<th>回数</th>',
      '<th>実車 km</th>',
      '<th>総走行 km</th>',
      '<th>迎え・戻り km</th>',
    ];
    const rows = cars.map(function (c) {
      return (
        '<tr><td>' +
        esc(c.name) +
        '</td><td>' +
        kaz(c.kaisuu) +
        '</td><td>' +
        km(c.jissha) +
        '</td><td>' +
        km(c.sou) +
        '</td><td>' +
        km(n(c.sou) - n(c.jissha)) +
        '</td></tr>'
      );
    });
    const sum =
      '<tr class="sum"><td>合計</td><td>' +
      kaz(d.kaisuu) +
      '</td><td>' +
      km(d.jissha) +
      '</td><td>' +
      km(d.sou) +
      '</td><td>' +
      km(kara) +
      '</td></tr>';
    h +=
      '<h2>車ごと</h2>' +
      (cars.length < K.KURUMA_2RETSU
        ? K.hyou(ths, rows, sum)
        : '<div class="nibun"><div>' +
          K.hyou(ths, rows.slice(0, Math.ceil(rows.length / 2))) +
          '</div><div>' +
          K.hyou(ths, rows.slice(Math.ceil(rows.length / 2)), sum) +
          '</div></div>');

    const hths = ['<th>日</th>', '<th>回数</th>', '<th>実車 km</th>', '<th>総走行 km</th>'];
    function han(a, b, sm) {
      const rs = [];
      for (let i = a; i <= b; i++) {
        const x = (d.hi || {})[i] || {};
        rs.push(
          '<tr>' +
            K.tdHi(k.year, k.month, i, hiJi(k, i)) +
            K.tdHi(k.year, k.month, i, kaz(x.kaisuu)) +
            K.tdHi(k.year, k.month, i, km(x.jissha)) +
            K.tdHi(k.year, k.month, i, km(x.sou)) +
            '</tr>'
        );
      }
      return K.hyou(
        hths,
        rs,
        sm
          ? '<tr class="sum"><td>合計</td><td>' +
              kaz(d.kaisuu) +
              '</td><td>' +
              km(d.jissha) +
              '</td><td>' +
              km(d.sou) +
              '</td></tr>'
          : null
      );
    }
    const naka = Math.ceil(last / 2);
    h +=
      '<h2>日ごと</h2><div class="nibun"><div>' +
      han(1, naka, false) +
      '</div><div>' +
      han(naka + 1, last, true) +
      '</div></div>';
    h += K.ashi(
      k,
      '回数・距離（月ごと）',
      ym(k),
      '迎え・戻り km ＝ 総走行 − 実車（お金にならない 走り）'
    );
    return [{ el: K.ita('yoko', h), muki: 'yoko' }];
  }

  // ── ⑤回数・距離（年ごと）A4縦 ─────────────────────
  function soukouNen(k, d) {
    const t = d.total || {};
    const rows = [];
    for (let i = 1; i <= 12; i++) {
      const x = (d.tsuki || {})[i];
      rows.push(
        '<tr><td>' +
          i +
          '月</td><td>' +
          kaz(x ? x.kaisuu : null) +
          '</td><td>' +
          km(x ? x.jissha : null) +
          '</td><td>' +
          km(x ? x.sou : null) +
          '</td><td>' +
          km(x ? n(x.sou) - n(x.jissha) : null) +
          '</td></tr>'
      );
    }
    const h =
      K.atama(k, '回数・距離（年ごと）', k.year + '年') +
      '<div class="big">' +
      K.box('回数', kaz(t.kaisuu)) +
      K.box('実車 km', km(t.jissha)) +
      K.box('総走行 km', km(t.sou), true) +
      '</div>' +
      '<h2>月ごと</h2>' +
      K.hyou(
        [
          '<th>月</th>',
          '<th>回数</th>',
          '<th>実車 km</th>',
          '<th>総走行 km</th>',
          '<th>迎え・戻り km</th>',
        ],
        rows,
        '<tr class="sum"><td>合計</td><td>' +
          kaz(t.kaisuu) +
          '</td><td>' +
          km(t.jissha) +
          '</td><td>' +
          km(t.sou) +
          '</td><td>' +
          km(n(t.sou) - n(t.jissha)) +
          '</td></tr>'
      ) +
      K.ashi(k, '回数・距離（年ごと）', k.year + '年', '迎え・戻り km ＝ 総走行 − 実車');
    return [{ el: K.ita('tate', h), muki: 'tate' }];
  }

  // ── ⑥給料表・月ごと（全体）A4横 ───────────────────
  function kyuryoTsuki(k, d) {
    // ★期間の 名前は 画面が 出した 物を 優先★（PayrollPeriod が 実際に 区切った 名前）
    //   ⇒ ★起算日が 21日のような 月をまたぐ 会社でも 列と 中身が ずれない★
    const ki = d.namae && d.namae.length ? d.namae : K.kikan(k.year, k.month, k.settings);
    const hito = (d.hito || []).map(function (p) {
      const a = (p.kikan || []).slice(0, ki.length);
      while (a.length < ki.length) a.push(0);
      return { name: p.name, kikan: a, jikan: n(p.jikan) };
    });
    const zen = hito.reduce(function (s, p) {
      return (
        s +
        p.kikan.reduce(function (x, y) {
          return x + n(y);
        }, 0)
      );
    }, 0);
    const jikan = hito.reduce(function (s, p) {
      return s + p.jikan;
    }, 0);
    const h =
      K.atama(k, '給料表（月ごと・全体）', ym(k)) +
      '<div class="big">' +
      K.box('給料 合計', en(zen)) +
      K.box('人数', String(hito.length)) +
      K.box('時間 合計', km(jikan), true) +
      '</div>' +
      '<h2>人ごと</h2>' +
      K.hyou(
        ['<th>従業員</th>']
          .concat(
            ki.map(function (x) {
              return '<th>' + esc(x) + '</th>';
            })
          )
          .concat(['<th>時間</th>', '<th>合計</th>']),
        hito.map(function (p) {
          return (
            '<tr><td>' +
            esc(p.name) +
            '</td>' +
            p.kikan
              .map(function (v) {
                return '<td>' + en(v) + '</td>';
              })
              .join('') +
            '<td>' +
            km(p.jikan) +
            '</td><td>' +
            en(
              p.kikan.reduce(function (x, y) {
                return x + n(y);
              }, 0)
            ) +
            '</td></tr>'
          );
        }),
        '<tr class="sum"><td>合計</td>' +
          ki
            .map(function (_, i) {
              return (
                '<td>' +
                en(
                  hito.reduce(function (s, p) {
                    return s + n(p.kikan[i]);
                  }, 0)
                ) +
                '</td>'
              );
            })
            .join('') +
          '<td>' +
          km(jikan) +
          '</td><td>' +
          en(zen) +
          '</td></tr>'
      ) +
      K.ashi(k, '給料表（月ごと・全体）', ym(k), '払う回の区切りは 会社設定');
    return [{ el: K.ita('yoko', h), muki: 'yoko' }];
  }

  // ── ⑦給料表・年ごと（A4縦）────────────────────────
  function kyuryoNen(k, d) {
    const na = (d.hito || []).map(function (p) {
      return p.name;
    });
    const rows = [];
    for (let i = 1; i <= 12; i++) {
      const x = (d.tsuki || {})[i];
      rows.push(
        '<tr><td>' +
          i +
          '月</td>' +
          na
            .map(function (nm) {
              return '<td>' + en(x ? x[nm] : null) + '</td>';
            })
            .join('') +
          '<td>' +
          en(
            x
              ? na.reduce(function (s, nm) {
                  return s + n(x[nm]);
                }, 0)
              : null
          ) +
          '</td></tr>'
      );
    }
    const h =
      K.atama(k, '給料表（年ごと）', k.year + '年') +
      '<h2>月ごと × 人</h2>' +
      K.hyou(
        ['<th>月</th>']
          .concat(
            na.map(function (x) {
              return '<th>' + esc(x) + '</th>';
            })
          )
          .concat(['<th>合計</th>']),
        rows,
        '<tr class="sum"><td>合計</td>' +
          na
            .map(function (nm) {
              let s = 0;
              for (let j = 1; j <= 12; j++) {
                const y = (d.tsuki || {})[j];
                if (y) s += n(y[nm]);
              }
              return '<td>' + en(s) + '</td>';
            })
            .join('') +
          '<td>' +
          en(d.zen) +
          '</td></tr>'
      ) +
      K.ashi(k, '給料表（年ごと）', k.year + '年');
    return [{ el: K.ita('tate', h), muki: 'tate' }];
  }

  // ============================================================
  // ★★日付を ★上★ に 並べる 表（前半／後半）★★ 2026-09-25
  //
  //   ★司さん★「上に日付持ってきて前半後半やなかったか？」
  //             「時間の方も金額のように前半後半に分けて」
  //             「両方日付の横に曜日（月、火など）も入れて
  //               ★日曜の列は背景を薄い赤にして★」
  //
  //   ★前は 逆だった★＝行に 日付を 置いていた。
  //     司さんの「日曜の★列★」が 答え★＝日付が 列で ないと
  //     「日曜の 列」という 言い方に ならない。
  //
  //   ★★列の 幅★★ 2026-09-25（司さん「なんで金額の列も自動調整にしとんど
  //     勝手なことすんなぼけ／前半後半で収まるように固定しとけや
  //     ★自動調整は名前しか言うてなかろが★」）
  //     ・日ごとの 列 … ★全部 同じ 幅の 決め打ち★（中身で 伸び縮みさせない）
  //     ・計の 列 ……… 決め打ち
  //     ・名前の 列 …… ★ここだけ 中身の 長さで 決める★
  //     ⇒ 前半（15日）と 後半（16日）で ★日の 列の 幅が 揃う★＝並べて 見比べられる
  //     ⇒ 余った 幅は 名前の 列に 足して ★どちらの 表も 同じ 右端★ で 終わる
  //
  //   rows … [{ name, v:[1日目…末日], fmt }]
  //   sumNa … 渡すと 一番 下に 合計の 行を 付ける（個別は 要らない）
  //   haba … { na, hi, kei, ita }（px・呼ぶ側が 先に 決める）
  // ============================================================
  function hiYoko(k, a, b, rows, midashi, sumNa, haba) {
    const kazu = b - a + 1;
    // ★★前半と 後半で ★名前の 列も 日の 列も 同じ 幅★★★
    //   ⇒ 縦に 並べた 時に ★列が 縦に 揃う★（司さん「前半後半で収まるように固定しとけや」）
    //   ⇒ 日数が 少ない 側（31日の 月の 後半＝15日）は ★表が その分 短く 終わる★。
    //     余りを 名前の 列に 足すと ★列が 横に ずれて 見比べられない★ ので 足さない。
    const zenHaba = haba.na + haba.hi * kazu + haba.kei;
    const cols =
      '<colgroup><col style="width:' +
      haba.na +
      'px">' +
      new Array(kazu + 1).join('<col style="width:' + haba.hi + 'px">') +
      '<col style="width:' +
      haba.kei +
      'px"></colgroup>';

    const ths = ['<th>' + esc(midashi) + '</th>'];
    for (let d = a; d <= b; d++) ths.push(K.thHi(k.year, k.month, d));
    ths.push('<th>計</th>');

    const tate = [];
    for (let d = a; d <= b; d++) tate.push(0);
    let zen = 0;

    const trs = rows.map(function (r) {
      const f = r.fmt || en;
      let s = 0;
      const tds = [];
      for (let d = a; d <= b; d++) {
        const v = n((r.v || [])[d - 1]);
        s += v;
        tate[d - a] += v;
        tds.push(K.tdHi(k.year, k.month, d, f(v)));
      }
      zen += s;
      return '<tr><td>' + esc(r.name) + '</td>' + tds.join('') + '<td>' + f(s) + '</td></tr>';
    });

    const f0 = (rows[0] && rows[0].fmt) || en;
    const sum = sumNa
      ? '<tr class="sum"><td>' +
        esc(sumNa) +
        '</td>' +
        tate
          .map(function (v, i) {
            return K.tdHi(k.year, k.month, a + i, f0(v));
          })
          .join('') +
        '<td>' +
        f0(zen) +
        '</td></tr>'
      : null;
    return (
      '<div class="hiyoko">' +
      K.hyou(ths, trs, sum).replace('<table>', '<table style="width:' + zenHaba + 'px">' + cols) +
      '</div>'
    );
  }

  // ★★名前の 列の 幅を 中身から 出す★★（★伸ばすのは ここだけ★）
  //   全角は 1文字 ≒ 字の 大きさ、半角は その 半分強。左右の 余白 23px を 足す。
  //   ★実測（2026-09-25・11px）★「山田 太郎」= 78px ／「東海林 けんいちろう」= 125px
  function naHabaOf(namae, ji) {
    let w = 0;
    (namae || []).forEach(function (na) {
      let x = 0;
      String(na === null || na === undefined ? '' : na)
        .split('')
        .forEach(function (c) {
          x += c.charCodeAt(0) < 0x2e80 ? ji * 0.55 : ji;
        });
      w = Math.max(w, x);
    });
    return Math.min(Math.max(78, Math.ceil(w) + 23), 170);
  }

  // ★A4横の 板から 表に 使える 幅★（.dk-kami の 左右の 余白 30px×2）
  const ITA_YOKO = 1123 - 60;
  const KEI_HABA = 78;

  // ★日ごとの 列の 幅＝一番 日数の 多い 側（16日）で 決める★
  //   ⇒ 前半も 後半も ★同じ 幅★ に なる
  function hiHabaOf(k, naHaba) {
    const last = K.matsubi(k.year, k.month);
    const ooi = Math.max(Math.ceil(last / 2), last - Math.ceil(last / 2));
    return Math.floor((ITA_YOKO - naHaba - KEI_HABA) / ooi);
  }

  // ★前半／後半の 切り目と 見出し★（月の 日数で 自動）
  function hanbun(k) {
    const last = K.matsubi(k.year, k.month);
    const naka = Math.ceil(last / 2);
    return [
      { a: 1, b: naka, na: '前半（' + k.month + '/1 〜 ' + k.month + '/' + naka + '）' },
      {
        a: naka + 1,
        b: last,
        na: '後半（' + k.month + '/' + (naka + 1) + ' 〜 ' + k.month + '/' + last + '）',
      },
    ];
  }

  function jikanFmt(v) {
    return n(v) ? km(v) : '<span class="z">—</span>';
  }

  // ── ⑧給料表・日ごと（全員）A4横 ───────────────
  //   ★金額の 紙と 時間の 紙を 分ける★＝4つの 表を 1枚に 入れると
  //   ★人数が 3人しか 入らない★（実測）ので 2枚に 割る。
  function kyuryoHi(k, d) {
    const hito = d.hito || [];
    const han = hanbun(k);
    let taba = [];
    for (let i = 0; i < hito.length; i += K.HITO_1MAI) taba.push(hito.slice(i, i + K.HITO_1MAI));
    if (!taba.length) taba = [[]];

    const mai = [];
    // ★金額の 紙 ＋ 時間の 紙★＝1組で 2枚
    const zenMai = taba.length * 2;
    taba.forEach(function (t, mi) {
      const sm = t.reduce(function (s, p) {
        return (
          s +
          (p.hi || []).reduce(function (x, y) {
            return x + n(y);
          }, 0)
        );
      }, 0);
      const jk = t.reduce(function (s, p) {
        return (
          s +
          (p.hiJikan || []).reduce(function (x, y) {
            return x + n(y);
          }, 0)
        );
      }, 0);
      const mj = taba.length > 1 ? '　（' + (mi + 1) + ' / ' + taba.length + '組）' : '';

      // ★幅は この 組の 名前で 決める★（日の 列は 全部 同じ・名前だけ 伸びる）
      const naHaba = naHabaOf(
        t.map(function (p) {
          return p.name;
        }),
        11
      );
      const haba = {
        na: naHaba,
        hi: hiHabaOf(k, naHaba),
        kei: KEI_HABA,
        ita: ITA_YOKO,
      };

      function kumu(dai, ba, fmt, mn) {
        return (
          K.atama(k, '給料表（日ごと・全員）', ym(k) + '　' + dai + mj) +
          '<div class="big">' +
          K.box(dai === '金額' ? '給料 合計' : '時間 合計', dai === '金額' ? en(sm) : km(jk)) +
          K.box('人数', String(t.length)) +
          K.box('日数', String(K.matsubi(k.year, k.month)), true) +
          '</div>' +
          han
            .map(function (h) {
              return (
                '<h2>' +
                dai +
                '　' +
                h.na +
                '</h2>' +
                hiYoko(
                  k,
                  h.a,
                  h.b,
                  t.map(function (p) {
                    return { name: p.name, v: ba(p), fmt: fmt };
                  }),
                  '従業員',
                  '合計',
                  haba
                )
              );
            })
            .join('') +
          // ★出すのは 何枚目かだけ★＝金額と 時間で 必ず 2枚に なるので
          //   「抜けていないか」が 分からないと 困る（覚書きは 1つも 出さない）
          K.ashi(k, '', '', '', mn, zenMai)
        );
      }

      mai.push({
        el: K.ita(
          'yoko',
          kumu(
            '金額',
            function (p) {
              return p.hi;
            },
            en,
            mi * 2 + 1
          )
        ),
        muki: 'yoko',
      });
      mai.push({
        el: K.ita(
          'yoko',
          kumu(
            '時間',
            function (p) {
              return p.hiJikan;
            },
            jikanFmt,
            mi * 2 + 2
          )
        ),
        muki: 'yoko',
      });
    });
    return mai;
  }

  // ── ⑨給料表・個別（A4横）──────────────────
  //   1人なので 金額と 時間を ★行★ に 並べられる（日付は 上）
  function kyuryoKojin(k, d) {
    const p = d.hito || {};
    // ★期間の 名前は 画面が 出した 物を 優先★
    const ki = d.namae && d.namae.length ? d.namae : K.kikan(k.year, k.month, k.settings);
    const kk = (p.kikan || []).slice(0, ki.length);
    while (kk.length < ki.length) kk.push(0);
    const zen = kk.reduce(function (s, v) {
      return s + n(v);
    }, 0);
    const han = hanbun(k);
    // ★個別は 左の 列が「金額／時間」の 2語だけ★＝名前の 長さでは 決まらない
    const naKo = naHabaOf(['金額', '時間'], 11);
    const habaKo = { na: naKo, hi: hiHabaOf(k, naKo), kei: KEI_HABA, ita: ITA_YOKO };
    const h =
      K.atama(k, '給料表（個別）', ym(k) + '　' + esc(p.name || '')) +
      '<div class="big">' +
      K.box('支給 合計', en(zen)) +
      K.box('時間', km(p.jikan), true) +
      '</div>' +
      // ★A4横は 幅が 在るので 3列だけだと 右が 丸ごと 空く★＝半分に 収める
      '<h2>払う回ごと</h2><div class="hanbun">' +
      K.hyou(
        ['<th>期間</th>', '<th>金額</th>', '<th>時間</th>'],
        ki.map(function (na, i) {
          const hj = n((p.kikanJikan || [])[i]);
          return (
            '<tr><td>' +
            esc(na) +
            '</td><td>' +
            en(kk[i]) +
            '</td><td>' +
            (hj ? km(hj) : '<span class="z">—</span>') +
            '</td></tr>'
          );
        }),
        '<tr class="sum"><td>合計</td><td>' + en(zen) + '</td><td>' + km(p.jikan) + '</td></tr>'
      ) +
      '</div>' +
      han
        .map(function (x) {
          return (
            '<h2>日ごと　' +
            x.na +
            '</h2>' +
            hiYoko(
              k,
              x.a,
              x.b,
              [
                { name: '金額', v: p.hi, fmt: en },
                { name: '時間', v: p.hiJikan, fmt: jikanFmt },
              ],
              '',
              null,
              habaKo
            )
          );
        })
        .join('') +
      K.ashi(k, '給料表（個別）', ym(k) + '　' + (p.name || ''));
    return [{ el: K.ita('yoko', h), muki: 'yoko' }];
  }

  const api = {
    getsuji: getsuji,
    uriageTsuki: uriageTsuki,
    uriageNen: uriageNen,
    soukouTsuki: soukouTsuki,
    soukouNen: soukouNen,
    kyuryoTsuki: kyuryoTsuki,
    kyuryoNen: kyuryoNen,
    kyuryoHi: kyuryoHi,
    kyuryoKojin: kyuryoKojin,
  };
  if (typeof global !== 'undefined') global.KamiHyou = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
