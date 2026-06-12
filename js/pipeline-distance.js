// ============================================================
// pipeline-distance.js  (ダイコメ 距離計算コア・白紙書き直し 第一弾)
//
// 確定方式: MM主 + Doppler従 + topology補間ハイブリッド
//   = 国交省認定ソフトメーター方式。
//   distance_m の意味論 = 「道路 snap 道なり累積」(GPS 直線課金は禁止)。
//
// このモジュールは「距離を算出するだけ」。calcFare 等の課金式は一切呼ばない。
//
// 入力 GPS sample 列 [{lat,lng,t,acc,spd}]
//   spd = coords.speed (m/s)。無ければ -1。
//   t   = epoch ミリ秒。
//
// 各点を RoadDecoder.snapToNearestRoad で道路 snap し、道なり距離を累積する。
//   - 連続 snap が同一道路   → RoadDecoder.calcRoadDistance の弧長 (onSameRoad)。
//   - 別道路間               → ★道路網 routing (簡易 Dijkstra) で「道なり距離」★。
//                              RoadDecoder には routing が無いため本モジュールで実装。
//                              過大ガード: routing距離 / 直線距離 > ROUTING_MAX_RATIO なら
//                              直線 (haversine) に fallback。
//   - snap 失敗 (null)       → Doppler 速度積分 ∫ spd dt で補間 (spd>=0 時)。
//                              spd 無ければ直線 (haversine)。
//
// 静止判定 (ZUPT 相当): spd < STATIONARY_SPD_MPS (≈0) なら加算 0 (creep 防止)。
//   ★spd 不明 (-1) 時の fallback★: 連続 2 点の haversine 変位が accuracy 由来の
//     閾値 (2σ ≈ acc 合成・最低 STATIONARY_DISP_MIN_M〜最大 STATIONARY_DISP_MAX_M) 未満なら
//     停車中 GPS ジッタとみなし加算 0 (creep 再発防止)。
//     MEMORY 方針「静止=GPS速度を主信号から外す・accuracy移動時緩和」に準拠。
//
// 速度源 pluggable: opts.speedProvider で速度源を差し替え可能。
//   既定 = GPS Doppler (sample.spd)。将来 OBD 車輪速度を差せる interface。
//   speedProvider(sample, prevSample) -> number (m/s)  ※負値 = 速度不明。
//
// module.exports = { computeDistance, RoadGraphRouter, gpsSpeedProvider, ... }
//   Node で実行可能 (tests/replay-pipeline-distance.js が実例)。
// ============================================================

'use strict';

// ─── 定数 ────────────────────────────────────────────────────
const EARTH_R = 6371000; // m
const DEG2RAD = Math.PI / 180;

// 既定パラメータ (opts で上書き可)
const DEFAULTS = {
  snapMaxDistM: 50, // snapToNearestRoad の maxDistM
  stationarySpdMps: 0.5, // これ未満の速度は静止 (ZUPT)・加算 0
  routingMaxRatio: 4.0, // routing距離/直線距離 がこれ超なら直線 fallback (過大ガード)
  // ★過大ゼロ de-bias (2026-06-06・★設計変更宣言★・実機0606+realtest3 全fixture検証で確定)★
  //   別道路 routing の ★受理★ 上限比。routed/straight がこれ超 = ノイズGPSで隣道/対向へ flip し
  //   迂回路を拾った過大 → 受理せず連結性ハード拘束(前道路へ再snap)/直線へ落とす。
  //   実機0606: iPhone13 trip2 が routed=647m で +2.74% 過大化(Android489/SE431 比 +150〜200m)。
  //   ★routingMaxRatio(=4.0) と分離した理由★: routingMaxRatio は Doppler/coast/gap-fill の
  //   never-over ガードにも使われ、これを一律 4.0→2.5 にすると しまなみ等トンネル/GPS穴の
  //   coast fill まで絞られ過小化する恐れ。本パラメータは ★routing 受理(下記 L 参照)のみ★ に
  //   作用させ never-over ガードは 4.0 のまま温存する(= 都市部fixtureに無いトンネル路を保護)。
  //   検証(全14業務・愛媛): 4.0=過大4(max+2.74%)/過小0 → 2.5=★過大0/過小0(worst -2.61%)★。
  //   ★捨てすぎ禁止に準拠★: 生GPS/sameRoad弧/coast は不変・routing迂回の過大分だけ除去。
  routingAcceptMaxRatio: 2.5,
  routingMaxNodes: 4000, // Dijkstra 展開ノード上限 (暴走ガード)
  routingSearchGrids: 3, // routing 用に getRoadsNear する周辺グリッド半径
  // ★交差点接続率★ 道路頂点を node 化する際の量子化。
  //   precision=1e5 だと 1 単位 = lat≈1.11m / lng≈0.92m → round(lat*1e5) は no-op で
  //   完全一致頂点しか交差点接続できず別道路 route 失効 (= 直線 fb 増・距離欠損)。
  //   33333 だと bucket = lat≈3.3m / lng≈2.8m。OSM 交差点の頂点は通常同一座標だが、
  //   分割道路 (車線分離・端点ズレ) を ~3m 許容でクラスタ化し接続率を上げる。
  nodeQuantize: 33333,
  perSegmentMaxM: 2000, // 1 区間でこの距離超は異常として直線 fallback
  routingMaxStraightM: 600, // 直線距離がこれ超の別道路区間は routing せず直線 (遠距離=gap)

  // ★spd 不明 (-1) 時の変位ベース静止 fallback (creep 防止)★
  // 停車中の phone は accuracy 規模のジッタを出す。連続 2 点の独立誤差合成
  //   (= √(accPrev²+accCur²)) の 2σ までを「移動ではなくジッタ」とみなし加算 0。
  stationaryDispMinM: 3.0, // 変位がこれ未満なら spd 不明でも無条件で静止扱い (床値)
  stationaryDispMaxM: 40.0, // accuracy 由来閾値の上限 (acc 巨大時でも過剰緩和しない天井)
  stationaryAccSigma: 2.0, // 変位閾値 = 連続2点 acc を合成した σ × この係数
  stationaryAccM: 30.0, // acc 無し/無効点の既定 accuracy (m)

  // ★Fix④ gap-garbage guard (2026-05-31・★設計変更宣言★・iPhone13 creep+jump 根治・never-over)★
  //   実機 iPhone13: 79 秒の GPS 穴の後、accuracy 1082m のゴミ位置 (実は停止中) へ 470m 飛び、
  //   さらにそのゴミ点から実道路へ戻る 798m の弦が出る。穴中は spd 不明 (-1) で coast/straight が
  //   この弦を加算 → ★停止/ゴミ位置由来の 470m creep + 798m jump (過大課金)★。
  //   対策: 区間の ★どちらかの端点★ の accuracy がゴミ (> gapGuardAccM) なら、その位置は信用
  //   できず ★距離を作らない★ (return 0)。入口/出口 両方向のゴミ弦を遮断する。
  //   never-over 専用 (距離を増やさない方向のみ)。良精度の穴脱出 (トンネル等) は従来通り加算。
  //   実機調査: Android(maxAcc 10m)/SE(maxAcc 30m) は acc>gapGuardAccM 点が ★ゼロ★ → 両端末
  //   完全不変。発火は iPhone13 のゴミ点に接する 2 区間のみ。
  gapGuardAccM: 100, // 端点 accuracy がこれ超 = ゴミ位置 → 弦を加算しない (移動上限 acc 35m の十分上)
  // ★Fix④ parked-gap guard (2026-05-31・iPhone13 creep 根治・never-over)★:
  //   長い GPS 穴 (dt > gapStationarySec) を ★停止状態で入った★ (穴入口点 prev.spd が
  //   停止 < stationarySpdMps) 場合、穴中の位置ドリフトは「駐車中の GPS drift」であり実走行では
  //   ないので ★距離を加算しない★。実機 iPhone13: 停止中 (spd≈0.04) に入った 112s/144s の穴で
  //   58m/42m の drift が stationaryDispMaxM(40m) 天井を超え creep 計上されていた事象を遮断。
  //   Android/SE は「停止で入る 30s 超の穴」が ★ゼロ★ → 完全不変。
  //   never-over 専用。穴を ★走行中★ (prev.spd >= stationarySpdMps) に入った場合は対象外
  //   (= トンネル等の実走行穴は従来の coast/routing で正常加算・不変)。
  gapStationarySec: 30, // この秒超の穴を「長い穴」とする (通常 1Hz・短欠落は対象外)

  // ★地力 de-bias: 同一道路 arc 回収 (2026-06-04・★設計変更宣言★・実データ検証で確定)★
  //   実機 realtest3 業務別の事実: 生GPS(連続点 haversine)は タイヤ比 −1.1%〜+0.8%・端末差≤34m
  //   と ★最も正確かつ端末一致★。一方 map-matching の道路中心線 arc は カーブ/車線オフセット/
  //   OSM polyline 粗さ + ジッタ除去で systematically 約1.5〜2%過少 (長距離ほど大・業務3で約200m)。
  //   この過少は gap/straight の一塊ではなく ★per-segment の同一道路 arc 全体に薄く分散★。
  //   対策 = ★一律係数でなく地力 de-bias★: 同一道路区間で「生の弦 straight」が arc を上回り、かつ
  //   ★実走行ゲート (精度OK + 移動中 + 速度整合 + 弦/arc 比が普通走行域)★ を通った時のみ、
  //   弦まで回収する。幻GPS の off-road ジャンプ (弦≫arc=比超過 / 速度不整合 / 精度悪) は
  //   ゲートで弾き ★過大ゼロを死守★。低速/停止/穴は対象外 (creep 安全)。デバイス分岐なし。
  //   ★never-over 保険★: arcRecoverDopplerCap=true で recovery を ★min(弦, spd×dt)★ に抑える
  //   (Doppler は真値以下に出るため総距離 ≤ ∫v ≤ タイヤ)。false なら弦まで (raw 相当・端末一致優先)。
  arcRecover: true, // 同一道路 arc 回収を有効化 (OFF=従来 byte 完全等価)
  arcRecoverMaxRatio: 1.4, // 弦/arc がこれ超 = 幻/外れ snap → 回収しない (普通走行は ~1.05)
  arcRecoverMaxAccM: 30, // 両端点 accuracy がこれ超 = 位置不確か → 回収しない (実走行ゲート)
  arcRecoverMaxDtS: 5, // dt がこれ超 = 穴/間引き → 回収しない (通常 1Hz)
  arcRecoverMinSpdMps: 1.5, // spd がこれ未満 = 低速/停止/不明 → 回収しない (creep/ジッタ安全)
  arcRecoverSpeedRatio: 1.5, // 弦 > spd×dt×これ = 速度に対し弦過大 (幻ジャンプ) → 回収しない
  // ★速度条件付き回収 (物理的根拠)★: 高速 (>= arcRecoverRawAboveSpdMps) では GPS ジッタが
  //   走行距離に対し相対的に小さく ★生の弦が最も正確★ (realtest3: 高速主体の長距離で raw≈−0.5%)
  //   → 弦まで回収。低速 (< これ) では ジッタが距離を水増しするため ★Doppler 実測 (spd×dt) を
  //   天井★ にして過大ゼロを死守 (短距離 urban で raw が +0.8% 過大化するのを防ぐ)。
  arcRecoverRawAboveSpdMps: 8.0, // ≈29km/h。これ以上は弦回収・未満は Doppler cap

  // ★OBD メインモード (2026-06-05)★: 速度源が OBD 車輪速度の時、距離を ∫v(OBD)=spd×dt で駆動。
  //   dt がこれ超 = 異常欠測 → その区間は加算しない(過大ゼロ保険・通常 1Hz polling なら無関係)。
  //   ★OBD は smoothedRawMode より優先 (∫v=タイヤ直結・認定メーター方式)。speedSrc==='obd' 時のみ発火。★
  obdMaxDtS: 10,

  // ★★stop-in-hole creep ガード (2026-06-10・監査 P0 根治・never-over)★★:
  //   背景: gps.js _gapTick の合成 coast 点 (synthetic) は GPS 穴中に「直前速度 ×0.97/s 減衰」を
  //   speed×dt で連続積分する。これは ★走行中★ の穴 (トンネル) では正しい (二葉方式) が、
  //   ★穴の中で物理的に停車★ (信号/渋滞でトンネル内停止) した場合、保守ホールド速度が
  //   COAST_MIN_KMH(0.5km/h≈0.139m/s) まで減衰するのに 0.97/s では ~120-160s かかり、その間
  //   phantom +166〜530m (40km/h進入で実測+347.5m/144s) が distance_m に乗る。認定 creep
  //   <10m/30s を約35倍超過 = 過大ゼロ(never-over)違反。本ガードは synthetic coast 専用の多層防御:
  //     (a) ★1穴あたりの累積 coast 時間上限★ (coastHoleMaxSec)。これ超で前進停止 (= 停車是認・凍結)。
  //         穴入口で時計をリセットし、非 synthetic 点 (実 GPS 復帰) で解除する。
  //     (b) ★1穴あたりの累積 coast 距離 cap★ (coastHoleMaxM)。これ超で前進停止 (距離側の硬い天井)。
  //     (c) 合成速度が ★creep 速度域★ (< coastFreezeSpdMps) に減衰したら以後その穴は前進停止
  //         (= 減速→停車を検出。0.97 減衰の長い裾を creep として積分しない)。
  //   OBD 接続時は車輪速度が停車で正しく 0 になりガード不要のため ★非OBD synthetic のみ★ に作用。
  //   never-over 専用 (距離を増やさない方向のみ)。走行継続中の通常トンネル穴 (時間/距離が cap 内) は
  //   従来通り speed×dt で正常 fill = トンネル連続前進は不変。
  coastHoleMaxSec: 25, // 1穴あたり合成 coast を許す累積秒数 (認定 creep<30s 内・超過で凍結)
  coastHoleMaxM: 600, // 1穴あたり合成 coast を許す累積距離 m (高速トンネル ~80km/h×25s=556m を内包・超過で凍結)
  coastFreezeSpdMps: 2.5, // 合成ホールド速度がこれ未満に減衰=減速停車とみなし以後その穴は前進停止 (≈9km/h)
  // ★pipeline backstop の限界★: pipeline には加速度が無いため、減速停車は「合成速度の減衰」でしか
  //   検出できず、freeze 閾値到達までの短い積分 (decay 0.92 で 40km/h→2.5m/s に ~16s = 約88m) は残る。
  //   ★本物の creep 根治は gps.js の加速度分散 ZUPT★ (停車を即検出して合成送信自体を止める) であり、
  //   pipeline cap は「ZUPT 取りこぼし時に 347m 級暴走を 100m 未満へ抑える never-over backstop」。

  // ★OBD δ 自己キャリブ (2026-06-09・OBD floor 過小 -2.9% 補正・アダプタ非依存)★:
  //   OBD車速(PID 010D)は 1km/h 整数 floor のため ∫v が系統過小(-2.9%・実機トレース)。
  //   ★良GPS区間で δ=(GPS位置距離 − ∫OBD)/移動時間 を学習★ し、∫(v+δ) を GPS位置距離(≈タイヤ以下)へ
  //   寄せる。δ は ±obdDeltaMaxMps(=0.139m/s=0.5km/h・floor量子化の物理上限)にクランプ=ハードコード
  //   加算でなく観測学習なので「どのアダプタ/車でも」効く(司さん指摘: 何を買うか分からないのに足すな)。
  //   OFF(obdDeltaCalib!==true)で従来 ∫v そのまま(byte不変)。distance_m/calcFare 不可侵。
  // ★★出荷有効化 (2026-06-11・司さん確定方針「認定が通ってるものから丸写し」)★★:
  //   これは ★認定メーター(計量法JIS D5609/国交省ソフトメーター・矢崎/二葉/岡部)の計算法そのもの★:
  //     距離 = 車速パルス(車輪回転)積算 ÷ 車両定数K、K は基準巻尺/ローラーの真距離に指示距離を
  //     合わせ込んで ★距離に焼く★(過大ゼロ=片側公差 −4%〜0% を K で担保)。
  //   ダイコメ写像: 距離源=OBD車輪速度∫v(認定の「走行信号」と同土俵=PID010D車輪速度直結)、
  //     K相当=δ。δを ★distance_m に直接焼く★(total += obdDelta・別計上でない)=認定の pulse×K と同型。
  //   ★過大ゼロは構造保証★: δ∈[-0.139,+0.139]m/s=±0.5km/h=OBD車速1km/h floor量子化の物理上限。
  //     δ最大でも「floorで失った量子化誤差ぶんの回収」しかできず真距離を超えられない(認定の保守側校正)。
  //   ★プラスα(ダイコメのデータ優位)★: 認定はワンショット基準走行(基準巻尺コース)で校正→固定。
  //     ダイコメは全業務の良GPS区間で連続的にδを再学習(EWMA・公知のスケール係数連続校正一般手法のみ・
  //     特許実装は写さない)=タイヤ摩耗/空気圧/車両差をオンライン追従。
  //   実証(tests/truedist-obd-engine-gate.js・0610b-Android KP真距離): δ OFF -2.11%/-2.38% →
  //     ON -1.12%/-1.51% = 過大ゼロ維持(≤真距離)のまま誤差 ~1pt 改善・obdSegs=2485 実発火。
  //   ★cur.obd===true 区間のみ作用★ = GPS経路(OBD未接続/iPhone)は δ 非作用で byte不変(L1735ゲート)。
  //   OFF へ戻すのはこの 1 行のみ (rollback)。
  obdDeltaCalib: true, // δ自己キャリブ有効化 (1行ON/OFF・rollback用)
  obdDeltaMinMps: -0.139, // δ下限 (-0.5km/h・OBD過大読み端末対策)
  obdDeltaMaxMps: 0.139, // δ上限 (+0.5km/h・floor過小補正の物理上限=never-over)
  calMinWindowS: 30, // この秒数の良GPS移動を貯めて δ を1回確定 (業界標準の dwell)
  calMaxChordRatio: 1.5, // GPS弦 > spd×dt×これ = ジッタ汚染窓 → δ母集団から除外
  calMaxAccM: 30, // 両端 accuracy これ超 = 位置不確か → δ母集団から除外 (良GPS窓のみ学習)
  calEwmaOld: 0.7, // δ 平滑 (旧値重み・急変を抑え安定化)
  calEwmaNew: 0.3, // δ 平滑 (新窓重み)

  // ★生GPS 双方向スムージング距離 (2026-06-06・★設計変更宣言★・司さん裁定「生GPS寄せ+過大対策」)★
  //   実データ検証(0606b/realtest3/しまなみ・全fixture)で確定した距離の正解:
  //   生GPS の軌跡を ★双方向移動平均(window)★ で平滑してから弦長を測る。ジッタを ★対称に★ 削るため
  //   per-segment 床(Doppler/生GPS弦)のような ★上側ノイズだけ拾うラチェット過大化が起きない★。
  //   結果: 生GPS のジッタ過大(iPhone13 +0.99%・realtest3短距離+0.5〜0.8%)が消えてタイヤ以下に収束し、
  //   かつ map-matching の過少(Android -2.57%)も埋まる。全fixtureで ★過大ゼロ + 精度 -0.3〜-1.4%★。
  //   ★平滑弦 ≤ 生弦 (平滑は短縮方向)・生弦 ≈ タイヤ★ なので構造的に過大ゼロ側。
  //   温存: ①停止 creep (stationary 判定は生 spd/acc で従来通り) ②トンネル/GPS穴 (長dt は平滑弦で角を
  //   切らず従来の Doppler/coast fill に回す) ③gap-guard (ゴミ acc は従来通り)。
  //   live meter は smoothWindow/2 サンプル遅延の双方向窓で実装 (createDistanceTracker)。
  //   OFF (smoothedRawMode !== true) で従来 map-matching 距離に完全復帰 (1byte 不変)。
  //   ★出荷有効化 (2026-06-07)★: 5次元監査 (CRITICAL-1/2/3 根治) + batch==tracker+flush parity
  //   diff 0.0000 + 全fixture過大ゼロ実証済 → true 化。flush 配線は map-matcher.js 'reset' handler
  //   (回帰: tests/integration/smoothed-flush-on-reset.test.js)。OFF へ戻すのはこの 1 行のみ。
  smoothedRawMode: true,
  // ★過大ゼロ de-bias 確定 (2026-06-08・実機14業務 sweep)★: 窓は h=floor((win-1)/2) で効く。
  //   win=5(h=2) は平滑が強く カーブ角を削り過ぎて 系統 −2.0% 過小 (平均)。win=3(h=1) に下げると
  //   カーブ回収で 平均 −2.02%→−1.42%・最大過大 −1.52%→−0.33% と ★過大ゼロを保ったままタイヤへ接近★。
  //   win=2 相当(h=0)=生GPS弦=良GPSで +1% 過大化のため不可。creep ガード(ZUPT/cap)は生 spd/変位で
  //   判定するため窓非依存 (win3/win5 で creep 0.00m 同値・実証済)。検証: tests/_sweep-debias.js。
  smoothWindow: 3, // 移動平均窓。h=(win-1)/2 点の双方向平均。実機 sweep で 3 が過大ゼロ&最接近。
  smoothGapSec: 5, // dt がこれ超 = GPS穴/間引き → 平滑弦で角を切らず Doppler/coast へ回す (トンネル温存)
  smoothDopplerCapRatio: 1.5, // ★never-over (監査CRITICAL-3)★: 平滑弦 > spd×dt×これ なら抑制。
  //   微速(停止判定を僅かに外れる0.5〜1m/s)の純ジッタが平滑弦に残り creep 化するのを遮断。通常走行は
  //   平滑弦 ≤ 実路長 ≈ spd×dt なので 1.5 倍までは binding せず無影響 (curve 余裕込み)。

  // ★★両端速度 台形補間 穴埋め(公知: linear-velocity trapezoid) (2026-06-10・GPS実装班・公知手法)★★:
  //   smoothedRawMode の長dt穴 (dt>smoothGapSec=トンネル/間引き) は従来「入口速度×dt」(片端 Doppler)
  //   で埋めていた。これは穴の ★入口の点速度だけ★ で全区間を等速外挿するため、穴中に車が加減速すると
  //   出口で帳尻が合わずドリフトする (入口高速→出口減速で過大、入口低速→出口加速で過少)。
  //   ★両端速度台形補間(公知 Newton-Cotes)の核★: 穴を ★入口GPS + 出口GPS の両端に拘束★ し、その間の運動を
  //   最小二乗 min‖Dv−a‖² (= 最小加速度 = 区間内一定加速度) で復元する。1区間に対する両端拘束の
  //   厳密解は ★台形積分★ (v0+v1)/2 × dt (= 入口速度 v0 と 出口速度 v1 の平均速度 × dt)。
  //   これにより ★出口で速度が帳尻★ し片端外挿のドリフトが消える。入口のみ外挿に比べ ★過大に伸びにくい★
  //   (出口減速を必ず織り込むため)。両端 GPS が無い (どちらか spd 不明) 穴は従来の片端式に退避。
  //   ★never-over 維持★: 台形 fill にも従来同様 (1)実測弦 straight 天井 (2)routingMaxRatio 倍ガード を
  //   かけ、distance ≤ 実変位 を死守する (両端拘束は構造的に過大側へ出ないが、保険として温存)。
  //   ★実データ注記 (2026-06-10)★: 0610b-Android は業務内に穴が ★無い★ (全区間 smoothed 弦) ため
  //   本枝は発火せず 0610b の数値は完全不変。効果はトンネル/間引きを含む trace (iPhone13 の 79s 穴等)
  //   と将来の実走で出る。OFF (boundaryGapFill!==true) で従来の片端 spd×dt に完全復帰 (byte 不変)。
  //   ★本番既定=OFF (2026-06-11)★: 台形穴埋めは未実機検証 + 減速途中で出口 spd が入口より
  //     高い瞬間に台形平均が片端式を上回り過大化する余地 (合成 trace で +31% 観測) があるため、
  //     過大ゼロ死守を優先し ★既定 false★。安全な片端 spd×dt フォールバックが走る (byte 不変)。
  //     実走トンネル trace で過大ゼロを実証してから flip する (機構はテスト温存)。
  boundaryGapFill: false, // 両端アンカー(台形)穴埋め。既定OFF=従来 入口速度×dt (過大ゼロ安全)。

  // ★★STEP B: トンネル出口アンカー道路 routing 充填 (2026-06-12・長トンネル過少 -1.25% 回収)★★
  //   長穴 (トンネル) は両端 GPS が tunnel entrance/exit でロード上にある。両端の ★生座標★ を道路 snap し
  //   道路網 routing の ★道なり弧長★ で穴を埋める。幾何: chord ≤ 道路中心線弧 ≤ 実走経路 → never-over。
  //   実証 (shimanami): iPhone13 +411m / Android +390m / SE +132m。出口アンカー routing は文献/特許/
  //   認定メーターで距離回収の正解 (memory: copyable_research)。発火は dt>smoothGapSec の長穴のみ。
  //   ★never-over 多段サニティ (下記 stepDistance 参照)★: rawChord×0.9 ≤ routed ≤
  //     rawChord×routingAcceptMaxRatio(2.5) かつ routed ≤ tunnelRouteMaxM かつ routed ≤ spd×dt×routingMaxRatio。
  //   どれか外れたら従来の boundary/doppler fill に落ちる (純加算回収=安全)。OFF で 1byte 不変。
  //   ★batch(computeDistance)/tracker(createDistanceTracker) は同一 stepDistance を通るため parity 構造保証★。
  tunnelRouteFill: true, // 長穴を出口アンカー道路 routing で充填 (既定 ON・never-over サニティ付き)。
  tunnelRouteMaxStraightM: 3000, // rawChord がこれ超の長穴は routing せず従来 fill (遠距離=道路網外れ防止)。
  tunnelRouteMaxM: 3500, // routing 結果がこれ超なら採用しない (絶対上限・過大暴走遮断)。

  // ★★確定方式: GPS精度で2択 適応モード (2026-06-09・実トレース実証)★★
  //   司さん確定方針(2026-06-08「GPS良時=生GPS弦、悪時/穴=速度×時間、止まれば数えない」)を
  //   今日の実車2業務(タイヤ6.73/17.71・トンネル含む)で実証し実装。平滑/map-matching は廃止。
  //   ① GPS良好(穴でない通常区間): 距離 = ★3D生GPS弦★(高度込み) を spd×dt×cap で頭打ち(ジッタ過大除去)。
  //   ② GPS穴(dt>holeDtSec=トンネル/欠落) or 劣化(acc>accBadM=ビル街): 距離 = ★速度×時間★
  //      (速度源= speedProvider が返す OBD較正速度 or Doppler。位置ジッタに免疫)。
  //   停止(ZUPT)は呼び出し側 stationary 判定で従来通り 0。never-over= ①cap + ②速度は過小側 + ZUPT。
  //   実測(realtrace-0609-Android-OBD): 業務1 -0.53% / 業務2 -0.33%(トンネル25秒穴を②が+90m回収)。
  //   OFF(adaptiveMode!==true)で完全 byte 不変。distance_m/calcFare 不可侵。
  // ★★adaptiveMode 出荷打ち切り(2026-06-09・cert-gate非互換と確定)★★:
  //   硬化(MODE②を真の穴dt>holeDtSec限定)してもcert-gate劣化シナリオで 停車creep263m+過大3.85%+
  //   coast分岐未発火 が残る。原因=MODE②がdt1.8〜5s穴で生弦を返す＋coast/parkedガードをバイパスする構造。
  //   通すには holeDtSec=5(=smoothedRawMode同一)に戻すしかなく独自利得ゼロ。トンネル回収も smoothedRawMode が
  //   dt>5s穴のDoppler充填で既に実施。★∴ 認定済 smoothedRawMode が距離方式・adaptiveMode は ON禁止(cert非互換)。
  //   タイヤ精度向上の本筋は 精密Viterbi弧長(A1)/車両別較正k(B1) であって adaptiveMode ではない★。
  adaptiveMode: false, // ★出荷打ち切り(cert非互換・ON禁止)。距離方式は smoothedRawMode。実験としてflag温存。
  //   ★効果(実トレース・3D OFF): OBD全駆動の-3.86%バグを止め GPS平滑+穴埋めへ→業務2 -1.46%(過大ゼロ)。
  //     トンネル25秒穴を speed×dt で +306m 回収。愛媛14業務 過大0件。生GPS弦は愛媛で+1.9%過大化(過大請求)
  //     のため不採用=過大ゼロを守る限り平滑土台が必須(-1.5%が底)。
  mode3D: false, // ★GPS alt 3D は noise で過大化(愛媛 Androidt3 -0.33→+0.60%)→既定OFF。DEM標高が入れば有効化★
  holeDtSec: 1.8, // dt がこれ超 = GPS穴(トンネル/欠落) → ②速度充填へ
  accBadM: 15, // accuracy がこれ超 = GPS劣化(ビル街) → ②速度充填へ
  adaptiveCapRatio: 1.5, // ①の never-over: 3D弦 ≤ spd×dt×これ。走行ジッタ過大を物理上限で叩く
  maxClimbMps: 8, // 3D高度ゲート: |Δalt|/dt がこれ超 = GPS altノイズ → Δalt=0(正ラチェット過大を遮断)
};

