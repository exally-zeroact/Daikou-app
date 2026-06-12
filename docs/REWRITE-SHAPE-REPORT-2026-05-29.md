I now have enough verified ground truth. The audits are directionally right about the structural mess (5-path distance, business_active asymmetry, ZUPT non-determinism, incomplete migrations) but audit #7's "MM is wholly dead / GPS never reaches Worker B" is factually wrong — `type:'gps'` is sent and handled. I'll honestly flag that correction in the report rather than propagate it.

I have enough to write the final report. I won't read further (the audits already provide line-level detail and I've verified the load-bearing claims).

---

# 距離パイプライン白紙再実装 最終報告書 — 主任建築家 統合

報告対象: 司さん / 作成: 主任建築家 / 日付: 2026-05-29
原資料: 7監査（meter.js / gps-worker.js / map-matcher.js / gps.js / roads-decoder.js+pipeline / business.js+index.html / 配線統合）
症状の物差し: 実走 9,276m → 自前道路 snap 9,436m(+160m) → ダイコメ計上 8,540m(−736m/−7.9%)

注意: 本報告は実装前の最終設計確認。GO で white-paper 実装に着手。段階導入はしない（最高精度を一気に1 commit）。

---

## 0. 監査の誤りを1点だけ先に訂正（捏造防止のため）

統合監査（7番目）は「GPS→map-matcher への postMessage が実装されていない／MM 層が丸ごと dead」を最重要根因に挙げたが、**これは事実誤認**。実コードを検証した結果:

- meter.js L1383 `_updateMapMatching()` は毎 GPS step `mmWorker.postMessage({ type:'gps', lat,lng,timestamp,accuracy,speedKmh,headingDeg,altitude,isStationary })` を送信している（確認済）。
- map-matcher.js L2813 `if (msg.type === 'gps')` ハンドラが受信側に存在する（確認済）。
- 監査は `type:'position'` / `type:'init'` を grep して空振りし、`type:'gps'` を見落とした。

→ **MM 層は生きている**。距離過少の真因は「MM が動いていない」ではなく、監査群が一致して指摘する**「distance_m と business_distance_m の非対称 gate 構造 + ZUPT skip 非対称 + gap clamp 非対称 + 県データ遅延 fallback の複合」**である。この訂正は白紙設計の方向を左右するため最優先で記す。

---

## 1. 監査で判明した「思い込みと違った事」

### 1-A. 繋がっていなかった所（wiring breaks・裏取り済を太字）
- **business_distance_m は distance_m と別 gate（business_active vs running）でガードされ、5経路（mm/retro/gap/offroad/none）のうち並記漏れがあった**（meter.js L487/L549/L961/L979、L566 で 2026-05-28 に mm/retro/gap の ZUPT 並記漏れを後追い補追した痕跡を確認）。同一ソース mmIncrementM から distance_m と business_distance_m が異なる magnitude で蓄積する構造的原因。
- 県データ遅延ギャップ: `warmup()` は Phase A（全国共通）のみで resolve し、47県 roads は background fire-and-forget（pipeline）。隣県跨ぎで未ロード県は `_snapAcrossPrefs` が skip → `calcRoadDistance` が **異道路間を haversine 直線で返す**（onSameRoad:false）。ルーティング経由でなく直線で累積 → 距離乖離。
- `isMmReady()` が `_workerLoadedPrefs.size > 0`、つまり**最初の1県でも true**。残り46県 decode 中に snap 開始 → 不完全データで miss 多発（meter L348 / pipeline 連携）。
- Off-Road grace period(5s) は `start()` のみ設定・`reset()` で 0化 → **3 trip目以降 grace 不在**で 200m retroactive jump リスク（meter L900/L1024）。
- `lastMmUsefulAt` が drain/normal/warmup/reset の **4経路で非対称更新**。drain 中は距離 skip しつつ lastMmUsefulAt は更新 →「MM 健全に見えるのに distance_m 伸びない幽霊状態」（meter L519）。
- gps.js: 間引き(700ms)early return 時に **accelBuffer/gyroBuffer が drain されない**（gps.js L512-517）。最大200件の古い加速度が次回 Worker 送信に混入 → worker 側 accel variance を汚染 → 静止 false negative。
- gps-worker: `checkPositionStationary` 初回 `_posStillStart=null` で false 返し→ **1フレーム遅延**。accel 不能端末(iOS)で fallback 経路も遅延し creep。
- index.html: `Meter.state.running` 直接参照（L5948/L6042）は IIFE プライベートで **常に undefined → MM stats バッジ永久非表示**。

