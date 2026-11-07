  // ★材料を 取って 明細を 出す（事務所と 同じ 組み立て）★
  // ★★2026-10-01＝本人の 画面を「給料明細 そのもの ＋ 月を 選ぶ」に した★★
  //
  //   ★司さん★
  //     「従業員が見る個人の場所その給料明細だけでえんやろが
  //       月別など選んで見れるようにするのが正解やろが」
  //
  //   ★前は どうだったか★
  //     ・画面用の 一覧（日付と 金額を 縦に 並べた 物）を 出していた
  //     ・月は ★今月だけ★＝先月の 明細が 見られなかった
  //   ★今★
  //     ・★事務所が 印刷/PDF に 使う `_buildPaperSheet` を そのまま 呼ぶ★
  //       ＝紙と 1文字も 同じ。★明細を 2か所に 書かない★
  //     ・★月を 選べる★（◀ ▶）。1つの 月に 期間が 2つ以上 在る 会社は
  //       その 期間も 選べる（締めが 21日 等の 会社）
  //   ★先の 月は 出さない★（まだ 無い 月を 見せても 空の 紙に なるだけ）
  var HN_Y = 0;
  var HN_M = 0;
  var HN_YOMI = ''; // 今 取ってある 月（二重に 取りに 行かない）

  function _honninHaba(y, m) {
    // ★締めが 月を またぐ 会社が 在る★ので 前後 1か月 広く 取る
    var a = new Date(y, m - 2, 1);
    var b = new Date(y, m + 1, 0);
    var f = function (d) {
      return (
        d.getFullYear() +
        '-' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getDate()).padStart(2, '0')
      );
    };
    return { from: f(a), to: f(b) };
  }

  function honninMiru() {
    var now = jstNow();
    HN_Y = now.getFullYear();
    HN_M = now.getMonth() + 1;
    honninTsuki(0);
  }

  // ★月を 動かす（0＝今の まま／-1＝前の月／+1＝次の月）★
  //   haba＝取る 幅（期が いつもの 幅の 外へ 出る 月だけ 広げて 渡す）
  function honninTsuki(zure, haba) {
    clearTimeout(window.__hnT); // ★待っている 描き直しを 捨てる★（前の 月の 紙を 出さない）
    var d = new Date(HN_Y, HN_M - 1 + zure, 1);
    var now = jstNow();
    // ★先の 月へは 行かせない★（締めが 月を またぐ 会社は 今日の 期の 月まで・10-07）
    var sakiM = HN_SAKI ? HN_SAKI.year * 12 + HN_SAKI.month - 1 : 0;
    if (
      d.getFullYear() * 12 + d.getMonth() >
      Math.max(now.getFullYear() * 12 + now.getMonth(), sakiM)
    )
      return;
    HN_Y = d.getFullYear();
    HN_M = d.getMonth() + 1;
    hnPdfSuteru(); // ★前の 月の PDF を 渡さない★
    // ★この 読みの 番号★（月を 素早く 替えると 古い 月の 返事が 後から 来る＝その 返事で 新しい 月を 描かない・対立役 止3）
    var yomiNo = ++HN_YOMI_NO;
    // ★読み直しの 間は「読めた 月」を 消す★ 2026-10-30（対立役 任1：同じ 月を 広い 幅で 取り直す 間も 期間の 欄と
    //   印刷 / 送る が 押せ、前の 狭い 幅の 記録から PDF を 作れた）＝読み終わりで 入れ直す
    HN_YOMI = '';
    hnBarKaku();
    var box = document.getElementById('slips');
    if (box) box.innerHTML = '<div class="card"><div class="msg">読み込み中…</div></div>';
    var h = haba || _honninHaba(HN_Y, HN_M);
    honninRpc('dk_kyuryo_get', {
      p_token: HONNIN.token,
      // ★パスワードを 入れて いない 時は 札で 取る★（2026-10-21）
      p_pw: HONNIN.pw || (HONNIN.fuda ? 'fuda:' + HONNIN.fuda : null),
      p_from: h.from,
      p_to: h.to,
    })
      .then(function (r) {
        if (yomiNo !== HN_YOMI_NO) return; // ★古い 月の 返事は 捨てる★
        // ★札が 切れた（24時間・作り直し・他の 端末で 5本 越え）＝札を 消して 入れる 画面へ★
        if (r && r.reason === 'fuda_kire' && !HONNIN.pw) {
          hnFudaKesu();
          HONNIN.fuda = null;
          honninStart();
          return honninErr(
            '24時間 たったか、ほかの 端末で 何度も 入ったので、もう一度 パスワードを 入れてください。'
          );
        }
        if (!r || r.ok !== true) {
          // ★途中で 止まった・作り直された★ 2026-10-20（覚えた パスワードで 取り直す 間に 事務所が 作り直した 等）
          if (r && r.reason === 'tomatta') return honninTomeru(HONNIN_TOMATTA_BUN);
          if (r && (r.reason === 'no_token' || r.reason === 'bad_pw'))
            return honninTomeru(HONNIN_TSUKURINAOSHI_BUN);
          // 辞めた 後の 月（働いた 日が 無い 月）は 倉庫が 返さない（会社の 売上を 見続けない・10-16）
          var taishoku = r && r.reason === 'taishoku';
          if (box)
            box.innerHTML =
              '<div class="card"><div class="msg">' +
              (taishoku
                ? 'この 月は 働いた 日も 手当・控除も 無いので 出せません（辞めた 後の 月は、働いたか 手当・控除が 在る 月だけ 見られます）。'
                : '出せませんでした。もう一度 開いてください。') +
              '</div></div>';
          // 辞めた 人が 働いた 月へ 戻れる＝月は 上の 並び（#hnBar・#slips の 外）で 選ぶ（対立役 K3・止4）
          return;
        }
        SET = (r.settings || [])[0] || null;
        RAW.employees = r.emp ? [r.emp] : []; // ★自分 1人だけ★
        RAW.labels = r.labels || [];
        RAW.payrollSettings = SET;
        // ★会社の「売上から 何を 引くか」（r.salesSettings）と その 記録（r.uriageRireki）は 使わない★ 2026-10-24 件J
        //   ＝入れた 実費は 全部 引く（事務所と 同じ）。倉庫の 関数は 変えない（返って きても 見ない）
        RAW.shifts = r.shifts || [];
        RAW.edits = r.edits || [];
        RAW.workHours = r.workHours || [];
        RAW.manualDays = r.manualDays || [];
        // ★その日 その車に 乗った 人の 役（名前・時間は 無し）★ 2026-10-06＝回数・距離の 1台の 額を 分ける 為
        //   ★無い（古い 倉庫の 関数）時は 入れない★＝自分の 行だけから 作ると 1人で 全部 もらう 形に なり 事務所と ずれる
        if (Array.isArray(r.crew)) RAW.crew = r.crew;
        // ★自分の 変えた 記録（何日から）★ 2026-10-18＝返って こない（古い 倉庫の 関数）時は null＝計算が 止める
        RAW.rireki = Array.isArray(r.rireki) ? r.rireki : null;
        RAW.yakuRireki = Array.isArray(r.yakuRireki) ? r.yakuRireki : null; // ★役割の 決まりの 記録★
        // ★自分の 手当・控除★ 2026-10-06（倉庫の 関数が 本人の 分だけ 返す）
        // ★返って こない（古い 倉庫の 関数）時は 止める★ 2026-10-07（前は 空＝控除 0 の 明細が 出た・対立役）
        if (!Array.isArray(r.adjustments)) {
          if (box)
            box.innerHTML =
              '<div class="card"><div class="msg">手当・控除を 読めなかったので 出せません。会社に 知らせてください。</div></div>';
          return;
        }
        RAW.adjustments = r.adjustments;
        // ★締めの 形の 変えた 記録を 返さない（古い 倉庫の 関数）時は 止める★ 2026-10-19（列の 形で 区切らない）
        if (!Array.isArray(r.shimeRireki)) {
          if (box)
            box.innerHTML =
              '<div class="card"><div class="msg">締めの 記録を 読めなかったので 出せません。会社に 知らせてください。</div></div>';
          return;
        }
        RAW.shimeRireki = r.shimeRireki;
        // ★売上の 直しを 返さない（古い 倉庫の 関数）時は 止める★ 2026-10-14
        //   返さないと 本人だけ メーターの 額で 計算し、事務所と 給料が 黙って ずれる（対立役）
        if (r.uriageNaoshi !== true) {
          if (box)
            box.innerHTML =
              '<div class="card"><div class="msg">売上の 直しを 読めなかったので 出せません。会社に 知らせてください。</div></div>';
          return;
        }
        // ★手入力の 日の 足した 実費を 返さない（古い 倉庫の 関数）時は 止める★ 2026-10-20（司さん「揃えろ」）
        //   返さないと 本人だけ 足した 実費を 引かず、事務所と 給料が 黙って ずれる（対立役）
        if (r.tebikiJippi !== true) {
          if (box)
            box.innerHTML =
              '<div class="card"><div class="msg">手入力の 日の 実費を 読めなかったので 出せません。会社に 知らせてください。</div></div>';
          return;
        }
        // ★回数・距離の 直しを 返さない（古い 倉庫の 関数）時は 止める★ 2026-10-25
        //   返さないと 本人だけ メーターの 回数・距離で 回数歩合・距離歩合を 出し、事務所と 給料が 黙って ずれる（対立役 止2）
        if (r.kazuNaoshi !== true) {
          if (box)
            box.innerHTML =
              '<div class="card"><div class="msg">回数・距離の 直しを 読めなかったので 出せません。会社に 知らせてください。</div></div>';
          return;
        }
        HN_YOMI = HN_Y + '-' + HN_M;
        var st = PayrollDaily.normSettings(SET, RAW.shimeRireki);
        // ★★締めの 形は 設定の 1か所（periodKata）★★ 2026-10-07
        if (!st.periodKata || st.periodKata.dame) {
          if (box)
            box.innerHTML =
              '<div class="card"><div class="msg">' +
              esc(shimeDameBun(st.periodKata)) +
              '</div></div>';
          return;
        }
        HN_SAKI = kyouNoTsuki(st.periodKata);
        // ★最初に 開いた 時は 今日の 期の 月へ★（違えば 1回だけ 取り直す）
        if (!HN_KIMETA) {
          HN_KIMETA = true;
          if (HN_SAKI.year !== HN_Y || HN_SAKI.month !== HN_M) {
            HN_Y = HN_SAKI.year;
            HN_M = HN_SAKI.month;
            honninTsuki(0);
            return;
          }
        }
        PERIODS = PayrollPeriod.periodsOf(HN_Y, HN_M, { kata: st.periodKata });
        if (kikanKowareta(PERIODS)) {
          if (box)
            box.innerHTML =
              '<div class="card"><div class="msg">' +
              esc(
                PERIODS.some(function (p) {
                  return p && p.aki;
                })
                  ? '締めの 変え方で この 月の 給料が 無くなっています。会社に 知らせてください。'
                  : '締めの 変えた 記録から 期を 区切れないので 出せません。会社に 知らせてください。'
              ) +
              '</div></div>';
          return;
        }
        // ★期が 取った 幅の 外へ 出る（締めの 形が 変わる 月・始まった 日の 月の 分）＝1回だけ 広げて 取り直す★ 2026-10-19
        //   取らないと 幅の 外の 日の 勤務が 0 の まま 明細に 出る（対立役 主張4）
        //   ★記録の 在る 会社だけ★（記録0の 会社の 本人の 幅は 今の まま＝別件・1押し＝1件・対立役 2回目 直1）
        if (PERIODS.length && !haba && st.periodKata.kind === 'rireki') {
          var hS = PERIODS[0].start;
          var hE = PERIODS[PERIODS.length - 1].end;
          if (hS < h.from || hE > h.to) {
            honninTsuki(0, { from: hS < h.from ? hS : h.from, to: hE > h.to ? hE : h.to });
            return;
          }
        }
        if (!PERIODS.length) {
          if (box)
            box.innerHTML =
              '<div class="card"><div class="msg">この 月に 締める 給料は ありません。</div></div>';
          return;
        }
        // ★月3回は 今まで 通り 最初の 期★（今の 会社の 見え方を 変えない）・他は 今日を 含む 期
        //   締めの 形が 月の 中で 変わる 月は その月の 形で 見る（何日から 2026-10-19）
        var hnTk = PayrollPeriod.tsukiNoKata(st.periodKata, HN_Y, HN_M);
        PIDX = hnTk && hnTk.kind === 'thirds' ? 0 : kyouNoKi(PERIODS);
        PERIOD = PERIODS[PIDX];
        HN_HANI = PIDX;
        if (!hnKeisan()) return;
        TAB = 'slip';
        honninKami();
      })
      .catch(function (e) {
        if (yomiNo !== HN_YOMI_NO) return; // ★古い 月の 返事は 捨てる★
        // ★読み終わりの 中で 計算 以外（期の 区切り・設定の 読み 等）が 転んでも 黙って「読み込み中…」で 止めない★ 2026-10-22（対立役 K2）
        // eslint-disable-next-line no-console -- 2026-11-07 html から 出した 前からの 行（中身は 変えない・件2 で 直す）
        if (window.console) console.warn('[本人の 読み終わり]', e);
        HN_KEISAN_NG = true;
        REP = null;
        hnPdfSuteru();
        honninTomeru(HN_KEISAN_NG_BUN, true);
      });
  }

  // ★締めで 止めた 時も 給料の 設定を 開いて いれば 描く★ 2026-10-19（壊れた 記録を 消せる 様に・対立役 直5）
  //   設定か 記録を 読めて いない 時は 描かない（既定の 値を 本物の 様に 見せない）
  function shimeTomeSet() {
    if (TAB === 'set' && !(SET && SET.yomenai) && Array.isArray(RAW.shimeRireki)) render();
  }
  // ★締めの 変えた 記録から 期を 区切れない（PayrollPeriod が dame の 期を 返した）★ 2026-10-19
  var KIKAN_KOWARE_BUN =
    '締めの 変えた 記録から 期を 区切れないので 止めました。「給料の 設定」の 明細の 期間で 記録を 直してください。';
  // ★締めの 変え方で 空いた 月★（期が 0＝0円に しない・2026-10-19 月が 空く 件）
  var KIKAN_AKI_BUN =
    '締めの 変え方で この 月の 給料が 無くなっています（給料は 毎月 払う 決まり）。「給料の 設定」の 明細の 期間の「記録」で 直してください。';
  function kikanBun(ps) {
    return (ps || []).some(function (p) {
      return p && p.aki;
    })
      ? KIKAN_AKI_BUN
      : KIKAN_KOWARE_BUN;
  }
  function kikanKowareta(ps) {
    return (ps || []).some(function (p) {
      return p && p.dame;
    });
  }
