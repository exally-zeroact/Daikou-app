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

const CACHE_NAME = 'daikome-cf7fbb0';
// ★設計変更宣言 (2026-05-13): 47県データを固定名 cache に分離
//   旧: アプリコード CACHE_NAME が hash で毎デプロイ更新 → 旧 cache 全削除 →
//       47県データ (/data/roads-*.js) も全削除 → 全欠落・204MB 再 DL
//   新: /data/roads-*.js は CACHE_NAME_ROADS (固定名) に保存
//       アプリコード CACHE_NAME 更新は roads cache に影響しない
//       スキーマ変更時のみ v1→v2 にバンプ (cache-buster)
const CACHE_NAME_ROADS = 'daikome-roads-v1';

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
  // ★ オフラインファースト必須バンドル（13種・全国共通データ）
  '/data/coarse-jp.js',
  '/data/pref-borders-jp.js',
  '/data/shelters-jp.js',
  '/data/emergency-medical-jp.js',
  '/data/highways-jp.js',
  '/data/stations-jp.js',
  // ★設計変更宣言 (2026-05-13): waterways/peaks/hiking-trails/misc は
  //   ダイコメ機能上絶対使わないため precache 対象から除外 (~32MB 削減)
  //   data/ フォルダにファイル自体は残置・他プロジェクトで利用可
  '/data/faults-jp.js',
  '/data/night-clinics-jp.js',
  '/data/airports-jp.js',
  '/data/michinoeki-jp.js',
  '/data/coastline-jp.js',
  '/data/ports-jp.js',
  '/data/railways-jp.js',
  '/data/hazard-cliff-jp.js',
  // ★設計変更宣言 (2026-05-13): DEM (標高) データを precache に追加
  //   全国 0.05° grid (~5.5km/cell) 333k cells Int16 → base64 ~870KB
  //   用途: GPS 高度照合で誤マッチ判定 / 道路区間 Δh 加味で 3D 距離補正
  //   従来 404 で globalFailed に積まれてた dem-jp.js を実データで提供
  '/data/dem-jp.js',
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

// ★設計変更宣言 (2026-05-13): activate handler を migration 対応に変更
//   旧: CACHE_NAME 以外を全削除 → 47県データも消滅
//   新: 旧 daikome-{hash} cache 内の /data/roads-*.js を CACHE_NAME_ROADS へ
//       1 件ずつ try/catch で migrate してから旧 cache 削除
//       CACHE_NAME / CACHE_NAME_ROADS は保護対象 (削除しない)
self.addEventListener('activate', function(e){
  e.waitUntil((async function(){
    try {
      const keys = await caches.keys();
      const newRoadsCache = await caches.open(CACHE_NAME_ROADS);
      // 旧 daikome-{hash} cache から /data/roads-*.js を migrate
      for(const oldName of keys){
        // 保護対象: 新 CACHE_NAME と CACHE_NAME_ROADS は触らない
        if(oldName === CACHE_NAME) continue;
        if(oldName === CACHE_NAME_ROADS) continue;
        // 旧 daikome-* prefix のみ migrate 対象 (他オリジン無関係 cache は触らない)
        if(oldName.indexOf('daikome-') !== 0) continue;
        try {
          const oldCache = await caches.open(oldName);
          const reqs = await oldCache.keys();
          for(const req of reqs){
            if(req.url.indexOf('/data/roads-') === -1) continue;
            // 1 件失敗で全体止めないよう個別 try/catch
            try {
              const res = await oldCache.match(req);
              if(res) await newRoadsCache.put(req, res);
            } catch(_){}
          }
        } catch(_){}
      }
      // migrate 後に旧 cache (CACHE_NAME / CACHE_NAME_ROADS 以外) を削除
      await Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== CACHE_NAME_ROADS)
            .map(k => caches.delete(k).catch(function(){}))
      );
    } catch(_){}
    await self.clients.claim();
  })());
});

