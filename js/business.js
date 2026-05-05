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

// GPS連続性
last_gps: null,             // {lat, lng, timestamp}

};

// GPS差分の異常値しきい値（meter.js MM_MAX_SEGMENT_DIST_M と揃える）
const MAX_SEGMENT_DIST_M = 1000;
// GPS空白検出（5秒以上空いたら連続性リセット）
const GAP_RESET_SEC = 5;

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
last_gps: null,
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
state.last_gps = null;  // GPS連続性リセット（再開時にジャンプ防止）
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
last_gps: null,
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
// GPS save throttle（onGps 毎回 save するとパフォーマンス問題のため）
// 2026/05/04 夜・追加：タスクキル時の total_distance_m 消失防止
let _lastGpsSaveAt = 0;
const GPS_SAVE_INTERVAL_MS = 1000;  // 1秒に1回 save
let _lastDebugLogAt = 0;  // 加算ログのthrottle

function onGps(gpsResult){
if(!state.active) return;
if(!gpsResult) return;
// 2026/05/05 修正：isStationary 判定削除（司さん指示）
//   旧コード：停止判定で return → 信号待ち・低速時に加算されない
//   問題：iPhone GPS の速度判定が低速時に不正確 → 動いてるのに stationary 扱い
//         → 1時間動いても加算 2.2m しかない（実機ログ確認済）
//   修正：「タイムラインで増やせ」司さん指示に従い isStationary 判定削除
//         GPS callback 来るたびに前回からの距離を加算する
//         異常値（1km超え）は MAX_SEGMENT_DIST_M でスキップする保険は維持
if(typeof gpsResult.lat !== 'number' || typeof gpsResult.lng !== 'number') return;


const now = gpsResult.timestamp || Date.now();

if(state.last_gps){
  const dtSec = (now - state.last_gps.timestamp) / 1000;

  // GPS空白検出：5秒以上空いたら連続性リセット（距離加算しない）
  if(dtSec >= GAP_RESET_SEC){
    state.last_gps = { lat: gpsResult.lat, lng: gpsResult.lng, timestamp: now };
    return;
  }

  // GPS差分計算（Haversine 公式・自前実装で外部依存ゼロ）
  // 2026/05/04 夜・修正：GPS.calcDistance が公開されてない可能性に対応
  let d = 0;
  try {
    const R = 6371000; // 地球半径（メートル）
    const lat1 = state.last_gps.lat * Math.PI / 180;
    const lat2 = gpsResult.lat * Math.PI / 180;
    const dLat = (gpsResult.lat - state.last_gps.lat) * Math.PI / 180;
    const dLng = (gpsResult.lng - state.last_gps.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    d = R * c;
  } catch(e){
    if(typeof dlog === 'function') dlog('[Business] 距離計算エラー: ' + e.message);
    d = 0;
  }

  // 異常値スキップ（1更新で1km超えはGPSジャンプ）
  if(d >= 0 && d <= MAX_SEGMENT_DIST_M){
    state.total_distance_m += d;
    // 5秒に1回ログ（スパム防止・動作確認用）
    const _logNow = Date.now();
    if(!_lastDebugLogAt || _logNow - _lastDebugLogAt > 5000){
      _lastDebugLogAt = _logNow;
      if(typeof dlog === 'function') dlog('[Business] 加算: +' + d.toFixed(1) + 'm 累計=' + (state.total_distance_m/1000).toFixed(2) + 'km');
    }
  } else {
    if(typeof dlog === 'function') dlog('[Business] skip 異常距離: ' + d.toFixed(0) + 'm');
  }
}

state.last_gps = { lat: gpsResult.lat, lng: gpsResult.lng, timestamp: now };

// 1秒に1回 localStorage に保存（タスクキル対策）
// 2026/05/04 夜・追加：司さん指摘「タスクキルしたら総走行距離が0に戻る」
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
ended: !!parsed.ended,
ended_at: parsed.ended_at || null,
total_distance_m: parsed.total_distance_m || 0,
actual_total_m: parsed.actual_total_m || 0,
fare_total_yen: parsed.fare_total_yen || 0,
trip_count: parsed.trip_count || 0,
trips: Array.isArray(parsed.trips) ? parsed.trips : [],
last_gps: parsed.last_gps || null,
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
last_gps: null,                            // GPS は再起動するためクリア
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
getState, getReport, exportCSV,
save, load,
getHistory, clearHistory,
restoreFromHistory,
};
})();
