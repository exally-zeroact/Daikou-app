  // ★★「見るだけ」か「決める」か★★ 2026-09-05（司さん）
  //   ★?henshu=1 が 付いている時だけ「従業員」「給料の設定」を 出す★
  //   （会社設定 →「車」「従業員」チップから 来ると 付いています）
  //   ★本人モード（?t=）では 元から 出ません★（別の 守りで 隠しています）
  (function kimeruDake() {
    var h = false;
    try {
      h = new URLSearchParams(location.search).get('henshu') === '1';
    } catch (_) {
      h = false;
    }
    if (h) {
      // ★どの タブで 開くか★（会社設定の チップが #set / #emp を 付けて 来る）
      var doko = (location.hash || '').replace('#', '');
      // ★★#kuruma＝車だけ★★ 2026-10-16（司さん「車の決めるとこに なんで 関係ないものが あるんど」）
      //   前は 車の チップが「給料の 設定」を まるごと 開き、役割・売上の 分け方・明細の 期間・配る が 並んでいた。
      //   ⇒ 車の 箱（と 保存）だけ 出す。他は 給料の 画面の「給料の 設定」の タブに 今までどおり 在る
      var kurumaDake = doko === 'kuruma';
      if (kurumaDake) doko = 'set';
      if (doko === 'set' || doko === 'emp') {
        var b2 = document.querySelector('.tab[data-tab="' + doko + '"]');
        if (kurumaDake) {
          var ps = document.getElementById('paneSet');
          if (ps) ps.classList.add('kuruma-dake');
          // ★「載せる」の 印も 変えたら その場で 保存★（車ごとの 印・名前と 同じ。保存を 押し忘れて 戻ると
          //   黙って 消えた・保存の 帯は 下の 帯に 覆われて 押せなかった＝対立役）
          //   ★送るのは この 印 だけ★（設定 ぜんぶを 送ると、隠れた 積立・段階の 率が 画面の 丸めで
          //     0.0525→0.053 に 書き換わった＝お金の 決まりが 黙って 変わる・対立役）
          var sc = document.getElementById('showCarSales');
          if (sc) sc.addEventListener('change', noseruDakeHozon);
        }
        if (b2) {
          TAB = doko;
          Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) {
            x.className = 'tab' + (x === b2 ? ' on' : '');
          });
          // ★★入口を 2つに しない★★ 2026-09-06（司さん）
          //   ★司さんの言葉★「従業員と給料の設定がなんで2個もある」
          //   ★私の しくじり★ 会社設定に チップを 足した時、★中身を 移さず リンクで 済ませた★
          //     ⇒ 同じ物への 入口が「会社設定の チップ」と「給料の タブ」で ★2つ★に なった。
          //   ⇒★会社設定から 来た時は タブの 行を 出さない★＝入口は チップ ただ1つ。
          var tabs = document.getElementById('tabs');
          if (tabs) tabs.style.display = 'none';
          // ★★戻る所を 作る★★ 2026-09-06（司さん「全ページで戻るボタンすらない」）
          //   ★会社設定から 来たのに 会社設定へ 帰れませんでした★
          // ★見出しは 出さない★（チップの 列で 光る 物が 見出し・2026-11-04）。箱は 従業員／退職者の 切り替えの 時だけ
          var modoru = document.getElementById('modoruSet');
          if (modoru && doko === 'emp') {
            modoru.style.display = '';
            empKiriWoMidashiE();
          }
        }
      }
      return;
    }
    // ★★給料の 画面にも「従業員」「給料の設定」の タブを 出す★★ 2026-10-06
    //   司さん「給料の所に給料設定と従業員設定のボタンも作れや どこで設定するか分からんやろが」
    //   前（09-06）は「2個もある」と 言われて 会社設定の チップ 1つに 絞り、ここでは 隠していた。
    //   ⇒ 今は 出す（会社設定の チップも 同じ 画面を 開く＝中身は 1つ）。
    //   ★本人の 画面（?t=）には 出ない★＝honninStart が 白名簿で タブの 行ごと 隠す。
  })();

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.onclick = function () {
      TAB = b.getAttribute('data-tab');
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) {
        x.className = 'tab' + (x === b ? ' on' : '');
      });
      render();
    };
  });
  // ★車だけの 画面の「載せる」＝この 印 だけを 書く★ 2026-10-16（対立役 S-1・M-b・軽1）
  //   保存している 間は 押せない／書けたら 車の 箱の 中に「保存しました」／書けなければ 印を 戻して 知らせる。
  //   まだ 設定の 行が 無い 会社（1行も 当たらない）は 今までの 保存（既定の 値）で 行を 作る
  function noseruDakeHozon() {
    var sc = document.getElementById('showCarSales');
    if (!sc || !COMPANY) return;
    var ima = sc.checked;
    var modosu = function (msg) {
      sc.checked = !ima;
      showErr(msg);
      flash('carSaved', '保存できませんでした');
    };
    if (SET && SET.yomenai)
      return modosu('給料の 設定を 読めていないので 保存しません。もう一度 開いてください。');
    sc.disabled = true;
    DKSession.rest(
      SESS,
      'dk_payroll_settings?company_id=eq.' + encodeURIComponent(COMPANY.company_id),
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        // 押して すぐ「戻る」でも 切らない（倉庫は 別の 住所＝問い合わせを 挟む 間に 切られた・対立役 S-2）
        keepalive: true,
        body: JSON.stringify({ show_car_sales: ima, updated_at: new Date().toISOString() }),
      }
    )
      .then(function (r) {
        if (!r || !r.ok) throw new Error('保存できない');
        return r.json();
      })
      .then(function (rows) {
        if (!Array.isArray(rows)) throw new Error('返りが 読めない');
        if (rows.length === 0) {
          // 設定の 行が まだ 無い（または 当たらない）＝ここでは 作らない（全部の 保存へ 倒すと 隠れた 率が
          //   画面の 丸めで 書き換わり、結果も 待たずに「保存しました」と 出した・対立役 S-A）
          modosu(
            'まだ 給料の 設定が 保存されていません。給料の 画面の「給料の 設定」で 一度 保存してから 選んでください。'
          );
          return;
        }
        showErr('');
        if (SET) SET.show_car_sales = ima;
        // 倉庫の 更新の 時刻も 手元に 揃える（給料の 設定の 保存の 前の「他の 画面で 変わったか」の 比べに 使う）
        if (SET && rows[0] && rows[0].updated_at) SET.updated_at = rows[0].updated_at;
        RAW.payrollSettings = SET;
        flash('carSaved', '保存しました');
        recalc();
      })
      .catch(function () {
        modosu(
          '「給料明細に 車ごとの売上を 載せる」を 保存できませんでした。通信を 確かめて もう一度 押してください。'
        );
      })
      .then(function () {
        sc.disabled = false;
      });
  }
  // ★「人ごとに 変えたい」から 従業員タブへ 1押しで 飛ぶ★ 2026-09-03（司さん）
  //   ★探し回らせない為★＝設定が 2つのタブに 分かれているのを 埋める。
  //   ★タブの押し方は 上と 同じ物を 使う★（決まりを 2か所に 書かない）
  (function () {
    var b = document.getElementById('toEmpTab');
    if (!b) return;
    b.onclick = function () {
      // 会社設定から 来た 時（チップの 列が 在る）は チップ「従業員」と 同じ 道（保存を 待って 移る・2026-11-04）
      if (document.getElementById('dkChipRow') && window.DKChipNi) {
        window.DKChipNi('hito');
        return;
      }
      var t = document.querySelector('.tab[data-tab="emp"]');
      if (t && t.onclick) t.onclick();
    };
  })();

  // ---------- 通信の共通 ----------
  // ★1つ失敗しても画面を殺さない★（表がまだ無くても他は出す）
  // ★2026-08-09: 取れなかったことを 数える★
  //   旧: 通信が失敗しても 黙って空配列 → 画面には 0 と出ていた。
  //       ＝「本当に0」と「取れなかった」が見分けられない。
  //   新: 空は返す（落ちないため）が ★失敗は必ず数える★。
  //       数えた結果は画面の上に出し、数字は「—」にする。
  var LOAD = DKSession.newLoadState();