// SWR（Stale-While-Revalidate）共通関数
// キャッシュから即時返しつつ、裏でネット取得＆キャッシュ更新
// ★必ず Response を返す（undefined を返すと "null FetchEvent" エラーになる）
// ★設計変更宣言 (2026-05-13): 第2引数 cacheName 受入 (省略時は CACHE_NAME)
//   /data/roads-*.js は CACHE_NAME_ROADS を渡して固定名 cache に保存・読込
// ★設計変更宣言 (2026-05-13): CACHE_NAME_ROADS への put/match は URL の search
//   params を除去した正規化 URL を cache キーとして使う
//   旧: ?_v={timestamp} 等のクエリ付き URL がそのまま別エントリとして cache に
//       残り、no-query 版と二重化していた (10 県の ?_v= 付き残存問題)
//   新: cacheKey = normalizedRequest (query 除去) で put/match → 1 県 1 エントリに統一
function staleWhileRevalidate(request, cacheName){
  cacheName = cacheName || CACHE_NAME;
  let cacheKey = request;
  if(cacheName === CACHE_NAME_ROADS){
    try {
      const normalizedUrl = new URL(request.url);
      normalizedUrl.search = '';
      cacheKey = new Request(normalizedUrl.toString(), { headers: request.headers });
    } catch(_){}
  }
  return caches.open(cacheName).then(function(cache){
    return cache.match(cacheKey).then(function(cached){
      const fetchPromise = fetch(request).then(function(response){
        if(response && response.ok && request.method === 'GET'){
          // 同一オリジンの正常レスポンスのみキャッシュ（opaque は除外）
          if(response.type === 'basic' || response.type === 'default'){
            // ★設計変更宣言 (2026-05-13): cache.put 失敗を main thread に通知
            //   旧: .catch(()=>{}) で黙って握りつぶし → IndexedDB prefStatus と
            //       Cache の整合性破れ (47/47 完了マーク済なのに 1 県だけ cache 欠落)
            //   新: cache.put 失敗時に postMessage({type:'cachePutFailed', url})
            //       main thread 側 (index.html) で受信し prefStatus を未完了に戻す
            cache.put(cacheKey, response.clone()).catch(function(err){
              return self.clients.matchAll({ type: 'window' }).then(function(clients){
                for(var i = 0; i < clients.length; i++){
                  try { clients[i].postMessage({ type: 'cachePutFailed', url: request.url }); } catch(_) {}
                }
              }).catch(function(){});
            });
          }
        }
        return response;
      }).catch(function(){
        // ネット失敗時：cached → "/" → 最終手段で network error Response
        return cached || caches.match('/').then(function(r){
          return r || Response.error();
        });
      });
      return cached || fetchPromise;
    });
  });
}

// ナビゲーション専用ハンドラ：querystring 無視で precache を確実にヒット
// /history.html?_v=xxx のようなパラメータ付きでも /history.html のキャッシュとマッチ
function navigationHandler(request){
  return caches.open(CACHE_NAME).then(function(cache){
    return cache.match(request, { ignoreSearch: true }).then(function(cached){
      const fetchPromise = fetch(request).then(function(response){
        if(response && response.ok){
          cache.put(request, response.clone()).catch(function(){});
        }
        return response;
      }).catch(function(){
        return cached || caches.match('/').then(function(r){
          return r || Response.error();
        });
      });
      return cached || fetchPromise;
    });
  });
}

