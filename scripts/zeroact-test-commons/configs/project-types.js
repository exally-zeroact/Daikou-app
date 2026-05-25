/* eslint-env node */

// ============================================================
// configs/project-types.js (2026-05-18 新規・横展開基盤 ⑦)
//
// 目的: init-project.js が「project.type に応じて生成する workflow」を選別するための
//       PROJECT_TYPES 定義。
//
// ★設計判断 (= 司さん指示の効率化):
//   旧案: init-project.js 内に const PROJECT_TYPES = { ... } と直書き
//   新案: 外部 JS module.exports に分離
//   → 新 type 追加時に init-project.js を編集せず本ファイル 1 行追加で完結。
//   yml ではなく js を採用した理由: yml parser を init-project.js に持たせない
//   (= devDep 追加せず実装シンプル化・既存 require() で読込可能)。
//
// 新 PROJECT_TYPE 追加例 (= mobile / cli / library 等):
//   '<type-name>': {
//     workflows: ['semgrep', 'property', ...],
//     description: '<short summary>',
//   }
// ============================================================

module.exports = {
  pwa: {
    workflows: ['semgrep', 'property', 'e2e', 'knip', 'lighthouse', 'dep-cruiser', 'arch'],
    description: 'PWA (= Progressive Web App・Service Worker + manifest)',
    // ダイコメ等の PWA 系。lighthouse PWA audit + arch rules が必須。
  },
  nextjs: {
    workflows: ['semgrep', 'property', 'e2e', 'knip', 'lighthouse', 'dep-cruiser'],
    description: 'Next.js (App Router or Pages Router・Vercel デプロイ前提)',
    // 今治AI 等の Next.js 系。SSR/SSG ありで PWA arch rule は不要 (= Vercel が抽象化)。
  },
  'vanilla-js': {
    workflows: ['semgrep', 'property', 'e2e', 'knip', 'dep-cruiser'],
    description: 'Vanilla JS (= no framework・直接 HTML <script src> 構成)',
    // Exally 等の Vanilla JS フラット構成。Lighthouse は任意 (= 内部 SaaS なら不要)。
  },
  nodejs: {
    workflows: ['semgrep', 'property', 'knip', 'dep-cruiser'],
    description: 'Node.js library / CLI tool',
    // e2e (Playwright) 不要・ブラウザ依存なし。
  },
  // ─── 新 type 追加 example (= 司さん拡張用) ──────────────────────────
  // mobile: {
  //   workflows: ['semgrep', 'property', 'knip', 'dep-cruiser'],
  //   description: 'React Native / Expo モバイル app',
  // },
  // cli: {
  //   workflows: ['semgrep', 'property', 'knip', 'dep-cruiser'],
  //   description: 'CLI tool (= Node.js + 引数解析)',
  // },
  // library: {
  //   workflows: ['semgrep', 'property', 'knip', 'dep-cruiser'],
  //   description: 'OSS library (= 公開 npm package)',
  // },
};