### 1-B. 思ったより複雑だった所（hidden complexity）
- distance_m が 5経路に分散し各経路で distanceSource が別値。同一フレーム複数発火で「最後の勝ち」が実装になる。
- tier2_pending_m / business_tier2_pending_m の 2 並行 preview が同じ tentative 値を異なる gate・異なる演算順で受け取り、順序依存で値が変わる。
- ZUPT buffer `_zuptHistory` が単一 shared state。mm/retro/gap/offroad で個別に呼ぶため callback 順序に implicit dependency。
- Kalman: ZUPT_Q(0.01) + Sage-Husa adaptive R + コンパス融合の 4層 filter 相互作用。ZUPT で K≈0 になり「GPS を smooth せず無視」する反直感挙動。Sage-Husa innovBuffer は**タイムスタンプ無し**で古いサンプルが R̂ を bias。
- map-matcher: boost/penalty 7種が「log加算」宣言に反し**各独立乗算**。emission 比率が候補間で30倍超 → Viterbi N=10 で多様性崩壊 → 1-2候補固着 → error correction 喪失 → 偏った（短い）候補選定。
- elapsed: `stop()` は確定加算、`resume()` は時刻設定のみ → 二重計上 / start() の 0化で待機経過喪失。

### 1-C. 死にコード（確定リストは §4）
- meter.js: `resume()` / `isMmReady()` / `setSurchargeActive()` / `setVehicleType` / `getVehicleType` = 37 公開APIのうち 5個が呼ばれていない（business.js/index.html から CALL 0）。`checkStationary()`、HYBRID_*定数、DISP_*定数（α-β削除後も残置）、RegionLoader 参照残骸。
- gps-worker: `checkStationary()`、`_calcAccelLayerHint()`(60行)、`_prevAccuracy`、cellular hint コメント。
- map-matcher: HYBRID_*、`_buildShortcutIndex`(CH 最適化が graphData にデータ無く dead)、A*ヒューリスティック未配線。

---

## 2. 確定した「絶対保つ繋ぎ目」(= 真の契約)

監査の consumers_need を裏取りした結果、白紙後も**バイト単位で互換維持必須**な外部契約:

### 2-A. Meter 公開 API（消費者が実際に呼ぶ・死コード除外後の実 contract）
- `Meter.getState()` が返す field（business.js / index.html / firebase が読む）:
  `distance_m`（課金根拠・trip単位・不可侵）, `fare_yen`, `business_distance_m`（業務累積）, `business_display_distance_m`（表示平滑）, `business_tier2_pending_m`, `display_distance_m`, `tier2_pending_m`, `last_gps`, `running`, `elapsed_sec`
- `Meter.calcFare(distance_m)` — 料金計算（★不可侵）
- `Meter.update(g)` / `updateGpsOnly(g)` — GPS 更新・距離加算入口
- `Meter.start / stop / reset / businessEnd / resume`
- `Meter.getFareConfig / setFareConfig`, `getMMStats()`, `getActiveSurcharges / toggleSurcharge / getSurchargeMultiplier`
- `Meter.setBusinessDistance / setBusinessActive`, `setMapMatcher(worker)`, `setRoadType`
- `Meter.setVehicleType / getVehicleType`（現在 UI 未配線だが「車種選択 UI」は白紙で実装すべき＝死コードだが契約は残す）

