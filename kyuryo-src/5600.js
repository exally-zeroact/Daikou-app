  // ★★役割の 決まり（歩合・最低保証）の「何日から」★★ 2026-10-18（docs/nannichi-kara-yaku.md）
  //   記録は dk_yaku_rireki（roles の 中に 置かない＝古い 版の 画面が 保存しても 消えない）
  //   ★日付が 在る 直し＝その場で 記録を 書く（列は 変えない）／日付が 空＝列を 直して「保存する」★
  var YAKU_HI = {}; // 役割 → 選んだ 日（既定は 今日の 日本時間・空＝最初から）
  var YAKU_RIREKI_HIRAKU = {};
  var YAKU_RIREKI_NA = { rate: '歩合', floor: '最低保証' };
  function yakuHi(r) {
    hiHiGawari();
    if (Object.prototype.hasOwnProperty.call(YAKU_HI, r)) return YAKU_HI[r];
    var o = hiOboeHiku('yaku', r); // ★その 日の うちに 選んだ 日★（2026-10-25）
    YAKU_HI[r] = o !== null ? o : kyouJst(); // ★この 窓で 最初に 描いた 日に 固定★（empHi と 同じ・対立役 S1）
    return YAKU_HI[r];
  }
  // 倉庫の 名前（保存 前に 名前を 直した 役割は 読み込んだ 時の 名前）
  function yakuMotoNo(r) {
    return Object.prototype.hasOwnProperty.call(YAKU_MOTO, r) ? YAKU_MOTO[r] : r;
  }
  // ★計算に 渡す 記録★（保存 前に 名前を 直した 役割の 記録は 今の 名前で＝倉庫の 関数が 保存で する 事と 同じ）
  //   付け替えないと 名前を 直した 途端に「決まりに 無い 役割の 記録」で 止まり、消せと 出る（対立役 3回目 直1）
  function yakuRirekiNoIma() {
    if (!Array.isArray(RAW.yakuRireki)) return RAW.yakuRireki;
    var ima = {};
    Object.keys(YAKU_MOTO).forEach(function (k) {
      if (YAKU_MOTO[k] !== k) ima[YAKU_MOTO[k]] = k;
    });
    if (!Object.keys(ima).length) return RAW.yakuRireki;
    return RAW.yakuRireki.map(function (x) {
      return x && Object.prototype.hasOwnProperty.call(ima, x.yaku)
        ? Object.assign({}, x, { yaku: ima[x.yaku] })
        : x;
    });
  }
  function yakuRirekiNo(r) {
    return (RAW.yakuRireki || []).filter(function (x) {
      return x && x.yaku === r;
    });
  }
  // 選んだ 日に 効く 決まり（計算と 同じ 引き方）。空＝最初から＝列の 値（null を 返す）
  function yakuNoHiAtai(r, hi) {
    if (!hi || !Array.isArray(RAW.yakuRireki)) return null;
    try {
      var mine = yakuRirekiNo(yakuMotoNo(r)).map(function (x) {
        return Object.assign({}, x, { yaku: r });
      });
      var c = PayrollDaily.buildCtx({ payrollSettings: SET, yakuRireki: mine });
      if (c.yakuDame.length) return null;
      var st = PayrollDaily.settingsOn(c, hi);
      return (st && st.roles && st.roles[r]) || null;
    } catch (_) {
      return null;
    }
  }
  function yakuHiNoChui(r) {
    var h = '';
    var ex = (SET && SET.pay_extra && SET.pay_extra.roles && SET.pay_extra.roles[r]) || null;
    if (ex && Array.isArray(ex.dankai) && ex.dankai.length)
      h += '<div class="th-sub">段階歩合が 在る 日は 段階の 率が 勝ちます</div>';
    if (yakuHi(r)) return h;
    var l = yakuRirekiNo(r)
      .map(function (x) {
        return x.from_date;
      })
      .sort();
    if (!l.length) return h;
    return (
      h + '<div class="th-sub">空（最初から）＝' + esc(l[0]) + ' より 前の 日だけに 効きます</div>'
    );
  }
  // 決まり（今 画面に 在る 役割の 読み込んだ 時の 名前）に 無い 役割の 記録
  function yakuNokoriNo(st) {
    var aru = {};
    Object.keys(st.roles).forEach(function (r) {
      aru[yakuMotoNo(r)] = true;
    });
    var out = [];
    (RAW.yakuRireki || []).forEach(function (x) {
      if (x && !aru[x.yaku] && out.indexOf(x.yaku) < 0) out.push(x.yaku);
    });
    return out;
  }
  function yakuRirekiNoGyou(r, retsu) {
    var l = yakuRirekiNo(r)
      .slice()
      .sort(function (a, b) {
        return a.from_date < b.from_date ? -1 : a.from_date > b.from_date ? 1 : 0;
      });
    var h =
      '<tr class="rireki-tr"><td colspan="5"><div class="rireki-waku"><b>' +
      esc(r) +
      (retsu
        ? ' の 変えた 記録</b>（その 日から 次の 記録の 日まで 効く。一番 古い 記録より 前は 最初からの 値＝歩合 ' +
          esc(retsu.rate) +
          '・最低保証 ' +
          esc(retsu.floor) +
          '）'
        : ' の 変えた 記録</b><div class="rolewarn">この 役割は 決まりに ありません。記録が 残っていると 給料は 止まります。消してください。</div>');
    if (!Array.isArray(RAW.yakuRireki))
      return (
        h +
        '<div class="rolewarn">記録を 読めませんでした。開き直してください。</div></div></td></tr>'
      );
    if (!l.length) h += '<div class="th-sub">まだ 記録は ありません。</div>';
    l.forEach(function (x) {
      h +=
        '<div class="rireki-r"><input type="date" data-yk-hi="' +
        esc(x.rireki_id) +
        '" value="' +
        esc(String(x.from_date).slice(0, 10)) +
        '"> から ' +
        esc(YAKU_RIREKI_NA[x.key] || x.key) +
        ' <input class="txt" data-yk-v="' +
        esc(x.rireki_id) +
        '" value="' +
        esc(x.value) +
        '"> <button class="btn ghost" type="button" data-yk-del="' +
        esc(x.rireki_id) +
        '">消す</button></div>';
    });
    return h + '</div></td></tr>';
  }
  function yakuRirekiYomiNaoshi() {
    var y = { tried: 0, failed: 0 };
    return DKSession.softList(
      SESS,
      kaishaDake('dk_yaku_rireki?select=*&order=from_date.asc&limit=100000'),
      y
    ).then(function (rows) {
      RAW.yakuRireki = y.failed > 0 ? null : rows || [];
      recalc();
      renderRoles();
    });
  }
  function yakuRirekiErr(msg, x) {
    if (x && x.r && x.r.status === 409)
      return showErr(
        'その 役割の 同じ 欄に 同じ 日の 記録が もう 在ります。そちらを 直すか 消してください。'
      );
    if (x && x.zero) return showErr(msg + '（書けた 行が ありません。開き直してください）');
    return saveErr(msg, x && x.r);
  }
  function yakuRirekiOwari(msg, flashMsg) {
    return function (x) {
      if (!x.ok) {
        yakuRirekiErr(msg, x);
        return yakuRirekiYomiNaoshi();
      }
      showErr('');
      return yakuRirekiYomiNaoshi().then(function () {
        if (!flashMsg) return;
        var el = Array.prototype.filter.call(
          document.querySelectorAll('[data-yk-saved]'),
          function (e) {
            return e.getAttribute('data-yk-saved') === x.yaku;
          }
        )[0];
        if (el) {
          el.textContent = flashMsg;
          setTimeout(function () {
            el.textContent = '';
          }, 2500);
        } else flash('setSaved', flashMsg);
      });
    };
  }
  // 値の 字（数に 直せない・空は 書かない）
  function yakuRirekiAtai(v) {
    var t = String(v == null ? '' : v).trim();
    if (t === '' || !isFinite(Number(t)) || Number(t) < 0) return null;
    return Number(t);
  }
  // 選んだ 日から この 値（同じ 役割・欄・日の 記録が 在れば 直す・無ければ 足す）
  function saveYakuRireki(r, key, v, hi) {
    var modosu = function (m) {
      showErr(m);
      renderRoles();
    };
    if (!COMPANY) return;
    if (!Array.isArray(RAW.yakuRireki))
      return modosu('役割の 変えた 記録を 読めていないので 保存しません。開き直してください。');
    // ★まだ 倉庫に 無い 役割（足したばかり・名前を 直した 後）は 書かせない★
    if (!SET || SET.yomenai || !SET.company_id || YAKU_YOMI.indexOf(r) < 0 || yakuMotoNo(r) !== r)
      return modosu(
        '「' +
          r +
          '」は まだ 保存していない 役割です。先に「保存する」を 押してから 日付を 入れて 直してください。'
      );
    var atai = yakuRirekiAtai(v);
    if (atai === null) return modosu('半角の 数を 入れてください（0 以上）。何も 書いていません。');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hi)) return modosu('日付を 入れてください。');
    var aru = yakuRirekiNo(r).filter(function (x) {
      return x.key === key && String(x.from_date).slice(0, 10) === hi;
    })[0];
    var p = aru
      ? rirekiKaku('dk_yaku_rireki?rireki_id=eq.' + encodeURIComponent(aru.rireki_id), 'PATCH', {
          value: atai,
        })
      : rirekiKaku('dk_yaku_rireki', 'POST', {
          company_id: COMPANY.company_id,
          yaku: r,
          key: key,
          from_date: hi,
          value: atai,
        });
    return p
      .then(function (x) {
        x.yaku = r;
        return yakuRirekiOwari('保存できませんでした。', hi + ' から 保存しました')(x);
      })
      .catch(function () {
        modosu('保存できませんでした。');
      });
  }
  function yakuRirekiNoBotan() {
    var q = function (sel, fn) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), fn);
    };
    q('[data-yh]', function (i) {
      i.onchange = function () {
        hiHiGawari();
        YAKU_HI[i.getAttribute('data-yh')] = i.value || '';
        hiOboeKaku('yaku', i.getAttribute('data-yh'), i.value || '');
        renderRoles();
      };
    });
    q('[data-yrk]', function (b) {
      b.onclick = function () {
        var r = b.getAttribute('data-yrk');
        YAKU_RIREKI_HIRAKU[r] = !YAKU_RIREKI_HIRAKU[r];
        renderRoles();
      };
    });
    q('[data-yk-hi]', function (i) {
      i.onchange = function () {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(i.value)) return showErr('日付を 入れてください。');
        rirekiKaku(
          'dk_yaku_rireki?rireki_id=eq.' + encodeURIComponent(i.getAttribute('data-yk-hi')),
          'PATCH',
          { from_date: i.value }
        )
          .then(yakuRirekiOwari('日付を 直せませんでした。', '日付を 直しました'))
          .catch(function () {
            showErr('日付を 直せませんでした。');
          });
      };
    });
    q('[data-yk-v]', function (i) {
      i.onchange = function () {
        var atai = yakuRirekiAtai(i.value);
        if (atai === null) return showErr('数を 入れてください（空に する 時は「消す」）。');
        rirekiKaku(
          'dk_yaku_rireki?rireki_id=eq.' + encodeURIComponent(i.getAttribute('data-yk-v')),
          'PATCH',
          { value: atai }
        )
          .then(yakuRirekiOwari('値を 直せませんでした。', '値を 直しました'))
          .catch(function () {
            showErr('値を 直せませんでした。');
          });
      };
    });
    q('[data-yk-del]', function (b) {
      b.onclick = function () {
        b.disabled = true;
        rirekiKaku(
          'dk_yaku_rireki?rireki_id=eq.' + encodeURIComponent(b.getAttribute('data-yk-del')),
          'DELETE'
        )
          .then(yakuRirekiOwari('記録を 消せませんでした。', '記録を 消しました'))
          .catch(function () {
            b.disabled = false;
            showErr('記録を 消せませんでした。');
          });
      };
    });
  }

  function stageRoles(roles) {
    SET = SET || {};
    SET.roles = roles;
    RAW.payrollSettings = SET;
    recalc();
  }

  $('btnAddRole').onclick = function () {
    // ★変えた 記録を 読めない 時は 足させない★（残った 記録と 同じ 名前を 作れる・対立役 3回目 直3）
    if (!Array.isArray(RAW.yakuRireki))
      return showErr('役割の 変えた 記録を 読めていないので 足せません。開き直してください。');
    var st = PayrollDaily.normSettings(SET, RAW.shimeRireki);
    var i = 1;
    while (
      st.roles['役割' + i] ||
      (RAW.yakuRireki || []).some(function (x) {
        return x && x.yaku === '役割' + i;
      })
    )
      i++;
    st.roles['役割' + i] = { rate: 0.3, floor: 1000 };
    stageRoles(st.roles);
    renderSet();
  };

  // ★下に 貼り付けた「保存する」は ★元の ボタンを 押すだけ★★ 2026-09-04
  //   ★保存の 決まりを 2か所に 書かない★（片方だけ 直って 食い違うのを 防ぐ）
  (function () {
    var b2 = document.getElementById('btnSaveSet2');
    if (!b2) return;
    b2.onclick = function () {
      var b = document.getElementById('btnSaveSet');
      if (b && b.onclick) b.onclick();
    };
  })();

  // 空（最初から）で 払い方を 変える 保存の 1回目に 止めた 形（同じ 形で もう 一度 押すと 保存）
  var KARA_KAKUNIN = null;
  // 欄の 形が 今の 最初からの 形（列）と 同じか（同じなら 過去の 月は 変わらない）
  function karaOnaji(rawKata) {
    // ★今の 最初からの 形は 計算と 同じ yomu で 引く★（設定の 行が 無い 会社＝計算は 月3回・shimeRetsuKata は null を 返して
    //   何も 変えて いないのに 止めた＝対立役 2回目 止A）。読めない（yomenai）は yomu が dame で 返す＝止める 側
    if (SET && SET.yomenai) return false;
    var y = PayrollPeriod.yomu(SET);
    if (!y || !y.ok) return false;
    var ima = y.kata;
    var a = PayrollPeriod.seiki(rawKata || { kind: 'tsuki', hi: [10, 20, 0] });
    // ★列の 月3回は yomu が {kind: thirds} で 返す＝seiki に 通すと 読めない（tplImaKata と 同じ 扱い・対立役 止1）
    var b = ima.kind === 'thirds' ? { ok: true, kata: ima } : PayrollPeriod.seiki(ima);
    return !!(a.ok && b.ok && tplOnaji(a.kata, b.kata));
  }
  $('btnSaveSet').onclick = function () {
    if (!COMPANY) return;
    // ★設定を 読めなかった（通信）時は 保存しない★ 2026-10-07（既定の 値で 本物の 行を 上書きしない・対立役 ②）
    if (SET && SET.yomenai)
      return showErr('給料の 設定を 読めていないので 保存しません。もう一度 開いてください。');
    var st = PayrollDaily.normSettings(SET, RAW.shimeRireki);
    // ★締めの 変えた 記録を 読めて いない 時は 保存しない★ 2026-10-19（列だけ 直すと 記録との 食い違いが 見えない）
    if (!Array.isArray(RAW.shimeRireki))
      return showErr('締めの 変えた 記録を 読めていないので 保存しません。開き直してください。');
    if (hiHiGawariTomeru()) return;
    var shHi = shimeHi();
    if (shHi && !/^\d{4}-\d{2}-\d{2}$/.test(shHi))
      return showErr('何日からの 日付を 入れてください。');
    var shKaku = !!shHi && SHIME_SAWATTA; // ★日付が 在って 欄を 触った 時だけ 記録を 書く★
    // ★最初からの 形（列）が 読めない 時は 記録を 書いても 止まった まま★＝空で 直して もらう（対立役 2回目 直4）
    if (shHi && !shimeRetsuKata())
      return showErr(
        '最初からの 払い方が 読めないので、何日からの 記録では 直せません。「何日から」を 空にして 払い方を 選び直し、保存してください。'
      );
    // ★★締めの 形を 確かめてから 保存★★ 2026-10-07（壊れた 形・何月分 無しは 保存しない）
    var sk = shimeKataYomu();
    if (sk.dame) return showErr(sk.dame);
    if (sk.kata) {
      var chk = PayrollPeriod.seiki(sk.kata);
      if (!chk.ok) return showErr('払い方を 保存できません：' + chk.riyuu);
    }
    // ★★「何日から」が 空で 払い方が 変わる 時は 1回 止めて 知らせる★★ 2026-10-24（司さん「おけ」）
    //   空＝最初から＝過去の 月の 区切りも 変わる（記録が 無い 会社は 全部の 月）。前は 何も 言わずに 書き換えた（対立役 B）
    //   もう 一度「保存する」を 押せば 保存（同じ 払い方の まま の 時だけ・払い方を 変えたら また 止める）
    if (!shHi && !karaOnaji(sk.kata)) {
      var kagi = JSON.stringify(sk.kata || 'thirds');
      if (KARA_KAKUNIN !== kagi) {
        KARA_KAKUNIN = kagi;
        var mae =
          Array.isArray(RAW.shimeRireki) && RAW.shimeRireki.length
            ? RAW.shimeRireki
                .map(function (x) {
                  return String(x.from_date).slice(0, 10);
                })
                .sort()[0] + ' より 前の 日'
            : '今までの 全部の 月';
        return showErr(
          '「何日から」が 空です＝' +
            mae +
            'の 払い方が 変わります（給料の 区切りも 変わります）。よければ もう一度「保存する」を 押してください。今日から 変える 時は「何日から」に 日付を 入れてください。'
        );
      }
    }
    KARA_KAKUNIN = null;
    var body = {
      company_id: COMPANY.company_id,
      pool_mode: $('poolMode').value,
      deduct_reserve_before_rate: $('resFirst').checked,
      reserve_pool_rate: num($('resPool').value) / 100,
      reserve_owner_rate: num($('resOwner').value) / 100,
      // ★昔の 列は 今の 値を そのまま 運ぶ★（月3回 以外は 'shime'＝新しい 版は period_shime を 読む）
      period_start_day: st.periodStartDay,
      //   ★日付が 在る 時は 列の 締めを 読んだ 値の まま 運ぶ★（その 日からは 記録・何日から 2026-10-19）
      period_end_mode: shHi
        ? (SET && SET.period_end_mode) || 'thirds'
        : sk.kata
          ? 'shime'
          : 'thirds',
      period_days: st.periodDays,
      // ★月3回に 戻す 時は null を はっきり 書く★（書かないと 古い 締めが 勝ち続ける・対立役 J）
      period_shime: shHi ? (SET && SET.period_shime) || null : sk.kata,
      owner_device_id: $('ownerDev').value || '',
      show_car_sales: $('showCarSales').checked, // ★車ごとの売上を載せるか★ 2026-08-25
      roles: st.roles,
      // ★ほかの 払い方★ 2026-10-06（空なら 使わない）。欄が 無い 時は 今の 値を その まま 運ぶ（消さない）
      pay_extra: hokaYomu(),
      updated_at: new Date().toISOString(),
    };
    // ★保存中は 押せない★ 2026-10-17（二度 押すと 2回目の 名前の 直しが「見つからない」で 赤く 出た・対立役）
    var hozonBtn = [$('btnSaveSet'), document.getElementById('btnSaveSet2')].filter(Boolean);
    if (
      hozonBtn.some(function (b) {
        return b.disabled;
      })
    )
      return;
    hozonBtn.forEach(function (b) {
      b.disabled = true;
    });
    var hozonOwari = function () {
      hozonBtn.forEach(function (b) {
        b.disabled = false;
      });
    };
    // ★役割の 名前を 直した 時は 先に 倉庫で 決まり・日給/段階歩合・人の 役割を 一緒に 直す★ 2026-10-17
    //   （1つの 取引。ここで 断られたら 設定も 保存しない＝名前だけ 変わって 人が 取り残されない）
    var yMap = yakuMap();
    // ★★保存の 前に「他の 画面で 設定が 変わって いないか」を 倉庫で 確かめる★★ 2026-10-17（対立役 S1）
    //   この 保存は 決まり（roles）を 丸ごと 上書きする。開いた 後に 別の 画面が 役割の 名前を 直していたら、
    //   古い 名前に 戻し、人だけ 新しい 名前で 取り残す（歩合0・保証0）。変わって いたら 止めて 開き直して もらう
    var kawariMae = DKSession.rest(
      SESS,
      kaishaDake('dk_payroll_settings?select=updated_at&limit=1')
    )
      .then(function (r) {
        if (r && (r.status === 401 || r.status === 403))
          throw new Error('ログインが 切れました。ログインし直してから 保存してください。');
        if (!r || !r.ok) throw new Error('yomenai');
        return r.json();
      })
      .then(function (rows) {
        if (!Array.isArray(rows)) throw new Error('yomenai');
        var mae = tokiMs(SET && SET.updated_at);
        var ima = tokiMs(rows[0] && rows[0].updated_at);
        if (mae !== ima)
          throw new Error(
            '給料の 設定が 他の 画面で 変わりました。上書き しない 様に 止めました。画面を 開き直してから もう一度 直してください。'
          );
      })
      .catch(function (e) {
        throw new Error(
          e && e.message && e.message !== 'yomenai'
            ? e.message
            : '給料の 設定を 確かめられませんでした（通信）。保存していません。もう一度 押してください。'
        );
      });
    // ★月が 空く 締めの 変え方は 保存しない★（設定も 書かない・2026-10-19 月が 空く 件）
    kawariMae = kawariMae
      .then(function () {
        return shimeAkiMon(shHi, shKaku, sk.kata);
      })
      .then(function (aki) {
        if (aki) throw new Error(aki);
      });
    var yakuMae = function () {
      if (!Object.keys(yMap).length) return Promise.resolve(null);
      // ★変えた 記録を 読めていない 時は 直さない★（記録の 役割の 名前を 一緒に 直せない・10-18）
      if (!Array.isArray(RAW.rireki) || !Array.isArray(RAW.yakuRireki))
        return Promise.reject(
          new Error(
            '変えた 記録を 読めていないので 役割の 名前を 直せません。開き直してください。設定も 保存していません。'
          )
        );
      return DKSession.rest(SESS, 'rpc/dk_yaku_namae_naoshi', {
        method: 'POST',
        body: JSON.stringify({ p_company_id: COMPANY.company_id, p_map: yMap }),
      }).then(function (r) {
        return r
          .json()
          .catch(function () {
            return null;
          })
          .then(function (j) {
            if (!r.ok || !j || j.ok !== true) {
              var w =
                (j && YAKU_NAOSHI_WAKE[j.reason]) ||
                (r.status === 401 || r.status === 403
                  ? 'ログインが 切れました。ログインし直してください'
                  : r.status === 404
                    ? '倉庫に 名前を 直す 仕組みが まだ ありません'
                    : '倉庫に 届きませんでした');
              throw new Error(
                '役割の 名前を 直せませんでした（' + w + '）。設定も 保存していません。'
              );
            }
            // 倉庫は もう 直った＝控えを 今の 名前から 始め直し、手元の 人の 役割も 揃える
            (RAW.employees || []).forEach(function (e) {
              if (e && Object.prototype.hasOwnProperty.call(yMap, e.role || ''))
                e.role = yMap[e.role];
            });
            YAKU_MOTO = {};
            YAKU_YOMI = Object.keys(st.roles);
            // 倉庫が 書いた 時刻に 揃える（upsert が 落ちた 後の 次の 保存で 自分を 止めない）
            if (SET && j.updated_at) SET.updated_at = j.updated_at;
            // ★役割の 記録の 名前も 直す★（何日から・10-18 対立役 止2）
            //   ★直しきれなくても 設定の 保存は 続ける★（名前は もう 倉庫で 直った＝同じ 押しの 歩合等を 黙って 捨てない・10-18 対立役 止A）
            //   落ちた 時も 読み直す（手元に 古い 名前を 残さない）
            return rirekiNoYakuNaoshi(yMap).then(function (ok) {
              if (!ok)
                yakuRirekiChui =
                  '役割の 名前と 設定は 保存しましたが、変えた 記録の 役割の 名前を 直しきれませんでした。今すぐ 従業員の「記録」で 直してください（直すまで、その 日から 後の 給料は 止まるか、名前を 入れ替えた 時は 前の 役割の 決まりで 出ます）。';
              // 役割の 決まりの 記録は 倉庫の 関数が 同じ 取引で 直した＝読み直す
              return Promise.all([rirekiYomiNaoshi(), yakuRirekiYomiNaoshi()]).then(function () {
                return j;
              });
            });
          });
      });
    };
    var yakuRirekiChui = '';
    kawariMae
      .then(yakuMae)
      .then(
        function () {
          return upsert('dk_payroll_settings', 'company_id', body);
        },
        function (e) {
          showErr(e && e.message ? e.message : '役割の 名前を 直せませんでした。');
          return null;
        }
      )
      .then(function (r) {
        if (r === null) return;
        if (!r.ok) return saveErr('給料の設定を保存できませんでした。', r);
        showErr(yakuRirekiChui);
        SET = body;
        RAW.payrollSettings = SET;
        YAKU_MOTO = {};
        YAKU_YOMI = Object.keys(st.roles);
        flash('setSaved', '保存しました');
        // ★下に 貼り付けた 側にも 同じ 合図を 出す★ 2026-09-04
        //   （下のボタンから 押した時に ★何も 起きていない様に 見える★のを 防ぐ）
        if (document.getElementById('setSaved2')) flash('setSaved2', '保存しました');
        if (!shKaku) {
          SHIME_SAWATTA = false; // 保存できた＝欄は 倉庫の 形
          loadPeriod(); // 期間が変わることがあるので読み直す
          return;
        }
        // ★締めの 記録（何日から）は 設定を 保存 できた 後に 書く★
        return shimeKirokuKaku(shHi, sk.kata)
          .catch(function () {
            return '倉庫に 届きませんでした';
          })
          .then(function (wake) {
            if (!wake) SHIME_SAWATTA = false; // 書けた＝読み直しで 欄を 倉庫の 形へ
            // ★訳は 読み直し（loadPeriod が 字を 消す）の 後に 出す★
            return shimeRirekiYomiNaoshi(!!wake).then(function () {
              // ★書く 直前の 比べ直しで 空く 月＝押し直しでは 通らない＝日を 選び直して もらう★（対立役 本番前2 小1）
              if (wake && wake.aki)
                showErr(
                  wake.aki +
                    '締めの 払い方は 保存していません（他は 保存しました）。変える 日か 何月分の 呼び方を 選び直してください。'
                );
              else if (wake)
                showErr(
                  '締めの 払い方は 保存できませんでした（' +
                    wake +
                    '）。他は 保存しました。もう一度「保存する」を 押してください。'
                );
            });
          });
      })
      .catch(function () {
        showErr('給料の設定を保存できませんでした。');
      })
      .then(hozonOwari);
  };
})();
