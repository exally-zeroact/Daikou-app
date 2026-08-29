import { defineConfig } from 'vitest/config';
// ★赤の中身を 残す記録係★ 2026-08-29
//   ★CLI の --reporter=./path では 読み込まれませんでした（vitest 4.1.6・実測）★
//   ⇒ ここで 登録します。package.json の test から --reporter を 外しました。
import FailureRecorder from './tests/tools/failure-recorder.js';

export default defineConfig({
  test: {
    // ★出す物は 前と 同じ★（default の画面 ＋ json の file）＋ 記録係
    reporters: [
      'default',
      ['json', { outputFile: 'data/test-results/last-run.json' }],
      new FailureRecorder(),
    ],
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['js/**/*.js'],
      exclude: ['js/firebase.js', 'data/**'],
    },
  },
});
