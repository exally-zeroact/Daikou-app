# uturn-274m ground_truth 説明 (= 司さん命名 uturn-150m 概数・実態 274m 往復)

## 選定理由

ehime road 22203 (= parallel-frontage 採用の正解 road・411m unclassified 双方向)
を U-turn シナリオ用に再利用。並走 25m に road 22235 (= 競合) が存在することで・
**反転動作中に競合へ誤 snap する誘惑**を組み込む構成。

### 正解 road = 22203 (= parallel-frontage と共通)

| 属性 | 値 |
|---|---|
| roadIndex | 22203 |
| typeCode | 5 (= unclassified) |
| layer | 0 |
| oneway | 0 (= 双方向・U-turn 可能) |
| 全長 | 411m (8 points / 7 segments) |

### ground_truth (= 往復 60 step)

| 順 | segments | t_start | t_end | num_samples | 距離 | heading |
|---|---|---|---|---|---|---|
| 1 | seg 2 | 0.0 | 1.0 | 15 | 53.6m | 西進 (= 順方向) |
| 2 | seg 3 | 0.0 | 1.0 | 15 | 83.7m | 西進 (= 順方向) |
| 3 | seg 3 | 1.0 | 0.0 | 15 | 83.7m | **東進 (= 逆方向・runner.js が自動反転)** |
| 4 | seg 2 | 1.0 | 0.0 | 15 | 53.6m | **東進 (= 逆方向)** |

合計 60 step / **往復距離 274.6m**

### 競合 road = 22235

| roadIndex | 22235 |
|---|---|
| typeCode | 5 (= 同) |
| layer | 0 |
| 全長 | 421m |
| 並走距離 | 24.5m (= parallel-frontage と同 ペア) |

### 狙い (= U-turn 全加算ルール検証)

- **全加算ルール**: U-turn でも距離加算が正 (= タクシー方式・減算しない)
- **ground-truth の意味**: 反転後も走行 road 22203 上に snap + 距離 accrue されるべき
- 期待: 60 step の committed snap chain が全 22203 上にある (= competing 22235 でない)
- 期待: committedDistanceM ≈ 274m (= 往復総距離・減算なし)
- **誤 snap リスク**: U-turn 瞬間 (= step 30 前後) で・反転動作中に並走 22235 寄りに振れる可能性

## 4 必須条件 (循環防止) 準拠確認

1. **実在競合道路**: 22235 (= 並走 25m・実 ehime data) ✅
2. **現実的ノイズ**: 実機相当 default (= 10m / 3m / 2%) ✅
3. **自明 fixture 回避**: 実 22203 上で往復・並走 22235 への誘惑あり ✅
4. **runner 拡張**: t_start>t_end で自動逆方向 heading・既存 fixture 挙動不変 ✅
