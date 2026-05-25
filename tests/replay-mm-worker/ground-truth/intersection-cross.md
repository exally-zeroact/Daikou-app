# intersection-cross-200m ground_truth 説明

## 選定理由

ehime road 全 117,504 件を松山周辺 grid で geometric scan して発見した
「4 方向直交交差点 (= 4+ road が同 junction で交わり・少なくとも 1 ペアが
bearing 80-100度差で直交) + 全 road が同 typeCode」の最良候補。

### scan 結果

- 4+ road junction 数: 77 件 (= 松山周辺 grid 内・直交ペア含)
- 同 typeCode フィルタ後の上位: 採用 = junction (33.82170, 132.76550)
- count=4 / 全 road が typeCode 4 (= tertiary)

### 正解 road = 66855

| 属性 | 値 |
|---|---|
| roadIndex | 66855 |
| typeCode | 4 (= tertiary) |
| layer | 0 (= 平面) |
| oneway | 1 (= 東向き一方通行) |
| 全長 | 941m (4 points / 3 segments) |
| start bearing (= junction から外へ) | 90度 (= 東) |
| junction (= start) | (33.82173, 132.76549) |

segments:
- **seg[0→1]: 669.7m (= ground_truth 採用・0→0.30 = 約 200m を 50 step に分割・進入+交差+退出を含む延長版)**
- seg[1→2]: 75.1m
- seg[2→3]: 203.7m

ground_truth 合計: **約 200.9m / 50 GPS step (= 4m/step / 14.4km/h・市街地徐行・warmup 10 償却で post-warmup 40 厚く)**

### 競合 road (= 3 件)

| roadIndex | 全長 | typeCode | bearing | oneway | 方向 |
|---|---|---|---|---|---|
| **122** | 295m | 4 | 270度 | 1 | 西向き (= 正解の反対車線・同 axis) |
| **64104** | 202m | 4 | 179度 | 0 | 南向き (= 直交) |
| **66856** | 529m | 4 | 358度 | 0 | 北向き (= 直交) |

すべて同 typeCode 4 (= tertiary・正解と同種)。

### 期待される困難性

1. **typeCode 同一**: Worker B の attrBoost で差別化されない (= 自明回避)
2. **122 の存在**: 同 axis 上の反対車線 (= bearing 270度・無向方位差 0度) ・
   GPS noise が junction 内で 122 寄りに振れると・oneway 違反 snap (= T10 lane scoring が
   判別する想定)
3. **64104/66856 の直交**: junction 内 GPS noise (= accuracy 10m) で・
   直交方向に振れると・誤 snap 確率上昇 (= 但し既存 ② headScore で差別化される想定)

### A-2 (heading-vector boost) との関係

- 正解 66855 bearing 90度 / GPS heading 約 90度 (= noise σ 5度)
- 競合 122 bearing 270度 → **無向で 0度差 = boost 同等 1.10**
- 競合 64104 bearing 179度 → 無向で 89度差 = **boost 0.90**
- 競合 66856 bearing 358度 → 無向で 88度差 = **boost 0.90**
- → boost on で・直交 64104/66856 が -10% (= 強差別化) / 反対車線 122 は同 boost (= 差別化されず・T10 が担当)
- → boost on/off で snap 結果が変わる構成 (= 角度系 fixture として有効)

## 4 必須条件 (循環防止) 準拠確認

1. **実在競合道路**: 122 / 64104 / 66856 を competing_road_indices で明示 ✅
2. **現実的ノイズ**: 実機相当 default (= 10m / 3m / 2%) ✅
3. **自明 fixture 回避**: 同 typeCode フィルタで attrBoost 差別化不可・実 ehime ジオメトリ ✅
4. **A-2 boost on/off で結果変わる構成**: 直交 64104/66856 で boost 差別化される ✅
