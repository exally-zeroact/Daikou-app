I now have the load-bearing facts verified against actual code. Key confirmations: `distance_m` is accumulated from `mmIncrementM` (MM road-snap distance) as the primary charging basis, with GPS-straight-line fallback after 5s MM silence; `calcFare` is base 1300 + 420m steps; v7 bitmap has all attributes (oneway/incline/lanes/width/layer/maxspeed); `calcRoadDistance` integrates haversine along snap-point segments (chord between snap points, not full polyline arc). I have enough to synthesize honestly.

---

# 距離計測"方式"確定 答申書 — 白紙書き直しに向けた MM/Doppler/ハイブリッド 論戦統合

司さんへ。3方式の擁護ブリーフを統合し、コードで裏取りした上で、「MM式が本命でよいか」に誠実に答えます。先に結論、後に論拠と課金影響です。

---

## 1. 結論 — 本命は「MM主・Doppler従の局面適応ハイブリッド」。単独MMでも単独Dopplerでもない

**「GoogleがやっとるからMM」は据え方として誤りです。正しい据え方は「日本の国交省認定ソフトメーター(矢崎/二葉)が実運用で採る = 位置MM主 + 速度補完従」であり、これにダイコメ固有の v7 全属性 + coords.speed を足して強化した構成が、出典・物理・実装可能性のすべてで最良です。**

3方式の論戦を裁定すると、3擁護者の主張は実は**衝突していません**。同じ階層構造の別の面を述べています:

- **高精度MM擁護**が正しい点: ダイコメは高サンプリング regime(1〜5Hz)で、文献のMM弱点(並行道路誤snap・gap)の大半は低サンプリング起因なので無効化される。raw GPSの系統的過大評価(Ranacher 2016)を殺せるのはMMのsnapだけ。→ **距離の基準系はMMであるべき**は妥当。
- **Doppler擁護**が正しい点: MMが構造的に苦手な局面(低速creep・停車・並行・gap)で、位置を差分しないDoppler速度は誤差の出方が逆で独立。ただし**単独本命は擁護者自身が明確に否定**(スマホ coords.speed はTDCP級でなく長距離で積分ノイズが乗る)。→ **従の補完柱として正当**。
- **ハイブリッド擁護**が正しい点: 認定メーターが現にこの構成。局面適応で単独MMの3%天井を押し下げる。

→ 3者は「MMを基盤に、Dopplerを従属補完にした適応ハイブリッド」で**収束します**。MMを捨ててDoppler単独に振るのは、σ²系統過大評価を消す唯一の機構を捨てる退行。Doppler無しの単独MMは、低速creep・gapで誤差を作る天井に張り付く。

**ただし最重要の留保**(後述§4): 現状コードでは `distance_m`(課金根拠)が既にMM道路snap距離です。**この基準系をハイブリッドに変えるかは課金根拠の変更であり、司さんの裁定が必須です。**

---

## 2. 方式比較表

精度欄の数値は出典別に「実測/出典値/推定」を明記(捏造回避)。

| 方式 | 距離精度 | 高速・直進 | 低速・徐行 | 停車 | gap(トンネル/ビル陰) | 並行道路 | PWA実装可否 |
|---|---|---|---|---|---|---|---|
| **単独MM**(位置→snap道なり累積) | 実測3%差(社内値・外部出典なし) | ◎ rawを道路に貼り過大を殺す | △ snap揺れがcreep化 | ✕ 停止中もUEREで距離が湧く | ✕ fix喪失で道なり距離を推定不能 | △ 平面では誤snap、ただしlayer属性で緩和可 | ◎ 実装済(map-matcher.js/roads-decoder.js) |
| **Doppler速度積分**(∫speed dt) | 計測器級は3cm/1000m(VBOX出典)。**スマホ coords.speed は水平RMS約20mm/s〜0.2m/s/軸**(MDPI/PMC出典) | ○ 高SNRなら良 | ◎ 位置差分しないのでcreepに免疫 | ◎ speed≈0でZUPT容易 | ○ gap直前速度を保持/補間 | ◎ 道路同定を問わずスカラー積分=並行に免疫 | ○ coords.speed取得可(W3C)。生Dopplerより平滑遅延・speed=null端末あり |
| **適応ハイブリッド**(MM主×Doppler従×topology補間) | 推定で単独MM 3%→1〜1.5%級(出典からの推定・実測未確定) | ◎ MM主 | ◎ Doppler主 | ◎ ZUPT | ○ topology補間+∫v dt(認定メーター同手法) | ◎ Doppler heading+属性でlink仲裁 | ○ 上記2方式の合成で実装可 |
| **データ密度強化MM**(v7全属性投入) | 3%押し下げの方向と機構は出典で確実、**到達値は実測案件(該当事前出典なし)** | ◎ | △(密度では低速creepは解けない) | ✕ | △ | ◎ layer/oneway/maxspeedで誤snap削減 | ◎ v7属性は既にdecode済 |

