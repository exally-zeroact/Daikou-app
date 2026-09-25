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
    const ki = K.kikan(k.year, k.month, k.settings);
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
    const ki = K.kikan(k.year, k.month, k.settings);
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

  // ── ⑧給料表・日ごと（全員）★1枚 9人まで★ ─────────
  function kyuryoHi(k, d) {
    const hito = d.hito || [];
    const last = K.matsubi(k.year, k.month);
    let taba = [];
    for (let i = 0; i < hito.length; i += K.HITO_1MAI) taba.push(hito.slice(i, i + K.HITO_1MAI));
    if (!taba.length) taba = [[]];
    // ★枚が 分かれる 時は 全部 同じ 向き★（一番 人が 多い 枚に 合わせる）
    const ooi = taba.reduce(function (m, t) {
      return Math.max(m, t.length);
    }, 0);
    const muki = ooi <= 5 ? 'yoko' : 'tate';

    return taba.map(function (t, mi) {
      const kei = t.map(function (p) {
        return (p.hi || []).reduce(function (s, v) {
          return s + n(v);
        }, 0);
      });
      const sm = kei.reduce(function (s, v) {
        return s + v;
      }, 0);
      const mj = taba.length > 1 ? '　（' + (mi + 1) + ' / ' + taba.length + '枚）' : '';
      const ths = ['<th>従業員</th>']
        .concat(
          t.map(function (p) {
            return '<th>' + esc(p.name) + '</th>';
          })
        )
        .concat(['<th>計</th>']);
      // ★日 × 人★
      const ths2 = ['<th>日</th>']
        .concat(
          t.map(function (p) {
            return '<th>' + esc(p.name) + '</th>';
          })
        )
        .concat(['<th>計</th>']);
      function han(a, b, last2) {
        const rs = [];
        for (let dd = a; dd <= b; dd++) {
          const v = t.map(function (p) {
            return n((p.hi || [])[dd - 1]);
          });
          rs.push(
            '<tr>' +
              K.tdHi(k.year, k.month, dd, hiJi(k, dd)) +
              v
                .map(function (x) {
                  return K.tdHi(k.year, k.month, dd, en(x));
                })
                .join('') +
              K.tdHi(
                k.year,
                k.month,
                dd,
                en(
                  v.reduce(function (s, x) {
                    return s + x;
                  }, 0)
                )
              ) +
              '</tr>'
          );
        }
        return K.hyou(
          ths2,
          rs,
          last2
            ? '<tr class="sum"><td>' +
                (taba.length > 1 ? '小計' : '合計') +
                '</td>' +
                kei
                  .map(function (x) {
                    return '<td>' + en(x) + '</td>';
                  })
                  .join('') +
                '<td>' +
                en(sm) +
                '</td></tr>'
            : null
        );
      }
      const h =
        K.atama(k, '給料表（日ごと・全員）', ym(k) + mj) +
        '<div class="big">' +
        K.box(taba.length > 1 ? 'この枚の 小計' : '給料 合計', en(sm)) +
        K.box('人数', String(t.length)) +
        K.box('日数', String(last), true) +
        '</div>' +
        '<h2>日 × 人</h2>' +
        (muki === 'yoko'
          ? '<div class="nibun"><div>' +
            han(1, Math.ceil(last / 2), false) +
            '</div><div>' +
            han(Math.ceil(last / 2) + 1, last, true) +
            '</div></div>'
          : '<div class="nibun">' + han(1, last, true) + '</div>') +
        K.ashi(
          k,
          '給料表（日ごと・全員）',
          ym(k) + mj,
          '空いている 日は 勤務なし',
          mi + 1,
          taba.length
        );
      void ths;
      return { el: K.ita(muki, h), muki: muki };
    });
  }

  // ── ⑨給料表・個別（A4縦）──────────────────────────
  function kyuryoKojin(k, d) {
    const p = d.hito || {};
    const ki = K.kikan(k.year, k.month, k.settings);
    const last = K.matsubi(k.year, k.month);
    const kk = (p.kikan || []).slice(0, ki.length);
    while (kk.length < ki.length) kk.push(0);
    const zen = kk.reduce(function (s, v) {
      return s + n(v);
    }, 0);
    function han(a, b) {
      const rs = [];
      for (let dd = a; dd <= b; dd++) {
        const v = n((p.hi || [])[dd - 1]);
        const hh = n((p.hiJikan || [])[dd - 1]);
        rs.push(
          '<tr>' +
            K.tdHi(k.year, k.month, dd, hiJi(k, dd)) +
            K.tdHi(k.year, k.month, dd, en(v)) +
            K.tdHi(k.year, k.month, dd, hh ? km(hh) : '<span class="z">—</span>') +
            '</tr>'
        );
      }
      return K.hyou(['<th>日</th>', '<th>金額</th>', '<th>時間</th>'], rs);
    }
    const h =
      K.atama(k, '給料表（個別）', ym(k) + '　' + esc(p.name || '')) +
      '<div class="big">' +
      K.box('支給 合計', en(zen)) +
      K.box('時間', km(p.jikan), true) +
      '</div>' +
      '<h2>払う回ごと</h2>' +
      K.hyou(
        ['<th>期間</th>', '<th>金額</th>'],
        ki.map(function (na, i) {
          return '<tr><td>' + esc(na) + '</td><td>' + en(kk[i]) + '</td></tr>';
        }),
        '<tr class="sum"><td>合計</td><td>' + en(zen) + '</td></tr>'
      ) +
      '<h2>日ごと</h2><div class="nibun"><div>' +
      han(1, Math.ceil(last / 2)) +
      '</div><div>' +
      han(Math.ceil(last / 2) + 1, last) +
      '</div></div>' +
      K.ashi(k, '給料表（個別）', ym(k) + '　' + (p.name || ''));
    return [{ el: K.ita('tate', h), muki: 'tate' }];
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
