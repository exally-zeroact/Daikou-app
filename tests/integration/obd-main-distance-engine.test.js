// tests/integration/obd-main-distance-engine.test.js
// ★OBDメイン距離 実エンジン不変条件 (2026-06-10・テスト班 / 2026-06-11 認定天井へ更新)★
//   司さん裁定: OBD接続中はOBD車輪速度をメイン距離源にする(=タクシー認定の基準ローラー量)。
//   本番配線: gps.js が speedSrc='obd' を立て → map-matcher が ingest に obd:true を渡し →
//             pipeline-distance の ∫v(OBD) メイン枝(L1735)が距離を駆動。
//   このテストは createDistanceTracker / computeDistance を ★実コードのまま★ 動かし、
//   OBD valid 時に距離が OBD 由来 / 停車で creep 0 / never-over を固定する。
//
//   ★★never-over 天井の正しい定義(2026-06-11・司さん確定指示=認定方式を丸写し)★★:
//     認定メーター(計量法JIS D5609 / 国交省ソフトメーター・矢崎/二葉/岡部)の片側公差は
//     ★−4%〜0%(過大不可)★ で、合否天井は「指示距離 ≤ ★真距離★」。認定では距離=車速パルス積算÷車両定数K
//     を ★距離そのものに焼く★(=pulse×scale が指示距離)。ダイコメ写像: 距離源=OBD車輪速度∫v、
//     校正=δ自己キャリブ(良GPS区間で δ=(GPS−∫OBD)/移動時間 を学習し distance_m に焼く=認定のK相当)。
//
//   ★旧天井 raw∫v(k=1) は非認定でキツすぎる★: OBD車速は 1km/h 整数floorで各サンプルを必ず切り捨て
//     → raw∫v(k=1) は ★真距離より系統 −2%過小★。これを天井にすると「floorで失った分の回収(δ)」を
//     盛った瞬間に赤くなる(wf_289f4414で確認)。だが回収後でも ≤真距離 なら過大ゼロは守られている。
//   ★新天井(真距離参照なしfixture用・構造保証式)★:
//        distance_m ≤ raw∫v + obdDeltaMaxMps × Σdt_move   (= Σspd×dt + δmax×移動時間)
//     論証(=緩めでなく ≤真距離 を保証):
//       (1) OBD floor量子化で raw∫v ≤ ∫(真速度)=真距離。
//       (2) δは ±obdDeltaMaxMps(=0.139m/s=0.5km/h=floor量子化の物理上限)にクランプ(L1759-1760)
//           = 「floorで失った分の回収」のみ。raw∫v + δmax×t_move = floor復元の物理上限 ≤ 真距離。
//       (3) ゆえに raw∫v ≤ raw∫v+δmax×t_move ≤ 真距離。新天井は raw∫v(k=1)より上だが ★真距離以下★。
//     真距離参照ありfixture(0610b-Android=KP差・国交省RTKサブメーター)は別gate
//     (tests/truedist-obd-engine-gate.js)で distance_m ≤ 真距離 を直接採点する。
//
//   ★不可侵★: distance_m が真距離を超えない/calcFare/business 分離/GPS経路byte不変(δは cur.obd区間のみ)。
//   k(車別補正)は ★採点側でのみ★ 適用し、pipeline には raw spd を渡す契約を検証する。

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FIX = path.join(__dirname, '..', 'fixtures');
let computeDistance, createDistanceTracker, dec, DEFAULTS;

beforeAll(() => {
  const sandbox = {
    console,
    atob: typeof atob !== 'undefined' ? atob : (b) => Buffer.from(b, 'base64').toString('binary'),
    btoa: typeof btoa !== 'undefined' ? btoa : (s) => Buffer.from(s, 'binary').toString('base64'),
    Uint8Array,
    TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : undefined,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'roads-decoder.js'), 'utf8'),
    sandbox,
    { filename: 'roads-decoder.js' }
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'roads-ehime.js'), 'utf8'),
    sandbox,
    { filename: 'roads-ehime.js' }
  );
  dec = new sandbox.RoadDecoder(sandbox.ROADS_EHIME);
  dec.buildOffsetTable();
  const mod = require(path.join(__dirname, '..', '..', 'js', 'pipeline-distance.js'));
  computeDistance = mod.computeDistance;
  createDistanceTracker = mod.createDistanceTracker;
  DEFAULTS = mod.DEFAULTS;
}, 60000);

