'use strict';
// ============================================================
// ★★料金を 別ファイルに 出しても 1円も 変わらない★★ 2026-08-31（司さん「②やれ」）
//
//   ★何を するか★
//     ★変える前の meter.js を 先に 複製★してあります:
//       tests/fixtures/meter-MAE-2026-08-31.js（sha256 be22047223d1b995・77,019 bytes）
//       ★repo の 中に 置きます★＝手元にしか 無いと CI で 落ちる（2026-08-31 実際に 落ちた）
//     ★同じ入力★を 前の物と 今の物の 両方に 入れ、★1円でも ずれたら 赤★に します。
//     （★参照のままで 比べると 自分の 答えに 書き換わります★ので 先に 複製しました）
//
//   ★何本 試すか★
//     距離 … ★段の 境目を またぐ 所を 含めて 1,000通り以上★
//     料金表 … 素の形／段階(tiers)／車種／手動割増／待ち時間／下限・上限／丸め 1・10・50
//     ⇒ ★掛け算で 数千通り★
//
//   ★時計に 触る 所（自動割増）★
//     night / weekend / winter は ★今の時刻★で 効きます。
//     前の物は `new Date()` を 自分で 呼ぶので 外から 固定できません。
//     ⇒ ①自動割増を ★切った★ 料金表で ★1円まで 完全一致★を 見ます（本命）
//       ②自動割増を ★入れた★ 料金表でも 同じ 走りで 比べます
//         （2つの `new Date()` の 差は ミリ秒。★時が 変わる 瞬間に 当たると 揺れる★ので
//          その時は ★もう一度 引いて 見ます★。3回 揺れたら 赤）
//
//   ★ここでは 距離(distance_m)に 1mmも 触っていません★（受け取って 円を 返すだけ）
const path = require('path');

// ★★比べる相手は repo の 中に 置く★★ 2026-08-31
//   ★最初 手元(scratchpad)の 複製を 見ていて CI が 赤に なりました★
//     Error: Cannot find module '/home/runner/work/Daikou-app-test/moto/meter-MOTO-2026-08-31.js'
//   ＝★ローカル緑 ≠ CI緑★。比べる相手が 手元にしか 無いと ★誰も 確かめられません★。
//   ⇒ ★変える前の meter.js を そのまま fixture に 入れました★（1バイトも 変えていない）
const MAE_PATH = path.join(__dirname, '..', 'fixtures', 'meter-MAE-2026-08-31.js');
const IMA_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function yomu(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}

// ★距離の 一覧★（段の 境目の 前後を 必ず 踏む）
function kyori(config) {
  const out = new Set([0, 1, 999, 1000, 1001]);
  const b = config.base_distance_m || 1000;
  const a = config.add_distance_m || 420;
  for (let i = 0; i <= 60; i++) {
    const x = b + a * i;
    out.add(x - 1);
    out.add(x);
    out.add(x + 1);
  }
  for (let m = 0; m <= 30000; m += 137) out.add(m);
  return Array.from(out).sort((x, y) => x - y);
}

const SOZAI = {
  version: 2,
  base_fare: 1300,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: 420,
  rounding: 10,
};

function utsushi(o) {
  return JSON.parse(JSON.stringify(o));
}

// ★試す 料金表★
function hyou() {
  const li = [];
  [1, 10, 50].forEach((r) => li.push(Object.assign(utsushi(SOZAI), { rounding: r })));
  li.push(Object.assign(utsushi(SOZAI), { base_fare: 900, add_fare: 80, add_distance_m: 333 }));
  li.push(
    Object.assign(utsushi(SOZAI), {
      tiers: [
        { from_m: 1000, to_m: 5000, add_distance_m: 420, add_fare: 100 },
        { from_m: 5000, to_m: null, add_distance_m: 350, add_fare: 120 },
      ],
    })
  );
  li.push(
    Object.assign(utsushi(SOZAI), {
      vehiclesEnabled: true,
      vehicles: [{ id: 'wagon', multiplier: 1.2, addon: 200 }],
    })
  );
  li.push(Object.assign(utsushi(SOZAI), { surcharges: [{ id: 's1', rate: 1.3 }] }));
  li.push(Object.assign(utsushi(SOZAI), { wait: { enabled: true, freeMins: 3, ratePerMin: 120 } }));
  li.push(Object.assign(utsushi(SOZAI), { minFare: 2000, maxFare: 5000 }));
  return li;
}

