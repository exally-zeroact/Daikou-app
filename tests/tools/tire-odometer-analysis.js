// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/tools/tire-odometer-analysis.js
// ★入力済み車両情報(型式+タイヤ)だけで「オドメーターの系統誤差」を事前推定するツール★
//   走行前に分かること:
//     1. タイヤspec → 転がり円周 → オドメーターの距離/回転
//     2. 純正タイヤ vs 実装着タイヤ(摩耗/サイズ違い) → オドメーターのover-read比
//     3. 保安基準148条のメーター高め設計 → オドメーターが真値より長く出る帯
//     4. ダイコメ(GPS)の「オドメーター比 −x%」を「真値比」へ翻訳
//   結論の用途: kはオドメーターに合わせ込むのではなく、オドメーターを「ソフト天井」
//   として扱う(合わせ込むと真値を超えて過大課金=過大ゼロ違反)ことの定量的根拠。
//   純関数のみ。Node 直実行で表を出す(末尾)。distance_m/calcFare には一切触れない。

'use strict';

const MM_PER_INCH = 25.4;

// "165/60R14" → {width:165, aspect:60, rim:14}
function parseTire(spec) {
  const m = String(spec).match(/(\d{3})\s*\/\s*(\d{2})\s*R?\s*(\d{2})/i);
  if (!m) return null;
  return { width: +m[1], aspect: +m[2], rim: +m[3] };
}

// 自由静的外径(mm)
function tireDiameterMm(t) {
  const sidewall = t.width * (t.aspect / 100); // 片側ハイト(mm)
  return t.rim * MM_PER_INCH + 2 * sidewall;
}

// 自由静的円周(m)
function tireCircumferenceM(t) {
  return (Math.PI * tireDiameterMm(t)) / 1000;
}

// 動的転がり円周(m): 荷重でわずかに潰れるためJATMA系の実効係数を掛ける(≈0.97)
function rollingCircumferenceM(t, factor) {
  return tireCircumferenceM(t) * (factor == null ? 0.97 : factor);
}

// 摩耗によるover-read比: 新品トレッド→摩耗で半径が縮む。
//   オドメーターは「ある基準円周」で校正済なので、実円周が小さいほど距離を多く刻む。
//   ratio = 基準円周 / 実摩耗円周 ( >1 = オドメーターが長く出る )
function wearOverReadRatio(t, treadLossMm) {
  const d0 = tireDiameterMm(t);
  const dWorn = d0 - 2 * (treadLossMm || 0); // トレッド摩耗は半径方向→直径は2倍効く
  return d0 / dWorn;
}

// 保安基準148条(2007+) のメーター高め設計に由来するオドメーターの真値超過帯。
//   速度計は実速を下回らない設計(プラス側 (100/94)V1 まで許容=最大 +6.4%)。
//   オドメーターは速度計より穏当だが同源で長め。実測知見の保守帯を返す。
function regulatoryOdoOverReadBand() {
  // [下限, 上限] = オドメーターが真値より長く出る割合(0.01 = +1%)
  return { lo: 0.005, hi: 0.05 }; // +0.5% 〜 +5%(摩耗含まずの設計分)
}

// ダイコメの「オドメーター比 dkVsOdoPct(%, 負=過小)」を「真値比」へ翻訳。
//   真値比 ≈ dkVsOdo + オドメーター超過分。
//   odoOverPct(%) はオドメーターが真値を何%超過しているかの推定。
function translateDkVsTrue(dkVsOdoPct, odoOverPct) {
  // dk = odo*(1+dkVsOdo); true = odo/(1+odoOver) → dk/true = (1+dkVsOdo)*(1+odoOver)
  const dk = 1 + dkVsOdoPct / 100;
  const over = 1 + odoOverPct / 100;
  return (dk * over - 1) * 100; // %(負=真値より過小=過大ゼロ側で安全)
}

