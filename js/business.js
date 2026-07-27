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
  };

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
  const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

  // ─────────────────────────────────────────
  // ライフサイクル
  // ─────────────────────────────────────────

  // 業務開始
  function start() {
    if (state.active) {
      if (typeof dlog === 'function') dlog('[Business] already active');
      return false;
    }
    // ★設計変更宣言 (2026-05-14): 旧 checkAutoAbandon(true) を abandon() に置換
    //   前業務が ended 状態 (= 再開可能 limbo) なら履歴に push してから新業務開始。
    //   abandon() は内部で _appendHistory + state リセットを実施。
    if (state.ended) {
      abandon();
    }
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
  function end() {
    if (!state.active && !state.start_time) return null;
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
    save();
    if (typeof dlog === 'function') dlog('[Business] end (resumable for 3h)');
    return getReport();
  }

  // 業務再開（end 後・前業務 limbo 状態なら常時可能・3 時間制限なし）
  // ★設計変更宣言 (2026-05-14): RESUME_GRACE_MS の 3h チェックを撤去
  function resume() {
    if (state.active) return false;
    if (!state.start_time) return false; // start していない
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
    if (state.start_time) {
      const report = getReport();
      _appendHistory(report);
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
  // ★設計変更宣言 (2026-05-23・住所① fine 配線 + 丁目カット表示・business.js consumer 側):
  //   meter.js getNearestAddress は・fine hit 時に・「常盤町八丁目」(= 大字単体・市町村なし) を return。
  //   coarse fallback 時は・「今治市 付近」(= 市町村 + " 付近")。
  //   司さん希望「今治市常盤町」(= 市町村 + 大字・丁目カット) を実現するため・consumer 側で:
  //     1. coarse bundle (window.ADDRESSES_COARSE_JP) から・市町村名 ("今治市") を別 query
  //     2. fine 戻り値「常盤町五丁目」を・末尾 丁目カット → "常盤町"
  //     3. 連結 → "今治市常盤町"
  //   fine 未 load (= 起動直後・現在地県 priority load 前) → meter.js coarse fallback の
  //   "今治市 付近" を・そのまま return (= graceful fallback・業務継続性最優先)。
  //   絶対ルール準拠:
  //     ✓ distance_m / Meter.reset / Worker B 本体: 1 byte も触らない (= 表示専用・consumer side)
  //     ✓ meter.js は・無変更 (= getNearestAddress 戻り値を・wrap するのみ)
  //     ✓ ADDRESSES_COARSE_JP は・PRECACHE 維持 (= 必ず load 済・data-registry 既登録)
  //     ✓ iOS Safari / Android Chrome 共通 (= 既存 native API のみ)

  // 末尾「○丁目」(漢数字・算用数字・全角算用 両対応) をカット
  // 大字止まり (= "市坪西町") は・無変換で返却
  function _cutChomeSuffix(name) {
    if (!name || typeof name !== 'string') return name;
    // 漢数字 (一二三四五六七八九十百千〇零) + 半角 0-9 + 全角 ０-９ の・1 つ以上 + "丁目" 末尾
    return name.replace(/[一二三四五六七八九十百千〇零0-9０-９]+丁目$/, '');
  }

  // window.ADDRESSES_COARSE_JP.items から・最近傍 市町村名 を・取得 (= "今治市" 等)
  // 半径 25km プレフィルタ + 平方距離比較 (= ms 精度不要・最近傍 1 件のみ)
  // load 未完了 → null・consumer 側で・coarse fallback 維持
  function _findNearestMunicipality(lat, lng) {
    if (
      typeof window === 'undefined' ||
      !window.ADDRESSES_COARSE_JP ||
      !Array.isArray(window.ADDRESSES_COARSE_JP.items)
    ) {
      return null;
    }
    const items = window.ADDRESSES_COARSE_JP.items;
    const COORD_SCALE = 100000;
    const targetLatI = Math.round(lat * COORD_SCALE);
    const targetLngI = Math.round(lng * COORD_SCALE);
    const RANGE_I = 25000; // ~25km プレフィルタ (= meter.js COARSE_RADIUS_M と整合)
    let best = null;
    let bestSq = Infinity;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const dLatI = it.lat - targetLatI;
      if (dLatI > RANGE_I || dLatI < -RANGE_I) continue;
      const dLngI = it.lng - targetLngI;
      if (dLngI > RANGE_I || dLngI < -RANGE_I) continue;
      const sq = dLatI * dLatI + dLngI * dLngI;
      if (sq < bestSq) {
        bestSq = sq;
        best = it;
      }
    }
    return best ? best.n : null;
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

  // ★設計変更宣言 (2026-05-23・住所① 案 C 高精度版・(C) 1km grid index lazy build):
  //   build script では・grid を含めず・consumer 側で・初回 PIP 時に・lazy build (= cache・1 回)。
  //   key = '{tileLat}_{tileLng}' / GRID_SIZE_INT = 1000 (= int×1e5 単位の 1km 相当)
  const _townGridCache = new WeakMap();
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

  // ★設計変更宣言 (2026-05-23・住所① 案 C 高精度版・point-in-polygon ray casting):
  //   ring = [[latI, lngI], ...] (= 既存 build-town-polygons.js の・int×1e5 quantize 後形式)
  //   標準 ray casting・closed ring 想定 (= 開閉自動 補正)
  function _pointInPolygon(latI, lngI, ring) {
    if (!ring || ring.length < 3) return false;
    let inside = false;
    const n = ring.length;
    let j = n - 1;
    for (let i = 0; i < n; i++) {
      const iLat = ring[i][0];
      const iLng = ring[i][1];
      const jLat = ring[j][0];
      const jLng = ring[j][1];
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

  // ★設計変更宣言 (2026-05-23・住所① 案 C 高精度版・PIP wrapper):
  //   bundle.items の・各 polygon (= 複数 ring・外周 + 穴) に・point-in-polygon。
  //   外周 hit ∧ 穴 hit でない → 採用。多 polygon 候補 grid 絞り後・最初 hit 採用。
  //   戻り値: { n: '本町七丁目', c: '今治市' } or null
  function _findTownPolygonAddress(lat, lng, bundle) {
    if (!bundle || !Array.isArray(bundle.items) || bundle.items.length === 0) return null;
    const COORD_SCALE = bundle.precision || 100000;
    const latI = Math.round(lat * COORD_SCALE);
    const lngI = Math.round(lng * COORD_SCALE);
    const grid = _getTownGrid(bundle);
    const tLat = Math.floor(latI / _TOWN_GRID_SIZE_INT);
    const tLng = Math.floor(lngI / _TOWN_GRID_SIZE_INT);
    const candidates = (grid && grid[tLat + '_' + tLng]) || null;
    const iterIdx = candidates || bundle.items.map((_, i) => i);
    for (let k = 0; k < iterIdx.length; k++) {
      const it = bundle.items[iterIdx[k]];
      if (!it || !it.bbox) continue;
      // bbox プレフィルタ (= 候補絞り)
      if (latI < it.bbox[0] || latI > it.bbox[2] || lngI < it.bbox[1] || lngI > it.bbox[3])
        continue;
      if (!it.rings || it.rings.length === 0) continue;
      // 外周 ring (= rings[0]) hit 判定
      if (_pointInPolygon(latI, lngI, it.rings[0])) {
        // 穴 (= rings[1..]) で・点が入ってるなら・除外
        let inHole = false;
        for (let r = 1; r < it.rings.length; r++) {
          if (_pointInPolygon(latI, lngI, it.rings[r])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) {
          return { n: it.n, c: it.c };
        }
      }
    }
    return null;
  }

  // 県名 → bundle 解決 (= window.TOWN_POLYGONS_{PREF})
  function _resolveTownBundle(prefName) {
    if (typeof window === 'undefined' || !prefName) return null;
    const key = 'TOWN_POLYGONS_' + prefName.toUpperCase();
    return window[key] || null;
  }

  // coarse JIS 5 桁 から・pref 名解決 (= 既存 RegionHelper 利用・なければ・先頭 2 桁 mapping)
  function _prefNameFromCoarseCity(cityName, lat, lng) {
    // RegionHelper.getCurrentPref を・優先 (= 既存 X4 で・利用)
    if (
      typeof window !== 'undefined' &&
      window.RegionHelper &&
      typeof window.RegionHelper.getCurrentPref === 'function'
    ) {
      try {
        const p = window.RegionHelper.getCurrentPref(lat, lng, null);
        if (p) return p;
      } catch (_) {
        // RegionHelper fail → fallback below
      }
    }
    return null;
  }

  function _safeGetNearestAddress(lat, lng, accuracy) {
    // 入力 validate
    if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) {
      return null;
    }

    // ★設計変更宣言 (2026-05-23・住所① 案 C 高精度版・4 段 fallback):
    //   1. _lastMMSnap fresh (5 秒以内) → snap 位置で PIP (= GPS 揺れ吸収)
    //   2. snap stale / なし → raw GPS で PIP
    //   3. PIP miss → 既存 fine 最近傍 (= Meter.getNearestAddress 経路) で・大字単独取得
    //   4. fine 未 load / null → coarse「市町村 付近」(= meter.js coarse fallback)
    //   絶対ルール準拠:
    //     ✓ distance_m / meter.js / map-matcher.js / Worker B 本体には・1 byte も触れない
    //     ✓ 表示専用・PIP 結果は・既存 _cutChomeSuffix で・丁目カット
    //     ✓ ADDRESSES_COARSE_JP 未 load → _findNearestMunicipality null → city prefix 省略

    // pref 名解決 (= PIP bundle 選択用)
    const prefName = _prefNameFromCoarseCity(null, lat, lng);
    const bundle = _resolveTownBundle(prefName);

    // ─── 段階 1: snap fresh → snap 位置で PIP ───
    if (bundle && _lastMMSnap && Date.now() - _lastMMSnap.t < _MM_SNAP_FRESH_MS) {
      const r = _findTownPolygonAddress(_lastMMSnap.lat, _lastMMSnap.lng, bundle);
      if (r && r.n) {
        const cut = _cutChomeSuffix(r.n);
        const city = r.c || _findNearestMunicipality(_lastMMSnap.lat, _lastMMSnap.lng) || '';
        const result = city + cut;
        if (typeof dlog === 'function') {
          dlog('[ADDR] snap PIP hit "' + result + '"');
        }
        return result;
      }
    }

    // ─── 段階 2: raw GPS で PIP ───
    if (bundle) {
      const r = _findTownPolygonAddress(lat, lng, bundle);
      if (r && r.n) {
        const cut = _cutChomeSuffix(r.n);
        const city = r.c || _findNearestMunicipality(lat, lng) || '';
        const result = city + cut;
        if (typeof dlog === 'function') {
          dlog('[ADDR] raw PIP hit "' + result + '"');
        }
        return result;
      }
    }

    // ─── 段階 3: PIP miss → 既存 fine 最近傍 (= 住所① 経路・Meter.getNearestAddress) ───
    if (typeof Meter === 'undefined' || !Meter || typeof Meter.getNearestAddress !== 'function') {
      return null;
    }
    let raw;
    try {
      raw = Meter.getNearestAddress(lat, lng, accuracy);
    } catch (_) {
      return null;
    }
    if (!raw) return null;
    // 段階 4: coarse fallback (= "今治市 付近") は・そのまま返却
    if (/ 付近$/.test(raw)) {
      if (typeof dlog === 'function') {
        dlog('[ADDR] coarse fallback raw=' + raw);
      }
      return raw;
    }
    // fine hit (= 段階 3 結果): "常盤町八丁目" 等 → 丁目カット + 市町村名 prefix
    const cut = _cutChomeSuffix(raw);
    const city = _findNearestMunicipality(lat, lng);
    const result = city ? city + cut : cut;
    if (typeof dlog === 'function') {
      dlog('[ADDR] fine fallback raw=' + raw + ' → cut=' + cut + ' → ' + result);
    }
    return result;
  }

  // ★設計変更宣言 (2026-05-15・住所取得 retry ロジック・data load 遅延吸収):
  //   addresses-fine-jp.js (24.6 MB) の defer load 完了前に経由地点ボタン/代行開始/確定が
  //   発火すると、Meter.getNearestAddress が null を返し「⚠ 住所を取得できませんでした」が
  //   毎回出る (2026-05-15 報告事象)。本ヘルパで未 load 時は 1 秒間隔で最大 5 回再試行し、
  //   load 完了後の最初の解決で current_trip の該当フィールドを更新する。
  //   再解決成功時は window CustomEvent 'business:address-resolved' を発火し、UI 側 (index.html)
  //   が waypointCard / routeCard を即時更新できるようにする。
  //   絶対ルール準拠:
  //     ✓ 業務継続性最優先: retry 全失敗でも null 据え置きで業務は止めない
  //     ✓ 同期完結は維持: 関数 (onTripStart 等) は同期呼出のまま・retry は背景で実行
  //     ✓ current_trip が onTripEnd で null 化された後に retry が解決しても上書きしない
  //       (state.current_trip 存在チェックを毎回行う)
  //   iOS/Android 共通: setTimeout は両 OS 同一動作・onLoad 検知ではなく時間ベースで簡素化
  const _ADDR_RETRY_MAX = 5;
  const _ADDR_RETRY_INTERVAL_MS = 1000;
  function _scheduleAddressRetry(kind, lat, lng, accuracy, waypointIdx, attempt) {
    const cur = attempt || 1;
    if (cur > _ADDR_RETRY_MAX) return;
    setTimeout(function () {
      // current_trip が無くなっていたら retry 中止 (= onTripEnd 後)
      if (!state.current_trip) return;
      // 該当 waypoint がまだ null のままか確認 (= 他経路で解決していたらスキップ)
      let alreadyResolved = false;
      if (kind === 'start') {
        alreadyResolved = state.current_trip.start_address != null;
      } else if (kind === 'end') {
        alreadyResolved = state.current_trip.end_address != null;
      } else if (kind === 'waypoint') {
        const wps = state.current_trip.waypoints;
        if (Array.isArray(wps) && wps[waypointIdx]) {
          alreadyResolved = wps[waypointIdx].address != null;
        } else {
          // waypoint がもう存在しない (異常系) → 中止
          return;
        }
      }
      if (alreadyResolved) return;

      const addr = _safeGetNearestAddress(lat, lng, accuracy);
      if (addr) {
        if (kind === 'start') {
          state.current_trip.start_address = addr;
        } else if (kind === 'end') {
          state.current_trip.end_address = addr;
        } else if (kind === 'waypoint') {
          state.current_trip.waypoints[waypointIdx].address = addr;
        }
        save();
        if (typeof dlog === 'function') {
          dlog(
            '[Business] address retry resolved (kind=' + kind + ' attempt=' + cur + ') => ' + addr
          );
        }
        // UI 通知 (browser context のみ・Node test では window 未定義で skip)
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          try {
            window.dispatchEvent(
              new CustomEvent('business:address-resolved', {
                detail: { kind: kind, address: addr, waypointIdx: waypointIdx },
              })
            );
          } catch (_) {
            // CustomEvent dispatch fail (= 未対応 browser 等) → retry 解決 path に・影響なし
          }
        }
        return; // 解決済 → retry 終了
      }
      // まだ null・データもまだ未 load 確率高 → 再試行
      _scheduleAddressRetry(kind, lat, lng, accuracy, waypointIdx, cur + 1);
    }, _ADDR_RETRY_INTERVAL_MS);
  }

  function _needsAddressRetry() {
    // データ未 load なら true・load 済 (miss 起因 null) なら retry しても無駄なので false
    if (typeof Meter !== 'undefined' && typeof Meter.isAddressDataReady === 'function') {
      try {
        return !Meter.isAddressDataReady();
      } catch (_) {
        return false;
      }
    }
    return false;
  }

  // 代行開始時の出発地住所取得 + current_trip 初期化
  function onTripStart(lat, lng, accuracy) {
    const startAddr = _safeGetNearestAddress(lat, lng, accuracy);
    state.current_trip = {
      start_time: Date.now(),
      start_address: startAddr,
      waypoints: [],
      end_address: null,
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
    // データ未 load による null の場合のみ retry (load 済 miss なら retry しても解決しない)
    if (!startAddr && _needsAddressRetry() && lat != null && lng != null) {
      _scheduleAddressRetry('start', lat, lng, accuracy, null, 1);
    }
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
    // データ未 load による null の場合のみ retry
    if (!addr && _needsAddressRetry() && lat != null && lng != null) {
      _scheduleAddressRetry('waypoint', lat, lng, accuracy, waypointIdx, 1);
    }
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
    // データ未 load による null の場合のみ retry
    if (!endAddr && _needsAddressRetry() && lat != null && lng != null) {
      _scheduleAddressRetry('end', lat, lng, accuracy, null, 1);
    }
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
    state.trips.push({
      distance_m: distanceM,
      fare_yen: fareYen,
      start_time: tripStartTime || currentTrip.start_time || null,
      end_time: Date.now(),
      start_address: currentTrip.start_address,
      end_address: currentTrip.end_address,
      waypoints: currentTrip.waypoints.slice ? currentTrip.waypoints.slice() : [],
    });
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
    return { ...state, trips: [...state.trips] };
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
    } catch (e) {
      if (typeof dlog === 'function') dlog('[Business] save error: ' + e.message);
    }
  }

  function load() {
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
      const list = raw ? JSON.parse(raw) : [];
      list.unshift(report); // 新しい順
      // 直近 RETENTION_DAYS 日分のみ保持
      // 判定は end_time 優先（無ければ start_time、それも無ければ残す）
      const cutoff = Date.now() - RETENTION_MS;
      const trimmed = list.filter((item) => {
        const t = item.end_time || item.start_time || null;
        if (t === null) return true; // 時刻不明は残す（保険）
        return t >= cutoff;
      });
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
    } catch (e) {
      if (typeof dlog === 'function') dlog('[Business] history save error: ' + e.message);
    }
  }

  // 履歴から業務状態を復元して active 状態に戻す（業務開始画面の「続きから再開」用）
  // history: getLastEndedBusiness() で取得した履歴オブジェクト
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
    getState,
    getReport,
    save,
    load,
    restoreFromHistory,
    // ★設計変更宣言 (2026-05-23・住所① fine 配線 + 丁目カット表示・test 用 export):
    //   _cutChomeSuffix / _findNearestMunicipality は・pure helper (= 副作用なし)。
    //   test で・unit verify するため・public API に・1 key 経由で・export。
    //   本番動作には・影響なし (= 既存 callers は・触らず・新 namespace のみ追加)。
    __addressFormatter: {
      cutChomeSuffix: _cutChomeSuffix,
      findNearestMunicipality: _findNearestMunicipality,
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
