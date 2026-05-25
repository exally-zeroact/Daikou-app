# reverse-oneway-200m ground_truth 説明 (= 司さん命名 reverse-oneway-100m 概数)

## 選定理由

intersection-cross fixture で採用した oneway road 66855 (= 東向き oneway) を
**逆走 trace** で再利用。実 ehime road 上の oneway road を物理的に逆方向走行する想定。

### 正解 road = 66855

| 属性 | 値 |
|---|---|
| roadIndex | 66855 |
| typeCode | 4 (= tertiary) |
| layer | 0 |
| **oneway | 1 (= 東向き一方通行)** |
| 全長 | 941m |

### ground_truth (= 50 step・逆走)

| segments | t_start | t_end | num_samples | 距離 | heading |
|---|---|---|---|---|---|
| seg 0 | 0.30 | 0.0 | 50 | ≈200m | **西進 (= 逆方向・runner.js 自動反転)** |

合計 50 step / 距離 ≈ 200m / 速度 14.4km/h (= 市街地徐行)

### 競合 roads

| roadIndex | 役割 |
|---|---|
| 122 | 反対車線 oneway 西向き・順方向走行・並列 axis |
| 64104 | 南直交 |
| 66856 | 北直交 |

### 狙い (= 逆走 全加算ルール検証)

- **全加算ルール**: oneway 逆走でも距離加算が正
- Worker B oneway penalty (= LANE_PENALTY 0.05・map-matcher.js L42 + T10 lane scoring)
  により・正解 66855 (= 逆走中) の score が大幅低下
- **誤 snap リスク**: penalty で 66855 の確信度が落ちると・並列順方向 oneway 122
  (= 反対車線) や別 road への誤 snap 確率が高まる
- 期待: 物理的に走ってる 66855 が ground_truth に正 snap される (= 全加算で課金)・
  oneway penalty で 122 等に snap されない設計を確認

## 4 必須条件 (循環防止) 準拠確認

1. **実在競合道路**: 122/64104/66856 (= 実 ehime data・intersection-cross と共通) ✅
2. **現実的ノイズ**: 実機相当 default ✅
3. **自明 fixture 回避**: oneway penalty で 122 への誤 snap 誘惑あり ✅
4. **runner 拡張**: t_start>t_end で逆方向 heading ✅
