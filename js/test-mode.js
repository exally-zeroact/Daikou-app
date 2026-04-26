// ===========================================
// test-mode.js
// 1週間テスト用の誤差検証ツール
// ★リリース時は削除＆index.htmlからscript除去
// ===========================================
const TestMode = (() => {
  // 設定
  const STORAGE_KEY = 'daikou_test_logs';
  const MAX_LOGS = 100;          // 最大100走行分

  // 走行ログ
  let currentTrip = null;        // 現在の走行データ
  let positions = [];            // GPS座標履歴

  // 走行開始
  function startTrip(){
    currentTrip = {
      id: Date.now(),
      start_time: new Date().toISOString(),
      start_pos: null,
      end_pos: null,
      end_time: null,
      gps_distance_m: 0,        // アプリ算出距離
      true_distance_m: null,    // Google Maps算出（後で取得）
      error_pct: null,          // 誤差率
      error_note: '',
      route_url: '',
    };
    positions = [];
    console.log('[TestMode] 走行開始:', currentTrip.id);
  }

  // GPS取得時に呼ばれる
  function recordPosition(lat, lng){
    if(!currentTrip) return;
    if(!currentTrip.start_pos){
      currentTrip.start_pos = { lat, lng };
    }
    positions.push({ lat, lng, t: Date.now() });
    // 最終位置を常に更新
    currentTrip.end_pos = { lat, lng };
  }

  // 走行終了（確定→空車時）
  async function endTrip(appDistanceM){
    if(!currentTrip) return;
    currentTrip.end_time = new Date().toISOString();
    currentTrip.gps_distance_m = Math.round(appDistanceM);

    // Google Maps URLを生成（手動確認用）
    if(currentTrip.start_pos && currentTrip.end_pos){
      const sp = currentTrip.start_pos;
      const ep = currentTrip.end_pos;
      currentTrip.route_url = `https://www.google.com/maps/dir/${sp.lat},${sp.lng}/${ep.lat},${ep.lng}/`;
    }

    // ローカルストレージに保存
    saveLog(currentTrip);
    console.log('[TestMode] 走行終了:', currentTrip);
    currentTrip = null;
    positions = [];
  }

  function saveLog(trip){
    const logs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    logs.push(trip);
    if(logs.length > MAX_LOGS) logs.shift(); // 古いものから削除
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  }

  // 全ログ取得
  function getLogs(){
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  }

  // CSVエクスポート（全データ）
  function exportCSV(){
    const logs = getLogs();
    if(logs.length === 0){
      alert('テストログがありません');
      return;
    }
    const header = ['ID', '開始時刻', '終了時刻', 'アプリ距離(m)', '真の距離(m)', '誤差(%)', '備考', '開始座標', '終了座標', 'GoogleMaps URL'];
    const rows = logs.map(l => [
      l.id,
      l.start_time,
      l.end_time || '',
      l.gps_distance_m,
      l.true_distance_m != null ? l.true_distance_m : '',
      l.error_pct != null ? l.error_pct.toFixed(2) : '',
      (l.error_note || '').replace(/,/g, '、'),
      l.start_pos ? `${l.start_pos.lat},${l.start_pos.lng}` : '',
      l.end_pos ? `${l.end_pos.lat},${l.end_pos.lng}` : '',
      l.route_url || '',
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    // BOM付きUTF-8でExcel互換に
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daikou_test_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 真の距離を手動入力
  function setTrueDistance(tripId, trueM, note){
    const logs = getLogs();
    const idx = logs.findIndex(l => l.id === tripId);
    if(idx < 0){
      console.error('ID not found:', tripId);
      return;
    }
    logs[idx].true_distance_m = trueM;
    logs[idx].error_note = note || '';
    if(trueM > 0){
      logs[idx].error_pct = (logs[idx].gps_distance_m - trueM) / trueM * 100;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    console.log('[TestMode] 真値設定:', logs[idx]);
  }

  // 統計
  function getStats(){
    const logs = getLogs().filter(l => l.error_pct != null);
    if(logs.length === 0) return { count: 0 };
    const errors = logs.map(l => l.error_pct);
    const avg = errors.reduce((a,b)=>a+b,0) / errors.length;
    const absAvg = errors.reduce((a,b)=>a+Math.abs(b),0) / errors.length;
    const max = Math.max(...errors);
    const min = Math.min(...errors);
    return {
      count: logs.length,
      avg_error_pct: avg.toFixed(2),
      avg_abs_error_pct: absAvg.toFixed(2),
      max_error_pct: max.toFixed(2),
      min_error_pct: min.toFixed(2),
    };
  }

  // 全クリア（リリース前に呼ぶ）
  function clearAll(){
    if(confirm('全テストログを削除しますか？')){
      localStorage.removeItem(STORAGE_KEY);
      console.log('[TestMode] 全削除完了');
    }
  }

  return {
    startTrip, endTrip, recordPosition,
    getLogs, exportCSV, setTrueDistance,
    getStats, clearAll
  };
})();
