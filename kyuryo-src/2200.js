  // ★★1人ぶんだけ 配る★★ 2026-09-04（司さん「従業員毎に 配るんやないんか」）
  //   ★渡していない 人の 鍵まで 作らない★（鍵は 渡す 相手 1人にだけ）
  //   ★もう 在る人は そのまま★（作り直しでは ない＝押しても 壊れない）
  // ★取り直しの 番号★ 2026-10-20（後から 着いた 古い 返りで 新しい token を 上書きしない・対立役 本番前 N5）
  var HAIFU_BAN = {};
  //   damatte＝画面に 戻った 時の 取り直し（赤字を 出さない・ボタンも 触らない・対立役 本番前 N3）
  //   返り：true＝取れた／false＝取れなかった（見せる 側が 訳を 出す・対立役 本番前 N4）
  function haifuHitori(eid, damatte) {
    var ban = (HAIFU_BAN[eid] = (HAIFU_BAN[eid] || 0) + 1);
    if (!damatte) haifuErr('');
    var b = damatte ? null : document.querySelector('[data-hhito="' + eid + '"]');
    if (b) {
      b.disabled = true;
      b.textContent = '用意中…';
    }
    return DKSession.rest(SESS, 'rpc/dk_kyuryo_haifu_hitori', {
      method: 'POST',
      body: JSON.stringify({ p_employee_id: eid }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (b) {
          b.disabled = false;
          b.textContent = '配る';
        }
        if (HAIFU_BAN[eid] !== ban) return 'atarashii'; // もっと 新しい 取り直し か 作り直しが 在る（落ちたのでは ない）
        if (!j || j.ok !== true) {
          // ★出来なかった事を 0件で 隠さない★（「0人 配った」に 見せない）
          if (!damatte)
            haifuErr(
              '配れませんでした（' +
                ((j && j.reason) || '理由不明') +
                '）。もう一度 お試しください。'
            );
          return false;
        }
        // ★その人ぶんだけ 差し替える★（他の 人は 触らない）
        var h = j.hito;
        if (h && h.employee_id) {
          var atta = false;
          for (var i = 0; i < HAIFU.length; i++) {
            if (String(HAIFU[i].employee_id) === String(h.employee_id)) {
              HAIFU[i] = h;
              atta = true;
            }
          }
          if (!atta) HAIFU.push(h);
        }
        renderHaifu();
        return true;
      })
      .catch(function () {
        if (b) {
          b.disabled = false;
          b.textContent = '配る';
        }
        if (!damatte) haifuErr('配れませんでした（通信）。もう一度 お試しください。');
        return false;
      });
  }
  // ★見せる 前に 取り直してから 大きく 見せる★ 2026-10-20（別の 端末で 作り直すと token が 替わる・対立役 本番前 直2・N1・N4）
  //   取れなかった 時は 前の 控えで 見せるが、窓の 中に その 事を 出す（黙って 古い QR を 見せない）
  function haifuMiseruAtarashiku(eid) {
    return haifuHitori(eid).then(function (toreta) {
      haifuMiseru(eid);
      // 'atarashii'＝別の 取り直しが 先に 走って いた（落ちたのでは ない＝警告を 出さない・対立役 本番前 D5）
      if (toreta) return;
      var m = document.getElementById('haifuMiseQr');
      if (m && m.parentNode) {
        var n = document.createElement('div');
        n.className = 'rolewarn';
        n.id = 'haifuMiseFurui';
        n.textContent =
          'この QR が 新しいか 確かめられませんでした。別の 画面で 作り直して いれば 使えません。';
        m.parentNode.insertBefore(n, m);
      }
    });
  }

  // ★配る 札の 押し口★（2026-10-24 までは 給料の 設定の 配る 一覧の onclick＝一覧を 外したので 名前を 付けて 退職者の 札から 呼ぶ）
  function haifuOshi(ev) {
    var t = ev.target;
    if (!t) return;
    var mi = t.getAttribute && t.getAttribute('data-hmise');
    if (mi) {
      // ★見せる 前に その人を 取り直す★ 2026-10-20（別の 端末で 作り直すと token が 替わる＝古い QR を 見せない・対立役 本番前 直2）
      //   取り直しが 落ちても 前の 控えで 見せる（前と 同じ）
      haifuMiseruAtarashiku(mi);
      return;
    }
    var hh = t.getAttribute && t.getAttribute('data-hhito');
    if (hh) {
      haifuHitori(hh);
      return;
    }
    var ok = t.getAttribute && t.getAttribute('data-hokuru');
    if (ok) {
      // ★中身は haifuOkuru 1か所★（明細からも 同じ 物を 使う）
      haifuOkuru(haifuHito(ok), t);
      return;
    }
    var sai = t.getAttribute && t.getAttribute('data-hsai');
    if (sai) haifuSaihakkou(sai, t);
  }
