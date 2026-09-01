'use strict';
// ============================================================
// ★★見張りは「わざと壊して 赤に なった」記録を 残す★★ 2026-09-01
//
//   ★なぜ 要るか（今日 3回 起きた）★
//     私は 自分で 書いた 見張りが ★緑のまま 何も 見ていない★のを
//     ★1日で 3回★ 見つけました:
//       ①タブの 影 … 端の 帯を 丸ごと 比べていた ⇒ ★測っていたのは 札の 字★
//       ②同じ物  … 上端3pxに 絞ったが ⇒ ★測っていたのは 札の 色★
//       ③「無い時に そのまま 緑」を 1本 書いた（別の 見張りに 止められた）
//     ⇒ ★「見張りを 書いた」は「見張っている」ではない★
//     ⇒ ★わざと壊して 赤に なるのを 見た★時だけ、その見張りは 本物です。
//
//   ★決まり★
//     ★見張り★と 名乗る 試験ファイルは、
//     ★「わざと壊し」た 事と その 結果★を ファイルの 中に 書く。
//
//   ★★今 在る物を 一気に 赤に しません★★
//     2026-09-01 の 実測 … ★見張りと 名乗る 物 47本／記録が 在る 物 1本★。
//     46本を 今日 まとめて 直すのは ★別の 事故のもと★なので、
//     この repo が 既に 使っている ★名簿（NOKORI）方式★に します:
//       ・★名簿に 載っている 物だけ 見逃す★（1本 直すたびに 名簿から 消す）
//       ・★名簿は 増やせない★（新しく 足した 見張りは 必ず 記録が 要る）
//       ・★名簿から 減った時も 赤★（黙って 消さない＝直したなら 名簿を 直す）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const JIBUN = 'tests/unit/mihari-kowashita-kiroku.test.js';

// ★2026-09-01 時点で 既に 在った 物★（★1本 直すたびに ここから 消す★）
const NOKORI = [
  'tests/drift-static/distance-m-update-paths-anchor.test.js',
  'tests/e2e/jimusho-ryokinhyou.spec.js',
  'tests/e2e/kyuryo-paper.spec.js',
  'tests/integration/adaptive-mode-distance.test.js',
  'tests/integration/billing-gates-live.test.js',
  'tests/integration/gap-routing-validation.test.js',
  'tests/integration/meter-loadfill.test.js',
  'tests/integration/meter-persist.test.js',
  'tests/integration/overcount-zero-routing.test.js',
  'tests/integration/road-distance-gate.test.js',
  'tests/integration/smoothed-distance-parity-creep.test.js',
  'tests/integration/smoothed-gap-routing.test.js',
  'tests/integration/smoothed-longtunnel-parity.test.js',
  'tests/integration/smoothed-longtunnel-routefill.test.js',
  'tests/integration/speed-src-doppler-only.test.js',
  'tests/integration/stationary-baseline-watchdog.test.js',
  'tests/integration/timer-continuous-advance.test.js',
  'tests/integration/vehicle-k-meter.test.js',
  'tests/property/obd-bypass-drain-flicker.test.js',
  'tests/property/obd-certk-overcount-zero.test.js',
  'tests/property/obd-tireratio-overcount-zero.test.js',
  'tests/property/pipeline-physclamp-phantom.test.js',
  'tests/unit/build-1kai.test.js',
  'tests/unit/dk-config-app-base-host.test.js',
  'tests/unit/env-badge.test.js',
  'tests/unit/fare-config-itsuno.test.js',
  'tests/unit/fare-config-store.test.js',
  'tests/unit/fare-per-company.test.js',
  'tests/unit/kuruma-kyorikei.test.js',
  'tests/unit/kyuryo-emp-slip-cars.test.js',
  'tests/unit/kyuryo-role-free-input.test.js',
  'tests/unit/kyuryo-slip-all-days.test.js',
  'tests/unit/kyuryo-slip-options.test.js',
  'tests/unit/mada-naoshite-inai.test.js',
  'tests/unit/monosashi-mode.test.js',
  'tests/unit/nai-toki-midori.test.js',
  'tests/unit/obd-diagnostic-monitor.test.js',
  'tests/unit/obd-doppler-ceiling.test.js',
  'tests/unit/obd-ratchet.test.js',
  'tests/unit/obd-tire-coldstart-k0.test.js',
  'tests/unit/obd-wheelspeed-identify.test.js',
  'tests/unit/office-allow-list.test.js',
  'tests/unit/office-qr-side-guard.test.js',
  'tests/unit/scripts-registered.test.js',
  'tests/unit/test-band.test.js',
  'tests/unit/workflows-no-silent-cancel.test.js',
];

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p, out);
      return;
    }
    if (!/\.(test|spec)\.(js|mjs)$/.test(e.name)) return;
    out.push(path.relative(ROOT, p).split(path.sep).join('/'));
  });
  return out;
}

describe('★見張りは「わざと壊して 赤に なった」記録を 残す★', () => {
  const zenbu = walk(path.join(ROOT, 'tests'), []).filter((f) => f !== JIBUN);
  const mihari = zenbu.filter((f) => /見張り/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  const nashi = mihari.filter((f) => !/わざと壊/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));

  it('★① 見張りが 見つかっている（0本でも 緑、に しない）★', () => {
    expect(
      mihari.length,
      '★見張りと 名乗る 試験が 1つも 見つかりません（数え方が 壊れています）★'
    ).toBeGreaterThan(10);
  });

  it('★★② 新しい 見張りには「わざと壊した」記録が 在る★★', () => {
    const atarashii = nashi.filter((f) => NOKORI.indexOf(f) < 0);
    expect(
      atarashii,
      '★「わざと壊して 赤に なった」記録が ありません。★書いただけ★の 見張りは 何も 見ていない事が あります★'
    ).toEqual([]);
  });

  it('★③ 名簿は 増えない・黙って 減らない★', () => {
    // ★本番と テスト線で 試験の 本数が 少し 違います★（片方にしか 無い 試験が 在る）。
    //   ★この repo に 無い 物は 数えません★（「直した」ではなく「元から 無い」ので）。
    const aru = NOKORI.filter((f) => fs.existsSync(path.join(ROOT, f)));
    const mada = aru.filter((f) => nashi.indexOf(f) >= 0);
    expect(
      aru.length - mada.length,
      '★名簿の 物を 直したなら 名簿から 消してください（黙って 減らさない）★'
    ).toBe(0);
    expect(NOKORI.length, '★名簿を 増やさないでください（新しい 見張りには 記録を 書く）★').toBe(
      46
    );
  });
});
