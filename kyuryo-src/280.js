  // ★★移る 前の 門★★ 2026-11-04＝チップと 下の 帯の 両方が 通る（js/jimusho-footer.js）
  //   前は「← 会社設定へ 戻る」だけが 待ち、下の 帯は 待たずに 移った（車の 名前が 黙って 切られ得た・対立役 止1）
  window.DKUtsuruMae = function () {
    return new Promise(function (yoi) {
      kakiOwattekara(
        function () {
          yoi({ ok: true });
        },
        function () {
          yoi({
            ok: false,
            ji: '保存できなかった 物が あるので、画面を 移りませんでした。赤字を 見て 直してから もう一度 押してください。',
          });
        }
      );
    });
  };
  function upsert(table, conflict, body) {
    return DKSession.rest(SESS, table + '?on_conflict=' + conflict, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(body),
    });
  }

  function loadCompany() {
    // ★2026-08-08: 自分の会社だけを、決まった順で取る★
    //   旧: limit=1 ・並び順なしで j[0] を無条件に採用していた。
    //       司さんを dk_admins に入れた結果 11社見えるようになり、
    //       検証ゴミの会社を掴んでいた（給料が保存できない・台数が0）。
    DKSession.myCompanies(SESS, 'company_id,name')
      .then(function (r) {
        // ★自分が誰か分からない時は 会社を一切出さない (2026-08-08)★
        if (r && r.noUid) return 'unknown';
        return r.json();
      })
      .then(function (j) {
        if (!Array.isArray(j) || !j.length) {
          $('sub').textContent = '会社が登録されていません';
          showMsg('先に「会社設定」で会社を登録してください。');
          return;
        }
        if (j === 'unknown') {
          $('sub').textContent = '読み込み中…';
          return;
        }
        // ★黙って先頭を選ばない★（2件以上なら事務所の画面で選んでもらう）
        var picked = DKSession.pickCompany(j, DKSession.rememberedCompanyId());
        if (picked.mode !== 'one') {
          $('sub').textContent = '会社を選んでください';
          showMsg('会社が複数あります。事務所の画面でどの会社を出すか選んでください。');
          return;
        }
        COMPANY = picked.company;
        $('sub').textContent = COMPANY.name || '';
        loadMasters();
      })
      .catch(function () {
        showErr('会社の読み込みに失敗しました。通信を確認してください。');
      });
  }

