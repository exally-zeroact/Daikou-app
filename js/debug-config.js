// ===========================================
// debug-config.js
// 環境変数によるデバッグ機能制御（2026/04/26追加）
// ★本番ドメイン移行時に自動的に無効化される
// ★リリース時の削除作業ゼロ化
// ===========================================
/* eslint-disable no-console -- ★設計変更宣言 (2026-05-15・lint Phase 6):
   本ファイルは dlog 実装本体 (window.dlog) と DEBUG-mode 専用の Eruda 初期化ログを
   含むため、console.* の使用が意図的 (= Class C)。
   dlog で置換すると無限再帰 (dlog → console → dlog → ...) になる箇所もあり file-level
   opt-out が唯一妥当な解決。 */
const DEBUG = (() => {
  const hostname = location.hostname;
  const search = location.search;

  // 本番ドメイン allowlist（ここに載った hostname だけが prod 扱い）
  // 本番Vercel URL（daikou-app.vercel.app）も独自ドメイン移行後の独自ドメインも、ここに追記すれば prod になる
  const PRODUCTION_HOSTS = new Set(['daikou-app.vercel.app']);

  // 環境判定
  const isProductionHost = PRODUCTION_HOSTS.has(hostname);
  // vercel.app サブドメインのうち、prod 以外（test 本URL / branch preview など）を preview 扱い
  const isVercelPreview = hostname.endsWith('.vercel.app') && !isProductionHost;
  const isLocalhost =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.');
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
(function initErudaToggle() {
  if (!DEBUG.showEruda) return;
  let _erudaLoaded = false;
  let _erudaVisible = false;
  let _loading = false;

  const btn = document.createElement('button');
  btn.id = 'erudaToggleBtn';
  btn.type = 'button';
  btn.textContent = '⚙️';
  btn.setAttribute('aria-label', 'Toggle Eruda console');
  btn.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:9001;' +
    'width:44px;height:44px;border-radius:50%;border:none;' +
    'background:rgba(0,0,0,0.72);color:#fff;font-size:22px;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;' +
    'display:flex;align-items:center;justify-content:center;' +
    'padding:0;line-height:1;-webkit-tap-highlight-color:transparent;';

  function _attach() {
    if (document.body) {
      document.body.appendChild(btn);
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.appendChild(btn);
      });
    }
  }
  _attach();

  // ★設計変更宣言 (2026-05-13): 🐛 → ⚙️ 切替 + drag 移動対応
  //   旧: 画面左下固定 (left:8px / bottom:8px) のみ
  //   新: pointerdown/move/up で自由移動・閾値 5px で click(=Eruda toggle) と drag を分離
  //       drag 後の位置を localStorage 'daikome_eruda_btn_pos' に保存・次回起動時に復元
  //       click 経路は既存ハンドラ (Eruda lazy load + toggle) を完全に維持 (capture 段で gate)
  //       iOS Safari + Android Chrome 両対応 (touch-action:none で native gesture 干渉抑止)
  btn.style.touchAction = 'none';
  try {
    const _saved = JSON.parse(localStorage.getItem('daikome_eruda_btn_pos') || 'null');
    if (_saved && typeof _saved.left === 'number' && typeof _saved.top === 'number') {
      const _maxL = window.innerWidth - 52;
      const _maxT = window.innerHeight - 52;
      btn.style.bottom = '';
      btn.style.left = Math.max(8, Math.min(_maxL, _saved.left)) + 'px';
      btn.style.top = Math.max(8, Math.min(_maxT, _saved.top)) + 'px';
    }
  } catch (_) {}

  const DRAG_THRESHOLD = 5;
  let _startX = 0,
    _startY = 0,
    _origLeft = 0,
    _origTop = 0;
  let _dragging = false,
    _moved = 0,
    _hasDragged = false;

  btn.addEventListener('pointerdown', function (ev) {
    _startX = ev.clientX;
    _startY = ev.clientY;
    _dragging = true;
    _moved = 0;
    _hasDragged = false;
    try {
      btn.setPointerCapture(ev.pointerId);
    } catch (_) {}
  });

  btn.addEventListener('pointermove', function (ev) {
    if (!_dragging) return;
    const dx = ev.clientX - _startX;
    const dy = ev.clientY - _startY;
    const dist = Math.hypot(dx, dy);
    if (dist > _moved) _moved = dist;
    if (_moved < DRAG_THRESHOLD) return;
    if (!_hasDragged) {
      // 閾値超え初回: 現在の視覚位置を top-anchored に変換 (bottom:8px → top:Ypx)
      const r = btn.getBoundingClientRect();
      btn.style.bottom = '';
      _origLeft = r.left;
      _origTop = r.top;
      _hasDragged = true;
    }
    ev.preventDefault();
    const maxL = window.innerWidth - 52;
    const maxT = window.innerHeight - 52;
    const newL = Math.max(8, Math.min(maxL, _origLeft + dx));
    const newT = Math.max(8, Math.min(maxT, _origTop + dy));
    btn.style.left = newL + 'px';
    btn.style.top = newT + 'px';
  });

  btn.addEventListener('pointerup', function (ev) {
    if (!_dragging) return;
    _dragging = false;
    try {
      btn.releasePointerCapture(ev.pointerId);
    } catch (_) {}
    if (_hasDragged) {
      ev.preventDefault();
      try {
        const r = btn.getBoundingClientRect();
        localStorage.setItem('daikome_eruda_btn_pos', JSON.stringify({ left: r.left, top: r.top }));
      } catch (_) {}
    }
  });

  btn.addEventListener('pointercancel', function () {
    _dragging = false;
  });

  // capture phase で click を gate (drag 直後の synthetic click を遮断)
  btn.addEventListener(
    'click',
    function (ev) {
      if (_hasDragged) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        _hasDragged = false;
      }
    },
    true
  );

  // resize 時に top-anchored ボタンを画面内に clamp
  window.addEventListener('resize', function () {
    if (!btn.style.top) return; // まだ bottom-anchored = ブラウザ任せでOK
    const r = btn.getBoundingClientRect();
    const maxL = window.innerWidth - 52;
    const maxT = window.innerHeight - 52;
    btn.style.left = Math.max(8, Math.min(maxL, r.left)) + 'px';
    btn.style.top = Math.max(8, Math.min(maxT, r.top)) + 'px';
  });

  function _loadEruda(cb) {
    if (_erudaLoaded) {
      cb();
      return;
    }
    if (_loading) return; // 連打防止 (load 完了前)
    _loading = true;
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/eruda';
    s.onload = function () {
      _loading = false;
      if (typeof eruda !== 'undefined') {
        try {
          eruda.init();
        } catch (e) {
          console.warn('[DEBUG] eruda.init error:', e && e.message);
        }
        // Eruda 標準の entry button は隠す (本 🐛 ボタンが代替)
        try {
          const entry = document.querySelector('.eruda-entry-btn');
          if (entry) entry.style.display = 'none';
        } catch (_) {}
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
    s.onerror = function () {
      _loading = false;
      console.warn('[DEBUG] Eruda 読み込み失敗（オフライン or CDN問題）');
    };
    document.head.appendChild(s);
  }

  btn.addEventListener('click', function () {
    _loadEruda(function () {
      if (typeof eruda === 'undefined') return;
      if (_erudaVisible) {
        try {
          eruda.hide();
        } catch (_) {}
        _erudaVisible = false;
      } else {
        try {
          eruda.show();
        } catch (_) {}
        _erudaVisible = true;
      }
    });
  });
})();

// 起動ログ（テスト環境のみ）
if (DEBUG.enabled) {
  console.log('[DEBUG] テスト環境で起動中:', location.hostname + location.search);
}

// ===========================================
// dlog: デバッグログヘルパー（2026/04/26追加）
// テスト環境でのみ出力・本番では完全に無効
// ===========================================
window.dlog = function () {
  if (!DEBUG.enabled) return;
  console.log.apply(console, arguments);
};