// ─── 幾何ヘルパ ───────────────────────────────────────────────
function haversineM(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLng = (lng2 - lng1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

// ─── 生GPS 双方向スムージング (位置の前処理) ────────────────────────────
// pts (t 昇順) の各点 lat/lng を ±(window-1)/2 の近傍点で移動平均し、ジッタを対称に除去する。
//   acc/spd/t/snap は ★生のまま保持★ (停止判定・gap-guard・速度は生信号を使う)。
//   ★gap 跨ぎは平滑しない★: 隣接点の dt が gapSec 超 (GPS穴/間引き) ならそこで窓を打ち切り、
//   穴の両端の位置を混ぜて歪めない (トンネル前後の角を保つ)。
//   ★bad-acc 除外 (監査 CRITICAL-2)★: acc > badAccM (ゴミ fix) の隣接点は平均母集団から除外する。
//   これを怠ると停止中の acc=数百m ゴミ点が良精度の隣接点を引っ張り、その区間が gapGuard を素通りして
//   phantom creep (実測2082m) を生む。ゴミ点自身は acc 生保持のため下流 gapGuard が従来通り処理。
//   平滑弦は生弦以下 (短縮方向) になるため構造的に過大ゼロ側。
// ★per-point 平滑 (batch / live tracker 共有・唯一の真実)★:
//   pts[i] を ±h の近傍点で移動平均した点を返す。dt>gapMs(穴)で窓を打ち切り、acc>badAcc(ゴミ)を除外。
//   ★batch(_smoothPositions) と live(createDistanceTracker) が ★同一関数★ を呼ぶことで 1点ズレ無く
//   parity を保証する (監査 CRITICAL-1 指摘「コピペ再実装禁止」)。
function _smoothOnePoint(pts, i, h, gapMs, badAcc) {
  const isBad = function (p) {
    return typeof p.acc === 'number' && p.acc >= 0 && p.acc > badAcc;
  };
  let la = pts[i].lat;
  let ln = pts[i].lng;
  let n = 1;
  // 後方近傍 (dt gap で打ち切り・bad-acc は除外)
  for (let j = i - 1; j >= 0 && j >= i - h; j--) {
    if (Math.abs((pts[j + 1].t || 0) - (pts[j].t || 0)) > gapMs) break;
    if (isBad(pts[j])) continue; // ゴミ点は母集団から除外 (汚染防止)
    la += pts[j].lat;
    ln += pts[j].lng;
    n++;
  }
  // 前方近傍 (dt gap で打ち切り・bad-acc は除外)
  for (let j = i + 1; j < pts.length && j <= i + h; j++) {
    if (Math.abs((pts[j].t || 0) - (pts[j - 1].t || 0)) > gapMs) break;
    if (isBad(pts[j])) continue; // ゴミ点は母集団から除外 (汚染防止)
    la += pts[j].lat;
    ln += pts[j].lng;
    n++;
  }
  const s = pts[i];
  // 位置のみ平滑・他フィールドは生保持。元の生座標も _rawLat/_rawLng で保持 (監査/将来用)。
  return {
    lat: la / n,
    lng: ln / n,
    t: s.t,
    acc: s.acc,
    spd: s.spd,
    alt: s.alt, // ★3D用: 高度は生保持(位置のみ平滑)★
    obd: s.obd, // ★OBD速度/フラグ貫通(adaptiveMode の速度源)★
    snap: s.snap,
    _rawLat: s.lat,
    _rawLng: s.lng,
  };
}

// 窓パラメータ正規化 (batch/tracker 共有)。{ h, gapMs, badAcc } を返す。
function _smoothParams(cfg) {
  const w = cfg.smoothWindow >= 3 ? cfg.smoothWindow : 3;
  return {
    h: Math.floor((w - 1) / 2),
    gapMs: (cfg.smoothGapSec > 0 ? cfg.smoothGapSec : 5) * 1000,
    badAcc:
      typeof cfg.gapGuardAccM === 'number' && cfg.gapGuardAccM > 0 ? cfg.gapGuardAccM : Infinity,
  };
}

function _smoothPositions(pts, window, gapSec, badAccM) {
  const h = Math.floor(((window >= 3 ? window : 3) - 1) / 2);
  const gapMs = (gapSec > 0 ? gapSec : 5) * 1000;
  const badAcc = typeof badAccM === 'number' && badAccM > 0 ? badAccM : Infinity;
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    out[i] = _smoothOnePoint(pts, i, h, gapMs, badAcc);
  }
  return out;
}

// ─── 速度源 (pluggable) ──────────────────────────────────────
// 既定 speedProvider: GPS Doppler。sample.spd (m/s) をそのまま返す。
// 無効値 (undefined/null/NaN/負) は -1 (= 速度不明) を返す。
function gpsSpeedProvider(sample /*, prevSample */) {
  if (!sample) return -1;
  const s = sample.spd;
  if (typeof s !== 'number' || isNaN(s) || s < 0) return -1;
  return s;
}

// 将来 OBD 車輪速度などを差す例 (interface の参考):
//   function obdSpeedProvider(sample) { return sample.obdSpeedMps != null ? sample.obdSpeedMps : -1; }

// ─── 静止判定ヘルパ (変位 / accuracy ベース・spd 不明時の creep 防止) ──────
// sample.acc (= GPS 水平精度 m) を読む。無効値は既定 acc を返す。
function readAcc(sample, fallbackM) {
  if (!sample) return fallbackM;
  const a = sample.acc;
  if (typeof a !== 'number' || isNaN(a) || a < 0) return fallbackM;
  return a;
}

// spd 不明 (-1) 時の静止 fallback 判定。
//   連続 2 点の haversine 変位 disp が、両点の accuracy を合成した
//   2σ 閾値 (床=stationaryDispMinM・上限=stationaryDispMaxM) 未満なら true (= 静止/ジッタ)。
//   返り値 true → 当該区間は加算 0 (creep 防止)。
function isStationaryByDisplacement(prev, cur, disp, cfg) {
  // 両点の accuracy を合成 (独立誤差の二乗和平方根)
  const accPrev = readAcc(prev, cfg.stationaryAccM);
  const accCur = readAcc(cur, cfg.stationaryAccM);
  const sigma = Math.sqrt(accPrev * accPrev + accCur * accCur);
  let thr = cfg.stationaryAccSigma * sigma;
  if (thr < cfg.stationaryDispMinM) thr = cfg.stationaryDispMinM;
  if (thr > cfg.stationaryDispMaxM) thr = cfg.stationaryDispMaxM;
  return disp < thr;
}

// ★L2 連結性ハード拘束ヘルパ (decoder 直叩き版)★:
//   (lat,lng) を ★指定 roadIndex の道路ポリライン★ にだけ投影し snap 結果を返す (or null)。
//   別道路への偽遷移 (flip) を棄却するため「現点を前点の道路に投影し直すと maxDistM 内に乗るか」
//   を判定する。乗れば「実際は同一道路の連続走行・snap が隣道へ flip しただけ」= 道なり弧長で算出。
//   投影式は decoder._searchSnap / SnapCache.snap と byte 等価。snapper 有無に依らず使える。
function snapPointToRoad(decoder, lat, lng, roadIndex, maxDistM) {
  const road = decoder.decodeRoadAt(roadIndex);
  if (!road || !road.points || road.points.length < 2) return null;
  const prec = decoder.precision || 1e5;
  const mpd = metersPerDegree(lat);
  const mpdLat = mpd.lat;
  const mpdLng = mpd.lng;
  const maxSq = maxDistM * maxDistM;
  const pts = road.points;
  let bestSq = Infinity;
  let bSeg = -1,
    bT = 0,
    bLat = 0,
    bLng = 0;
  for (let j = 0; j < pts.length - 1; j++) {
    const aLat = pts[j][0] / prec;
    const aLng = pts[j][1] / prec;
    const bLatp = pts[j + 1][0] / prec;
    const bLngp = pts[j + 1][1] / prec;
    const ax = (aLng - lng) * mpdLng;
    const ay = (aLat - lat) * mpdLat;
    const bx = (bLngp - lng) * mpdLng;
    const by = (bLatp - lat) * mpdLat;
    const abx = bx - ax;
    const aby = by - ay;
    const ab2 = abx * abx + aby * aby;
    let t;
    if (ab2 < 1e-9) t = 0;
    else {
      t = (-ax * abx + -ay * aby) / ab2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const sx = ax + t * abx;
    const sy = ay + t * aby;
    const dsq = sx * sx + sy * sy;
    if (dsq < bestSq) {
      bestSq = dsq;
      bSeg = j;
      bT = t;
      bLat = aLat + t * (bLatp - aLat);
      bLng = aLng + t * (bLngp - aLng);
    }
  }
  if (bSeg < 0 || bestSq > maxSq) return null;
  return {
    roadIndex: roadIndex,
    segmentIndex: bSeg,
    t: bT,
    snapLat: bLat,
    snapLng: bLng,
    distanceM: Math.sqrt(bestSq),
    typeCode: road.typeCode,
  };
}

// 緯度経度差をメートル換算する係数 (decoder._searchSnap と同一式・平面近似)
function metersPerDegree(refLat) {
  const toRad = Math.PI / 180;
  return {
    lat: 111132.954 - 559.822 * Math.cos(2 * refLat * toRad) + 1.175 * Math.cos(4 * refLat * toRad),
    lng: 111319.488 * Math.cos(refLat * toRad),
  };
}

// ─── SnapCache (★性能★ snap候補キャッシュ + grid展開snap) ─────────────────
// 監査官 major #1「routing ~5ms/点」の真因は計測の結果 snapToNearestRoad だった
//   (snap-only で seg1 の ~96% 時間)。decoder.snapToNearestRoad は radiusGrids=5→9 の
//   フォールバックで毎回 121〜361 グリッドの全道路を decode + 全 segment 投影する。
//   seg1 1582 点は実測 7 グリッドセルにしか入らず、cell 単位 decode は完全に冗長。
//
// 本クラスは decoder を一切改変せず、以下で同一 snap 結果を再現しつつ高速化する:
//   (1) cell 単位 decode キャッシュ … grid セル "gy_gx" → decode 済み road 配列を 1 回だけ。
//   (2) 展開リング探索 … 中心セルから外側へ 1 リングずつ走査し、maxDistM 以内の snap を
//       見つけたら「+1 リング(境界の取りこぼし防止)」で停止。decoder の固定 r=5→9 全走査と
//       異なり、近傍で当たれば数セルで確定。roads は通過全グリッドに登録されているため
//       (実データで radiusGrids=1 が default と完全一致を確認済) リング展開で同一結果。
//   投影式・t クランプ・距離判定は decoder._searchSnap と byte 等価 (実 trace で
//   1582/1582 一致を確認済)。distance_m 意味論は不変。
//
// fallbackMaxRing: maxDistM 以内が見つからない真の miss 時の探索上限。
//   decoder は r=9 まで広げるので既定 9。
function SnapCache(decoder, opts) {
  this.decoder = decoder;
  this.precision = decoder.precision || 1e5;
  this.gridSize = decoder.gridSize || 1000;
  this.maxDistM = opts && opts.snapMaxDistM != null ? opts.snapMaxDistM : DEFAULTS.snapMaxDistM;
  this.fallbackMaxRing = opts && opts.snapFallbackMaxRing != null ? opts.snapFallbackMaxRing : 9; // decoder の 2 段目フォールバック (radiusGrids=9) 相当
  this._cellCache = new Map(); // "gy_gx" -> [road(+_idx), ...] | null (空セル)
}

// grid セルの road 配列を decode (キャッシュ)。空セルは null をキャッシュし再 decode しない。
SnapCache.prototype._roadsInCell = function (gy, gx) {
  const k = gy + '_' + gx;
  const c = this._cellCache.get(k);
  if (c !== undefined) return c;
  const ids = this.decoder.grid[k];
  let arr = null;
  if (ids && ids.length) {
    arr = [];
    for (let i = 0; i < ids.length; i++) {
      const r = this.decoder.decodeRoadAt(ids[i]);
      if (r) {
        r._idx = ids[i];
        arr.push(r);
      }
    }
  }
  this._cellCache.set(k, arr);
  return arr;
};

// (lat,lng) を最寄り道路に snap。戻り値は decoder.snapToNearestRoad と同一形 or null。
SnapCache.prototype.snap = function (lat, lng) {
  const prec = this.precision;
  const gs = this.gridSize;
  const maxDistM = this.maxDistM;
  const mpd = metersPerDegree(lat);
  const mpdLat = mpd.lat;
  const mpdLng = mpd.lng;
  const li = Math.round(lat * prec);
  const gi = Math.round(lng * prec);
  const gy = Math.floor(li / gs);
  const gx = Math.floor(gi / gs);
  const maxSq = maxDistM * maxDistM;

  let bestSq = Infinity;
  let bRI = -1,
    bSeg = -1,
    bT = 0,
    bLat = 0,
    bLng = 0,
    bType = -1;
  const seen = {};
  let hitRing = -1;

  for (let ring = 0; ring <= this.fallbackMaxRing; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      const onYEdge = dy === -ring || dy === ring;
      for (let dx = -ring; dx <= ring; dx++) {
        if (!onYEdge && dx !== -ring && dx !== ring) continue; // 周縁リングのみ
        const roads = this._roadsInCell(gy + dy, gx + dx);
        if (!roads) continue;
        for (let ri = 0; ri < roads.length; ri++) {
          const road = roads[ri];
          if (seen[road._idx]) continue;
          seen[road._idx] = 1;
          const pts = road.points;
          for (let j = 0; j < pts.length - 1; j++) {
            const aLat = pts[j][0] / prec;
            const aLng = pts[j][1] / prec;
            const bLatp = pts[j + 1][0] / prec;
            const bLngp = pts[j + 1][1] / prec;
            const ax = (aLng - lng) * mpdLng;
            const ay = (aLat - lat) * mpdLat;
            const bx = (bLngp - lng) * mpdLng;
            const by = (bLatp - lat) * mpdLat;
            const abx = bx - ax;
            const aby = by - ay;
            const ab2 = abx * abx + aby * aby;
            let t;
            if (ab2 < 1e-9) t = 0;
            else {
              t = (-ax * abx + -ay * aby) / ab2;
              if (t < 0) t = 0;
              else if (t > 1) t = 1;
            }
            const sx = ax + t * abx;
            const sy = ay + t * aby;
            const dsq = sx * sx + sy * sy;
            if (dsq < bestSq) {
              bestSq = dsq;
              bRI = road._idx;
              bSeg = j;
              bT = t;
              bLat = aLat + t * (bLatp - aLat);
              bLng = aLng + t * (bLngp - aLng);
              bType = road.typeCode;
            }
          }
        }
      }
    }
    // maxDist 以内に当たったら +1 リングで境界取りこぼし防止して停止
    if (bRI >= 0 && bestSq <= maxSq && hitRing < 0) hitRing = ring;
    if (hitRing >= 0 && ring >= hitRing + 1) break;
  }

  if (bRI < 0 || bestSq > maxSq) return null;
  return {
    roadIndex: bRI,
    segmentIndex: bSeg,
    t: bT,
    snapLat: bLat,
    snapLng: bLng,
    distanceM: Math.sqrt(bestSq),
    typeCode: bType,
  };
};

SnapCache.prototype.reset = function () {
  this._cellCache = new Map();
};

// ─── RoadGraphRouter ─────────────────────────────────────────
// RoadDecoder が持つ道路ポリライン群から「道路網グラフ」をオンデマンド構築し、
// 2 snap 点間の道なり距離を簡易 Dijkstra で求める。
//
// グラフ構造:
//   node  = 道路頂点を量子化した座標キー "qlat_qlng"。
//   edge  = ある道路の連続頂点 i→i+1 の弧 (双方向・oneway は距離計算では無視。
//           距離 (= 道なり長) のみが目的で、進入禁止判定は MM 側の責務)。
//   さらに road 内全頂点が同 road でつながる (= 道路は連続ポリライン)。
//   異なる road は「同一量子化 node を共有する頂点」で接続される (= 交差点)。
//
// 構築範囲は 2 snap 点周辺の getRoadsNear に限定 (完全グローバル graph は作らない)。
function RoadGraphRouter(decoder, opts) {
  this.decoder = decoder;
  this.opts = opts || {};
  this.quantize = this.opts.nodeQuantize || DEFAULTS.nodeQuantize;
  this.precision = decoder.precision || 1e5;
  this.searchGrids = this.opts.routingSearchGrids || DEFAULTS.routingSearchGrids;
  this.maxNodes = this.opts.routingMaxNodes || DEFAULTS.routingMaxNodes;
  this.gridSize = decoder.gridSize || 1000;

  // ★性能★ localグラフのキャッシュ。
  //   別道路 routing は連続区間 (同じ街区) で何度も同じ周辺道路を decode + graph 構築する。
  //   build 範囲を「覆うグリッドセル集合の署名」で正規化しキャッシュ → 連続区間で再利用。
  //   署名 = sorted("gy_gx" 文字列) を結合したキー。
  this._graphCache = new Map(); // sig -> { adj, nodeLatLng, index }
  this._graphCacheCap = this.opts.graphCacheCap || 64; // LRU 風上限 (メモリガード)
}

// ★古スマホ対応 ③ (snap/routing decode 重複排除) は撤回 (2026-05-30):
//   実測ベンチ (tests/bench-oldphone-decode-dedup.js) で ③ON は ★0.91x (10% 遅い)★ と判明。
//   理由: routing は既に _graphCache (署名キーのグラフキャッシュ) を持つため getRoadsNear は
//   キャッシュミス時のみ呼ばれ (= 全点の約 5%)、dedup の decode 節約 < cell 収集オーバーヘッド。
//   距離は bit 一致だが速度が逆効果のため不採用。routing は従来 getRoadsNear 経路のみ。

// 道路頂点 (整数 lat*precision, lng*precision) → node キー
RoadGraphRouter.prototype._nodeKey = function (rawLatInt, rawLngInt) {
  // decoder の precision で実座標化してから quantize で再量子化
  const lat = rawLatInt / this.precision;
  const lng = rawLngInt / this.precision;
  const ql = Math.round(lat * this.quantize);
  const qg = Math.round(lng * this.quantize);
  return ql + '_' + qg;
};

// (lat,lng) が属する decoder グリッドセルキー "gy_gx"
RoadGraphRouter.prototype._cellKey = function (lat, lng) {
  const latInt = Math.round(lat * this.precision);
  const lngInt = Math.round(lng * this.precision);
  const gy = Math.floor(latInt / this.gridSize);
  const gx = Math.floor(lngInt / this.gridSize);
  return gy + '_' + gx;
};

// snapA/snapB を覆う「searchGrids 半径の周辺グリッドセル集合」の正規化署名。
//   両端 + 中点の 3 アンカーそれぞれの ±searchGrids セルを union。
//   連続する別道路区間は同じ街区 = 同じセル集合 → 同一署名でキャッシュ命中。
RoadGraphRouter.prototype._coverSignature = function (snapA, snapB) {
  const r = this.searchGrids;
  const anchors = [
    [snapA.snapLat, snapA.snapLng],
    [snapB.snapLat, snapB.snapLng],
    [(snapA.snapLat + snapB.snapLat) / 2, (snapA.snapLng + snapB.snapLng) / 2],
  ];
  const cells = {};
  for (let a = 0; a < anchors.length; a++) {
    const latInt = Math.round(anchors[a][0] * this.precision);
    const lngInt = Math.round(anchors[a][1] * this.precision);
    const gy = Math.floor(latInt / this.gridSize);
    const gx = Math.floor(lngInt / this.gridSize);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        cells[gy + dy + '_' + (gx + dx)] = 1;
      }
    }
  }
  const keys = Object.keys(cells);
  keys.sort();
  return keys.join('|');
};

