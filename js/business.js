// 業務管理スーパー機能（2026/05/01新規）
// 1業務単位で総走行距離・実車総距離・売上・営業回数を集計
// meter.js には触らず、Meter.getState() を読むだけ
//
// 2026/05/01：iOS Safari 環境での確実なグローバル化のため window.Business に変更
window.Business = (function(){

// ─────────────────────────────────────────
// 状態
// ─────────────────────────────────────────
let state = {
active: false,
start_time: null,           // 業務開始時刻（unix ms）
end_time: null,             // 業務終了時刻（end()押下時）


// 終了後の3時間再開機能（2026/05/01）
ended: false,               // [終了]ボタン押下フラグ（abandon前の中間状態）
ended_at: null,             // [終了]押下時刻（3時間判定用）

// 距離（メートル）
total_distance_m: 0,        // 総走行距離（業務開始からのGPS移動全部）
actual_total_m: 0,          // 実車総距離（各実車の合算）
// 空車距離 = total_distance_m - actual_total_m（getReport で計算）

// 売上
fare_total_yen: 0,          // 売上累計（円）
trip_count: 0,              // 営業回数（実車回数）

// 履歴
trips: [],                  // [{distance_m, fare_yen, start_time, end_time}]

// 2026-05-09 設計変更 (P1/F1/F4 絶対ルール準拠):
//   total_distance_m は Meter.getState().distance_m を信源とする
//   旧: GPS Haversine 直線距離 (絶対ルール違反)
//   新: Meter の差分を加算 (= MM 道路距離・GPS 直線禁止)
last_meter_distance_m: 0,   // 直前に観測した Meter.distance_m (差分計算用)
};

// 終了後の再開猶予期間（3時間）
const RESUME_GRACE_MS = 3 * 60 * 60 * 1000;

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
function start(){
if(state.active){
if(typeof dlog === 'function') dlog('[Business] already active');
return false;
}
// 既に終了済み（再開可能状態）の業務があれば自動 abandon
if(state.ended){
checkAutoAbandon(true);  // force=true で即 abandon
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
};
save();
if(typeof dlog === 'function') dlog('[Business] start at ' + new Date(now).toISOString());
return true;
}

// 業務終了（[終了]ボタン押下時）
// 3時間以内なら resume() で再開可能
// 3時間経過後は次回 start() or checkAutoAbandon() で自動 abandon
function end(){
if(!state.active && !state.start_time) return null;
const now = Date.now();
state.active = false;
state.ended = true;
state.ended_at = now;
state.end_time = now;
save();
if(typeof dlog === 'function') dlog('[Business] end (resumable for 3h)');
return getReport();
}

// 業務再開（end 後・3時間以内なら可能）
function resume(){
if(state.active) return false;
if(!state.start_time) return false;  // start していない
// 3時間以内かチェック
if(state.ended && state.ended_at){
const elapsed = Date.now() - state.ended_at;
if(elapsed >= RESUME_GRACE_MS){
// 3時間経過 → 再開不可
if(typeof dlog === 'function') dlog('[Business] resume denied (3h elapsed)');
return false;
}
}
state.active = true;
state.ended = false;
state.ended_at = null;
state.end_time = null;
// 2026-05-09: Meter 信源化 (P1) で last_gps→last_meter_distance_m に置換
//   再開時の baseline は現 Meter.distance_m に揃える (差分=0 から再開)
state.last_meter_distance_m = (typeof Meter !== 'undefined' && Meter.getState)
  ? (Meter.getState().distance_m || 0) : 0;
save();
if(typeof dlog === 'function') dlog('[Business] resume');
return true;
}

// 再開可能か（ボタン表示判定用）
function canResume(){
if(!state.ended || !state.ended_at) return false;
const elapsed = Date.now() - state.ended_at;
return elapsed < RESUME_GRACE_MS;
}

// 自動 abandon チェック（起動時・start時に呼ぶ）
// force=true なら時間チェックせず強制 abandon
function checkAutoAbandon(force){
if(!state.ended) return false;
if(!force){
const elapsed = state.ended_at ? (Date.now() - state.ended_at) : Infinity;
if(elapsed < RESUME_GRACE_MS) return false;  // まだ猶予内
}
// 3時間経過 → 履歴に確定保存して state リセット
if(state.start_time){
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
};
save();
if(typeof dlog === 'function') dlog('[Business] auto-abandon (3h elapsed)');
return true;
}

// 業務完全終了（履歴に保存→state リセット）
// 通常は3時間経過後に checkAutoAbandon() から呼ばれる
// 手動で確定したい場合の公開API（明示的な abandon）
function abandon(){
if(state.start_time){
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
};
save();
if(typeof dlog === 'function') dlog('[Business] abandon (history saved)');
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

function onGps(gpsResult){
if(!state.active) return;
if(typeof Meter === 'undefined' || !Meter.getState) return;

const meterState = Meter.getState();
const cur = meterState.distance_m || 0;
const prev = state.last_meter_distance_m || 0;
const diff = cur - prev;

// Meter.reset 後・業務開始直後は cur < prev になり得る → 0 リセット
if(diff < 0){
  state.last_meter_distance_m = cur;
  return;
}
if(diff > 0){
  state.total_distance_m += diff;
  state.last_meter_distance_m = cur;
  // 5 秒間隔ログ
  const _logNow = Date.now();
  if(!_lastDebugLogAt || _logNow - _lastDebugLogAt > 5000){
    _lastDebugLogAt = _logNow;
    if(typeof dlog === 'function')
      dlog('[Business] +' + diff.toFixed(1) + 'm (' + (meterState.distanceSource || '?') +
           ') total=' + (state.total_distance_m/1000).toFixed(2) + 'km');
  }
}

// 1 秒間隔 save
const nowMs = Date.now();
if(nowMs - _lastGpsSaveAt >= GPS_SAVE_INTERVAL_MS){
  _lastGpsSaveAt = nowMs;
  save();
}

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
ended: !!parsed.ended,
ended_at: parsed.ended_at || null,
total_distance_m: parsed.total_distance_m || 0,
actual_total_m: parsed.actual_total_m || 0,
fare_total_yen: parsed.fare_total_yen || 0,
trip_count: parsed.trip_count || 0,
trips: Array.isArray(parsed.trips) ? parsed.trips : [],
last_meter_distance_m: parsed.last_meter_distance_m || 0,
};
// ロード後に3時間経過チェック（自動 abandon）
checkAutoAbandon();
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
// 直近 RETENTION_DAYS 日分のみ保持
// 判定は end_time 優先（無ければ start_time、それも無ければ残す）
const cutoff = Date.now() - RETENTION_MS;
const trimmed = list.filter(item => {
const t = item.end_time || item.start_time || null;
if(t === null) return true;  // 時刻不明は残す（保険）
return t >= cutoff;
});
localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
if(typeof dlog === 'function') {
dlog('[Business] history saved (' + trimmed.length + ' items, ' + RETENTION_DAYS + 'days retention)');
}
} catch(e) {
if(typeof dlog === 'function') dlog('[Business] history save error: ' + e.message);
}
}

// 履歴から業務状態を復元して active 状態に戻す（業務開始画面の「続きから再開」用）
// history: getLastEndedBusiness() で取得した履歴オブジェクト
function restoreFromHistory(history){
if(!history) return false;
if(typeof history.start_time !== 'number') return false;
// 履歴を state に書き戻す
state = {
active: true,                              // 再開なので active に戻す
start_time: history.start_time,
end_time: null,                            // 再開時はクリア
ended: false,                              // 再開なので false
ended_at: null,
total_distance_m: history.total_distance_m || 0,
actual_total_m: history.actual_total_m || 0,
fare_total_yen: history.fare_total_yen || 0,
trip_count: history.trip_count || 0,
trips: Array.isArray(history.trips) ? [...history.trips] : [],
last_meter_distance_m: 0,                   // Meter は再起動するためクリア
};
// 履歴から該当エントリを削除（重複防止）
try {
const raw = localStorage.getItem(HISTORY_KEY);
if(raw){
const list = JSON.parse(raw);
const filtered = list.filter(item => item.end_time !== history.end_time);
localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
}
} catch(e){}
save();
if(typeof dlog === 'function') dlog('[Business] restored from history (resumed)');
return true;
}

// ─────────────────────────────────────────
// 公開API
// ─────────────────────────────────────────
return {
start, end, resume, abandon,
canResume, checkAutoAbandon,
onGps, onTripEnd,
getState, getReport,
save, load,
restoreFromHistory,
};
})();
