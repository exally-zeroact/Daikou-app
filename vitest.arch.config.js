// vitest.arch.config.js (2026-05-18 新規・ArchUnitTS 配線用)
// 目的: scripts/zeroact-test-commons/arch-rules.test.js を vitest で実行するための
//       単独 config (= 既存 vitest.config.js は include: tests/**/*.test.js のため
//       scripts/ 配下を hit しない・既存 config 無変更原則のため別 config で対応)。

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['scripts/zeroact-test-commons/arch-rules.test.js'],
  },
});
