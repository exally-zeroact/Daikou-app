// 業務管理スーパー機能（2026/05/01新規）
// 1業務単位で総走行距離・実車総距離・売上・営業回数を集計
// meter.js には触らず、Meter.getState() を読むだけ
const Business = (() => {

  // ─────────────────────────────────────────
  // 状態
  // ─────────────────────────────────────────
  let state = {
    active: false,
    start_time: null,           // 業務開始時刻（unix ms）
    end_time: null,             // 業務終了時刻（end()押下時）
    
    // 距離（メートル）
    total_distance_m: 0,        // 総走行距離（業務開始からのGPS移動全部）
    actual_total_m: 0,          // 実車総距離（各実車の合算）
    // 空車距離 = total_distance_m - actual_total_m（getReport で計算）
    
    // 売上
    fare_total_yen: 0,          // 売上累計（円）
    trip_count: 0,              // 営業回数（実車回数）
    
    // 履歴
    trips: [],                  // [{distance_m, fare_yen, start_time, end_time}]
    
    // GPS連続性
    last_gps: null,             // {lat, lng, timestamp}
  };

  // GPS差分の異常値しきい値（meter.js MM_MAX_SEGMENT_DIST_M と揃える）
  const MAX_SEGMENT_DIST_M = 1000;
  // GPS空白検出（5秒以上空いたら連続性リセット）
  const GAP_RESET_SEC = 5;

  // localStorage キー
  const STORAGE_KEY = 'dakome_business_state';
  const HISTORY_KEY = 'dakome_business_history';

  // ─────────────────────────────────────────
  // ライフサイクル
  // ─────────────────────────────────────────

  // 業務開始
  function start(){
    if(state.active){
      if(typeof dlog === 'function') dlog('[Business] already active');
      return false;
    }
    const now = Date.now();
    state = {
      active: true,
      start_time: now,
      end_time: null,
      total_distance_m: 0,
      actual_total_m: 0,
      fare_total_yen: 0,
      trip_count: 0,
      trips: [],
      last_gps: null,
    };
    save();
    if(typeof dlog === 'function') dlog('[Business] start at ' + new Date(now).toISOString());
    return true;
  }

  // 業務終了（日報生成・state は保持して追加業務に備える）
  // → end() 後でも resume() で同じ業務に追加可能
  // → abandon() で完全確定（履歴保存→state リセット）
  function end(){
    if(!state.active) return null;
    state.active = false;
    state.end_time = Date.now();
    save();
    if(typeof dlog === 'function') dlog('[Business] end (resumable)');
    return getReport();
  }

  // 業務再開（end 後に追加業務が入った場合）
  function resume(){
    if(state.active) return false;
    if(!state.start_time) return false;  // start していない
    state.active = true;
    state.end_time = null;
    state.last_gps = null;  // GPS連続性リセット（再開時にジャンプ防止）
    save();
    if(typeof dlog === 'function') dlog('[Business] resume');
    return true;
  }

  // 業務完全終了（履歴に保存→state リセット）
  function abandon(){
    if(state.start_time){
      const report = getReport();
      _appendHistory(report);
    }
    state = {
      active: false,
      start_time: null,
      end_time: null,
      total_distance_m: 0,
      actual_total_m: 0,
      fare_total_yen: 0,
      trip_count: 0,
      trips: [],
      last_gps: null,
    };
    save();
    if(typeof dlog === 'function') dlog('[Business] abandon (history saved)');
    return true;
  }

  // ─────────────────────────────────────────
  // GPS受信（業務中なら総走行距離に加算）
  // ─────────────────────────────────────────
  // 注：meter.js の Meter.update() と並行で呼ばれる想定
  //     実車中も呼ばれて total_distance_m に加算される（実車中も走ってる事実）
  //     実車距離は Meter.getState().distance_m で別管理
  function onGps(gpsResult){
    if(!state.active) return;
    if(!gpsResult) return;
    if(gpsResult.isStationary) return;
    if(typeof gpsResult.lat !== 'number' || typeof gpsResult.lng !== 'number') return;

    const now = gpsResult.timestamp || Date.now();

    if(state.last_gps){
      const dtSec = (now - state.last_gps.timestamp) / 1000;

      // GPS空白検出：5秒以上空いたら連続性リセット（距離加算しない）
      if(dtSec >= GAP_RESET_SEC){
        state.last_gps = { lat: gpsResult.lat, lng: gpsResult.lng, timestamp: now };
        return;
      }

      // GPS差分計算（GPS グローバル関数を流用）
      let d = 0;
      if(typeof GPS !== 'undefined' && typeof GPS.calcDistance === 'function'){
        d = GPS.calcDistance(
          state.last_gps.lat, state.last_gps.lng,
          gpsResult.lat, gpsResult.lng
        );
      }

      // 異常値スキップ（1更新で1km超えはGPSジャンプ）
      if(d >= 0 && d <= MAX_SEGMENT_DIST_M){
        state.total_distance_m += d;
      } else {
        if(typeof dlog === 'function') dlog('[Business] skip 異常距離: ' + d.toFixed(0) + 'm');
      }
    }

    state.last_gps = { lat: gpsResult.lat, lng: gpsResult.lng, timestamp: now };
  }

  // ─────────────────────────────────────────
  // 実車終了通知（実車総距離・売上・回数加算）
  // ─────────────────────────────────────────
  // 呼び出し側（index.html の支払ボタン処理）が
  // Meter.getState().distance_m と fare_yen を渡してくる
  function onTripEnd(distanceM, fareYen, tripStartTime){
    if(!state.active){
      if(typeof dlog === 'function') dlog('[Business] onTripEnd ignored (not active)');
      return false;
    }
    if(typeof distanceM !== 'number' || distanceM < 0) return false;
    if(typeof fareYen !== 'number' || fareYen < 0) return false;

    state.actual_total_m += distanceM;
    state.fare_total_yen += fareYen;
    state.trip_count += 1;
    state.trips.push({
      distance_m: distanceM,
      fare_yen: fareYen,
      start_time: tripStartTime || null,
      end_time: Date.now(),
    });
    save();
    if(typeof dlog === 'function') {
      dlog('[Business] trip end: ' + Math.round(distanceM) + 'm, ¥' + fareYen + ' (trip #' + state.trip_count + ')');
    }
    return true;
  }

  // ─────────────────────────────────────────
  // 取得・集計
  // ─────────────────────────────────────────
  function getState(){ return { ...state, trips: [...state.trips] }; }

  // 日報集計
  function getReport(){
    const totalM = state.total_distance_m;
    const actualM = state.actual_total_m;
    const emptyM = Math.max(0, totalM - actualM);  // 整合性保証
    const elapsedMs = state.end_time
      ? (state.end_time - (state.start_time || state.end_time))
      : (state.start_time ? (Date.now() - state.start_time) : 0);
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
      actual_ratio: totalM > 0 ? (actualM / totalM) : 0,
      avg_fare_yen: state.trip_count > 0 ? Math.round(state.fare_total_yen / state.trip_count) : 0,
      avg_speed_kmh: elapsedH > 0 ? ((totalM / 1000) / elapsedH) : 0,

      trips: [...state.trips],
    };
  }

  // ─────────────────────────────────────────
  // CSV 出力
  // ─────────────────────────────────────────
  function exportCSV(){
    const r = getReport();
    const fmtTime = t => t ? new Date(t).toLocaleString('ja-JP') : '';
    const fmtDur = sec => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      return h + '時間' + m + '分';
    };

    const lines = [
      'ダイコメ業務日報',
      '',
      '業務開始,' + fmtTime(r.start_time),
      '業務終了,' + fmtTime(r.end_time),
      '業務時間,' + fmtDur(r.elapsed_sec),
      '',
      '総走行距離(km),' + (r.total_distance_m / 1000).toFixed(2),
      '実車総距離(km),' + (r.actual_total_m / 1000).toFixed(2),
      '空車距離(km),' + (r.empty_distance_m / 1000).toFixed(2),
      '実車率(%),' + (r.actual_ratio * 100).toFixed(1),
      '',
      '売上合計(円),' + r.fare_total_yen,
      '営業回数,' + r.trip_count,
      '平均単価(円),' + r.avg_fare_yen,
      '平均速度(km/h),' + r.avg_speed_kmh.toFixed(1),
      '',
      '【実車明細】',
      '回,開始,終了,距離(km),料金(円)',
    ];

    r.trips.forEach((t, i) => {
      lines.push([
        i + 1,
        fmtTime(t.start_time),
        fmtTime(t.end_time),
        (t.distance_m / 1000).toFixed(2),
        t.fare_yen,
      ].join(','));
    });

    return lines.join('\n');
  }

  // ─────────────────────────────────────────
  // 永続化
  // ─────────────────────────────────────────
  function save(){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch(e) {
      if(typeof dlog === 'function') dlog('[Business] save error: ' + e.message);
    }
  }

  function load(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return false;
      const parsed = JSON.parse(raw);
      if(!parsed || typeof parsed !== 'object') return false;
      // 必須プロパティ補完（バージョン差分対策）
      state = {
        active: !!parsed.active,
        start_time: parsed.start_time || null,
        end_time: parsed.end_time || null,
        total_distance_m: parsed.total_distance_m || 0,
        actual_total_m: parsed.actual_total_m || 0,
        fare_total_yen: parsed.fare_total_yen || 0,
        trip_count: parsed.trip_count || 0,
        trips: Array.isArray(parsed.trips) ? parsed.trips : [],
        last_gps: parsed.last_gps || null,
      };
      if(typeof dlog === 'function') dlog('[Business] loaded state');
      return true;
    } catch(e) {
      if(typeof dlog === 'function') dlog('[Business] load error: ' + e.message);
      return false;
    }
  }

  // 履歴に追加（abandon 時に呼ばれる）
  function _appendHistory(report){
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const list = raw ? JSON.parse(raw) : [];
      list.unshift(report);  // 新しい順
      // 直近100件まで保持
      const trimmed = list.slice(0, 100);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    } catch(e) {
      if(typeof dlog === 'function') dlog('[Business] history save error: ' + e.message);
    }
  }

  // 履歴取得
  function getHistory(){
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch(e) {
      return [];
    }
  }

  // 履歴クリア（デバッグ用）
  function clearHistory(){
    try { localStorage.removeItem(HISTORY_KEY); } catch(e){}
  }

  // ─────────────────────────────────────────
  // 公開API
  // ─────────────────────────────────────────
  return {
    start, end, resume, abandon,
    onGps, onTripEnd,
    getState, getReport, exportCSV,
    save, load,
    getHistory, clearHistory,
  };
})();
