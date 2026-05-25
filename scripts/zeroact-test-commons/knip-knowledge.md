# Knip 知識注入ドキュメント (2026-05-18 新規)

Knip は JSON 仕様 (`$schema` 制約) で設定にコメント不可のため、
ダイコメ固有知識を本ドキュメントで補完する。
**knip.json 編集時は必ず本ファイルを参照すること。**

---

## 絶対ルール (Knip dead code 判定で誤検出回避)

### `js/meter.js` の重要 export (= 絶対ルール「課金根拠」)

以下は外部から `Meter.xxx` 形式で呼出される ダイコメ核心 API。
Knip が「未使用 export」と誤判定しても**絶対に削除しない**:

| 関数 | 役割 | 呼出元 |
|---|---|---|
| `setDistance(m)` | 外部復元用 (= タスクキル復元) | js/business.js |
| `calcFare(m)` | 純粋関数・料金算出 | js/meter.js 内 / property test |
| `update(gpsResult)` | GPS chain の終端入口 | js/gps.js onUpdateCallback |
| `getState()` | state snapshot 取得 | tests/property/ / tests/e2e/ |
| `start()` / `reset()` / `businessEnd()` | 業務 flow 状態遷移 | index.html on*Btn ハンドラ |
| `setBusinessDistance(m)` | 業務単位距離 外部設定 | js/business.js タスクキル復元 |
| `setFareConfig(config)` | calcFare 設定注入 | js/business.js / tests/ |
| `setMapMatcher(worker)` | Worker B 接続 | index.html _setupMmWorker |
| `setLastGps(...)` | GPS 復元用 | js/business.js |

### `js/gps.js` の重要 export

| 関数 | 役割 |
|---|---|
| `GPS.start(callback)` / `GPS.stop()` | watchPosition 起動 / 停止 |
| `GPS.calcDistance` | Vincenty 直線距離 (★dangerous source) |
| `GPS.calcDistance3D` | 3D 直線距離 (★dangerous source・現状呼出ゼロ) |

### `js/map-matcher.js` (= Worker B)

Worker context で実行・通常の export 概念なし。
self.onmessage で msg.type を捌く設計。Knip は触らない。

---

## 重要変数 (= dead code 判定対象外)

| 変数 | 場所 | 役割 |
|---|---|---|
| `distance_m` | state.distance_m (= IIFE closure) | **課金根拠・絶対不可侵** |
| `business_distance_m` | state.business_distance_m | 業務単位累積距離 |
| `fare_yen` | state.fare_yen | 確定料金 (= calcFare 純粋値) |
| `tier2_pending_m` | state.tier2_pending_m | 表示用先行値 |

⚠️ これらは IIFE 内 state object のプロパティ・Knip の export 解析対象外だが
「meter.js の関数群を経由して読み書きされる」前提で Knip 動作する。

---

## Knip 設定の意図

### entry
`tests/replay-mm.js` / `tests/meter-mm-priority.js`:
  vitest test runner では拾わないが mm-regression.yml (CI) で実行される。
  entry 明示で「これらから到達可能なファイルは alive」と判定。

### project
`js/**/*.js` + `scripts/zeroact-test-commons/**/*.js`:
  ダイコメ核心コードと共通テスト基盤・解析対象。

### ignoreExportsUsedInFile
true 設定:
  同ファイル内で使われる export を未使用扱いしない (= IIFE 設計対応)。
  ダイコメは IIFE で global 公開する設計が多いため必須。

### ignoreDependencies
`@vitest/browser` / `@vitest/web-worker` / `msw` / `@lhci/cli`:
  test 基盤の peer 依存・直接 import せず置物 / CDN 経由で読込まれる。

### ignoreBinaries
`semgrep` (= Python・別 install) / `stryker` (= npx 経由実行・bin 検出不可)

---

## 注意点 (= 司さん指示と Knip 仕様の関係)

司さん指示「distance_m / business_distance_m / fare_yen を重要 export として
設定・dead code 判定から除外」について:

- これらは state object のプロパティで Knip の export 単位の概念に含まれない
- 代替として `ignoreExportsUsedInFile: true` + meter.js の public 関数群 (= 上記)
  を本ドキュメントで列挙して将来の dead code 削除提案時の判断材料化

knip warning に対応する際は必ず本ドキュメントを参照し、
**「Knip が未使用と言っているが本ドキュメント記載の関数」は絶対削除しない**。
