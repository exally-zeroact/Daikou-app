// ===========================================
// sw.js（ServiceWorker・ダイコメPWA対応）
// オフラインキャッシュ・Map Matchingデータ永続化
// ===========================================

const CACHE_NAME = 'daikome-v1';

const CACHE_FILES = [
  '/',
  '/index.html',
  '/settings.html',
  '/history.html',
  '/js/gps.js',
  '/js/gps-worker.js',
  '/js/meter.js',
  '/js/firebase.js',
  '/js/firebase-config.js',
  '/js/debug-config.js',
  '/js/region-loader.js',
  '/js/test-mode.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(CACHE_FILES);
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

  // Firebase・外部API・フォントはネット優先（キャッシュしない）
  if(
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('fonts.g')
  ){
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // 道路データ（Map Matching用）はネット優先・キャッシュにも保存
  if(e.request.url.includes('/roads/') || e.request.url.includes('/road-data/')){
    e.respondWith(
      fetch(e.request).then(function(response){
        if(response.ok){
          const clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(e.request, clone); });
        }
        return response;
      }).catch(function(){
        return caches.match(e.request);
      })
    );
    return;
  }

  // アプリ本体：キャッシュ優先
  e.respondWith(
    caches.match(e.request).then(function(cached){
      return cached || fetch(e.request);
    })
  );
});

// Background Sync（Firebase送信）
self.addEventListener('sync', function(e){
  if(e.tag === 'firebase-sync'){
    console.log('[SW] Background Sync: Firebase送信');
  }
});
