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
    // ★1本の 時間切れは 30秒★ 2026-10-31
    //   押す前の 門は 全部（4052本・試験の 時間の 和 1465秒）を 191秒で 回す＝混んで 子を 起こす 試験が 5.6〜5.7秒、
    //   kata の 門（単独 18ms）も 5.2〜5.4秒に なり 既定の 5秒で 毎回 別の 試験が 切れた（10-29〜31 で 5本・8回）。
    //   待ち（async）で 止まった 試験は 30秒で 赤。同期の 子（spawnSync）が 固まった 時は この 上限では 止まらない（5秒でも 同じ）。
    testTimeout: 30000,
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
