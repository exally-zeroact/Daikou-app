I'll synthesize the three investigations into a strategic report. The data is comprehensive and well-sourced — let me verify one or two load-bearing claims before finalizing, then deliver the report directly.

The three investigations are internally consistent and converge on the same structural conclusion. I have what I need to write the strategist's report verbatim.

# 司さんへの報告書 — 「Google越え」の現実的な道と作戦(3調査統合・最終判定)

## 0. この報告の位置づけ

司さんからの問い直し「移動中の距離計測で本当に最強は誰か。前回の『Google同等止まり』結論は、今回の競合/技術サーチで上書きできるか」に、3調査(A=競合landscape / B=超える技術 / C=Google弱点・オフライン優位)を統合して**誠実に判定**します。誇張・捏造はせず、結論は出典に紐づけます。

---

## 1. 結論(先に確定)

### 1-1. 移動中距離計測でGoogleは1番か → **NO。ただし「クラウド汎用ナビ」では1番。**

距離計測の**絶対精度**だけを切れば、Googleより上が明確に存在します。

- **測量grade RTK**: 水平 1–3cm(network RTKで 8mm+0.5ppm)
- **車両ECUオドメーター**(車輪パルス): フリートの第一データ源、GPSは fallback
- **日本の認定ソフトメーター**(矢崎LT27S/二葉, 2025-03認定): 法定許容 距離 −4%〜0%

Googleの Roads/Directions API は「ナビ最適化・道路網snap」であって**距離計測専用に設計されていない**(Roads APIは「連続点300m以内」「100点/req」推奨=事後cleanup用、リアルタイム秒間累積計測用ではない)。

### 1-2. 前回結論「Google同等止まり」は維持か上書きか → **半分維持・半分上書き。**

ここが最重要の誠実判定です。前回結論は**1つの軸では正しく、別の軸では誤り**でした。

- **【維持】精度の絶対値ではGoogleを抜けない**。理由は学術的に確定: 生GPSは距離を系統的に過大評価する(Ranacher et al. 2016, IJGIS / IEEE Spectrum。真値5mが平均5.6m、高頻度サンプルで最大20%過大)。距離精度のボトルネックは**GNSSハードの絶対精度ではなく、生GPSの過大バイアスをmap-matchingでどれだけ殺せるか**。Valhallaの実測「matching後 +1.4%」はこの残差。**Googleも自前Viterbiも同じmap-matching天井に張り付く**(前回の自前9,436m vs Google 9,718m=3%差はこの天井内)。cm級補強(後述)もスマホでは物理的に閉じている。→ **「より良い測位でGoogleを抜く」道は技術的に閉じている。前回結論はこの点で正しい。**

- **【上書き】"土俵"を変えれば、Googleは構造的に立てない領域でダイコメが明確に上回る**。これは精度勝負ではなく「Googleがそもそも来られない/法的に使えない」確定軸。前回は「精度=同等」しか見ておらず、この土俵差を評価していなかった。→ **この点で前回結論は上書きされる。**

### 1-3. ダイコメがGoogleを"抜ける"現実的な道 → **ある。ただし「精度軸」ではなく「土俵軸」で。**

抜ける軸は4つ、すべて出典裏付け済み:
1. **法務適格性**(最重要・致命的)
2. **リアルタイム連続性**(1Hz自前Viterbi snap)
3. **低レイテンシ**(端末内処理=往復遅延ゼロ)
4. **完全オフライン**(Googleは原理的に走れない)

---

## 2. 競合比較表(主要プレイヤー × 距離精度 × オフライン × レイテンシ × 代行適性)

| プレイヤー | 距離精度 | スマホ単体オフライン | レイテンシ | 代行適性 |
|---|---|---|---|---|
| 測量grade RTK | ◎ 1–3cm | ✕ 基準局/補正通信必須 | — | ✕ 随伴車スマホ単体で不可 |
| 車両ECUオドメーター | ◎ フリート第一データ源 | ✕ OBD前提(客車に無い) | ◎ | △ 随伴車のみ・客車計測不可 |
| 日本認定ソフトメーター(矢崎/二葉) | ◎ 法定 −4%〜0% | △ 半オフライン・課金専用 | ◎ | ◎ 同じ土俵の競合 |
| **Google Roads API (snap)** | ○ urban canyonに強いが計測専用でない | **✕ 完全オンライン必須** | **✕ 往復0.25〜0.53s・高速で最大17m変位** | **✕ 法務・オフライン両面で不適格** |
| Mapbox/HERE/TomTom matching | 不明(独立ベンチ該当資料なし) | ✕ APIオンライン | ✕ | ✕ |
| Valhalla/OSRM(自前) | ○ matching後 raw比 +1.4%・成功率95.2% | **◎ 端末内で完全オフライン動作可** | ◎ | ◎ ダイコメの実装ベース |
| フリート(Geotab/Samsara) | ○ OBD優先・GPS自動99.9% | ✕ 専用機器・クラウド | ○ | △ 専用ハード必須 |
| 保険UBI(スマホGPS) | △ 都市部5–20m・旧機種は誤差大 | ✕ 送信前提 | ✕ | ✕ |
| **★ダイコメ(目標)** | **○ map-matching天井=Google同等** | **◎ 完全オフライン** | **◎ 端末内・往復ゼロ** | **◎ 代行専用・法定バンド準拠を名乗れる** |

