// 距離累積・料金計算
const Meter = (() => {
  let state = {
    running: false,
    distance_m: 0,
    fare_yen: 0,
    elapsed_sec: 0,
    start_time: null,
    last_gps: null,
    last_timestamp: null,
    last_speed_kmh: 0,    // GPS消失時の補完用
    gap_fill_count: 0,    // GPS消失補完回数（サマリー表示用）
    gap_fill_total_m: 0,  // GPS消失補完合計距離
    // ─── Map Matching（2026/04/30追加・既存distance_mとは独立） ───
    mm_distance_m: 0,         // Map Matching距離（道路にsnapした実距離）
    mm_snap_count: 0,         // snap成功回数（精度評価用）
    mm_total_count: 0,        // update呼び出し回数（snap成功率算出用）
    mm_skip_count: 0,         // 異常値でスキップした回数
  };

  // Map Matching の内部状態（state とは別・stateはユーザー向け値のみ）
  let prevSnap = null;

  // 起動時warm up：代行開始前から GPS を保持しておく（2026/04/30追加）
  // 「代行開始」押した瞬間にすぐメーターが動くようにするため
  // ボタン追加せず、内部で常に GPS を受け取って lastWarmupGps に保存
  let lastWarmupGps = null;

  let fareConfig = {
    base_fare: 1300,
    base_distance_m: 1000,
    add_fare: 100,
    add_distance_m: 420,
  };

  // ハイブリッド計測の閾値
  const HYBRID_SPEED_KMH = 30;
  const HYBRID_DISCREPANCY = 0.5;

  // GPS消失補完の閾値
  const GAP_THRESHOLD_SEC = 5;        // 5秒以上の空白＝GPS消失
  const GAP_MAX_SEC = 600;            // 最大10分（それ以上は異常）
  const NEAR_INFRA_RADIUS_M = 200;    // 200m以内のトンネル/橋を「該当」と判定

  // Map Matching 設定（2026/04/30追加）
  const MM_ENABLED = true;            // Map Matching ON/OFF
  const MM_MAX_SNAP_DIST_M = 50;      // snap 許容距離（道路から離れすぎたら snap しない）
  const MM_MAX_SEGMENT_DIST_M = 1000; // 1更新で 1km 超えは異常値（GPSジャンプ等）
  const MM_GAP_RESET_SEC = 5;         // 5秒以上空白で prevSnap リセット（連続性失う）

  let timer = null;

  function setFareConfig(config){ fareConfig = { ...fareConfig, ...config }; }
  function getFareConfig(){ return { ...fareConfig }; }

  function start(){
    const now = Date.now();
    // 起動時warm up：5秒以上前のlastWarmupGpsは使わない（過剰課金リスク回避・2026/05/01）
    // GPS止まった状態で移動→起動時に古い座標と現在地で距離爆発するのを防ぐ
    const WARMUP_MAX_AGE_MS = 5000;
    const warmupValid = lastWarmupGps &&
      lastWarmupGps.timestamp &&
      (now - lastWarmupGps.timestamp) < WARMUP_MAX_AGE_MS;
    state = {
      running: true,
      distance_m: 0,
      fare_yen: fareConfig.base_fare,
      elapsed_sec: 0,
      start_time: now,
      // 起動時warm upでGPS取得済みなら初期値として使う（即時計測開始のため）
      // 過去の動きは加算しないよう last_timestamp は now を使用
      last_gps: warmupValid ? {
        lat: lastWarmupGps.lat,
        lng: lastWarmupGps.lng,
        altitude: lastWarmupGps.altitude,
        compassHeading: lastWarmupGps.compassHeading
      } : null,
      last_timestamp: warmupValid ? now : null,
      last_speed_kmh: warmupValid ? lastWarmupGps.speedKmh : 0,
      gap_fill_count: 0,
      gap_fill_total_m: 0,
      // Map Matching 関連リセット
      mm_distance_m: 0,
      mm_snap_count: 0,
      mm_total_count: 0,
      mm_skip_count: 0,
    };
    prevSnap = null;  // Map Matching 連続性リセット
    if(timer) clearInterval(timer);
    timer = setInterval(() => { if(state.running) state.elapsed_sec++; }, 1000);
  }

  function stop(){
    state.running = false;
    if(timer){ clearInterval(timer); timer = null; }
  }

  function reset(){
    stop();
    state = {
      running: false,
      distance_m: 0,
      fare_yen: 0,
      elapsed_sec: 0,
      start_time: null,
      last_gps: null,
      last_timestamp: null,
      last_speed_kmh: 0,
      gap_fill_count: 0,
      gap_fill_total_m: 0,
      // Map Matching 関連リセット
      mm_distance_m: 0,
      mm_snap_count: 0,
      mm_total_count: 0,
      mm_skip_count: 0,
    };
    prevSnap = null;
    // 起動時warm up GPSもクリア（過剰課金リスク回避・2026/05/01）
    // GPS止まった状態で移動→次回代行開始時に古い座標と現在地で距離爆発するのを防ぐ
    lastWarmupGps = null;
  }

  // GPS消失時の補完（トンネル・橋データ活用）
  // returns: 補完すべき距離(m) | null（補完しない）
  // ×1.3倍：直線距離は実際の道路距離より短いため補正係数を掛ける
  const ROAD_FACTOR = 1.3;
  // トンネル/橋方向とコンパス方向の許容差（度）
  const TUNNEL_COMPASS_THRESHOLD_DEG = 45;

  function calcBearingMeter(lat1, lng1, lat2, lng2){
    const φ1=lat1*Math.PI/180, φ2=lat2*Math.PI/180;
    const Δλ=(lng2-lng1)*Math.PI/180;
    return((Math.atan2(Math.sin(Δλ)*Math.cos(φ2),
      Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ))*180/Math.PI)+360)%360;
  }
  function angleDiffMeter(a,b){let d=Math.abs(a-b)%360;return d>180?360-d:d;}

  function calculateGapFill(prevLat, prevLng, currLat, currLng, gapSec, lastSpeedKmh, compassHeading){
    if(gapSec > GAP_MAX_SEC) return null;

    // 停車中（速度=0）の場合は座標差分で判断
    if(lastSpeedKmh <= 0){
      const coordDiff = GPS.calcDistance(prevLat, prevLng, currLat, currLng);
      if(coordDiff >= 20){
        const filled = coordDiff * ROAD_FACTOR;
        dlog(`[Meter] 停車中補完: 座標差分 ${Math.round(coordDiff)}m × ${ROAD_FACTOR} = ${Math.round(filled)}m`);
        return filled;
      }
      return null;
    }

    // 走行中の補完（速度×時間）
    const speedMs = lastSpeedKmh / 3.6;
    const naiveDistance = speedMs * gapSec;

    if(typeof RegionLoader === 'undefined') return naiveDistance * ROAD_FACTOR;

    let infra = RegionLoader.findNearestTunnel(prevLat, prevLng, NEAR_INFRA_RADIUS_M);
    if(!infra) infra = RegionLoader.findNearestBridge(prevLat, prevLng, NEAR_INFRA_RADIUS_M);

    if(infra){
      const infraLength = infra.item[1];
      const infraStart  = infra.item[2]; // [lat, lng]
      const infraEnd    = infra.item[3]; // [lat, lng]

      // コンパス方向と構造物方向の照合
      if(compassHeading != null){
        const infraBearing = calcBearingMeter(infraStart[0], infraStart[1], infraEnd[0], infraEnd[1]);
        // 双方向（順方向・逆方向）の小さい方で判定
        const diffFwd = angleDiffMeter(compassHeading, infraBearing);
        const diffRev = angleDiffMeter(compassHeading, (infraBearing + 180) % 360);
        const diff = Math.min(diffFwd, diffRev);

        if(diff <= TUNNEL_COMPASS_THRESHOLD_DEG){
          // コンパスと一致 → 構造物の実距離を採用（精度高い）
          // 修正（2026/04/30）：Math.min → Math.max
          // 旧：トンネル長と速度×時間の短い方 → カーブ多いトンネルで短く出てた
          // 新：長い方 → 直線でも妥当・カーブで実道路距離に近づく
          const filled = Math.max(naiveDistance, infraLength);
          dlog(`[Meter] ${infra.item[0]} コンパス一致(${diff.toFixed(0)}°) → ${Math.round(filled)}m (infra=${infraLength}m, naive=${Math.round(naiveDistance)}m)`);
          return filled;
        } else {
          // コンパスと不一致 → 誤検出の可能性・速度×時間×1.3で補完
          dlog(`[Meter] ${infra.item[0]} コンパス不一致(${diff.toFixed(0)}°) → 速度補完`);
          return naiveDistance * ROAD_FACTOR;
        }
      }

      // コンパスなし → 構造物長と速度×時間の長い方を採用
      // 修正（2026/04/30）：Math.min → Math.max（同上の理由）
      const filled = Math.max(naiveDistance, infraLength);
      dlog(`[Meter] GPS消失補完: ${gapSec.toFixed(1)}秒 → ${Math.round(filled)}m (${infra.item[0]} ${infraLength}m, naive=${Math.round(naiveDistance)}m)`);
      return filled;
    }

    // データなし → 速度×時間 × 1.3（道路係数）
    const filled = naiveDistance * ROAD_FACTOR;
    dlog(`[Meter] GPS消失補完: ${gapSec.toFixed(1)}秒 → ${Math.round(filled)}m (×${ROAD_FACTOR}補正)`);
    return filled;
  }

  function _recordGapFill(filledM){
    state.gap_fill_count++;
    state.gap_fill_total_m += filledM;
  }

  function update(gpsResult){
    if(!state.running) return;
    if(gpsResult.isStationary) return;

    if(state.last_gps && state.last_timestamp){
      const dtSec = (gpsResult.timestamp - state.last_timestamp) / 1000;

      // GPS消失検出：5秒以上の空白
      if(dtSec >= GAP_THRESHOLD_SEC){
        // 補完計算（トンネル/橋データ活用）
        const filled = calculateGapFill(
          state.last_gps.lat, state.last_gps.lng,
          gpsResult.lat, gpsResult.lng,
          dtSec, state.last_speed_kmh,
          state.last_gps.compassHeading
        );

        if(filled !== null){
          const gpsDistance = GPS.calcDistance3D(
            state.last_gps.lat, state.last_gps.lng, state.last_gps.altitude,
            gpsResult.lat, gpsResult.lng, gpsResult.altitude
          );
          const d = Math.min(filled, gpsDistance);
          state.distance_m += d;
          state.fare_yen = calcFare(state.distance_m);
          _recordGapFill(d); // 補完カウント
        }
        state.last_gps = { lat: gpsResult.lat, lng: gpsResult.lng, altitude: gpsResult.altitude, compassHeading: gpsResult.compassHeading || null };
        state.last_timestamp = gpsResult.timestamp;
        state.last_speed_kmh = gpsResult.speedKmh || 0;
        return;
      }

      // 通常処理：GPS距離計算
      // 案AA：3D距離計算（高度差を加味・2026/04/26）
      const gpsDistance = GPS.calcDistance3D(
        state.last_gps.lat, state.last_gps.lng, state.last_gps.altitude,
        gpsResult.lat, gpsResult.lng, gpsResult.altitude
      );

      let d = gpsDistance;

      // ハイブリッド計測：30km/h以上は速度×時間で積分
      if(gpsResult.speedKmh >= HYBRID_SPEED_KMH){
        if(dtSec > 0 && dtSec < 10){
          const speedMs = gpsResult.speedKmh / 3.6;
          const speedDistance = speedMs * dtSec;
          const maxV = Math.max(speedDistance, gpsDistance);
          if(maxV > 0 && Math.abs(speedDistance - gpsDistance) / maxV <= HYBRID_DISCREPANCY){
            d = speedDistance;
          }
        }
      }

      state.distance_m += d;
      state.fare_yen = calcFare(state.distance_m);
    }
    state.last_gps = { lat: gpsResult.lat, lng: gpsResult.lng, altitude: gpsResult.altitude, compassHeading: gpsResult.compassHeading || null };
    state.last_timestamp = gpsResult.timestamp;
    state.last_speed_kmh = gpsResult.speedKmh || 0;

    // ━━━━━ Map Matching（2026/04/30追加・既存処理に影響なし） ━━━━━
    // 既存の state.distance_m とは別に state.mm_distance_m に道路上距離を累積
    // 失敗しても既存処理は継続（フォールバック設計）
    _updateMapMatching(gpsResult);
  }

  // Map Matching 処理（update から呼ばれる・分離して既存ロジック保護）
  // 2026/05/03 NAV-1 修正：prevSnap に timestamp を保持して連続性判定する
  //   旧コードは state.last_timestamp を参照していたが、update() 末尾で
  //   gpsResult.timestamp に先に更新されるため dtSec が常に 0 になっていた。
  //   結果：MM_GAP_RESET_SEC（5秒）超過判定が永遠に発火せず、
  //         GPS 長時間空白後でも古い prevSnap で距離加算され誤差混入リスク。
  //   修正：prevSnap 自身が時刻を持つ自己完結型に変更（snap オブジェクトは汚染しない）。
  function _updateMapMatching(gpsResult){
    if(!MM_ENABLED) return;
    if(typeof RegionLoader === 'undefined' || !RegionLoader.snapToNearestRoad) return;
    if(gpsResult.isStationary) return;
    if(typeof gpsResult.lat !== 'number' || typeof gpsResult.lng !== 'number') return;

    state.mm_total_count++;

    try {
      const snap = RegionLoader.snapToNearestRoad(
        gpsResult.lat, gpsResult.lng,
        { maxDistM: MM_MAX_SNAP_DIST_M }
      );
      if(!snap){
        // 道路から遠い → snap せず（駐車場・畑など）
        // prevSnap は維持（道路に戻ったら再開）
        return;
      }

      state.mm_snap_count++;

      // 前回の snap がある場合のみ距離計算
      if(prevSnap){
        // NAV-1 修正：prevSnap.timestamp を参照（state.last_timestamp は不可・更新済み）
        const dtSec = prevSnap.timestamp != null
          ? (gpsResult.timestamp - prevSnap.timestamp) / 1000
          : 0;
        if(dtSec > MM_GAP_RESET_SEC){
          // GPS 空白で連続性失う → prevSnap 更新だけして次回から再開
          prevSnap = Object.assign({}, snap, { timestamp: gpsResult.timestamp });
          return;
        }

        const r = RegionLoader.calcRoadDistance(prevSnap, snap);
        if(r && typeof r.distanceM === 'number'){
          // サニティチェック：1更新で MM_MAX_SEGMENT_DIST_M 超えは異常
          if(r.distanceM >= 0 && r.distanceM <= MM_MAX_SEGMENT_DIST_M){
            state.mm_distance_m += r.distanceM;
          } else {
            state.mm_skip_count++;
            if(typeof dlog === 'function'){
              dlog('[MM] skip 異常距離: ' + r.distanceM.toFixed(0) + 'm');
            }
          }
        }
      }
      // prevSnap に必ず timestamp を持たせる（次回の dtSec 判定用）
      prevSnap = Object.assign({}, snap, { timestamp: gpsResult.timestamp });
    } catch(e) {
      // Map Matching が失敗しても既存処理は止めない
      state.mm_skip_count++;
      if(typeof dlog === 'function') dlog('[MM] error: ' + e.message);
    }
  }

  function calcFare(distanceM){
    if(distanceM < fareConfig.base_distance_m) return fareConfig.base_fare;
    const extra = distanceM - fareConfig.base_distance_m;
    const steps = Math.floor(extra / fareConfig.add_distance_m) + 1;
    return fareConfig.base_fare + (steps * fareConfig.add_fare);
  }

  function getState(){ return { ...state }; }

  function setDistance(distanceM){
    state.distance_m = distanceM;
    state.fare_yen = calcFare(distanceM);
  }

  // リロード復元用：最終GPS状態をセット（層3・GPS消失補完を復元後に発火させる）
  function setLastGps(lat, lng, altitude, speedKmh, timestamp){
    state.last_gps = { lat, lng, altitude };
    state.last_timestamp = timestamp;
    state.last_speed_kmh = speedKmh || 0;
  }

  function resume(){
    if(state.running) return;
    state.running = true;
    if(timer) clearInterval(timer);
    timer = setInterval(() => { if(state.running) state.elapsed_sec++; }, 1000);
  }

  // 起動時warm up（2026/04/30追加）
  // 代行開始前でも常に呼ばれて、GPSを内部に保存しておく
  // 「代行開始」押した瞬間に start() が lastWarmupGps を初期値として使う
  // これにより「100m走って動き出す」遅延が解消される
  // state には触らない（距離・料金は変えない）
  function updateGpsOnly(gpsResult){
    if(!gpsResult || typeof gpsResult.lat !== 'number' || typeof gpsResult.lng !== 'number') return;
    lastWarmupGps = {
      lat: gpsResult.lat,
      lng: gpsResult.lng,
      altitude: gpsResult.altitude || 0,
      compassHeading: gpsResult.compassHeading || null,
      timestamp: gpsResult.timestamp || Date.now(),
      speedKmh: gpsResult.speedKmh || 0
    };
  }

  return { start, stop, reset, resume, update, updateGpsOnly, getState, setFareConfig, getFareConfig, calcFare, setDistance, setLastGps };
})();
