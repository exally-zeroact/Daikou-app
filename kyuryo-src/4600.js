  // ★★人ごとの 歩合・最低保証・役割の「何日から」★★ 2026-10-18（docs/nannichi-kara-hito.md）
  //   司さん 10-17「その日より前は前の値」「1週間前の日付で設定したら遡って変わる」
  //   「何日から変えれるかはユーザーが自由に指定できるように」（記録の 日付も 値も 直せて 消せる）
  //   ★記録が 無い 日（一番 古い 記録より 前）は 列の 値★＝記録0の 人は 今と 同じ
  var EMP_HI = {}; // 人 → 選んだ 日（既定は 今日の 日本時間・空＝最初から）
  var RIREKI_HIRAKU = {}; // 記録の 一覧を 開いた 人
  var RIREKI_NA = { pay_rate: '歩合', pay_floor: '最低保証', role: '役割' };
  function empHi(id) {
    hiHiGawari();
    if (Object.prototype.hasOwnProperty.call(EMP_HI, id)) return EMP_HI[id];
    var o = hiOboeHiku('emp', id); // ★その 日の うちに 選んだ 日★（画面を 行き来しても 残す・2026-10-25）
    // ★この 窓で 最初に 描いた 日に 固定★（別の 窓が 後から 覚えを 書いても、画面の 日と 保存の 日を 分けない・
    //   0時を またいでも 画面の 日の まま 書く・対立役 本番前 S1）
    EMP_HI[id] = o !== null ? o : kyouJst();
    return EMP_HI[id];
  }
  function rirekiNoHito(id) {
    return (RAW.rireki || []).filter(function (x) {
      return x && x.employee_id === id;
    });
  }
  // 選んだ 日の その 人（計算と 同じ 引き方）。空＝最初から＝列の 値
  function hiNoHito(e) {
    var hi = empHi(e.employee_id);
    if (!hi || !Array.isArray(RAW.rireki)) return e;
    var c = PayrollDaily.buildCtx({ employees: [e], rireki: rirekiNoHito(e.employee_id) });
    return PayrollDaily.empOn(c, e.employee_id, hi) || e;
  }
  // ★日付を 空（最初から）に した 時の 注意★（記録が 在る 人は 一番 古い 記録より 前だけに 効く）
  function hiNoChui(e) {
    if (empHi(e.employee_id)) return '';
    var l = rirekiNoHito(e.employee_id)
      .map(function (x) {
        return x.from_date;
      })
      .sort();
    if (!l.length) return '';
    return '<div class="th-sub">最初から＝' + esc(l[0]) + ' より 前の 日だけに 効きます</div>';
  }
  function rirekiAtai(x) {
    if (x.value === null || x.value === undefined) return '';
    return String(x.value);
  }
  function rirekiNoGyou(e) {
    var l = rirekiNoHito(e.employee_id)
      .slice()
      .sort(function (a, b) {
        return a.from_date < b.from_date ? -1 : a.from_date > b.from_date ? 1 : 0;
      });
    var h =
      '<tr class="rireki-tr"><td colspan="8"><div class="rireki-waku"><b>' +
      esc(e.name || '') +
      ' の 変えた 記録</b>（その 日から 次の 記録の 日まで 効く。一番 古い 記録より 前は 最初からの 値＝役割 ' +
      esc(e.role || '空') +
      '・歩合 ' +
      esc(e.pay_rate == null ? '役割どおり' : e.pay_rate) +
      '・最低保証 ' +
      esc(e.pay_floor == null ? '役割どおり' : e.pay_floor) +
      '）';
    if (!Array.isArray(RAW.rireki))
      return (
        h +
        '<div class="rolewarn">記録を 読めませんでした。開き直してください。</div></div></td></tr>'
      );
    if (!l.length) h += '<div class="th-sub">まだ 記録は ありません。</div>';
    l.forEach(function (x) {
      h +=
        '<div class="rireki-r"><input type="date" data-rk-hi="' +
        esc(x.rireki_id) +
        '" value="' +
        esc(x.from_date) +
        '"> から ' +
        esc(RIREKI_NA[x.key] || x.key) +
        ' <input class="txt" data-rk-v="' +
        esc(x.rireki_id) +
        '" data-rk-key="' +
        esc(x.key) +
        '" value="' +
        esc(rirekiAtai(x)) +
        '" placeholder="' +
        (x.key === 'role' ? '役割の 名前' : '空＝役割どおり') +
        '"> <button class="btn ghost" type="button" data-rk-del="' +
        esc(x.rireki_id) +
        '">消す</button></div>';
    });
    return h + '</div></td></tr>';
  }
  function rirekiNoAtai(key, v) {
    if (key === 'role') return String(v == null ? '' : v).trim() === '' ? null : String(v).trim();
    if (v === null || v === undefined || String(v).trim() === '') return null;
    return num(v);
  }
  // 記録を 読み直して 出し直す（書いた 後）
  function rirekiYomiNaoshi() {
    var y = { tried: 0, failed: 0 };
    return DKSession.softList(
      SESS,
      kaishaDake('dk_hito_rireki?select=*&order=from_date.asc&limit=100000'),
      y
    ).then(function (rows) {
      RAW.rireki = y.failed > 0 ? null : rows || [];
      recalc();
      renderEmp();
    });
  }
  // ★書けた 行が 1つか まで 見る★（RLS で 0行でも 204 で「保存しました」と 出さない・10-18 対立役 D3）
  function rirekiKaku(path, method, body) {
    return DKSession.rest(SESS, path, {
      method: method,
      headers: { Prefer: 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) return { ok: false, r: r };
      return r.json().then(function (rows) {
        return {
          ok: Array.isArray(rows) && rows.length === 1,
          r: r,
          zero: !(rows && rows.length),
        };
      });
    });
  }
  function rirekiErr(msg, x) {
    if (x && x.r && x.r.status === 409)
      return showErr(
        'その 人の 同じ 欄に 同じ 日の 記録が もう 在ります。そちらを 直すか 消してください。'
      );
    if (x && x.zero) return showErr(msg + '（書けた 行が ありません。開き直してください）');
    return saveErr(msg, x && x.r);
  }
  function rirekiOwari(msg, flashMsg) {
    return function (x) {
      if (!x.ok) return rirekiErr(msg, x);
      showErr('');
      if (flashMsg) flash('empSaved', flashMsg);
      return rirekiYomiNaoshi();
    };
  }
  // 選んだ 日から この 値（同じ 人・欄・日の 記録が 在れば 直す・無ければ 足す）
  function saveRireki(id, key, v, hi) {
    if (!Array.isArray(RAW.rireki))
      return showErr('記録を 読めていないので 保存しません。開き直してください。');
    var aru = rirekiNoHito(id).filter(function (x) {
      return x.key === key && x.from_date === hi;
    })[0];
    var atai = rirekiNoAtai(key, v);
    // ★保存中は 明細・紙を 止める★（日付付きの 歩合・最低保証・役割も 同じ・対立役 9回目 止1）
    //   記録を 書いて 読み直して 計算に 入るまで（rirekiYomiNaoshi まで）を 数える
    var matsuOwari = empMatsuHajime('rk|' + id + '|' + key);
    var p = aru
      ? rirekiKaku('dk_hito_rireki?rireki_id=eq.' + encodeURIComponent(aru.rireki_id), 'PATCH', {
          value: atai,
        })
      : rirekiKaku('dk_hito_rireki', 'POST', {
          company_id: COMPANY.company_id,
          employee_id: id,
          key: key,
          from_date: hi,
          value: atai,
        });
    return p
      .then(rirekiOwari('保存できませんでした。', hi + ' から 保存しました'))
      .catch(function () {
        showErr('保存できませんでした。');
      })
      .then(matsuOwari, matsuOwari); // 書けた 時は rirekiOwari の 読み直しが recalc 済み
  }
  function rirekiNoBotan() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-rk-hi]'), function (i) {
      i.onchange = function () {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(i.value)) return showErr('日付を 入れてください。');
        rirekiKaku(
          'dk_hito_rireki?rireki_id=eq.' + encodeURIComponent(i.getAttribute('data-rk-hi')),
          'PATCH',
          {
            from_date: i.value,
          }
        )
          .then(rirekiOwari('日付を 直せませんでした。', '日付を 直しました'))
          .catch(function () {
            showErr('日付を 直せませんでした。');
          });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-rk-v]'), function (i) {
      i.onchange = function () {
        rirekiKaku(
          'dk_hito_rireki?rireki_id=eq.' + encodeURIComponent(i.getAttribute('data-rk-v')),
          'PATCH',
          {
            value: rirekiNoAtai(i.getAttribute('data-rk-key'), i.value),
          }
        )
          .then(rirekiOwari('値を 直せませんでした。', '値を 直しました'))
          .catch(function () {
            showErr('値を 直せませんでした。');
          });
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-rk-del]'), function (b) {
      b.onclick = function () {
        b.disabled = true;
        rirekiKaku(
          'dk_hito_rireki?rireki_id=eq.' + encodeURIComponent(b.getAttribute('data-rk-del')),
          'DELETE'
        )
          .then(function (x) {
            if (!x.ok) b.disabled = false;
            return rirekiOwari('記録を 消せませんでした。', '記録を 消しました')(x);
          })
          .catch(function () {
            b.disabled = false;
            showErr('記録を 消せませんでした。');
          });
      };
    });
  }
  // ★役割の 名前を 直した 時は 役割の 記録の 名前も 直す★ 2026-10-18（対立役 止2）
  //   名前の 直し（dk_yaku_namae_naoshi）は 人の 列と 決まりの 鍵だけ 直す。記録は 名前の 字で 持つので ここで 直す。
  //   入れ替え（甲⇔乙）でも 壊れない様に、直す 前の 記録から 1行ずつ 新しい 名前を 決めて 送る。
  //   途中で 落ちたら 古い 名前が 残る＝計算は「決まりに 無い 役割」で 止まる（黙って 0円には ならない）
  function rirekiNoYakuNaoshi(map) {
    var l = (RAW.rireki || []).filter(function (x) {
      return (
        x &&
        x.key === 'role' &&
        typeof x.value === 'string' &&
        Object.prototype.hasOwnProperty.call(map, x.value)
      );
    });
    return l.reduce(function (p, x) {
      return p.then(function (ok) {
        if (!ok) return false;
        return rirekiKaku(
          'dk_hito_rireki?rireki_id=eq.' + encodeURIComponent(x.rireki_id),
          'PATCH',
          {
            value: map[x.value],
          }
        ).then(function (y) {
          return y.ok;
        });
      });
    }, Promise.resolve(true));
  }

  // ★その人だけの車のチェック (2026-08-25)★
  //   並びは「車の名前と並び」で決めた順（明細の売上1・売上2…と同じ順）。
  //   ★何も付けなければ 会社の決まりどおり★＝今までと同じ見た目。
  function _empCarBoxes(e) {
    var cars = (REP && REP.cars) || [];
    if (!cars.length) return '<span class="th-sub">まだ車がありません</span>';
    var mine = empSlipCars(e.employee_id);
    return cars
      .map(function (c) {
        return (
          '<label class="empcar"><input type="checkbox" style="width:16px;height:16px" data-emp="' +
          esc(e.employee_id) +
          '" data-f="slip_cars" data-car="' +
          esc(c.device_id) +
          '"' +
          (mine && mine.indexOf(c.device_id) >= 0 ? ' checked' : '') +
          '>' +
          esc(c.label) +
          '</label>'
        );
      })
      .join('');
  }

  // ★その人の今のチェックを 全部 集めて 1本の並びにする★
  //   1つずつ保存すると 途中の状態が倉庫に残る（片方だけ入る）ので まとめて送る。
  //   ★1つも付いていなければ null＝会社の決まりどおりに戻す★
  function _collectEmpCars(empId) {
    var out = [];
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-emp="' + empId + '"][data-f="slip_cars"]'),
      function (cb) {
        if (cb.checked) out.push(cb.getAttribute('data-car'));
      }
    );
    return out.length ? out : null;
  }

  // ★決まりの無い役割を打つと 何が起きるか★ 2026-08-25
  //   engine（daiko-payroll.js）は st.roles[役割] が無いと
  //   ★歩合0・最低保証0★ を使う。エラーは出ない＝★黙って金額が小さくなる★。
  //   ただし その人に打ってある物は そちらが勝つので、起きる事は3通り。
  //
  //   ★言葉は 実測して決めた★（2026-08-25）
  //     はじめ「0円になります」と1つだけ出したが、最低保証だけ打ってある人は
  //     ★0円ではなく 11,400円（1200 x 9.50時間）★だった＝★注意が嘘をついていた★。
  //     押して見つけたので 3通りに書き分ける。
  function _roleWarn(e) {
    var role = String((e && e.role) || '').trim();
    if (!role) return null; // まだ何も打っていない人には出さない
    var st;
    try {
      st = PayrollDaily.normSettings(SET, RAW.shimeRireki);
    } catch (_) {
      return null;
    }
    if (st.roles && st.roles[role]) return null; // 決まりが在る＝何も起きない
    var has = function (v) {
      return v !== null && v !== undefined && v !== '' && isFinite(parseFloat(v));
    };
    var r = has(e.pay_rate);
    var f = has(e.pay_floor);
    if (r && f) return null; // その人だけで足りている＝役割は使われない
    if (!r && !f) {
      return (
        'この役割の決まりがありません<br>このままだと この人の給料は <b>0円</b> になります。<br>' +
        '「給料の設定 → 役割ごとの決まり」で <b>' +
        esc(role) +
        '</b> を足すか、この人の<b>歩合と最低保証</b>を打ってください。'
      );
    }
    if (r) {
      return (
        'この役割の決まりがありません<br><b>最低保証が 0円</b>として計算されます' +
        '（打ってある歩合だけで出ます）。<br>' +
        '「給料の設定 → 役割ごとの決まり」で <b>' +
        esc(role) +
        '</b> を足すか、この人の<b>最低保証</b>を打ってください。'
      );
    }
    return (
      'この役割の決まりがありません<br><b>歩合が 0</b>として計算されます' +
      '（打ってある最低保証だけで出ます）。<br>' +
      '「給料の設定 → 役割ごとの決まり」で <b>' +
      esc(role) +
      '</b> を足すか、この人の<b>歩合</b>を打ってください。'
    );
  }

  // 役割の値（打たなかった時にどうなるかを薄く見せる）
  function _roleRateOf(role, hi) {
    try {
      var st = PayrollDaily.normSettings(SET, RAW.shimeRireki);
      var r = yakuNoHiAtai(role || '', hi) || st.roles[role || ''];
      return r ? String(r.rate) : '';
    } catch (_) {
      return '';
    }
  }
  function _roleFloorOf(role, hi) {
    try {
      var st = PayrollDaily.normSettings(SET, RAW.shimeRireki);
      var r = yakuNoHiAtai(role || '', hi) || st.roles[role || ''];
      return r ? String(r.floor) : '';
    } catch (_) {
      return '';
    }
  }

  $('btnAddEmp').onclick = function () {
    if (!COMPANY) return;
    var roles = roleNames();
    DKSession.rest(SESS, 'dk_employees', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        company_id: COMPANY.company_id,
        name: '新しい人',
        role: roles[0] || '2種',
        sort_order: RAW.employees.length + 1,
      }),
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        if (!j || !j.length) return showErr('従業員を足せませんでした。');
        showErr('');
        RAW.employees.push(j[0]);
        // ★足したばかりの 人は「最初から」★（今日から に すると 前の 日の 時数が 打った 歩合で 出ない・10-18 対立役 止3）
        if (j[0] && j[0].employee_id) {
          EMP_HI[j[0].employee_id] = '';
          hiOboeKaku('emp', j[0].employee_id, '');
        }
        recalc();
        renderEmp();
        flash('empSaved', '足しました');
      })
      .catch(function () {
        showErr('従業員を足せませんでした。');
      });
  };

  // ★書けた 行に その 人が 居るか まで 見る★ 2026-10-20（前は 0行でも「保存しました」と 出し、画面の 値だけ 変えていた）
  //   退職・復職（empTaishoku）・記録（rirekiKaku）と 同じ 形。主キーで 絞るので 本物は 1行か 0行
  // ★書けなかった 欄 1つだけを 倉庫の 値（RAW）へ 戻す★ 2026-10-20
  //   表 全体を 描き直すと 他の 欄の 打ちかけ・開いた 日付の 欄・フォーカスが 飛び、
  //   後から 通った 別の 欄の 保存と 食い違う（対立役 2回目 指1・指2）＝その 欄だけ 触る
  function empRanModosu(id, field) {
    var e = null;
    (RAW.employees || []).forEach(function (x) {
      if (x && x.employee_id === id) e = x;
    });
    if (!e) return;
    // ★欄を 描く 時と 同じ 値で 戻す★（役割・歩合・最低保証は 選んだ 日の 値＝hiNoHito・並びの 空は 0）
    //   列の 値で 戻すと、日付を 挟んだ 時に 今日の 欄へ「最初から」の 値が 出た（対立役 3回目 指1）
    var d = hiNoHito(e);
    if (field === 'slip_cars') {
      // 明細に出す車は 描く 所（_empCarBoxes）で その人の 箱を 描き直す＝決め方を 2か所に 書かない
      var box = document.querySelector('[data-emp="' + id + '"][data-f="slip_cars"]');
      var td = box && box.closest('.empcars');
      if (td) {
        td.innerHTML = _empCarBoxes(e);
        empOshiguchi();
      }
      return;
    }
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-emp="' + id + '"][data-f="' + field + '"]'),
      function (el) {
        if (el.type === 'checkbox') el.checked = !!d[field];
        else if (field === 'sort_order') el.value = String(d.sort_order || 0);
        else el.value = d[field] === null || d[field] === undefined ? '' : String(d[field]);
      }
    );
  }
  // ★人と 欄ごとの 通し番号★ 2026-10-20（対立役 4回目 指1）
  //   同じ 欄を 続けて 打つと 返りの 順が 入れ替わる。古い 返りが 欄を 戻したり 訳を 消したり すると
  //   歩合の 欄と 計算の 値が 食い違った ⇒ 欄を 戻す・訳を 出す／消すのは ★一番 新しい 送り★の 返りだけ。
  //   倉庫に 書けた 古い 返りは RAW（計算）には 入れ、新しい 送りが もう 失敗で 終わって いれば 欄も 描き直す。
  var EMP_SOKU = {};
  // ★保存中は 給料の 明細・紙を 止める★ 2026-10-21（対立役 8回目 止1・9回目 止1 止2）
  //   従業員の 欄（歩合・最低保証・役割・名前…）を 送ってから 返りが 着いて 計算に 入るまでは、
  //   明細・紙・PDF が 古い 値で 出る＝お金の 出力は 計算できなければ 止めて 警告（司さん 10-04）。
  //   人と 欄ごとに 数え（EMP_MATSU）、kyuDameBun（明細・紙・PDF が 全部 見る 1か所）が 止める。
  //   15秒を 過ぎても 返らない 送りは「返事が 来ません」に 字を 変える。saveEmp と saveRireki（日付付き）の 両方が 使う
  var EMP_MATSU = {};
  // 返事を 待つ 長さ（15秒）。試験だけ window.__EMP_MATSU_MS で 短くできる
  var EMP_MATSU_MS = Number(window.__EMP_MATSU_MS) > 0 ? Number(window.__EMP_MATSU_MS) : 15000;
  // 止めの 字の 頭（作る 所も 片付けを 判じる 所も これ 1つを 使う＝字を 言い換えても ずれない・対立役 11回目 中2）
  var EMP_OSOI_ATAMA = '従業員の 欄の 保存の 返事が 来ません';
  // 保存中（0.1秒 ほど）の 字＝明細・紙の 箱に だけ 出す。recalc は 赤い 字の 欄（#err）に 出さない
  //   （出すと 他の 操作の 失敗の 訳を 上書きして 消した・対立役 10回目 止2）
  var EMP_HOZONCHU = '従業員の 欄を 保存して います。終わるまで 給料の 明細・紙は 止めています。';
  function empTomeBun() {
    var kazu = 0;
    var osoi = 0;
    Object.keys(EMP_MATSU).forEach(function (k) {
      kazu += EMP_MATSU[k].kazu || 0;
      osoi += EMP_MATSU[k].osoi || 0;
    });
    if (osoi)
      return (
        EMP_OSOI_ATAMA +
        '（' +
        osoi +
        '件）。給料の 明細・紙は 止めています。電波を 確かめてください。返事が 来ない ままなら 画面を 読み込み直して 保存されたか 確かめてください。'
      );
    return kazu ? EMP_HOZONCHU : '';
  }
  // 赤い 字が この 止めの 字（保存中 か 返事待ち）か
  function empTomeNoJi(ji) {
    ji = String(ji || '');
    return ji === EMP_HOZONCHU || ji.indexOf(EMP_OSOI_ATAMA) === 0;
  }
  // 止めが 変わった 時に 明細を 開いて いれば 描き直す（札が 残り続けない・対立役 10回目 止1）
  function empMeisaiNuriNaoshi() {
    if (TAB === 'slip') render();
  }
  function empMatsuHajime(kagi) {
    var m = (EMP_MATSU[kagi] = EMP_MATSU[kagi] || { kazu: 0, osoi: 0 });
    m.kazu++;
    var osoi = false;
    var sumi = false;
    var t = setTimeout(function () {
      if (sumi) return;
      osoi = true;
      m.osoi++;
      // 赤い 字が 空か この 止めの 字の 時だけ 出す（他の 失敗の 訳を 上書き しない）
      var mae = String($('err').textContent || '');
      if (!mae || empTomeNoJi(mae)) showErr(empTomeBun());
      empMeisaiNuriNaoshi();
    }, EMP_MATSU_MS);
    // 終わり＝計算（recalc）に 入れた 後に 呼ぶ（前に 呼ぶと 古い 額で 明細を 描き直した・対立役 11回目 止1）
    return function () {
      if (sumi) return; // 2回 減らさない
      sumi = true;
      clearTimeout(t);
      m.kazu = Math.max(0, m.kazu - 1);
      if (osoi) m.osoi = Math.max(0, m.osoi - 1);
      // 赤い 字が この 止めの 字（PDF を 押した 時の 保存中・返事待ち）なら 今の 止めに 合わせる
      //   保存中は 赤い 字に 残さない＝返事待ちが 在る 時だけ 出し直し、無ければ 消す（対立役 11回目 止2）
      if (empTomeNoJi($('err').textContent)) {
        var nokori = empTomeBun();
        // 返事待ちが 無ければ 他の 止め（売上が 読めない 等）を 出し直す（隠さない・対立役 12回目 中1）
        showErr(nokori && nokori !== EMP_HOZONCHU ? nokori : kyuDameBunHoka(CTX) || '');
      }
      empMeisaiNuriNaoshi();
    };
  }
  // 今 出ている 保存の 訳を 出した 欄と ★その 字そのもの★（字が 同じ 時だけ 消す＝他の 操作の 訳を 消さない・対立役 6回目 止B）
  var EMP_ERR = null;
  // ★失敗の 字は その場で 作る★（列の 1段の 中で 倉庫の 訳も 読む＝後から 字を 出して 書けた 後に 古い 訳が 残る 事を 作らない・対立役 6回目 中1・7回目 中1）
  function empErrJi(r, t) {
    var st = r && r.status;
    if (st === 401 || st === 403)
      return (
        '保存できませんでした。 ' +
        ((COMPANY && COMPANY.name) || '(会社が選ばれていません)') +
        ' には書き込めません。'
      );
    var wake = '';
    try {
      var j = JSON.parse(t);
      wake = [j.message, j.details, j.hint].filter(Boolean).join(' / ');
    } catch (_) {
      wake = String(t || '').slice(0, 200);
    }
    return '保存できませんでした。' + (st ? ' [' + st + ']' : '') + (wake ? ' ' + wake : '');
  }
  function saveEmp(id, field, value) {
    var kagi = id + '|' + field;
    var me = (EMP_SOKU[kagi] = EMP_SOKU[kagi] || { n: 0 });
    me.n++;
    var ban = me.n;
    var saishin = function () {
      return ban === me.n;
    };
    // 打った 時から 数える（列で 待つ 間も 計算に 入って いない＝止める）
    var matsuOwari = empMatsuHajime(kagi);
    var shiraseru = function (ji) {
      showErr(ji);
      EMP_ERR = { kagi: kagi, ji: ji };
    };
    // 失敗＝一番 新しい 送りの 時だけ 欄を 戻し 訳を 出す
    var shippai = function (ji) {
      matsuOwari(); // 保存中の 止めを 外す（明細は 描き直す・赤い 字は 触らない）
      if (!saishin()) return; // 古い 送りの 失敗は 新しい 送りに 任せる
      try {
        empRanModosu(id, field);
      } catch (_) {
        /* 欄を 戻せなくても 訳は 必ず 出す（対立役 6回目 中2） */
      }
      shiraseru(ji);
    };
    var body = {};
    body[field] = value;
    body.updated_at = new Date().toISOString();
    // ★人と 欄ごとに 送りを 1本の 列に 並べる★（前の 返りを 待って から 次を 送る・対立役 5回目 止1）
    //   並べないと 返りの 順が 入れ替わり、倉庫と 計算（RAW）が 古い 値に なった。
    //   返事が 遅い 時も 列は 進めない（進めると 前と 次が 同時に 飛び 倉庫だけ 古い 値に なった・7回目 止1〜3）。
    //   遅れて 着いた 返りは いつも 通り 扱う（書けて いれば 計算に 入れ、止めも 外れる）
    me.retsu = (me.retsu || Promise.resolve()).then(function () {
      return DKSession.rest(SESS, 'dk_employees?employee_id=eq.' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(body),
      })
        .then(function (r) {
          // ★書けない 時は その 欄を 倉庫の 値へ 戻す★（打った 字が 残ると 保存済みに 見える・対立役 指4）
          if (!r.ok)
            return (typeof r.text === 'function' ? r.text() : Promise.resolve(''))
              .catch(function () {
                return '';
              })
              .then(function (txt) {
                return { ng: empErrJi(r, txt) };
              });
          return r.json().then(function (rows) {
            return { rows: rows };
          });
        })
        .then(function (x) {
          if (x.ng) return shippai(x.ng);
          var kaketa =
            Array.isArray(x.rows) &&
            x.rows.some(function (e) {
              return e && e.employee_id === id;
            });
          if (!kaketa)
            return shippai(
              '保存できませんでした。倉庫に 書けた 行が ありません。会社が 合っているか 確かめて、開き直してください。'
            );
          // ★自分が 出した 訳だけ 消す・recalc より 前に★（recalc が 出す 明細・紙の 止めの 警告を 消さない・対立役 5回目 止2）
          if (EMP_ERR && EMP_ERR.kagi === kagi) {
            if (String($('err').textContent || '') === EMP_ERR.ji) showErr('');
            EMP_ERR = null;
          }
          RAW.employees.forEach(function (e) {
            if (e.employee_id === id) e[field] = value;
          });
          RAW.employees.sort(function (a, b) {
            return num(a.sort_order) - num(b.sort_order);
          });
          recalc();
          matsuOwari(); // 計算に 入れた 後に 保存中を 外す（明細の 描き直しが 新しい 額で 描く）
          if (!saishin()) return; // 次の 送りが 列で 待って いる＝欄は その 送りに 任せる
          // ★役割を打ち替えたら その場で 出し直す★ 2026-08-25
          //   決まりの無い役割を打った時の ★赤い注意★ を すぐ出す為。
          //   （打ち終わって 欄から離れた時に来るので 字が消える事は無い）
          if (field === 'role') renderEmp();
          else {
            // 返りを 待つ 間に 日付を 変えた 時も 欄を 今の 値に（打っている 欄は 触らない・指3）
            var ima = document.activeElement;
            var ran = document.querySelector('[data-emp="' + id + '"][data-f="' + field + '"]');
            if (ran && ran !== ima && field !== 'slip_cars') empRanModosu(id, field);
          }
          flash('empSaved', '保存しました');
        })
        .catch(function () {
          // 通信が 切れた・返りが 読めない 時も 戻す（対立役 2回目 指3）
          try {
            shippai('保存できませんでした。通信を 確かめて、もう一度 打ってください。');
          } catch (_) {
            matsuOwari(); // 列と 止めは 必ず 進める
          }
        });
    });
  }

