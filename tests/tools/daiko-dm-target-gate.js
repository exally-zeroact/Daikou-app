// tests/tools/daiko-dm-target-gate.js
// ★代行 DM−0.2% 着地ゲート (2026-06-18・テストツール先行)★
//   司さん確定: 「DM−0.2%にする係数は"距離計算式"に入れる(料金でない)」。
//   本ゲートは実走trace(realtrace-0617-daiko-dm.json)を実車(it=1)区間ごとに距離エンジンへ通し、
//   ★engine距離 × 代行係数 が DM−0.2%(随伴車メーター×0.998) に乗るか★ を採点する。
//   実装(係数を距離計算式へ)の前に、この値較正を実データで固定するのが目的。
//   使い方: node tests/tools/daiko-dm-target-gate.js [係数]   (省略時=候補スイープ+最適係数提示)
const fs = require('fs');
const path = require('path');
const PD = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));

const FIX = path.join(__dirname, '..', 'fixtures', 'realtrace-0617-daiko-dm.json');
const stub = {
  snapToNearestRoad: () => null,
  getRoadsNear: () => [],
  calcRoadDistance: () => null,
  decodeRoadAt: () => null,
};

// 実車(it=1)区間でセグメント化
function segmentTrips(samples) {
  const segs = [];
  let cur = null;
  for (const x of samples) {
    const it = x.biz && x.biz.it ? 1 : 0;
    if (it === 1) {
      if (!cur) cur = [];
      cur.push(x);
    } else {
      if (cur && cur.length > 5) segs.push(cur);
      cur = null;
    }
  }
  if (cur && cur.length > 5) segs.push(cur);
  return segs;
}

// 距離エンジン(OBD駆動・OBD-main)を実走させ engine距離(m)を返す。
//   ★代行係数は「距離計算式」に入る想定 → ここでは engine素距離を出し、後段で×係数して採点。
//   (実装後は cfg.obdDaikouFactor 等で pipeline 内乗算になるが、本ゲートは値較正が目的なので外で掛ける)
function runEngine(seg, cfg) {
  const tk = PD.createDistanceTracker(stub, {
    useSnapCache: false,
    enableRouting: false,
    adaptiveMode: false,
    ...cfg,
  });
  tk.ingest({
    lat: seg[0].lat,
    lng: seg[0].lng,
    t: seg[0].t,
    acc: seg[0].acc,
    spd: 0,
    obd: true,
    dopMps: -1,
  });
  for (let i = 1; i < seg.length; i++) {
    const x = seg[i];
    const vObd = typeof x.obd === 'number' && x.obd >= 0 ? x.obd / 3.6 : 0;
    const dop = typeof x.spd === 'number' && x.spd >= 0 ? x.spd : -1;
    tk.ingest({ lat: x.lat, lng: x.lng, t: x.t, acc: x.acc, spd: vObd, obd: true, dopMps: dop });
  }
  return tk.totalM();
}

function main() {
  const fix = JSON.parse(fs.readFileSync(FIX, 'utf8'));
  const trips = segmentTrips(fix.samples);
  const dms = [fix.meta.dm_ref.trip1_km, fix.meta.dm_ref.trip2_km]; // 随伴車メーター(DM)
  // ★較正の真基準 = 司さんが画面で読んだ実エンジン距離(distance_m)★。
  //   stub再計算は道路スナップ抜きで実エンジンと~1.9%ズレる→較正は screen 値で行う(テストツールが検出した教訓)。
  const screen = [fix.meta.daikome_screen.trip1_km, fix.meta.daikome_screen.trip2_km];
  console.log('実車区間数=' + trips.length + ' / DM参照=実車1,2');

  // 診断: stub再計算(道路抜きOBD∫v) が screen とどれだけズレるか(=なぜ screen で較正するかの根拠)
  const eng = trips.map((seg) => runEngine(seg, {}) / 1000);
  console.log('\n=== 診断: stub再計算 vs 実画面値(screen) ===');
  for (let i = 0; i < 2; i++) {
    console.log(
      `  実車${i + 1}: stub=${eng[i].toFixed(3)}km / screen=${screen[i]}km (ズレ ${((eng[i] / screen[i] - 1) * 100).toFixed(2)}%) ← screenで較正`
    );
  }

  console.log('\n=== 代行係数スイープ: screen × 係数 が DM−0.2%(=DM×0.998) に乗るか ===');
  console.log('係数   | 実車1 screen×係数 (vs DM−0.2%) | 実車2 screen×係数 (vs DM−0.2%) | DM超?');
  const arg = parseFloat(process.argv[2]);
  const candidates = isFinite(arg) ? [arg] : [1.0, 1.011, 1.014, 1.017, 1.02];
  for (const f of candidates) {
    const cells = [];
    let over = false;
    for (let i = 0; i < 2; i++) {
      const billed = screen[i] * f;
      const pct = (billed / (dms[i] * 0.998) - 1) * 100;
      if (billed > dms[i]) over = true;
      cells.push(`${billed.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`);
    }
    console.log(
      `${f.toFixed(3)} | ${cells[0].padEnd(24)} | ${cells[1].padEnd(24)} | ${over ? '★超★' : '✓'}`
    );
  }

  // ★DM−0.2%に最も乗る代行係数(2実車平均・screen基準)★
  const k = ((dms[0] * 0.998) / screen[0] + (dms[1] * 0.998) / screen[1]) / 2;
  console.log(`\n★DM−0.2%に最も乗る代行係数(screen基準・2実車平均)= ${k.toFixed(4)}★`);
  for (let i = 0; i < 2; i++) {
    console.log(
      `  実車${i + 1}: screen ${screen[i]} ×${k.toFixed(4)} = ${(screen[i] * k).toFixed(3)}km (DM ${dms[i]}・DM−0.2%=${(dms[i] * 0.998).toFixed(3)})`
    );
  }

  const useF = isFinite(arg) ? arg : k;
  let pass = true;
  const TOL = 1.0;
  for (let i = 0; i < 2; i++) {
    if (Math.abs((screen[i] * useF) / (dms[i] * 0.998) - 1) * 100 > TOL) pass = false;
  }
  console.log(
    `\n${pass ? '★GATE PASS★' : '★GATE FAIL★'} — 係数 ${useF.toFixed(4)} で両実車が DM−0.2% ±${TOL}% 以内`
  );
  console.log(
    '※残差(実車1=1.011/実車2=1.017で必要係数が違う)はGPS/条件差=一律係数で完全には消えない(代行は許容)。'
  );
  console.log(
    '※実装: この係数を「距離計算式」(meter距離確定 or pipeline出力)に入れ distance_m を DM−0.2% に着地させる。料金/表示/総走行は distance_m に従う。'
  );
  process.exit(pass ? 0 : 1);
}
main();
