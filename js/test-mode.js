// ===========================================
// test-mode.js
// 1週間テスト用の誤差自動検証ツール
// ★リリース時は削除＆index.htmlからscript除去
// ===========================================
const TestMode = (() => {
  const STORAGE_KEY = 'daikou_test_logs';
  const MAX_LOGS = 200;
  const API_ENDPOINT = '/api/distance';

  let currentTrip = null;
  let positions = [];

  function startTrip(){
    currentTrip = {
      id: Date.now(),
      start_time: new Date().toISOString(),
      start_pos: null,
      end_pos: null,
      end_time: null,
      gps_distance_m: 0,
      true_distance_m: null,
      error_pct: null,
      error_note: '',
      route_url: '',
    };
    positions = [];
    console.log('[TestMode] 走行開始:', currentTrip.id);
  }

  function recordPosition(lat, lng){
    if(!currentTrip) return;
    if(!currentTrip.start_pos){
      currentTrip.start_pos = { lat, lng };
    }
    positions.push({ lat, lng, t: Date.now() });
    currentTrip.end_pos = { lat, lng };
  }

  function endTrip(appDistanceM){
    if(!currentTrip) return;
    currentTrip.end_time = new Date().toISOString();
    currentTrip.gps_distance_m = Math.round(appDistanceM);

    if(currentTrip.start_pos && currentTrip.end_pos){
      const sp = currentTrip.start_pos;
      const ep = currentTrip.end_pos;
      currentTrip.route_url = `https://www.google.com/maps/dir/${sp.lat},${sp.lng}/${ep.lat},${ep.lng}/`;
    }

    saveLog(currentTrip);
    console.log('[TestMode] 走行終了:', currentTrip);
    currentTrip = null;
    positions = [];
  }

  function saveLog(trip){
    const logs = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    logs.push(trip);
    if(logs.length > MAX_LOGS) logs.shift();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  }

  function getLogs(){
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  }

  // Google Maps API経由で真の距離を取得
  async function fetchTrueDistance(fromLat, fromLng, toLat, toLng){
    const url = `${API_ENDPOINT}?from=${fromLat},${fromLng}&to=${toLat},${toLng}`;
    try {
      const res = await fetch(url);
      if(!res.ok){
        const err = await res.json().catch(()=>({}));
        return { error: err.error || `HTTP ${res.status}` };
      }
      const data = await res.json();
      return {
        distance_m: data.distance_m,
        distance_text: data.distance_text,
        duration_sec: data.duration_sec,
      };
    } catch(e){
      return { error: e.message };
    }
  }

  // 全ログの真の距離を自動取得＆CSVエクスポート
  async function exportCSV(){
    const logs = getLogs();
    if(logs.length === 0){
      alert('テストログがありません');
      return;
    }

    // 進捗表示用
    const total = logs.length;
    let processed = 0;
    let success = 0;
    let failed = 0;
    let skipped = 0;

    showProgress(`取得中... 0 / ${total}`);

    for(const log of logs){
      // 既に真値あり → スキップ
      if(log.true_distance_m != null){
        skipped++;
        processed++;
        showProgress(`取得中... ${processed} / ${total}`);
        continue;
      }
      // 座標がない（PC等） → スキップ
      if(!log.start_pos || !log.end_pos){
        log.error_note = '座標なし';
        failed++;
        processed++;
        showProgress(`取得中... ${processed} / ${total}`);
        continue;
      }

      // API呼び出し
      const result = await fetchTrueDistance(
        log.start_pos.lat, log.start_pos.lng,
        log.end_pos.lat, log.end_pos.lng
      );

      if(result.error){
        log.error_note = 'API: ' + result.error;
        failed++;
      } else {
        log.true_distance_m = result.distance_m;
        log.true_distance_text = result.distance_text;
        if(log.true_distance_m > 0){
          log.error_pct = (log.gps_distance_m - log.true_distance_m) / log.true_distance_m * 100;
        }
        success++;
      }
      processed++;
      showProgress(`取得中... ${processed} / ${total} (成功:${success} 失敗:${failed})`);

      // API制限対策（1秒1リクエスト程度）
      await sleep(50);
    }

    // 取得結果を保存（再エクスポート時に再取得を防ぐ）
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    hideProgress();

    // CSV生成
    const header = ['ID', '開始時刻', '終了時刻', 'アプリ距離(m)', '真の距離(m)', '真の距離(text)', '誤差(%)', '備考', '開始座標', '終了座標', 'GoogleMaps URL'];
    const rows = logs.map(l => [
      l.id,
      l.start_time,
      l.end_time || '',
      l.gps_distance_m,
      l.true_distance_m != null ? l.true_distance_m : '',
      l.true_distance_text || '',
      l.error_pct != null ? l.error_pct.toFixed(2) : '',
      (l.error_note || '').replace(/,/g, '、'),
      l.start_pos ? `${l.start_pos.lat},${l.start_pos.lng}` : '',
      l.end_pos ? `${l.end_pos.lat},${l.end_pos.lng}` : '',
      l.route_url || '',
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daikou_test_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    alert(`完了\n成功: ${success}\n失敗: ${failed}\nスキップ(取得済): ${skipped}`);
  }

  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  function showProgress(msg){
    let el = document.getElementById('testmode-progress');
    if(!el){
      el = document.createElement('div');
      el.id = 'testmode-progress';
      el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#3b82f6;color:#fff;padding:12px 20px;border-radius:8px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3)';
      document.body.appendChild(el);
    }
    el.textContent = msg;
  }

  function hideProgress(){
    const el = document.getElementById('testmode-progress');
    if(el) el.remove();
  }

  // 統計
  function getStats(){
    const logs = getLogs().filter(l => l.error_pct != null);
    if(logs.length === 0) return { count: 0, message: 'まずexportCSVを実行' };
    const errors = logs.map(l => l.error_pct);
    const avg = errors.reduce((a,b)=>a+b,0) / errors.length;
    const absAvg = errors.reduce((a,b)=>a+Math.abs(b),0) / errors.length;
    const max = Math.max(...errors);
    const min = Math.min(...errors);
    return {
      count: logs.length,
      平均誤差_pct: avg.toFixed(2),
      平均絶対誤差_pct: absAvg.toFixed(2),
      最大誤差_pct: max.toFixed(2),
      最小誤差_pct: min.toFixed(2),
    };
  }

  function clearAll(){
    if(confirm('全テストログを削除しますか？')){
      localStorage.removeItem(STORAGE_KEY);
      console.log('[TestMode] 全削除完了');
    }
  }

  return {
    startTrip, endTrip, recordPosition,
    getLogs, exportCSV, fetchTrueDistance,
    getStats, clearAll
  };
})();