const API = {
  parseTire,
  tireDiameterMm,
  tireCircumferenceM,
  rollingCircumferenceM,
  wearOverReadRatio,
  regulatoryOdoOverReadBand,
  translateDkVsTrue,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;

// ---- Node 直実行: タウンボックス DS17W (純正165/60R14) で表を出す ----
if (typeof require !== 'undefined' && require.main === module) {
  const spec = process.argv[2] || '165/60R14';
  const t = parseTire(spec);
  if (!t) {
    console.error('タイヤspec解析不能:', spec);
    process.exit(1);
  }
  const dia = tireDiameterMm(t);
  const circFree = tireCircumferenceM(t);
  const circRoll = rollingCircumferenceM(t);
  const revPerKm = 1000 / circRoll;

  console.log('===== 入力済み情報だけで分かるオドメーター系統誤差 =====');
  console.log(`タイヤ: ${spec}  (幅${t.width}/扁平${t.aspect}/リム${t.rim}インチ)`);
  console.log(`外径(自由)        : ${dia.toFixed(1)} mm`);
  console.log(`円周(自由静的)    : ${circFree.toFixed(4)} m`);
  console.log(`転がり円周(動的)  : ${circRoll.toFixed(4)} m  (×0.97)`);
  console.log(`回転数            : ${revPerKm.toFixed(1)} 回/km`);
  console.log('');

  // 摩耗の影響(新品7mm→車検限界1.6mm = 約5.4mm摩耗まで)
  console.log('--- タイヤ摩耗によるオドメーター余分なover-read ---');
  [0, 2, 4, 5.4].forEach((loss) => {
    const r = wearOverReadRatio(t, loss);
    console.log(`  トレッド摩耗 ${loss}mm → over-read +${((r - 1) * 100).toFixed(2)}%`);
  });
  console.log('');

  // 設計分 + 摩耗分の合算帯
  const band = regulatoryOdoOverReadBand();
  const wearMid = (wearOverReadRatio(t, 3) - 1) * 100; // 中間摩耗3mm
  const odoOverLo = band.lo * 100;
  const odoOverHi = band.hi * 100 + wearMid;
  console.log('--- オドメーターが真値より長く出る総推定帯 ---');
  console.log(
    `  設計分(保安基準148条) : +${(band.lo * 100).toFixed(1)}% 〜 +${(band.hi * 100).toFixed(1)}%`
  );
  console.log(`  摩耗分(中間3mm)       : +${wearMid.toFixed(2)}%`);
  console.log(`  合計オドメーター超過  : +${odoOverLo.toFixed(1)}% 〜 +${odoOverHi.toFixed(1)}%`);
  console.log('');

  // ダイコメの実測(オドメーター比)を真値比へ翻訳
  console.log('--- ダイコメ(GPS)の実測をオドメーター比→真値比に翻訳 ---');
  console.log('   (実機: ダイコメ表示はオドメーター比で概ね −1.5%)');
  [
    ['楽観(オドメーター超過 最小)', odoOverLo],
    ['中央', (odoOverLo + odoOverHi) / 2],
    ['保守(オドメーター超過 最大)', odoOverHi],
  ].forEach(([label, over]) => {
    const dkVsTrue = translateDkVsTrue(-1.5, over);
    const safe = dkVsTrue <= 0 ? '✅過大ゼロ満たす' : '⚠️真値超過';
    console.log(`  ${label.padEnd(26)} : ダイコメ vs 真値 = ${dkVsTrue.toFixed(2)}%  ${safe}`);
  });
  console.log('');
  // 損益分岐: ダイコメ/真値 = (1+dkVsOdo)*(1+odoOver) = 1 となる odoOver
  const dkVsOdo = -1.5;
  const breakEven = (1 / (1 + dkVsOdo / 100) - 1) * 100;
  console.log(`--- 損益分岐 ---`);
  console.log(
    `  オドメーター超過が +${breakEven.toFixed(2)}% を超えると、ダイコメ(オドメーター比−1.5%)`
  );
  console.log(`  でも真値を超える=過大。摩耗3mm+設計分で容易に超えうる帯。`);
  console.log('');
  console.log('★結論(訂正版):');
  console.log('  ・オドメーターは真値ではない=設計+摩耗で +0.5〜6% 長く出る。');
  console.log('  ・ダイコメ −1.5%(オドメーター比)は、真値比では −1%〜+4.5% に散らばる。');
  console.log('    → オドメーターが +1.5% 超 long な個体ではダイコメは真値を超える(過大)。');
  console.log('  ・∴ k でオドメーターに合わせ込むのは過大ゼロ違反リスク=やってはいけない。');
  console.log('    オドメーターは「合わせる目標」ではなく「越えてはいけないソフト天井」。');
  console.log('  ・真の0%が要るならタイヤ非依存の基準(GPS後処理/実測コース/OBD∫v)が必須。');
}
