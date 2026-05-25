/* eslint-env node */
// Stryker.js config (2026-05-17 新規・Stage 1・解釈A)
// 目的: property test の網羅性 KPI 測定
// 方針:
//   ・testRunner = vitest (tests/property/ のみ走らせる)
//   ・mutate 対象 = tests/lib/distance.js + tests/lib/snap.js (test util のみ)
//   ・絶対ルール準拠: meter.js / gps.js 等の本体コードは mutate しない
//                    (= 課金根拠 distance_m コードには絶対に触れない)
// 司さん判断: property test が test util の mutation を catch するかで網羅性を測る。
//
// ★設計変更宣言 (2026-05-18・heap OOM 対策):
//   旧: ignorePatterns 未指定 → ProjectReader が data/ 配下 16,682 ファイル
//       + 全 47 県 roads 等を scan して JS heap 4GB を超過 (OOM)
//   新: ignorePatterns で data/ + 大量データ dir を除外
//       + testRunnerNodeArgs で test runner sub-process の heap を 8GB に拡張
//   絶対ルール準拠: mutate 範囲 (tests/lib/) は無変更・課金ロジック影響なし

export default {
  testRunner: 'vitest',
  vitest: {
    // ★設計変更宣言 (2026-05-21・Phase 1): Stryker 専用 vitest 設定に切替
    //   理由: stryker sandbox は data/ を除外するため・tests/replay-mm-worker/* (= ehime data load)
    //         を sandbox で実行不可。vitest.stryker.config.js で本 test 系を exclude する。
    //   既存 vitest.config.js は無変更維持 (= 通常 test 実行は本 change の影響なし)。
    configFile: 'vitest.stryker.config.js',
    // CommonJS require() 経由で property-test-helpers.js を import しているため
    // Vitest related 探索が機能せず No tests were found エラー。全 test 走らせる設定で対応。
    related: false,
  },
  // ─── ダイコメ知識注入 (2026-05-18) ───────────────────────────────
  //
  // 【絶対ルール】distance_m は課金根拠・絶対不可侵
  //   GPS 直線距離での課金禁止・道路ジオメトリ沿いのみ
  //
  // 【distance_m 更新 5 経路 (verified meter.js)】
  //   L393:  Tier1 Worker B Viterbi commit (state.distance_m += m.mmIncrementM)
  //   L462:  retroactive Off-Road 起動時 (= ★絶対ルール適用外区間)
  //   L824:  gap fill GPS 消失時 (= speed × time・GPS 直線非依存)
  //   L842:  Phase 1.C Off-Road incremental (= ★絶対ルール適用外区間)
  //   L1172: setDistance 外部復元用
  //
  // 【重要変数】
  //   distance_m: 課金根拠 (絶対不可侵)
  //   business_distance_m: 業務単位累積距離 (running=true のみ加算)
  //   fare_yen: 確定料金 (= calcFare(distance_m) 純粋関数)
  //
  // 【mutate 対象方針】
  //   meter.js / gps.js / map-matcher.js / gps-worker.js / mm-data-pipeline.js は
  //   絶対 mutate 不可 (= 課金根拠 distance_m コードに変更を加える行為に該当)。
  //   司さん解釈 A 採択 (Stage 1): mutate target は test util のみで
  //   property test の網羅性 KPI を測定する。
  //
  // 本体コード (= meter.js 等) の mutation testing は将来 課金根拠の
  // 別レイヤー (= Semgrep taint rule / property test 増強) で代替する。
  //
  // ★設計変更宣言 (2026-05-18・Tier 別 Stryker 戦略 / Hybrid 6・9.26%→80% 改善):
  //   旧: property-test-helpers.js + helpers/ のみ (= 9.26%)
  //   新: 業務 critical 度で 4 Tier に分類・層別目標で加重平均 80% 達成。
  //
  //   Tier 1 業務 critical (= 100% 目標): business.js (calcFare 連動 / getReport / state)
  //   Tier 2 helpers (= 70% 目標): property-test-helpers.js + 共通 helpers
  //   Tier 3 pure logic (= 50% 目標): region-helper.js / data-registry.js / firebase-config.js
  //   Tier 4 除外: meter.js / gps.js / map-matcher.js / firebase.js / gps-worker.js /
  //               mm-data-pipeline.js (= 副作用大・触らない absolute・mutation 検出困難)
  //
  //   絶対ルール準拠:
  //     ・distance_m 加算経路 (L398/L464/L840/L858/L1197) は Tier 4 除外で touch なし
  //     ・sanitizer マーカー (L298 / L460) は同上
  //     ・「js/meter.js 触らない absolute」 = file 本体無変更・Stryker mutate は CI 一時処理
  //     ・テストファイル本体 (*.test.js) は mutate 対象外 (= 無限ループ防止)
  // ★ Hybrid 6 Tier 別戦略の試行結果 (2026-05-18):
  //   js/business.js / js/firebase-config.js を mutate に追加 → dry-run 常時 fail。
  //   原因: Stryker sandbox の IIFE / __dirname 経由 require 解決問題 (= ローカル vitest PASS)。
  //   結論: 9.26% (= 元状態) に維持・80% は Stryker 環境問題解消後の別タスク。
  //   業務 critical 防御は他ツール (= 32 件 test / Semgrep / property test) で多層担保済。
  // ★設計変更宣言 Phase 6-7 (2026-05-21・in-place mutation・司さん P1 採択):
  //   旧 (= Stage 1 / Hybrid 6 路線): test util + helpers のみ mutate (= 9.26%)
  //   新: core 3 ファイル (= meter.js / map-matcher.js / gps-worker.js) を mutate に追加。
  //
  //   絶対前提 (= 不可侵):
  //     ・prod 本体 (js/*.js) は 1 byte も触らない (= 抽出 / 改変一切なし)
  //     ・Stryker sandbox 内の一時 copy だけが mutate される (= main の meter.js 等は無変更)
  //     ・distance_m 加算 5 経路は mutate 対象として "テストで kill できるか" を測定する
  //       (= 旧 Stage 1 の「触らない absolute」回避策は in-place 方式で不要・経路自体は不変)
  //
  //   実行方針 (= 2 Pass):
  //     Pass A: `npx stryker run --mutate js/meter.js --coverageAnalysis perTest`
  //             (meter.js は Node 直 require 可能・V8 coverage 計測可・perTest で高速)
  //     Pass B: `npx stryker run --mutate js/map-matcher.js,js/gps-worker.js --coverageAnalysis off`
  //             (vm.runInContext load ゆえ V8 coverage 不可・'off' で全 test 実行)
  //     ★ dry-run 失敗時 (= IIFE / __dirname 解決問題) は本ファイルで coverageAnalysis 降格可能
  mutate: [
    // ★ Phase 6-7 新規: core in-place mutation 対象
    'js/meter.js', // Pass A 主対象 (= IIFE + module.exports・Node require 可)
    'js/map-matcher.js', // Pass B 主対象 (= Worker / importScripts・vm.runInContext load)
    'js/gps-worker.js', // Pass B 主対象 (= Worker / self.onmessage・vm.runInContext load)
    // 既存 (= Stage 1 / Hybrid 6 から維持)
    'scripts/zeroact-test-commons/property-test-helpers.js',
    'tests/integration/helpers/**/*.js',
    'tests/property/helpers/**/*.js',
  ],
  // Stryker の project file scan から除外 (= heap OOM 対策)
  ignorePatterns: [
    'data/**',
    // ★ Phase 6-7: replay-mm-worker が ehime data を vm.runInContext で読むため・1 件のみ allow
    //   全 786 file / 16K+ から roads-ehime.js (= 4.4 MB) 単独 include で OOM 回避維持
    //   minimatch: data/** で全除外 → '!data/roads-ehime.js' で当該 1 件のみ復帰
    '!data/roads-ehime.js',
    'node_modules/**',
    'coverage/**',
    '.tmp/**',
    'tmp/**',
    'outputs/**',
    'download/**',
    'input/**',
    'test-results/**',
    '.stryker-tmp/**',
    'reports/**',
    '.git/**',
  ],
  // test runner sub-process の Node heap を 8GB に拡張
  testRunnerNodeArgs: ['--max-old-space-size=8192'],
  // ★ Phase 6-7: hang 対策
  //   timeoutMS: vm.runInContext で無限ループ mutation を仕掛けられた場合の上限 (30 秒)
  //   concurrency: stryker 9.6 schema は string %形式のみ受付・defaults に任せる
  //                (= Pass A 実測で 8-core 機・default 並列で安定動作確認済)
  timeoutMS: 30000,
  reporters: ['progress', 'clear-text', 'html'],
  thresholds: { high: 80, low: 60, break: null },
  coverageAnalysis: 'perTest', // Pass A default。Pass B の 'off' 試行は・stryker-vitest plugin が
  //   設定を ignore する仕様判明 (= 結果同一・「真の初期 score」レポート参照)
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
};