**コード裏取り**: roads-decoder.js の v7 bitmap は typeCode/oneway/incline/lanes/width/layer/access/maxspeed を全保持(L89-101)、precision 1e5(約1.1m分解能)、全shape point delta polyline。`calcRoadDistance`(L571-654)は **snap点間を segment 単位の haversine 弦長で積分**(= 現状は道路polylineの真の弧長ではなく snap点を結ぶ弦)。これは§3の「弦切り」改善余地に直結します。

---

## 3. 推奨方式の設計

### 切替ロジック(局面適応・Dopplerゲート付き)

```
each GPS tick:
  v = coords.speed                  // Doppler由来・speedAccuracy でゲート
  q = 衛星品質 (accuracy, _estimatePdopMultiplier, 連続性)
  if v < 静止閾値 (speedAccuracyで動的):  Δd = 0                     // ZUPT・creep殺し
  elif q good かつ 道路一意:              Δd = MM道なり弧長          // MM主・過大を殺す
  elif gap (5s<dt≤60s) or 並行曖昧:       Δd = ∫v dt, 経路=topology補間 // Doppler主
  else:                                  Δd = w·MM + (1-w)·∫v dt   // 重み融合 w=f(q)
```

ダイコメは既に GAP_ROUTE_MAX_SEC=60s の gap道路routing、ZUPT相当の静止判定(MEMORY Fix①の加速度variance主体)、`_estimateJumpProb`/`_estimatePdopMultiplier` を実装済みで、切替の足場は揃っています。

### データ密度(v7)と coords.speed の組み込み

1. **弦切り低減(最も効く)**: 現状 `calcRoadDistance` は snap点間を弦で結ぶ。これを**道路polylineに沿った真の弧長**(間の全shape pointを経由)に変えると、カーブでの過小評価を構造的に解消。v7が全shape pointを持つので実装可能。curve離散化理論(Springer/ScienceDirect)が density での単調収束を保証。
2. **属性制約をViterbi transitionへ**: layer(立体交差の上下並行誤snap殺し)、oneway、typeCode を hard/soft制約に。Lane-level HMM/Backtracking topological MM が「topology+directionality+geometry制約で精度有意向上」と明言。
3. **maxspeed × coords.speed 整合**: 観測Doppler速度がlinkのmaxspeedと不整合なleg(細街路候補を高速で走る等)を棄却。既存の遠回り誤snap過大ガード(GAP_MAX_DETOUR_RATIO)の自然な拡張。
4. **incline(DEM勾配)で斜距離補正**: 既に `_apply3DCorrection`(L1065)実装済。

### 3%天井の押し下げ見込み

**正直に言います**: 3%(社内実測9,436m vs Google 9,718m)を v7投入で何%まで下げられるかの**確定値は、ダイコメ固有データの実機実測でしか出ません。事前出典の確定値は存在しません**。Lane-level HMMの path-length誤差3.3%は標準データの天井値で、incline/layer/lanes/maxspeedフル属性投入後の値ではない。ハイブリッド擁護の「1〜1.5%級」も出典からの**推定**です。