// 署名で指定された周辺道路から隣接グラフを構築 (+ 最寄り node 用 grid 空間索引)。
// 戻り値: { adj, nodeLatLng, index } ※ index は _nearestNode 用 grid bucket
RoadGraphRouter.prototype._buildLocalGraph = function (snapA, snapB) {
  const sig = this._coverSignature(snapA, snapB);
  const cached = this._graphCache.get(sig);
  if (cached) {
    // LRU 風: 参照されたら末尾へ (Map は挿入順保持)
    this._graphCache.delete(sig);
    this._graphCache.set(sig, cached);
    return cached;
  }

  const dec = this.decoder;
  const precision = this.precision;
  const midLat = (snapA.snapLat + snapB.snapLat) / 2;
  const midLng = (snapA.snapLng + snapB.snapLng) / 2;

  // 中点周辺 + 両端周辺の道路を集める (重複は始点座標 + 点数キーで排除)
  const roadSet = {};
  const collect = function () {
    return function (lat, lng) {
      const roads = dec.getRoadsNear(lat, lng, this.searchGrids);
      // getRoadsNear は decode 済み road を返すが roadIndex は持たない。
      // 同一性判定は始点座標 + 点数で簡易キー化。
      for (let i = 0; i < roads.length; i++) {
        const r = roads[i];
        if (!r || !r.points || r.points.length < 2) continue;
        const k = r.points[0][0] + ':' + r.points[0][1] + ':' + r.points.length;
        if (roadSet[k]) continue;
        roadSet[k] = r;
      }
    }.bind(this);
  }.call(this);

  collect(snapA.snapLat, snapA.snapLng);
  collect(snapB.snapLat, snapB.snapLng);
  collect(midLat, midLng);

  const adj = new Map();
  const nodeLatLng = new Map();
  // ★along-edge 端tail 用★: 量子化 nodeKey → その node を畳んだ ★丸め前★ polyline 頂点の
  //   生整数座標 [latInt, lngInt]。端tail は snap 点 (roadIndex/segmentIndex/t 保持) から
  //   Dijkstra 端 node に対応する ★実 polyline 頂点★ まで沿弧長を辿る際、量子化 nodeLatLng
  //   ではなく この生頂点座標を終点に使うことで +3.2m/区間 の斜め水増しを除去する。
  //   (nodeKey 経由でなく生整数座標 == で頂点照合する設計・量子化 seam を残さない)
  const nodeRaw = new Map();
  const self = this;

  function regRaw(k, latInt, lngInt) {
    if (!nodeRaw.has(k)) nodeRaw.set(k, [latInt, lngInt]);
  }

  function addEdge(k1, lat1, lng1, k2, lat2, lng2, w) {
    if (!adj.has(k1)) adj.set(k1, []);
    if (!adj.has(k2)) adj.set(k2, []);
    adj.get(k1).push({ to: k2, w: w });
    adj.get(k2).push({ to: k1, w: w });
    if (!nodeLatLng.has(k1)) nodeLatLng.set(k1, [lat1, lng1]);
    if (!nodeLatLng.has(k2)) nodeLatLng.set(k2, [lat2, lng2]);
  }

  for (const key in roadSet) {
    if (!Object.prototype.hasOwnProperty.call(roadSet, key)) continue;
    const pts = roadSet[key].points;
    for (let j = 0; j < pts.length - 1; j++) {
      const aLat = pts[j][0] / precision;
      const aLng = pts[j][1] / precision;
      const bLat = pts[j + 1][0] / precision;
      const bLng = pts[j + 1][1] / precision;
      const ka = self._nodeKey(pts[j][0], pts[j][1]);
      const kb = self._nodeKey(pts[j + 1][0], pts[j + 1][1]);
      // 丸め前の生整数頂点座標を nodeKey に逆引き登録 (端tail の沿弧終点照合用)
      regRaw(ka, pts[j][0], pts[j][1]);
      regRaw(kb, pts[j + 1][0], pts[j + 1][1]);
      if (ka === kb) continue;
      const w = haversineM(aLat, aLng, bLat, bLng);
      addEdge(ka, aLat, aLng, kb, bLat, bLng, w);
    }
  }

  // ★性能★ _nearestNode 用 grid 空間索引を構築 (線形走査の排除)。
  //   node を nodeQuantize と同じ粗さの bucket でハッシュ → 近傍 bucket のみ走査。
  const index = this._buildNodeIndex(nodeLatLng);

  const graph = { adj: adj, nodeLatLng: nodeLatLng, index: index, nodeRaw: nodeRaw };
  // キャッシュ格納 (LRU 風 eviction)
  this._graphCache.set(sig, graph);
  if (this._graphCache.size > this._graphCacheCap) {
    const oldest = this._graphCache.keys().next().value;
    this._graphCache.delete(oldest);
  }
  return graph;
};

