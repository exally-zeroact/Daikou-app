// tests/integration/history-cross-midnight-sort.test.js
//
// ★2026-07-04 履歴の2件修正 (司さん指示)★:
//   1. 日跨ぎ業務を割らない: 履歴の日付キーを「精算時刻」でなく「業務(セッション)開始日」で統一
//      (旧: now.toDateString()→深夜0時跨ぎで同一業務が前日/当日に割れた)。業務開始= Business.getState().start_time。
//   2. 並び順: 各日内で最近の乗車を1番上に(逆順描画・回目は保存順で時系列維持)。
//   ※source assertion(index.htmlのDOM/localStorage実挙動は実機)。

'use strict';

const fs = require('fs');
const path = require('path');

let html;
beforeAll(() => {
  html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
});

describe('履歴: 日跨ぎ業務を割らない + 最近が上 (2026-07-04)', () => {
  it('★ 履歴キーは業務開始日(Business.getState().start_time)で統一・未取得はnow fallback', () => {
    // _bizStartTs = Business.getState().start_time を取り、histKey の日付に使う
    expect(html).toMatch(/Business\.getState\(\)\.start_time/);
    expect(html).toMatch(
      /const\s+histKey\s*=\s*'daikou_history_'\s*\+\s*_keyDate\.toDateString\(\)/
    );
    // 旧「now.toDateString() でキー化」が histKey に残っていないこと
    expect(html).not.toMatch(/histKey\s*=\s*'daikou_history_'\s*\+\s*now\.toDateString\(\)/);
  });

  it('★ _hist_render は各日の乗車を逆順(新しいのが上)で描画', () => {
    // for (let j = bucket.rides.length - 1; j >= 0; j--) で逆順
    expect(html).toMatch(
      /for\s*\(\s*let\s+j\s*=\s*bucket\.rides\.length\s*-\s*1;\s*j\s*>=\s*0;\s*j--\s*\)/
    );
  });

  it('★ 日付セクションは新しい日が上(既存・buckets降順ソート維持)', () => {
    expect(html).toMatch(/buckets\.sort\(function\s*\(a,\s*b\)\s*\{[\s\S]*?return b\.t\s*-\s*a\.t/);
  });
});