確実なのは**押し下げの方向と機構**(弦切りは densify で単調収束=数値解析の定理、属性制約は誤snap削減=複数HMM論文)。**到達値はテストツール先行での実測案件**(MEMORYのテストツール先行ルール該当)。

---

## 4. ★課金への影響(最重要・司さん裁定必須)★

**現状コードの事実**(meter.js で裏取り):
- `state.distance_m` は **既にMM道路snap距離が primary**(mmIncrementM>0受信で `distance_m += mmIncrement`、MM silent 5s+ でGPS直線fallback)。これは2026-05-09設計変更で確定済み(meter.js L1-5)。
- `calcFare`(L1425)= base 1300円 + 420mごと100円。distance_m を入力に取る。

**したがって課金影響は方式ごとに段階が違います**:

- **✅ 課金根拠を変えない範囲(司さん裁定不要・実装で進められる)**:
  - `calcRoadDistance` の snap点間弦長 → polyline弧長への精緻化。これは「同じMM道なり距離をより正確に積分する」改善で、**distance_m の定義は変わらず精度が上がるだけ**。
  - layer/oneway/maxspeed をViterbi scoringに投入(誤snap削減)。MEMORYでも「Viterbi scoring改修可・課金ロジック不可侵」と整理済み。
  - calcFare料金式は**全方式で1 byteも変えない**(不可侵)。

- **🛑 課金根拠の変更(司さん裁定が絶対必須・1人で進めてはならない)**:
  - **distance_m の基準系そのものを「MM道なり累積」から「ハイブリッド融合(局面でDoppler ∫v dt に切替)」に変えること**。これは課金される距離の定義変更 = 課金根拠の変更です。低速・gap局面で「MM道なり距離」でなく「Doppler積分距離」が課金額に直接乗る。
  - 同様に、Doppler積分を distance_m 加算経路に入れること全般。

**白紙書き直しの方針案**: 表示層(business_display_distance_m 等)はハイブリッドを自由に使ってよい(課金経路ゼロ)。**課金層の distance_m にDoppler融合を入れるか否かだけが司さん専決事項**。MEMORYの「層1表示=実装可/層2課金端末一致=司さん裁定待ち」「distance_m不可侵」「課金ロジック不可侵」と完全整合します。

---

## 5. 白紙アーキ(pipeline.js 単一state machine)への構造

```
pipeline.js (単一 state machine)
├─ ingest: GPS sample {lat,lng,t,accuracy,speed,speedAccuracy,heading,alt}
├─ stationary gate: 加速度variance主体 (Fix①) → ZUPT判定
├─ phase classifier: q(衛星品質) + v(Doppler) で局面ラベル付け
│    {DRIVING_CLEAR, LOW_SPEED, STOPPED, GAP, PARALLEL_AMBIGUOUS}
├─ MM core (現 map-matcher.js 相当・Worker B):
│    Viterbi(N=10〜15) + v7属性制約 + polyline弧長積分
├─ Doppler integrator: ∫speed dt (ZUPTクランプ付き・別系統独立信号)
├─ fuser: 局面ラベルで主従決定 → Δd_candidate
├─ ★charging boundary (不可侵境界)★:
│    distance_m += Δd  ← ここに何を入れるかが司さん裁定点
│    fare_yen = calcFare(distance_m)  ← 料金式不変
└─ display layer: 予測補間 + hysteresis (課金経路ゼロ・自由)
```

要点: **「課金境界」を構造上の単一の関所**にし、そこに流す Δd の定義(MM単独 か ハイブリッド か)だけを司さん裁定で切替可能なスイッチにする。fuser/MM/Doppler は全部その手前。料金式は関所の外で不変。これにより「方式の進化」と「課金根拠の安定」を構造的に分離できます。

---

## 6. 認定メーター(矢崎/二葉)との比較 — ダイコメが同等以上と言える根拠

