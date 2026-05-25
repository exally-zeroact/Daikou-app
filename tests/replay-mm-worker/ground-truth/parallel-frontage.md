# parallel-frontage-211m ground_truth 説明

## 選定理由

ehime (= 松山市西部・33.8564N, 132.7611E) において・実 OSM road から並走道路ペアを
geometric scan で発見した結果の最有力候補 (= top by min(length_a, length_b))。

### scan 結果 (= 2026-05-21・Phase 1 着手時)

- 候補数: 174 並走ペア (= 同 grid・dist 5-50m・bearing 無向差 <10度・両 length >80m)
- フィルタ後: 83 ペア (= 同 typeCode + 同 layer + 両方非 oneway)
- 採用: pair#0 (= 最長 + 距離 24.5m + bearing 差 0.4度)

### 正解 road = 22203

| 属性 | 値 |
|---|---|
| roadIndex | 22203 |
| typeCode | 5 (= unclassified) |
| layer | 0 (= 平面) |
| oneway | 0 (= 双方向) |
| lanes | 0 (= 不明) |
| 全長 | 411m (8 points / 7 segments) |
| bearing (start→end) | 276.5度 (= 西) |

segments:
- seg[0→1]: 9.2m
- seg[1→2]: 113.0m
- **seg[2→3]: 53.6m (= ground_truth に採用)**
- **seg[3→4]: 83.7m (= ground_truth に採用)**
- **seg[4→5]: 73.9m (= ground_truth に採用)**
- seg[5→6]: 51.1m
- seg[6→7]: 36.9m

ground_truth 合計: **211.2m**

### 競合 road = 22235

| 属性 | 値 |
|---|---|
| roadIndex | 22235 |
| typeCode | 5 (= unclassified・正解と同種) |
| layer | 0 (= 平面・正解と同 layer) |
| oneway | 0 |
| 全長 | 421m (8 points / 7 segments) |
| bearing | 277.0度 (= 正解と 0.5度差・同方向並走) |
| 中心点距離 | 24.5m (= 正解と近接並走) |

### 期待される困難性

- 正解と競合は・bearing 差 0.4度 (= heading-vector boost で差別化不可)
- 25m 並走 = GPS accuracy 15m と同 order
- → 既存 distScore + Mahalanobis だけでは判別困難
- → HMM Viterbi の **transition score (= 道路間の連続性)** で本来判別すべき
- 本 fixture は・実 Worker B が「並走道路を Viterbi 連続性で正しく追跡できるか」を測る

### A-2 (heading-vector boost) との関係

heading 0.4度差 → boost は 22203 / 22235 ほぼ同値 (= 差別化なし)。
→ **本 fixture は A-2 検証 fixture ではない** (= 角度系は y-fork / intersection / ramp で別途)。
→ 本 fixture は「基盤動作確認」+ 「最も難しい並走 case の baseline」を担当。

## 「自作正解に自作 trace の自明 fixture」回避の根拠

1. 正解 road / 競合 road は実 OSM ジオメトリ (= ehime data 由来・私が描いていない)
2. 合成 GPS は noise model (= seed 42 で deterministic・accuracy 15m / position σ 5m /
   heading σ 5度 / outlier 5%) を適用・noise によって GPS は 22203/22235 の間に分布
3. ground_truth 3 segment は 22203 の中央 (= 22235 とも近い 211m 区間) を意図的に選択・
   両方の road に近い difficult zone
4. 期待: snap precision 50-90% (= HMM 連続性で 22203 を選べるか・baseline 測定)

## 次セッション以降の追加 fixture (= 残り 7 件)

- y-fork-150m: ehime road で Y 字 3 分岐を発見
- intersection-cross-100m: 4 方向交差点
- ramp-merge-400m: 高速 ramp 合流
- uturn-150m: U-turn (= bearing 180度反転)
- reverse-oneway-100m: 逆走 oneway
- low-speed-stop-50m: 低速 + 停車・heading 不定
- overpass-vs-ground-200m: 高架 + 地上 layer 判別

各 fixture は実 ehime road を geometric scan で同定・本 file と同じ形式で構築する。
