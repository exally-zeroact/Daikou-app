// ============================================================
// data-loader.js (2026-05-13 新規)
// ★設計変更宣言: 旧 script タグ inject + window グローバル方式の置換
//   旧: <script src="data/foo.js"> → window.FOO_JP に値が代入される
//       script.onload で window.FOO_JP を読む (汚染あり・silent failure あり)
//   新: cache から fetch → text 取得 → sandbox eval で sandbox オブジェクトに代入
//       window グローバルを汚染せず・失敗を顕在化
//
// API:
//   DataLoader.loadFromCache(url) → Promise<sandbox>
//     sandbox = { COARSE_JP: {...}, ROADS_TOKYO: {...}, ... } 等
//
// 仕様:
//   1. caches.open('daikome-roads-v1') を試行 (47県 roads データ)
//   2. cache.match(url) で取得
//   3. miss なら caches.open(CACHE_NAME) (アプリコード cache) も試行
//   4. それでも miss なら fetch(url, {cache:'reload'}) で network 経由
//   5. 取得した text を Function('window', text) で sandbox eval
//   6. sandbox オブジェクトを返す
// ============================================================

(function(global){
  'use strict';

  // ★ daikome-roads-v1 + アプリコード cache を順に検索する fallback chain
  async function _matchInCaches(url){
    if(typeof caches === 'undefined') return null;
    try {
      const names = await caches.keys();
      // 1. roads cache を優先
      if(names.indexOf('daikome-roads-v1') !== -1){
        const c = await caches.open('daikome-roads-v1');
        const r = await c.match(url);
        if(r) return r;
      }
      // 2. アプリコード cache (daikome-{hash}) も試す
      for(const n of names){
        if(n === 'daikome-roads-v1') continue;
        if(n.indexOf('daikome-') !== 0) continue;
        const c = await caches.open(n);
        const r = await c.match(url);
        if(r) return r;
      }
    } catch(_){}
    return null;
  }

  async function _fetchAsText(url){
    // cache 検索 → fallback で network
    let res = await _matchInCaches(url);
    if(!res){
      // SW 経由で取得 (network・cache:'reload' で HTTP cache bypass)
      try {
        res = await fetch(url, { cache: 'reload' });
      } catch(e){
        throw new Error('fetch failed: ' + url + ' (' + (e && e.message) + ')');
      }
    }
    if(!res || !res.ok){
      throw new Error('not ok: ' + url + ' status=' + (res && res.status));
    }
    return await res.text();
  }

  // sandbox eval: 旧 script タグ inject の代替
  //   旧: <script src> で評価 → 副作用で window.X に代入
  //   新: text を Function 化 → sandbox 引数 (window 名) に代入 → 取得
  //   注意: CSP 'unsafe-eval' が必要 (vercel.json 等で許可済前提)
  function _evalText(text, url){
    const sandbox = {};
    try {
      // 'window' 引数で受けて sandbox に代入される (旧 code は window.X = ... と書いてる)
      const fn = new Function('window', text);
      fn(sandbox);
    } catch(e){
      throw new Error('eval failed: ' + url + ' (' + (e && e.message) + ')');
    }
    return sandbox;
  }

  async function loadFromCache(url){
    const text = await _fetchAsText(url);
    return _evalText(text, url);
  }

  const api = { loadFromCache };
  global.DataLoader = api;
})(typeof window !== 'undefined' ? window
   : typeof self !== 'undefined' ? self
   : typeof globalThis !== 'undefined' ? globalThis
   : this);
