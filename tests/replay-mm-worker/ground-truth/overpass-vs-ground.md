# overpass-vs-ground-200m ground_truth 説明

## 選定理由

ehime road 全 117,504 件 + 全 grid をスキャンして発見した「layer >= 1 (= 高架/橋)
road が・水平距離 15m 以内に layer 0 (= 地上) road と並走」最良候補。

### scan 結果

- layer >= 1 road (>= 100m): 963 件
- 地上 road 15m 以内に近接: 48 件
- 採用: elevated 70 (= 906m / motorway / layer 1) + ground 50 (= motorway / layer 0)
  - 水平距離 0m (= 完全に同位置・垂直のみ別)
  - しまなみ海道高架近辺 (= 34.19530N, 133.07543E)

### 正解 road = 70 (= 高架)

| 属性 | 値 |
|---|---|
| roadIndex | 70 |
| typeCode | 0 (= motorway) |
| **layer | 1 (= bridge/elevated)** |
| oneway | 0 |
| 全長 | 906m (2 points / 1 segment) |
| 位置 | (34.19530, 133.07543) 開始 |

### ground_truth (= 50 step)

| segments | t_start | t_end | num_samples | 距離 |
|---|---|---|---|---|
| seg 0 | 0.0 | 0.22 | 50 | ≈200m |

合計 50 step / 距離 ≈200m / 4m/step / 14.4km/h (= 仮想徐行・実車では高速 motorway 走行)

### 競合 road = 50 (= 地上)

| 属性 | 値 |
|---|---|
| roadIndex | 50 |
| typeCode | 0 (= 同 motorway) |
| **layer | 0 (= ground)** |
| oneway | 0 |

水平距離: 0m (= 真上下関係)

### 狙い (= MM-5 layer scoring 検証)

- **同 bearing ゆえ A-2 boost は効かない** (= 司さん「× OK」)
- 両者 motorway 同 typeCode → typeCode boost 差別化不可
- 判定軸: MM-5 layer scoring (= map-matcher.js layerScore) + GPS altitude 比較
- 期待: 50 step で 正解 layer 1 高架 road 70 に snap・直下の地上 road 50 への
  誤 snap を避ける
- 注: GPS altitude は noise model に含めていない (= sample.altitude=0)・
  Worker B の layer scoring は・**前 step layer 連続性 boost** 主軸で判定

### scoring 拡張: layer accuracy

scoring.js は・groundTruthLayers + committedLayers を渡せば layer_accuracy も計算可能。
本 fixture では・ground_truth layer 全 step 1 / committed layer は実 Worker B 出力。

## 4 必須条件 (循環防止) 準拠確認

1. **実在競合道路**: 50 (= 直下地上・実 ehime data・水平距離 0m) ✅
2. **現実的ノイズ**: 実機相当 default ✅
3. **自明 fixture 回避**: 同 typeCode + 水平 0m で・**layer 以外の指標で差別化不可** ✅
4. **同 bearing ゆえ A-2 OFF** (= 司さん指示通り) ✅