- **同等性の根拠**: 認定メーター(二葉計器 2025-03-24プレスリリース、矢崎LT27S)は「GNSS位置で走行距離を推計し、トンネル等GNSS不足地点では**速度情報で位置を補足**」=本答申のMM主・速度従ハイブリッドそのもの。ダイコメが同型を採れば、国交省ソフトメーターと同じ方式準拠であり、業界標準・特許安全(MEMORYの業界標準準拠方針と整合)。
- **同等以上と言える根拠**:
  1. **端末内属性の質量**: ダイコメは v7 で typeCode/oneway/incline/lanes/width/layer/maxspeed を全道路で端末内保持。認定メーターやGoogle課金アプリがドライバ端末に渡さない密度。layer による立体交差の上下並行誤snap抑止は、平面HMMが最も間違える局面の固有の武器。
  2. **弧長精緻化の自前制御**: 元polylineを端末内に持つため、Google Roads APIの interpolate=true 相当を自前解像度で実行可能。
  3. **完全オフライン**: 認定メーター同等の方式を、通信なし(coords.speed + 端末内roadsのみ)で実装できる。

**留保(誠実に)**: 認定メーターは法的に運賃確定精度を満たす認定を取得済み。ダイコメが「同等以上」を**主張できる**のは方式とデータ量の論理上であり、**実測での同等性立証は未了**。ここもテストツール先行→実機trace検証で確定すべき値です。

---

## 「MM式が本命でよいか」への最終回答

**MMを距離の基準系に据えるのは正しい。ただし「単独MM」ではなく「MM主・Doppler速度積分従・topology補間のハイブリッド」が本命です。** これは Google模倣ではなく国交省認定メーターと同じ正解で、ダイコメは v7属性 + coords.speed で同等以上を狙える。

白紙で即進めてよいのは(a)polyline弧長精緻化、(b)v7属性のViterbi投入、(c)表示層ハイブリッド — いずれも distance_m 定義不変。**唯一、課金層 distance_m にDoppler融合を入れるか否かだけが司さんの裁定事項**です。calcFare料金式は全案で不可侵。

**捏造なしの注記**: ①ハイブリッド融合後の到達精度(1〜1.5%級)、②3%天井の押し下げ確定値、③認定メーターとの実測同等性 — この3点は出典で方向は確実だが**確定数値は事前出典になく、テストツール先行での実機trace実測案件**です。

### 主要出典
- Ranacher et al. 2016「Why GPS makes distances bigger than they are」IJGIS: https://pmc.ncbi.nlm.nih.gov/articles/PMC4786863/ / https://arxiv.org/pdf/1504.04504
- Newson & Krumm 2009 HMM map-matching: https://www.researchgate.net/publication/221589790
- Lou et al. Map-Matching for Low-Sampling-Rate GPS (Microsoft Research)
- Lane-Level HMM(path-length誤差3.3%)Chalmers: https://research.chalmers.se/publication/525277/file/525277_Fulltext.pdf
- 二葉計器 国交省認定ソフトメーター: https://www.futabakeiki.co.jp/2025/03/24/softmeter_certified/ / 矢崎 LT27S 認定
- VBOX Doppler積分距離 3cm/1000m: https://www.vboxautomotive.co.uk / ONO SOKKI LC-8310(0.003 m/s 2σ)
- GNSS Doppler速度 Inside GNSS / スマホ速度RMS MDPI Algorithms 17/1/2 / W3C Geolocation API
- ダイコメ実装裏取り: `C:\Users\zeroa\Daikou-app-test\js\roads-decoder.js`(v7 24bit bitmap全属性・precision 1e5・全shape point delta polyline・`calcRoadDistance` は現状snap点間弦長積分)、`C:\Users\zeroa\Daikou-app-test\js\map-matcher.js`(Viterbi N=10〜15・属性scoring・gap routing・_apply3DCorrection)、`C:\Users\zeroa\Daikou-app-test\js\meter.js`(distance_m は既にMM道路snap primary・MM silent 5s+ でGPS直線fallback・`calcFare` base 1300円+420m/100円)
- 該当出典なし: 社内実測9,436m vs Google 9,718m(外部出典なし)、融合後到達精度%、認定メーター実測同等性