// nodeLatLng から grid 空間索引を構築。bucket = floor(coord * quantize)。
// 戻り値: { buckets: Map("by_bx" -> [key,...]), q: quantize }
RoadGraphRouter.prototype._buildNodeIndex = function (nodeLatLng) {
  const q = this.quantize;
  const buckets = new Map();
  nodeLatLng.forEach(function (ll, key) {
    const by = Math.floor(ll[0] * q);
    const bx = Math.floor(ll[1] * q);
    const bk = by + '_' + bx;
    let arr = buckets.get(bk);
    if (!arr) {
      arr = [];
      buckets.set(bk, arr);
    }
    arr.push(key);
  });
  return { buckets: buckets, q: q };
};

// グラフ上で start node → goal node の最短 (道なり) 距離を Dijkstra で算出。
// node が graph に無い / 到達不能 → null。
RoadGraphRouter.prototype._dijkstra = function (graph, startKey, goalKey) {
  const adj = graph.adj;
  if (!adj.has(startKey) || !adj.has(goalKey)) return null;
  if (startKey === goalKey) return 0;

  const dist = new Map();
  dist.set(startKey, 0);
  // 単純配列 priority queue (近距離 routing なのでノード数は限定的)
  const heap = new MinHeap();
  heap.push(0, startKey);
  let expanded = 0;

  while (heap.size() > 0) {
    const top = heap.pop();
    const d = top.key;
    const u = top.val;
    if (d > (dist.get(u) != null ? dist.get(u) : Infinity)) continue;
    if (u === goalKey) return d;
    if (++expanded > this.maxNodes) return null; // 暴走ガード
    const edges = adj.get(u);
    if (!edges) continue;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const nd = d + e.w;
      const cur = dist.get(e.to);
      if (cur == null || nd < cur) {
        dist.set(e.to, nd);
        heap.push(nd, e.to);
      }
    }
  }
  return dist.has(goalKey) ? dist.get(goalKey) : null;
};

// 2 snap 点間の「道なり routing 距離」。失敗時 null (呼び出し側で fallback)。
// snapA/snapB の snap 座標を最寄り node に丸めて Dijkstra。
// 端点 (snap 点) から node までの僅かな距離も足す。
RoadGraphRouter.prototype.routeDistance = function (snapA, snapB) {
  const graph = this._buildLocalGraph(snapA, snapB);
  if (graph.adj.size === 0) return null;

  const startKey = this._nearestNode(graph, snapA.snapLat, snapA.snapLng);
  const goalKey = this._nearestNode(graph, snapB.snapLat, snapB.snapLng);
  if (!startKey || !goalKey) return null;

  const core = this._dijkstra(graph, startKey, goalKey);
  if (core == null) return null;

  // ★★ start node == goal node (core==0): 両 snap が ★同一 network node★ に落ちる ★★
  //   この時 network 上に 2 snap 間の interior は無い (両 snap は 1 つの node に co-located)。
  //   従来は core(0) + tailA + tailB を返していたが、tailA/tailB は ★どちらも同じ node へ★
  //   向かう along-edge 残弧であり、これを ★足す★ と「snap→node→snap」と node まで往復して
  //   戻る経路を測ってしまう (実測: chord11.5m の区間で tailA64+tailB75.4=139.5m の phantom)。
  //   = +647m/110区間 の過大課金源 (C 診断の端tail net-zero とは別の・真の支配源)。
  //   正しい純幾何 = 2 snap 間の ★直接★ 距離:
  //     ・同一 roadIndex → その polyline を snapA→snapB へ沿った along-edge 弧長 (往復しない)。
  //     ・別 roadIndex (OSM way 分割で同一 node 共有) → polyline を共有しないため snap 間
  //       haversine (= calcRoadDistance のクロス道路 distanceM と同義・<50m で弧≒弦)。
  //   ★クランプ/補正係数/min(projected,direct) 一切なし・往復誤算を除いた直接幾何のみ★。
  if (startKey === goalKey) {
    const direct = this._alongEdgeDirect(snapA, snapB);
    return direct != null
      ? direct
      : haversineM(snapA.snapLat, snapA.snapLng, snapB.snapLat, snapB.snapLng);
  }

  // start != goal: network interior (core) が存在。snap 点 → 各端 node までの端数 (両端) を加算。
  // ★along-edge★: 従来は snap 点 → 量子化頂点(nodeLatLng) への斜め haversine 直線で
  //   +3.2m/区間 を水増ししていた。これを「snap が乗る ★その road の polyline★ を
  //   snap 点 (segmentIndex,t) から Dijkstra 端 node に対応する実頂点まで沿った残弧長」へ置換。
  //   端 node の実頂点座標は graph.nodeRaw[key] (丸め前生整数) を使い量子化 seam を残さない。
  //   snap road 上に該当頂点が無い (OSM way 分割等) 場合のみ従来 haversine fallback。
  //   ★純幾何のみ・クランプ/補正係数/min(projected,direct) 一切なし★。
  const sNode = graph.nodeLatLng.get(startKey);
  const gNode = graph.nodeLatLng.get(goalKey);
  const tailA = this._alongEdgeTail(snapA, graph.nodeRaw.get(startKey), sNode);
  const tailB = this._alongEdgeTail(snapB, graph.nodeRaw.get(goalKey), gNode);
  return core + tailA + tailB;
};

// 2 snap が同一 network node に落ちる時 (core==0) の・2 snap 間 ★直接★ 距離 (純幾何)。
//   ・同一 roadIndex: その polyline を snapA(seg,t)→snapB(seg,t) へ沿った along-edge 弧長。
//     (snapA→snapB の前方/後方を seg/t で判定し往復せず一方向に累積)
//   ・別 roadIndex: polyline を共有しないため null を返し呼び出し側で snap 間 haversine に退避。
//   クランプ・補正係数・死にコード無し。
RoadGraphRouter.prototype._alongEdgeDirect = function (snapA, snapB) {
  if (snapA.roadIndex !== snapB.roadIndex) return null;
  const road = this.decoder.decodeRoadAt(snapA.roadIndex);
  if (!road || !road.points || road.points.length < 2) return null;
  const pts = road.points;
  const prec = this.precision;
  // 同一 polyline 上の 2 点 (segA,tA) (segB,tB) 間の沿弧長。前後関係を正規化して一方向累積。
  let segA = snapA.segmentIndex,
    tA = snapA.t,
    segB = snapB.segmentIndex,
    tB = snapB.t;
  if (segB < segA || (segB === segA && tB < tA)) {
    const swSeg = segA;
    segA = segB;
    segB = swSeg;
    const swT = tA;
    tA = tB;
    tB = swT;
  }
  if (segA === segB) {
    // 同一 segment 内: 弧長 × |tB − tA|
    return this._segArc(pts, segA, prec) * (tB - tA);
  }
  // segA 内の残り (1−tA) + 中間 segment 群 + segB 内の先頭 tB。
  let arc = this._segArc(pts, segA, prec) * (1 - tA);
  for (let k = segA + 1; k < segB; k++) {
    arc += this._segArc(pts, k, prec);
  }
  arc += this._segArc(pts, segB, prec) * tB;
  return arc;
};

// snap 点 (roadIndex/segmentIndex/t 保持) から、量子化端 node に対応する
// ★実 polyline 頂点 (rawTarget = [latInt, lngInt] 丸め前)★ まで、snap road の
// polyline 沿いに辿った残弧長 (along-edge) を返す。
//   rawTarget が snap road の polyline 頂点に整数座標一致しない場合は
//   従来通り snap 点 → 量子化頂点 (fallbackNode) の haversine 直線を返す (安全 fallback)。
// 純幾何のみ。クランプ・補正係数・死にコード無し。
RoadGraphRouter.prototype._alongEdgeTail = function (snap, rawTarget, fallbackNode) {
  if (!rawTarget) {
    return haversineM(snap.snapLat, snap.snapLng, fallbackNode[0], fallbackNode[1]);
  }
  const road = this.decoder.decodeRoadAt(snap.roadIndex);
  if (!road || !road.points || road.points.length < 2) {
    return haversineM(snap.snapLat, snap.snapLng, fallbackNode[0], fallbackNode[1]);
  }
  const pts = road.points;
  const prec = this.precision;
  // rawTarget (丸め前生整数座標) と一致する polyline 頂点 index を探す (整数 == 照合)。
  let vIdx = -1;
  for (let k = 0; k < pts.length; k++) {
    if (pts[k][0] === rawTarget[0] && pts[k][1] === rawTarget[1]) {
      vIdx = k;
      break;
    }
  }
  if (vIdx < 0) {
    // この road の頂点ではない (別 road が同一量子化 node を共有 = way 分割等) → fallback
    return haversineM(snap.snapLat, snap.snapLng, fallbackNode[0], fallbackNode[1]);
  }
  const seg = snap.segmentIndex;
  // snap 点は segment seg (頂点 seg → seg+1) 上の t 比率位置。
  // 終点頂点 vIdx までの polyline 沿い残弧長を累積する。
  if (vIdx <= seg) {
    // 終点は snap 点の「手前側」(seg 始点 vIdx 方向)。
    //   snap 点 → 頂点 seg まで (= seg 始点まで戻る残弧) を t で按分し、
    //   その先 seg → seg-1 → ... → vIdx を頂点間弧長で累積。
    let arc = 0;
    // snap 点 → seg 始点 (頂点 seg)
    arc += this._segArc(pts, seg, prec) * snap.t;
    for (let k = seg; k > vIdx; k--) {
      arc += this._segArc(pts, k - 1, prec);
    }
    return arc;
  }
  // vIdx >= seg+1: 終点は snap 点の「先側」(seg+1 以降)。
  //   snap 点 → 頂点 seg+1 まで (= (1-t) 残弧)、その先 seg+1 → ... → vIdx を累積。
  let arc = this._segArc(pts, seg, prec) * (1 - snap.t);
  for (let k = seg + 1; k < vIdx; k++) {
    arc += this._segArc(pts, k, prec);
  }
  return arc;
};

// polyline 頂点 i → i+1 の弧長 (m)。生整数座標 / precision → haversine。
RoadGraphRouter.prototype._segArc = function (pts, i, prec) {
  const aLat = pts[i][0] / prec;
  const aLng = pts[i][1] / prec;
  const bLat = pts[i + 1][0] / prec;
  const bLng = pts[i + 1][1] / prec;
  return haversineM(aLat, aLng, bLat, bLng);
};

// graph 内で (lat,lng) に最も近い node キー。
// ★性能★ grid 空間索引で中心 bucket から外側へリング展開し、最初にヒットした
//   リング + 安全のため 1 リング外側まで走査して最近接を確定 (線形全走査を排除)。
RoadGraphRouter.prototype._nearestNode = function (graph, lat, lng) {
  const index = graph.index;
  if (!index || index.buckets.size === 0) {
    // 索引が無い場合の保険 (線形 fallback)
    return this._nearestNodeLinear(graph, lat, lng);
  }
  const q = index.q;
  const buckets = index.buckets;
  const cy = Math.floor(lat * q);
  const cx = Math.floor(lng * q);
  const nodeLatLng = graph.nodeLatLng;

  let best = null;
  let bestD = Infinity;
  let foundRing = -1;
  // bucket 1 個 ≈ 1/q 度。グラフ規模は小さいので妥当な上限まで展開。
  const MAX_RING = 64;

  for (let ring = 0; ring <= MAX_RING; ring++) {
    // この ring の周縁 bucket だけ走査 (内側は既走査)
    let scannedAny = false;
    for (let dy = -ring; dy <= ring; dy++) {
      const onYEdge = dy === -ring || dy === ring;
      for (let dx = -ring; dx <= ring; dx++) {
        if (!onYEdge && dx !== -ring && dx !== ring) continue; // 周縁のみ
        const arr = buckets.get(cy + dy + '_' + (cx + dx));
        if (!arr) continue;
        scannedAny = true;
        for (let i = 0; i < arr.length; i++) {
          const ll = nodeLatLng.get(arr[i]);
          const ex = ll[0] - lat;
          const ey = ll[1] - lng;
          const d = ex * ex + ey * ey;
          if (d < bestD) {
            bestD = d;
            best = arr[i];
          }
        }
      }
    }
    // ヒットした最初のリングを記録し、1 リング外まで見て確定 (bucket 境界の取りこぼし防止)
    if (best && foundRing < 0) foundRing = ring;
    if (foundRing >= 0 && ring >= foundRing + 1) break;
    void scannedAny;
  }
  return best;
};

// 索引なし時の線形 fallback (保険・通常経路では使わない)
RoadGraphRouter.prototype._nearestNodeLinear = function (graph, lat, lng) {
  let best = null;
  let bestD = Infinity;
  graph.nodeLatLng.forEach(function (ll, key) {
    const dx = ll[0] - lat;
    const dy = ll[1] - lng;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = key;
    }
  });
  return best;
};

// ─── 軽量 MinHeap ────────────────────────────────────────────
function MinHeap() {
  this._a = [];
}
MinHeap.prototype.size = function () {
  return this._a.length;
};
MinHeap.prototype.push = function (key, val) {
  const a = this._a;
  a.push({ key: key, val: val });
  let i = a.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (a[p].key <= a[i].key) break;
    const tmp = a[p];
    a[p] = a[i];
    a[i] = tmp;
    i = p;
  }
};
MinHeap.prototype.pop = function () {
  const a = this._a;
  const top = a[0];
  const last = a.pop();
  if (a.length > 0) {
    a[0] = last;
    let i = 0;
    const n = a.length;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let s = i;
      if (l < n && a[l].key < a[s].key) s = l;
      if (r < n && a[r].key < a[s].key) s = r;
      if (s === i) break;
      const tmp = a[s];
      a[s] = a[i];
      a[i] = tmp;
      i = s;
    }
  }
  return top;
};

