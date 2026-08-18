# ZEROact 共通テスト基盤

ZEROact 合同会社の全プロジェクト (= daikome / exally / imabari-ai / 新規) で
共有する自動検証基盤。コードを「読んで判断する」のではなく
「機械的に検証する」ことを目的とする。

---

## 🚀 3 ステップで新 PJ 立ち上げ

### Step 1: 本ディレクトリを新 PJ に取込む

```bash
# 新 PJ repo の root で実行 (= sparse-checkout 推奨)
git remote add commons https://github.com/exally-zeroact/Daikou-app-test.git
git fetch commons main
git read-tree --prefix=scripts/zeroact-test-commons -u commons/main:scripts/zeroact-test-commons

# または単純コピー (= 一回限り)
cp -r /path/to/Daikou-app-test/scripts/zeroact-test-commons scripts/
```

### Step 2: PJ 設定ファイルを作成

テンプレートをコピーして PJ 固有の値を編集:

```bash
# 雛形が既にある場合 (= exally / imabari-ai)
cp scripts/zeroact-test-commons/configs/zeroact.config.<project>.yml zeroact.config.<project>.yml

# 完全新規 PJ の場合
cp scripts/zeroact-test-commons/zeroact.config.template.yml zeroact.config.<project>.yml
```

編集する 7 セクション:
- `project.name` / `project.language` / `project.type`
- `critical_variables` (= 絶対不可侵な変数)
- `dangerous_sources` (= 危険な source 関数)
- `critical_paths` (= テスト対象重要ファイル)
- `external_io_boundaries` (= E2E mock すべき境界)
- `absolute_rules` (= PJ 固有絶対ルール)
- `test_thresholds` (= 各ツールの閾値)

### Step 3: init-project.js で自動 scaffold

```bash
# 1. dry-run (= preview のみ・default)
node scripts/zeroact-test-commons/init-project.js \
  --config zeroact.config.<project>.yml

# 2. 内容確認後・実適用
node scripts/zeroact-test-commons/init-project.js \
  --config zeroact.config.<project>.yml --apply
```

init-project.js が自動生成するもの:
- `.github/workflows/` (= `project.type` で workflow 選別)
- `scripts/zeroact-test-commons/semgrep-rules/<project>/` ディレクトリ
- `package.json` scripts 追加 (`audit:semgrep` / `test:property` 等)
- `TEST-FOUNDATION-README.md` (= PJ 固有絶対ルール記載)
- `.zeroact-init-rollback.json` (= 変更ファイル list)

完了後・PJ 固有 Semgrep rule / property test / E2E シナリオを
`semgrep-rules/<project>/` + `tests/property/` + `tests/e2e/` に追加。

---

## 📋 project.type と自動生成 workflow

`scripts/zeroact-test-commons/configs/project-types.js` で定義:

| project.type | 生成 workflow | 想定用途 |
|---|---|---|
| `pwa` | semgrep / property / e2e / knip / lighthouse / dep-cruiser / arch | PWA (= Service Worker + manifest)・ダイコメ |
| `nextjs` | semgrep / property / e2e / knip / lighthouse / dep-cruiser | Next.js App Router・今治AI |
| `vanilla-js` | semgrep / property / e2e / knip / dep-cruiser | Vanilla JS フラット構成・Exally |
| `nodejs` | semgrep / property / knip / dep-cruiser | Node.js library / CLI |

### 新 project.type 追加方法

`configs/project-types.js` に 1 行追加するだけ:

```js
module.exports = {
  // ... 既存 4 種
  mobile: {
    workflows: ['semgrep', 'property', 'knip', 'dep-cruiser'],
    description: 'React Native / Expo モバイル app',
  },
};
```

init-project.js 自体は無編集で対応可能 (= 拡張性確保)。

---

## 🛡️ init-project.js の安全機構