### 2-B. Worker B (map-matcher) プロトコル — main→worker
送信(実装確認済): `{type:'gps', lat,lng,timestamp,accuracy,speedKmh,headingDeg,altitude,isStationary}`、`{type:'reset'|'softReset'|'resetCommittedSnap'|'configPlatform'|'configDebug'|'loadRoads'|'setRoadType'}`
受信: `mmResult{ mmIncrementM, tentativeIncrementM, isStationary, snap, snapped, committed, mcmN }`、`roadsLoaded`、`mmStats`

### 2-C. データ層
- `GPS.calcDistance(...)` = Vincenty/haversine の single source（meter から検証不可・隔離維持）
- roads-decoder `calcRoadDistance` / decoders Map / `_snapAcrossPrefs` / mm-data-pipeline の 47県ロード
- business.js `Business.onGps`（毎フレーム getState().business_distance_m を mirror sync）/ `Business.getReport`（business_distance_m 直結）
- firebase logging（distance_m / mmStats）

### 2-D. 当初想定とのズレ（明記）
1. 「MM が動いていない」想定 → **誤**。MM は配線済（§0）。
2. 「business_distance_m は distance_m の subset」想定 → **誤**。現状は独立計算（2026-05-19 で完全分離宣言、L549）。白紙では subset へ再統一する（§3）。
3. 「display は1モデル」想定（MEMORY: DISPLAY-REARCH）→ 実コードは gps_predictive / display_distance_m / business_display の 3経路残置。α-β削除宣言後も DISP_*定数残存。

---

## 3. ★白紙実装の具体的な形★

### 3-0. 設計原則（不可侵 + MEMORY 準拠）
- distance_m / calcFare / 課金ロジックは**バイト不変の出力契約**。内部は再設計するが getState().distance_m の値は「道路 snap 全加算（タクシー方式）」と一致。
- business_distance_m を**独立計算ではなく distance_m と同一エンジンの「業務区間 view」**に再定義（distance_m の subset）。GPS 直線課金は禁止。
- 表示は1モデル（層1=表示は実装可・層2=課金端末一致は司さん裁定待ち）。複数推定 max / 瞬間 floor 禁止。
- 完全オフライン前提（LINE 通知併用）。

### 3-1. ファイル処遇（白紙 / 再利用 / 不可触）

| ファイル | 処遇 | 理由 |
|---|---|---|
| **js/pipeline.js（新規）** | 白紙・新規作成 | distance state machine の単一 source。meter.js の 5経路・3層 state を吸収。 |
| js/meter.js | 白紙書き直し（API shell は維持） | 公開 37API の signature 互換を保ったまま中身を pipeline.js へ委譲する薄い shell に。 |
| js/gps.js | 白紙書き直し | accelBuffer drain bug・A3 速度の accuracy 汚染・compass stale を構造から排除。 |
| js/gps-worker.js | 白紙書き直し | 静止判定/Kalman/ZUPT/Sage-Husa を unified clock+timestamped buffer に再設計。 |
| **js/map-matcher.js** | **中核再利用（局所改修）** | snap/Viterbi/backbone graph は資産。boost乗算→log加算一本化・iOS/Android N統一・OSRM graceful fallback のみ修正。**白紙にしない**。 |
| js/mm-data-pipeline.js | 改修 | warmup を 47県 ready ack で gate・loadRoads ack ハンドシェーク追加。 |
| js/roads-decoder.js | 再利用（calcRoadDistance 拡張） | 異道路間を直線でなく backbone routing で返す算式へ。 |
| js/business.js | 再利用（mirror sync 経路のみ確認） | onGps / getReport は契約。中身は getState() 読むだけに簡素化。 |
| index.html | 配線修正のみ | Meter.state 直接参照削除→ getState() 経由。Worker init 順序固定。 |
| **calcFare 本体・料金体系** | **不可触** | 絶対ルール。 |

### 3-2. 新モジュール構成と関数境界（pipeline.js）

単一 state machine。distance_m の加算経路を 5→**1本（明示 state machine）**に統合:

```
[GPS層 gps.js] 
  raw geolocation → Kalman(worker) → 受理判定 → 
  out: GpsFix{ lat,lng,timestamp,accuracy,speedKmh,headingDeg,altitude,isStationary }

[受理 pipeline.ingest(fix)]
  責務: gate（accuracy / jump / stationary）一元化。distance_m と business で同一 gate を共有。
  out: AcceptedFix or null（reject 理由付き）

[snap pipeline.snap(fix) → Worker B]
  責務: type:'gps' post（現契約維持）→ mmResult 受信。
  入力 isStationary は ingest と同一値（非対称排除）。
  out: SnapResult{ incrementM, tentativeM, committed, snapType }

[集計 pipeline.accumulate(snapResult)]  ← ★単一 state machine
  states: { MM_COMMIT, MM_PREVIEW, GAP_FILL, OFFROAD, IDLE }
  遷移を明示テーブル化（同一フレーム複数発火を排除・遷移は1回）。
  distance_m += increment は state=MM_COMMIT のときのみ。
  business_distance_m は別変数で持たず、distance_m の業務区間境界 [businessStartDist, now] の差分として導出（= subset）。
  ZUPT は ingest 段で1回だけ適用（4経路重複呼びを廃止・_zuptHistory への順序依存消滅）。
  out: { distance_m, business_distance_m(=derived), tier2_pending_m }

[display pipeline.display()]
  責務: 1モデルのみ。target = distance_m + tier2_pending_m、Math.max で後退防止。
  business_display も同一式の業務区間 view。gps_predictive / α-β は廃止。

[calcFare]  ← 不可触。pipeline は distance_m を渡すだけ。
```

各段の入出力を type で固定し、gate・ZUPT・stationary を**それぞれ1箇所**に集約 → 監査が指摘した「非対称」「順序依存」「並記漏れ」が構造的に発生しない。

### 3-3. 繋ぎ忘れゼロの配線図（チェックリスト）
1. index.html: `new Worker(map-matcher)` → `addEventListener('message')` → `configPlatform` → `setMapMatcher` の**順序固定**（worker ready 前 ack を排除）。
2. mm-data-pipeline: 47県 `roadsLoaded` ack を Set で集計 → **全47件揃って初めて** `isMmReady()=true`（現「1県で true」を廃止）。GPS 開始を ready まで遅延 or 「未ロード県周辺のみ snap」を明示。
3. GPS → gps.js ingest → Worker B `type:'gps'`（現契約・維持）→ mmResult → pipeline.accumulate（単一）→ getState()。
4. business.onGps は getState() を読むだけ（mirror sync の遅延経路を排除）。
5. roads-decoder calcRoadDistance は隣県跨ぎで backbone routing 経由（直線 fallback は snap miss 連続時のみ・grace で抑制）。

---

## 4. 削除する死にコード / 重複層（確定リスト）
- meter.js: `resume()`, `isMmReady()`(再設計後 ready 判定へ統合), `setSurchargeActive()`, HYBRID_SPEED_KMH/HYBRID_DISCREPANCY定数, DISP_NORMAL_STEP_M/DISP_V_CLAMP_MPS等 α-β残骸, `checkStationary()`, RegionLoader 参照・calcGapFill 内 calcBearingMeter/angleDiffMeter 残骸, gps_predictive_distance_m 経路。
  - `setVehicleType/getVehicleType` は**残す**（車種 UI を新規実装し配線するため）。
- gps-worker.js: `checkStationary()`(25行), `_calcAccelLayerHint()`(60行), `_prevAccuracy`, cellular hint コメント。
- gps.js: `checkStationary()`, cellular tunnel hint, accelLayerHint 計算経路。
- map-matcher.js: HYBRID_*定数, `_buildShortcutIndex`(CH dead), 未配線 A*ヒューリスティック。
- index.html: `Meter.state` 直接参照(L5948/L6042)→ getState() 経由に置換。`cachePutFailed` handler を新規追加（現状 silent fail）。
- debug-config.js: OSRM_ENDPOINT_PRODUCTION の TODO 暫定値を本番 endpoint へ確定 or graceful fallback 実装。

---

## 5. 一気実装の手順（prod backup 前提・test repo で一気・1 commit）

★MEMORY 鉄則: STEP 1 テストツール先行 → STEP 2 実装。実機検証を「直った」宣言の前に必ず。緑≠直った。

