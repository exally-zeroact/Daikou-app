// ===========================================
// sw.js（ServiceWorker・ダイコメPWA対応）
// HTML/JS：ネットワーク優先（常に最新・バージョン管理不要）
// 道路データ：キャッシュ優先（重いファイル・オフライン対応）
// ===========================================

const CACHE_NAME = 'daikome-c3c5cc9';

// アイコン・manifestだけキャッシュ（変わらないもの）
const PRECACHE_FILES = [
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(PRECACHE_FILES);
    }).then(function(){
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(function(){
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e){
  const url = new URL(e.request.url);

  // Firebase・外部API・フォント：ネットワークのみ（キャッシュしない）
  if(
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('fonts.g')
  ){
    e.respondWith(fetch(e.request));
    return;
  }

  // 道路データ（Map Matching用）：キャッシュ優先・ネットでフォールバック
  if(e.request.url.includes('/roads/') || e.request.url.includes('/road-data/')){
    e.respondWith(
      caches.match(e.request).then(function(cached){
        if(cached) return cached;
        return fetch(e.request).then(function(response){
          if(response.ok){
            const clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache){ cache.put(e.request, clone); });
          }
          return response;
        });
      })
    );
    return;
  }

  // アイコン・manifest：キャッシュ優先
  if(e.request.url.includes('/icon-') || e.request.url.includes('/manifest.json')){
    e.respondWith(
      caches.match(e.request).then(function(cached){
        return cached || fetch(e.request);
      })
    );
    return;
  }

  // HTML・JS・CSS：ネットワーク優先 + キャッシュにも保存
  // ネットあり → 最新取得してキャッシュ更新
  // ネットなし → キャッシュから起動（電波なしスマホ対応）
  e.respondWith(
    fetch(e.request).then(function(response){
      if(response.ok && e.request.method === 'GET'){
        const clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(e.request, clone); });
      }
      return response;
    }).catch(function(){
      return caches.match(e.request);
    })
  );
});

// Background Sync（Firebase送信）
self.addEventListener('sync', function(e){
  if(e.tag === 'firebase-sync'){
    console.log('[SW] Background Sync: Firebase送信');
  }
});