// ─── computeDistance (メイン) ────────────────────────────────
// samples: [{lat,lng,t,acc,spd}]  (t = epoch ms, spd = m/s or 無し)
// decoder: RoadDecoder インスタンス (buildOffsetTable 済)
// opts:
//   speedProvider, snapMaxDistM, stationarySpdMps, routingMaxRatio,
//   routingMaxStraightM, perSegmentMaxM, ... (DEFAULTS 参照)
//   enableRouting: false で routing 無効 (= 別道路は常に直線)。既定 true。
// 戻り値: {
//   distance_m,            // ★道路 snap 道なり累積 (= 課金/業務距離の意味論)
//   breakdown: { sameRoadM, routedM, straightFallbackM, dopplerM, stationarySkipped },
//   stats: { points, snapHit, snapMiss, sameRoadSegs, routedSegs, straightSegs,
//            dopplerSegs, routingFallbacks }
// }
// ★④ batch 内部処理を sync / async で共有する setup ヘルパ。
//   ★sync computeDistance と computeDistanceAsync で ★完全に同一の処理ロジック★ を用いる
//     (= yield 挿入位置以外は 1 byte も差が出ない)。距離は累積和で yield 可換。
function _prepareBatch(samples, decoder, opts) {
  opts = opts || {};
  const cfg = {};
  for (const k in DEFAULTS) cfg[k] = opts[k] != null ? opts[k] : DEFAULTS[k];
  // ★M2 (監査)★: adaptiveMode は平滑土台が必須前提(生GPS弦は愛媛+1.9%過大=過大請求)。
  //   smoothedRawMode を強制 true にし、暗黙依存で過大ゼロが黙って崩れるフットガンを構造的に塞ぐ。
  if (cfg.adaptiveMode === true) cfg.smoothedRawMode = true;
  const speedProvider =
    typeof opts.speedProvider === 'function' ? opts.speedProvider : gpsSpeedProvider;
  const enableRouting = opts.enableRouting !== false;

  const router = enableRouting ? new RoadGraphRouter(decoder, cfg) : null;
  // ★性能★ snap候補キャッシュ (opts.useSnapCache=false で decoder 直叩きに戻せる)。
  const snapper = opts.useSnapCache === false ? null : new SnapCache(decoder, cfg);

  // 入力整形: lat/lng 有限数値のみ・t 昇順
  // ★NaN/Infinity 防御★: typeof==='number' は NaN/Infinity を通すため Number.isFinite で弾く。
  //   NaN 座標が straightFallbackM 等を汚染し breakdown を {…:null} 化するのを防止。
  const pts = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    pts.push(s);
  }
  pts.sort(function (a, b) {
    return (a.t || 0) - (b.t || 0);
  });

  // ★生GPS スムージング距離モード★: 位置を双方向移動平均で平滑し、距離はその平滑弦で測る。
  //   batch は全点が揃っているため単純に前処理 (live tracker は遅延窓で同等処理)。
  const workPts =
    cfg.smoothedRawMode === true && pts.length >= 2
      ? _smoothPositions(pts, cfg.smoothWindow, cfg.smoothGapSec, cfg.gapGuardAccM)
      : pts; // ★adaptiveMode も平滑土台を使う(ジッタ過大対策)・3D/穴埋めを上積み★

  const bd = {
    sameRoadM: 0,
    routedM: 0,
    straightFallbackM: 0,
    dopplerM: 0,
    gapGuardSkippedM: 0,
    gapGuardFillM: 0,
    tunnelRouteM: 0, // ★STEP B: トンネル出口アンカー routing 充填の回収距離 (監査用・固定形状)
    stationarySkipped: 0,
  };
  const stats = {
    points: workPts.length,
    snapHit: 0,
    snapMiss: 0,
    sameRoadSegs: 0,
    routedSegs: 0,
    straightSegs: 0,
    dopplerSegs: 0,
    tunnelRouteSegs: 0, // ★STEP B: トンネル routing 充填が発火した区間数 (監査用・固定形状)
    routingFallbacks: 0,
  };

  // 区間処理の単一実装 (sync/async 共有)。state = {distance_m, prev, prevSnap} を破壊的に更新。
  function processPoint(state, cur) {
    // ★smoothedRawMode★: snap は距離に使わない (平滑弦が距離) → snap をスキップ (snap=null)。
    //   これにより stepDistance の two-snap ブランチを飛ばし、長dt穴は Doppler/coast tail へ落とす。
    const snap =
      cfg.smoothedRawMode === true || cfg.adaptiveMode === true
        ? null // ★adaptiveMode/smoothed は snap を距離に使わない★
        : snapper
          ? snapper.snap(cur.lat, cur.lng)
          : decoder.snapToNearestRoad(cur.lat, cur.lng, { maxDistM: cfg.snapMaxDistM });
    if (snap) stats.snapHit++;
    else stats.snapMiss++;

    if (state.prev) {
      // ── 静止判定 (ZUPT) ──
      const spd = speedProvider(cur, state.prev);
      const disp = haversineM(state.prev.lat, state.prev.lng, cur.lat, cur.lng);
      let stationary = false;
      if (spd >= 0) {
        // (1) 速度源が静止を示す → 加算 0
        if (spd < cfg.stationarySpdMps) stationary = true;
      } else {
        // (2) ★spd 不明 (-1)★: 変位 / accuracy ベース fallback で停車ジッタを弾く。
        //     spd-optional 運用や spd 欠落フレーム・spd 非対応端末での creep 再発防止。
        if (isStationaryByDisplacement(state.prev, cur, disp, cfg)) stationary = true;
      }
      if (stationary) {
        bd.stationarySkipped++;
        // ★coastSpdMps 更新 (tracker L1905-1915 と同一・長トンネル parity)★:
        //   高信頼停止は 0 クリア (creep防止)・低信頼 (bad-acc/dt<=0) は保持し穴中減衰のみ (穴明け走行を殺さない)。
        const _accCurStat = typeof cur.acc === 'number' && cur.acc >= 0 ? cur.acc : -1;
        const _dtCurStat = ((cur.t || 0) - (state.prev.t || 0)) / 1000;
        const _lowConfidenceStop =
          (cfg.gapGuardAccM != null && _accCurStat > cfg.gapGuardAccM) || _dtCurStat <= 0;
        if (spd >= 0) state.coastSpdMps = spd;
        else if (!_lowConfidenceStop) state.coastSpdMps = 0;
        else if (state.coastSpdMps >= 0) state.coastSpdMps = state.coastSpdMps * 0.97;
        // 加算せず prev/prevSnap だけ更新
        state.prev = cur;
        state.prevSnap = snap;
        return;
      }

      const added = stepDistance(
        decoder,
        router,
        state.prev,
        cur,
        state.prevSnap,
        snap,
        spd,
        cfg,
        bd,
        stats,
        state.coastSpdMps // ★tracker と同一の coastSpdMps を渡す (更新前=因果順序保持・長トンネル parity)★
      );
      if (added > 0) state.distance_m += added;
      // ★coastSpdMps 更新 (tracker L1969-1977 と同一)★: spd 判明=snap成功で再確立/snap無は減速側のみ即反映、
      //   spd 不明 (穴中) は ×0.97 減衰で保守側へ。synthetic 分岐は batch に合成点が来ないため不要。
      if (spd >= 0) {
        if (snap) state.coastSpdMps = spd;
        else if (state.coastSpdMps < 0 || spd < state.coastSpdMps) state.coastSpdMps = spd;
      } else if (state.coastSpdMps >= 0) {
        state.coastSpdMps = state.coastSpdMps * 0.97;
      }
    }

    state.prev = cur;
    state.prevSnap = snap;
  }

  return { pts: workPts, bd: bd, stats: stats, processPoint: processPoint };
}

function _finishBatch(distance_m, bd, stats) {
  return {
    distance_m: distance_m,
    breakdown: {
      sameRoadM: +bd.sameRoadM.toFixed(2),
      routedM: +bd.routedM.toFixed(2),
      straightFallbackM: +bd.straightFallbackM.toFixed(2),
      dopplerM: +bd.dopplerM.toFixed(2),
      gapGuardSkippedM: +(bd.gapGuardSkippedM || 0).toFixed(2),
      gapGuardFillM: +(bd.gapGuardFillM || 0).toFixed(2),
      smoothedM: +(bd.smoothedM || 0).toFixed(2),
      tunnelRouteM: +(bd.tunnelRouteM || 0).toFixed(2),
      stationarySkipped: bd.stationarySkipped,
    },
    stats: stats,
  };
}

// ★古スマホ対応 ④ (batch replay の Worker yield 版 computeDistanceAsync) は撤回 (2026-05-30):
//   本番は createDistanceTracker.ingest の逐次計算のみで、batch replay 経路が存在しない
//   (セッション復元は meter.setDistance(=v) で値を直接戻すため再計算しない)。
//   = yield する対象が本番に無いため不採用。batch computeDistance は同期のまま (テスト/検証用)。

function computeDistance(samples, decoder, opts) {
  const prep = _prepareBatch(samples, decoder, opts);
  // ★coastSpdMps を batch も保持 (2026-06-12・長トンネル parity 根治)★: gap-guard が参照する
  //   coastSpdMps を tracker と同一の状態機械で更新し、bad-acc 穴の fill/skip 判定を一致させる。
  const state = { distance_m: 0, prev: null, prevSnap: null, coastSpdMps: -1 };
  for (let p = 0; p < prep.pts.length; p++) {
    prep.processPoint(state, prep.pts[p]);
  }
  return _finishBatch(state.distance_m, prep.bd, prep.stats);
}

// 1 区間 (prev→cur) の道なり距離を算出して内訳を更新。戻り値 = 加算メートル。
//   coastSpdMps: 直近 snap 成功点で確立した連続保持速度 (m/s・-1=未確立)。GPS 穴 (snap 失敗連続)
//   中に当該点速度が不明な区間を「等速保持 × dt」で補間する (= coasting・never-over)。
//   batch (computeDistance) は coast 状態を持たないため -1 を渡し従来 (haversine) 挙動を維持する。
// ★地力 de-bias: 同一道路 arc を「実走行ゲート」を通った時だけ生の弦まで回収する。★
//   中心線 arc がカーブ/車線/polyline 粗さで落とす実距離を回収し、幻GPS は弾く (過大ゼロ死守)。
//   詳細は DEFAULTS.arcRecover* のコメント参照。OFF (cfg.arcRecover!==true) なら arc を素通し
//   = 従来 byte 完全等価。
function _recoverArc(arc, straight, prev, cur, spd, cfg, bd, stats) {
  if (cfg.arcRecover !== true) return arc; // flag OFF → 完全不変
  if (!(straight > arc)) return arc; // 生が arc 以下 → 回収不要 (過大化しない)
  // ── 実走行ゲート (幻GPS / ジッタ / 低速 を弾く) ──
  if (!(spd >= cfg.arcRecoverMinSpdMps)) return arc; // 低速/停止/速度不明 → 回収しない (creep 安全)
  const dt = ((cur.t || 0) - (prev.t || 0)) / 1000;
  if (!(dt > 0 && dt <= cfg.arcRecoverMaxDtS)) return arc; // 穴/間引き → arc
  const accCur = typeof cur.acc === 'number' && cur.acc >= 0 ? cur.acc : cfg.stationaryAccM;
  const accPrev = typeof prev.acc === 'number' && prev.acc >= 0 ? prev.acc : cfg.stationaryAccM;
  if (accCur > cfg.arcRecoverMaxAccM || accPrev > cfg.arcRecoverMaxAccM) return arc; // 精度悪 → arc
  // 弦/arc 比が普通走行域 (~1.05) を大きく超える = off-road ジャンプ/外れ snap → 弾く
  if (arc > 0.1 && straight / arc > cfg.arcRecoverMaxRatio) return arc;
  // 速度整合: 弦が spd×dt×ratio を超える = 速度に対し弦過大 (幻ジャンプ) → 弾く
  const physMax = spd * dt * cfg.arcRecoverSpeedRatio;
  if (straight > physMax) return arc;
  // ── 回収量 (速度条件付き never-over) ──
  //   高速 = 弦が正確 → 弦まで回収。低速 = ジッタ水増し → Doppler 実測 (spd×dt) を天井に抑制。
  let recovered = straight;
  if (spd < cfg.arcRecoverRawAboveSpdMps) {
    const cap = spd * dt; // 低速時は Doppler 実測距離を天井 (= 過大ゼロ死守)
    if (recovered > cap) recovered = cap;
  }
  if (recovered < arc) recovered = arc; // 下限 arc (回収は増やす方向のみ)
  if (recovered > arc) {
    bd.arcRecoverM = (bd.arcRecoverM || 0) + (recovered - arc);
    stats.arcRecovered = (stats.arcRecovered || 0) + 1;
  }
  return recovered;
}

