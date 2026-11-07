  //   1行＝1人の 1つの 手当 か 控除。日付は ★今 見ている 払う回の 中★（その回の 明細に 載る）
  // ★★手当・控除の 知らせ★★ 2026-10-06（対立役）
  //   ①外した 人（明細に 出ない 人）の 手当・控除＝どの 明細にも 出ない（給料の 合計 REP.harai にも 入らない・2026-11-06 字を 直した）
  //   ②差引 支給が マイナスの 人（控除が 働いた 分より 多い）
  //   ★止めは しない★（止めるかは お金の 決め＝司さんに 訊く）。数えて 出すだけ
  function adjChui() {
    if (HONNIN || !REP) return '';
    var aru = {};
    (REP.employees || []).forEach(function (e) {
      aru[e.employee_id] = true;
    });
    var nokori = 0;
    var nokoriKen = 0; // ★行の 数でも 見る★（手当と 控除が 同じ 額で 打ち消すと 0円 に なり 知らせが 消えた）
    Object.keys(REP.days || {}).forEach(function (d) {
      ((REP.days[d] || {}).adj || []).forEach(function (a) {
        if (aru[a.employee_id]) return;
        nokori += a.kind === 'koujo' ? -a.yen : a.yen;
        nokoriKen += 1;
      });
    });
    var minus = (REP.employees || []).filter(function (e) {
      return e.totalPay < 0;
    });
    var t = '';
    if (nokoriKen) {
      t +=
        '<div>外した 人に 手当・控除が ' +
        nokoriKen +
        '件（差し引き ¥' +
        yen(nokori) +
        '）あります（どの 明細にも 出ません・給料の 合計にも 入れていません）。</div>';
    }
    if (minus.length) {
      t +=
        '<div>差引 支給が マイナスの 人：' +
        minus
          .map(function (e) {
            return esc(e.name) + ' ¥' + yen(e.totalPay);
          })
          .join('、') +
        '</div>';
    }
    return t ? '<div class="card adj-chui noprint">' + t + '</div>' : '';
  }

  function adjPanelOf(eid) {
    return document.querySelector('[data-adj-panel="' + String(eid).replace(/"/g, '') + '"]');
  }
  function adjHiraku(eid) {
    var p = adjPanelOf(eid);
    if (!p) return;
    if (p.style.display !== 'none') {
      p.style.display = 'none';
      return;
    }
    var e = ((REP && REP.employees) || []).filter(function (x) {
      return String(x.employee_id) === String(eid);
    })[0];
    var rows = ((e && e.adj) || [])
      .map(function (a) {
        return (
          '<div class="adj-gyou">' +
          esc(String(a.date).slice(5).replace('-', '/')) +
          '　' +
          (a.kind === 'koujo' ? '控除' : '手当') +
          '　' +
          esc(a.label || '') +
          '　¥' +
          yen(a.yen) +
          (a.adj_id
            ? ' <button class="xbtn" data-adj-del="' +
              esc(a.adj_id) +
              '" aria-label="消す">✕</button>'
            : '') +
          '</div>'
        );
      })
      .join('');
    p.innerHTML =
      (rows || '<div class="adj-nashi">まだ ありません。</div>') +
      '<div class="adj-form">' +
      '<input type="date" data-adj-f="date" value="' +
      esc(PERIOD.start) +
      '" min="' +
      esc(PERIOD.start) +
      '" max="' +
      esc(PERIOD.end) +
      '">' +
      '<select data-adj-f="kind"><option value="teate">手当（足す）</option><option value="koujo">控除（引く）</option></select>' +
      '<input type="text" data-adj-f="label" placeholder="名前（ガソリン代・前借り など）">' +
      '<input type="number" inputmode="numeric" min="1" data-adj-f="yen" placeholder="円">' +
      '<button class="btn" data-adj-add="' +
      esc(eid) +
      '">足す</button></div>' +
      '<div class="adj-msg" data-adj-msg></div>';
    p.style.display = '';
  }
  function adjTasu(eid) {
    var p = adjPanelOf(eid);
    if (!p || !COMPANY) return;
    if (keisanNgNara()) return;
    var v = function (k) {
      var el = p.querySelector('[data-adj-f="' + k + '"]');
      return el ? el.value : '';
    };
    var hi = v('date');
    var en = Math.round(num(v('yen')));
    var msg = p.querySelector('[data-adj-msg]');
    if (!hi || hi < PERIOD.start || hi > PERIOD.end) {
      if (msg) msg.textContent = '日付は ' + PERIOD.rangeLabel + ' の 中に してください。';
      return;
    }
    if (!(en > 0)) {
      if (msg) msg.textContent = '円を 入れてください。';
      return;
    }
    DKSession.rest(SESS, 'dk_pay_adjustments', {
      method: 'POST',
      body: JSON.stringify({
        company_id: COMPANY.company_id,
        employee_id: eid,
        work_date: hi,
        kind: v('kind') === 'koujo' ? 'koujo' : 'teate',
        label: v('label') || '',
        yen: en,
      }),
    })
      .then(function (r) {
        if (!r.ok) return saveErr('手当・控除を 保存できませんでした。', r);
        showErr('');
        loadPeriod();
      })
      .catch(function () {
        showErr('手当・控除を 保存できませんでした。');
      });
  }
  function adjKesu(id) {
    if (keisanNgNara()) return;
    DKSession.rest(SESS, 'dk_pay_adjustments?adj_id=eq.' + encodeURIComponent(id), {
      method: 'DELETE',
    })
      .then(function (r) {
        if (!r.ok) return saveErr('手当・控除を 消せませんでした。', r);
        showErr('');
        loadPeriod();
      })
      .catch(function () {
        showErr('手当・控除を 消せませんでした。');
      });
  }

