# low-speed-stop-74m ground_truth 説明 (= 司さん命名 low-speed-stop-50m 概数)

## 選定理由

ehime road 22203 seg 4 (= 73.9m・unclassified) を低速 + 中央停車 trace で使用。
**停車中の phantom 距離加算を本番経路で検出**する fixture。

### 正解 road = 22203 seg 4

| 属性 | 値 |
|---|---|
| roadIndex | 22203 |
| segmentIndex | 4 |
| seg 長 | 73.9m |

### ground_truth (= 60 step・走行+停車+走行)

| 順 | t_start | t_end | num_samples | 距離 | 動作 |
|---|---|---|---|---|---|
| 1 | 0.0 | 0.5 | 20 | 37.0m | 走行 (= 6.7km/h・徐行) |
| 2 | 0.5 | 0.5 | 20 | 0m | **停車** (= 同位置) |
| 3 | 0.5 | 1.0 | 20 | 37.0m | 走行 (= 6.7km/h) |

合計 60 step / 距離 74m + 停車区間

### stationary_step_indices (= runner.js 拡張 対応)

```
[20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39]
```

該当 step では:
- sample.speedKmh = 0 (強制)
- sample.isStationary = true
- 真の位置は同一座標・但し GPS noise σ 3m で drift する

### 競合 road = 22235 (= 並走 25m・parallel-frontage と共通)

### 狙い (= 停車中 phantom 距離加算検出)

- **絶対ルール**: 停車中に distance_m が増えてはいけない (= 課金 bug の典型)
- noise model で停車中も position σ 3m で GPS drift する想定
- Worker B の **isStationary gate** (= map-matcher.js 停車情報 + meter.js _isStationary)
  が・stationary 中の mmIncrementM / business_distance_m += 加算を 0 化する prod 経路で
  抑止される設計を検証
- 期待: committedDistanceM ≈ 74m (= 走行 + 停車 = 走行分のみ)・停車区間で phantom 加算なし

### scoring 考慮点

- 停車区間の committed snap chain は・**同 road・同 segment 4** が正解 (= 停車中も snap 維持)
- precision / recall は停車区間も含めて計算
- DER は停車区間の expected = 0 + 走行区間の expected = 74m で比較

## 4 必須条件 (循環防止) 準拠確認

1. **実在競合道路**: 22235 (= parallel-frontage と共通・並走 25m) ✅
2. **現実的ノイズ**: 実機相当 default ✅
3. **自明 fixture 回避**: 停車中の drift + 並走 22235 への誤 snap 誘惑 ✅
4. **runner 拡張**: stationary_step_indices で停車 step 強制 ✅
