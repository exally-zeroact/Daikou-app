// vitest.stryker.config.js (Phase 1 基盤・2026-05-21・新規)
// ★設計変更宣言 Phase 1 (2026-05-21): Stryker 専用 vitest 設定
//   理由: Stryker sandbox は ignorePatterns で data/ を除外する (= heap OOM 対策・stryker.config.mjs L78)。
//         そのため・新規 tests/replay-mm-worker/* は・ehime data を load しようとして
//         sandbox 内で ENOENT で fail する。
//   対応: stryker run 時のみ・tests/replay-mm-worker/ を vitest exclude に追加して skip する。
//         通常 test 実行 (= vitest.config.js 経由) では既存通り含めて実行する (= 既存挙動不変)。
//
//   絶対ルール準拠:
//     ・既存 vitest.config.js は無変更 (= 通常 test 実行は影響なし)
//     ・stryker.config.mjs の vitest.configFile を本 file 指定に切替で配線

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    exclude: [
      'tests/e2e/**',
      'node_modules/**',
      // ★ Phase 6-7 (2026-05-21・in-place mutation・司さん P1):
      //   旧: tests/replay-mm-worker/** を exclude (= sandbox から data/ 除外で ehime data load 不可)
      //   新: stryker.config.mjs ignorePatterns に `!data/roads-ehime.js` を allow したため
      //       sandbox 内でも ehime data load 可能・本テスト群を include する。
      //       map-matcher.js / gps-worker.js mutation を catch する経路として必須。
      //
      // ★ Phase 6-7 (M) 分離 (2026-05-21):
      //   tests/drift-static/** は・行アンカー ±10 の静的 grep 専用 group。
      //   Stryker instrumentation 後 sandbox copy の行シフトで false-fail するため・
      //   stryker run では本 group を除外する (= 通常 vitest run は include で厳格度完全保持)。
      //   通常 vitest.config.js は本 dir を include する (= 既存 'tests/**/*.test.js' で自動)。
      'tests/drift-static/**',
      // ★Phase2-a (2026-05-27): address-*-build テストは data/addresses-{chiban,rsdt,street}-ehime.js
      //   (各 171MB 級・gitignore + stryker ignorePatterns data/** で sandbox 除外) を load する。
      //   sandbox にデータが無く + 巨大 load で sandbox worker が OOM → dry-run 失敗 (他テストへ cascade)。
      //   これらは scripts/build-address.js の検証で・stryker mutate 対象 (js/meter.js / map-matcher.js /
      //   gps-worker.js) を 1 つも通らない (= mutation coverage 寄与ゼロ)。drift-static 除外と同じ
      //   「sandbox 非互換」理由で stryker run のみ除外。通常 vitest.config.js では include で実行・検証完全保持。
      'tests/integration/address-*-build.test.js',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['js/**/*.js'],
      exclude: ['js/firebase.js', 'data/**'],
    },
  },
});
