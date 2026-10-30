// 業務管理スーパー機能（2026/05/01新規）
// 1業務単位で総走行距離・実車総距離・売上・営業回数を集計
// meter.js には触らず、Meter.getState() を読むだけ
//
// 2026/05/01：iOS Safari 環境での確実なグローバル化のため window.Business に変更
// ★設計変更宣言 (2026-05-15・Phase C・Node coverage 計測可能化):
//   旧: window.Business = (function(){...})()    (Node では window 未定義で即 ReferenceError)
//   新: const Business = (function(){...})()  +  if(typeof window!=='undefined') window.Business = Business
//       + 末尾 module.exports = Business
//   IIFE 本体 (function () { ... })() の構造は完全に無変更。外側の代入だけを env 両対応に拡張。
//   browser context: const Business + window.Business 両方が同じ参照を指す (旧挙動と等価)
//   Node test context: const Business + module.exports = Business で require 経由 load 可能
const Business = (function () {
  // ─────────────────────────────────────────
  // 状態
  // ─────────────────────────────────────────
  let state = {
    active: false,
    start_time: null, // 業務開始時刻（unix ms）
    end_time: null, // 業務終了時刻（end()押下時）

    // 終了後の3時間再開機能（2026/05/01）
    ended: false, // [終了]ボタン押下フラグ（abandon前の中間状態）
    ended_at: null, // [終了]押下時刻（3時間判定用）

    // 距離（メートル）
    total_distance_m: 0, // 総走行距離（業務開始からのGPS移動全部）
    actual_total_m: 0, // 実車総距離（各実車の合算）
    // 空車距離 = total_distance_m - actual_total_m（getReport で計算）

    // 売上
    fare_total_yen: 0, // 売上累計（円）
    trip_count: 0, // 営業回数（実車回数）

    // 履歴
    trips: [], // [{distance_m, fare_yen, start_time, end_time}]

    // 2026-05-09 設計変更 (P1/F1/F4 絶対ルール準拠):
    //   total_distance_m は Meter.getState().distance_m を信源とする
    //   旧: GPS Haversine 直線距離 (絶対ルール違反)
    //   新: Meter の差分を加算 (= MM 道路距離・GPS 直線禁止)
    last_meter_distance_m: 0, // 直前に観測した Meter.distance_m (差分計算用)

    // ★設計変更宣言 (2026-05-15・経由地点 + 住所表示機能・trip 単位住所トラッキング):
    //   trip 1 件分 (= 1 つの代行) の出発地住所・経由地点リスト・到着地住所を保持する。
    //   onTripStart で初期化 + start_address 取得、onWaypoint で waypoints に追加、
    //   setEndAddress で end_address 取得、onTripEnd 時に trips[].push に統合して
    //   current_trip を null 化する。住所取得は Meter.getNearestAddress に委譲。
    //   絶対ルール準拠: 住所取得失敗 (null) でも業務継続・代行開始/確定を絶対に止めない。
    current_trip: null, // { start_time, start_address, waypoints:[{address,timestamp}], end_address }
    // ★終了時に履歴へ積んだかの印 (2026-08-03)★
    //   end() で積む形にしたので、abandon() が積み直さないための目印。
    //   ★保存・復元・初期化の全部に通すこと★（1箇所でも漏れると二重に積まれる）。
    history_pushed: false,
    // ★「見えなかった分」の 業務開始時の 控え (2026-09-03)★
    //   数えているのは 課金の Worker の 中で、その数は ★業務を またいで 積み上がります★。
    //   ⇒ 業務開始で ここに 控え、終了で 今の値との ★差★ を 履歴に 入れます。
    //   ★これも 保存・復元・初期化の 全部に 通すこと★（漏れると 開き直しで 差が 出せない）。
    mienai_base: null,
  };
  // ★前の 業務で 履歴に 積めなかった 報告＝持ち越し（2026-10-11）★
  //   ★state に 入れない★（state は 1秒ごとに 丸ごと 書くので、入れると 満杯の 端末で 今夜の 保存が
  //   先に 転び、開き直すと 途中の 件数の 晩が 事務所へ 届く＝taiketsu が 本物の business.js で 測った）。
  //   別の 鍵（MAE_KEY）に、業務開始と 業務終了の 時だけ 書く。load() で 戻す。
  let _mae = [];
  let _maeKaketa = true; // 持ち越しを MAE_KEY に 書けているか（書けて いなければ 閉じると 消える）
  let _maeYomenai = null; // 読めず 退けも できなかった MAE_KEY の 字（在る 間は 鍵に 触らない＝消さない）

  // ★設計変更宣言 (2026-05-14・業務リセット仕様変更):
  //   旧: 3 時間猶予の RESUME_GRACE_MS / canResume / checkAutoAbandon で時刻ベース管理
  //   新: 時刻ベース全廃・代行開始ボタン押下時に表示値リセット (index.html 側)
  //       再開は前回業務が ended 状態 (state.start_time !== null && !state.active) なら常時可能
  //       3 時間制限なし
  // localStorage キー
  const STORAGE_KEY = 'daikou_business_state';
  const HISTORY_KEY = 'daikou_business_history';

  // 履歴保持期間（日数）
  const RETENTION_DAYS = 30;
  // ★2026-08-08: まだ上がっていない業務を捨てないための道具★
  const SYNCED_KEY = 'dk_synced_shifts'; // job-sync が「送れた」印を残す所（読むだけ）
  const DROPPED_KEY = 'dk_history_dropped'; // 上限を超えて捨てた件数（黙って消さない）
  const BROKEN_KEY = 'dk_business_history_kowareta'; // 読めなかった 履歴の 字の 退け先（消さない）
  const MAE_KEY = 'dk_business_mae_tsumenai'; // 履歴に 積めなかった 前の 業務の 報告（持ち越し）
  const UNSENT_KEEP_MAX = 200; // 30日を過ぎても残す「未送信」の上限
  const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

  // ─────────────────────────────────────────
  // ★「見えなかった分」(2026-09-03)★
  //   ★どこから 来るか★ 課金の Worker（map-matcher → pipeline-distance.mienakattaBun）が
  //     数えた物を index.html が window._lastMienai に 置きます。★ここは 読むだけ★。
  //   ★なぜ 引き算するか★ Worker の 数は ★業務を またいで 積み上がる★（tracker は
  //     業務ごとに 作り直されない）。そのまま 入れると ★前の業務の 分まで 乗ります★。
  //   ★取れない時は null★（★0 と 書かない★＝「本当に 0 だった」と 読まれる）
  //   ★距離にも 料金にも 触りません★
  // ─────────────────────────────────────────
  function _mienaiNow() {
    try {
      const w = typeof window !== 'undefined' ? window : null;
      const v = w && w._lastMienai;
      if (!v || typeof v !== 'object') return null;
      const n = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
      const kaisuu = n(v.kaisuu);
      const byou = n(v.byou);
      const m = n(v.meter);
      if (kaisuu === null && byou === null && m === null) return null;
      return { kaisuu: kaisuu || 0, byou: byou || 0, m: m || 0 };
    } catch (_) {
      return null;
    }
  }

  // 業務ごとの 差を出す。★今が 無ければ null★／★巻き戻っていたら 今の値そのもの★
  //   （巻き戻り＝Worker が 作り直された＝configVehicle で tracker を捨てた時に起きる）
  function _mienaiSa() {
    const ima = _mienaiNow();
    if (!ima) return { kaisuu: null, byou: null, m: null };
    const moto = state.mienai_base;
    if (!moto || typeof moto !== 'object') {
      return { kaisuu: ima.kaisuu, byou: ima.byou, m: ima.m };
    }
    const hiku = (a, b) => {
      const d = a - (typeof b === 'number' && isFinite(b) ? b : 0);
      return d >= 0 ? +d.toFixed(2) : +a.toFixed(2); // ★マイナスにしない＝巻き戻りは 今の値★
    };
    return {
      kaisuu: hiku(ima.kaisuu, moto.kaisuu),
      byou: hiku(ima.byou, moto.byou),
      m: hiku(ima.m, moto.m),
    };
  }

  // ─────────────────────────────────────────
  // ライフサイクル
  // ─────────────────────────────────────────

  // 業務開始
  function start() {
    if (state.active) {
      if (typeof dlog === 'function') dlog('[Business] already active');
      return false;
    }
    // ★前の 業務を 履歴に 積めなくても 消さずに 持ち越して 始める (2026-10-11)★
    //   前は 積めなくても state を 消して 始めた＝その晩の 業務が 事務所へ 上がらずに 消えた。
    //   止めて 始めさせないと、いつも 書けない 端末では 毎晩 働けなくなる（行き止まり）。
    //   ⇒ 積めなかった 報告は 持ち越し（_mae・MAE_KEY）、積めた 時に 外す（呼び手が 画面で 知らせる）。
    const mae = _mae.slice();
    if (state.ended && state.start_time && !state.history_pushed) {
      const maeReport = getReport();
      if (_appendHistory(maeReport) !== true) mae.push(maeReport);
    }
    _maeOku(_maeWoTsumu(mae));
    _hozonShippaiShiraseta = false; // 新しい 業務＝保存の 失敗を もう一度 知らせられる
    const now = Date.now();
    state = {
      active: true,
      start_time: now,
      end_time: null,
      ended: false,
      ended_at: null,
      total_distance_m: 0,
      actual_total_m: 0,
      fare_total_yen: 0,
      trip_count: 0,
      trips: [],
      last_meter_distance_m: 0,
      // 経由地点 + 住所表示機能 (2026-05-15・業務開始時は trip 未開始のため null)
      current_trip: null,
      history_pushed: false, // ★新しい業務なので、まだ積んでいない★
      // ★「見えなかった分」の 基準を ここで 控える (2026-09-03)★
      //   ★abandon() が 先に 走って 前業務を 積んだ 後★なので、ここで 控えれば
      //   前業務の 分は 入りません。取れない時は null＝差も null（0 と 書かない）。
      mienai_base: _mienaiNow(),
    };
    // ★設計変更宣言 (2026-05-14・business_distance_m を業務開始でも 0 リセット):
    //   通常は Meter.businessEnd() で 0 リセットされるが、abandon() 経由 (前業務 limbo) や
    //   タスクキル復元後の新業務開始で Meter.businessEnd を経由しないケースがあるため、
    //   業務開始時にも明示的に Meter 側を 0 化して整合を保つ。
    if (typeof Meter !== 'undefined' && typeof Meter.setBusinessDistance === 'function') {
      try {
        Meter.setBusinessDistance(0);
      } catch (_) {
        /* Meter 未ロード等は致命傷ではないので無視 */
      }
    }
    // ★設計変更宣言 (2026-05-18・Phase 2・business_active gate 開始):
    //   業務開始時に Meter 側 business_active を true 化・以降 business_distance_m が常時加算。
    if (typeof Meter !== 'undefined' && typeof Meter.setBusinessActive === 'function') {
      try {
        Meter.setBusinessActive(true);
      } catch (_) {
        /* noop */
      }
    }
    save();
    if (typeof dlog === 'function') dlog('[Business] start at ' + new Date(now).toISOString());
    return true;
  }

  // 業務終了（[終了]ボタン押下時）
  // 3時間以内なら resume() で再開可能
  // 3時間経過後は次回 start() or checkAutoAbandon() で自動 abandon
  // ★2026-08-03 作り直し★ 司さん「反映されない」の根治。
  //
  //   ★元の作り★ 業務終了では履歴に積まず、★次の業務開始の中の abandon() で積んで★いた
  //     （index.html:8582「履歴の確定 push は次の Business.start() 内の abandon() で実施」）。
  //     理由は二重 push 回避。だが夜の仕事は「終わったらもう開かない」ので、
  //     ★その晩の記録は翌日まで どこにも無い＝クラウドにも上がらない★。
  //
  //   ★新しい作り★ 終了した時点で積む。二重にならないよう state に印を持つ。
  //     ・end()    … 履歴に積んで history_pushed=true
  //     ・abandon()… 既に積んであれば積み直さない
  //     ・resume() … 積んだ分を履歴から外す（まだ終わっていないので）
  //   距離・料金・メーター本体には触っていない（積むタイミングだけ）。
  function end() {
    if (!state.active && !state.start_time) return null;
    if (state.ended && state.history_pushed) return getReport(); // 2回押しても増やさない
    // ★既に 終えて 積めていない 業務は ★時刻を 変えずに★ 積み直すだけ (2026-10-11)★
    //   前は 2回目の end() が end_time を 今に 書き直し、日報画面に いた 分だけ
    //   事務所へ 送る 勤務時間（elapsed_sec）が 伸びた。
    if (state.ended) {
      state.history_pushed = _appendHistory(getReport()) === true;
      _maeOku(_maeWoTsumu(_mae));
      save();
      return getReport();
    }
    const now = Date.now();
    state.active = false;
    state.ended = true;
    state.ended_at = now;
    state.end_time = now;
    // ★ Phase 2: 業務終了予約で business_active 停止 (resume() で再 true 化)
    if (typeof Meter !== 'undefined' && typeof Meter.setBusinessActive === 'function') {
      try {
        Meter.setBusinessActive(false);
      } catch (_) {
        /* noop */
      }
    }
    // ★ここで履歴に積む（次の業務開始を待たない）★
    const report = getReport();
    if (state.start_time) {
      // ★★2026-09-28 直し＝積めた 時だけ 印を 立てる★★
      //   ★対立役に 叩かれて 見つかった（前から 在る 穴）★
      //     `_appendHistory` は 中で 例外を 握りつぶす。倉庫が 満杯で
      //     書けなくても 昔は ★history_pushed = true に なっていた★。
      //     すると abandon() の 「既に 積んでいれば 積み直さない」が 効いて
      //     ★その晩の 勤務が 丸ごと 消える★（司さんの「何件か減る」の 別の 因）。
      //   ⇒ ★積めなかったら 印を 立てない★＝次の abandon() が もう一度 試す。
      state.history_pushed = _appendHistory(report) === true;
    }
    _maeOku(_maeWoTsumu(_mae)); // 持ち越しも 積み直す
    save();
    if (typeof dlog === 'function') dlog('[Business] end (history saved / resumable)');
    return report;
  }

  // 業務再開（end 後・前業務 limbo 状態なら常時可能・3 時間制限なし）
  // ★設計変更宣言 (2026-05-14): RESUME_GRACE_MS の 3h チェックを撤去
  function resume() {
    if (state.active) return false;
    if (!state.start_time) return false; // start していない
    // ★end() が履歴に積んだ分を外す (2026-08-03)★
    //   まだ終わっていないので履歴に残っていてはいけない。
    //   外さないと、この業務を本当に終えた時に★もう1件積まれて二重になる★。
    if (state.history_pushed) {
      _removeHistory(state.start_time, state.end_time);
      // ★送信済みの印も外す (2026-09-26・司さんの報告「何件か減る」の根治)★
      //   ★何が起きていたか（本物の関数で再現した）★
      //     [終了] → 履歴に積む → ★Wi-Fi に繋がった瞬間 job-sync が事務所へ上げる★
      //     → dk_synced_shifts に印が付く → [続ける] → もう何件か代行 → [終了]
      //     ⇒ 履歴は「続きを足した版」に積み直されるのに、印が残っているので
      //        selectUnsynced が ★1件も選ばない＝二度と上がらない★。
      //     ⇒ 事務所に残るのは途中までの版。件数だけでなく
      //        ★終了時刻・距離・売上・勤務時間(elapsed_sec) も途中の値★になる。
      //   ★なぜ気づけなかったか★ 同じ対処は js/trip-edit.js には入っていた
      //     （「印を外さないと直しが事務所に届かない」）。★片方だけ直っていた★。
      //   ★送り直しは安全★ サーバ(dk-sync-jobs)は dk_shifts を upsert し、
      //     dk_trips は消して入れ直す。請求書は extra.dk_ref で二重にならない。
      _unsealSynced(state.start_time);
      state.history_pushed = false;
    }
    state.active = true;
    state.ended = false;
    state.ended_at = null;
    state.end_time = null;
    // 2026-05-09: Meter 信源化 (P1) で last_gps→last_meter_distance_m に置換
    //   再開時の baseline は現 Meter.distance_m に揃える (差分=0 から再開)
    state.last_meter_distance_m =
      typeof Meter !== 'undefined' && Meter.getState ? Meter.getState().distance_m || 0 : 0;
    // ★ Phase 2: 業務再開で business_active を再 true 化
    if (typeof Meter !== 'undefined' && typeof Meter.setBusinessActive === 'function') {
      try {
        Meter.setBusinessActive(true);
      } catch (_) {
        /* noop */
      }
    }
    save();
    if (typeof dlog === 'function') dlog('[Business] resume');
    return true;
  }

  // ★設計変更宣言 (2026-05-14): canResume / checkAutoAbandon を削除。
  //   旧仕様 (3 時間猶予) は撤去・新仕様は呼出側で
  //   (state.start_time !== null && !state.active) で再開可能性を直接判定する。

  // 業務完全終了（履歴に保存→state リセット）
  // 通常は3時間経過後に checkAutoAbandon() から呼ばれる
  // 手動で確定したい場合の公開API（明示的な abandon）
  function abandon() {
    // ★end() が既に積んでいれば積み直さない (2026-08-03)★ これが二重 push の唯一の防波堤。
    if (state.start_time && !state.history_pushed) {
      const report = getReport();
      // ★積めなかったら state を 消さずに false (2026-10-11)★
      //   前は 返事を 見ずに 消した＝積めない 晩の 業務が 事務所へ 上がらずに 黙って 消えた。
      if (_appendHistory(report) !== true) {
        save();
        return false;
      }
    }
    state = {
      active: false,
      start_time: null,
      end_time: null,
      ended: false,
      ended_at: null,
      total_distance_m: 0,
      actual_total_m: 0,
      fare_total_yen: 0,
      trip_count: 0,
      trips: [],
      last_meter_distance_m: 0,
      // 経由地点 + 住所表示機能 (2026-05-15・abandon で trip 進行中なら破棄)
      current_trip: null,
      history_pushed: false, // ★リセット後は「まだ積んでいない」★
      mienai_base: null, // ★業務が 無い間は 基準も 無い (2026-09-03)★
    };
    // ★ Phase 2: 業務破棄で business_active 完全停止
    if (typeof Meter !== 'undefined' && typeof Meter.setBusinessActive === 'function') {
      try {
        Meter.setBusinessActive(false);
      } catch (_) {
        /* noop */
      }
    }
    save();
    if (typeof dlog === 'function') dlog('[Business] abandon (history saved)');
    return true;
  }

  // ─────────────────────────────────────────
  // GPS受信 (業務中なら Meter ベースで total_distance_m を加算)
  // ─────────────────────────────────────────
  // 2026-05-09 設計変更 (P1/F1/F4 絶対ルール準拠):
  //   旧: GPS Haversine で独自に距離計算 (絶対ルール違反)
  //   新: Meter.getState().distance_m の差分を加算 (= MM 道路距離)
  //   gpsResult 引数は互換のため残すが内容は無視。
  //   意味:
  //     - state.total_distance_m = 業務開始からの全走行距離 (空車+実車)
  //     - 業務開始時 last_meter_distance_m = 0 (Meter は別途 reset 想定)
  //     - その後の各 GPS callback で
  //       diff = current Meter.distance_m - last_meter_distance_m
  //       diff > 0 なら state.total_distance_m += diff
  //   これにより MM 道路距離 (= 課金距離と一致) が業務集計にも反映される。
  let _lastGpsSaveAt = 0;
  // ★保存の 失敗を 画面へ 知らせる 受け口 (2026-10-11)★
  //   save() は 1秒ごとに 呼ばれるので、知らせるのは ★1つの 業務で 1回だけ★（start() で 戻す）。
  //   前は 空き不足を dlog だけで 飲み、アプリを 閉じると 今の 業務が 黙って 消えた。
  let _hozonShippaiFn = null;
  let _hozonShippaiShiraseta = false;
  const GPS_SAVE_INTERVAL_MS = 1000;
  let _lastDebugLogAt = 0;

  function onGps(_gpsResult) {
    if (!state.active) return;
    if (typeof Meter === 'undefined' || !Meter.getState) return;

    const meterState = Meter.getState();

    // ★設計変更宣言 (2026-05-14・total_distance_m を Meter 信源直結に変更):
    //   旧: cur - prev の diff を state.total_distance_m に累積
    //       問題: Meter.running=false (空車中) では Meter.distance_m が伸びないため、
    //             空車中の走行が total_distance_m に算入されない (= 司さん「総走行距離 0.23km」事象)
    //   新: Meter.state.business_distance_m を state.total_distance_m に sync。
    //       Meter 側は state.running を問わず業務単位累積を保持する。
    //       state.total_distance_m は永続化目的のミラー (localStorage save 経路維持)。
    //   getReport の total_distance_m は Meter.business_distance_m を直接返す経路に変更済 (下記)。
    state.total_distance_m = meterState.business_distance_m || 0;
    // last_meter_distance_m は legacy 互換のため Meter.distance_m を tracking (現状は未使用)
    state.last_meter_distance_m = meterState.distance_m || 0;

    // 5 秒間隔ログ
    const _logNow = Date.now();
    if (!_lastDebugLogAt || _logNow - _lastDebugLogAt > 5000) {
      _lastDebugLogAt = _logNow;
      if (typeof dlog === 'function')
        dlog(
          '[Business] total=' +
            (state.total_distance_m / 1000).toFixed(2) +
            'km' +
            ' (Meter.business_distance_m 信源・running=' +
            (meterState.running ? 'true' : 'false') +
            ')'
        );
    }

    // 1 秒間隔 save
    const nowMs = Date.now();
    if (nowMs - _lastGpsSaveAt >= GPS_SAVE_INTERVAL_MS) {
      _lastGpsSaveAt = nowMs;
      save();
    }
  }

  // ─────────────────────────────────────────
  // ★設計変更宣言 (2026-05-15・経由地点 + 住所表示機能):
  //   代行 1 件単位の住所トラッキング API 群。Meter.getNearestAddress に委譲し、
  //   返り値 null (= 取得失敗) でも例外を投げず業務継続性を維持する。
  //   呼び出し側 (index.html):
  //     onTripStart   : 代行開始ボタン押下時 (Meter.start 直後) に呼ぶ
  //     onWaypoint    : 経由地点ボタン押下時に呼ぶ
  //     setEndAddress : 確定ボタン (onSend) 押下時に呼ぶ (renderFare の経路カード描画用)
  //     getCurrentTrip: renderFare で経路情報を読む際に呼ぶ
  //   onTripEnd は既存 signature 維持・内部で current_trip を trips[] に統合してリセット。
  // ─────────────────────────────────────────
  // ★地名の 字の 形＝「市＋町」（丁目は 切る＝司さん 05-23「今治市常盤町」）★
  //   ★市の 名前は その 町が 持つ 市の 名前だけ★（2026-10-24 前は 一番 近い 市の 代表点で 付け「西条市郷桜井」に なった）
  //   ★「○○市 付近」は 出さない★（司さん 10-24「そんな曖昧にすんなや」）。地名の 引き方は _chimeiAt

  // 末尾「○丁目」(漢数字・算用数字・全角算用 両対応) をカット
  // 大字止まり (= "市坪西町") は・無変換で返却
  // ★名前が まるごと「○丁目」（花巻市十二丁目・春日部市八丁目・下田市一丁目〜六丁目＝全国 8区画）は 切らない★
  //   （2026-10-30・切ると 市の 名前 だけ＝「花巻市」に なって いた）
  function _cutChomeSuffix(name) {
    if (!name || typeof name !== 'string') return name;
    // 漢数字 (一二三四五六七八九十百千〇零) + 半角 0-9 + 全角 ０-９ の・1 つ以上 + "丁目" 末尾
    const cut = name.replace(/[一二三四五六七八九十百千〇零0-9０-９]+丁目$/, '');
    return cut === '' ? name : cut;
  }

  // ★設計変更宣言 (2026-05-23・住所① 案 C 高精度版・(B) map-matched snap 位置 cache):
  //   Worker B (map-matcher.js) が postMessage する mmResult.snap.snapLat / snapLng を
  //   index.html L5037 _mmWorkerOnMessage から・notifyMMSnap 経由で受信・cache。
  //   _safeGetNearestAddress が PIP 入力に・優先採用 (= GPS 揺れ吸収・川越え誤判定 軽減)。
  //   distance_m / map-matcher.js / meter.js 本体は・1 byte 不変 (= 既存出力を読むだけ)。
  let _lastMMSnap = null; // {lat, lng, t}
  let _lastRawGps = null; // {lat, lng, t} (= snap 前 raw GPS・停止中の現在地表示用)
  const _MM_SNAP_FRESH_MS = 5000; // 5 秒以内 = fresh
  const _RAW_GPS_FRESH_MS = 60000; // 60 秒以内 = fresh (= 屋内 GPS 停滞でも・1 分内は採用)

  function notifyMMSnap(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    if (!isFinite(lat) || !isFinite(lng)) return;
    _lastMMSnap = { lat: lat, lng: lng, t: Date.now() };
  }

  // ★設計変更宣言 (2026-05-23・住所② raw GPS 配信受信・停止中の現在地表示用):
  //   index.html GPS callback (= L6022 周辺) から・1Hz で・raw GPS lat/lng を・受信・cache。
  //   getCurrentLiveAddress の 3 段 fallback (= snap fresh → snap stale → raw GPS) で使用。
  //   絶対ルール準拠:
  //     ✓ distance_m / Meter / map-matcher / Worker B: 完全無関係 (= cache 更新のみ)
  //     ✓ gps.js / meter.js / gps-worker.js は・1 byte 不変
  function notifyRawGps(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    if (!isFinite(lat) || !isFinite(lng)) return;
    _lastRawGps = { lat: lat, lng: lng, t: Date.now() };
  }

  // ★設計変更宣言 (2026-05-23・住所② 現在地ライブ表示・常時表示版・3 段 fallback):
  //   走行中 / 停止中 を問わず・経路カード末尾に・現在地住所を・常時ライブ表示する用途。
  //   3 段 fallback で・「停止中 GPS drift で・snap 失敗」 でも・町名レベルで・必ず表示:
  //     ① snap fresh (= _MM_SNAP_FRESH_MS 5 秒以内) → snap 位置で・町名取得 (= 走行中の常道)
  //     ② snap stale + _lastMMSnap あり → 直近 snap 位置で・町名取得 (= 短時間停止・町名は不変)
  //     ③ raw GPS fresh (= _RAW_GPS_FRESH_MS 60 秒以内) → raw GPS 位置で・町名取得 (= 屋内 drift)
  //     ④ 全部無し → null (= 起動直後・GPS 未取得時のみ)
  //   町名レベル粒度のため・屋内 30m drift でも・同町名内なら・表示は・安定 (= ドリフト影響小)。
  //   絶対ルール準拠:
  //     ✓ distance_m / 課金 / Worker B / isStationary: 完全無関係 (= 表示用 cache を読むだけ)
  //     ✓ 新 logic ゼロ (= 既存 4 段 fallback _safeGetNearestAddress を・流用)
  //     ✓ 既存 onTripStart / onWaypoint / setEndAddress 等の・固定住所取得は・1 byte 不変
  //   消費側 (= index.html updateWaypointCardUI) で・既存 500ms timer から・呼び・末尾追記する。
  // ★現在地フリーズ根治しきい値 (2026-06-20・実機trace 497e5ded で確定)★:
  //   古い snap が生GPSからこれ以上離れたら「snapが死んで現在地が進んだ」とみなし生GPSへ切替。
  //   短時間停止のGPS drift(~10-30m)では切替えず snap保持(町名安定)。実機は石井町snapから17.5km離れて凍結。
  const _LIVE_ADDR_SNAP_DIVERGE_M = 150;
  function _haversineLiveM(aLat, aLng, bLat, bLng) {
    const R = 6371000,
      r = Math.PI / 180;
    const dLa = (bLat - aLat) * r,
      dLo = (bLng - aLng) * r;
    const s =
      Math.sin(dLa / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  // ★住所② 現在地の "位置源" を決める純粋関数 (副作用なし・テスト可能)★:
  //   ① snap新鮮 → snap / ② snap stale → 生GPSが新鮮かつ古snapから乖離なら ★生GPS(凍結解消)★・近接は snap保持
  //   / ③ snap無し+生GPS新鮮 → 生GPS / ④ 無し → null。距離/課金には一切関与しない(表示位置の選定のみ)。
  function _pickLiveAddrPos(o) {
    const now = o.now;
    const snap = o.mmSnap,
      raw = o.rawGps;
    // ① snap fresh
    if (snap && now - snap.t < _MM_SNAP_FRESH_MS)
      return { src: 'snap', lat: snap.lat, lng: snap.lng };
    // ② snap stale: 生GPSが新鮮 かつ 古snapから大きく離れてたら(=snap死亡・現在地が進んだ)生GPSで追従。
    //   近接(短時間停止drift)/生GPS不在/生GPS stale は snap保持(従来=町名安定・flicker防止)。
    if (snap) {
      if (raw && now - raw.t < _RAW_GPS_FRESH_MS) {
        if (_haversineLiveM(snap.lat, snap.lng, raw.lat, raw.lng) > _LIVE_ADDR_SNAP_DIVERGE_M)
          return { src: 'raw', lat: raw.lat, lng: raw.lng };
      }
      return { src: 'snap', lat: snap.lat, lng: snap.lng };
    }
    // ③ raw fresh
    if (raw && now - raw.t < _RAW_GPS_FRESH_MS) return { src: 'raw', lat: raw.lat, lng: raw.lng };
    // ④
    return null;
  }
  function getCurrentLiveAddress() {
    const pos = _pickLiveAddrPos({ mmSnap: _lastMMSnap, rawGps: _lastRawGps, now: Date.now() });
    if (!pos) return null;
    return _safeGetNearestAddress(pos.lat, pos.lng, null);
  }

  // ★★町の 境の 形（data/town-polygons-{pref}.js）★★
  //   v 2（2026-10-24）＝共有の 境の 線（arcs・差分の 整数）＋町は 線の 番号の 並び（r）。輪は 要る 町の 分だけ 組んで 溜める
  //   v 1（前の 形）＝町ごとの 輪（rings）。両方 読める（端末の 溜めに 前の 形が 残って いても 動く）
  //   grid＝1km の 升（町の bbox が 掛かる 升に 町の 番号）。初めて 引く 時に 作って 溜める
  const _townGridCache = new WeakMap();
  const _townArcCache = new WeakMap();
  const _TOWN_GRID_SIZE_INT = 1000;

  function _buildTownGrid(bundle) {
    const grid = {};
    const items = bundle.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.bbox || it.bbox.length !== 4) continue;
      const [latMin, lngMin, latMax, lngMax] = it.bbox;
      const tLatMin = Math.floor(latMin / _TOWN_GRID_SIZE_INT);
      const tLatMax = Math.floor(latMax / _TOWN_GRID_SIZE_INT);
      const tLngMin = Math.floor(lngMin / _TOWN_GRID_SIZE_INT);
      const tLngMax = Math.floor(lngMax / _TOWN_GRID_SIZE_INT);
      for (let tlat = tLatMin; tlat <= tLatMax; tlat++) {
        for (let tlng = tLngMin; tlng <= tLngMax; tlng++) {
          const key = tlat + '_' + tlng;
          if (!grid[key]) grid[key] = [];
          grid[key].push(i);
        }
      }
    }
    return grid;
  }

  function _getTownGrid(bundle) {
    if (!bundle) return null;
    let grid = _townGridCache.get(bundle);
    if (!grid) {
      grid = _buildTownGrid(bundle);
      _townGridCache.set(bundle, grid);
    }
    return grid;
  }

  // v 2 の 線を 絶対の 整数へ（線ごとに Int32Array [lat0, lng0, lat1, lng1, ...]）。県ごとに 1回
  //   配列の 配列（[[lat, lng], ...]）だと 全県で 1GB 近く なる（2026-10-24 実測 960MB）＝詰めた 整数で 持つ
  function _townArcs(bundle) {
    let a = _townArcCache.get(bundle);
    if (a) return a;
    a = (bundle.arcs || []).map(function (o) {
      const out = new Int32Array(o.length);
      let la = 0;
      let ln = 0;
      for (let i = 0; i < o.length; i += 2) {
        la += o[i];
        ln += o[i + 1];
        out[i] = la;
        out[i + 1] = ln;
      }
      return out;
    });
    _townArcCache.set(bundle, a);
    return a;
  }

  // 町の 輪（[外周, 穴...]・各 輪は 詰めた 整数 [lat0, lng0, lat1, lng1, ...]）。組んで 町に 溜める
  //   v 2＝線から 組む／v 1（前の 形・rings: [[lat, lng], ...]）＝詰め直す
  function _townRings(bundle, it) {
    if (it._rings) return it._rings;
    let rings = null;
    if (Array.isArray(it.r)) {
      const arcs = _townArcs(bundle);
      rings = it.r.map(function (refs) {
        let n = 0;
        for (let k = 0; k < refs.length; k++) {
          const arc = arcs[refs[k] < 0 ? ~refs[k] : refs[k]];
          if (arc) n += arc.length - (n ? 2 : 0);
        }
        const ring = new Int32Array(n);
        let p = 0;
        for (let k = 0; k < refs.length; k++) {
          const ref = refs[k];
          const arc = arcs[ref < 0 ? ~ref : ref];
          if (!arc) continue;
          const m = arc.length / 2;
          for (let j = p ? 1 : 0; j < m; j++) {
            const q = ref < 0 ? m - 1 - j : j;
            ring[p++] = arc[q * 2];
            ring[p++] = arc[q * 2 + 1];
          }
        }
        return ring;
      });
    } else if (Array.isArray(it.rings)) {
      rings = it.rings.map(function (r) {
        const ring = new Int32Array(r.length * 2);
        for (let i = 0; i < r.length; i++) {
          ring[i * 2] = r[i][0];
          ring[i * 2 + 1] = r[i][1];
        }
        return ring;
      });
    }
    if (rings) Object.defineProperty(it, '_rings', { value: rings, enumerable: false });
    return rings;
  }

  // 標準の ray casting（ring＝詰めた 整数 [lat0, lng0, ...] か [[lat, lng], ...]・閉じて いても いなくても 良い）
  function _pointInPolygon(latI, lngI, ring) {
    if (!ring) return false;
    const flat = typeof ring[0] === 'number';
    const n = flat ? ring.length / 2 : ring.length;
    if (n < 3) return false;
    let inside = false;
    let j = n - 1;
    for (let i = 0; i < n; i++) {
      const iLat = flat ? ring[i * 2] : ring[i][0];
      const iLng = flat ? ring[i * 2 + 1] : ring[i][1];
      const jLat = flat ? ring[j * 2] : ring[j][0];
      const jLng = flat ? ring[j * 2 + 1] : ring[j][1];
      if (
        iLng > lngI !== jLng > lngI &&
        latI < ((jLat - iLat) * (lngI - iLng)) / (jLng - iLng) + iLat
      ) {
        inside = !inside;
      }
      j = i;
    }
    return inside;
  }

  // 点を 囲む 町（外周に 入り・穴に 入らない）。戻り値: { n: '本町七丁目', c: '今治市', it, bundle } or null
  function _findTownPolygonAddress(lat, lng, bundle) {
    if (!bundle || !Array.isArray(bundle.items) || bundle.items.length === 0) return null;
    const COORD_SCALE = bundle.precision || 100000;
    const latI = Math.round(lat * COORD_SCALE);
    const lngI = Math.round(lng * COORD_SCALE);
    if (
      bundle.bbox &&
      (latI < bundle.bbox[0] ||
        latI > bundle.bbox[2] ||
        lngI < bundle.bbox[1] ||
        lngI > bundle.bbox[3])
    )
      return null;
    const grid = _getTownGrid(bundle);
    const tLat = Math.floor(latI / _TOWN_GRID_SIZE_INT);
    const tLng = Math.floor(lngI / _TOWN_GRID_SIZE_INT);
    const iterIdx = (grid && grid[tLat + '_' + tLng]) || [];
    for (let k = 0; k < iterIdx.length; k++) {
      const it = bundle.items[iterIdx[k]];
      if (!it || !it.bbox) continue;
      if (latI < it.bbox[0] || latI > it.bbox[2] || lngI < it.bbox[1] || lngI > it.bbox[3])
        continue;
      const rings = _townRings(bundle, it);
      if (!rings || rings.length === 0) continue;
      if (_pointInPolygon(latI, lngI, rings[0])) {
        let inHole = false;
        for (let r = 1; r < rings.length; r++) {
          if (_pointInPolygon(latI, lngI, rings[r])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return { n: it.n || '', c: it.c, it: it, bundle: bundle };
      }
    }
    return null;
  }

  // ★どの 町にも 入らない 点（岸壁・海の 際・県や 市の 境の 細い 隙）★ 2026-10-24
  //   境が _TOWN_NEAR_M 以内の 一番 近い 町。それより 遠い（海の 上 等）＝null（言い切らない・対立役 止4）
  const _TOWN_NEAR_M = 200;
  // 点と 線分（詰めた 整数の i 番目と i+1 番目の 点）の 距離 m（×1e5 の 平面近似・200m の 内なので 十分）
  function _segDistM(latI, lngI, ring, i) {
    const k = Math.cos((latI / 100000) * (Math.PI / 180));
    const ax = ring[i * 2 + 1] * k;
    const ay = ring[i * 2];
    const dx = ring[i * 2 + 3] * k - ax;
    const dy = ring[i * 2 + 2] - ay;
    const px = lngI * k;
    const py = latI;
    const L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy) * 1.1132; // 1e-5 度 ≒ 1.1132m
  }
  // 町の 境までの 一番 短い 距離 m
  function _edgeM(latI, lngI, rings) {
    let m = Infinity;
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      for (let i = 0; i + 3 < ring.length; i += 2) {
        const d = _segDistM(latI, lngI, ring, i / 2);
        if (d < m) m = d;
      }
    }
    return m;
  }
  function _nearestTown(lat, lng, bundle, maxM) {
    if (!bundle || !Array.isArray(bundle.items)) return null;
    const SC = bundle.precision || 100000;
    const latI = Math.round(lat * SC);
    const lngI = Math.round(lng * SC);
    const padI = Math.ceil(maxM / 1.1132) + 1;
    if (
      bundle.bbox &&
      (latI < bundle.bbox[0] - padI ||
        latI > bundle.bbox[2] + padI ||
        lngI < bundle.bbox[1] - padI * 2 ||
        lngI > bundle.bbox[3] + padI * 2)
    )
      return null;
    const grid = _getTownGrid(bundle);
    const seen = {};
    let best = null;
    let bestM = maxM;
    const t0 = Math.floor((latI - padI) / _TOWN_GRID_SIZE_INT);
    const t1 = Math.floor((latI + padI) / _TOWN_GRID_SIZE_INT);
    const u0 = Math.floor((lngI - padI * 2) / _TOWN_GRID_SIZE_INT);
    const u1 = Math.floor((lngI + padI * 2) / _TOWN_GRID_SIZE_INT);
    for (let t = t0; t <= t1; t++) {
      for (let u = u0; u <= u1; u++) {
        const idx = (grid && grid[t + '_' + u]) || [];
        for (let k = 0; k < idx.length; k++) {
          if (seen[idx[k]]) continue;
          seen[idx[k]] = 1;
          const it = bundle.items[idx[k]];
          if (!it || !it.bbox) continue;
          if (
            latI < it.bbox[0] - padI ||
            latI > it.bbox[2] + padI ||
            lngI < it.bbox[1] - padI * 2 ||
            lngI > it.bbox[3] + padI * 2
          )
            continue;
          const rings = _townRings(bundle, it);
          if (!rings) continue;
          const d = _edgeM(latI, lngI, rings);
          if (d < bestM) {
            bestM = d;
            best = it;
          }
        }
      }
    }
    return best ? { n: best.n, c: best.c, m: bestM } : null;
  }

  // 県名 → 束（window.TOWN_POLYGONS_{PREF}）
  function _resolveTownBundle(prefName) {
    if (typeof window === 'undefined' || !prefName) return null;
    const key = 'TOWN_POLYGONS_' + prefName.toUpperCase();
    return window[key] || null;
  }

  // 読み込めて いる 町の 束 全部（今の 県を 先に）
  function _loadedTownBundles(firstPref) {
    if (typeof window === 'undefined') return [];
    const out = [];
    const first = _resolveTownBundle(firstPref);
    if (first) out.push(first);
    const keys = Object.keys(window);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.indexOf('TOWN_POLYGONS_') !== 0) continue;
      const b = window[k];
      if (b && b !== first && Array.isArray(b.items)) out.push(b);
    }
    return out;
  }

  // 県の 当たり（荒い 点で 決める＝束を 先に 見る 順番に だけ 使う。地名の 字には 使わない）
  function _prefNameFromCoarseCity(cityName, lat, lng) {
    if (
      typeof window !== 'undefined' &&
      window.RegionHelper &&
      typeof window.RegionHelper.getCurrentPref === 'function'
    ) {
      try {
        const p = window.RegionHelper.getCurrentPref(lat, lng, null);
        if (p) return p;
      } catch (_) {
        // 県が 分からなくても 全部の 束を 見る
      }
    }
    return null;
  }

  // ★点の 地名（市＋町・丁目は 切る）★ 2026-10-24（司さん「そんな曖昧にすんなや どの都道府県でもきっちりやれ」）
  //   ① 読めて いる 町の 束で 点を 囲む 町（県の 境でも 隣の 県の 束で 当たる）
  //   ② 囲む 町が 無い（岸壁・細い 隙）＝境が 200m 以内の 一番 近い 町
  //   ③ その 辺りの 町の 束が まだ 無い ＝ 細かい 点（addresses-fine）の 500m 以内（その 点が 持つ 市の 名前）
  //   ④ どれも 無い ＝ null（やり直しで 埋める）
  //   ★「○○市 付近」は 出さない・市の 名前を 一番 近い 市の 代表点で 付けない★
  //   （前は 隙間に 落ちると 代表点が 近い 隣の 市＝今治市郷桜井 が「西条市 付近」「西条市郷桜井」に なった）
  function _chimeiAt(lat, lng) {
    const bundles = _loadedTownBundles(_prefNameFromCoarseCity(null, lat, lng));
    // ★県の 境で 両側の 県の 町が 重なる（元データ 自体が 重なる・宮城と岩手 等）＝境から 一番 深く 入って いる 方★
    let hit = null;
    let hitM = -1;
    const la = Math.round(lat * 100000);
    const ln = Math.round(lng * 100000);
    for (let i = 0; i < bundles.length; i++) {
      const r = _findTownPolygonAddress(lat, lng, bundles[i]);
      if (!r || !(r.n || r.c)) continue;
      if (!hit) {
        hit = r;
        continue;
      }
      if (hitM < 0) hitM = _edgeM(la, ln, _townRings(hit.bundle, hit.it));
      const m = _edgeM(la, ln, _townRings(r.bundle, r.it));
      if (m > hitM) {
        hit = r;
        hitM = m;
      }
    }
    // 町の 名前が 無い 区画（町字に 分かれて いない 町村）は 市町村の 名前だけ
    if (hit) return { s: (hit.c || '') + _cutChomeSuffix(hit.n || ''), how: 'pip' };
    let near = null;
    for (let i = 0; i < bundles.length; i++) {
      const r = _nearestTown(lat, lng, bundles[i], near ? near.m : _TOWN_NEAR_M);
      if (r && (!near || r.m < near.m)) near = r;
    }
    if (near) return { s: (near.c || '') + _cutChomeSuffix(near.n || ''), how: 'near' };
    // 町の 束が この 辺りを 覆って いる のに 当たらない＝海の 上 等（細かい 点で 言い切らない）
    if (_townCovers(bundles, lat, lng)) return null;
    const f = _nearestFine(lat, lng);
    if (f) return { s: (f.c || '') + _cutChomeSuffix(f.n), how: 'fine' };
    return null;
  }

  // ★この 点の まわりを 町の 束が 覆って いるか★＝点の 1km の 升に 町が 掛かる 束が 読めて いる
  //   前は 束の 外枠（県の bbox）で 決めた＝東京の 外枠は 小笠原まで 含み 神奈川・千葉・静岡を まるごと 覆う
  //   ⇒ 隣の 県の 束しか 無い 間に 引くと「覆って いる」と 見て 細かい 点も やり直しも 飛ばし 空の まま（対立役 止2）
  function _townCovers(bundles, lat, lng) {
    for (let i = 0; i < bundles.length; i++) {
      const b = bundles[i];
      const SC = b.precision || 100000;
      // ★束の 外枠の 外なら 升を 作らない★（全県の 升を 作ると +100MB・海の 1回 0.8秒＝対立役 2回目 止A）
      const la = Math.round(lat * SC);
      const ln = Math.round(lng * SC);
      if (b.bbox && (la < b.bbox[0] || la > b.bbox[2] || ln < b.bbox[1] || ln > b.bbox[3]))
        continue;
      const grid = _getTownGrid(b);
      const key =
        Math.floor(Math.round(lat * SC) / _TOWN_GRID_SIZE_INT) +
        '_' +
        Math.floor(Math.round(lng * SC) / _TOWN_GRID_SIZE_INT);
      if (grid && grid[key] && grid[key].length) return true;
    }
    return false;
  }
  // 細かい 点（window.ADDRESSES_FINE_{PREF}・{lat, lng, n, c}）の 500m 以内で 一番 近い 点
  const _FINE_NEAR_M = 500;
  function _nearestFine(lat, lng) {
    if (typeof window === 'undefined') return null;
    const latI = Math.round(lat * 100000);
    const lngI = Math.round(lng * 100000);
    const k = Math.cos(lat * (Math.PI / 180));
    let best = null;
    let bestM = _FINE_NEAR_M;
    const keys = Object.keys(window);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].indexOf('ADDRESSES_FINE_') !== 0) continue;
      const b = window[keys[i]];
      const items = b && b.items;
      if (!Array.isArray(items)) continue;
      for (let j = 0; j < items.length; j++) {
        const it = items[j];
        if (!it || !it.c) continue; // 市の 名前を 持たない 点は 使わない（市を 当てずっぽうで 付けない）
        const dLa = it.lat - latI;
        if (dLa > 520 || dLa < -520) continue;
        const dLn = it.lng - lngI;
        if (dLn > 700 || dLn < -700) continue;
        const m = Math.hypot(dLa, dLn * k) * 1.1132;
        if (m < bestM) {
          bestM = m;
          best = it;
        }
      }
    }
    return best;
  }

  function _safeGetNearestAddress(lat, lng, _accuracy) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) {
      return null;
    }
    // 走って いる 時は 道に 合わせた 点（GPS の 揺れを 吸う）を 先に。外れたら 生の 点
    if (_lastMMSnap && Date.now() - _lastMMSnap.t < _MM_SNAP_FRESH_MS) {
      const s = _chimeiAt(_lastMMSnap.lat, _lastMMSnap.lng);
      if (s) {
        if (typeof dlog === 'function') dlog('[ADDR] snap ' + s.how + ' "' + s.s + '"');
        return s.s;
      }
    }
    const r = _chimeiAt(lat, lng);
    if (typeof dlog === 'function') dlog('[ADDR] raw ' + (r ? r.how + ' "' + r.s + '"' : 'null'));
    return r ? r.s : null;
  }

  // ★★地名の やり直し★★（2026-05-15 → 2026-10-24 作り直し・対立役 止1 止2）
  //   地名が null の 時（町の 束が まだ 届いて いない・代行開始の 時に GPS が 無い）に、後で 埋める。
  //   前の 作り＝1秒ごと 5回だけ・「荒い 点が 読めたら やり直さない」・支払い（onTripEnd）で 打ち切り
  //     ⇒ 荒い 点は 起動で すぐ 読める＝やり直しが 始まらず、支払いの 後も 空の まま、開始の GPS が 無いと 二度と 埋まらない
  //   今＝2秒ごと・10分まで。支払いの 後も 記録（state.trips の その 代行）へ 書き戻す。
  //       座標が 無い 出発地は、その 後に 届いた GPS で 埋める。データが 揃って いて 当たらない（海の 上 等）時は やめる。
  //   解けたら window の 'business:address-resolved' で 画面へ 知らせる（前と 同じ）。
  const _ADDR_RETRY_INTERVAL_MS = 2000;
  const _ADDR_RETRY_MAX_MS = 10 * 60 * 1000;
  let _addrPending = []; // { kind, lat, lng, accuracy, target, wp, t0 }
  let _addrTimer = null;
  const _ADDR_FIELD = { start: 'start_address', end: 'end_address' };

  function _addrIsResolved(p) {
    if (p.kind === 'waypoint') return !p.wp || p.wp.address != null;
    return !p.target || p.target[_ADDR_FIELD[p.kind]] != null;
  }

  function _addAddrPending(kind, lat, lng, accuracy, target, wp) {
    _addrPending.push({
      kind: kind,
      lat: typeof lat === 'number' && isFinite(lat) ? lat : null,
      lng: typeof lng === 'number' && isFinite(lng) ? lng : null,
      accuracy: accuracy,
      target: target,
      wp: wp || null,
      // 履歴（daikou_history_<日付>）の 鍵＝代行開始の 時刻・経由地の 何番目
      tripKey: target && target.start_time ? target.start_time : null,
      wpIdx: wp && target && Array.isArray(target.waypoints) ? target.waypoints.indexOf(wp) : -1,
      t0: Date.now(),
    });
    if (!_addrTimer) _addrTimer = setInterval(_addrTick, _ADDR_RETRY_INTERVAL_MS);
  }

  function _addrTick() {
    const now = Date.now();
    const keep = [];
    for (let i = 0; i < _addrPending.length; i++) {
      const p = _addrPending[i];
      if (_addrIsResolved(p) || now - p.t0 > _ADDR_RETRY_MAX_MS) continue;
      // 座標が 無い（開始の 時に GPS が 無かった）＝その 後に 届いた GPS を 使う
      if (p.lat == null && _lastRawGps && _lastRawGps.t >= p.t0) {
        p.lat = _lastRawGps.lat;
        p.lng = _lastRawGps.lng;
      }
      if (p.lat == null) {
        keep.push(p);
        continue;
      }
      // ★待って いる 点 そのものを 引く★（_safeGetNearestAddress は 5秒 以内の 道に 合わせた 点＝今の 車の 場所を 先に 使う
      //   ＝車が 動いた 後に 形が 届くと 行って いない 町を 書いた・1km で 200点中 115〜137点＝対立役 3回目 止C）
      const r = _chimeiAt(p.lat, p.lng);
      const addr = r ? r.s : null;
      if (addr) {
        _addrSet(p, addr);
        continue;
      }
      // ★当たらなくても 10分 までは 続ける★（自分の 県の 形が まだ 届かない 間に 隣の 県の 升が 掛かると「揃って いる」と 見て
      //   やめて しまい 空の まま 残った・全県 2km おきで 5.1%＝対立役 2回目 止B）。2秒に 1回 引く だけ
      keep.push(p);
    }
    _addrPending = keep;
    if (!_addrPending.length && _addrTimer) {
      clearInterval(_addrTimer);
      _addrTimer = null;
    }
  }

  function _addrSet(p, addr) {
    let waypointIdx = null;
    if (p.kind === 'waypoint') {
      p.wp.address = addr;
      const wps = p.target && p.target.waypoints;
      if (Array.isArray(wps)) waypointIdx = wps.indexOf(p.wp);
    } else {
      p.target[_ADDR_FIELD[p.kind]] = addr;
    }
    save();
    _addrKakimodosu(p, addr);
    if (typeof dlog === 'function') {
      dlog('[Business] address retry resolved (kind=' + p.kind + ') => ' + addr);
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(
          new CustomEvent('business:address-resolved', {
            detail: { kind: p.kind, address: addr, waypointIdx: waypointIdx },
          })
        );
      } catch (_) {
        // 画面へ 知らせられなくても 記録には 書けて いる
      }
    }
  }

  // ★業務を 閉じた 後に 解けた 地名を 控えへも 書き戻す★ 2026-10-24（対立役 止3）
  //   end() は その 時点の 写しを 事務所へ 送る 控え（daikou_business_history）に 積み、清算の 時に 運転手の 履歴
  //   （daikou_history_<日付>）にも 写しを 取る＝state だけ 直しても 事務所にも 履歴にも 空の まま 残った
  //   ・控え＝同じ 業務（start_time）の 同じ 順番の 代行の 空の 欄だけ 埋め、送った 印を 外す（直した 版を 送り直す）
  //   ・履歴＝trip_key（代行開始の 時刻）が 同じ 行の 空の 欄だけ 埋める
  //   ★書けなくても 業務は 止めない（throw しない）★
  function _addrKakimodosu(p, addr) {
    const umeru = function (t) {
      if (!t) return false;
      if (p.kind === 'waypoint') {
        const w = Array.isArray(t.waypoints) ? t.waypoints[p.wpIdx] : null;
        if (!w || w.address != null) return false;
        w.address = addr;
        return true;
      }
      const k = _ADDR_FIELD[p.kind];
      if (t[k] != null) return false;
      t[k] = addr;
      return true;
    };
    try {
      // 控えの 中の 同じ 代行＝開始と 終わりの 時刻が 同じ 行（業務の 何番目かで なく 時刻で 探す＝閉じて すぐ 次の 業務を 始めても 届く）
      const t = p.target;
      if (t && typeof t.end_time === 'number') {
        const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        let kaita = false;
        (Array.isArray(list) ? list : []).forEach(function (r) {
          if (!r || !Array.isArray(r.trips)) return;
          r.trips.forEach(function (x) {
            if (x && x.start_time === t.start_time && x.end_time === t.end_time && umeru(x)) {
              kaita = true;
              _unsealSynced(r.start_time);
            }
          });
        });
        if (kaita) localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
      }
    } catch (_) {
      // 控えに 書けなくても state には 入って いる
    }
    try {
      if (!p.tripKey || typeof localStorage.key !== 'function') return;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || key.indexOf('daikou_history_') !== 0) continue;
        const hist = JSON.parse(localStorage.getItem(key) || '[]');
        if (!Array.isArray(hist)) continue;
        const e = hist.find(function (x) {
          return x && x.trip_key === p.tripKey;
        });
        if (e && umeru(e)) localStorage.setItem(key, JSON.stringify(hist));
      }
    } catch (_) {
      // 履歴に 書けなくても state には 入って いる
    }
  }

  // 支払いで 代行が 記録（state.trips）へ 移ったら、やり直しの 書き先も 記録へ 移す
  function _addrRetarget(fromTrip, toRecord) {
    for (let i = 0; i < _addrPending.length; i++) {
      if (_addrPending[i].target === fromTrip) _addrPending[i].target = toRecord;
    }
  }

  // ★請求書払い(掛け)先の紐付け (2026-07-31・司さん要件)★
  //   実車中に「請求書」ボタンで会社を選ぶと、その代行が掛けとして残る。
  //   その客が誰の掛けかを知っているのは現場のドライバーだけなので、その場で1タップで紐付ける。
  //   ・料金/距離には一切影響しない(記録用の付箋を貼るだけ)。
  //   ・代行が始まっていない時に押しても、変な値が来ても、絶対に落ちない(業務を止めない)。
  //   ・会社名は「その時の名前」を焼き付ける(後でマスタから消えても過去の請求書が壊れない)。
  //   ★2026-08-05 「誰が乗ったか」も一緒に貼れるようにした★
  //     標様建設は請求書を「会長／社長／専務」で分けて小計を出す(companies.config.noteGroups)。
  //     メーターに選ぶ所が無く、★その会社の行だけ備考が空で上がって仕分けから外れていた★。
  //     customerNote は請求書の備考にそのまま入る。会社を選び直したら消える(前の客のが残ると事故)。
  function setTripCustomer(customerId, customerName, customerNote) {
    try {
      if (!state.current_trip) return false; // 代行が始まっていない = 貼る先が無い(黙って何もしない)
      const id = typeof customerId === 'string' && customerId ? customerId : null;
      state.current_trip.customer_id = id;
      state.current_trip.customer_name =
        id && typeof customerName === 'string' ? customerName : null;
      state.current_trip.customer_note =
        id && typeof customerNote === 'string' && customerNote ? customerNote : null;
      save();
      return true;
    } catch (_) {
      return false; // ★絶対に throw しない★
    }
  }

  // 「誰が乗ったか」だけを後から貼る(会社は変えない)。会社未選択なら何もしない。
  function setTripCustomerNote(customerNote) {
    try {
      const t = state.current_trip;
      if (!t || !t.customer_id) return false;
      t.customer_note = typeof customerNote === 'string' && customerNote ? customerNote : null;
      save();
      return true;
    } catch (_) {
      return false;
    }
  }

  // 今どの掛け先が選ばれているか(画面表示用)。未選択なら null。
  function getTripCustomer() {
    try {
      const t = state.current_trip;
      if (!t || !t.customer_id) return null;
      return {
        customer_id: t.customer_id,
        customer_name: t.customer_name || null,
        customer_note: t.customer_note || null,
      };
    } catch (_) {
      return null;
    }
  }

  // 代行開始時の出発地住所取得 + current_trip 初期化
  function onTripStart(lat, lng, accuracy) {
    const startAddr = _safeGetNearestAddress(lat, lng, accuracy);
    state.current_trip = {
      start_time: Date.now(),
      start_address: startAddr,
      waypoints: [],
      end_address: null,
      // 掛け先は代行ごとにまっさら(前の客の掛けが次に付いたら事故)
      customer_id: null,
      customer_name: null,
      customer_note: null, // 誰が乗ったか(会長/社長/専務など)。前の客のが残ったら事故なので必ず消す
    };
    save();
    if (typeof dlog === 'function') {
      dlog(
        '[Business] onTripStart start_address=' +
          (startAddr || '(null)') +
          ' addrReady=' +
          (typeof Meter !== 'undefined' && Meter.isAddressDataReady
            ? Meter.isAddressDataReady()
            : '?')
      );
    }
    // 地名が 無い（データ待ち・開始の 時に GPS が 無い）＝後で 埋める（座標が 無ければ 次の GPS で）
    if (!startAddr) _addAddrPending('start', lat, lng, accuracy, state.current_trip, null);
    return startAddr;
  }

  // 経由地点記録 (押下回数ごとに waypoints に追加)
  // 戻り値: 記録した住所文字列 (null なら住所取得失敗)
  function onWaypoint(lat, lng, accuracy) {
    if (!state.current_trip) {
      // trip 進行中でない場合は記録対象なし (絶対ルール: 業務継続性のため例外は投げない)
      return null;
    }
    const addr = _safeGetNearestAddress(lat, lng, accuracy);
    state.current_trip.waypoints.push({
      address: addr,
      timestamp: Date.now(),
    });
    const waypointIdx = state.current_trip.waypoints.length - 1;
    save();
    if (typeof dlog === 'function') {
      dlog(
        '[Business] onWaypoint #' +
          state.current_trip.waypoints.length +
          ' address=' +
          (addr || '(null)')
      );
    }
    if (!addr && lat != null && lng != null)
      _addAddrPending(
        'waypoint',
        lat,
        lng,
        accuracy,
        state.current_trip,
        state.current_trip.waypoints[waypointIdx]
      );
    return addr;
  }

  // 確定ボタン押下時の到着地住所取得 (renderFare 直前に呼ぶ・current_trip に保持)
  function setEndAddress(lat, lng, accuracy) {
    if (!state.current_trip) return null;
    const endAddr = _safeGetNearestAddress(lat, lng, accuracy);
    state.current_trip.end_address = endAddr;
    save();
    if (typeof dlog === 'function') {
      dlog('[Business] setEndAddress end_address=' + (endAddr || '(null)'));
    }
    if (!endAddr && lat != null && lng != null)
      _addAddrPending('end', lat, lng, accuracy, state.current_trip, null);
    return endAddr;
  }

  // 進行中の trip 情報を返す (renderFare の経路カード描画用)
  function getCurrentTrip() {
    if (!state.current_trip) return null;
    return {
      start_time: state.current_trip.start_time,
      start_address: state.current_trip.start_address,
      end_address: state.current_trip.end_address,
      waypoints: state.current_trip.waypoints.slice(),
    };
  }

  // ─────────────────────────────────────────
  // 実車終了通知（実車総距離・売上・回数加算）
  // ─────────────────────────────────────────
  // 呼び出し側（index.html の支払ボタン処理）が
  // Meter.getState().distance_m と fare_yen を渡してくる
  function onTripEnd(distanceM, fareYen, tripStartTime) {
    if (!state.active) {
      if (typeof dlog === 'function') dlog('[Business] onTripEnd ignored (not active)');
      return false;
    }
    if (typeof distanceM !== 'number' || distanceM < 0) return false;
    if (typeof fareYen !== 'number' || fareYen < 0) return false;

    state.actual_total_m += distanceM;
    state.fare_total_yen += fareYen;
    state.trip_count += 1;
    // ★設計変更宣言 (2026-05-15・経由地点 + 住所表示機能):
    //   trip オブジェクトに current_trip の住所トラッキング情報を統合する。
    //   start_address/end_address/waypoints は null でも push (業務継続性最優先・
    //   絶対ルール: 住所取得失敗でも代行確定を絶対に止めない)。
    const currentTrip = state.current_trip || {
      start_address: null,
      end_address: null,
      waypoints: [],
    };
    // ★掛け先(請求書払い)を代行に焼き付ける (2026-07-31)。未選択なら現金。
    //   距離/料金には一切影響しない(記録用の付箋)。
    const _custId = currentTrip.customer_id || null;
    state.trips.push({
      distance_m: distanceM,
      fare_yen: fareYen,
      start_time: tripStartTime || currentTrip.start_time || null,
      end_time: Date.now(),
      start_address: currentTrip.start_address,
      end_address: currentTrip.end_address,
      waypoints: currentTrip.waypoints.slice ? currentTrip.waypoints.slice() : [],
      customer_id: _custId,
      customer_name: _custId ? currentTrip.customer_name || null : null,
      // ★誰が乗ったか(会長/社長/専務など)★ 請求書の備考に入り、そこで小計が分かれる
      customer_note: _custId ? currentTrip.customer_note || null : null,
      payment_type: _custId ? 'invoice' : 'cash',
    });
    // 地名の やり直しが 残って いれば 書き先を 記録へ（支払いの 後に 解けても 空の まま に しない）
    if (state.current_trip) _addrRetarget(state.current_trip, state.trips[state.trips.length - 1]);
    // 統合後 current_trip はリセット (次の代行で onTripStart が新規初期化する)
    state.current_trip = null;
    save();
    if (typeof dlog === 'function') {
      dlog(
        '[Business] trip end: ' +
          Math.round(distanceM) +
          'm, ¥' +
          fareYen +
          ' (trip #' +
          state.trip_count +
          ')'
      );
    }
    return true;
  }

  // ─────────────────────────────────────────
  // 取得・集計
  // ─────────────────────────────────────────
  function getState() {
    return {
      ...state,
      trips: [...state.trips],
      mae_tsumenai: _mae.slice(),
      // ★持ち越しが 手元に しか 無い（書けた 結果で 決める・見込みの 空きで 決めない）★
      mae_kakenai: _mae.length > 0 && !_maeKaketa,
    };
  }

  // 日報集計
  function getReport() {
    // ★設計変更宣言 (2026-05-14・total_distance_m を Meter 信源直結に変更):
    //   旧: state.total_distance_m を返す (= Business.onGps の diff 累積結果)
    //   新: Meter.getState().business_distance_m を直接返す (= 業務開始から終了までの全走行距離・
    //       state.running=true/false 問わず累積されている値)
    //   フォールバック: Meter 未ロード時は state.total_distance_m (永続化ミラー値) を返す。
    let totalM = state.total_distance_m;
    if (typeof Meter !== 'undefined' && typeof Meter.getState === 'function') {
      try {
        const _ms = Meter.getState();
        // ★設計変更宣言 (2026-05-19・混同#5 修正・getReport ガード強化):
        //   旧: typeof === 'number' のみ → 0 でも上書き = fallback (state.total_distance_m) 失効
        //   新: > 0 ガード追加 → 業務終了直後の businessEnd 経路で 0 上書きされても
        //       永続化ミラー値 (state.total_distance_m) が fallback として効く保険。
        //   注: 混同#4 修正 (businessEnd で business_distance_m=0 撤廃) で本ガードは
        //       通常経路では発火しないが・想定外の 0 経路 (= タスクキル復帰直後等) の保険として残置。
        if (_ms && typeof _ms.business_distance_m === 'number' && _ms.business_distance_m > 0) {
          totalM = _ms.business_distance_m;
        }
        // ★設計変更宣言 (2026-05-24・business preview 完全別回路・表示式 即時化):
        //   業務総走行距離 = business_distance_m + business_tier2_pending_m (= preview 込み即時表示)
        //   ・state.total_distance_m mirror sync (= L244 周辺) は・素のまま (= 永続化用)
        //   ・getReport (= 表示用) のみ・preview 込みで返す
        //   ・課金 driveDist = distance_m + tier2_pending_m とは・完全別計算
        //   ・課金変数 tier2_pending_m は・本ブロックでも・touch しない
        // ★設計変更宣言 (2026-05-24・表示層 予測補間・business_display_distance_m 採用):
        //   業務 totalDist を・滑らか化するため・Meter.business_display_distance_m を・優先採用。
        //   business_display_distance_m = max(business_distance_m + business_tier2_pending_m,
        //                                     予測補間値) で・stair-step 解消・単調増加保証。
        //   ★ business_distance_m / business_tier2_pending_m の・実値は・1 byte 不変 ★
        //   ★ Meter 未提供時 / 0 時は・既存 totalM (= 素の合算) fallback ★
        if (
          _ms &&
          typeof _ms.business_display_distance_m === 'number' &&
          _ms.business_display_distance_m > 0
        ) {
          totalM = _ms.business_display_distance_m;
        } else if (
          _ms &&
          typeof _ms.business_tier2_pending_m === 'number' &&
          _ms.business_tier2_pending_m > 0
        ) {
          // fallback: business_display 未提供時・preview 込み素合算
          totalM = (totalM || 0) + _ms.business_tier2_pending_m;
        }
      } catch (_) {
        /* Meter.getState 失敗時は state.total_distance_m (ミラー値) を返す */
      }
    }
    const actualM = state.actual_total_m;
    const emptyM = Math.max(0, totalM - actualM); // 整合性保証
    const elapsedMs = state.end_time
      ? state.end_time - (state.start_time || state.end_time)
      : state.start_time
        ? Date.now() - state.start_time
        : 0;
    const elapsedH = elapsedMs / 3600000;
    const _mie = _mienaiSa(); // ★1回だけ 出す（getReport は 画面から 何度も 呼ばれる）★

    return {
      start_time: state.start_time,
      end_time: state.end_time,
      elapsed_sec: Math.floor(elapsedMs / 1000),

      total_distance_m: totalM,
      actual_total_m: actualM,
      empty_distance_m: emptyM,

      fare_total_yen: state.fare_total_yen,
      trip_count: state.trip_count,

      // 集計値（ゼロ割回避）
      actual_ratio: totalM > 0 ? actualM / totalM : 0,
      avg_fare_yen: state.trip_count > 0 ? Math.round(state.fare_total_yen / state.trip_count) : 0,
      avg_speed_kmh: elapsedH > 0 ? totalM / 1000 / elapsedH : 0,

      // ★「見えなかった分」＝この業務ぶんの 差 (2026-09-03)★
      //   ★job-sync が この名前で そのまま 倉庫へ 上げます★（shift.mienai_*）
      //   ★取れない時は null★（0 と 書かない）／★距離にも 料金にも 触っていません★
      mienai_kaisuu: _mie.kaisuu,
      mienai_byou: _mie.byou,
      mienai_m: _mie.m,

      trips: [...state.trips],
    };
  }

  // ─────────────────────────────────────────
  // ─────────────────────────────────────────
  // 永続化
  // ─────────────────────────────────────────
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      if (typeof dlog === 'function') dlog('[Business] save error: ' + e.message);
      if (!_hozonShippaiShiraseta && typeof _hozonShippaiFn === 'function') {
        _hozonShippaiShiraseta = true;
        try {
          _hozonShippaiFn();
        } catch (_) {
          /* 知らせで 転んでも 業務は 止めない */
        }
      }
      return false;
    }
  }

  // 持ち越しを 手元と MAE_KEY に 置く（書けなくても 手元には 持つ・空なら 鍵を 消す）
  function _maeOku(list) {
    _mae = list;
    // ★読めない 字が 退けられずに 残っている 間は 鍵を 消さない・上書きしない★（10-11）
    if (_maeYomenai != null) {
      try {
        _kowaretaWoNokosu(MAE_KEY + '_kowareta', _maeYomenai);
        _maeYomenai = null; // 退けられた＝鍵を 使って よい
      } catch (_) {
        _maeKaketa = list.length === 0; // 手元にしか 無い（持ち越しが 在れば「閉じると 消える」）
        return;
      }
    }
    try {
      if (list.length === 0) localStorage.removeItem(MAE_KEY);
      else localStorage.setItem(MAE_KEY, JSON.stringify(list));
      _maeKaketa = true;
    } catch (_) {
      // 書けなくても 手元の 持ち越しで 次の 終了に 積み直す（画面は「閉じると 消える」と 言う）
      _maeKaketa = false;
    }
  }

  // MAE_KEY から 持ち越しを 戻す（読めない・配列でない 時は 空・中身の 無い 札は 落とす）
  function _maeYomu() {
    let raw = null;
    try {
      raw = localStorage.getItem(MAE_KEY);
      const a = JSON.parse(raw || '[]');
      if (Array.isArray(a)) return a.filter((r) => r && typeof r === 'object');
    } catch (_) {
      /* 下で 退ける */
    }
    // ★読めない 持ち越しは 退けてから 空に する★（次の _maeOku([]) が 消しても 字は 残る・10-11）
    //   退けられない 時は _maeYomenai に 持ち、_maeOku が 鍵に 触らない（消さない）。
    if (raw != null) {
      try {
        _kowaretaWoNokosu(MAE_KEY + '_kowareta', raw);
      } catch (_) {
        _maeYomenai = raw;
      }
    }
    return [];
  }

  // 読めなかった 字を 退ける（同じ 字は 同じ 鍵＝呼ぶ 度に 写しが 増えない）。書けなければ 投げる
  function _kowaretaWoNokosu(saki, raw) {
    const ji = String(raw);
    let h = 5381;
    for (let i = 0; i < ji.length; i++) h = ((h * 33) ^ ji.charCodeAt(i)) >>> 0;
    const k = saki + '_' + h.toString(36) + '_' + ji.length;
    if (localStorage.getItem(k) !== ji) localStorage.setItem(k, ji);
  }

  // 持ち越しの 報告を 積み直す（積めた 物を 外し、残りを 返す）
  function _maeWoTsumu(list) {
    if (!Array.isArray(list) || list.length === 0) return [];
    return list.filter((r) => _appendHistory(r) !== true);
  }

  // 保存の 失敗を 知らせる 関数を 登録する（index.html が 起動時に 呼ぶ）
  function onHozonShippai(fn) {
    _hozonShippaiFn = fn;
  }

  function load() {
    // 持ち越しは state と 別に 戻す（state が 無くても）
    // ★業務中の load()（便の 直し js/trip-edit.js）で 手元にしか 無い 持ち越しを 消さない★（10-11）
    //   書けて いない 手元の 分は 残して 読んだ 分と 足し合わせ、印は 書けた 結果でしか 下ろさない。
    const yonda = _maeYomu();
    if (!_maeKaketa && _mae.length > 0) {
      const aru = Object.create(null);
      _mae.forEach((r) => {
        aru[String(r.start_time)] = true;
      });
      _mae = _mae.concat(yonda.filter((r) => !aru[String(r.start_time)]));
    } else {
      _mae = yonda;
      _maeKaketa = true; // 倉庫から 読めた＝書けている
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;
      // 必須プロパティ補完（バージョン差分対策）
      state = {
        active: !!parsed.active,
        start_time: parsed.start_time || null,
        end_time: parsed.end_time || null,
        ended: !!parsed.ended,
        ended_at: parsed.ended_at || null,
        total_distance_m: parsed.total_distance_m || 0,
        actual_total_m: parsed.actual_total_m || 0,
        fare_total_yen: parsed.fare_total_yen || 0,
        trip_count: parsed.trip_count || 0,
        trips: Array.isArray(parsed.trips) ? parsed.trips : [],
        last_meter_distance_m: parsed.last_meter_distance_m || 0,
        // ★設計変更宣言 (2026-05-25・既存バグ修正・load() current_trip 復元漏れ):
        //   2026-05-15 (41ada48a9・current_trip 機能追加 commit) から・load 復元側に・配線漏れ。
        //   save() は state 全体を JSON.stringify するが・load() の・必須プロパティ補完で・本プロパティが・抜けていた。
        //   タスクキル → 再起動で・出発地住所・経由地点リスト・カウントが・巻き戻る現象の・根本原因。
        //   絶対ルール準拠: distance_m / 課金 / 他 state / Meter には・触らない・1 行追加のみ。
        //   null/undefined/object 全パターン安全 (= '|| null' で吸収・参照 18 箇所は全て null ガード済)。
        current_trip: parsed.current_trip || null,
        // ★2026-08-03★ ここを復元し忘れると、開き直したあとに同じ勤務が二重に積まれる
        history_pushed: !!parsed.history_pushed,
        // ★2026-09-03★ ここを復元し忘れると、開き直したあとに
        //   ★業務開始からの 差が 出せなくなる★（積み上がった数を そのまま 入れてしまう）
        mienai_base: parsed.mienai_base || null,
      };
      // ★設計変更宣言 (2026-05-14): ロード後の自動 abandon (checkAutoAbandon) は撤去。
      //   limbo (ended=true / start_time!=null) はそのまま維持・代行開始時に abandon() で履歴 push。
      // ★設計変更宣言 (2026-05-14・business_distance_m 復元):
      //   タスクキル後の再起動で active 業務が復元された場合、saved state.total_distance_m を
      //   Meter.business_distance_m に逆流させて連続性を確保する。
      //   Meter は新規 load で business_distance_m=0 で起動するため、prime しないと
      //   復元直後の getReport().total_distance_m が 0 にリセットされてしまう。
      // ★バグ修正 (2026-06-20・「業務終了→(再読込)→再開で総走行距離が 0 に戻る」根治):
      //   旧: state.active 限定で復元 → 業務終了 (active=false・limbo 状態) の後に
      //       アプリが再読込/タスクキルされると、再起動時の load() がこの prime を skip し
      //       Meter.business_distance_m=0 のまま起動する。続く「業務再開」(onBusinessResume /
      //       onResumeFromStart → Business.resume()) は active を true に戻すだけで距離を
      //       復元しないため、getReport().total_distance_m=0 → 総走行距離が 0.00 に落ちる事象。
      //   新: active だけでなく resumable limbo (start_time あり) も復元対象に含める。
      //       ・「業務再開」すれば前業務の総走行が正しく継続する。
      //       ・「代行開始」(新規業務) を選んだ場合は start() が setBusinessDistance(0) で
      //         0 化するため二重化や残留はなく無害。
      //   ★ business_distance_m は永続化ミラー (state.total_distance_m) からの復元のみで、
      //     distance_m / 課金 / 過大ゼロ は 1 byte 不変 (= 表示用 業務総走行の連続性復元) ★
      if (
        (state.active || state.start_time) &&
        state.total_distance_m > 0 &&
        typeof Meter !== 'undefined' &&
        typeof Meter.setBusinessDistance === 'function'
      ) {
        try {
          Meter.setBusinessDistance(state.total_distance_m);
        } catch (_) {
          /* Meter prime failure は致命傷ではないので無視 */
        }
      }
      // ★設計変更宣言 (2026-05-19・混同#6 修正・bug-2・load 配線漏れ追加):
      //   タスクキル復帰で state.active=true なら Meter 側 business_active も true に同期。
      //   未配線だと 4 加算経路 (mm commit / retroactive / gap fill / Off-Road incremental) が
      //   business_active gate で停止 → 復帰後の業務単位累積が伸びない事象。
      if (
        state.active &&
        typeof Meter !== 'undefined' &&
        typeof Meter.setBusinessActive === 'function'
      ) {
        try {
          Meter.setBusinessActive(true);
        } catch (_) {
          /* Meter 未ロード等は致命傷ではないので無視 */
        }
      }
      if (typeof dlog === 'function') dlog('[Business] loaded state');
      return true;
    } catch (e) {
      if (typeof dlog === 'function') dlog('[Business] load error: ' + e.message);
      return false;
    }
  }

  // 履歴に追加（abandon 時に呼ばれる）
  function _appendHistory(report) {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      // ★読めない 履歴（壊れた 字・配列でない）は 別の 鍵へ 退けてから 新しく 積む (2026-10-11)★
      //   前は 読めないと 毎回 積めず、その後の 業務が 全部 事務所へ 上がらずに 消えた。
      //   退けた 字は 消さない（BROKEN_KEY）。退けられない（空き不足）なら 積めない＝false。
      let list = null;
      try {
        list = raw ? JSON.parse(raw) : [];
      } catch (_) {
        list = null;
      }
      if (!Array.isArray(list)) {
        _kowaretaWoNokosu(BROKEN_KEY, raw);
        list = [];
      }
      list.unshift(report); // 新しい順
      // 直近 RETENTION_DAYS 日分のみ保持
      // 判定は end_time 優先（無ければ start_time、それも無ければ残す）
      //
      // ★2026-08-08: まだ雲へ上がっていない業務は、30日を過ぎても捨てない★
      //   ★なぜ★ 会社の有効化に失敗している端末（送り先が分からない）では一度も上がらない。
      //     実測(2026-08-08・テスト環境): dk-issue-license が 500 server_no_key を返し、
      //     dk_license_company が入らず、送信済0件・履歴に貯まったまま になった。
      //     そこで30日で捨てると ★お客さんの売上が 誰にも気づかれずに消える★。
      //   ★印★ job-sync が送れた物の start_time を dk_synced_shifts に文字列で残している。
      //     印が付いていない＝まだ上がっていない → 古くても残す。
      //     ★印が読めない時も残す（安全側）★
      //   ★溜まり続けない歯止め★ 残す上限 UNSENT_KEEP_MAX。超えた分は新しい方から残し、
      //     捨てた件数を dk_history_dropped に足す（黙って消さない・あとで画面に出せる）。
      const cutoff = Date.now() - RETENTION_MS;
      let syncedSet = null; // null = 読めなかった（＝全部 未送信あつかい＝捨てない）
      try {
        const rawSynced = localStorage.getItem(SYNCED_KEY);
        if (rawSynced) {
          const arr = JSON.parse(rawSynced);
          if (Array.isArray(arr)) {
            syncedSet = Object.create(null);
            arr.forEach((k) => {
              syncedSet[String(k)] = true;
            });
          }
        } else {
          syncedSet = Object.create(null); // 印そのものが無い＝1件も送れていない
        }
      } catch (_) {
        syncedSet = null; // 壊れていたら 捨てない側に倒す
      }
      const isSent = (item) => {
        if (syncedSet === null) return false; // 読めない＝未送信あつかい
        const key = item && item.start_time != null ? String(item.start_time) : null;
        return !!(key && syncedSet[key]);
      };
      let keptUnsentOld = 0;
      let droppedNow = 0;
      const trimmed = list.filter((item) => {
        // ★中身の 無い 札（null・字・数）は 落とす (2026-10-11)★ 前は item.end_time で 転び、毎回 積めなかった
        if (!item || typeof item !== 'object') return false;
        const t = item.end_time || item.start_time || null;
        if (t === null) return true; // 時刻不明は残す（保険）
        if (t >= cutoff) return true; // 30日以内は今までどおり残す
        if (isSent(item)) return false; // 送信済みの古い物は今までどおり捨てる
        // ★まだ上がっていない古い物★
        if (keptUnsentOld < UNSENT_KEEP_MAX) {
          keptUnsentOld++;
          return true;
        }
        droppedNow++; // 上限超え。捨てるが ★件数は残す★
        return false;
      });
      if (droppedNow > 0) {
        try {
          const prev = parseInt(localStorage.getItem(DROPPED_KEY) || '0', 10) || 0;
          localStorage.setItem(DROPPED_KEY, String(prev + droppedNow));
        } catch (_) {
          /* 記録できなくても業務は止めない */
        }
      }
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
      if (typeof dlog === 'function') {
        dlog(
          '[Business] history saved (' +
            trimmed.length +
            ' items, ' +
            RETENTION_DAYS +
            'days retention)'
        );
      }
      return true; // ★積めた★
    } catch (e) {
      if (typeof dlog === 'function') dlog('[Business] history save error: ' + e.message);
      return false; // ★積めていない（倉庫が 満杯 など）★
    }
  }

  // 履歴から業務状態を復元して active 状態に戻す（業務開始画面の「続きから再開」用）
  // history: getLastEndedBusiness() で取得した履歴オブジェクト
  // ★履歴から1件だけ外す (2026-08-03)★
  //   「終了 → 続ける」の時に使う。まだ終わっていない業務が履歴に残らないようにする。
  //   ★start_time で見分ける★（end_time は続けるたびに変わるため当てにならない）。
  function _removeHistory(startTime, endTime) {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return false;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return false;
      const filtered = list.filter(function (item) {
        if (!item) return false;
        if (typeof startTime === 'number' && item.start_time === startTime) return false;
        if (typeof endTime === 'number' && endTime && item.end_time === endTime) return false;
        return true;
      });
      if (filtered.length !== list.length) {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
        return true;
      }
      return false;
    } catch (_) {
      return false; // 消せなくても業務は止めない
    }
  }

  // ★送信済みの印を1件だけ外す (2026-09-26)★
  //   resume() 専用。★履歴から外すのと 必ず 対で 呼ぶ★
  //   （外し忘れると「続きを足した版」が二度と事務所へ上がらない）。
  //   やり方は js/trip-edit.js:unmarkSynced と同じ（印は文字列で入っている）。
  //   ★絶対に throw しない★ … 印を外せなくても業務は止めない。
  function _unsealSynced(startTime) {
    try {
      if (typeof startTime !== 'number' || !startTime) return false;
      const raw = localStorage.getItem(SYNCED_KEY);
      if (!raw) return false;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return false;
      const key = String(startTime);
      const next = list.filter(function (k) {
        return String(k) !== key;
      });
      if (next.length === list.length) return false;
      localStorage.setItem(SYNCED_KEY, JSON.stringify(next));
      if (typeof dlog === 'function') dlog('[Business] unseal synced ' + key);
      return true;
    } catch (_) {
      return false;
    }
  }

  function restoreFromHistory(history) {
    if (!history) return false;
    if (typeof history.start_time !== 'number') return false;
    // 履歴を state に書き戻す
    state = {
      active: true, // 再開なので active に戻す
      start_time: history.start_time,
      end_time: null, // 再開時はクリア
      ended: false, // 再開なので false
      ended_at: null,
      total_distance_m: history.total_distance_m || 0,
      actual_total_m: history.actual_total_m || 0,
      fare_total_yen: history.fare_total_yen || 0,
      trip_count: history.trip_count || 0,
      trips: Array.isArray(history.trips) ? [...history.trips] : [],
      last_meter_distance_m: 0, // Meter は再起動するためクリア
    };
    // ★設計変更宣言 (2026-05-14・restoreFromHistory でも Meter.business_distance_m を逆流):
    //   履歴から業務再開時、保存された total_distance_m を Meter 側にも復元して連続性を確保。
    if (
      state.total_distance_m > 0 &&
      typeof Meter !== 'undefined' &&
      typeof Meter.setBusinessDistance === 'function'
    ) {
      try {
        Meter.setBusinessDistance(state.total_distance_m);
      } catch (_) {
        /* Meter prime failure は致命傷ではないので無視 */
      }
    }
    // 履歴から該当エントリを削除（重複防止）
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) {
        const list = JSON.parse(raw);
        const filtered = list.filter((item) => item.end_time !== history.end_time);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
      }
    } catch (e) {
      // history JSON.parse fail / localStorage 失敗 → restoreFromHistory 完了に・影響なし
    }
    save();
    if (typeof dlog === 'function') dlog('[Business] restored from history (resumed)');
    return true;
  }

  // ─────────────────────────────────────────
  // 公開API
  // ─────────────────────────────────────────
  return {
    start,
    end,
    resume,
    abandon,
    onGps,
    onTripEnd,
    // ★設計変更宣言 (2026-05-15・経由地点 + 住所表示機能): trip 住所トラッキング API
    onTripStart,
    onWaypoint,
    setEndAddress,
    getCurrentTrip,
    // ★請求書払い(掛け)先の紐付け (2026-07-31・実車中の「請求書」ボタンから呼ぶ)
    setTripCustomer,
    setTripCustomerNote,
    getTripCustomer,
    getState,
    getReport,
    save,
    onHozonShippai,
    load,
    restoreFromHistory,
    // ★試験が「画面と同じ関数」を呼べるように出す (2026-09-26)★
    //   真似て書いた写しを測っても、本物が直っている証しにならない。
    __unsealSynced: _unsealSynced,
    // ★設計変更宣言 (2026-05-23・住所① fine 配線 + 丁目カット表示・test 用 export):
    //   地名の 部品（_cutChomeSuffix・_chimeiAt 等）は 副作用 なし。試験が 画面と 同じ 関数を 呼ぶ ため（2026-10-24 代表点の 市名は 外した）。
    //   test で・unit verify するため・public API に・1 key 経由で・export。
    //   本番動作には・影響なし (= 既存 callers は・触らず・新 namespace のみ追加)。
    __addressFormatter: {
      cutChomeSuffix: _cutChomeSuffix,
      chimeiAt: _chimeiAt,
      nearestTown: _nearestTown,
      townRings: _townRings,
      addrPending: function () {
        return _addrPending;
      },
      addrTick: _addrTick,
      pointInPolygon: _pointInPolygon,
      findTownPolygonAddress: _findTownPolygonAddress,
      buildTownGrid: _buildTownGrid,
      getLastMMSnap: function () {
        return _lastMMSnap;
      },
      resetLastMMSnap: function () {
        _lastMMSnap = null;
      },
      getLastRawGps: function () {
        return _lastRawGps;
      },
      resetLastRawGps: function () {
        _lastRawGps = null;
      },
    },
    // ★設計変更宣言 (2026-05-23・住所① 案 C 高精度版・public API)
    notifyMMSnap: notifyMMSnap,
    // ★設計変更宣言 (2026-05-23・住所② raw GPS 配信受信・public API)
    notifyRawGps: notifyRawGps,
    // ★設計変更宣言 (2026-05-23・住所② 現在地ライブ表示・public API)
    getCurrentLiveAddress: getCurrentLiveAddress,
    // ★現在地フリーズ根治 (2026-06-20): 位置源選定の純粋関数を公開 (ユニット試験 seam・read-only)
    _pickLiveAddrPos: _pickLiveAddrPos,
  };
})();

// ★設計変更宣言 (2026-05-15・Phase C): browser global expose + Node module.exports 両対応
if (typeof window !== 'undefined') window.Business = Business;
/* eslint-disable no-undef -- Node module 環境のみで参照・browser では typeof で skip */
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = Business;
}
/* eslint-enable no-undef */
