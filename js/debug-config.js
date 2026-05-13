// ===========================================
// debug-config.js
// 環境変数によるデバッグ機能制御（2026/04/26追加）
// ★本番ドメイン移行時に自動的に無効化される
// ★リリース時の削除作業ゼロ化
// ===========================================
const DEBUG = (() => {
  const hostname = location.hostname;
  const search = location.search;

  // 本番ドメイン allowlist（ここに載った hostname だけが prod 扱い）
  // 本番Vercel URL（daikou-app.vercel.app）も独自ドメイン移行後の独自ドメインも、ここに追記すれば prod になる
  const PRODUCTION_HOSTS = new Set([
    'daikou-app.vercel.app',
  ]);

  // 環境判定
  const isProductionHost = PRODUCTION_HOSTS.has(hostname);
  // vercel.app サブドメインのうち、prod 以外（test 本URL / branch preview など）を preview 扱い
  const isVercelPreview = hostname.endsWith('.vercel.app') && !isProductionHost;
  const isLocalhost = (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.')
  );
  const hasDebugParam = search.includes('debug=1');

  // 本番環境判定（PRODUCTION_HOSTS に一致 or 独自ドメイン）
  const isProduction = isProductionHost || (!isVercelPreview && !isLocalhost);

  return {
    // テスト環境（vercel.app or localhost）→ デバッグ機能ON
    // 本番環境でも ?debug=1 付ければデバッグ機能ON
    enabled: isVercelPreview || isLocalhost || hasDebugParam,

    // Eruda 表示判定
    // ?debug=1 / localhost → 自動表示
    // vercel.app プレビュー → 自動表示（テスト中なので）
    showEruda: isVercelPreview || isLocalhost || hasDebugParam,

    // 本番環境判定（ログ出力制御で使用）
    isProduction: isProduction,
    isVercelPreview: isVercelPreview,
    isLocalhost: isLocalhost,
    hasDebugParam: hasDebugParam,
  };
})();

// ===========================================
// Eruda 組み込み（条件付き）
// スマホで F12 Console が見れる神ツール
// ★設計変更宣言 (2026-05-12): フローティング 🐛 ボタンで開閉トグル化
//   旧: ?debug=eruda パラメータ必須・常時表示なし
//   新: DEBUG.showEruda=true (vercel preview / localhost / ?debug=1) なら
//       画面左下に 🐛 ボタンを常時表示
//       初回タップで lazy load → 表示・再タップで非表示トグル
//       PRODUCTION_HOSTS (本番) では DEBUG.showEruda=false → ボタンも非表示
//   旧設計 (2026-05-11) との関係:
//       idle 画面右下の ⚙️ ボタンは削除済 (ユーザー UI からは別)
//       本 🐛 ボタンは「開発者向け debug 環境のみ」表示なので両立する
// ===========================================
(function initErudaToggle(){
  if(!DEBUG.showEruda) return;
  let _erudaLoaded = false;
  let _erudaVisible = false;
  let _loading = false;

  const btn = document.createElement('button');
  btn.id = 'erudaToggleBtn';
  btn.type = 'button';
  btn.textContent = '🐛';
  btn.setAttribute('aria-label', 'Toggle Eruda console');
  btn.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:9001;' +
    'width:44px;height:44px;border-radius:50%;border:none;' +
    'background:rgba(0,0,0,0.72);color:#fff;font-size:22px;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;' +
    'display:flex;align-items:center;justify-content:center;' +
    'padding:0;line-height:1;-webkit-tap-highlight-color:transparent;';

  function _attach(){
    if(document.body){
      document.body.appendChild(btn);
    } else {
      document.addEventListener('DOMContentLoaded', function(){
        document.body.appendChild(btn);
      });
    }
  }
  _attach();

  function _loadEruda(cb){
    if(_erudaLoaded){ cb(); return; }
    if(_loading) return;   // 連打防止 (load 完了前)
    _loading = true;
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/eruda';
    s.onload = function(){
      _loading = false;
      if(typeof eruda !== 'undefined'){
        try { eruda.init(); } catch(e){ console.warn('[DEBUG] eruda.init error:', e && e.message); }
        // Eruda 標準の entry button は隠す (本 🐛 ボタンが代替)
        try {
          const entry = document.querySelector('.eruda-entry-btn');
          if(entry) entry.style.display = 'none';
        } catch(_){}
        _erudaLoaded = true;
        console.log('[DEBUG] Eruda 起動完了');
        console.log('[DEBUG] 環境:', {
          vercelPreview: DEBUG.isVercelPreview,
          localhost: DEBUG.isLocalhost,
          production: DEBUG.isProduction,
          debugParam: DEBUG.hasDebugParam,
        });
        cb();
      }
    };
    s.onerror = function(){
      _loading = false;
      console.warn('[DEBUG] Eruda 読み込み失敗（オフライン or CDN問題）');
    };
    document.head.appendChild(s);
  }

  btn.addEventListener('click', function(){
    _loadEruda(function(){
      if(typeof eruda === 'undefined') return;
      if(_erudaVisible){
        try { eruda.hide(); } catch(_){}
        _erudaVisible = false;
      } else {
        try { eruda.show(); } catch(_){}
        _erudaVisible = true;
      }
    });
  });
})();

// 起動ログ（テスト環境のみ）
if(DEBUG.enabled){
  console.log('[DEBUG] テスト環境で起動中:', location.hostname + location.search);
}

// ===========================================
// OSRM endpoint 切替 (P0 Step 4・2026-05-12)
// ★設計変更宣言: hardcoded URL を全廃し、環境別 endpoint 定数で集中管理
//   - OSRM_ENDPOINT_PRODUCTION: 自前サーバー用 (Step 5 構築完了後にこの 1 行だけ書き換えれば全体切替可能)
//   - OSRM_ENDPOINT_DEV       : localhost / *.vercel.app 用 (現時点は同じ暫定値)
//   - OSRM_ENDPOINT           : location.hostname で自動選択 (この値を全箇所が参照)
// TODO: Step 5 サーバー構築後に OSRM_ENDPOINT_PRODUCTION を 1 行書き換えるだけで切替可能
// (例: 'https://osrm.daikome.example.com')
// ===========================================
const OSRM_ENDPOINT_PRODUCTION = 'https://router.project-osrm.org';   // 暫定値・Step 5 で書き換え
const OSRM_ENDPOINT_DEV        = 'https://router.project-osrm.org';   // localhost/vercel preview 用 (暫定)
const OSRM_ENDPOINT = (function(){
  const h = location.hostname;
  // localhost / 192.168.* / *.vercel.app は DEV 扱い
  const isDev = (h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.') || h.endsWith('.vercel.app'));
  return isDev ? OSRM_ENDPOINT_DEV : OSRM_ENDPOINT_PRODUCTION;
})();
window.OSRM_ENDPOINT = OSRM_ENDPOINT;   // 他 inline script からも参照可能

// ===========================================
// dlog: デバッグログヘルパー（2026/04/26追加）
// テスト環境でのみ出力・本番では完全に無効
// ===========================================
window.dlog = function(){
  if(!DEBUG.enabled) return;
  console.log.apply(console, arguments);
};
