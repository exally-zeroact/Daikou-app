  // ★★作り直す（新しい リンク・QR）★★ 2026-10-24 押し口の 中から 切り出した（明細の 見せる 窓と 退職者の 札の 2か所から 呼ぶ）
  //   中身は 前と 同じ＝返りの token・初回コードで すぐ 控えを 差し替える／走って いる 取り直しの 古い 返りは 捨てる
  //   ★同じ 人の 作り直しを 2本 走らせない★（二度押しで 後から 着いた 古い 返りが 新しい token を 上書き しない・対立役 N5）
  var HAIFU_SAI = {};
  function haifuSaihakkou(sai, t) {
    if (HAIFU_SAI[sai]) return Promise.resolve(false);
    HAIFU_SAI[sai] = true;
    if (t) t.disabled = true;
    haifuErr('');
    return DKSession.rest(SESS, 'rpc/dk_kyuryo_saihakkou', {
      method: 'POST',
      body: JSON.stringify({ p_employee_id: sai }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        HAIFU_SAI[sai] = false;
        if (t) t.disabled = false;
        if (!j || j.ok !== true) {
          // 倉庫の 内側の 名前を そのまま 出さない（10-17 対立役 K2。辞めた 人も 作り直せる 様に なったので taishoku は 来ない）
          haifuErr(
            j && j.reason === 'not_yours'
              ? 'この 会社の 人では ないので 作り直せません。開き直してください。'
              : '作り直せませんでした（' + ((j && j.reason) || '理由不明') + '）。'
          );
          return false;
        }
        // 走って いる 取り直しの 古い 返りは 捨てる（対立役 本番前 N5）
        HAIFU_BAN[sai] = (HAIFU_BAN[sai] || 0) + 1;
        // ★作り直すと token も 替わる★ 2026-10-20＝返りの token・初回コードで すぐ 控えを 差し替える
        //   （1人ぶんの 取り直しが 落ちても、古い 死んだ リンクを 黙って 送らない・対立役 小）
        for (var hi = 0; hi < HAIFU.length; hi++) {
          if (String(HAIFU[hi].employee_id) === String(sai)) {
            HAIFU[hi] = Object.assign({}, HAIFU[hi], {
              token: j.token,
              init_code: j.init_code,
              pw_ari: false,
              tomatta: false,
            });
          }
        }
        renderHaifu();
        haifuMadoNaoshi(sai);
        // ★作り直した後の 札を 出し直す★（その人だけ）
        return Promise.resolve(haifuHitori(sai)).then(function () {
          haifuMadoNaoshi(sai);
          return true;
        });
      })
      .catch(function () {
        HAIFU_SAI[sai] = false;
        if (t) t.disabled = false;
        haifuErr('作り直せませんでした（通信）。');
        return false;
      });
  }
  // 見せる 窓が その 人の 物で 開いて いれば 新しい token で 描き直す（閉じて いれば 開かない・対立役 N5）
  function haifuMadoNaoshi(eid) {
    var md = document.getElementById('haifuMise');
    if (md && md.getAttribute('data-eid') === String(eid)) haifuMiseru(eid);
  }

  $('btnLogout').onclick = function () {
    DKSession.logout();
  };
