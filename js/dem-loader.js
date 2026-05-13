// ============================================================
// dem-loader.js
// MM-5 (2026-05-08): DEM (Digital Elevation Model) データの遅延ロード
//
// 期待されるファイル形式:
//   data/dem-jp.js が以下を設定する：
//   window.DEM_JP = {
//     bbox: [minLat, minLng, maxLat, maxLng],
//     gridSize: 0.01,            // degrees (≈1km)
//     numLat: int,
//     numLng: int,
//     altB64: string,            // Int16Array.buffer を base64 化
//   };
//
// scripts/fetch-dem-tiles.js の出力をこの形式に変換するビルドが必要（別タスク）。
// ファイル未生成の場合は 404 で graceful degrade（layer scorer は roads v6 + accel
// hint のみで動作・MM-5 全体としては動く）。
// ============================================================

const DemLoader = (() => {
  let loaded = false;
  let loading = null;

  function load(){
    if(loaded){
      return Promise.resolve(window.DEM_JP || null);
    }
    if(loading) return loading;

    loading = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'data/dem-jp.js';
      script.async = true;
      script.onload = () => {
        const data = window.DEM_JP;
        if(data){
          loaded = true;
          if(typeof dlog === 'function'){
            dlog('[DEM] loaded ' + data.numLat + 'x' + data.numLng + ' grid');
          }
          resolve(data);
        } else {
          if(typeof dlog === 'function'){
            dlog('[DEM] file loaded but DEM_JP not set');
          }
          resolve(null);
        }
        loading = null;
      };
      script.onerror = () => {
        if(typeof dlog === 'function'){
          dlog('[DEM] not found (dem-jp.js not built yet)');
        }
        loading = null;
        resolve(null);
      };
      document.head.appendChild(script);
    });

    return loading;
  }

  function isLoaded(){ return loaded; }

  return { load, isLoaded };
})();
