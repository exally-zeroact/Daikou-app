# y-fork-148m ground_truth 説明

## 選定理由

ehime road 全 117,504 件を松山周辺 grid (= 33.82-33.86N / 132.76-132.80E) で
geometric scan して発見した「Y 字分岐 (= 3+ road が同 junction で交わり・うち 2 road
の bearing 無向差 30-60度) の最良候補」。

### scan 結果 (= 2026-05-21・Phase 1 角度系バッチ着手時)

- 3+ road junction 数: 189 件 (= 松山周辺 grid 内)
- bearing 25-70度差 ペア: 71 件
- 採用: 最長 min(lengthA, lengthB) の top 候補 = junction (33.83120, 132.79750)
  - road A=177 (= 1331m / bearing 299度) と road B=62476 (= 1205m / bearing 165度)
  - 角度差: 45度 (= 30-60度範囲のど真ん中・典型的な Y 字)

### 正解 road = 177

| 属性 | 値 |
|---|---|
| roadIndex | 177 |
| typeCode | 5 (= unclassified) |
| layer | 0 (= 平面) |
| oneway | 0 (= 双方向) |
| lanes | 0 (= 不明) |
| 全長 | 1331m (7 points / 6 segments) |
| start bearing (= junction から外へ) | 299度 (= 北西) |
| junction (= start) | (33.83120, 132.79750) |

segments:
- **seg[0→1]: 147.8m (= ground_truth 採用・~148m を 50 step に分割)**
- seg[1→2]: 664.8m
- seg[2→3]: 201.5m
- seg[3→4]: 123.1m
- seg[4→5]: 109.4m
- seg[5→6]: 88.1m

ground_truth 合計: **147.8m / 50 GPS step (= 約 3m/step / 10.6km/h・徐行 trip 相当)**

### 競合 road = 62476

| 属性 | 値 |
|---|---|
| roadIndex | 62476 |
| typeCode | 2 (= primary・正解より上位カテゴリ) |
| layer | 0 |
| oneway | 0 |
| lanes | 0 |
| 全長 | 1205m (11 points / 10 segments) |
| start bearing | 165度 (= 南南東) |
| junction (= start) | 正解と同一 (33.83120, 132.79750) |

### 期待される困難性

- 正解 = unclassified (= typeCode 5) / 競合 = primary (= typeCode 2)
- Worker B の attrBoost で・typeCode 2 (primary) は・typeCode 5 (unclassified) より score 高め
- → junction 付近で GPS noise が 62476 寄りになると・**primary boost で誤 snap 確率上昇**
- 角度差 45度 → bearing 299 (= 正解) vs bearing 165 (= 競合)・無向 angle 差大
- → **A-2 heading-vector boost** が・GPS heading (= 約 299度・noise σ 5度) と整合する 177 を強く支持する期待
- → boost on/off で snap 結果が変わる構成 = A-2 検証 fixture として有効

### A-2 (heading-vector boost) との関係

- 正解 / 競合 bearing 差 45度 (= 無向で 45度差)
- 私の boost 計算: cos(45度) = 0.707 → boost = 1 + 0.10 × (0.707 - 0.5) × 2 = **1.041 vs 1.10 (正解側)**
- → boost on で・正解 177 の方が +6% emission 強化される
- → boost off (= weight 0) では差別化なし
- → on/off で snap_f1 / der が変わる構成

## 4 必須条件 (循環防止) 準拠確認

1. **実在競合道路**: 62476 を competing_road_indices で明示・同 junction で角度差 45度 ✅
2. **現実的ノイズ**: 実機相当 default (= 10m / 3m / 2%) ✅
3. **自明 fixture 回避**: 実 ehime road を geometric scan で発見・私が描いていない ✅
   - 更に typeCode 違いで Worker B の自然な誤 snap 傾向を組み込み (= 自明な正解選択を防止)
4. **A-2 boost on/off で結果変わる構成**: bearing 差 45度 → boost on で 6% emission 差別化 ✅

## 期待される baseline (= 記録のみ・原因究明はしない)

- 50 step trace (= warmup 10 step + post-warmup 40 step)
- post-warmup precision: 不定 (= 計測結果次第)
- DER: 不定 (= 計測結果次第)
- → 数値はツール完成後の特性評価で参照