// /api/* 専用：ネットワーク優先・失敗時に HTML を返さず JSON エラーを返す
// （history.html の /api/distance 呼び出しが HTML 化けして JSON.parse 失敗する事故を防ぐ）
function networkOnlyJson(request){
  return fetch(request).catch(function(){
    return new Response(
      JSON.stringify({ error: 'offline', source: 'sw' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  });
}

self.addEventListener('fetch', function(e){
  const req = e.request;

  // [修正1] 非 GET (POST/PUT/DELETE/OPTIONS) は SW 介入しない
  //   → cache.match できず undefined を respondWith → "null FetchEvent" の主因
  if(req.method !== 'GET') return;

  const url = new URL(req.url);

  // [修正2] http(s) 以外（chrome-extension://, data:, blob:, devtools://）は SW 介入しない
  //   → cache.put が "scheme not supported" 例外で reject → respondWith が undefined になる
  if(url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // [修正3] クロスオリジン（firebase / googleapis / gstatic / fonts.g 含む）は SW 介入しない
  //   → ブラウザが直接処理。SW を経由しないことで opaque キャッシュ汚染も回避
  if(url.origin !== self.location.origin) return;

  // [修正4] /api/* は network-only。失敗時も HTML フォールバックせず JSON エラー返却
  //   → 旧コードでは fetch 失敗時 caches.match('/') が HTML を返し、呼び出し側 JSON.parse が落ちていた
  if(url.pathname.startsWith('/api/')){
    e.respondWith(networkOnlyJson(req));
    return;
  }

  // [修正5] ナビゲーションリクエスト（HTML ページ取得）は querystring 無視で precache マッチ
  //   → /history.html?foo=bar でも /history.html のキャッシュにヒット
  if(req.mode === 'navigate'){
    e.respondWith(navigationHandler(req));
    return;
  }

  // ★設計変更宣言 (2026-05-13): /data/roads-*.js は CACHE_NAME_ROADS (固定名) に分離
  //   アプリコード CACHE_NAME が hash 更新されても 47 県キャッシュは保持される
  if(req.url.includes('/data/roads-')){
    e.respondWith(staleWhileRevalidate(req, CACHE_NAME_ROADS));
    return;
  }

  // 道路データ・地図関連：SWR（最重要・オフライン必須）
  if(
    req.url.includes('/roads/') ||
    req.url.includes('/road-data/') ||
    req.url.includes('/data/roads-') ||
    req.url.includes('/data/bridges') ||
    req.url.includes('/data/tunnels') ||
    req.url.includes('/data/poi-') ||
    req.url.includes('/data/hazard-') ||
    req.url.includes('/data/road-attrs-') ||
    req.url.includes('/data/meta.json') ||
    // 全国共通バンドル（13種・初回 install で全 precache 済）
    req.url.includes('/data/coarse-jp.js') ||
    req.url.includes('/data/pref-borders-jp.js') ||
    req.url.includes('/data/shelters-jp.js') ||
    req.url.includes('/data/emergency-medical-jp.js') ||
    req.url.includes('/data/highways-jp.js') ||
    req.url.includes('/data/stations-jp.js') ||
    req.url.includes('/data/misc-jp.js') ||
    req.url.includes('/data/faults-jp.js') ||
    req.url.includes('/data/night-clinics-jp.js') ||
    req.url.includes('/data/airports-jp.js') ||
    req.url.includes('/data/michinoeki-jp.js') ||
    req.url.includes('/data/coastline-jp.js') ||
    req.url.includes('/data/ports-jp.js') ||
    req.url.includes('/data/peaks-jp.js') ||
    req.url.includes('/data/hiking-trails-jp.js') ||
    req.url.includes('/data/railways-jp.js') ||
    req.url.includes('/data/waterways-jp.js') ||
    req.url.includes('/data/hazard-cliff-jp.js')
  ){
    e.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 静的アセット（icon・manifest）：cache-first
  if(req.url.includes('/icon-') || req.url.includes('/manifest.json')){
    e.respondWith(
      caches.match(req).then(function(cached){
        return cached || fetch(req).catch(function(){ return Response.error(); });
      })
    );
    return;
  }

  // その他（JS・CSS）：SWR
  e.respondWith(staleWhileRevalidate(req));
});

// Background Sync（Phase 2.B 訓練データ upload trigger）
//   M2 (2026-05-10): 旧 'firebase-sync' tag handler は dead code のため削除
//   現在使用中の tag は 'training-upload' のみ
self.addEventListener('sync', function(e){
  if(e.tag === 'training-upload'){
    e.waitUntil(_notifyClientsTrainingUpload());
  }
});

function _notifyClientsTrainingUpload(){
  return self.clients.matchAll({ type: 'window' }).then(function(clients){
    for(const c of clients){
      try { c.postMessage({ type: 'TRAINING_UPLOAD_TRIGGER' }); } catch(_) {}
    }
  });
}