function stepDistance(
  decoder,
  router,
  prev,
  cur,
  prevSnap,
  snap,
  spd,
  cfg,
  bd,
  stats,
  coastSpdMps
) {
  const straight = haversineM(prev.lat, prev.lng, cur.lat, cur.lng);
  if (typeof coastSpdMps !== 'number') coastSpdMps = -1;

  // ★Fix④ gap-garbage guard → 速度補足 fill (2026-06-03・設計変更・iPhone13 過少根治・creep 安全)★:
  //   区間の ★どちらかの端点★ の accuracy がゴミ (> gapGuardAccM) なら、その点の ★位置★ は
  //   信用できない (lat/lng は一切距離に使わない)。だが旧実装は無条件 return 0 でゼロ消ししており、
  //   ★走行中★ に入った穴 (iPhone13: prev.spd=15.81m/s で 79s の穴) まで距離を −674m 消して
  //   過少化させ Android から離していた。
  //   新方針 = 国交省ソフトメーター認定要領 別表1「GNSS 信号取得不可時は走行信号 (速度) で位置補正」:
  //     ・穴入口の ★直前の確かな速度★ が停止 (< stationarySpdMps) or 不明 → ★parked★: 従来通り
  //       return 0 (停止由来 creep をゼロ維持・memory Fix④ の 470m creep / 駐車 drift を遮断)。
  //     ・走行中 (直前速度 >= stationarySpdMps) → ★速度補足 fill★: 確立済み連続速度 (coastSpdMps) を
  //       優先し、未確立なら穴入口直前点速度 prev.spd を用いて fillSpd×dt を加算。
  //   ★ゴミ点の位置 (弦 straight) は距離値に採用しない★ — fill は速度×dt のみ。
  //   never-over 3 段で過大ゼロを担保 (下記)。Android(maxAcc10)/SE(maxAcc30)/tire(maxAcc33) は
  //   acc>gapGuardAccM 点ゼロ → fill 分岐に到達せず ★完全不変★ (実機調査済)。
  if (cfg.gapGuardAccM != null) {
    const _accCur = typeof cur.acc === 'number' && cur.acc >= 0 ? cur.acc : -1;
    const _accPrev = typeof prev.acc === 'number' && prev.acc >= 0 ? prev.acc : -1;
    if (_accCur > cfg.gapGuardAccM || _accPrev > cfg.gapGuardAccM) {
      const _dt = ((cur.t || 0) - (prev.t || 0)) / 1000;
      // ★穴入口の直前の確かな速度★ (= 走行/停止を分類する信号)。ゴミ点 cur.spd は使わない。
      //   優先順: 確立済み連続速度 coastSpdMps → 穴入口直前点 prev.spd → 不明(-1)。
      const _prevSpd = typeof prev.spd === 'number' && prev.spd >= 0 ? prev.spd : -1;
      const _entrySpd = coastSpdMps >= 0 ? coastSpdMps : _prevSpd;
      // ★creep 安全ゲート★: 速度不明 or 停止 (< stationarySpdMps) → parked 扱いで return 0 維持。
      //   memory Fix④ の停止中 (spd≈0.04) に入った穴の drift は _entrySpd<0.5 でここに落ち
      //   従来どおり距離ゼロ (停止由来 creep を 1byte も復活させない)。速度不明も保守的に parked。
      if (_entrySpd < 0 || _entrySpd < cfg.stationarySpdMps) {
        stats.gapGuardSkipped = (stats.gapGuardSkipped || 0) + 1;
        bd.gapGuardSkippedM = (bd.gapGuardSkippedM || 0) + straight;
        return 0;
      }
      // ★dt 暴走ガード★: 異常 dt は信用せず加算しない (過大ゼロ優先)。
      if (!(_dt > 0 && _dt < 120)) {
        stats.gapGuardSkipped = (stats.gapGuardSkipped || 0) + 1;
        bd.gapGuardSkippedM = (bd.gapGuardSkippedM || 0) + straight;
        return 0;
      }
      // ★走行中の穴 → 速度補足 fill★ (位置は使わず速度×dt)。fillSpd は coastSpdMps 優先
      //   (穴中 ×0.97 単調減衰の確立済み保守値)・未確立時のみ prev.spd を用いる。
      const _fillSpd = coastSpdMps >= 0 ? coastSpdMps : _prevSpd;
      let _fill = _fillSpd * _dt;
      // ── never-over キャップ (過大ゼロ担保) ──
      //   (1) 実測弦 straight を天井: ゴミ点位置由来でも距離を ★増やす★ 方向にしか効かないため
      //       過大抑制のみ (位置を距離に採用するのではなく fill の上限に使うだけ)。
      if (straight > 0 && _fill > straight) _fill = straight;
      //   (2) 弦の妥当倍率外 (straight 自体がゴミで極小) → 信用せず return 0。
      if (straight > 0.1 && _fill / straight > cfg.routingMaxRatio) {
        stats.gapGuardSkipped = (stats.gapGuardSkipped || 0) + 1;
        bd.gapGuardSkippedM = (bd.gapGuardSkippedM || 0) + straight;
        return 0;
      }
      if (!(_fill > 0)) {
        stats.gapGuardSkipped = (stats.gapGuardSkipped || 0) + 1;
        bd.gapGuardSkippedM = (bd.gapGuardSkippedM || 0) + straight;
        return 0;
      }
      // ★監査用: ゼロ消し (gapGuardSkippedM) とは別カウンタで fill 量を分離計上。
      stats.gapGuardFilled = (stats.gapGuardFilled || 0) + 1;
      bd.gapGuardFillM = (bd.gapGuardFillM || 0) + _fill;
      return _fill;
    }
    // ★parked-gap guard★ (acc 良好な長穴用): 長い穴を ★停止状態で入った★ なら駐車 drift → 加算しない。
    if (cfg.gapStationarySec != null) {
      const _dt = ((cur.t || 0) - (prev.t || 0)) / 1000;
      const _prevSpd = typeof prev.spd === 'number' ? prev.spd : -1;
      if (_dt > cfg.gapStationarySec && _prevSpd >= 0 && _prevSpd < cfg.stationarySpdMps) {
        stats.gapGuardSkipped = (stats.gapGuardSkipped || 0) + 1;
        bd.gapGuardSkippedM = (bd.gapGuardSkippedM || 0) + straight;
        return 0;
      }
    }
  }

  // ── ★★確定2択方式 (adaptiveMode・GPS精度で切替・2026-06-09 実トレース実証)★★ ──
  //   ① GPS良好(穴でない通常区間): 3D生GPS弦 を spd×dt×cap で頭打ち(走行ジッタ過大を物理上限で除去)。
  //   ② GPS穴(dt>holeDtSec) or 劣化(acc>accBadM): 速度×時間(位置ジッタに免疫・OBD較正/Doppler)。
  //   停止(ZUPT)は呼び出し側で 0 済。never-over = ①cap + ②速度過小側 + ZUPT で構造保証。
  if (cfg.adaptiveMode === true) {
    const _dtA = ((cur.t || 0) - (prev.t || 0)) / 1000;
    if (!(_dtA > 0)) return 0;
    // 3D化(高度差を弦に載せる・品質ゲート: |Δalt|/dt 物理上限超は GPS alt ノイズ→無視)
    let chord = straight;
    if (cfg.mode3D === true && typeof cur.alt === 'number' && typeof prev.alt === 'number') {
      const dz = cur.alt - prev.alt;
      if (Math.abs(dz) <= cfg.maxClimbMps * _dtA) {
        chord = Math.sqrt(straight * straight + dz * dz);
      }
    }
    // ★硬化 (2026-06-09・cert-gate creep根治)★: ② 速度充填は ★真のGPS穴(dt大)限定★ にする。
    //   旧実装は劣化(acc>accBadM)でも② speed×time に切替えたが、劣化-連続区間では spd×dt が
    //   平滑弦より過大に出て montecarlo劣化シナリオで 停車creep263m+過大3.86%(cert-gate hard-fail)。
    //   劣化acc は穴でない限り ① 平滑弦+cap(spd×dt×1.5)で処理=ジッタ過大を物理上限で抑え robust。
    //   トンネル(真の穴=dt>holeDtSec)は従来通り速度充填で回収(+306m)。urban canyon の速度免疫は
    //   別途 degraded ZUPT 設計を詰めてから再導入(今治にビル街無し=現データでは speed切替の利得ゼロ)。
    const _hole = _dtA > cfg.holeDtSec;
    if (_hole) {
      // ② 速度×時間。spd= speedProvider(OBD較正速度 or Doppler)。GPS穴(トンネル)を充填。
      if (spd >= 0) {
        const fill = spd * _dtA;
        // ★never-over 天井 (監査 overcount-guarantee 指摘・MODE②の構造ガード)★:
        //   穴明け点が出口加速していると spd_exit×dt が平均速度×dt を超過し過大化しうる。
        //   既存 gap 分岐と同規律で 直線弦の routingMaxRatio(4.0) 倍超 = 異常 → 直線弦へ落とす。
        //   トンネル実走(弦167m→fill306m=1.8倍)は通り、出口spike(4.5倍)は弦へ clamp。
        if (straight > 0.1 && fill / straight > cfg.routingMaxRatio) {
          stats.straightSegs = (stats.straightSegs || 0) + 1;
          bd.straightFallbackM = (bd.straightFallbackM || 0) + straight;
          return straight;
        }
        stats.dopplerSegs = (stats.dopplerSegs || 0) + 1;
        bd.dopplerM = (bd.dopplerM || 0) + fill;
        return fill;
      }
      // 速度不明の穴 = 直線弦(保守・creep は ZUPT 済)
      stats.straightSegs = (stats.straightSegs || 0) + 1;
      bd.straightFallbackM = (bd.straightFallbackM || 0) + chord;
      return chord;
    }
    // ① GPS良好: 3D生GPS弦を spd×dt×cap で頭打ち
    let mA = chord;
    if (spd >= 0) {
      const cap = spd * _dtA * cfg.adaptiveCapRatio;
      if (mA > cap) mA = cap;
    }
    stats.sameRoadSegs = (stats.sameRoadSegs || 0) + 1; // ①=生GPS良好区間(統計流用)
    bd.smoothedM = (bd.smoothedM || 0) + mA; // breakdown 流用(adaptive ① 距離)
    return mA;
  }

  // ── ★生GPS スムージング距離モード★ ──
  //   prev/cur は平滑済み位置 (acc/spd/t は生)。straight = 平滑弦。通常走行はこれをそのまま距離に
  //   採用する (平滑弦 ≤ 生弦 ≈ タイヤ = 過大ゼロ側)。長dt穴 (トンネル/間引き) は平滑弦で角を切らず
  //   下の Doppler/coast tail に回す (snap=null のため two-snap ブランチは飛ぶ)。
  //   停止 creep は呼び出し側 stationary 判定で従来通り 0 化。bad-acc は上の gap-guard で処理済。
  if (cfg.smoothedRawMode === true) {
    const _dtS = ((cur.t || 0) - (prev.t || 0)) / 1000;
    if (_dtS > 0 && _dtS <= cfg.smoothGapSec) {
      let sm = straight;
      // ★never-over Doppler 天井 (監査 CRITICAL-3)★: spd 判明時、平滑弦が spd×dt×ratio を超えたら抑制。
      //   微速の純ジッタが平滑弦に残って creep 化するのを遮断 (通常走行は平滑弦 ≤ spd×dt なので無影響)。
      if (spd >= 0) {
        const cap = spd * _dtS * cfg.smoothDopplerCapRatio;
        if (sm > cap) sm = cap;
      }
      stats.smoothedSegs = (stats.smoothedSegs || 0) + 1;
      bd.smoothedM = (bd.smoothedM || 0) + sm;
      return sm;
    }
    // ★長dt穴 (トンネル/間引き) の決定的処理★ (監査 CRITICAL-1 parity):
    //   stateful な coastSpdMps を使うと batch(coast=-1)と live tracker で分岐し parity が崩れる。
    //   そこで穴は ★状態を持たない決定的ルール★ で埋める: spd 判明 → Doppler(spd×dt・never-over cap)、
    //   spd 不明 → 平滑弦 straight (角切り・稀=99%は spd 有り)。両経路で batch==tracker を保証。
    if (_dtS > 0 && _dtS < 120 && spd >= 0) {
      // ★★STEP B: トンネル出口アンカー道路 routing 充填 (2026-06-12・長トンネル過少回収)★★:
      //   長穴は両端 GPS が tunnel entrance/exit でロード上。両端の ★生座標 (_rawLat/_rawLng)★ を
      //   道路 snap → 道路網 routing の道なり弧長で埋める。chord ≤ 道路弧 ≤ 実走 = 幾何 never-over。
      //   ★生座標を使う理由★: 平滑弦 (prev/cur.lat) は穴境界で窓が片側に偏り off-road へ寄りうる。
      //   発火しなければ (flag OFF / snap 失敗 / サニティ外) 下の従来 boundary/doppler fill に落ちる。
      //   ★parity★: batch/tracker とも同一 _smoothOnePoint で _rawLat/_rawLng を持ち同一 stepDistance を
      //   通るため、snap/routeDistance は決定的 (道路データのみに依存) で batch==tracker を保つ。
      if (
        cfg.tunnelRouteFill === true &&
        router &&
        decoder &&
        typeof decoder.snapToNearestRoad === 'function'
      ) {
        const _rpLat = typeof prev._rawLat === 'number' ? prev._rawLat : prev.lat;
        const _rpLng = typeof prev._rawLng === 'number' ? prev._rawLng : prev.lng;
        const _rcLat = typeof cur._rawLat === 'number' ? cur._rawLat : cur.lat;
        const _rcLng = typeof cur._rawLng === 'number' ? cur._rawLng : cur.lng;
        const _rawChord = haversineM(_rpLat, _rpLng, _rcLat, _rcLng);
        // 遠距離 (道路網外れ=真の gap) は routing せず従来 fill。微小弦も snap ノイズで除外。
        if (_rawChord > 1 && _rawChord <= cfg.tunnelRouteMaxStraightM) {
          const _snapA = decoder.snapToNearestRoad(_rpLat, _rpLng, { maxDistM: cfg.snapMaxDistM });
          const _snapB = decoder.snapToNearestRoad(_rcLat, _rcLng, { maxDistM: cfg.snapMaxDistM });
          if (_snapA && _snapB) {
            const _routed = router.routeDistance(_snapA, _snapB);
            // ── never-over 多段サニティ (どれか外れたら従来 fill へ落とす=純加算回収) ──
            //   (1) routed ≥ rawChord×0.9 : 弦より極端に短い routing は snap 誤り → 不採用。
            //   (2) routed ≤ rawChord×routingAcceptMaxRatio(2.5) : 過大な迂回 (flip 検出済の閾) を弾く。
            //   (3) routed ≤ tunnelRouteMaxM : 絶対上限 (暴走遮断)。
            //   (4) routed ≤ spd×dt×routingMaxRatio : 出口速度由来の物理上限を併用 (過大ゼロ保険)。
            if (
              _routed != null &&
              _routed >= _rawChord * 0.9 &&
              _routed <= _rawChord * cfg.routingAcceptMaxRatio &&
              _routed <= cfg.tunnelRouteMaxM &&
              _routed <= spd * _dtS * cfg.routingMaxRatio
            ) {
              stats.tunnelRouteSegs = (stats.tunnelRouteSegs || 0) + 1;
              bd.tunnelRouteM = (bd.tunnelRouteM || 0) + _routed;
              return _routed;
            }
          }
        }
      }
      // ★両端速度台形補間(公知) 穴埋め★: 穴は (入口GPS, 出口GPS) の両端に拘束。
      //   spd = 出口点速度 (gpsSpeedProvider(cur) = cur.spd)。prev.spd = 入口点速度。
      //   両端速度が揃えば 1区間両端拘束の最小加速度解 = 台形積分 (v0+v1)/2 × dt を採用し、
      //   片端 (入口) 外挿のドリフトを除く (出口で帳尻 → 過大に伸びにくい)。どちらか欠ければ片端式。
      let fill = spd * _dtS; // 既定 = 従来の片端 (出口速度×dt)
      let fillReason = 'doppler';
      if (cfg.boundaryGapFill === true) {
        const v0 = typeof prev.spd === 'number' && prev.spd >= 0 ? prev.spd : -1;
        const v1 = spd; // 出口速度 (>=0 が if 条件で保証済)
        if (v0 >= 0) {
          fill = ((v0 + v1) / 2) * _dtS; // 両端アンカー台形 (= 区間一定加速度の厳密距離)
          fillReason = 'boundary';
        }
      }
      // ── never-over (両端拘束でも保険として温存) ──
      if (straight > 0.1 && fill / straight > cfg.routingMaxRatio) {
        stats.straightSegs++;
        bd.straightFallbackM += straight;
        return straight;
      }
      if (fillReason === 'boundary') {
        stats.boundaryGapSegs = (stats.boundaryGapSegs || 0) + 1;
        bd.boundaryGapM = (bd.boundaryGapM || 0) + fill;
      } else {
        stats.dopplerSegs++;
        bd.dopplerM += fill;
      }
      return fill;
    }
    stats.straightSegs++;
    bd.straightFallbackM += straight;
    return straight;
  }

  // ── 両端 snap 成功 ──
  if (prevSnap && snap) {
    const r = decoder.calcRoadDistance(prevSnap, snap);
    if (r && typeof r.distanceM === 'number' && r.distanceM >= 0) {
      // 同一道路 → 弧長をそのまま採用
      if (r.onSameRoad) {
        if (r.distanceM > cfg.perSegmentMaxM) {
          // 異常に長い弧 (snap 誤り) → 直線 fallback
          stats.straightSegs++;
          bd.straightFallbackM += straight;
          return straight;
        }
        stats.sameRoadSegs++;
        const segDist = _recoverArc(r.distanceM, straight, prev, cur, spd, cfg, bd, stats);
        bd.sameRoadM += segDist;
        return segDist;
      }

      // ── 別道路 → ★L2 連結性ハード拘束 + 道路網 routing で道なり距離★ ──
      // 遠距離 (gap 等) は routing せず後段 (真の gap = 直線/Doppler) に回す。
      if (router && straight <= cfg.routingMaxStraightM) {
        const routed = router.routeDistance(prevSnap, snap);
        if (routed != null && routed >= 0) {
          const refStraight = straight > 0.1 ? straight : 0.1;
          // ★連結性 OK (道路網で繋がっている = 正当な交差点/分岐通過)★ → 道なり routing 距離を採用。
          //   ★過大ゼロ de-bias★: 受理上限は専用 routingAcceptMaxRatio(=2.5)。ノイズGPSの flip 迂回を弾く。
          //   (never-over ガード routingMaxRatio=4.0 とは分離・トンネル coast 等は不変)
          if (routed / refStraight <= cfg.routingAcceptMaxRatio && routed <= cfg.perSegmentMaxM) {
            stats.routedSegs++;
            bd.routedM += routed;
            return routed;
          }
          // routing 過大 (遠回り) → 偽遷移扱いで下の連結性拘束へ落とす。
          stats.routingFallbacks++;
        }
        // ★★ ここに到達 = 道路網 routing 不能 or 過大 = ★偽遷移 (繋がってない道へ flip)★ ★★
        //   司さん核心:「greedy の別道路 flip (余計な弦) が距離を水増し」。
        //   対策 = ★連結性ハード拘束★: flip を ★棄却★ し、現点を ★前点の道路 (prevSnap.roadIndex)★ に
        //   投影し直す。snapMaxDistM 内に乗れば「実際は同一道路の連続走行・snap が隣道/対向へ
        //   flip しただけ」= 道なり弧長 (前道路 polyline 沿い) で算出 → 余計な弦が距離に入らない。
        //   ★距離の小細工はしない (弦補正係数なし)・正しい道路を読み直すだけ★。
        const reSnap = snapPointToRoad(
          decoder,
          cur.lat,
          cur.lng,
          prevSnap.roadIndex,
          cfg.snapMaxDistM
        );
        if (reSnap) {
          const rr = decoder.calcRoadDistance(prevSnap, reSnap);
          if (
            rr &&
            rr.onSameRoad &&
            typeof rr.distanceM === 'number' &&
            rr.distanceM >= 0 &&
            rr.distanceM <= cfg.perSegmentMaxM
          ) {
            stats.sameRoadSegs++;
            stats.flipRejected = (stats.flipRejected || 0) + 1; // 偽遷移棄却カウント (監査用)
            bd.flipRejectedM = (bd.flipRejectedM || 0) + rr.distanceM; // 棄却 flip の補正距離 (監査用)
            bd.sameRoadM += rr.distanceM;
            return rr.distanceM;
          }
        }
      }
      // 連結性拘束でも救えない (= 真に別道路 / 遠距離 gap で前道路へ乗らない) → 直線 fallback。
      stats.straightSegs++;
      let sLine = r.distanceM; // 別道路時は haversine(snapA,snapB)
      if (sLine > cfg.perSegmentMaxM) sLine = straight;
      bd.straightFallbackM += sLine;
      return sLine;
    }
  }

  // ── どちらか snap 失敗 → Doppler 速度積分で補間 ──
  const dtSec = ((cur.t || 0) - (prev.t || 0)) / 1000;
  if (spd >= 0) {
    if (dtSec > 0 && dtSec < 120) {
      const dop = spd * dtSec;
      // 過大ガード: Doppler 値が直線距離の routingMaxRatio 倍超なら直線
      if (straight > 0.1 && dop / straight > cfg.routingMaxRatio) {
        stats.straightSegs++;
        bd.straightFallbackM += straight;
        return straight;
      }
      stats.dopplerSegs++;
      bd.dopplerM += dop;
      return dop;
    }
  }

  // ── ★coasting★: 当該点速度が不明 (spd<0) かつ 直近 snap 成功点で速度を確立済 (coastSpdMps>=0) ──
  //   GPS 穴 (トンネル/ビル街の snap 失敗連続) 中も「直前の Doppler/GPS 点速度を等速保持 × dt」で
  //   distance_m を前進させる。点速度ベースのため過大バイアスが付かない (Ranacher)。
  //   ★加速度二重積分はしない (発散)・等速保持のみ★。穴脱出 (snap 成功) で実速度に即復帰。
  if (coastSpdMps >= 0 && dtSec > 0 && dtSec < 120) {
    let coast = coastSpdMps * dtSec;
    // ★never-over クランプ (2026-05-31 監査官指摘・課金安全の要)★:
    //   spd 欠落点を過去の保持速度で coast すると、穴中に車が減速した場合 (保持速度 > 実速度) に
    //   実際の変位を超えて過大課金しうる (最大 +44% 実測)。観測された GPS 弦 straight (= 両点間の
    //   実直線変位) を never-over 天井とし、coast がこれを超えないようにする。
    //   straight は path 長の下限だが、過大ゼロ (認定 −4%〜0%) を最優先し実測変位で coast を抑える
    //   (発火は spd 欠落かつ減速の稀ケースのみ・通常は Doppler 点速度で正確)。
    if (straight > 0 && coast > straight) coast = straight;
    // 同じ過大ガード: coast が直線距離の routingMaxRatio 倍超なら直線 (= GPS 復活点との弦の妥当倍率内)。
    if (straight > 0.1 && coast / straight > cfg.routingMaxRatio) {
      stats.straightSegs++;
      bd.straightFallbackM += straight;
      return straight;
    }
    stats.coastSegs = (stats.coastSegs || 0) + 1;
    bd.coastM = (bd.coastM || 0) + coast;
    return coast;
  }

  // ── 最終 fallback: 直線 ──
  stats.straightSegs++;
  bd.straightFallbackM += straight;
  return straight;
}