**ダイコメの位置**: 精度はGoogle/Valhallaと同じ天井(○)。だが**オフライン・低レイテンシ・代行適性で唯一すべて◎**になれる。法定 −4%〜0% バンドへの明示準拠で矢崎/二葉と「同基準」を名乗れる。**Googleは2つの致命的✕(オフライン・法務)で代行課金メーターの土俵に立てない。**

---

## 3. ★Google越えの具体的作戦 — どれが本物の"抜ける道"か★

### (a) みちびきCLAS/MADOCA等の補強 → **本物ではない。スマホで物理的に閉じている。**

誇張せず断言します。**cm級補強はiPhone(スマホ単体)で全滅**:

- **QZSS CLAS(L6, 水平6cm)/ MADOCA-PPP(L6, dm級)**: 基準局不要・L6放送でオフライン土俵には合致するが、**一般スマホのGNSSチップはL6を native受信できず、外部L6アダプタ(ArduSimple/Septentrio NEO-D9C等)が必須**(ION論文。「regular GPS-only receivers or smartphone-integrated GPS cannot handle L6 signals」)。→ **現行スマホ単体で即採用不可。**
- **RTK / PPP / TDCP / carrier-smoothing**: いずれもraw観測値(pseudorange/carrier-phase)が必須。**iOSはCoreLocationがraw GNSSを一切開放していない**(Apple公式フォーラム「does not provide raw data. There's no API to get at the low level data.」)。AndroidはAPI24でraw開放されているが、duty-cycle(200ms ON/800ms OFF)が毎epochでcycle slipを起こしRTK不能。車内設置PPPの実測は1〜2m(=普通のGPSと大差ない)。→ **不採用。**

**結論: 「みちびきcm級で先回りしてGoogleを抜く」は幻想。技術的に閉じている。** ここを正直に切るのが参謀の責務です。

**ただし誤認禁止の重要事実**: multi-GNSS(GPS+GLONASS+Galileo+QZSS+BeiDou)とQZSS-SLAS(L1S, sub-meter)は**iPhone12以降が既に自動享受している**。「QZSSを使えば先回り」ではなく**もう使っている**。自前実装は不要・前提として効いている。

### (b) 専用メーターとして計測特化する優位 → **本物。Google自身が「計測器ではない」と公言。**

- Google Maps自体が「ナビアプリであって距離計測用に最適化されていない」(Mapulator)。
- Roads APIは polyline 5桁=約2mの量子化誤差、100点/reqバッチ前提、snap品質は連続点300m以内・1〜10秒間隔必須。**リアルタイム1Hz累積計測の設計思想ではない。**
- ダイコメは計測専用にチューニングした自前Viterbi snapを持てる。**これは本物の抜ける道。**

### (c) 低レイテンシ・オフライン・連続自前snapの優位 → **本物。最強の軸。出典で裏付け済み。**

- **法務(最致命)**: Directions APIの lat/lng一時キャッシュは**最大30日で削除義務**、route geometry恒久保存禁止。さらに「Google Maps Contentを非Googleマップと併用してはならない」=自前OSM geometry併用は規約違反。→ **課金距離=道なりsnap累積を恒久保持するダイコメ設計に、Google geometryはそもそも法的に組み込めない。精度以前の構造的排除。**
- **レイテンシ**: 査読論文(Nature Sci Rep 2024)実測でクラウドGNSS総遅延は車120km/hで0.531s、**高速走行で約17mの位置変位**。著者自身が「精度が最重要な用途には不適」と明記。
- **オフライン**: Roads APIは「No offline mode」。代行は深夜長距離・トンネル・郊外でLTEが切れる環境(memory既定の完全オフライン前提)。**Googleはそもそも走らない。**

### 本物の"抜ける道"の確定

**(b)計測特化 + (c)オフライン・低レイテンシ・連続自前snap = これが本物。(a)cm級補強は不採用。**

---

## 4. この作戦が白紙アーキ(pipeline.js + 属性snap主役 + センサー守り)に与える追加

白紙アーキは**既にこの作戦と整合**しています。土俵軸で勝つ設計だからです。追加すべきは「精度の絶対値を上げる無理筋」ではなく「土俵優位を最大化する3点」:

1. **自前道路データ密度 + Viterbi scoring改善**(map-matching天井そのものを薄く押し上げる唯一の正攻法。属性snap主役と完全整合)。
2. **Doppler速度積分の平行回路(cross-check用)** — 調査Bの唯一の現実的軸。iOSの `CLLocation.speed` はDoppler由来速度(数cm/s精度、静止でも飛ばない。位置差分はm/s級で静止時に数百ft飛ぶ)で、**raw開放なしに取得できる唯一の高精度オブザーバブル**。`distance_m`=道なりsnap累積(不可侵)を維持しつつ、Doppler積分を平行に持ち snapとcross-checkで二重化。停止/微速creep・交差点待ちで効く。**calcFare不可侵・distance_m不可侵を侵さない平行回路**として「センサー守り」に組み込める。
3. **法定 −4%〜0% バンドへの明示準拠の自己検証**(矢崎/二葉と同基準を名乗る根拠。出力監視に追加)。

**みちびき(CLAS/MADOCA)を採るなら何が要るか** → **外部L6受信アダプタ(NEO-D9C等)が物理的に必須**。随伴車スマホ単体構成では成立しない。**将来チップがL6 native対応した時の切り札として「保留」**。今の白紙アーキには入れない(入れても動かない)。

---

## 5. 司さんが納得して白紙に進める「作戦」を1つに

> **作戦名: 「土俵で抜く専用計測器」 — Googleと精度で殴り合わず、Googleが構造的に立てない土俵で完全に抜く。**

- **精度軸**: Google同等(map-matching天井は共通・cm級はスマホで物理的に閉鎖)で**割り切る**。ここで無理に殴り合わない。前回結論はこの点で正しかった。
- **勝つ軸(本当に抜く)**: ①完全オフライン(Googleは走れない)②端末内・往復遅延ゼロ③1Hz連続自前Viterbi snap④Google geometryは法的に課金台帳化不可=ダイコメは自前OSMで合法に恒久保持⑤日本法定 −4%〜0% 準拠を名乗る。**この5点はすべて出典裏付け済みの確定優位。**
- **白紙への具体追加**: pipeline.js + 属性snap主役 + センサー守り を土台に、(1)自前道路データ密度+Viterbi scoring改善 (2)Doppler速度積分の平行cross-check回路 (3)法定バンド自己検証。**distance_m / calcFare は不可侵。**
- **みちびきcm級**: 外部L6アダプタ必須で随伴車スマホ単体では成立せず→**将来チップ対応時の切り札として保留**(白紙には入れない)。

**一言で**: 「Google同等で割り切るのか、特定軸で抜くのか」→ **精度はGoogle同等で割り切り、"オフライン・低レイテンシ・連続計測・法務適格"の土俵軸で本当に抜く。** これが誇張なし・捏造なしで司さんが納得して白紙に進める唯一の現実的な作戦です。

---

## 不明・該当資料なし(誠実開示)

- Mapbox/HERE/TomTom の独立した距離計測ベンチ比較数値は各社非公開で**該当資料なし**。
- Roads API内部snapアルゴリズムの絶対精度を直接ベンチした第三者公開数値は**該当資料なし**(自前9,436m vs Google 9,718mの3%差が現状唯一の実測比較)。
- MLIT認定要領PDF本文の逐語確認は未達(数値はWebSearch要約から取得)。

## 主要出典
- Roads API制約/オフライン不可: developers.google.com/maps/documentation/roads/snap, /overview
- Google geometry法務(30日削除・非Google地図併用禁止): developers.google.com/maps/documentation/directions/policies, cloud.google.com/maps-platform/terms/maps-service-terms
- クラウド遅延17m変位(Nature 2024): nature.com/articles/s41598-024-65652-7
- GPS系統的過大評価(Ranacher 2016): arxiv.org/abs/1504.04504, spectrum.ieee.org/why_every_gps_overestimates_distance_traveled
- Valhalla matching後+1.4%: link.springer.com/article/10.1007/s42979-022-01340-5
- MLITソフトメーター −4%〜0%: mlit.go.jp/jidosha/content/001860154.pdf; 矢崎/二葉認定 2025-03
- QZSS CLAS/MADOCA L6専用機必須: qzss.go.jp/en/overview/services/sv06_clas.html, ion.org(L6アダプタ), ardusimple.com(NEO-D9C)
- iOS raw非開放: developer.apple.com/forums/thread/693229
- Doppler速度 数cm/s vs 位置差分m/s: insidegnss.com/how-does-a-gnss-receiver-estimate-velocity, gpsworld.com
- iPhone QZSS/multi-GNSS自動対応: developer.apple.com/forums/thread/691886