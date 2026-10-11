'use strict';
// ============================================================
// ★「段階を 使う」を 外したら 段階で 計算しない★ 2026-10-11（司さん「外したら外すやろが」）
//   前は メーター（js/fare-calc.js の keisan）が 印を 見ずに 段階で 計算していた
//   （設定画面の 見本は 印を 見ていた＝見本と メーターが 食い違っていた）。
//   ★印の 無い 古い 料金表は 段階が 在れば 使う★＝お金を 変えない（設定画面の ateru と 同じ 考え）。
//   10-11 に 本番・テスト線の 倉庫と 変更の 履歴を 読んで、段階を 使った 会社は 0（今も 履歴も）。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const FC = require(path.join(ROOT, 'js', 'fare-calc.js'));
const S = require(path.join(ROOT, 'js', 'fare-config-store.js'));
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const KIHON = {
  base_fare: 1300,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: 420,
  rounding: 1,
  tiers: [{ from_m: 1000, to_m: null, add_fare: 500, add_distance_m: 100 }],
};
const DANKAI = 1300 + 6 * 500; // 500m を 100m ごと（最初の 1歩 込み）
const SEN = 1300 + 2 * 100; // 500m を 420m ごと

describe('★「段階を 使う」を 外したら 外す（10-11 司さん）★', () => {
  it('印が 真なら 段階・偽なら 段階 無し', () => {
    expect(FC.keisan(1500, { ...KIHON, tiersEnabled: true })).toBe(DANKAI);
    expect(FC.keisan(1500, { ...KIHON, tiersEnabled: false })).toBe(SEN);
  });

  it('印の 無い 古い 料金表は 段階が 在れば 使う（倉庫から 来た 物も 整えた 後も）', () => {
    const { tiersEnabled, ...nashi } = KIHON; // eslint-disable-line no-unused-vars
    expect(FC.keisan(1500, nashi)).toBe(DANKAI);
    expect(S.totonoeru(nashi).tiersEnabled).toBe(true);
    // 整えた 料金表は 自動の 割増の 欄を 持つ＝時刻を 渡す（平日の 昼・割増 無し）
    const hiru = new Date('2026-06-01T03:00:00Z');
    expect(FC.keisan(1500, S.totonoeru(nashi), null, [], 0, hiru)).toBe(DANKAI);
    expect(S.totonoeru({ ...KIHON, tiers: [] }).tiersEnabled).toBe(false);
  });

  it('印が 偽の 料金表は 整えても 偽のまま（外した 物を 勝手に 戻さない）', () => {
    expect(S.totonoeru({ ...KIHON, tiersEnabled: false }).tiersEnabled).toBe(false);
  });

  it('運転手の「今の 料金表」の 画面も 印を 見る（メーターと 画面の 字を 揃える）', () => {
    expect(HTML).toMatch(
      /if \(c\.tiersEnabled !== false && Array\.isArray\(c\.tiers\) && c\.tiers\.length\) \{/
    );
  });
});