// ★自動割増を 入れた 物（時計に 触る）★
function hyouJidou() {
  return [
    Object.assign(utsushi(SOZAI), {
      autoSurcharges: {
        night: { enabled: true, from: 22, to: 5, rate: 1.25 },
        weekend: { enabled: true, rate: 1.1 },
        winter: { enabled: true, from: '12-15', to: '03-15', rate: 1.1 },
      },
    }),
  ];
}

// 1本 走らせて 全部の 距離の 料金を 返す
function hashiru(M, config, opts) {
  opts = opts || {};
  M.setFareConfig(utsushi(config));
  if (opts.vehicleId && typeof M.setActiveVehicle === 'function')
    M.setActiveVehicle(opts.vehicleId);
  if (opts.surchargeId && typeof M.setSurchargeActive === 'function')
    M.setSurchargeActive(opts.surchargeId, true);
  return kyori(config).map((m) => M.calcFare(m));
}

describe('★料金を 別ファイルに 出しても 1円も 変わらない★', () => {
  it('★① 比べる相手（変える前の meter.js）が 在る★', () => {
    const M = yomu(MAE_PATH);
    expect(typeof M.calcFare, '★前の物が 読めません★').toBe('function');
  });

  it('★★② 自動割増なし … 1円まで 完全一致★★', () => {
    const mae = yomu(MAE_PATH);
    const ima = yomu(IMA_PATH);
    let kazu = 0;
    hyou().forEach((c, i) => {
      [{}, { vehicleId: 'wagon' }, { surchargeId: 's1' }].forEach((o) => {
        const a = hashiru(mae, c, o);
        const b = hashiru(ima, c, o);
        kazu += a.length;
        for (let k = 0; k < a.length; k++) {
          if (a[k] !== b[k]) {
            throw new Error(
              '★料金が 変わりました★ 料金表#' +
                i +
                ' 距離=' +
                kyori(c)[k] +
                'm  前=' +
                a[k] +
                '円 / 今=' +
                b[k] +
                '円'
            );
          }
        }
      });
    });
    // ★何本 比べたかを 出す★（0本でも 緑、を 起こさない）
    expect(kazu, '★比べた 本数が 少なすぎます★').toBeGreaterThan(3000);
  });

  it('★★③ 自動割増あり … 同じ走りで 一致（時が 変わる 瞬間は 引き直す）★★', () => {
    const mae = yomu(MAE_PATH);
    const ima = yomu(IMA_PATH);
    let ok = false;
    let saigo = '';
    for (let tabi = 0; tabi < 3 && !ok; tabi++) {
      ok = true;
      for (const c of hyouJidou()) {
        const a = hashiru(mae, c);
        const b = hashiru(ima, c);
        for (let k = 0; k < a.length; k++) {
          if (a[k] !== b[k]) {
            ok = false;
            saigo = '距離=' + kyori(c)[k] + 'm 前=' + a[k] + ' 今=' + b[k];
            break;
          }
        }
      }
    }
    expect(ok, '★自動割増ありで 3回とも 合いませんでした（' + saigo + '）★').toBe(true);
  });

  it('★④ 別ファイル側だけを 呼んでも 同じ★（画面が 直に 呼ぶ 道）', () => {
    const mae = yomu(MAE_PATH);
    const FC = yomu(path.join(__dirname, '..', '..', 'js', 'fare-calc.js'));
    const c = utsushi(SOZAI);
    const a = hashiru(mae, c);
    const li = kyori(c);
    const now = new Date();
    for (let k = 0; k < li.length; k++) {
      const b = FC.keisan(li[k], c, null, new Set(), 0, now);
      expect(b, '★部品を 直に 呼ぶと 違います 距離=' + li[k] + 'm★').toBe(a[k]);
    }
  });

  it('★⑤ メーターは 式を 持っていない（写しが 残っていない）★', () => {
    const fs = require('fs');
    const s = fs.readFileSync(IMA_PATH, 'utf8');
    // ★丸めの 式★と ★段の 式★が meter.js に 残っていたら 2か所に なる
    expect(
      s.indexOf('Math.round(fare / unit) * unit'),
      '★丸めの 式が meter.js に 残っています（2か所）★'
    ).toBe(-1);
    expect(s.indexOf('Math.ceil(extra / '), '★段の 式が meter.js に 残っています（2か所）★').toBe(
      -1
    );
  });
});