// ─── createDistanceTracker (★インクリメンタル API・live meter 用★) ──────────
// computeDistance は sample 列バッチだが、live meter は GPS を 1 点ずつ受ける。
// stateful な tracker を返し、ingest(sample) ごとに当該区間の道なり加算を確定する。
//
//   const tk = createDistanceTracker(decoder, opts);
//   tk.ingest({lat,lng,t,acc,spd}) -> { deltaM, totalM, reason }
//   tk.totalM()  -> 現在の累積 distance_m
//   tk.reset()   -> 状態クリア (業務開始/再計測)
//
// ★バッチ一致保証★: 同一 trace を「同じ順序」で 1 点ずつ ingest した totalM() は
//   computeDistance(...).distance_m と一致する。理由:
//     - 区間距離は computeDistance と同一の stepDistance / 静止判定を呼ぶ。
//     - router を共有し localグラフキャッシュも効く。
//   注意: computeDistance は内部で t 昇順 sort する。tracker は live streaming のため
//   全体 sort できない (未来点が未到着)。代わりに ★out-of-order ガード★ で
//   cur.t < prev.t の遅延到着/順序逆転フレームを破棄し (reason:'out_of_order')、
//   computeDistance(sort 済) と同一の単調増加列だけを処理する。これにより
//   遅延到着フレームによる距離水増しを防ぐ。回帰テストは sort 済み列で一致を確認する。
//
// reason 値: 'first' | 'stationary' | 'sameRoad' | 'routed' | 'straight' | 'doppler'
//   | 'skip' (無効点) | 'out_of_order' (t 逆転で破棄)
//   (区間の分類。課金境界差込時のデバッグ/監査用。calcFare は一切呼ばない。)
function createDistanceTracker(decoder, opts) {
  opts = opts || {};
  const cfg = {};
  for (const k in DEFAULTS) cfg[k] = opts[k] != null ? opts[k] : DEFAULTS[k];
  // ★M2 (監査)★: adaptiveMode は平滑土台が必須前提(生GPS弦は愛媛+1.9%過大=過大請求)。
  //   smoothedRawMode を強制 true にし、暗黙依存で過大ゼロが黙って崩れるフットガンを構造的に塞ぐ。
  if (cfg.adaptiveMode === true) cfg.smoothedRawMode = true;
  const speedProvider =
    typeof opts.speedProvider === 'function' ? opts.speedProvider : gpsSpeedProvider;
  const enableRouting = opts.enableRouting !== false;
  // ★reset で完全初期化するため let (= 状態漏れ根絶のため新インスタンス再生成可能に)
  let router = enableRouting ? new RoadGraphRouter(decoder, cfg) : null;
  let snapper = opts.useSnapCache === false ? null : new SnapCache(decoder, cfg);

  let total = 0;
  let prev = null;
  let prevSnap = null;
  // ★coasting 速度★ (B): 直近の有効点速度 (m/s・-1=未確立)。GPS 穴中の補間に使う。
  let coastSpdMps = -1;
  // ★stop-in-hole creep ガード状態 (synthetic coast 専用・1穴単位)★:
  //   合成 coast 連続区間 (= 1 つの GPS 穴) の累積 時間/距離 と「凍結フラグ」。
  //   非 synthetic 点 (実 GPS 復帰) または OBD 点で穴が明けたらリセットする。
  let coastHoleSec = 0; // この穴で合成 coast を積分した累積秒数
  let coastHoleM = 0; // この穴で合成 coast が前進させた累積距離 m
  let coastHoleFrozen = false; // この穴は cap/減速停車で前進停止済 (以後 synthetic は 0)
  // ★OBD δ 自己キャリブ状態 (obdDeltaCalib)★: 良GPS窓で (GPS位置距離 − ∫OBD) を貯め δ を学習。
  let calGpsM = 0; // 良GPS窓の GPS位置距離 累積 (m)
  let calObdIntM = 0; // 同窓の ∫OBD(spd×dt) 累積 (m)
  let calTimeS = 0; // 同窓の移動時間 累積 (s)
  let obdDeltaMps = 0; // 学習済 δ (m/s)
  let obdDeltaInit = false; // δ を1回でも確定したか
  // breakdown/stats を区間分類のため保持 (stepDistance が要求する構造)
  let bd, stats;
  function freshAccum() {
    bd = {
      sameRoadM: 0,
      routedM: 0,
      straightFallbackM: 0,
      dopplerM: 0,
      coastM: 0,
      gapGuardSkippedM: 0,
      gapGuardFillM: 0,
      smoothedM: 0, // ★生GPS平滑距離 (smoothedRawMode・監査 MAJOR-4)
      tunnelRouteM: 0, // ★STEP B: トンネル出口アンカー routing 充填の回収距離 (監査用・固定形状)
      stationarySkipped: 0,
      arcRecoverM: 0, // ★地力 de-bias: 同一道路 arc 回収で増えた距離 (監査用)
      obdM: 0, // ★OBD メイン: ∫v(OBD) で加算した距離 (監査用・δ自己キャリブ適用後)
      obdRawM: 0, // ★OBD 生∫v(k=1・δ未適用)★: 今の OBD の素の精度を真距離と突合する用 (司さん要望)
    };
    stats = {
      points: 0,
      snapHit: 0,
      snapMiss: 0,
      sameRoadSegs: 0,
      routedSegs: 0,
      straightSegs: 0,
      dopplerSegs: 0,
      coastSegs: 0,
      routingFallbacks: 0,
      tunnelRouteSegs: 0, // ★STEP B: トンネル routing 充填が発火した区間数 (監査用・固定形状)
      gapGuardSkipped: 0,
      gapGuardFilled: 0,
      arcRecovered: 0, // ★地力 de-bias: arc 回収が発火した区間数 (監査用)
      obdSegs: 0, // ★OBD メイン: ∫v(OBD) で駆動した区間数 (監査用)
    };
  }
  freshAccum();

  function classifyReason(beforeStats) {
    if (stats.sameRoadSegs > beforeStats.sameRoadSegs) return 'sameRoad';
    if (stats.routedSegs > beforeStats.routedSegs) return 'routed';
    if (stats.dopplerSegs > beforeStats.dopplerSegs) return 'doppler';
    if ((stats.coastSegs || 0) > (beforeStats.coastSegs || 0)) return 'coast';
    if (stats.straightSegs > beforeStats.straightSegs) return 'straight';
    return 'straight';
  }

  // ★smoothedRawMode 遅延バッファ (監査 CRITICAL-1・本番課金経路に平滑を実装)★:
  //   live は未来点が要る双方向窓を即時計算できないため、生点を smoothBuf に貯め、後続が h 点
  //   揃った中心点を _smoothOnePoint(batch と同一関数) で確定し _core へ流す (= batch と parity)。
  //   末尾 h 点は flush() で片側窓確定。reset で破棄。OFF では一切使わない (従来1byte不変)。
  const smParams = _smoothParams(cfg);
  let smoothBuf = [];
  let smoothNext = 0;

  // 検証済み 1 点を処理する core (snap は smoothedRawMode では使わない=null)。
  function _core(cur) {
    stats.points++;
    // ★smoothedRawMode★: snap は距離に使わない (平滑弦が距離) → null。Viterbi ext snap も使わない。
    let snap = null;
    if (cfg.smoothedRawMode !== true && cfg.adaptiveMode !== true) {
      // ★L1 配線 (2026-05-31・clean-rebuild-pipeline・距離源を Viterbi 確定経路へ一本化):
      //   sample.snap が渡された場合 (= Worker B が Viterbi emission/transition で選んだ
      //   bestEmit/outSnap)、その ★Viterbi 確定 snap★ を距離計算に使う。greedy per-point
      //   SnapCache.snap (= 最近傍 nearest-neighbor) は ★呼ばない★。
      //   これにより距離源が「greedy 最近傍 snap」ではなく「HMM の確定 snap」になる (= (c) 配線完全)。
      //   externalSnap が roadIndex/snapLat/snapLng を満たす時のみ採用・不足時のみ従来 snap に退避。
      const ext = cur.snap;
      if (
        ext &&
        Number.isFinite(ext.roadIndex) &&
        Number.isFinite(ext.snapLat) &&
        Number.isFinite(ext.snapLng)
      ) {
        // Viterbi 確定 snap を pipeline の snap 形式へ正規化 (stepDistance/calcRoadDistance が要求する key)。
        snap = {
          roadIndex: ext.roadIndex,
          segmentIndex: ext.segmentIndex,
          t: ext.t,
          snapLat: ext.snapLat,
          snapLng: ext.snapLng,
          distanceM: ext.distanceM,
          typeCode: ext.typeCode,
        };
        stats.viterbiSnaps = (stats.viterbiSnaps || 0) + 1;
      } else {
        snap = snapper
          ? snapper.snap(cur.lat, cur.lng)
          : decoder.snapToNearestRoad(cur.lat, cur.lng, { maxDistM: cfg.snapMaxDistM });
      }
    }
    if (snap) stats.snapHit++;
    else stats.snapMiss++;

    if (!prev) {
      prev = cur;
      prevSnap = snap;
      return { deltaM: 0, totalM: total, reason: 'first' };
    }

    // 静止判定 (ZUPT) — computeDistance と同一ロジック
    const spd = speedProvider(cur, prev);

    // ★★ OBD メインモード (2026-06-05・obd ブランチ・2026-06-08 平滑土台へ統合) ★★:
    //   速度源が ★OBD 車輪速度★ (cur.obd===true) の時は、距離を ★∫v(OBD)=車輪速度×dt の積分★ で
    //   駆動する (= タクシー認定メーター/国交省ソフトメーター方式・タイヤ値直結)。
    //   ★smoothedRawMode (平滑生GPS弦) より優先★: OBD は車輪源で最も信頼でき、平滑/snap-arc は
    //   OBD が無効/未接続/iPhone の時のフォールバックに退く。∫v は spd×dt のみで位置に依存しないため
    //   平滑バッファを透過 (= cur が平滑点でも spd/t は生のまま保持され ∫v は正しい)。
    //   cur.obd は map-matcher が msg.speedSrc==='obd' (gps.js: OBD_DRIVE_DISTANCE on かつ鮮度OK)
    //   の時だけ立てる。★cur.obd 未設定の通常 GPS 経路は完全に従来通り (byte 不変)★。
    //   停止は OBD 速度 0 で自然に 0 加算(ZUPT 不要)。異常 dt は弾く(過大ゼロ保険)。
    //   ★adaptiveMode では OBD で全距離を駆動しない(実機-3.86%で悪化)★: OBD速度は ① の cap と
    //   ② の穴埋め speed源として spd 経由で使う(下流 stepDistance)。よってここは短絡しない。
    if (cur.obd === true && spd >= 0 && cfg.adaptiveMode !== true) {
      const dtObd = ((cur.t || 0) - (prev.t || 0)) / 1000;
      // ★δ 自己キャリブ (obdDeltaCalib・floor過小補正)★: 良GPS区間(精度OK+移動中+ジッタ無し)で
      //   GPS位置距離と ∫OBD を貯め、calMinWindowS 秒ごとに δ=(GPS−∫OBD)/移動時間 を確定。
      //   ★短絡 return 前に学習★(監査HIGH#1: δ計算は OBD return より先)。GPS弦は位置のみ使用。
      if (
        cfg.obdDeltaCalib === true &&
        dtObd > 0 &&
        dtObd <= cfg.obdMaxDtS &&
        spd >= cfg.stationarySpdMps
      ) {
        const _gpsChord = haversineM(prev.lat, prev.lng, cur.lat, cur.lng);
        const _accCur = typeof cur.acc === 'number' && cur.acc >= 0 ? cur.acc : -1;
        const _accPrev = typeof prev.acc === 'number' && prev.acc >= 0 ? prev.acc : -1;
        const _accOk =
          (_accCur < 0 || _accCur <= cfg.calMaxAccM) &&
          (_accPrev < 0 || _accPrev <= cfg.calMaxAccM);
        // ジッタ汚染窓(弦が spd×dt×ratio 超)は母集団から除外=δ を過大学習させない(never-over)。
        if (_accOk && _gpsChord <= spd * dtObd * cfg.calMaxChordRatio) {
          calGpsM += _gpsChord;
          calObdIntM += spd * dtObd;
          calTimeS += dtObd;
          if (calTimeS >= cfg.calMinWindowS) {
            let dNew = (calGpsM - calObdIntM) / calTimeS;
            if (dNew < cfg.obdDeltaMinMps) dNew = cfg.obdDeltaMinMps;
            if (dNew > cfg.obdDeltaMaxMps) dNew = cfg.obdDeltaMaxMps;
            obdDeltaMps = obdDeltaInit
              ? cfg.calEwmaOld * obdDeltaMps + cfg.calEwmaNew * dNew
              : dNew;
            obdDeltaInit = true;
            calGpsM = 0;
            calObdIntM = 0;
            calTimeS = 0;
          }
        }
      }
      let obdDelta = 0;
      if (dtObd > 0 && dtObd <= cfg.obdMaxDtS) {
        // ∫(v+δ)。δ は ±0.5km/h クランプ済 = floor過小ぶんだけ持ち上げ過大暴走しない。
        // ★δ は移動中(spd≥stationarySpdMps)のみ適用★: δ は「走行中に1km/h floorで失った量子化分の回収」
        //   であり、停車/微速(OBD≈0)区間に δ を足すと creep を製造して認定要件(<10m/30s)を破る。
        //   学習ゲート(L1744 spd≥stationarySpdMps)と対称に、適用も移動区間に限定=停車で δ 非作用。
        const applyDelta =
          cfg.obdDeltaCalib === true && obdDeltaInit && spd >= cfg.stationarySpdMps;
        const vEff = applyDelta ? spd + obdDeltaMps : spd;
        obdDelta = (vEff > 0 ? vEff : 0) * dtObd;
        // ★raw ∫v(OBD)(k=1・δ未適用) 並行記録 (司さん要望)★: distance_m には一切影響させず、
        //   「今の OBD の素の精度」を真距離と突合する監査ベースラインとして bd.obdRawM に別積算する。
        //   k 補正/δ補正を入れる ★前★ の生車輪積分なので、これと真距離の差が補正係数の根拠になる。
        bd.obdRawM = (bd.obdRawM || 0) + (spd > 0 ? spd : 0) * dtObd;
      }
      total += obdDelta;
      stats.obdSegs = (stats.obdSegs || 0) + 1;
      bd.obdM = (bd.obdM || 0) + obdDelta;
      coastSpdMps = spd; // 連続性: 次区間のフォールバック用に実速度を保持
      prev = cur;
      prevSnap = snap;
      return { deltaM: obdDelta, totalM: total, reason: 'obd' };
    }

    // ★★合成タイマー連続前進 coast 枝 (2026-06-10・トンネル一括ドン根治)★★:
    //   sample.synthetic===true (gps.js _gapTick・GPS stale 中の穴埋め点) で OBD でない場合は、
    //   ★位置据え置き (弦=0) のため smoothedRawMode の平滑弦が距離を出せない★。よって ★speed×dt の
    //   coast 積分★ で距離を前進させる (= 二葉方式・国交省ソフトメーター「GNSS 不能時は速度で位置補正」)。
    //   ★never-over★: 速度 spd は呼出側 (gps.js) で毎 tick ×0.97 減衰済の保守ホールド値。distance は
    //   spd×dt のみ (位置非依存) で過大バイアスが付かない。異常 dt (>obdMaxDtS) は加算しない (過大ゼロ保険)。
    //   ★二重計上の核★: この枝も prev=cur で ★prev.t を合成点時刻へ前進★ させる。これにより GPS 復帰
    //   時の本物 fix は dt=(復帰t − 直前合成t)≈tick となり、smoothedRawMode の never-over cap
    //   (spd×dt×smoothDopplerCapRatio) で「トンネル全長の弦」が tick 相当へクランプされ「ドン」が消える。
    //   穴明け区間 = 合成 fill + 復帰点の微小残差 = 加法的に正しく一致 (トンネル全長を二度数えない)。
    //   停車是認: spd<stationarySpdMps は前進 0 (creep 防止)。gps.js 側も COAST_MIN_KMH で 0 化済。
    if (cur.synthetic === true && cfg.adaptiveMode !== true) {
      const dtSyn = ((cur.t || 0) - (prev.t || 0)) / 1000;
      let synDelta = 0;
      // ★★stop-in-hole creep 多層ガード (監査 P0)★★: OBD 点 (cur.obd) は車輪速度が停車で正しく 0
      //   になるため対象外。非OBD の合成 coast のみ、1穴あたりの 累積時間/距離/減速停車 で凍結する。
      const _obdCoast = cur.obd === true;
      if (!_obdCoast) {
        // (c) 減速停車検出: 合成ホールド速度が creep 速度域まで減衰したら以後この穴は前進停止。
        //   0.97/s 減衰の長い裾 (例 40km/h→0.5km/h に 144s) を creep として積分し続けない。
        if (spd >= 0 && spd < cfg.coastFreezeSpdMps) coastHoleFrozen = true;
      }
      if (
        spd >= cfg.stationarySpdMps &&
        dtSyn > 0 &&
        dtSyn <= cfg.obdMaxDtS &&
        (_obdCoast || !coastHoleFrozen)
      ) {
        synDelta = spd * dtSyn;
        if (!_obdCoast) {
          // (a) 累積時間 cap / (b) 累積距離 cap: 超過分は加算せず、超過後は穴明けまで凍結。
          const remSec = cfg.coastHoleMaxSec - coastHoleSec;
          const remM = cfg.coastHoleMaxM - coastHoleM;
          let allowM = synDelta;
          if (remSec <= 0 || remM <= 0) {
            allowM = 0;
            coastHoleFrozen = true;
          } else {
            // 時間 cap に届く分だけ許可 (端数 tick で時間超過する場合は速度比で按分)
            if (dtSyn > remSec) {
              allowM = Math.min(allowM, spd * remSec);
              coastHoleFrozen = true;
            }
            if (allowM > remM) {
              allowM = remM;
              coastHoleFrozen = true;
            }
          }
          coastHoleSec += dtSyn;
          coastHoleM += allowM;
          synDelta = allowM;
        }
      }
      total += synDelta;
      stats.coastSegs = (stats.coastSegs || 0) + 1;
      bd.coastM = (bd.coastM || 0) + synDelta;
      if (spd >= 0) coastSpdMps = spd; // 連続性: 次区間/復帰点の保守ホールド初速を更新
      prev = cur;
      prevSnap = snap;
      return { deltaM: synDelta, totalM: total, reason: 'coast' };
    }
    // 非 synthetic 点 (実 GPS 復帰 or OBD) = 穴が明けた → stop-in-hole ガード状態をリセット。
    if (coastHoleSec !== 0 || coastHoleM !== 0 || coastHoleFrozen) {
      coastHoleSec = 0;
      coastHoleM = 0;
      coastHoleFrozen = false;
    }

    const disp = haversineM(prev.lat, prev.lng, cur.lat, cur.lng);
    let stationary = false;
    if (spd >= 0) {
      if (spd < cfg.stationarySpdMps) stationary = true;
    } else {
      if (isStationaryByDisplacement(prev, cur, disp, cfg)) stationary = true;
    }
    if (stationary) {
      bd.stationarySkipped++;
      // ★stale-coast creep guard (2026-06-03・監査 CRITICAL②根治)★:
      //   静止 (ZUPT) 区間でも coastSpdMps を ★停止速度へ即時降下★ させる。これを怠ると
      //   「走行 → 停止 → ゴミGPS穴」の順で coastSpdMps が停止前の走行速度を保持し続け、
      //   gapGuard の _entrySpd (= coastSpdMps 優先) が停止中なのに走行速度を読み、parked
      //   ゲート (_entrySpd < stationarySpdMps) を素通りして停止中に phantom fill (= creep) を
      //   生む (memory Fix④ と同一クラス)。停止を観測した時点で「穴入口直前の確かな速度 = 停止」
      //   が真であるため coastSpdMps を実測停止速度に揃える。
      //     ・spd 判明 (>=0) → その停止速度 (≈0) を採用 → 次の穴は parked 扱いで return 0。
      //     ・spd 不明 (-1) → displacement で静止と判定された区間 → coastSpdMps を 0 にクリア
      //       (停止が確定しているため確実に parked へ落とす)。
      // ★しまなみ修正 (2026-06-05・iOS 橋上 GPS 穴の −570m 過少根治)★:
      //   ただし「静止判定の根拠が低信頼な点」= bad-accuracy (> gapGuardAccM) や dt=0 の重複 fix は
      //   ★本物の停止ではなく GPS 穴中のゴミ/重複点★。これで coastSpdMps を 0 にすると、穴明けの
      //   実走行区間 (実機 SE しまなみ idx1390: 87km/h・896m) が _entrySpd=0 で parked 扱い棄却され
      //   丸ごと −570m 過少になる (SE 34km→1.6km 系の距離損失の一因)。低信頼な静止点では coastSpdMps
      //   を ★0 にせず保持 (従来の穴中減衰 ×0.97 のみ)★ し、穴明けの走行を殺さない。
      //   ★creep 安全★: 本物の停止は良 accuracy + 実 dt の点が連続するため _lowConfidenceStop=false で
      //   従来どおり 0 クリア = 停止中 creep は不変 (低信頼点 1 点が混じっても次の確定停止点で 0 化)。
      const _accCurStat = typeof cur.acc === 'number' && cur.acc >= 0 ? cur.acc : -1;
      const _dtCurStat = ((cur.t || 0) - (prev.t || 0)) / 1000;
      const _lowConfidenceStop =
        (cfg.gapGuardAccM != null && _accCurStat > cfg.gapGuardAccM) || _dtCurStat <= 0;
      if (spd >= 0) {
        coastSpdMps = spd; // Doppler 判明 = 信頼できる停止速度 (≈0) を採用
      } else if (!_lowConfidenceStop) {
        coastSpdMps = 0; // 高信頼な変位停止 → 0 クリア (= 従来動作・creep 防止)
      } else if (coastSpdMps >= 0) {
        coastSpdMps = coastSpdMps * 0.97; // 低信頼(bad-acc/dup) → 保持し穴中減衰のみ (穴明け走行を殺さない)
      }
      prev = cur;
      prevSnap = snap;
      return { deltaM: 0, totalM: total, reason: 'stationary' };
    }

    const beforeStats = {
      sameRoadSegs: stats.sameRoadSegs,
      routedSegs: stats.routedSegs,
      straightSegs: stats.straightSegs,
      dopplerSegs: stats.dopplerSegs,
      coastSegs: stats.coastSegs || 0,
    };
    // ★coasting (B)★: この区間は「前点までに確立した coastSpdMps」で補間する。
    //   よって stepDistance には更新前の coastSpdMps を渡す (= 因果順序の保持)。
    const added = stepDistance(
      decoder,
      router,
      prev,
      cur,
      prevSnap,
      snap,
      spd,
      cfg,
      bd,
      stats,
      coastSpdMps
    );
    let delta = added > 0 ? added : 0;
    // ★★P0 根治 (2026-06-10・監査 CRITICAL=過大ゼロ違反)★★:
    //   合成タイマー fill 直後の「穴明け実点」で速度不明 (speedSrc='hav' → spd=-1) の時、設計が頼る
    //   smoothedRawMode の never-over cap (spd×dt×ratio) が ★spd>=0 ゲートでスキップ★ され、
    //   prev(=位置据え置きの穴入口) → cur(穴出口) の「トンネル全長の弦」が無 cap で返り、合成 fill に
    //   ★二重加算★ されて +41% 過大化する (実証 1698m vs 真 1200m)。これは過大ゼロ(認定)違反。
    //   → 合成直後 (prev.synthetic===true) かつ spd<0 の弦は、合成 fill が維持した coastSpdMps を
    //     フォールバック速度に cap (coastSpdMps×dt×smoothDopplerCapRatio) して tick 相当へ頭打ちする。
    //     = 設計が意図した never-over cap を Doppler 不在でも成立させ「ドン」の二重計上を断つ。
    //   ★OBD/Doppler 有時 (spd>=0) は従来の cap が効くため不変。穴は合成 fill 分だけ計上 (保守=過大ゼロ側)。★
    if (prev.synthetic === true && spd < 0 && coastSpdMps >= 0) {
      const _dtExit = ((cur.t || 0) - (prev.t || 0)) / 1000;
      if (_dtExit > 0) {
        const _exitCap = coastSpdMps * _dtExit * cfg.smoothDopplerCapRatio;
        if (delta > _exitCap) delta = _exitCap;
      }
    }
    total += delta;
    const reason = classifyReason(beforeStats);

    // ★coastSpdMps 更新 (B-1 + B-2・never-over)★:
    //   ・当該点速度 (spd) が判明 → coasting 速度を実速度で再確立。ただし ★上方は即時・下方も即時★
    //     とすると穴中の単発 spike で過大化しうるため、減速 (spd < 現 coast) は即反映 (下方更新)、
    //     加速側も実速度を採用 (snap 成功点 = 道路上を読めており速度が信頼できる)。
    //   ・spd 不明 (穴中) → coastSpdMps を僅かに減衰 (0.97)。穴が伸びるほど保守側へ寄せ
    //     never-over を担保 (= 恒久過小係数ではなく穴中の不確かさ処理・snap 復帰で実速度に即解除)。
    if (spd >= 0) {
      if (snap) {
        coastSpdMps = spd; // snap 成功 = 信頼できる点速度で再確立 (上方/下方とも)
      } else if (coastSpdMps < 0 || spd < coastSpdMps) {
        coastSpdMps = spd; // snap 失敗でも減速側は即反映 (過大防止)
      }
    } else if (coastSpdMps >= 0) {
      coastSpdMps = coastSpdMps * 0.97; // 穴中 (spd 不明) は単調減衰で保守側へ
    }

    prev = cur;
    prevSnap = snap;
    return { deltaM: delta, totalM: total, reason: reason };
  }

  return {
    ingest: function (sample) {
      if (!sample || !Number.isFinite(sample.lat) || !Number.isFinite(sample.lng)) {
        // 無効点 (null/NaN/Infinity) は computeDistance の入力整形と同様に黙殺 (距離影響なし)
        return { deltaM: 0, totalM: total, reason: 'skip' };
      }
      // ★OBD バイパス (2026-06-08)★: OBD 速度源 (sample.obd===true) の点は ★平滑バッファを通さず★
      //   即座に _core へ流し ∫v(OBD) で距離駆動する。理由: 平滑は GPS 位置ジッタ除去のためで、
      //   ∫v は spd×dt のみ (位置非依存) ゆえ平滑は無意味。かつライブメーターは遅延ゼロが望ましい
      //   (h サンプル遅延を作らない)。out-of-order は prev で判定 (非平滑と同基準)。
      //   OBD 全行程なら smoothBuf は空のまま (= 平滑経路に一切干渉しない)。混在遷移時も prev 連続性は保持。
      //   ★adaptiveMode では OBD 全駆動しない(平滑土台+穴埋め)ため、OBD点もバイパスせず平滑経路へ流す
      //     (= 生位置の愛媛ジッタ過大を防ぐ・OBD速度は spd 経由で①cap/②穴埋めに使う)。★
      if (sample.obd === true && cfg.adaptiveMode !== true) {
        if (prev && Number.isFinite(sample.t) && Number.isFinite(prev.t) && sample.t < prev.t) {
          return { deltaM: 0, totalM: total, reason: 'out_of_order' };
        }
        return _core(sample);
      }
      // ★合成タイマー連続前進 (2026-06-10・gps.js _gapTick)★: GPS stale(穴)中に位置据え置きで t だけ
      //   前進させた合成点 (sample.synthetic===true・速度既知の coast 源)。★平滑バッファを通さず★ 即
      //   _core へ流す。理由: 位置が前点と同一 (弦=0) なので平滑(位置ジッタ除去)は無意味かつ、平滑遅延
      //   で穴埋めが遅れトンネル復帰時に lump が残るのを防ぐ。_core 内で spd×dt の coast/Doppler 経路
      //   (never-over cap 付き) が距離を前進。OBD 接続中は上の obd 枝が ∫v 駆動。out-of-order は prev で判定。
      if (sample.synthetic === true && cfg.adaptiveMode !== true) {
        // ★平滑バッファを ★完全ドレイン★ してから合成点を処理する (二重計上の核)★:
        //   smoothedRawMode は h 点遅延バッファを持つ。バッファ末尾に「穴入口直前の実点」が
        //   未処理で残ったまま合成点を _core.prev に被せると、後で穴明けの実点が到着した時に
        //   バッファ内で「穴入口点 ↔ 穴明け点」を ★トンネルを跨いで平滑★ し chord=全長(1200m級)を
        //   生んでしまう (= flush 二重計上)。合成前にバッファを片側窓で全確定し prev を ★真の穴入口
        //   実点★ に揃えれば、合成は正しい起点から speed×dt で前進し、穴明けの実点は ★新しい空
        //   バッファ★ から始まるため跨ぎ平滑が起きない。
        if (cfg.smoothedRawMode === true) {
          while (smoothNext <= smoothBuf.length - 1) {
            const smPre = _smoothOnePoint(
              smoothBuf,
              smoothNext,
              smParams.h,
              smParams.gapMs,
              smParams.badAcc
            );
            _core(smPre);
            smoothNext++;
          }
          // ★穴跨ぎ平滑の遮断★: バッファをクリアし、穴明けの実点は新規バッファから開始させる
          //   (= prev は合成点が前進させ、穴明け点との chord は _core 内 never-over cap で抑制)。
          smoothBuf = [];
          smoothNext = 0;
        }
        if (prev && Number.isFinite(sample.t) && Number.isFinite(prev.t) && sample.t < prev.t) {
          return { deltaM: 0, totalM: total, reason: 'out_of_order' };
        }
        return _core(sample);
      }
      // ★smoothedRawMode★: 生点をバッファし、後続 h 点が揃った中心点を平滑して _core へ流す。
      //   ★adaptiveMode も平滑土台を共有(3D/穴埋めは stepDistance で上積み)★
      if (cfg.smoothedRawMode === true) {
        const lastRaw = smoothBuf.length ? smoothBuf[smoothBuf.length - 1] : null;
        // out-of-order ガード (生入力順で判定)
        if (
          lastRaw &&
          Number.isFinite(sample.t) &&
          Number.isFinite(lastRaw.t) &&
          sample.t < lastRaw.t
        ) {
          return { deltaM: 0, totalM: total, reason: 'out_of_order' };
        }
        smoothBuf.push(sample);
        let res = { deltaM: 0, totalM: total, reason: 'buffered' };
        while (smoothNext + smParams.h <= smoothBuf.length - 1) {
          const sm = _smoothOnePoint(
            smoothBuf,
            smoothNext,
            smParams.h,
            smParams.gapMs,
            smParams.badAcc
          );
          res = _core(sm);
          smoothNext++;
        }
        return res;
      }
      // 非 smoothed: 従来通り (out-of-order を prev で判定)。
      if (prev && Number.isFinite(sample.t) && Number.isFinite(prev.t) && sample.t < prev.t) {
        return { deltaM: 0, totalM: total, reason: 'out_of_order' };
      }
      return _core(sample);
    },
    // ★flush★: smoothedRawMode で残バッファ (末尾 h 点) を片側窓で確定する。
    //   ★業務終了で最終 totalM() を読む前に必ず呼ぶこと★ (末尾区間が未計上のまま課金されるのを防ぐ)。
    //   非 smoothed では no-op。batch の配列末尾 (前方窓欠落) と同一規則 = parity 維持。
    flush: function () {
      if (cfg.smoothedRawMode !== true) return { deltaM: 0, totalM: total };
      let flushed = 0;
      while (smoothNext <= smoothBuf.length - 1) {
        const sm = _smoothOnePoint(
          smoothBuf,
          smoothNext,
          smParams.h,
          smParams.gapMs,
          smParams.badAcc
        );
        const r = _core(sm);
        flushed += r && r.deltaM > 0 ? r.deltaM : 0;
        smoothNext++;
      }
      return { deltaM: flushed, totalM: total }; // worker は deltaM を業務距離に加算可
    },
    totalM: function () {
      return total;
    },
    reset: function () {
      total = 0;
      prev = null;
      prevSnap = null;
      coastSpdMps = -1;
      coastHoleSec = 0;
      coastHoleM = 0;
      coastHoleFrozen = false;
      calGpsM = 0;
      calObdIntM = 0;
      calTimeS = 0;
      obdDeltaMps = 0;
      obdDeltaInit = false;
      smoothBuf = [];
      smoothNext = 0;
      freshAccum();
      // ★router/snapper を新インスタンスで完全再生成 (= キャッシュ等の内部状態漏れを根絶)。
      //   旧実装はキャッシュ Map のみ差し替えていたが reset 後再 ingest で 10m 級の残留が出たため、
      //   インスタンスごと作り直して trip 単位の完全初期化を保証する。
      router = enableRouting ? new RoadGraphRouter(decoder, cfg) : null;
      snapper = opts.useSnapCache === false ? null : new SnapCache(decoder, cfg);
    },
    // 監査/デバッグ用 (課金には使わない)
    _breakdown: function () {
      return bd;
    },
    _stats: function () {
      return stats;
    },
  };
}

// ─── exports (Node tests = module.exports / browser = グローバル公開) ───
(function (root) {
  const api = {
    computeDistance: computeDistance,
    createDistanceTracker: createDistanceTracker,
    RoadGraphRouter: RoadGraphRouter,
    SnapCache: SnapCache,
    gpsSpeedProvider: gpsSpeedProvider,
    haversineM: haversineM,
    DEFAULTS: DEFAULTS,
  };
  // eslint-disable-next-line no-undef
  if (typeof module !== 'undefined' && module.exports) {
    // eslint-disable-next-line no-undef
    module.exports = api;
  } else if (root) {
    root.PipelineDistance = api;
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);
