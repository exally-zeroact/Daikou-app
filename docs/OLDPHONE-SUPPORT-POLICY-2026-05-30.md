The three investigations are complete and consistent with the codebase. I have everything needed to synthesize the final policy report.

# 古いスマホ対応 方針確定報告書 — 新距離エンジン(pipeline-distance.js)

作成: 2026-05-29 / CTO 参謀統合 / 3 調査(性能・軽量化・メモリ)の統合確定版
対象コード: `C:\Users\zeroa\Daikou-app-test\js\pipeline-distance.js`, `js\map-matcher.js`, `js\roads-decoder.js`, `js\mm-data-pipeline.js`

---

## 結論(司さん向け 3 行)

1. **新エンジンは古スマホでも実用速度で動く。** Worker B 内で動くため UI 描画を直接ブロックせず、iOS(GPS 最大 1Hz)では完全に予算内。最大の重さは routing でも Kalman でもなく **snap の cell varint デコード**(seg1 時間の約 96%)。
2. **致命リスクは性能ではなくメモリ。** 現状「47 県全 decode を永久常駐」+「decoder eviction なし」+「`this.data`/`this.bytes` 二重保持」で、少 RAM 端末(iOS 300〜450MB 上限 / 2〜3GB Android)では **ページクラッシュ(Jetsam kill / WebKit 65% strict)に届く現実的危険**。
3. **やるべきは 2 つに集約: ① decoder の県別 LRU 化(メモリ最優先)② snap デコードの重複排除(性能最優先)。** どちらも **課金 distance_m / calcFare / 9.7km 級精度は完全不変**で達成できる。Dijkstra 軽量化・Kalman 次元削減は費用対効果が低く保留。

---

## (1) 新エンジンは古スマホで実用か / 最大の重さは何か

### per-tick 性能外挿(ハイスペック PC 実測 0.93ms/点 を基準)

| デバイス帯 | CPU 倍率(出典) | per-tick 推定 | GPS レートでの判定 |
|---|---|---|---|
| ハイスペック PC | 1x(実測) | 0.93ms | — |
| 中スペック Android | 4x / 実測 2.9x | 2.7〜3.7ms | 余裕 |
| 低スペック Android(Moto G / Galaxy A15 級) | 6x / 実測 9.1x | 5.6〜8.5ms | 予算内 |
| 数年落ち低速 Android(最悪) | 〜16x | 〜15ms | 5Hz でピーク時に詰まりうる |