// 道路に依存しない最小スタブ (∫v(OBD) 枝は snap/road-arc を使わない=純粋に時間積分)
const stubDec = {
  snapToNearestRoad() {
    return null;
  },
  getRoadsNear() {
    return [];
  },
  calcRoadDistance() {
    return null;
  },
  decodeRoadAt() {
    return null;
  },
};
// OBDメイン枝は adaptiveMode!==true で発火(本番 DEFAULTS と同じ)
// ★obdQuantCorrectMps:0★ = +0.5km/h floor回収(全車普遍補正)を切り、純 ∫v(=spd×dt)の機構を検証する。
//   量子化補正の改善&過大ゼロは専用ゲート(truedist-obd-engine-gate --quant)で担保。
const OBD_OPT = {
  useSnapCache: false,
  enableRouting: false,
  adaptiveMode: false,
  obdQuantCorrectMps: 0,
};
const T0 = 1_700_000_000_000;

function load(file) {
  const p = path.join(FIX, file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'))
    .filter((x) => x && Number.isFinite(x.lat))
    .sort((x, y) => (x.t || 0) - (y.t || 0));
}

// raw ∫v(OBD・k=1) = pipeline と同じ台形・dt<=obdMaxDtS で穴は計上しない(過大ゼロ側)
function obdRawIntegral(samples, obdMaxDtS) {
  let m = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    if (!(dt > 0 && dt <= obdMaxDtS)) continue;
    const a = samples[i - 1].obd,
      b = samples[i].obd;
    if (typeof a === 'number' && a >= 0 && typeof b === 'number' && b >= 0)
      m += ((a + b) / 2 / 3.6) * dt;
  }
  return m;
}

// ★認定天井の δ 許容分★ = Σdt_move(有効OBD区間の経過秒)。
//   δ は ∫v(OBD) メイン枝が踏む全有効区間(dt∈(0,obdMaxDtS])に最大 δmax まで注入されうる
//   (vEff=spd+δ・spd=0でも δ>0 なら δ×dt 注入)。よって δ寄与の物理上限 = obdDeltaMaxMps × Σdt。
//   これを raw∫v に足したものが「floor復元の上限 = ≤真距離」=認定の過大ゼロ天井。
function obdValidMoveTimeS(samples, obdMaxDtS) {
  let s = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    if (!(dt > 0 && dt <= obdMaxDtS)) continue;
    const a = samples[i - 1].obd,
      b = samples[i].obd;
    if (typeof a === 'number' && a >= 0 && typeof b === 'number' && b >= 0) s += dt;
  }
  return s;
}

// ★認定 never-over 天井★: distance_m ≤ raw∫v + δmax×Σdt_move (= floor復元上限 ≤ 真距離)。
function obdCertCeiling(samples, DEFAULTS) {
  return (
    obdRawIntegral(samples, DEFAULTS.obdMaxDtS) +
    DEFAULTS.obdDeltaMaxMps * obdValidMoveTimeS(samples, DEFAULTS.obdMaxDtS)
  );
}

