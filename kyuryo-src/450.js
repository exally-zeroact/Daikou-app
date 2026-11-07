  // ★★「何日から」で 選んだ 日を 画面を 行き来しても 残す★★ 2026-10-25
  //   司さん「何日からってのを2026/10/1に設定したのに画面変えて入力からやるとまた2026/10/25にもどってる
  //   他の所もこうゆうのがないか確認して直せ」＝人（EMP_HI）・締め（SHIME_HI）・役割の 決まり（YAKU_HI）の 3か所。
  //   前は 画面の 中の 覚え だけ＝開き直すと 既定の「今日」に 戻った。
  //   ★残すのは その 日の うち だけ★（日が 変われば 今日に 戻す＝何週間も 前の 日付が 残って 気付かずに 過去の 月を
  //   書き換えない 為）。会社ごと・この 端末だけ（localStorage・読めない 端末では 今まで 通り 今日）
  function hiOboeKagi(kind) {
    return 'dk-hi-oboe:' + ((COMPANY && COMPANY.company_id) || '') + ':' + kind;
  }
  function hiOboeYomu(kind) {
    try {
      var o = JSON.parse(window.localStorage.getItem(hiOboeKagi(kind)) || 'null');
      return o && o.kyou === kyouJst() && o.m && typeof o.m === 'object' ? o.m : {};
    } catch (_) {
      return {};
    }
  }
  // 返り＝覚えた 日（'YYYY-MM-DD' か ''＝最初から）・覚えて いなければ null
  function hiOboeHiku(kind, key) {
    var m = hiOboeYomu(kind);
    if (!Object.prototype.hasOwnProperty.call(m, key)) return null;
    var v = m[key];
    return v === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null;
  }
  // ★窓に 固めた 日の 寿命も その 日 だけ★（開いた ままの 窓で 何日も 経つと、誰も 選んで いないのに
  //   開いた 日から 書いて 過去の 明細を 変えた・対立役 本番前 2回目 S2）
  //   固めた 日（HI_KOTEI_KYOU）と 今日が 違えば 固めを 全部 捨てる＝覚えも 切れて いるので 今日に 戻る
  var HI_KOTEI_KYOU = null;
  // ★日の 変わりは 保存の 前の 守りが 知らせる まで 残す★（読み出し（empHi・shimeHi・yakuHi）や 日を 選んだ 時に
  //   先に 捨てると、保存の 前の 守りが「変わって いない」と 見て 選んだ 日を 黙って 今日に 替えて 書いた・対立役 本番前 3回目 S4）
  var HI_GAWARI_MADA = false;
  function hiHiGawari() {
    var kyou = kyouJst();
    if (HI_KOTEI_KYOU === null) {
      HI_KOTEI_KYOU = kyou;
      return false;
    }
    if (HI_KOTEI_KYOU === kyou) return false;
    EMP_HI = {};
    YAKU_HI = {};
    SHIME_HI = null;
    HI_KOTEI_KYOU = kyou;
    HI_GAWARI_MADA = true;
    return true;
  }
  // 保存の 前に 呼ぶ：日が 変わって いたら 保存せず「何日から」を 今日に 戻して 描き直し 知らせる（画面の 日＝書く 日を 守る）
  function hiHiGawariTomeru() {
    hiHiGawari();
    if (!HI_GAWARI_MADA) return false;
    HI_GAWARI_MADA = false;
    try {
      renderEmp();
    } catch (_) {
      /* 従業員の 表が まだ 無い */
    }
    try {
      renderRoles();
    } catch (_) {
      /* 役割の 表が まだ 無い */
    }
    if ($('pHi')) $('pHi').value = shimeHi();
    showErr(
      // ★字は「保存を 止めた」だけ 言い切る★（日の 変わりの 後に 客が 選び直した 欄は 今日に 戻らない＝「戻しました」は 嘘に なる・対立役 4回目 任2）
      '日付が 変わったので 保存を 止めました。「何日から」の 日付を 確かめて もう一度 入れてください（保存は していません）。'
    );
    return true;
  }
  function hiOboeKaku(kind, key, v) {
    try {
      var m = hiOboeYomu(kind);
      if (v === null || v === undefined) delete m[key];
      else m[key] = v;
      window.localStorage.setItem(hiOboeKagi(kind), JSON.stringify({ kyou: kyouJst(), m: m }));
    } catch (_) {
      /* 覚えられない 端末＝今まで 通り（画面の 中だけ） */
    }
  }
  // 退職・復職を 書く（返った 行が 1件で、active が 送った 値の 時だけ 画面を 移す＝0行の 黙りを 防ぐ）
  //   ★書けた かを true/false で 返す★（押した ボタンを 戻す 為・10-17 対立役 N2＝失敗の 後も 灰色の まま 押せなかった）
  //   ★訳を 分けて 出す★（10-17 対立役 N1＝倉庫が 断っても 0行でも いつも「通信を 確かめて」だった）
  //     倉庫が 断った＝倉庫の 言い分（saveErr）／0行＝書けた 行が 無い／届かない＝通信
  function empTaishoku(id, active, hi) {
    var nani = active ? '復職' : '退職';
    var body = {
      active: active,
      retired_on: active ? null : hi,
      updated_at: new Date().toISOString(),
    };
    return DKSession.rest(SESS, 'dk_employees?employee_id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    })
      .then(
        function (r) {
          if (!r || !r.ok) {
            saveErr(nani + 'に できませんでした。', r);
            return null;
          }
          return r.json();
        },
        function () {
          showErr(nani + 'に できませんでした。通信を 確かめて もう一度 押してください。');
          return null;
        }
      )
      .then(function (rows) {
        if (rows === null) return false;
        if (!Array.isArray(rows) || rows.length !== 1 || rows[0].active !== active) {
          showErr(
            nani +
              'に できませんでした。倉庫に 書けた 行が ありません（' +
              (Array.isArray(rows) ? rows.length : '?') +
              '行）。会社が 合っているか 確かめて、開き直してください。'
          );
          return false;
        }
        showErr('');
        var hiDake = false; // 辞めた 人の 日付だけを 直した
        RAW.employees.forEach(function (e) {
          if (e.employee_id === id) {
            hiDake = !active && e.active === false;
            e.active = active;
            e.retired_on = body.retired_on;
          }
        });
        recalc();
        renderEmp();
        // 配る 一覧も 描き直す（前は 開き直すまで 辞めた 人の「配る・作り直す」が 残った・対立役）
        if (!HONNIN) renderHaifu();
        flash(
          'empSaved',
          active ? '復職しました' : hiDake ? '辞めた日を直しました' : '退職にしました'
        );
        return true;
      })
      .catch(function () {
        showErr(nani + 'に できませんでした。通信を 確かめて もう一度 押してください。');
        return false;
      });
  }
  function renderYame() {
    var yame = RAW.employees
      .filter(function (e) {
        return e.active === false;
      })
      .sort(function (a, b) {
        return String(b.retired_on || '').localeCompare(String(a.retired_on || ''));
      });
    var html = yame
      .map(function (e) {
        return (
          // 辞めた 日は 押すと 直せる（10-17 対立役 N5＝前は 復職して 退職し直すしか 無く、元の 日が 今日に 戻った）
          '<tr><td colspan="7"><div class="yame-hi" role="button" tabindex="0" data-hi-naosu="' +
          esc(e.employee_id) +
          '">' +
          (e.retired_on ? esc(String(e.retired_on).replace(/-/g, '/')) : '日付なし') +
          '</div><div class="yame-na"><span>' +
          esc(e.name) +
          '</span><button class="btn ghost" type="button" data-fukushoku="' +
          esc(e.employee_id) +
          '">復職</button>' +
          // ★配る（QR・送る・作り直す）★ 2026-10-17 司さん「退職者のページからでもURLの配付ができないかん」
          '<button class="btn ghost" type="button" data-yame-haifu="' +
          esc(e.employee_id) +
          '">配る</button>' +
          // ★歩合・役割を 直す★ 2026-10-20 司さん 10-17「辞めた人の歩合等を復職させずに直せる様に」
          '<button class="btn ghost" type="button" data-yame-naosu="' +
          esc(e.employee_id) +
          '" aria-expanded="' +
          (YAME_NAOSU[e.employee_id] ? 'true' : 'false') +
          '">歩合・役割を直す</button></div>' +
          '<div class="yame-haifu" data-yame-box="' +
          esc(e.employee_id) +
          '" style="display:none"></div>' +
          (YAME_NAOSU[e.employee_id] ? yameNaosuRan(e) : '') +
          '</td></tr>' +
          // 記録の 一覧は 行の 隣に（td の 中に tr を 入れない・対立役 壊5）
          (YAME_NAOSU[e.employee_id] && RIREKI_HIRAKU[e.employee_id] ? rirekiNoGyou(e) : '')
        );
      })
      .join('');
    if (!yame.length) html = '<tr><td colspan="7" class="empty">退職者は 居ません。</td></tr>';
    $('empBody').innerHTML = html + roleDatalist();
    // 開いて いた 配る 箱は 描き直しても 開いた まま（対立役 壊1）
    yame.forEach(function (e) {
      if (!YAME_HAIFU[e.employee_id]) return;
      var box = document.querySelector('[data-yame-box="' + e.employee_id + '"]');
      if (!box) return;
      yameHaifuNuru(box, e.employee_id);
      box.style.display = '';
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-yame-naosu]'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-yame-naosu');
        YAME_NAOSU[id] = !YAME_NAOSU[id];
        renderEmp();
      };
    });
    empOshiguchi();
    Array.prototype.forEach.call(document.querySelectorAll('[data-fukushoku]'), function (b) {
      b.onclick = function () {
        b.disabled = true;
        YAME_NAOSU[b.getAttribute('data-fukushoku')] = false; // 復職したら 閉じる（また 退職しても 勝手に 開かない・対立役 2回目）
        empTaishoku(b.getAttribute('data-fukushoku'), true, null).then(function (ok) {
          if (!ok) b.disabled = false;
        });
      };
    });
    // 配る：押すと その人の 配る 札（配る 一覧と 同じ 中身）を 下に 開く。中の ボタンは 配る 一覧の 押し口に 渡す
    Array.prototype.forEach.call(document.querySelectorAll('[data-yame-haifu]'), function (b) {
      b.onclick = function () {
        var eid = b.getAttribute('data-yame-haifu');
        var box = document.querySelector('[data-yame-box="' + eid + '"]');
        if (!box) return;
        if (box.style.display !== 'none') {
          box.style.display = 'none';
          YAME_HAIFU[eid] = false;
          return;
        }
        yameHaifuNuru(box, eid);
        box.style.display = '';
        YAME_HAIFU[eid] = true;
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-hi-naosu]'), function (d) {
      d.onclick = function () {
        if (d.querySelector('input')) return;
        var id = d.getAttribute('data-hi-naosu');
        var e0 = RAW.employees.filter(function (e) {
          return e.employee_id === id;
        })[0];
        d.innerHTML =
          '<label>辞めた日 <input type="date" class="taishoku-hi" max="' +
          kyouJst() +
          '" value="' +
          esc((e0 && e0.retired_on) || kyouJst()) +
          '"></label> <button class="btn" type="button" data-hi-kakutei>直す</button> ' +
          '<button class="btn ghost" type="button" data-hi-yameru>やめる</button>';
        d.querySelector('[data-hi-yameru]').onclick = function (ev) {
          ev.stopPropagation();
          renderYame();
        };
        d.querySelector('[data-hi-kakutei]').onclick = function (ev) {
          ev.stopPropagation();
          var hi = d.querySelector('.taishoku-hi').value;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(hi)) return showErr('辞めた日を 入れてください。');
          if (hi > kyouJst()) return showErr('辞めた日は 今日より 先に できません。');
          var kb = this;
          kb.disabled = true;
          empTaishoku(id, false, hi).then(function (ok) {
            if (!ok) kb.disabled = false;
          });
        };
      };
    });
  }
  // ★退職者ページで 開いて いる 物★（描き直しても 閉じない・対立役 壊1）
  var YAME_NAOSU = {}; // 歩合・役割を 直す 欄
  var YAME_HAIFU = {}; // 配る 箱
  // 辞めた 人の 歩合・役割・最低保証を 直す 欄（今いる人と 同じ 欄・同じ 押し口・復職は しない）
  //   ★何日から の 既定は 今日★（司さん 10-17「今いる人も 辞めた人も 同じ」）
  //   選んだ 日より 後の 分だけに 効く＝前の 分を 直す 時の 日の 選び方を いつも 字で 出す
  //   （辞めた 日で「効きません」とは 言い切らない＝計算は 辞めた 日を 見ない・対立役 止1。
  //    辞めた 日より 後を 選んだ 時に 黙らない・対立役 2回目 C）
  function yameNaosuRan(e0) {
    var hi = empHi(e0.employee_id);
    var md = function (d) {
      return String(d).slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/');
    };
    return (
      '<div class="yame-naosu">' +
      hitoRan(hiNoHito(e0), 'label') +
      '</div>' +
      (hi
        ? '<div class="th-sub yame-naosu-chui">' +
          esc(md(hi)) +
          ' から 後の 分だけに 効きます（前の 分は 前の 値の まま）。' +
          (e0.retired_on && hi > e0.retired_on
            ? '辞めた 日（' +
              esc(md(e0.retired_on)) +
              '）より 後に 働いた 日・手当・控除が 無ければ、明細は 変わりません。'
            : '') +
          '前の 分を 直す 時は「何日から」に 直したい 初めの 日を 選んでください。</div>'
        : '')
    );
  }
  // 退職者ページの 配る 札を 描く（配ってあれば 札・まだなら「配る」）
  function yameHaifuNuru(box, eid) {
    var x = haifuHito(eid);
    box.innerHTML = x
      ? haifuFuda(x)
      : '<div class="card" style="margin:10px 0 0"><div class="note" style="margin:0 0 8px">まだ 配っていません</div>' +
        '<button class="btn chi" type="button" data-hhito="' +
        esc(eid) +
        '">配る</button></div>';
    box.onclick = function (ev) {
      var t = ev.target;
      var hh = t && t.getAttribute && t.getAttribute('data-hhito');
      if (hh) {
        t.disabled = true;
        Promise.resolve(haifuHitori(hh)).then(function () {
          yameHaifuNuru(box, eid);
        });
        return;
      }
      haifuOshi(ev);
    };
  }
  // ★役割・歩合・最低保証・何日から の 欄★ 2026-10-20（今いる人の 行と 退職者ページで 同じ 物を 使う）
  //   kata='td'＝今いる人の 表の 升（名前は data-l＝スマホの 見出し）
  //   kata='label'＝退職者ページ（見出し行が 無いので 欄ごとに 名前を 付ける）
  //   e は 選んだ 日の その 人（hiNoHito）
  function hitoRan(e, kata) {
    function waku(mi, naka) {
      if (kata === 'td') return '<td data-l="' + mi + '">' + naka + '</td>';
      return (
        '<div class="yn-ran"><span class="yn-mi">' + mi + '</span><div>' + naka + '</div></div>'
      );
    }
    return (
      // ★役割は 選んでも 打ってもいい★ 2026-08-25（司さん
      //   「乙の所が 自由に入力してカスタムできるようにしたらええやないか」）
      //   前は select だけ＝「給料の設定」で足すまで 新しい役割を書けなかった。
      //   ★決まりに無い役割は 給料が 黙って0円になる★ ので、その時は赤く知らせる。
      waku(
        '役割',
        '<input class="txt rolein" list="roleList" data-emp="' +
          esc(e.employee_id) +
          '" data-f="role" value="' +
          esc(e.role || '') +
          '" placeholder="役割を打つ／選ぶ">' +
          (function () {
            var w = _roleWarn(e);
            return w ? '<div class="rolewarn">' + w + '</div>' : '';
          })()
      ) +
      // ★人ごとの歩合・最低保証 (2026-08-05・A案)★
      //   空欄＝役割どおり。役割の値を薄く出しておく＝何もしなければどうなるか見える。
      waku(
        '歩合',
        '<input class="hrs" data-emp="' +
          esc(e.employee_id) +
          '" data-f="pay_rate" inputmode="decimal" placeholder="' +
          _roleRateOf(e.role, empHi(e.employee_id)) +
          '" value="' +
          (e.pay_rate === null || e.pay_rate === undefined ? '' : e.pay_rate) +
          '">'
      ) +
      waku(
        '最低保証',
        '<input class="yen" data-emp="' +
          esc(e.employee_id) +
          '" data-f="pay_floor" inputmode="numeric" placeholder="' +
          _roleFloorOf(e.role, empHi(e.employee_id)) +
          '" value="' +
          (e.pay_floor === null || e.pay_floor === undefined ? '' : e.pay_floor) +
          '"> 円'
      ) +
      waku(
        '何日から',
        '<input type="date" class="hi-in" data-hi="' +
          esc(e.employee_id) +
          '" value="' +
          esc(empHi(e.employee_id)) +
          '"> <button class="btn ghost" type="button" data-rireki="' +
          esc(e.employee_id) +
          '">記録 ' +
          rirekiNoHito(e.employee_id).length +
          '</button>' +
          hiNoChui(e)
      )
    );
  }
  // ★打つ時の候補★（決まりが在る役割を出す・打ちたければ そのまま打てる）
  function roleDatalist() {
    return (
      '<datalist id="roleList">' +
      roleNames()
        .map(function (r) {
          return '<option value="' + esc(r) + '"></option>';
        })
        .join('') +
      '</datalist>'
    );
  }
  function renderEmp() {
    var tbl = $('empBody') && $('empBody').closest('table');
    if (tbl) tbl.classList.toggle('yame-miru', EMP_MIRU === 'yame');
    var tasu = document.getElementById('btnAddEmp');
    if (tasu) tasu.style.display = EMP_MIRU === 'yame' ? 'none' : '';
    if (EMP_MIRU === 'yame') return renderYame();
    var html = '';
    RAW.employees.forEach(function (e0) {
      if (e0.active === false) return; // 辞めた 人は「退職者」に 出す
      // ★役割・歩合・最低保証は「何日から」の 日の 値★ 2026-10-18（計算と 同じ PayrollDaily.empOn）
      var e = hiNoHito(e0);
      // data-l は★スマホで1人1枚にした時の見出し★（横スクロールさせないため）
      html +=
        '<tr><td data-l="名前"><input class="txt" data-emp="' +
        esc(e.employee_id) +
        '" data-f="name" value="' +
        esc(e.name) +
        '"></td>' +
        hitoRan(e, 'td') +
        '<td data-l="並び"><input class="hrs" data-emp="' +
        esc(e.employee_id) +
        '" data-f="sort_order" value="' +
        (e.sort_order || 0) +
        '"></td>' +
        // ★その人だけの車 (2026-08-25)★ 何も付けなければ 会社の決まりどおり
        '<td data-l="明細に出す車" class="empcars">' +
        _empCarBoxes(e) +
        '</td>' +
        // ★★退職★★ 2026-10-16（司さん「青丸の所に退職ボタンを作って 従業員のページから消せるように」）＝箱の 右下
        '<td data-l="退職" class="taishoku-ran"><button class="btn ghost" type="button" data-taishoku="' +
        esc(e.employee_id) +
        '">退職</button></td></tr>' +
        (RIREKI_HIRAKU[e.employee_id] ? rirekiNoGyou(e0) : '');
    });
    if (!html) {
      // 全員が 辞めた 時に「まだ誰も」と 出していた（10-17 対立役 K3）
      html = RAW.employees.length
        ? '<tr><td colspan="8" class="empty">今いる人は 居ません（辞めた 人は「退職者」に 居ます）。</td></tr>'
        : '<tr><td colspan="8" class="empty">まだ誰も登録されていません。</td></tr>';
    }
    html += roleDatalist();
    $('empBody').innerHTML = html;
    // 退職：押すと 辞めた 日（既定は 日本時間の 今日・遡って 直せる）と「退職にする」「やめる」を 出す
    Array.prototype.forEach.call(document.querySelectorAll('[data-taishoku]'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-taishoku');
        var td = b.parentNode;
        td.innerHTML =
          // ★先の 日は 選べない★（10-17 対立役 N4＝選んだ 時点で 今いる人から 消え、残りの 日の 時間を 入れられなかった）
          '<label>辞めた日 <input type="date" class="taishoku-hi" max="' +
          kyouJst() +
          '" value="' +
          kyouJst() +
          '"></label> <button class="btn" type="button" data-kakutei>退職にする</button> ' +
          '<button class="btn ghost" type="button" data-yameru>やめる</button>';
        td.querySelector('[data-yameru]').onclick = function () {
          renderEmp();
        };
        td.querySelector('[data-kakutei]').onclick = function () {
          var hi = td.querySelector('.taishoku-hi').value;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(hi)) return showErr('辞めた日を 入れてください。');
          if (hi > kyouJst())
            return showErr(
              '辞めた日は 今日より 先に できません。その日まで 働く 人は、辞めた 後に 押してください。'
            );
          var kb = this;
          kb.disabled = true;
          empTaishoku(id, false, hi).then(function (ok) {
            if (!ok) kb.disabled = false;
          });
        };
      };
    });
    empOshiguchi();
  }
  // ★欄の 押し口★（今いる人の 表と 退職者ページで 同じ 物）2026-10-20
  function empOshiguchi() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-emp]'), function (i) {
      i.onchange = function () {
        var f = i.getAttribute('data-f');
        var v;
        if (f === 'slip_cars') v = _collectEmpCars(i.getAttribute('data-emp'));
        else if (f === 'active') v = i.checked;
        else if (f === 'sort_order') v = num(i.value);
        else if (f === 'pay_rate' || f === 'pay_floor') {
          // ★空欄なら null＝役割どおりに戻す★（0 は「0にしたい」なので通す）
          v = String(i.value).trim() === '' ? null : num(i.value);
        } else v = i.value;
        var id = i.getAttribute('data-emp');
        // ★何日から★ 日付が 在れば 記録に（その 日から 次の 変更まで）・空なら 列（最初から）
        if ((f === 'role' || f === 'pay_rate' || f === 'pay_floor') && hiHiGawariTomeru()) return;
        if ((f === 'role' || f === 'pay_rate' || f === 'pay_floor') && empHi(id))
          return saveRireki(id, f, v, empHi(id));
        saveEmp(id, f, v);
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-hi]'), function (i) {
      i.onchange = function () {
        hiHiGawari();
        EMP_HI[i.getAttribute('data-hi')] = i.value || '';
        hiOboeKaku('emp', i.getAttribute('data-hi'), i.value || '');
        renderEmp();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-rireki]'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-rireki');
        RIREKI_HIRAKU[id] = !RIREKI_HIRAKU[id];
        renderEmp();
      };
    });
    rirekiNoBotan();
  }

