  // 期間に関係ない物（従業員・車名・決め方）
  // ★★読めなかった 数は「期間に 関係ない 物」と「期間の 物」に 分ける★★ 2026-10-07
  //   前は 1度 読めないと 数が 戻らず、もう一度 読んでも 帯が 消えなかった（明細の PDF を 止める 様に したので 直す）
  var LOAD_KIHON = { tried: 0, failed: 0 };
  function yomiNaoshiObi() {
    afterLoad(function () {
      if (LOAD_KIHON.failed > 0) loadMasters();
      else loadPeriod();
    });
  }
  var RIREKI_YOMI = { tried: 0, failed: 0 };
  var YAKU_RIREKI_YOMI = { tried: 0, failed: 0 };
  var SHIME_RIREKI_YOMI = { tried: 0, failed: 0 }; // ★締めの 記録★ 2026-10-19
  function loadMasters() {
    // ★読み直す 間も 前の「読めなかった」数を LOAD に 残す★ 2026-11-06（作った後 対立役 注1）
    //   前は 頭で LOAD を 0 に した＝「もう一度読む」の 返り待ちの 間、読めなかった 時に 組んだ REP の まま
    //   門（loadFailed）が 開き、名前の 選び直し・幅の 変化で 控除の 抜けた 合計と 明細の PDF が 出せた。
    //   ⇒ 数えるのは 別の 箱（MS）・返った 所で LOAD に 入れ替える（止めの 印は 足さない＝下ろし忘れで 止めっぱなしに しない）
    var MS = DKSession.newLoadState();
    haraiKakusu();
    Promise.all([
      DKSession.softList(
        SESS,
        kaishaDake('dk_employees?select=*&order=sort_order.asc&limit=500'),
        MS
      ),
      DKSession.softList(SESS, kaishaDake('dk_device_labels?select=*&limit=500'), MS),
      // ★給料の 設定は 読めたかを 別に 数える★ 2026-10-07（対立役 D：読めない 時に 月3回で 明細が 出た）
      ((SET_YOMI = { tried: 0, failed: 0 }),
      DKSession.softList(SESS, kaishaDake('dk_payroll_settings?select=*&limit=1'), SET_YOMI)),
      // res[3]＝空き：売上から 何を 引くかの 設定（dk_sales_settings）は 2026-10-24 件J で 読まなくした
      //   （入れた 実費は 全部 引く）。番号を 詰めると 下の res[4]〜 が ずれる ので 空きの まま
      null,
      // ★変えた 記録（何日から）は 読めたかを 別に 数える★ 2026-10-18（読めない 時に 列の 値で 出さない）
      ((RIREKI_YOMI = { tried: 0, failed: 0 }),
      DKSession.softList(
        SESS,
        kaishaDake('dk_hito_rireki?select=*&order=from_date.asc&limit=100000'),
        RIREKI_YOMI
      )),
      // ★役割の 決まりの 変えた 記録（何日から）★ 2026-10-18
      ((YAKU_RIREKI_YOMI = { tried: 0, failed: 0 }),
      DKSession.softList(
        SESS,
        kaishaDake('dk_yaku_rireki?select=*&order=from_date.asc&limit=100000'),
        YAKU_RIREKI_YOMI
      )),
      // res[6]＝空き：売上から 引く 物の 変えた 記録（dk_uriage_rireki）は 2026-10-24 件J で 読まなくした
      null,
      // ★締めの 形の 変えた 記録（何日から）★ 2026-10-19＝res[7]
      ((SHIME_RIREKI_YOMI = { tried: 0, failed: 0 }),
      DKSession.softList(
        SESS,
        kaishaDake('dk_shime_rireki?select=*&order=from_date.asc&limit=100000'),
        SHIME_RIREKI_YOMI
      )),
    ]).then(function (res) {
      LOAD.tried = MS.tried;
      LOAD.failed = MS.failed;
      RAW.employees = res[0] || [];
      LOAD.tried += SHIME_RIREKI_YOMI.tried;
      LOAD.failed += SHIME_RIREKI_YOMI.failed;
      RAW.shimeRireki = SHIME_RIREKI_YOMI.failed > 0 ? null : res[7] || [];
      LOAD.tried += RIREKI_YOMI.tried;
      LOAD.failed += RIREKI_YOMI.failed;
      RAW.rireki = RIREKI_YOMI.failed > 0 ? null : res[4] || [];
      LOAD.tried += YAKU_RIREKI_YOMI.tried;
      LOAD.failed += YAKU_RIREKI_YOMI.failed;
      RAW.yakuRireki = YAKU_RIREKI_YOMI.failed > 0 ? null : res[5] || [];
      RAW.labels = res[1] || [];
      SET = (res[2] && res[2][0]) || null;
      LOAD.tried += SET_YOMI.tried; // ★取れなかった 帯にも 出す★
      LOAD.failed += SET_YOMI.failed;
      if (SET_YOMI.failed > 0) SET = { yomenai: true }; // ★止める 印★（PayrollPeriod.yomu が dame に する）
      SET_YONDA = true;
      yakuMotoKesu(); // 役割の 名前の 直しの 控えを 読み込んだ 名前から 始め直す
      LOAD_KIHON = { tried: LOAD.tried, failed: LOAD.failed };
      RAW.payrollSettings = SET;
      // ★★配る 一覧を 最初から 出す★★ 2026-09-04（司さん「従業員毎に 配るんやないんか」）
      //   ★前は「配る」を 押すまで 何も 出なかった★（全員ぶんを 一度に 作る 作りだった）
      //   ⇒ ★今は 従業員 全員を 出して、その人の〔配る〕を 押す★
      if (!HONNIN) renderHaifu();
      loadPeriod();
    });
  }

  // 期間ぶん（勤務・手入力・時数）
  var LP_NO = 0; // ★読みの 番号★（古い 返事を 捨てる）
  var LP_YOMICHU = false;
  var SET_YONDA = false; // ★給料の 設定を 読み終えたか★（読む 前は 締めの 形が 分からない）
  function loadPeriod() {
    if (window.PdfOkuru) PdfOkuru.kesu(); // ★月・期を 読み直す＝前の 紙の 帯を 消す（送らない）★
    haraiKakusu(); // ★前の 期の 合計を 残さない★（早い return より 前・設計前 対立役 注4）
    if (!COMPANY) return;
    // ★設定を 読み終える 前は 組まない★ 2026-10-07（読む 前は 月3回に 見え、20日締めの 会社でも 月3回で 明細を 組んだ・対立役 Q）
    if (!SET_YONDA) return;
    var lpNo = ++LP_NO;
    // 乗った人・手で 入れた 日 は 読めたかを 別に 数える（読めない 期は その 保存を 断る）
    var WH_YOMI = DKSession.newLoadState();
    var MD_YOMI = DKSession.newLoadState();
    LP_YOMICHU = true; // ★読み込み中は 明細の PDF を 作らない★（対立役 10-08 A）
    LOAD.tried = LOAD_KIHON.tried; // ★期間の 分は 読み直す 度に 数え直す★
    LOAD.failed = LOAD_KIHON.failed;
    var st = PayrollDaily.normSettings(SET, RAW.shimeRireki);
    // ★★締めの 形は 設定の 1か所（periodKata）★★ 2026-10-07
    //   読めない ⇒ ★止める★（前は 知らない 値を 黙って 月3回に した）
    if (!st.periodKata || st.periodKata.dame) {
      PERIODS = [];
      PERIOD = null;
      if ($('slips')) $('slips').innerHTML = '';
      renderPeriodBar();
      showMsg('');
      showErr(shimeDameBun(st.periodKata));
      LP_YOMICHU = false; // ★止めた／期が 無い＝読み込み中 では ない★
      shimeTomeSet();
      return;
    }
    if (!YM_KIMETA) {
      YM_KIMETA = true;
      YM = kyouNoTsuki(st.periodKata);
    }
    PERIODS = PayrollPeriod.periodsOf(YM.year, YM.month, { kata: st.periodKata });
    if (kikanKowareta(PERIODS)) {
      var kwBun = kikanBun(PERIODS);
      PERIODS = [];
      PERIOD = null;
      if ($('slips')) $('slips').innerHTML = '';
      renderPeriodBar();
      showMsg('');
      showErr(kwBun);
      LP_YOMICHU = false;
      shimeTomeSet();
      return;
    }
    if (!PERIODS.length) {
      PERIOD = null;
      if ($('slips')) $('slips').innerHTML = '';
      renderPeriodBar();
      showErr('');
      showMsg('この 月に 締める 給料は ありません。');
      LP_YOMICHU = false; // ★止めた／期が 無い＝読み込み中 では ない★
      return;
    }
    if (!(PIDX >= 0 && PIDX < PERIODS.length)) PIDX = 0;
    PERIOD = PERIODS[PIDX];
    showErr('');
    showMsg('読み込み中…');
    // ★読み込み中は 古い 月の 紙を 消す★（10-05 対立役：押すと 名前だけ 新しい 月・中身は 古い 月）
    if (!HONNIN && $('slips')) $('slips').innerHTML = '';

    // 期間の日付は日本時間。勤務は開始時刻で数える。
    var from = PERIOD.start + 'T00:00:00+09:00';
    var toD = new Date(
      +PERIOD.end.slice(0, 4),
      +PERIOD.end.slice(5, 7) - 1,
      +PERIOD.end.slice(8, 10) + 1
    );
    var to =
      toD.getFullYear() +
      '-' +
      ('0' + (toD.getMonth() + 1)).slice(-2) +
      '-' +
      ('0' + toD.getDate()).slice(-2) +
      'T00:00:00+09:00';

    Promise.all([
      soft(
        // ★距離も 取る★ 2026-10-06（1kmいくら の 材料。無いと 事務所と 紙だけ 0円＝本人の 画面と ずれる・対立役）
        'dk_shifts?select=shift_id,device_id,started_at,ended_at,elapsed_sec,fare_total_yen,trip_count,actual_total_m,total_distance_m,excluded' +
          '&started_at=gte.' +
          encodeURIComponent(from) +
          '&started_at=lt.' +
          encodeURIComponent(to) +
          '&order=started_at.asc&limit=2000'
      ),
      soft('dk_shift_edits?select=*&limit=2000'),
      DKSession.softList(
        SESS,
        kaishaDake(
          'dk_work_hours?select=*&work_date=gte.' +
            PERIOD.start +
            '&work_date=lte.' +
            PERIOD.end +
            '&limit=2000'
        ),
        WH_YOMI
      ),
      DKSession.softList(
        SESS,
        kaishaDake(
          'dk_manual_days?select=*&work_date=gte.' +
            PERIOD.start +
            '&work_date=lte.' +
            PERIOD.end +
            '&limit=2000'
        ),
        MD_YOMI
      ),
      // ★手当・控除★ 2026-10-06
      soft(
        'dk_pay_adjustments?select=*&work_date=gte.' +
          PERIOD.start +
          '&work_date=lte.' +
          PERIOD.end +
          // 読みの 順は 鍵の 順（js/dk-session.js KAGI_JUN・同じ 日・同じ 時刻でも 一意）2026-10-23 件G
          '&order=work_date.asc,adj_id.asc&limit=5000'
      ),
    ]).then(function (res) {
      // ★古い 返事は 捨てる★ 2026-10-07（月を 素早く 送ると 前の 月の 返事が 後から 上書きした・対立役 Q）
      if (lpNo !== LP_NO) return;
      LOAD.tried += WH_YOMI.tried + MD_YOMI.tried;
      LOAD.failed += WH_YOMI.failed + MD_YOMI.failed;
      RAW.shifts = res[0] || [];
      RAW.adjustments = res[4] || [];
      RAW.edits = res[1] || [];
      RAW.workHours = res[2] || [];
      RAW.manualDays = res[3] || [];
      showMsg('');
      // 計算が 転んだら 読み込み直しの 訳を 出す（「読み込み中です」の まま 黙って 待たせない・対立役 2回目 直す-2）
      //   ★読み込み中の 印は 下ろさない★（下ろすと 前の 期の 額で 新しい 月の 明細 PDF が 出た・対立役 3回目 止め-1）
      //   明細と 日の 欄は 描かず、月の 札だけ 新しい 期に 揃える（対立役 3回目 直す-1）
      try {
        recalc();
        if (KEISAN_NG) {
          KEISAN_NG = false;
          if (String($('err').textContent || '') === KEISAN_NG_JI) showErr('');
        }
      } catch (e) {
        // eslint-disable-next-line no-console -- 2026-11-07 html から 出した 前からの 行（中身は 変えない・件2 で 直す）
        if (window.console) console.warn('[期の 計算]', e);
        KEISAN_NG = true;
        showErr(KEISAN_NG_JI);
        render();
        return;
      }
      // ★読み込み中の 印は 計算し終えた 後で 下ろす★（前で 下ろすと recalc が 投げた 時に 新しい 期・古い 中身で 押せた・対立役）
      LP_YOMICHU = false;
      render();
      // ★取れなかった物があれば 画面の上に出す★（期間に 関係ない 物が 読めなかった 時は そこから 読み直す）
      yomiNaoshiObi();
    });
  }

  function recalc() {
    _CAR_NAMES = null; // ★データを読み直したら車の名前も作り直す★
    CTX = PayrollDaily.buildCtx(Object.assign({}, RAW, { yakuRireki: yakuRirekiNoIma() }));
    // 本人の 画面は 1人＝その人の 登録日で 勤め始める 前の 期を 出さない（N4・js/payroll-daily.js の hajimeOf）
    if (HONNIN) CTX.honnin = true;
    REP = PayrollDaily.report(PERIOD ? PERIOD.dates : [], CTX);
    var ub = kyuDameBun(CTX);
    // 保存中の 字は 赤い 字に 出さない。その 時は 他の 止めの 訳を 出す（隠さない・対立役 11回目 ⑯）
    if (ub === EMP_HOZONCHU) ub = kyuDameBunHoka(CTX);
    // 返事待ちの 字は 赤い 字が 空か 止めの 字の 時だけ 出す（他の 欄の 断られた 訳を 上書き しない・対立役 12回目 止1）
    if (ub && empTomeNoJi(ub)) {
      var imaJi = String($('err').textContent || '');
      if (imaJi && !empTomeNoJi(imaJi)) ub = '';
    }
    if (ub) showErr(ub);
  }
  // 売上の 直しが 読めない 業務が 在る 時の 字（明細・紙を 止める）2026-10-14
  //   メーターの 額に 黙って 倒すと 給料が 違う 額で 出る＝お金の 出力は 止めて 警告
  function uriageDameBun(ctx) {
    var k = (ctx && ctx.uriageDame && ctx.uriageDame.length) || 0;
    return k
      ? '売上の 直しが 読めない 業務が ' +
          k +
          '件 あります。給料の 明細・紙は 止めています。下の 帯の「入力」で その 日の 車を 開き、売上を 直してください。'
      : '';
  }

  // ★給料を 止める 訳★（売上の 直しが 読めない・役割の 決まりが 無くて 計算できない）2026-10-17
  //   明細・紙・PDF・本人の 画面は 全部 ここを 見る（訳の 字は PayrollDaily の 1か所）
  // 従業員の 欄の 保存中 以外の 止める 訳（売上の 直しが 読めない・役割の 決まりが 無い）
  function kyuDameBunHoka(ctx) {
    return uriageDameBun(ctx) || (ctx && ctx.yakuDameRiyuu) || '';
  }
  function kyuDameBun(ctx) {
    // 従業員の 欄の 保存が 返らない 間も 止める（歩合・最低保証が 計算に 入って いない かも しれない・2026-10-21）
    return empTomeBun() || kyuDameBunHoka(ctx);
  }

  // ---------- 描画 ----------
  function render() {
    // ★★折れる 場所を 決める★★ 2026-09-05（司さん「挟む 形に したら スッキリ」）
    //   ★前は 1つの 字の 塊★だったので 狭い 画面で「9/1」と「~ 9/10」の 間で 折れていた。
    //   ⇒ ★2つに 分け、それぞれは 折らない★＝折れるなら ★月と 日付の 間★で 折れる。
    $('monthLabel').innerHTML = PERIOD
      ? '<span class="mb-1">' +
        esc(PERIOD.year + '年 ' + PERIOD.label) +
        '</span> <span class="mb-2">' +
        esc(PERIOD.rangeLabel) +
        '</span>'
      : '—';
    renderPeriodBar();
    $('monthCard').style.display = TAB === 'slip' ? '' : 'none';
    $('paneSlip').style.display = TAB === 'slip' ? '' : 'none';
    $('paneEmp').style.display = TAB === 'emp' ? '' : 'none';
    $('paneSet').style.display = TAB === 'set' ? '' : 'none';
    if ($('paneTpl')) $('paneTpl').style.display = TAB === 'tpl' ? '' : 'none';
    // 期の 計算が 転んだ 時は 明細を 描かない（前の 期の 額を 新しい 期の 札の 下に 出さない・対立役 3回目）
    if (KEISAN_NG && TAB === 'slip') {
      if ($('slips')) $('slips').innerHTML = '';
      haraiKakusu(); // ★計算が 転んだ＝合計も 出さない★
      showErr(KEISAN_NG_JI);
      return;
    }
    meisaiGaiObi();
    if (TAB === 'slip') renderSlips();
    if (TAB === 'emp') renderEmp();
    if (TAB === 'tpl') renderTpl();
    if (TAB === 'set') {
      renderSet();
      renderCars(); // ★車の名前と並びも同じ画面に出す★
    }
  }

  // ★明細に 載らない 手当・控除の 帯★ 2026-10-23 件G（本人の 画面には 出さない）
  function meisaiGaiObi() {
    var b = $('meisaiGaiObi');
    if (!b) return;
    var ji =
      !HONNIN && TAB === 'slip' && REP
        ? PayrollDaily.meisaiGaiJi((REP.meisaiGai || []).length)
        : '';
    b.textContent = ji;
    b.style.display = ji ? '' : 'none';
  }

  // ── 期の選び方（司さんは月3回払い）────────────────
  function renderPeriodBar() {
    var bar = $('periodBar');
    if (!PERIODS || PERIODS.length < 2) {
      bar.innerHTML = ''; // 1回払いの会社では出さない
      return;
    }
    bar.innerHTML = PERIODS.map(function (p, i) {
      return (
        '<button class="pbtn' +
        (i === PIDX ? ' on' : '') +
        '" data-pidx="' +
        i +
        '">' +
        esc(p.name) +
        '</button>'
      );
    }).join('');
    Array.prototype.forEach.call(bar.querySelectorAll('[data-pidx]'), function (b) {
      b.onclick = function () {
        PIDX = parseInt(b.getAttribute('data-pidx'), 10) || 0;
        loadPeriod();
      };
    });
  }

  // ── 明細（実物の給料1〜8と同じ並び）──────────────
  // ★載せるかどうかは ここ1か所で決める★（画面と設定で食い違わない）2026-08-25
  //   倉庫にまだ列が無い会社は ★載せる（今までと同じ）★。
  function showCarSalesNow() {
    return !(SET && SET.show_car_sales === false);
  }