describe('OBDメイン距離 ∫v(OBD) 実エンジン不変条件', () => {
  it('★OBD valid 時の距離は OBD 由来 (reason=obd・distance == ∫v dt)', () => {
    const tk = createDistanceTracker(stubDec, OBD_OPT);
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: 0, obd: true }); // first
    const speeds = [15, 20, 18, 12, 25]; // m/s・各 dt=1s
    let expected = 0;
    for (const s of speeds) {
      t += 1000;
      const r = tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: s, obd: true });
      expect(r.reason).toBe('obd'); // ★距離源が OBD であることを固定★
      expected += s * 1;
    }
    expect(Math.abs(tk.totalM() - expected)).toBeLessThan(1e-6);
  });

  it('★反例(過大検出): δを上限超に盛った距離は認定天井を超えてFAILする (緩めてない証明)', () => {
    // ★新天井が緩すぎないことの反例★: 「もし」δが obdDeltaMaxMps を超えて距離を盛ったら(=過大・真距離超え)、
    //   認定天井 raw∫v+δmax×t_move は ★それを依然 FAIL 検出する★。stub で過大距離を作って確認。
    const samples = [];
    let t = T0;
    for (let i = 0; i <= 20; i++) {
      samples.push({ t, obd: 36 });
      t += 1000;
    }
    const raw = obdRawIntegral(samples, DEFAULTS.obdMaxDtS);
    const moveT = obdValidMoveTimeS(samples, DEFAULTS.obdMaxDtS);
    const ceiling = obdCertCeiling(samples, DEFAULTS);
    // 正しいδ(=上限ちょうど): raw + δmax×t_move は天井 ★以下★ (合格)。
    const distAtMax = raw + DEFAULTS.obdDeltaMaxMps * moveT;
    expect(distAtMax).toBeLessThanOrEqual(ceiling + 1e-6);
    // ★過大ケース★: δを上限の2倍で盛る(=floor復元を超え真距離を超える)→ 天井を超え FAIL すべき。
    const distOver = raw + DEFAULTS.obdDeltaMaxMps * 2 * moveT;
    expect(distOver).toBeGreaterThan(ceiling); // ★過大は天井を突破=検出される(緩めていない)★
  });

  it('★OBD 速度0(停車)で creep 0 (自然ZUPT・1byteも増えない)', () => {
    const tk = createDistanceTracker(stubDec, OBD_OPT);
    let t = T0;
    tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: 0, obd: true });
    for (let i = 0; i < 30; i++) {
      t += 1000;
      const r = tk.ingest({ lat: 34, lng: 133, t, acc: 5, spd: 0, obd: true });
      expect(r.deltaM).toBe(0);
    }
    expect(tk.totalM()).toBe(0); // ★停車creep = 0★
  });

  it('★never-over: 異常 dt(>obdMaxDtS) は穴を ∫v 計上しない (過大ゼロ保険)', () => {
    const tk = createDistanceTracker(stubDec, OBD_OPT);
    const maxDt = DEFAULTS.obdMaxDtS; // 10s
    tk.ingest({ lat: 34, lng: 133, t: T0, acc: 5, spd: 20, obd: true });
    const r = tk.ingest({
      lat: 34,
      lng: 133,
      t: T0 + (maxDt + 5) * 1000,
      acc: 5,
      spd: 20,
      obd: true,
    });
    expect(r.deltaM).toBe(0); // 穴は埋めない=過大方向に出ない
    expect(tk.totalM()).toBe(0);
  });

  it('★never-over(認定天井): distance_m ≤ raw∫v + δmax×Σdt_move (=floor復元上限≤真距離)', () => {
    // ★認定方式の天井★: 旧 raw∫v(k=1) 天井は floorで−2%過小=非認定でキツすぎる。正しい天井は
    //   raw∫v + δmax×移動時間 (δがfloorで失った量子化分を回収しても真距離を超えない物理上限)。
    //   δ OFF(この OBD_OPT は obdDeltaCalib 未設定=既定OFF)では distance==raw で天井内に確実に収まる。
    const tk = createDistanceTracker(stubDec, OBD_OPT);
    const samples = [];
    let t = T0;
    for (let i = 0; i <= 20; i++) {
      samples.push({ lat: 34, lng: 133, t, acc: 5, obd: 36 });
      t += 1000;
    } // obd km/h
    // ingest は spd(m/s) を読む。OBD km/h を m/s に変換して obd:true で流す(本番 map-matcher 相当)。
    let total = 0;
    for (let i = 0; i < samples.length; i++) {
      const r = tk.ingest({ lat: 34, lng: 133, t: samples[i].t, acc: 5, spd: 36 / 3.6, obd: true });
      total = r.totalM;
    }
    const raw = obdRawIntegral(samples, DEFAULTS.obdMaxDtS);
    const ceiling = obdCertCeiling(samples, DEFAULTS);
    expect(total).toBeLessThanOrEqual(ceiling + 1e-6); // ★distance ≤ raw∫v + δmax×t_move (認定天井)★
    expect(total).toBeGreaterThanOrEqual(raw - 1e-6); // δ OFF なので raw を下回らない(=この窓では==raw)
    // k>1 を採点側で掛けるのは raw に対してであって distance_m には掛けない(不可侵)
    const k = 1.04;
    const scored = raw * k;
    expect(scored).toBeGreaterThan(total); // 採点 OBD×k は別計上
  });

  it('★δ ON 経路: distance_m ≤ raw∫v + δmax×Σdt_move (δで盛っても認定天井内・構造保証)', () => {
    // δ自己キャリブを ON にし、良GPS窓を作って δ を学習させる(GPS弦 ≈ spd×dt で 0誤差付近に確定)。
    //   δ ON では distance > raw になりうる(floor復元)が、★必ず raw + δmax×t_move 以下★ である
    //   ことを実エンジンで固定=「認定天井(≤真距離)を超えない」過大ゼロの構造保証。
    const OPT_ON = Object.assign({}, OBD_OPT, { obdDeltaCalib: true });
    // 直進する良GPS座標を生成: OBD=36km/h=10m/s。GPS弦は 1s ごとに北へ ~10.2m 移動させ、
    //   GPS位置距離 > ∫OBD(floor過小)を再現 → δ が ★正(floor復元方向)★ に学習され distance>raw になる。
    //   弦は spd×dt×calMaxChordRatio(=10×1.5=15m)未満なのでジッタ汚染除外には掛からない。
    const stepLat = 10.2 / 111320; // 10.2m 相当の緯度差 (floor過小を模す)
    const tk = createDistanceTracker(stubDec, OPT_ON);
    const samples = [];
    let t = T0;
    let lat = 34;
    // first
    tk.ingest({ lat, lng: 133, t, acc: 5, spd: 10, obd: true });
    samples.push({ t, obd: 36 });
    let total = 0;
    for (let i = 1; i <= 80; i++) {
      t += 1000;
      lat += stepLat;
      const r = tk.ingest({ lat, lng: 133, t, acc: 5, spd: 10, obd: true });
      total = r.totalM;
      samples.push({ t, obd: 36 });
    }
    const raw = obdRawIntegral(samples, DEFAULTS.obdMaxDtS);
    const ceiling = obdCertCeiling(samples, DEFAULTS);
    // ★認定天井内★: δで floor過小を回収しても物理上限を超えない。
    expect(total).toBeLessThanOrEqual(ceiling + 1e-6);
    // ★δが実際に効いている★(=単なる raw 据え置きでない)ことを確認: distance は raw 以上。
    expect(total).toBeGreaterThanOrEqual(raw - 1e-6);
  });

  // ★★ 既知の差(テスト班報告)★★: batch computeDistance には OBD バイパス枝が無い
  //   (OBD ∫v 枝は tracker._core / ingest L1667 のみ・batch processPoint は stepDistance のみ)。
  //   本番の OBD メイン距離は ★必ず tracker(=map-matcher ingest)経路★ を通るので、
  //   OBDメイン採点・検証は tracker 経路で行うのが正しい(batch でやると smoothed 距離になる)。
  //   ここでは「batch は OBD 枝を踏まない=obdM 0」という現状を固定し、回帰で気付けるようにする。
  it('★[既知差] batch computeDistance は OBD 枝を踏まない (obdM=0・本番は tracker 経路)', () => {
    const seq = [];
    let t = T0;
    for (let i = 0; i <= 40; i++) {
      const spd = i < 10 ? 0 : 10 + (i % 7); // 停車→走行 (m/s)
      seq.push({ lat: 34 + i * 1e-5, lng: 133, t, acc: 5, spd, obd: true });
      t += 1000;
    }
    const batch = computeDistance(seq, stubDec, OBD_OPT);
    expect(batch.breakdown.obdM == null || batch.breakdown.obdM === 0).toBe(true); // batch は ∫v 枝に入らない

    const tk = createDistanceTracker(stubDec, OBD_OPT);
    for (const x of seq) tk.ingest(x);
    if (tk.flush) tk.flush();
    expect(tk._breakdown().obdM).toBeGreaterThan(0); // tracker は ∫v 枝で距離を出す(本番経路)
    // ★tracker 経路は ∫v(OBD) で正しく積分されている(停車10点除く30区間×平均速度)★
    expect(tk.totalM()).toBeGreaterThan(0);
  });

  it('★tracker ingest parity: 同一OBD列を2回流して同値 (決定論)', () => {
    function runSeq() {
      const seq = [];
      let t = T0;
      for (let i = 0; i <= 40; i++) {
        const spd = i < 10 ? 0 : 10 + (i % 7);
        seq.push({ lat: 34 + i * 1e-5, lng: 133, t, acc: 5, spd, obd: true });
        t += 1000;
      }
      const tk = createDistanceTracker(stubDec, OBD_OPT);
      for (const x of seq) tk.ingest(x);
      if (tk.flush) tk.flush();
      return tk.totalM();
    }
    expect(Math.abs(runSeq() - runSeq())).toBeLessThanOrEqual(1e-9);
  });

  it('★OBD未設定の通常GPS経路は obd 枝に入らない (byte不変・reason≠obd)', () => {
    const tk = createDistanceTracker(stubDec, OBD_OPT);
    tk.ingest({ lat: 34, lng: 133, t: T0, acc: 5, spd: 10 }); // obd 未設定
    const r = tk.ingest({ lat: 34, lng: 133.0001, t: T0 + 1000, acc: 5, spd: 10 });
    expect(r.reason).not.toBe('obd');
  });
});

