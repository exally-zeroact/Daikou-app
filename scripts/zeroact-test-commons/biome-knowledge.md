# Biome 知識注入ドキュメント (2026-05-18 新規)

Biome は JSON 仕様 (`$schema` 制約) で設定にコメント不可、
かつ custom lint rule の自作機能を持たない。
ダイコメ固有知識を本ドキュメントで補完する。
**biome.json 編集時は必ず本ファイルを参照すること。**

---

## 絶対ルール (Biome では機械検出不可・人間レビューで遵守)

### `state.distance_m` / `state.fare_yen` への直接代入

絶対ルール: distance_m は課金根拠・更新元は 5 経路のみ
  L393 / L462 / L824 / L842 / L1172 (meter.js verified)

Biome は組込み rule のみで「特定変数への代入」を検出する custom rule を
自作できない (= Semgrep / fast-check property test で代替済)。

**Biome では機械検出しないが、人間 / CodeRabbit / PR-Agent レビューで
遵守を確認する**:
  ・新規 `state.distance_m += X` / `state.distance_m = X` の発見時は
    必ず ★絶対ルール適用外区間 sanitizer マーカーの有無を確認
  ・関連ルール: scripts/zeroact-test-commons/semgrep-rules/daikome/distance-m-no-gps-line.yml

### `console.error` を `dlog` に置換禁止

絶対ルール: console.error は本番出力前提・dlog 置換禁止

ESLint で実装済:
  `.eslintrc.json` rules `"no-console": ["error", { "allow": ["error"] }]`

Biome では `suspicious.noConsole: "off"` で console 全許可とし、
ESLint と二重 lint で確実に検出。
  ・Biome は format 系のみ・lint 系は ESLint 優先
  ・Biome での noConsole は false-positive 多発のため off 維持

---

## Biome globals の設計意図

`javascript.globals` は `.eslintrc.json` の globals と完全一致を維持:

| global | 由来 |
|---|---|
| `dlog` | js/debug-config.js global expose |
| `DEBUG` | js/debug-config.js global |
| `Meter` | js/meter.js IIFE expose |
| `GPS` | js/gps.js IIFE expose |
| `FB` | js/firebase-config.js IIFE expose |
| `RegionLoader` | 廃止済 (2d3eae9a) ・互換のため残置 |
| `TrainingCollector` | js/training-collector.js IIFE expose |
| `firebase` | Firebase SDK CDN global |
| `eruda` | Mobile console (DEBUG only) |
| `Buffer` | Node CommonJS environment 用 |
| `fc`, `describe`, `it`, `expect`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll` | vitest / fast-check |

`.eslintrc.json` の globals を変更する際は **必ず biome.json も同期更新**。

---

## Biome 対象範囲 (files.includes) の意図

```
scripts/zeroact-test-commons/**/*.js
tests/property/**/*.js
tests/e2e/**/*.js
```

意図:
  ・新規追加コード (= テスト基盤・property test・e2e spec) は Biome lint 対象
  ・既存 js/* は対象外 (= 既存 lint errors 217 件と独立管理)
  ・index.html / sw.js / data/** は対象外 (= IIFE / 巨大 file / 生成物)

将来 既存 js/* の段階解消後に js/**/*.js を `files.includes` に追加する想定。

---

## 既存 disable rules の意図

| rule | 設定 | 理由 |
|---|---|---|
| `assist.enabled` | false | import 順序 lint OFF (= 既存 Prettier に委譲) |
| `suspicious.noConsole` | off | dlog 連携 + 本番 console.error 規定 |
| `suspicious.noExplicitAny` | off | TS-only rule・JS-only PJ では無効 |
| `suspicious.noAssignInExpressions` | off | `while ((m = re.exec()) !== null)` 許容 |
| `style.useNodejsImportProtocol` | off | Node script で `fs` import を `node:fs` 強制しない |
| `style.useTemplate` | off | 既存コードスタイル維持 |
| `complexity.useArrowFunction` | off | function 宣言維持 |
| `formatter.enabled` | false | 既存 Prettier に format 委譲 |

これらは「ダイコメ既存設計を維持しつつ Biome の機能的 lint を活用」
する設計判断。新規 rule 追加時は本ドキュメントに理由を併記する運用。

---

## 注意点 (= 司さん指示の Biome 仕様制約)

司さん指示「distance_m / fare_yen への直接代入を警告するカスタムルール追加」:
  ・Biome は組込み rule のみ・custom rule 自作機能なし (= 2026-05-18 時点)
  ・代替: Semgrep custom rule (= taint analysis) + property test の 5 経路 verify で
    機械的に検出済 (= scripts/zeroact-test-commons/semgrep-rules/daikome/)

司さん指示「console.error → dlog への置換禁止ルール追加」:
  ・既存 ESLint config `"no-console": ["error", { "allow": ["error"] }]` で実装済
  ・Biome は組込み console rule が緩い (= dlog 置換を機械検出不可)
  ・代替: ESLint で実装維持 + Biome では noConsole: off
