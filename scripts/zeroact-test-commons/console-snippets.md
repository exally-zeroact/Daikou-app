# ダイコメ Console 注入 snippet 集 (= 司さんが Eruda / DevTools で貼って状態確認)

★設計変更宣言 (2026-05-28・検証連鎖 [D]):
司さんが「実機で歩き回って眼で数字を確認」 する必要を消すための・**console から状態を抜き取る snippet 集**。
Eruda (= モバイル) / DevTools (= PC ブラウザ) のコンソールに貼ってそのまま実行できる形で保持。

★絶対前提:
- 全 snippet は **read-only** (= window globals を読むだけ・state を書き換えない)
- 機微情報 (lat/lng) は丸めて出す or 出さない (= PII 配慮)
- 出力は ★1 行 (JSON)★ で送りやすい形

---

## S1. 今の状態スナップショット (= 一発で全部見る)

```js
JSON.stringify({
  meter: Meter.getState ? {
    dist_m: Meter.getState().distance_m,
    biz_m: Meter.getState().business_distance_m || 0,
    tier2: Meter.getState().tier2_pending_m || 0,
    biz_tier2: Meter.getState().business_tier2_pending_m || 0,
    fare: Meter.getState().fare_yen,
    running: Meter.getState().running,
    biz_active: Meter.getState().business_active,
    last_stat: Meter.getState().last_isStationary,
  } : 'n/a',
  gps: { state: GPS.getStatus && GPS.getStatus().state, lastErr: GPS.getStatus && GPS.getStatus().lastError },
  last_stationary: window._lastStationary,
})
```

→ 出力例: `{"meter":{"dist_m":1234.5,"biz_m":1500,...},"gps":{"state":"granted"},"last_stationary":true}`

---

## S2. 直近の GPS 層判定 (= STEP0 診断ログを直接抽出)

Eruda のログ画面で `[GPSDBG]` を検索すれば変化時のみの値が見えるが、
最新を1個だけ拾うなら:

```js
// Eruda 経由なら直接 log 画面・DevTools なら performance.getEntries で API call を見ても OK
console.log('[snapshot]', new Date().toISOString());
```

★注意: STEP0 ログは「sig 変化時のみ」 throttle 出力。連続同値は出ない (= 仕様)。

---

## S3. 距離経路の breakdown (= どこから distance が来ているか)

```js
JSON.stringify({
  total: Meter.getState().distance_m,
  mm: Meter.getState().mm_distance_m || 0,
  offroad: Meter.getState().offroad_distance_m || 0,
  gap_fill: Meter.getState().gap_fill_total_m || 0,
  gap_fill_count: Meter.getState().gap_fill_count || 0,
  offroad_count: Meter.getState().offroad_count || 0,
  source: Meter.getState().distanceSource,
})
```

→ 「業務中の合計 vs どの経路から積まれたか」 を一行で確認。

---

## S4. Worker 起動状態 + ロード進捗

```js
JSON.stringify({
  mm_loaded: window._mmPipeline && window._mmPipeline._bgLoadDone,
  loaded_prefs: window._mmPipeline && window._mmPipeline.loaded_prefs_count,
  loaded_roads: window._mmPipeline && window._mmPipeline.loaded_roads_total,
})
```

→ DataReadyGate / mm-data-pipeline の進捗を確認。

---

## S5. 直近 5 秒の accel/gyro 蓄積件数 (= センサー流入確認)

```js
// 直接 GPS 内部 buffer は読めないが・worker への postMessage で見える
// 代わりに sensor permission 状態:
JSON.stringify({
  sensorGranted: sessionStorage.getItem('sensorGranted'),
  permissionActive: sessionStorage.getItem('sensor_permission_active'),
  motionListener: window._motionListenerAdded,
  compassListener: window._compassListenerAdded,
})
```

★accel 件数自体は worker 内で見るしか無い (= Eruda の [GPSDBG] accelSampleCount フィールドで確認)。

---

## S6. 業務 phase の history (= いつ start/end したか)

```js
JSON.stringify({
  current: window.Business && Business.__getState && Business.__getState().active,
  trips: window.Business && Business.__getState && Business.__getState().trips ? Business.__getState().trips.length : 'n/a',
})
```

---

## S7. ★creep 検知★ 空車で 1 分待って前後の business_distance_m を比較

```js
// 実行 → 60 秒後にもう一度 実行 → 差分 = creep 量
JSON.stringify({
  at: new Date().toISOString(),
  biz_m: Meter.getState().business_distance_m || 0,
  running: Meter.getState().running,
  last_stat: Meter.getState().last_isStationary,
})
```

→ 空車・静止状態で1分後の biz_m 差が 1m 超なら ★creep★ 確定。

---

## S8. 強制的に worker に reset を撃つ (= 状態を綺麗にしてからテスト)

★書き込み系・通常運用では使わない。検証時のみ。

```js
// Worker B reset (= map-matcher・Viterbi 確定 flush)
Meter.businessEnd && Meter.businessEnd();
```

---

## S9. STEP0 診断ログを ★まとめて取り出す★ (= 司さんが私に送る用)

Eruda の log タブを開き・右上のメニューから「Export」 で全文 dump 可能。
dump した text を私に送る → tests/replay-mm-worker/eruda-trace-parser.js で
creep / freeze / commit-runaway を自動判定する。

代わりに Eruda のフィルタで `[GPSDBG]|[GPSREJ]|[MMDBG]|[Business]` を絞って表示し
スクショ送付でも可 (= OCR で解析可能)。

---

## S10. 「今 何が壊れているか」 を一行で

```js
(function() {
  var s = Meter.getState();
  var issues = [];
  if (s.distance_m === 0 && s.running) issues.push('dist_m=0 中の running=true (凍結候補)');
  if (!s.running && (s.business_distance_m || 0) > 0 && window._lastStationary) issues.push('空車+静止で biz>0 (creep)');
  if (s.fare_yen !== Math.round(s.fare_yen)) issues.push('fare 非整数');
  return issues.length ? issues.join(' / ') : 'no issues at ' + new Date().toISOString();
})()
```

→ 一発で異常をピックアップ。

---

# 司さんが私に送る形 (= 推奨 workflow)

1. 普段通り代行運転を 1 回・Eruda を有効化したまま
2. 業務終了後・Eruda の log を ★全文 Export★ してテキストファイル保存
3. 私に送付 (= chat 添付 or paste)
4. 私が `node tests/replay-mm-worker/eruda-trace-parser.js <file>` で自動分析
5. creep / freeze / commit-runaway 検知結果 + 統計を返す
6. 必要なら個別 snippet (S1〜S10) を console に貼って深掘り

→ ★司さんが「歩いて数字を眼で確認」 する作業は不要★。