1. **dry-run default**: `--apply` なしは preview only (= 変更しない)
2. **既存ファイル無上書き**: 既存 file は skip (= `--force` で override)
3. **Daikou-app-test 自己実行検出**: `js/meter.js` + `init-project.js` 同居で即時 exit 2
4. **git tree dirty 警告**: clean state でない場合は警告 + exit 3 (= `--force` で続行)
5. **rollback list**: apply 時に `.zeroact-init-rollback.json` 生成

★ Daikou-app-test 自身で実行禁止 (= 既に setup 済・誤実行で workflows 破壊リスク)

---

## 📁 ディレクトリ構造

```
scripts/zeroact-test-commons/
├── README.md                              ← 本ファイル
├── zeroact.config.template.yml             ← 汎用テンプレート
├── glossary.yml                           ← 用語集 (人間/AI 用)
├── audit-message-handlers.js              ← postMessage 接続 audit (ダイコメ専用)
├── property-test-helpers.js               ← fast-check arbitrary 集
├── msw-handlers.js                        ← MSW v2 mock handlers
├── arch-rules.test.js                     ← ファイルレベル依存方向 lint
├── init-project.js                        ← ★新 PJ scaffold (= 本ドキュメント主役)
├── configs/
│   ├── project-types.js                   ← project.type 定義
│   ├── zeroact.config.exally.yml          ← Exally 雛形
│   └── zeroact.config.imabari-ai.yml      ← 今治AI 雛形
├── workflow-templates/
│   ├── semgrep.yml.tpl
│   ├── property.yml.tpl
│   ├── e2e.yml.tpl
│   ├── knip.yml.tpl
│   ├── lighthouse.yml.tpl
│   ├── dep-cruiser.yml.tpl
│   └── arch.yml.tpl
├── semgrep-rules/
│   ├── daikome/
│   │   └── distance-m-no-gps-line.yml
│   ├── exally/
│   │   └── cell-no-eval.yml
│   └── imabari-ai/
│       └── llm-response-schema-validate.yml
├── playwright-helpers/
│   ├── geolocation-mock.js
│   ├── platform-mock.js
│   └── gps-noise.js
├── observability/
│   ├── sentry-config.js
│   ├── ab-config.js
│   ├── openreplay-config.js
│   └── error-analyzer.js
├── ai/
│   ├── multi-llm-consensus.js
│   ├── llm-as-judge.js
│   └── ai-bug-hunter.js
├── scenarios/                              ← 業務シナリオ集 (= ダイコメ 8 件)
├── bug-patterns/                           ← 業界バグパターン集
├── known-issues/                           ← 過去事例レポジトリ
├── knip-knowledge.md                       ← Knip 設定補完
└── biome-knowledge.md                      ← Biome 設定補完
```

---

## 🔗 関連ファイルの役割分担

| ファイル | 役割 | 配置 |
|---|---|---|
| `zeroact.config.<project>.yml` | PJ 全体 config (= 機械可読・ツール用) | root or configs/ |
| `audit-handlers.config.js` | postMessage 接続 audit 専用 (= ダイコメ固有) | root |
| `glossary.yml` | 用語集 + 概念 + 業界用語 (= 人間/AI 用) | scripts/zeroact-test-commons/ |
| `init-project.js` | 新 PJ scaffold 自動化 | scripts/zeroact-test-commons/ |
| `*-knowledge.md` | Knip / Biome の仕様制約補完ドキュメント | scripts/zeroact-test-commons/ |

### `zeroact.config.<project>.yml` と `glossary.yml` の使い分け

- **`zeroact.config.*.yml`**: 機械可読・ツール (= Semgrep / Stryker / Lighthouse 等) が
  PJ 固有値を読込むための設定。critical_variables / dangerous_sources 配列。
- **`glossary.yml`**: 自然文記述・用語の意味 / 概念 / 業界知識を集約。
  人間 / AI レビュー (= CodeRabbit / PR-Agent) のコンテキスト。

両者の内容は overlap するが目的が違うため両方維持・整合性は運用同期。

### `audit-handlers.config.js` と `zeroact.config.daikome.yml` の使い分け

