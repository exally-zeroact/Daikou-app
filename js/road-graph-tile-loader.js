// ============================================================
// road-graph-tile-loader.js
// Phase B (2026-05-08): タイル road-graph の遅延ロード（main 側）
//
// 責務:
//   - data/road-graph-tiles/{pref}/index.json を取得しタイル一覧を持つ
//   - data/road-graph-tiles/{pref}/{tx}_{ty}.js を必要時に <script> でロード
//   - IndexedDB ('daikome_tiles') を L2 キャッシュとして使用（オフライン保証）
//   - Worker B からの requestTile メッセージに応答する
//
// 注意: 本実装は Phase B 基盤・runtime 統合（map-matcher.js _routeDistance の
//   タイル経路）は後続コミットで対応。現状は loader API のみ提供。
// ============================================================

const RoadGraphTileLoader = (() => {
  const _DB_NAME = 'daikome_tiles';
  const _DB_VERSION = 1;
  let _dbPromise = null;
  const indexCache = new Map();    // pref → index json
  const loadedTiles = new Set();   // "pref/tx_ty"

  function _openDb(){
    if(_dbPromise) return _dbPromise;
    if(typeof indexedDB === 'undefined') return Promise.resolve(null);
    _dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(_DB_NAME, _DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if(!db.objectStoreNames.contains('tiles')){
            db.createObjectStore('tiles', { keyPath: 'k' });   // k = "pref/tx_ty"
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
      } catch(e){ resolve(null); }
    });
    return _dbPromise;
  }

  function _idbGet(key){
    return _openDb().then(function(db){
      if(!db) return null;
      return new Promise(function(resolve){
        try {
          const tx = db.transaction('tiles', 'readonly');
          const req = tx.objectStore('tiles').get(key);
          req.onsuccess = function(){ resolve(req.result ? req.result.data : null); };
          req.onerror = function(){ resolve(null); };
        } catch(e){ resolve(null); }
      });
    }).catch(function(){ return null; });
  }

  function _idbPut(key, data){
    return _openDb().then(function(db){
      if(!db) return;
      try {
        const tx = db.transaction('tiles', 'readwrite');
        tx.objectStore('tiles').put({ k: key, data: data });
      } catch(e){}
    }).catch(function(){});
  }

  function loadIndex(pref){
    if(indexCache.has(pref)) return Promise.resolve(indexCache.get(pref));
    return fetch('data/road-graph-tiles/' + pref + '/index.json')
      .then(function(r){
        if(!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(function(idx){
        indexCache.set(pref, idx);
        return idx;
      })
      .catch(function(e){
        if(typeof dlog === 'function'){
          dlog('[Tile] index load fail ' + pref + ': ' + e.message);
        }
        return null;
      });
  }

  // ロードしたタイルデータを返す（IDB → script 順で試行）
  function loadTile(pref, tx, ty){
    const key = pref + '/' + tx + '_' + ty;
    if(loadedTiles.has(key)){
      const varName = 'ROAD_GRAPH_TILE_' + pref.toUpperCase() + '_' + tx + '_' + ty;
      return Promise.resolve(window[varName] || null);
    }
    // 1) IDB から優先取得
    return _idbGet(key).then(function(cached){
      if(cached){
        loadedTiles.add(key);
        return cached;
      }
      // 2) script として読み込み（404 なら null）
      return new Promise(function(resolve){
        const script = document.createElement('script');
        script.src = 'data/road-graph-tiles/' + pref + '/' + tx + '_' + ty + '.js';
        script.async = true;
        script.onload = function(){
          const varName = 'ROAD_GRAPH_TILE_' + pref.toUpperCase() + '_' + tx + '_' + ty;
          const data = window[varName];
          if(data){
            loadedTiles.add(key);
            // IDB に永続化（次回オフラインで使用）
            _idbPut(key, data);
            resolve(data);
          } else {
            resolve(null);
          }
        };
        script.onerror = function(){
          if(typeof dlog === 'function') dlog('[Tile] not found ' + key);
          resolve(null);
        };
        document.head.appendChild(script);
      });
    });
  }

  function getStats(){
    return {
      indexedPrefs: Array.from(indexCache.keys()),
      loadedTiles: Array.from(loadedTiles),
    };
  }

  return { loadIndex, loadTile, getStats };
})();

if(typeof window !== 'undefined') window.RoadGraphTileLoader = RoadGraphTileLoader;