1. **prod backup**: Daikou-app（本番）現 HEAD を tag で固定。今回の作業は Daikou-app-test のみ。
2. **STEP 1 テストツール先行**（実装前・必須）:
   - real-trace 9,276m の GPS trace を Firebase debug_traces から取得（curl REST・running=true 区間のみ有効）。
   - e2e real-pipeline gate: 取得 trace を gps.js→worker→pipeline に注入し distance_m を算出するハーネス。物差し = **9,436m(自前 snap 上限) に収束、8,540m から +736m 回復**を PASS 条件に。
   - invariant: distance_m = business_distance_m（subset 同一）, calcFare 出力不変, 停車中 increment=0。
3. **STEP 2 一気実装**（1 commit）: pipeline.js 新規 → meter.js shell 化 → gps.js/gps-worker.js 白紙 → map-matcher 局所改修 → pipeline ready gate → 死コード削除 → 配線図5項目を全結線。
4. CI 全緑を確認（ローカル PASS=CI PASS と決めつけない）。`[skip ci]` は使わない（Vercel deploy も止まるため）。
5. **検証**:
   - 物差し1: 上記 real-trace で 9,436m 物差しに対する誤差を console 出力。
   - 物差し2: 司さんの実機（業務開始ボタン押下後）で1業務 trace を取り、計上距離と実走を照合。歩き回り目視ではなく trace+console 注入で検証。
6. 実機 PASS 後にのみ「根治」宣言。push 後の完了報告は 4-backtick 1ブロックで copy-pasteable に。

---

## 6. リスクと「実装前に潰すべき地雷」

- **地雷1（最優先・捏造回避）**: 「MM dead」誤認に基づく設計をしない。MM は配線済。真因は非対称構造。→ §0 で訂正済。
- **地雷2**: business_distance_m を subset 再定義する際、Business.getReport / onGps の値が変わらないこと。subset 導出値が現 mirror 値と一致するか real-trace で事前照合。
- **地雷3**: 県データ遅延。47県 ready gate を強くしすぎると GPS 開始が遅延し代行開始直後の距離が落ちる。「未ロード県周辺のみ snap + grace」で開始は遅らせない設計に。
- **地雷4**: Off-Road grace を reset() でも設定（3 trip目以降の 200m jump 根絶）。grace 中は off-road 起動を条件分岐で明示 skip（現状コメントのみで実装欠落の疑い・要実コード化）。
- **地雷5**: drain window(500ms) は確率的緩和に過ぎず race を保証しない。reset の ack ハンドシェークで同期保証へ。
- **地雷6**: Kalman ZUPT で K≈0 → GPS 無視 drift。ZUPT は「静止が timestamped accel variance で確証されたとき」のみ。Sage-Husa innovBuffer に timestamp を持たせ stale 排除。
- **地雷7**: map-matcher boost 乗算→log加算一本化で snap 結果 distance が変わる。改修前後で同一 trace の snap 距離を diff し、9,436m 上限が下がらないことを確認。
- **地雷8**: accel variance threshold(0.1) が未検証。実走行 trace の静止区間 variance をログから確定してから calibration（経験値のまま固定しない）。
- **地雷9**: ペア log 単独判断禁止。司さんが前後ペアで送る log の片方だけで独断 push しない。

---

判定: **白紙再実装を推奨**（ただし map-matcher 中核は再利用・MM は dead ではない）。距離過少 −736m の真因は「distance_m と business_distance_m の非対称 gate + ZUPT/gap clamp 非対称 + 県データ遅延の直線 fallback」の複合で、単一 state machine + subset 再定義 + 47県 ready gate で構造的に解消できる。GO を頂ければ STEP 1 テストツール先行 → STEP 2 一気実装（1 commit）に入る。

検証済ファイル（絶対パス）: C:\Users\zeroa\Daikou-app-test\js\meter.js（L1383 type:'gps' post / L480-565 commit gate / L483-509 offroad）、C:\Users\zeroa\Daikou-app-test\js\map-matcher.js（L2371 onmessage / L2813 type:'gps' handler）