- **`audit-handlers.config.js`**: ダイコメ固有・Worker A / Worker B の postMessage channel 定義。
  `npm run audit:handlers` で send/receive 集合差分検証。他 PJ では使わない。
- **`zeroact.config.daikome.yml`**: ダイコメの全体 config (= 全ツール参照可能)。
  Worker channel 以外の critical_variables / absolute_rules 等を含む。

両者は別役割・併存。

---

## 🧰 含まれる検証ツール

| ツール | 用途 | 対応 config |
|---|---|---|
| Stryker.js | mutation testing | stryker.config.mjs |
| fast-check | property test | tests/property/ |
| Playwright | E2E | tests/e2e/ |
| Semgrep CE | taint analysis | semgrep-rules/`<project>`/ |
| Knip | unused export / dep | knip.json |
| dependency-cruiser | 依存方向 | dependency-cruiser.config.mjs |
| Biome | static lint | biome.json |
| Lighthouse CI | PWA / Perf / A11y / SEO | lighthouserc.js |
| MSW | API mock | msw-handlers.js |
| @vitest/web-worker | Worker mock | tests/worker/ |
| Sentry (config) | error tracking | observability/sentry-config.js |
| Firebase Remote Config | A/B 実験 | observability/ab-config.js |
| OpenReplay (config) | session replay | observability/openreplay-config.js |
| CodeRabbit | AI レビュー | .coderabbit.yml |
| ~~PR-Agent~~ | ★2026-08-18 削除★ 83回起動して全部 skipped・成功0回 | ― |
| multi-llm-consensus | AI 並列 PR review ★現在 配線なし★ | ai/multi-llm-consensus.js |
| llm-as-judge | テスト結果判定 | ai/llm-as-judge.js |
| ai-bug-hunter | 週次バグ探索 | ai/ai-bug-hunter.js |
| Dependabot | 依存更新 | .github/dependabot.yml |
| Secret Scanning | 秘密漏洩検出 | GitHub repo settings |

---

## 🔧 各 PJ 固有 absolute_rules 例

### daikome (= PWA + GPS + Worker)
- GPS 直線距離での課金禁止 (= 道路ジオメトリ準拠)
- distance_m への書込は 5 経路のみ (L551/L661/L1168/L1190/L1691)
- isStationary=true で distance_m 増加禁止
- iOS / Android 両 OS 経路確認

### exally (= Vanilla JS + HyperFormula)
- canvas-grid で eval / new Function / new RegExp(user_input) 禁止
- API key を client bundle に流入禁止
- HyperFormula instance 再 init 禁止
- ASCII 文字のみ使用 (= Cloudflare 汚染回避)

### imabari-ai (= TypeScript + Next.js・2027〜)
- LLM 応答は zod schema 検証必須
- PII を LLM input に渡す前に sanitize 必須
- API key を 'use client' 内で参照禁止
- user_session は server side で検証

---

## 📚 学習リソース

- 過去事例: `known-issues/` (= unicode-corruption / mass-deletion / 等)
- 業界バグパターン: `bug-patterns/` (= Uber/Lyft/Stripe 等の事例)
- ダイコメ業務シナリオ: `scenarios/` (= 通常走行 / 渋滞 / 山道 等 8 件)

---

## ⚠️ Daikou-app-test 自身での運用注意

本リポジトリ (Daikou-app-test) は ダイコメ専用 (= 既に setup 済)。

- ❌ init-project.js を本 repo で実行しない (= 安全機構で exit 2)
- ❌ `zeroact.config.daikome.yml` を再 generate しない
- ✅ ダイコメ修正は通常通り個別 commit で進める
- ✅ scripts/zeroact-test-commons/ の改修は 全 PJ に影響するため慎重に

---

## 🔄 既存ドキュメント (= 旧版・参考)

旧 README の Step 1/2/3 手順は本ファイルに統合済。
audit-handlers.config.js / property-test-helpers.js 等の個別仕様は
各ファイル冒頭コメントを参照してください。
