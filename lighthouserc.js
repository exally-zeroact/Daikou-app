/* eslint-env node */
// Lighthouse CI config (2026-05-17 新規・Stage 1)
// 目的: PWA / Performance / Accessibility / SEO のスコア閾値ガード
// 起動: ローカル http-server で localhost:3000 にアプリを起動 → Lighthouse 実行
// 既存 playwright webServer と同じ起動方式 (= http-server -p 3000)

module.exports = {
  ci: {
    collect: {
      url: ['http://localhost:3000/'],
      startServerCommand: 'npx http-server -p 3000 -c-1 -s',
      startServerReadyPattern: 'Available on',
      startServerReadyTimeout: 30000,
      numberOfRuns: 1,
      settings: {
        preset: 'desktop',
        chromeFlags: '--no-sandbox --disable-dev-shm-usage',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.7 }],
        'categories:accessibility': ['warn', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.8 }],
        'categories:seo': ['warn', { minScore: 0.9 }],
        // ─── ダイコメ知識注入 (2026-05-18・PWA 必須項目) ─────────────
        // ダイコメは「全 47 県 cache + offline 業務継続」が絶対ルール。
        // Service Worker + manifest 等の PWA 個別 audit を必須検査に追加。
        // Lighthouse v10+ で categories:pwa は廃止・個別 audit でカバー。
        'installable-manifest': ['warn', { minScore: 0.9 }],
        'service-worker': ['warn', { minScore: 0.9 }],
        'apple-touch-icon': ['warn', { minScore: 0.9 }],
        viewport: ['warn', { minScore: 0.9 }],
        'splash-screen': ['warn', { minScore: 0.5 }],
        'themed-omnibox': ['warn', { minScore: 0.5 }],
        'maskable-icon': ['warn', { minScore: 0.5 }],
        // オフライン業務継続性 (= sw.js PRECACHE 47 県 cache の機能担保)
        'works-offline': 'off',
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