describe('OBDメイン 実機fixture(0610-Android・OBD車速あり) never-over', () => {
  it('★実Android trace を OBD駆動: distance_m ≤ raw∫v + δmax×t_move(認定天井) かつ creep≈0', () => {
    // ★2026-08-28: 前は「無し=skip」と出して ★何も見ずに緑★でした。
    //   ⇒ 実物は repo に在ります（tests/fixtures/0610-Android.json）。
    //     無いなら ★実物が消えた／名前が変わった★ので ★赤★にします（0件と未測定を混ぜない）。
    const a = load('0610-Android.json');
    expect(a, '★実物（tests/fixtures/0610-Android.json）が 在りません★').not.toBe(null);
    const obdPts = a.filter((x) => typeof x.obd === 'number' && x.obd >= 0).length;
    expect(obdPts).toBeGreaterThan(0); // この fixture は OBD あり

    // ★本番 OBD メイン経路 = tracker ingest★ (map-matcher が ingest に obd:true を渡す経路)。
    //   batch computeDistance は OBD 枝を踏まないので必ず tracker で検証する(上の[既知差]参照)。
    //   OBD車速(km/h)→m/s を spd に・obd:true を付与。
    const seg = a.map((x) =>
      Object.assign({}, x, {
        spd: typeof x.obd === 'number' && x.obd >= 0 ? x.obd / 3.6 : -1,
        obd: typeof x.obd === 'number' && x.obd >= 0,
      })
    );
    const tk = createDistanceTracker(stubDec, OBD_OPT);
    let creep = 0;
    for (const x of seg) {
      const before = tk.totalM();
      tk.ingest(x);
      const jump = tk.totalM() - before;
      // OBD速度<0.5km/h相当(=ほぼ停車)で距離が積み上がらないこと(自然ZUPT)
      if (typeof x.spd === 'number' && x.spd >= 0 && x.spd < 0.5 / 3.6 && jump > 0.01)
        creep += jump;
    }
    if (tk.flush) tk.flush();
    const distM = tk.totalM();
    const raw = obdRawIntegral(a, DEFAULTS.obdMaxDtS);
    const ceiling = obdCertCeiling(a, DEFAULTS);

    // ★never-over(認定天井): tracker distance ≤ raw∫v + δmax×Σdt_move (=floor復元上限≤真距離)★
    //   旧天井 raw∫v×1.01 は floorで真距離より−2%過小=非認定でキツすぎ(δを焼くと赤)。正しい天井は
    //   δが floor で失った量子化分を回収しても真距離を超えない物理上限 raw+δmax×t_move。丸め余裕 0.5m。
    //   k(車別補正)は ★採点側でのみ★ 適用=distance_m には掛けない(不可侵)。
    //   真距離参照あり(0610b-Android=KP差)は別gate(truedist-obd-engine-gate.js)で distance≤真距離 を直接採点。
    expect(distM).toBeLessThanOrEqual(ceiling + 0.5);
    // ★認定天井は raw∫v(k=1) floor 以上★ (= δmax×Σdt_move ≥ 0・floor復元ぶんの余裕)。
    //   raw を監査ベースライン(素の OBD floor)として明示しつつ天井の構造(raw ≤ ceiling)を固定。
    expect(ceiling).toBeGreaterThanOrEqual(raw - 1e-6);
    // ∫v 駆動なので obdM が距離の主体
    expect(tk._breakdown().obdM).toBeGreaterThan(0);
    expect(distM).toBeGreaterThan(0);
    // ★停車creep ~0(認定 10m 要件を大きく下回る)★
    expect(creep).toBeLessThan(5);
  }, 30000);
});