出典: CPU slowdown 4x/6x は [Chrome DevTools/Lighthouse 標準](https://www.debugbear.com/blog/cpu-throttling-in-chrome-devtools-and-lighthouse) と [CSS Wizardry 2025 実機キャリブレーション(低 9.1x / 中 2.9x)](https://csswizardry.com/2025/08/low-and-mid-tier-mobile-for-the-real-world-2025/)。Lighthouse 基準機は [Moto G4 / Moto G Power](https://github.com/GoogleChrome/lighthouse/issues/12297)。

### 判定
- **iOS Safari は GPS 最大 1Hz**(`pipeline-distance.js` L75-76 明記)→ 1 tick/秒。15ms でも 1000ms 予算に対し完全に余裕。**実用 OK**。
- **Android Chrome は最大 5Hz**(200ms 間隔)→ 平均は予算内だが、**真のリスクは「平均」でなく「ピーク tick」**: snap miss でリング 9 まで拡張 + 別道路 routing が `_graphCache` ミス + 新規 cell 大量 decode が**単一 tick に重なると 30〜50ms に跳ねる**。これが memory 既出の「Android 止まったまま」症状と整合。

### 最大の重さ(重い順・実コード確認済)
1. **【最重量】SnapCache の cell varint デコード** — `_roadsInCell`(L151-169)→ `decoder.decodeRoadAt`(`roads-decoder.js` L212-219)。コード自体が「seg1 で時間の ~96%」と明言。走行中は新 cell に次々入るため初回 decode を逃れられない。
2. **【最重量・重複処理】RoadGraphRouter `_buildLocalGraph`(L340-417)が SnapCache とは別に再 decode** — `decoder.getRoadsNear(searchGrids=3)` が `SnapCache._cellCache` を共有せず同じ周辺道路を**もう一度 varint デコード**。±3=最大 49 グリッド × 3 アンカー。これが性能側で潰すべき本丸。
3. 【中量】`_nearestNode` / `_buildNodeIndex`。
4. 【無視可】Doppler/ZUPT/haversine(算術のみ)。

---

## (2) 実装すべき軽量化(優先度順・効果/副作用/課金影響)

### ★優先度 1: snap と routing の decode 重複排除(性能の本丸・距離完全不変)

- **問題**: snap 経路(`SnapCache._cellCache`)と routing 経路(`getRoadsNear` → `decodeRoadAt` 直叩き)が**同じ周辺道路を二重 varint デコード**。
- **対策**: `getRoadsNear` を `SnapCache._cellCache` 共有に変更(cell 単位 decode 結果を両者で再利用)。
- **効果**: 別道路 routing tick の最重量コストをほぼ半減。ピーク tick の 30〜50ms スパイクを直接削る。
- **★距離副作用: ゼロ★** — デコード結果は同一バイト列由来で bit 単位同一。snap 結果も routing graph も**入力が変わらない**。`distance_m` 完全保存。

### ★優先度 2: バッチ replay の Worker yield / chunking(thread starve 回避・距離不変)

- **対象**: 復元・seg 一括 replay(1582 点 ≈ 1.5 秒)。**live ingest(1 点 ~0.93ms)は現状維持・yield 不要**。
- **対策**: replay 点ループに 16〜32 点ごと yield 挿入。`scheduler.yield` は Safari/古 Chrome 未対応のため **`setTimeout(0)` fallback 必須**。
- **効果**: Worker が単一同期ループで GC・`postMessage`(GPS 受信/距離表示)を枯渇させる症状を解消。
- **★距離副作用: ゼロ★** — 区間距離は分割しても可換(累積和)。yield は「いつ計算するか」だけ変え「何を加算するか」は不変。出典: [web.dev chunking / scheduler.yield](https://web.dev/articles/optimize-long-tasks)。

### ★優先度 3: display refresh の適応間引き(発熱/CPU 直接低減・距離不変)

- **対象**: 表示 10Hz 予測補間(α-β filter α=0.85/β=0.005, Sklansky 1957)。
- **対策**: 速度変化が小さいときは 2〜4Hz に間引く。**間引くのは「画面更新」だけ**。
- **★最重要落とし穴★**: **GPS 実測点は絶対に間引かず全点 `ingest()`。入力点を間引くと距離が変わる(禁止)。**
- **★距離副作用: 設計上ゼロ★** — 表示補間層は課金 `distance_m`/`calcFare` に**書き戻し禁止**(memory「business_display_distance_m 新設・層分離」厳守)。

### 保留(費用対効果低)

- **Dijkstra → A*/双方向化**: ボトルネックは routing でなく snap。やるなら双方向 Dijkstra(厳密最短=距離不変)のみ。**A* は heuristic が admissible(haversine)でないと距離が変わるため非 admissible/早期打ち切りは禁止**。600m 上限では効きが小さく PQ オーバーヘッドで逆効果懸念。出典: [arxiv 1910.12526](https://arxiv.org/abs/1910.12526)。
- **Kalman 12→6 次元削減**: エンジン外(`gps-worker.js`)。文献上「低精度受信機では削減効果 negligible」だが**距離影響はゼロではない**([MDPI 13/11/15307](https://www.mdpi.com/2072-4292/13/11/15307))。実走 trace で `distance_m` 差が運賃 1 刻み未満と実証できた場合のみ採用。
- **snapMaxDistM / リング上限の削減**: **距離分類を変える=距離が動くため禁止。** decoder と同一結果を保つ現状の「+1 リング停止」厳守。

---

## (3) メモリ対策(致命リスク・最優先で着手)

### 現状の構造的問題(実コード確認済)
- `RoadDecoder`(`roads-decoder.js` L159-185)が県ごとに **`this.data`(roadsB64 含む UTF-16 文字列=ファイル長×2)+ `this.bytes`(decode 済=×0.75)を二重保持** + `grid` + `offsetTable`。roads-aichi/hokkaido は各 11.7MB ファイル → 1 県で数十 MB に膨張。
- `map-matcher.js` L153 `const decoders = new Map()` に **eviction が一切ない**(TileCache LRU は別物)。
- `mm-data-pipeline.js` `_backgroundLoadAll`(L463-510)が **全 47 県を無条件 background load** → worker ヒープ **250〜400MB+ に到達しうる**。

### 少 RAM 端末の上限(出典付き)
- **iOS Safari/WKWebView**: ページ実用上限 **約 300〜450MB**。WebKit は限界 65% で「コンパイル済み JS 全削除(=体感激重)」、超過で Jetsam kill(PWA でもページごとクラッシュ)。出典: [catchmetrics WebKit RAM deep-dive](https://www.catchmetrics.io/blog/deep-dive-ram-internals-webkit), [WebKit bug 188091](https://bugs.webkit.org/show_bug.cgi?id=188091)。
- **Android Chrome**: タブ/Worker は別 OS プロセスで重いタブ単独でも OOM kill。低 RAM(2〜3GB)で落ちる。出典: [Chrome DevTools memory](https://developer.chrome.com/docs/devtools/memory-problems)。
- **base64 デコード GC スパイク**: 47 県連続 decode で base64 文字列・中間 string・Uint8Array 一斉生成。base64 は +33% 膨張。出典: [web.dev base64](https://web.dev/articles/base64-encoding)。

### 対策(課金 distance_m/calcFare 不可侵)
1. **★最優先: decoder を「現在地県 + 隣接数県」のみ常駐 + LRU eviction(上限 3〜4 県)★** — `_priorityLoadCurrentPref`(L518)は既存。`_backgroundLoadAll` の全 47 県 load を絞り、`decoders` Map に TileCache 同様の LRU を導入。県跨ぎは既存 `enqueueRetry` で on-demand 救済。**代行は同一エリア移動が大半 → 精度影響なし。**
2. **`this.data` 参照を切る** — 構築後 `roadsB64` 保持不要。`this.bytes` + `grid`/`gridSize`/`precision`/`types`/`numRoads`/`restrictions` を個別フィールドにコピーし `this.data` を破棄 → 1 県あたり「ファイル長×2」の UTF-16 文字列を即解放。
3. **SnapCache `_cellCache`** は trip 終了 `reset()`(L259)で確実破棄(既存・維持)。

---

## (4) 対応する最低スペックの目安

| OS | 最低対応の目安 | 根拠 |
|---|---|---|
| **Android** | RAM **3GB 以上** / Snapdragon 6xx 〜 Moto G Power(2020+)級 | Lighthouse 基準機(Moto G4/G Power)で per-tick 5.6〜8.5ms=予算内。ただし **2GB 機はメモリ対策完了まで非対応扱い**(47 県 load で OOM 危険) |
| **iPhone** | **iPhone 8 / SE 第2世代(2GB RAM, A11/A13)以降** | GPS 1Hz で性能は余裕。律速はメモリ。iOS 300〜450MB 上限に対し decoder 県別 LRU 化が完了すれば 2GB 機でも安全圏 |

**前提**: いずれも **(3) メモリ対策の完了が対応の必要条件**。メモリ対策前は「ハイ〜中スペックのみ動作保証・低スペックはクラッシュ可能性」。メモリ対策後に上記が成立。

---

## (5) 白紙アーキへの具体変更点(チーム実装に渡す設計)

### A. `js/roads-decoder.js`(メモリ二重保持の解消)
- コンストラクタ(L159-185 付近): `this.data = roadsData` を**やめ**、必要フィールド(`grid`, `gridSize`, `precision`, `types`, `numRoads`, `restrictions`)を個別コピー。`this.bytes = base64ToBytes(roadsData.roadsB64)` 後、`roadsData` 参照を解放(`roadsB64` を GC 可能に)。
- `getRoadsNear`(L236-258): **SnapCache の cell decode キャッシュを受け取る/共有する API に変更**(下記 B と連動)。`decodeRoadAt` 直叩きを廃し cell キャッシュ経由に。

### B. `js/pipeline-distance.js`(decode 重複排除 + replay yield)
- `SnapCache`(L141-169)の `_cellCache` を **RoadGraphRouter からも参照可能に**(コンストラクタで SnapCache 参照を `RoadGraphRouter` に注入、または cell decode 関数を共有依存として渡す)。
- `RoadGraphRouter._buildLocalGraph`(L340-417): `decoder.getRoadsNear` の代わりに **共有 cell キャッシュから道路取得**。同一 cell の二重 varint decode を排除。
- **replay/復元経路のみ** 16〜32 点ごとに `await scheduler.yield?.() ?? new Promise(r=>setTimeout(r,0))`。`createDistanceTracker.ingest`(live)は同期維持。
- **不変条件**: snap 判定閾値(`snapMaxDistM`, `fallbackMaxRing`)・routing 発火条件(別道路 かつ ≤600m)・`calcRoadDistance` の弧長/haversine 分岐は**一切変更しない**。

### C. `js/map-matcher.js`(decoder LRU)
- L153 `const decoders = new Map()` → **LRU ラッパ(上限 3〜4 県、TileCache L228 と同機構)**。eviction 時 `RoadDecoder` の `bytes`/`grid` を null 化し GC 解放。
- 新エンジン ingest(L3232)は変更不要。decoder 取得時に LRU touch を入れるのみ。

### D. `js/mm-data-pipeline.js`(全県 load 停止)
- `_backgroundLoadAll`(L463-510): 全 47 県展開を**「現在地県 + 隣接県」に限定**。`_priorityLoadCurrentPref`(L518)を主経路化。県跨ぎは既存 `enqueueRetry` で on-demand。

### 検証ゲート(memory「テストツール先行・実機 trace 必須・緑≠直った」厳守)
1. **STEP 1(必須先行)**: 実走 trace(9.7km 級 + Aichi 高密度市街地)を console 注入する回帰テストツール整備。
2. **STEP 2**: 各変更後、変更前後で `distance_m` / `calcFare` の **bit 単位一致(decode 重複排除・LRU・yield)** または **運賃 1 刻み未満(Kalman 採用時のみ)** を実 trace で実証。
3. **STEP 3**: 低 RAM 端末(2〜3GB Android 実機 / iPhone SE 級)で OOM が出ないこと・per-tick p99 を Worker 内計測(既存 `_MCM_LAT_THRESHOLD_MS` 監視と並べる)。
4. ローカル PASS = CI PASS と決めつけない。実機検証宣言前に必ず実走 trace。

---

## (6) ★絶対不変制約(全変更の前提条件)★

- **`distance_m`(課金距離)不可侵** — 道路 snap 経路。本方針の優先度 1/2/3 は全て distance_m を **bit 単位で不変**に保つ(decode 重複排除=同一バイト列、yield=累積和の可換性、display 間引き=表示専用層)。
- **`calcFare`(運賃計算)不可侵**。
- **9.7km 級実走 trace の距離精度不変** — 検証ゲート STEP 2 で実証必須。
- **GPS 実測点は全点 `ingest()`。入力点間引き禁止。** 間引きは「画面更新」のみ。
- **snapMaxDistM / リング上限 / routing 発火条件の数値変更禁止**(距離分類が動くため)。
- **A* 等で非 admissible heuristic・早期打ち切り禁止**(過小距離=課金過小)。
- **業務距離 vs trip 距離の完全分離維持**(memory 既出)。

**この 1 つの方針で進行可:「メモリ県別 LRU 化(クラッシュ阻止)→ snap decode 重複排除(ピーク tick 半減)→ replay yield + display 適応間引き(thread starve/発熱解消)」を、distance_m bit 不変・実走 trace 検証ゲート付きで実装。Dijkstra/Kalman は保留。**

---

関連ファイル(全て絶対パス):
- `C:\Users\zeroa\Daikou-app-test\js\pipeline-distance.js`(SnapCache / RoadGraphRouter / createDistanceTracker)
- `C:\Users\zeroa\Daikou-app-test\js\roads-decoder.js`(this.data/this.bytes 二重保持 L159-185, getRoadsNear L236-258, decodeRoadAt L125-156)
- `C:\Users\zeroa\Daikou-app-test\js\map-matcher.js`(decoders Map L153, 新エンジン ingest L3232, _MCM_LAT_THRESHOLD_MS L90)

---

## ★実装後 実測による方針改訂 (2026-05-30)★

実装後に `tests/bench-oldphone-decode-dedup.js`(実走 seg1 1582点・median of 7)で実測した結果、上記方針の **③④を撤回**した。**①②⑤のみ採択**。全変更とも distance_m=9675.91m / fare=3400円 / replay 9676.69m は **bit 完全一致**(課金距離 1mm も不変)。

### 撤回した項目
- **③ snap/routing decode 重複排除(本書で「性能の本丸」とした項目)→ 撤回。** 実測 **0.91x(10% 遅い)**。真因: routing は既に `_graphCache`(署名キーのグラフキャッシュ)を持ち、`getRoadsNear` は**キャッシュミス時=全点の約5%(89/1582点=routed)しか呼ばれない**。dedup の decode 節約 < cell 収集(`_collectFromCells`/`_coverSignature`)の追加オーバーヘッド。本書 §(1) は「snap decode が最重量(時間の96%)」を正しく測ったが、**それを潰す効果**を実測せずに「本丸」と断じたのが誤り。
- **④ replay yield(`computeDistanceAsync`)→ 撤回。** 本番に **batch replay 経路が存在しない**(live は `createDistanceTracker.ingest` 逐次のみ・セッション復元は `meter.setDistance(=v)` で値を直接戻し再計算しない)。yield する対象が本番に無い = 純粋な dead code だった。

### 採択した項目(①②⑤)
- **① decoder 県別 LRU(`map-matcher.js`・上限4県)→ 採択(メモリ最優先)。** eviction で bytes/grid/offsetTable を null 化。OOM 阻止。
- **② `this.data` 二重保持解消(`roads-decoder.js`)→ 採択(メモリ)。** 必要 field 個別コピー後 roadsB64 参照解放。decode 結果不変。
- **⑤ display 適応間引き(`index.html`)→ 採択(描画コスト)。** 定速時 4Hz・GPS ingest/距離/calcFare は不可侵で表示読み出し層のみ。

### 最重要の訂正: **compute は古スマホでもボトルネックでない**
実測 per-point: dev 930µs/点 / **古スマホ推定(4x)3.7ms/点 = 1Hz(1000ms)予算の 0.37%**(`bench-oldphone-decode-dedup.js` で恒久ガード化・予算5ms 超過で FAIL)。Worker B 上で 1Hz 実行のため、compute がメーターのカクつき要因になることはない。**メーターの滑らかさは display 予測補間(α-β + 10m 先取り・既存)で出ており、機種速度に依存しない。** 古スマホの真の致命リスクはあくまで **メモリ(OOM)**=①②で対処。③のような「計算を速くする」最適化は不要(やっても予算の誤差以下、かつ複雑化・逆効果)。
- `C:\Users\zeroa\Daikou-app-test\js\mm-data-pipeline.js`(_backgroundLoadAll L463-510, _priorityLoadCurrentPref L518)