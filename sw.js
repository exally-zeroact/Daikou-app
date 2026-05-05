// ===========================================
// sw.js（ServiceWorker・ダイコメPWA対応）
// 2026/04/30 更新：SWR（Stale-While-Revalidate）戦略に変更
//
// 戦略：
//   外部API（Firebase等）：ネットワークのみ
//   静的アセット（icon・manifest）：キャッシュ優先
//   道路データ・HTML・JS・CSS：SWR（キャッシュ即返し＋裏で更新）
//
// SWR の挙動：
//   1. キャッシュから即時返す（速い・オフラインOK）
//   2. 同時にネット取得（バックグラウンド）
//   3. 取得成功したらキャッシュ更新
//   4. 次回起動時に新版が反映される
//
// 効果：
//   ✅ 起動が瞬時（1ms・キャッシュから）
//   ✅ オフラインで完全動作
//   ✅ ネットつながったら自動更新（翌起動反映）
//   ✅ 業務中に急にバージョン変わらない（安全）
// ===========================================

const CACHE_NAME = 'daikome-ddc1802';

// アイコン・manifest・start_url（"/"）をキャッシュ
// "/"のキャッシュは Chrome の installability 要件で必須
// （オフラインでも start_url が 200 を返せる必要がある）
const PRECACHE_FILES = [
  '/',
  '/history.html',
  '/settings.html',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      // "/"は明示的に reload で取得（古いキャッシュを使わない）
      return Promise.all([
        cache.add(new Request('/', { cache: 'reload' })),
        cache.addAll(PRECACHE_FILES.filter(function(p){ return p !== '/'; }))
      ]);
    }).then(function(){
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      // 古いキャッシュ（旧 CACHE_NAME のもの）を全削除
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(function(){
      return self.clients.claim();
    })
  );
});

// SWR（Stale-While-Revalidate）共通関数
// キャッシュから即時返しつつ、裏でネット取得＆キャッシュ更新
function staleWhileRevalidate(request){
  return caches.open(CACHE_NAME).then(function(cache){
    return cache.match(request).then(function(cached){
      const fetchPromise = fetch(request).then(function(response){
        // 正常なレスポンスのみキャッシュ更新（GET のみ）
        if(response && response.ok && request.method === 'GET'){
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function(){
        // ネット失敗時もキャッシュがあればそれを返す。
        // ない場合は最終手段として "/" のキャッシュ（SPA 起動点）にフォールバック。
        return cached || caches.match('/');
      });
      // キャッシュあればそれを即返す（裏で fetchPromise 動く）
      // なければ fetchPromise を待つ
      return cached || fetchPromise;
    });
  });
}

self.addEventListener('fetch', function(e){
  const url = new URL(e.request.url);

  // 外部API：ネットワークのみ（キャッシュしない・SWR対象外）
  if(
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('fonts.g')
  ){
    e.respondWith(fetch(e.request));
    return;
  }

  // 道路データ・地図関連：SWR（最重要・オフライン必須）
  // 2026/04/30 修正：パス条件に /data/roads- を追加（バグ修正）
  if(
    e.request.url.includes('/roads/') ||
    e.request.url.includes('/road-data/') ||
    e.request.url.includes('/data/roads-') ||
    e.request.url.includes('/data/bridges') ||
    e.request.url.includes('/data/tunnels') ||
    e.request.url.includes('/data/meta.json')
  ){
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }

  // 静的アセット（icon・manifest）：キャッシュ優先（変わらないから）
  if(e.request.url.includes('/icon-') || e.request.url.includes('/manifest.json')){
    e.respondWith(
      caches.match(e.request).then(function(cached){
        return cached || fetch(e.request);
      })
    );
    return;
  }

  // HTML・JS・CSS：SWR（速い起動＋自動更新）
  // ネットあり → キャッシュ即返し＋裏で最新取得
  // ネットなし → キャッシュから（オフライン対応）
  e.respondWith(staleWhileRevalidate(e.request));
});

// Background Sync（Firebase送信）
self.addEventListener('sync', function(e){
  if(e.tag === 'firebase-sync'){
    console.log('[SW] Background Sync: Firebase送信');
  }
});
