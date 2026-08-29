// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/tools/fusion-floor-probe.js
// ★センサー融合「累積バックストップ」実測 (2026-06-15・本気で詰める)★
//   会議が「未検証」と認めた唯一の手: per-step Doppler天井(=回収を下方ノイズで食う)でなく
//   ★累積★ で Doppler/GPS を never-over backstop にし、積極k(=1.04)で過少読み車を回収しつつ
//   過大読み車を真値で頭打ちにできるか。ランダム2000台で「過大ゼロ(全車 dist≤真距離)」と
//   「過少読み車の回収」を実測する。複数のクランプ戦略を横並び比較。
//
//   各車: readFactor∈[0.95,1.03](δ_max内) × 速度列 × floor/round量子化 × Doppler(微小ノイズ+上向きスパイク)
//   観測: obd=floor(真×readFactor) ・ dop=真+ノイズ(5点に1点 1.5-2.5×スパイク) ・ GPS弦=真+正バイアス(ジッタ)
//   評価: 推定距離 ≤ 真距離(全車=過大ゼロ) かつ 過少読み車(readFactor≤1.0)の過小最小。

function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (1664525 * s + 1013904223) >>> 0) / 4294967296;
}
const Q = 1 / 3.6;

function simCar(rnd) {
  const readFactor = 0.95 + rnd() * 0.08; // [0.95,1.03]
  const roundMode = rnd() < 0.5;
  const n = 40 + Math.floor(rnd() * 50);
  const speeds = [];
  for (let i = 0; i < n; i++) speeds.push(3 + rnd() * 22); // 3..25 m/s
  let trueDist = 0;
  const obd = [],
    dop = [],
    gpsStep = [];
  for (let i = 0; i < n; i++) {
    const vt = speeds[i];
    trueDist += vt;
    const ecuKmh = vt * 3.6 * readFactor;
    const qKmh = roundMode ? Math.round(ecuKmh) : Math.floor(ecuKmh);
    obd.push((qKmh > 0 ? qKmh : 0) * Q);
    // Doppler: 真+±2%ノイズ・5点に1点 上向きスパイク(マルチパス)
    let d = vt * (1 + (rnd() - 0.5) * 0.04);
    if (i % 5 === 0) d = vt * (1.5 + rnd()); // 1.5-2.5×
    dop.push(d);
    // GPS弦: 真+正バイアス(ジッタは常に距離を増やす=Ranacher)。+0〜+4%/step
    gpsStep.push(vt * (1 + rnd() * 0.04));
  }
  return { readFactor, speeds, trueDist, obd, dop, gpsStep, n };
}

// 各戦略: cumOBDk を never-over backstop で頭打ち。戻り=推定総距離。
const STRATS = {
  // 0: 現行相当(per-step Doppler p25天井・積極kなし) — 参照
  cur_perstep_p25: (c) => {
    let total = 0;
    const win = [];
    for (let i = 0; i < c.n; i++) {
      const vEff = c.obd[i] + 0.139; // +0.5km/h quant
      if (c.dop[i] >= 0 && vEff >= 2.8) {
        win.push(Math.min(c.dop[i] / vEff, 1.1));
        if (win.length > 30) win.shift();
      }
      let k = 1.0;
      if (win.length >= 5) {
        const s = [...win].sort((a, b) => a - b);
        k = s[Math.floor(s.length * 0.25)]; // p25
      }
      total += vEff * Math.min(1.02, k);
    }
    return total;
  },
  // A: 積極k=1.04 + 累積Doppler backstop(spike=ratioMaxクランプ)
  aggK_cumDop_ratioClamp: (c) => {
    let total = 0,
      cumDop = 0;
    for (let i = 0; i < c.n; i++) {
      const vEff = c.obd[i];
      const dopClamped = Math.min(c.dop[i], vEff * 1.1); // スパイクをvEff×1.1で頭打ち
      cumDop += dopClamped;
      const want = total + vEff * 1.04;
      total = Math.min(want, cumDop); // 累積Doppler超えない
    }
    return total;
  },
  // B: 積極k=1.04 + 累積Doppler backstop(spike=走行中央値クランプ)
  aggK_cumDop_medClamp: (c) => {
    let total = 0,
      cumDop = 0;
    const recent = [];
    for (let i = 0; i < c.n; i++) {
      const vEff = c.obd[i];
      recent.push(c.dop[i]);
      if (recent.length > 15) recent.shift();
      const med = [...recent].sort((a, b) => a - b)[Math.floor(recent.length / 2)];
      const dopClamped = Math.min(c.dop[i], med * 1.05); // 中央値+5%で頭打ち(spike除去)
      cumDop += dopClamped;
      const want = total + vEff * 1.04;
      total = Math.min(want, cumDop);
    }
    return total;
  },
  // C: 積極k=1.04 + 累積GPS弦 backstop(GPSは正バイアス=Ranacher・効くか?)
  aggK_cumGPS: (c) => {
    let total = 0,
      cumG = 0;
    for (let i = 0; i < c.n; i++) {
      const vEff = c.obd[i];
      cumG += c.gpsStep[i];
      const want = total + vEff * 1.04;
      total = Math.min(want, cumG);
    }
    return total;
  },
  // D: 融合 = 累積 min(Doppler中央値クランプ, GPS) の小さい方を backstop
  aggK_cumFusionMin: (c) => {
    let total = 0,
      cumDop = 0,
      cumG = 0;
    const recent = [];
    for (let i = 0; i < c.n; i++) {
      const vEff = c.obd[i];
      recent.push(c.dop[i]);
      if (recent.length > 15) recent.shift();
      const med = [...recent].sort((a, b) => a - b)[Math.floor(recent.length / 2)];
      cumDop += Math.min(c.dop[i], med * 1.05);
      cumG += c.gpsStep[i];
      const back = Math.min(cumDop, cumG);
      total = Math.min(total + vEff * 1.04, back);
    }
    return total;
  },
};

function main() {
  const N = 2000;
  const rnd = lcg(12345);
  const cars = [];
  for (let i = 0; i < N; i++) cars.push(simCar(rnd));
  console.log(`=== センサー融合 累積backstop 実測 (${N}台・readFactor[0.95,1.03]) ===\n`);
  console.log(
    '戦略                       | 過大ゼロ違反台数 | 最悪過大% | 過少読み車 平均誤差% | 過大読み車 平均誤差%'
  );
  for (const name of Object.keys(STRATS)) {
    const f = STRATS[name];
    let over = 0,
      worstOver = 0,
      sumUnder = 0,
      nUnder = 0,
      sumOver = 0,
      nOver = 0;
    for (const c of cars) {
      const est = f(c);
      const errPct = (est / c.trueDist - 1) * 100;
      if (est > c.trueDist + 0.5) {
        over++;
        worstOver = Math.max(worstOver, errPct);
      }
      if (c.readFactor <= 1.0) {
        sumUnder += errPct;
        nUnder++;
      } else {
        sumOver += errPct;
        nOver++;
      }
    }
    console.log(
      `${name.padEnd(26)} |   ${String(over).padStart(5)} 台    |  ${worstOver.toFixed(2).padStart(6)}% |   ${(sumUnder / nUnder).toFixed(2).padStart(7)}%        |   ${(sumOver / nOver).toFixed(2).padStart(7)}%`
    );
  }
  console.log('\n※ 過大ゼロ違反台数=0 が法的合格の絶対条件。過少読み車誤差が0に近いほど回収成功。');
  console.log(
    '※ aggK=積極k1.04(=過少読み車を真値へ)。backstopが過大読み車を真値で刈れれば違反0のはず。'
  );
}
main();
