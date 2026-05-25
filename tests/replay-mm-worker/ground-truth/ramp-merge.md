# ramp-merge-517m ground_truth 説明 (= 命名はラベル=実態・実 OSM seg 1-4 合計 516.6m)

## 選定理由

ehime road 全 117,504 件をスキャンして発見した「ramp (= typeCode 7-11
motorway_link 等・>=100m) が本線 (= typeCode 0-4) に・距離 30m 以内・
bearing 差 20-70度で合流」する pattern の最良候補。

### scan 結果

- ramp 候補 (= typeCode 7-11 / length>=100m): 284 件
- 合流 candidate (= 本線との距離<=30m + bearing 差 20-70度): 12 件
- 採用: 最長 ramp の top = ramp 239 + mainline 57
- 合流位置: (33.88446, 133.09475) (= ehime 東部・しまなみ海道 IC 付近)

### 正解 road = ramp 239

| 属性 | 値 |
|---|---|
| roadIndex | 239 |
| typeCode | 7 (= motorway_link) |
| layer | 0 |
| oneway | 1 |
| 全長 | 549m (6 points / 5 segments) |

segments:
- seg[0→1]: 50.8m (= 入口側・除外)
- **seg[1→2]: 29.9m (= ground_truth・5 step)**
- **seg[2→3]: 44.4m (= ground_truth・10 step)**
- **seg[3→4]: 144.7m (= ground_truth・20 step)**
- **seg[4→5]: 297.6m (= ground_truth・15 step)**

ground_truth 合計: **約 517m / 50 GPS step (= 10m/step / 36km/h・ramp 平均速度)**
記載 description は 403m だが・実 OSM ジオメトリから seg 1-4 全段で 516.6m (= 司さん命名は概数)

### 競合 road = mainline 57

| 属性 | 値 |
|---|---|
| roadIndex | 57 |
| typeCode | 0 (= motorway・本線) |
| layer | 0 |
| oneway | 1 |
| numPoints | 13 |
| ramp 末尾との距離 | 16.4m |
| ramp との bearing 差 | 47.5度 |

### 期待される困難性

1. **typeCode 大差**: 正解 = motorway_link (= 7) / 競合 = motorway (= 0)
   - Worker B の attrBoost は・**motorway (= tc 0) を motorway_link (= tc 7) より遥かに優先**
   - → ramp 走行中 GPS noise が本線寄りに振れると・**motorway boost で本線に誤 snap** 確率上昇
   - これは ramp fixture の典型的な現実問題 (= 高速 IC で・自車が ramp / 本線どちらか判別困難)

2. **合流接近**: ramp 末尾 16m 以内に本線 → noise GPS で本線 polyline 上に乗りやすい

3. **bearing 差 47.5度**: 既存 heading scoring で・正解 ramp と本線で・GPS heading 整合性に差が出る
   - A-2 boost on で・**ramp bearing と整合する正解 ramp が +6% emission 強化**
   - boost off では差別化されず・typeCode boost で本線 snap される pattern

### A-2 (heading-vector boost) との関係

- ramp 239 segment 4 末尾の bearing (= 合流直前) と・本線 57 seg 0 bearing が 47.5度差
- → boost on で・GPS heading (= ramp 方向・noise σ 5度) と整合する 239 が +6% boost
- 本線 57 は cos(47.5度) = 0.676 → boost = 1 + 0.10 × (0.676 - 0.5) × 2 = 1.035
- → +2.5% 差 (= 軽微だが・typeCode の motorway boost と相殺する効果あり)

## 4 必須条件 (循環防止) 準拠確認

1. **実在競合道路**: mainline 57 を競合 明示・合流距離 16.4m ✅
2. **現実的ノイズ**: 実機相当 default (= 10m / 3m / 2%) ✅
3. **自明 fixture 回避**: 実 ehime ramp / motorway を scan で発見・typeCode 違いで Worker B の
   自然な誤 snap 傾向 (= motorway 優先 boost) を組み込み ✅
4. **A-2 boost on/off で結果変わる構成**: bearing 差 47.5度 → boost 差別化あり ✅
