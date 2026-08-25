# ai-bug-hunter が出していた物（写し）

★2026-08-25 に ai-bug-hunter を消した★（指示役の裁定）。
消す前に、開いていた issue の中身を ここへ そのまま写した。

- 出していたのは ★週1の issue だけ★・クローズ0・コメント0
- 一番古いのは 2026-05-31＝★12週間 誰も1件も読んでいない★
- ★ただし 中身は空ではない★：距離・課金（distance_m）に関わる指摘が入っている。
  捨てずに ここに残す。読むかどうかは 別の判断。


---

## Daikou-app（15 件）

### #23 [ai-bug-hunter] weekly report 2026-08-16 (10 risks)
（作られた日 2026-08-16 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-08-16

**Model:** claude-sonnet-4-5-20250929

**Summary:** 10件のリスクを検出。最重要は①車別k機構のdormant状態(代行では非作用だがコメント不足)、②source-aware k判定のworker依存(過大課金の穴)、③outSnap欠落時のgreedy snap退避(L2連結性bypass)。中程度リスクは④running状態のworker非伝達(idle加算再発)、⑤加速度null時のcreep、⑥生位置/Kalman位置の混在(不整合)、⑦後方互換キーのorphan疑い。低リスクは⑧pipeline-distance.js読込失敗時の距離停止、⑨LRU eviction時の県跨ぎ過少、⑩calibrateVehicleK呼出の維持確認不足。過去事例との類似点: KI-003(dead code化)が3件、KI-004(idle加算/gap欠落)が4件、KI-001(部分移行不整合)が1件、KI-006(SW cache)が1件。絶対ルール違反の可能性: distance_m加算経路の二重ガード不足、GPS直線距離混入(greedy snap退避)、state.running非伝達。早急な対策が必要なのは②③④(billing-critical)。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L92-L155
  - 車別k機構(_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY)が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では_kForDelta=1.0で非作用(dormant)。KI-003(business.js全関数dead code化)と類似の「呼出されない状態」リスク。_postVehicleK(L92)がworkerへ送るが、代行autoCalibK ON時はmeter層のk乗算は完全bypass。コメントと実装の乖離が将来の誤削除を招く。
  - 推奨対処: 代行/タクシー/cert経路での使用状況を明示的にテストで保護。knip/dependency-cruiserで「条件付き使用」を検出可能にする。コメントに「代行では非作用だがタクシー/certで必須」を明記し、削除禁止マーカーを付ける。
- **[high]** `state-machine` @ meter.js:L355
  - _kForDelta(随伴車k)がsource-aware化で'obd'時のみ適用されるが、pipelineDeltaSrcの判定ロジックがworker側(map-matcher.js:L1455 _lastDeltaSrc)に隠蔽されている。KI-004(idle中business_distance_m増加)と類似の「state.running問わず加算」リスク。workerが誤って'obd'を返すと、代行でもk>1.0が適用され過大課金の穴になる。
  - 推奨対処: pipelineDeltaSrcの判定ロジックをmeter.js側でも二重検証。autoCalibK OFF時は必ず'gps'を強制し、worker応答を信用しない防御コードを追加。Semgrepでsource-aware k適用経路をtaint解析。
- **[high]** `distance-calculation` @ map-matcher.js:L1455-L1520
  - _confirmedRoadDelta(L1 配線)がViterbi確定snap(outSnap)をpipeline ingestに渡すが、outSnap不足時(roadIndex/snapLat/snapLng欠落)は「ingest内部で従来snapに退避」とコメント。この退避経路がgreedy最近傍SnapCache.snapを呼ぶ可能性があり、KI-005(RegionLoader dead code)と類似の「永続的undefined経路」リスク。outSnap欠落が常態化するとL2連結性拘束がbypassされ、別道路flip(余計な弦)が距離に混入する。
  - 推奨対処: outSnap欠落時の退避経路を明示的にテスト。pipeline-distance.jsのingest実装を確認し、greedy snapへのfallbackが本当に安全か検証。outSnap欠落率をメトリクス化し、閾値超過でアラート。
- **[medium]** `billing-guard` @ meter.js:L355-L380
  - state.distance_m += pipelineDeltaMの加算がrunning gateとbilling_frozen gateの二重ガードで保護されているが、pipelineDeltaM自体の算出(worker側)にはrunning状態が伝達されていない。KI-004(idle中business_distance_m増加)の再発リスク。workerが停車中でもdeltaM>0を返すと、meter側gateで遮断されるが、business_distance_mへの加算経路(L380)も同じgateを通るか不明瞭。
  - 推奨対処: workerへのGPS送信時にstate.runningフラグを明示的に送り、worker側でもrunning=false時はdeltaM=0を強制する二重保険を追加。business_distance_m加算経路がrunning gateを通ることをテストで保証。
- **[medium]** `sensor-dropout` @ gps-worker.js:L800-L807
  - 加速度サンプルnull時のGPS単独fallback(checkPositionStationary)が「Fix①新構造」とコメントされているが、iOS権限拒否時に永続的にこの経路に落ちる可能性。KI-004と類似の「GPS jitter累積」リスク。checkPositionStationaryが位置半径のみで判定するため、屋内drift(観測3.1km/h)を静止と誤認できず、creepが計上される。
  - 推奨対処: 加速度null時の診断ログを強化し、権限拒否の永続化を検出。iOS権限拒否時は明示的にユーザーへ警告し、距離計測の信頼性低下を通知。fallback経路の静止判定閾値を厳格化(radius 1m等)。
- **[medium]** `gps-accuracy` @ gps-worker.js:L600-L650
  - bypass化(2026-06-04)で生位置をWorker Bに渡す設計変更が行われたが、Kalman平滑後(filtered)を使う経路(lastPosition更新/checkPositionStationary)と生位置(lat/lng)を使う経路(return値)が混在。KI-001(Unicode corruption)と類似の「部分的移行による不整合」リスク。lastPositionがfilteredで更新されるため、次回のjump判定(lastRawPosition基準)との整合性が不明瞭。
  - 推奨対処: 生位置とKalman平滑位置の使い分けを明示的にドキュメント化。lastPositionとlastRawPositionの更新タイミングを同期させ、jump判定の基準点が一貫することをテストで保証。
- **[medium]** `dead-code` @ meter.js:L200-L250
  - 後方互換キー(tier2_pending_m/business_tier2_pending_m/gps_predictive_distance_m/mm_distance_m等)が「旧5経路廃止で参照値化・0のまま温存・index.htmlが読む」とコメントされているが、index.htmlでの実際の参照状況が不明。KI-003(business.js全関数dead code化)と類似の「orphan状態」リスク。これらのキーがindex.htmlで本当に読まれているか、静的解析で検証されていない可能性。
  - 推奨対処: index.htmlでの後方互換キー参照をgrep/依存解析で確認。未使用なら段階的に削除し、使用中なら明示的にテストで保護。knipで「export済だが呼出0」を検出。
- **[low]** `sw-cache` @ map-matcher.js:L1-L50
  - importScripts('pipeline-distance.js')がtry/catchで包まれ、失敗時はself.PipelineDistance未定義のままになる。KI-006(SW cache破壊)と類似の「古いコード実行」リスク。Service Workerのcache更新漏れでpipeline-distance.jsが404になると、workerは起動するがpipelineDeltaM=0のまま距離が増えない。main側はmmWorker有効と判断し、gap fillも発火しない(dtSec<=60s+mmWorker条件)ため、距離が完全停止する。
  - 推奨対処: pipeline-distance.js読込失敗時に明示的なエラーメッセージをmainへ送信。mainはworker起動成功でもpipelineDeltaM=0が連続する場合、fallback経路(gap fill)を強制発火。SW cache更新の自動化(.github/workflows/auto-version.yml)を確認。
- **[low]** `distance-calculation` @ map-matcher.js:L400-L450
  - LRU eviction(_evictDecoderLRU)でRoadDecoderのbytes/grid/offsetTableをnull化してGC解放するが、対応するpipeline trackerも破棄される。県跨ぎ時の再load後、trackerが初回ingestでdeltaM=0('first')を返すため、跨ぎ直後の1 GPS stepで距離が増えない。KI-004と類似の「gap扱いでの距離欠落」リスク。頻繁な県跨ぎ(4県超)で累積過少になる可能性。
  - 推奨対処: 県跨ぎ時のtracker再生成を明示的にログ出力し、'first' deltaM=0の発生頻度を監視。DECODER_LRU_CAP=4を実機走行パターン(最大連続県数)に基づいて調整。tracker再生成時に前県の最終snapを引き継ぐ機構を検討。
- **[low]** `state-machine` @ meter.js:L1495
  - calibrateVehicleK(認定据付測定K)がexportされているが、呼出側(index.html精算画面)での使用状況が不明。KI-003と類似の「外部API経路の維持確認不足」リスク。精算画面リファクタリング時にcalibrateVehicleK呼出が削除されると、k学習機構が完全dead codeになり、タクシー認定運用が機能停止する。
  - 推奨対処: calibrateVehicleK呼出をindex.htmlでgrep確認。tests/business.test.js等で外部API経路を保護するテストを追加。knipで未使用export検出時、タクシー認定経路の必須APIとして除外リストに明記。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-08-16T15:13:56.113Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L92-L155",
      "description": "車別k機構(_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY)が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では_kForDelta=1.0で非作用(dormant)。KI-003(business.js全関数dead code化)と類似の「呼出されない状態」リスク。_postVehicleK(L92)がworkerへ送るが、代行autoCalibK ON時はmeter層のk乗算は完全bypass。コメントと実装の乖離が将来の誤削除を招く。",
      "recommendation": "代行/タクシー/cert経路での使用状況を明示的にテストで保護。knip/dependency-cruiserで「条件付き使用」を検出可能にする。コメントに「代行では非作用だがタクシー/certで必須」を明記し、削除禁止マーカーを付ける。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L355",
      "description": "_kForDelta(随伴車k)がsource-aware化で'obd'時のみ適用されるが、pipelineDeltaSrcの判定ロジックがworker側(map-matcher.js:L1455 _lastDeltaSrc)に隠蔽されている。KI-004(idle中business_distance_m増加)と類似の「state.running問わず加算」リスク。workerが誤って'obd'を返すと、代行でもk>1.0が適用され過大課金の穴になる。",
      "recommendation": "pipelineDeltaSrcの判定ロジックをmeter.js側でも二重検証。autoCalibK OFF時は必ず'gps'を強制し、worker応答を信用しない防御コードを追加。Semgrepでsource-aware k適用経路をtaint解析。"
    },
    {
      "severity": "high",
      "category": "distance-calculation",
      "location": "map-matcher.js:L1455-L1520",
      "description": "_confirmedRoadDelta(L1 配線)がViterbi確定snap(outSnap)をpipeline ingestに渡すが、outSnap不足時(roadIndex/snapLat/snapLng欠落)は「ingest内部で従来snapに退避」とコメント。この退避経路がgreedy最近傍SnapCache.snapを呼ぶ可能性があり、KI-005(RegionLoader dead code)と類似の「永続的undefined経路」リスク。outSnap欠落が常態化するとL2連結性拘束がbypassされ、別道路flip(余計な弦)が距離に混入する。",
      "recommendation": "outSnap欠落時の退避経路を明示的にテスト。pipeline-distance.jsのingest実装を確認し、greedy snapへのfallbackが本当に安全か検証。outSnap欠落率をメトリクス化し、閾値超過でアラート。"
    },
    {
      "severity": "medium",
      "category": "billing-guard",
      "location": "meter.js:L355-L380",
      "description": "state.distance_m += pipelineDeltaMの加算がrunning gateとbilling_frozen gateの二重ガードで保護されているが、pipelineDeltaM自体の算出(worker側)にはrunning状態が伝達されていない。KI-004(idle中business_distance_m増加)の再発リスク。workerが停車中でもdeltaM>0を返すと、meter側gateで遮断されるが、business_distance_mへの加算経路(L380)も同じgateを通るか不明瞭。",
      "recommendation": "workerへのGPS送信時にstate.runningフラグを明示的に送り、worker側でもrunning=false時はdeltaM=0を強制する二重保険を追加。business_distance_m加算経路がrunning gateを通ることをテストで保証。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L800-L807",
      "description": "加速度サンプルnull時のGPS単独fallback(checkPositionStationary)が「Fix①新構造」とコメントされているが、iOS権限拒否時に永続的にこの経路に落ちる可能性。KI-004と類似の「GPS jitter累積」リスク。checkPositionStationaryが位置半径のみで判定するため、屋内drift(観測3.1km/h)を静止と誤認できず、creepが計上される。",
      "recommendation": "加速度null時の診断ログを強化し、権限拒否の永続化を検出。iOS権限拒否時は明示的にユーザーへ警告し、距離計測の信頼性低下を通知。fallback経路の静止判定閾値を厳格化(radius 1m等)。"
    },
    {
      "severity": "medium",
      "category": "gps-accuracy",
      "location": "gps-worker.js:L600-L650",
      "description": "bypass化(2026-06-04)で生位置をWorker Bに渡す設計変更が行われたが、Kalman平滑後(filtered)を使う経路(lastPosition更新/checkPositionStationary)と生位置(lat/lng)を使う経路(return値)が混在。KI-001(Unicode corruption)と類似の「部分的移行による不整合」リスク。lastPositionがfilteredで更新されるため、次回のjump判定(lastRawPosition基準)との整合性が不明瞭。",
      "recommendation": "生位置とKalman平滑位置の使い分けを明示的にドキュメント化。lastPositionとlastRawPositionの更新タイミングを同期させ、jump判定の基準点が一貫することをテストで保証。"
    },
    {
      "severity": "medium",
      "category": "dead-code",
      "location": "meter.js:L200-L250",
      "description": "後方互換キー(tier2_pending_m/business_tier2_pending_m/gps_predictive_distance_m/mm_distance_m等)が「旧5経路廃止で参照値化・0のまま温存・index.htmlが読む」とコメントされているが、index.htmlでの実際の参照状況が不明。KI-003(business.js全関数dead code化)と類似の「orphan状態」リスク。これらのキーがindex.htmlで本当に読まれているか、静的解析で検証されていない可能性。",
      "recommendation": "index.htmlでの後方互換キー参照をgrep/依存解析で確認。未使用なら段階的に削除し、使用中なら明示的にテストで保護。knipで「export済だが呼出0」を検出。"
    },
    {
      "severity": "low",
      "category": "sw-cache",
      "location": "map-matcher.js:L1-L50",
      "description": "importScripts('pipeline-distance.js')がtry/catchで包まれ、失敗時はself.PipelineDistance未定義のままになる。KI-006(SW cache破壊)と類似の「古いコード実行」リスク。Service Workerのcache更新漏れでpipeline-distance.jsが404になると、workerは起動するがpipelineDeltaM=0のまま距離が増えない。main側はmmWorker有効と判断し、gap fillも発火しない(dtSec<=60s+mmWorker条件)ため、距離が完全停止する。",
      "recommendation": "pipeline-distance.js読込失敗時に明示的なエラーメッセージをmainへ送信。mainはworker起動成功でもpipelineDeltaM=0が連続する場合、fallback経路(gap fill)を強制発火。SW cache更新の自動化(.github/workflows/auto-version.yml)を確認。"
    },
    {
      "severity": "low",
      "category": "distance-calculation",
      "location": "map-matcher.js:L400-L450",
      "description": "LRU eviction(_evictDecoderLRU)でRoadDecoderのbytes/grid/offsetTableをnull化してGC解放するが、対応するpipeline trackerも破棄される。県跨ぎ時の再load後、trackerが初回ingestでdeltaM=0('first')を返すため、跨ぎ直後の1 GPS stepで距離が増えない。KI-004と類似の「gap扱いでの距離欠落」リスク。頻繁な県跨ぎ(4県超)で累積過少になる可能性。",
      "recommendation": "県跨ぎ時のtracker再生成を明示的にログ出力し、'first' deltaM=0の発生頻度を監視。DECODER_LRU_CAP=4を実機走行パターン(最大連続県数)に基づいて調整。tracker再生成時に前県の最終snapを引き継ぐ機構を検討。"
    },
    {
      "severity": "low",
      "category": "state-machine",
      "location": "meter.js:L1495",
      "description": "calibrateVehicleK(認定据付測定K)がexportされているが、呼出側(index.html精算画面)での使用状況が不明。KI-003と類似の「外部API経路の維持確認不足」リスク。精算画面リファクタリング時にcalibrateVehicleK呼出が削除されると、k学習機構が完全dead codeになり、タクシー認定運用が機能停止する。",
      "recommendation": "calibrateVehicleK呼出をindex.htmlでgrep確認。tests/business.test.js等で外部API経路を保護するテストを追加。knipで未使用export検出時、タクシー認定経路の必須APIとして除外リストに明記。"
    }
  ],
  "summary": "10件のリスクを検出。最重要は①車別k機構のdormant状態(代行では非作用だがコメント不足)、②source-aware k判定のworker依存(過大課金の穴)、③outSnap欠落時のgreedy snap退避(L2連結性bypass)。中程度リスクは④running状態のworker非伝達(idle加算再発)、⑤加速度null時のcreep、⑥生位置/Kalman位置の混在(不整合)、⑦後方互換キーのorphan疑い。低リスクは⑧pipeline-distance.js読込失敗時の距離停止、⑨LRU eviction時の県跨ぎ過少、⑩calibrateVehicleK呼出の維持確認不足。過去事例との類似点: KI-003(dead code化)が3件、KI-004(idle加算/gap欠落)が4件、KI-001(部分移行不整合)が1件、KI-006(SW cache)が1件。絶対ルール違反の可能性: distance_m加算経路の二重ガード不足、GPS直線距離混入(greedy snap退避)、state.running非伝達。早急な対策が必要なのは②③④(billing-critical)。"
}
```
</details>

### #22 [ai-bug-hunter] weekly report 2026-08-09 (0 risks)
（作られた日 2026-08-09 ／ 指摘 0 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-08-09

**Model:** claude-sonnet-4-5-20250929

**Summary:** JSON parse error: Unterminated string in JSON at position 7691

### Detected Risks

No risks detected (or execution failed).

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-08-09T15:23:37.950Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [],
  "summary": "JSON parse error: Unterminated string in JSON at position 7691",
  "_raw": "```json\n{\n  \"risks\": [\n    {\n      \"severity\": \"high\",\n      \"category\": \"dead-code\",\n      \"location\": \"meter.js:L92-L155\",\n      \"description\": \"車別k機構(_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY)が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では_kForDelta=1.0で非作用(dormant)。KI-003(business.js全関数dead code化)と類似: リファクタリング時に呼出側削除→関数定義だけ残存→orphan化のリスク。_postVehicleK(L92)がpipeline側obdVehicleKへ送る経路は生きているが、meter層の距離乗算×_activeVehicleKは代行では完全bypass。calibrateVehicleK(L1495 export)も精算時cert較正でのみ呼ばれる想定だが、代行autoCalibK ON時は別経路(worker側学習K)が支配し、この関数が実際に呼ばれるか不明。knip/dependency-cruiserでorphan検出されていない可能性。\",\n      \"recommendation\": \"audit:knipで_activeVehicleK/_resolveVK/_factoryK/calibrateVehicleKの呼出経路を検証。代行経路で実際に使われていないなら「タクシー専用」と明示し、テストでcert経路の生存を保証。削除する場合は司さん明示指示後、分割commitで実機確認(KI-002絶対ルール準拠)。\"\n    },\n    {\n      \"severity\": \"high\",\n      \"category\": \"billing-guard\",\n      \"location\": \"meter.js:L355(推定・_kForDelta適用箇所)\",\n      \"description\": \"コメントL355「_kForDelta・source"
}
```
</details>

### #21 [ai-bug-hunter] weekly report 2026-08-02 (10 risks)
（作られた日 2026-08-02 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-08-02

**Model:** claude-sonnet-4-5-20250929

**Summary:** 10 件のリスクを検出。高 severity 3 件: (1) 車別k機構の dormant 状態 orphan 化 (KI-003 類似)、(2) billing_frozen ガード漏れ (KI-004 類似)、(3) decoder 未ロード時の過少課金 (KI-005 類似)。中 severity 4 件: (4) smoothedRawMode 時の freeze 無効化、(5) 後方互換キーの orphan 化、(6) 加速度判定不能時の GPS drift 計上、(7) Worker B の cache 戦略不明 (SW-CACHE-001 類似)。低 severity 3 件: (8) accuracy 緩和による低精度点混入、(9) dead code 削除の検証不足 (KI-002 類似)、(10) gap routing の detour ratio 閾値が緩すぎる。全体的に「新距離エンジン (pipeline-distance) の並列経路」と「条件分岐で到達しない dormant コード」に過去事例と類似のリスクが集中。特に billing_frozen / isStationary freeze のガード漏れは「確定後も距離が増える」過大請求の直接原因となる可能性が高く、最優先で実機検証が必要。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L92-L155
  - 車別k機構 (_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY) が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では _kForDelta=1.0 で非作用 (dormant) 状態。KI-003 (business.js 全関数 dead code 化) と類似: 「呼出されない状態」ではなく「条件分岐で永遠に到達しない状態」で orphan 化している可能性。autoCalibK ON 時は meter 層の k は完全に非作用だが、コードは削除されず残存。
  - 推奨対処: audit:knip で未使用 export を検証。代行経路 (autoCalibK ON) とタクシー経路 (autoCalibK OFF) の両方で実機テストを実施し、_activeVehicleK/_resolveVK が実際に呼ばれているか dlog で確認。dormant 状態のコードは「将来削除予定」を明示するか、テストで生存を証明すること。
- **[high]** `state-machine` @ meter.js:L355-L380 + map-matcher.js:L2890-L2920
  - billing_frozen フラグ (確定後の課金距離凍結) が meter.js に追加されているが、map-matcher.js の pipelineDeltaM 算出経路 (_confirmedRoadDelta) には billing_frozen のガードが存在しない。KI-004 (idle 中 business_distance_m 増加) と類似: 「state.running ガードを全経路に適用」したはずが、新エンジン (pipeline-distance) の並列経路に漏れている可能性。確定後も Worker B が pipelineDeltaM > 0 を返し続けると、meter.js の running gate 内で distance_m が増加する。
  - 推奨対処: map-matcher.js の _confirmedRoadDelta 内で msg.billing_frozen をチェックし、frozen=true 時は deltaM=0 を返すガードを追加。または meter.js の running gate 内に billing_frozen チェックを追加 (if (state.running && !state.billing_frozen))。tests/property/distance-m-update-paths.test.js に billing_frozen 時の distance_m 不変を検証するテストを追加。
- **[high]** `distance-calculation` @ map-matcher.js:L2890-L2920 (_confirmedRoadDelta)
  - 新距離エンジン (pipeline-distance) の ingest 失敗時に deltaM=0 を返すが、失敗理由が「道路データ未ロード」「decoder 未ロード」「例外」のいずれかが不明。KI-005 (RegionLoader 永続的 undefined) と類似: 「typeof undefined ガードで safe」だが永続的に false 評価で dead code 化している可能性。県跨ぎ時に decoder が LRU eviction されると、再ロードまでの間 deltaM=0 が連続し、実際の走行距離が計上されない (過少課金)。
  - 推奨対処: _confirmedRoadDelta の try/catch 内で失敗理由を dlog 出力 (decoder 未ロード / ingest 例外 / tracker 未生成)。県跨ぎ時の decoder 再ロード完了までの gap を meter.js の gap fill (速度×時間) で補完する経路を確認。tests/property/distance-m-update-paths.test.js に「decoder 未ロード時の fallback」テストを追加。
- **[medium]** `billing-guard` @ map-matcher.js:L2950-L2970
  - isStationary freeze 時に pipelineDeltaM を 0 化する処理が「smoothedRawMode 補正」で条件分岐している (_pdSmoothed() が false の時のみ 0 化)。KI-004 (idle 中 business_distance_m 増加) と類似: 「全経路に running ガード適用」したはずが、smoothedRawMode=true 時は freeze が効かず、停車中も pipelineDeltaM > 0 が返る可能性。コメントでは「エンジン側 ZUPT+cap が担保」とあるが、二重保険の片方が条件付きで無効化されている。
  - 推奨対処: smoothedRawMode=true 時の停車中 distance_m 増加を実機テストで検証。pipeline-distance.js の ZUPT (Zero Velocity Update) が確実に deltaM=0 を返すことを tests/property/distance-m-update-paths.test.js で確認。または map-matcher.js の freeze を無条件化し、エンジン側 ZUPT との二重保険を維持。
- **[medium]** `dead-code` @ meter.js:L1200-L1300 (後方互換キー)
  - tier2_pending_m / business_tier2_pending_m / gps_predictive_distance_m / offroad_distance_m / offroad_count / gap_fill_count / gap_fill_total_m が「旧 5 経路廃止で参照値化・0 のまま温存」とコメントされているが、index.html / business.js が実際に読んでいるか不明。KI-003 (business.js 全関数 dead code 化) と類似: 「呼出側を削除し定義だけが残された orphan」状態の可能性。これらのキーが index.html で参照されていない場合、getState の返却オブジェクトに無駄なプロパティが残存。
  - 推奨対処: index.html / business.js で tier2_pending_m 等の後方互換キーが実際に参照されているか grep で確認。参照が 0 件なら削除し、getState の返却オブジェクトを軽量化。参照がある場合は「後方互換のため残置」を明示し、将来削除予定を記載。
- **[medium]** `sensor-dropout` @ gps-worker.js:L800-L850 (accel 判定不能時の fallback)
  - 加速度サンプル null 時の GPS 単独 fallback (checkPositionStationary) が実装されているが、iOS Safari で permission 拒否された場合の挙動が不明。KI-004 と SENS-DROP-001 の複合: 「加速度判定不能で GPS jitter 通過」により、停車中なのに distance_m が増える可能性。checkPositionStationary が _posStillStart (位置半径 anchor) を使うが、この anchor が GPS drift で移動すると、真の静止でも isStationary=false になる。
  - 推奨対処: iOS Safari で加速度 permission 拒否時の実機テストを実施。checkPositionStationary の _posStillStart が GPS drift で移動しないよう、anchor 更新条件を厳格化 (例: accuracy < 10m かつ速度 < 1 km/h の時のみ更新)。または加速度判定不能時は「安全側=静止扱い」にし、GPS jitter を計上しない。
- **[medium]** `sw-cache` @ map-matcher.js:L1-L50 (importScripts)
  - pipeline-distance.js / k-calib.js を importScripts で動的ロードしているが、Service Worker の cache 戦略が不明。SW-CACHE-001 と類似: 「CACHE_NAME を更新しないと古い code が実行され続ける」リスク。pipeline-distance.js が更新されても Worker B が古い version を cache から読み込むと、距離計算ロジックが旧版のまま動作し、修正したはずのバグが再現する。
  - 推奨対処: sw.js の PRECACHE_FILES に pipeline-distance.js / k-calib.js が含まれているか確認。.github/workflows/auto-version.yml で commit SHA ベースの CACHE_NAME 更新が Worker B の importScripts にも適用されているか検証。tests/e2e/flow-standard.spec.js に「Worker B が最新 version を読み込んでいるか」のチェックを追加。
- **[low]** `gps-accuracy` @ gps-worker.js:L600-L650 (accuracy 天井の動的緩和)
  - 移動時の accuracy 上限を accuracy_moving_extreme_m (35m) に緩和しているが、この緩和条件が「直前 frame 非静止」または「生 GPS 変位継続性」の OR 条件。GPS-ACC-001 と類似: 「GPS 精度劣化時の距離計算ロジック混入」により、accuracy 35m の低精度点が distance_m に加算される可能性。Worker B の Viterbi snap が外れ値を吸収する前提だが、連続して低精度点が来ると snap miss が連鎖し、GPS 直線距離が混入する。
  - 推奨対処: accuracy 35m の点が連続した場合の Worker B の挙動を実機テストで検証。Viterbi の emission scoring で accuracy > 20m の点に十分なペナルティが適用されているか確認。または accuracy 緩和を 20m → 25m 程度に抑え、35m は「真に使い物にならない極端値」の硬棄却のみに使用。
- **[low]** `mass-deletion` @ map-matcher.js:L500-L600 (P4/P5 廃止コメント)
  - cellular tunnel hint / accelLayerHint が「2026-05-09 (P4/P5 廃止)」とコメントされ、関連コードが削除されているが、削除 commit が個別に記録されていない。KI-002 (mass deletion) と類似: 「dead code 削除を自律判断で実行」し、実際には機能している経路を削除してしまった可能性。コメントでは「layer (v6 attribute) で代替済」とあるが、代替実装が正しく動作しているか検証されていない。
  - 推奨対処: cellular tunnel hint / accelLayerHint の削除 commit を git log で特定し、削除前後の実機テスト結果を比較。layer (v6 attribute) + tunnels-/bridges-{pref}.js データで tunnel/bridge 判定が正しく動作しているか tests/property/distance-m-update-paths.test.js で検証。削除したコードが「本当に dead」だったか、業務 flow に影響がないか確認。
- **[low]** `distance-calculation` @ map-matcher.js:L2700-L2800 (gap routing の detour ratio guard)
  - gap routing の誤 snap 過大ガードとして GAP_MAX_DETOUR_RATIO (3.0) を使用しているが、この閾値が経験的な値で、理論的根拠が不明。DIST-CALC-001 と類似: 「GPS 直線距離が道路ジオメトリ距離の代わりに混入」するリスク。detour ratio 3.0 は「道路距離 / 直線距離 <= 3.0」を許容するが、実際の道路網では detour ratio 2.0 を超えるケースは稀 (高速道路の大回り等)。3.0 は緩すぎて、誤 snap による遠回り経路を通過させる可能性。
  - 推奨対処: 実機データで gap routing の detour ratio 分布を分析し、適切な閾値を決定 (例: p95 = 2.0 → 閾値 2.5)。detour ratio > 3.0 の事例を dlog で収集し、誤 snap か正当な大回りかを判別。tests/property/distance-m-update-paths.test.js に「detour ratio guard が過大課金を防いでいるか」のテストを追加。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-08-02T15:59:27.681Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L92-L155",
      "description": "車別k機構 (_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY) が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では _kForDelta=1.0 で非作用 (dormant) 状態。KI-003 (business.js 全関数 dead code 化) と類似: 「呼出されない状態」ではなく「条件分岐で永遠に到達しない状態」で orphan 化している可能性。autoCalibK ON 時は meter 層の k は完全に非作用だが、コードは削除されず残存。",
      "recommendation": "audit:knip で未使用 export を検証。代行経路 (autoCalibK ON) とタクシー経路 (autoCalibK OFF) の両方で実機テストを実施し、_activeVehicleK/_resolveVK が実際に呼ばれているか dlog で確認。dormant 状態のコードは「将来削除予定」を明示するか、テストで生存を証明すること。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L355-L380 + map-matcher.js:L2890-L2920",
      "description": "billing_frozen フラグ (確定後の課金距離凍結) が meter.js に追加されているが、map-matcher.js の pipelineDeltaM 算出経路 (_confirmedRoadDelta) には billing_frozen のガードが存在しない。KI-004 (idle 中 business_distance_m 増加) と類似: 「state.running ガードを全経路に適用」したはずが、新エンジン (pipeline-distance) の並列経路に漏れている可能性。確定後も Worker B が pipelineDeltaM > 0 を返し続けると、meter.js の running gate 内で distance_m が増加する。",
      "recommendation": "map-matcher.js の _confirmedRoadDelta 内で msg.billing_frozen をチェックし、frozen=true 時は deltaM=0 を返すガードを追加。または meter.js の running gate 内に billing_frozen チェックを追加 (if (state.running && !state.billing_frozen))。tests/property/distance-m-update-paths.test.js に billing_frozen 時の distance_m 不変を検証するテストを追加。"
    },
    {
      "severity": "high",
      "category": "distance-calculation",
      "location": "map-matcher.js:L2890-L2920 (_confirmedRoadDelta)",
      "description": "新距離エンジン (pipeline-distance) の ingest 失敗時に deltaM=0 を返すが、失敗理由が「道路データ未ロード」「decoder 未ロード」「例外」のいずれかが不明。KI-005 (RegionLoader 永続的 undefined) と類似: 「typeof undefined ガードで safe」だが永続的に false 評価で dead code 化している可能性。県跨ぎ時に decoder が LRU eviction されると、再ロードまでの間 deltaM=0 が連続し、実際の走行距離が計上されない (過少課金)。",
      "recommendation": "_confirmedRoadDelta の try/catch 内で失敗理由を dlog 出力 (decoder 未ロード / ingest 例外 / tracker 未生成)。県跨ぎ時の decoder 再ロード完了までの gap を meter.js の gap fill (速度×時間) で補完する経路を確認。tests/property/distance-m-update-paths.test.js に「decoder 未ロード時の fallback」テストを追加。"
    },
    {
      "severity": "medium",
      "category": "billing-guard",
      "location": "map-matcher.js:L2950-L2970",
      "description": "isStationary freeze 時に pipelineDeltaM を 0 化する処理が「smoothedRawMode 補正」で条件分岐している (_pdSmoothed() が false の時のみ 0 化)。KI-004 (idle 中 business_distance_m 増加) と類似: 「全経路に running ガード適用」したはずが、smoothedRawMode=true 時は freeze が効かず、停車中も pipelineDeltaM > 0 が返る可能性。コメントでは「エンジン側 ZUPT+cap が担保」とあるが、二重保険の片方が条件付きで無効化されている。",
      "recommendation": "smoothedRawMode=true 時の停車中 distance_m 増加を実機テストで検証。pipeline-distance.js の ZUPT (Zero Velocity Update) が確実に deltaM=0 を返すことを tests/property/distance-m-update-paths.test.js で確認。または map-matcher.js の freeze を無条件化し、エンジン側 ZUPT との二重保険を維持。"
    },
    {
      "severity": "medium",
      "category": "dead-code",
      "location": "meter.js:L1200-L1300 (後方互換キー)",
      "description": "tier2_pending_m / business_tier2_pending_m / gps_predictive_distance_m / offroad_distance_m / offroad_count / gap_fill_count / gap_fill_total_m が「旧 5 経路廃止で参照値化・0 のまま温存」とコメントされているが、index.html / business.js が実際に読んでいるか不明。KI-003 (business.js 全関数 dead code 化) と類似: 「呼出側を削除し定義だけが残された orphan」状態の可能性。これらのキーが index.html で参照されていない場合、getState の返却オブジェクトに無駄なプロパティが残存。",
      "recommendation": "index.html / business.js で tier2_pending_m 等の後方互換キーが実際に参照されているか grep で確認。参照が 0 件なら削除し、getState の返却オブジェクトを軽量化。参照がある場合は「後方互換のため残置」を明示し、将来削除予定を記載。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L800-L850 (accel 判定不能時の fallback)",
      "description": "加速度サンプル null 時の GPS 単独 fallback (checkPositionStationary) が実装されているが、iOS Safari で permission 拒否された場合の挙動が不明。KI-004 と SENS-DROP-001 の複合: 「加速度判定不能で GPS jitter 通過」により、停車中なのに distance_m が増える可能性。checkPositionStationary が _posStillStart (位置半径 anchor) を使うが、この anchor が GPS drift で移動すると、真の静止でも isStationary=false になる。",
      "recommendation": "iOS Safari で加速度 permission 拒否時の実機テストを実施。checkPositionStationary の _posStillStart が GPS drift で移動しないよう、anchor 更新条件を厳格化 (例: accuracy < 10m かつ速度 < 1 km/h の時のみ更新)。または加速度判定不能時は「安全側=静止扱い」にし、GPS jitter を計上しない。"
    },
    {
      "severity": "medium",
      "category": "sw-cache",
      "location": "map-matcher.js:L1-L50 (importScripts)",
      "description": "pipeline-distance.js / k-calib.js を importScripts で動的ロードしているが、Service Worker の cache 戦略が不明。SW-CACHE-001 と類似: 「CACHE_NAME を更新しないと古い code が実行され続ける」リスク。pipeline-distance.js が更新されても Worker B が古い version を cache から読み込むと、距離計算ロジックが旧版のまま動作し、修正したはずのバグが再現する。",
      "recommendation": "sw.js の PRECACHE_FILES に pipeline-distance.js / k-calib.js が含まれているか確認。.github/workflows/auto-version.yml で commit SHA ベースの CACHE_NAME 更新が Worker B の importScripts にも適用されているか検証。tests/e2e/flow-standard.spec.js に「Worker B が最新 version を読み込んでいるか」のチェックを追加。"
    },
    {
      "severity": "low",
      "category": "gps-accuracy",
      "location": "gps-worker.js:L600-L650 (accuracy 天井の動的緩和)",
      "description": "移動時の accuracy 上限を accuracy_moving_extreme_m (35m) に緩和しているが、この緩和条件が「直前 frame 非静止」または「生 GPS 変位継続性」の OR 条件。GPS-ACC-001 と類似: 「GPS 精度劣化時の距離計算ロジック混入」により、accuracy 35m の低精度点が distance_m に加算される可能性。Worker B の Viterbi snap が外れ値を吸収する前提だが、連続して低精度点が来ると snap miss が連鎖し、GPS 直線距離が混入する。",
      "recommendation": "accuracy 35m の点が連続した場合の Worker B の挙動を実機テストで検証。Viterbi の emission scoring で accuracy > 20m の点に十分なペナルティが適用されているか確認。または accuracy 緩和を 20m → 25m 程度に抑え、35m は「真に使い物にならない極端値」の硬棄却のみに使用。"
    },
    {
      "severity": "low",
      "category": "mass-deletion",
      "location": "map-matcher.js:L500-L600 (P4/P5 廃止コメント)",
      "description": "cellular tunnel hint / accelLayerHint が「2026-05-09 (P4/P5 廃止)」とコメントされ、関連コードが削除されているが、削除 commit が個別に記録されていない。KI-002 (mass deletion) と類似: 「dead code 削除を自律判断で実行」し、実際には機能している経路を削除してしまった可能性。コメントでは「layer (v6 attribute) で代替済」とあるが、代替実装が正しく動作しているか検証されていない。",
      "recommendation": "cellular tunnel hint / accelLayerHint の削除 commit を git log で特定し、削除前後の実機テスト結果を比較。layer (v6 attribute) + tunnels-/bridges-{pref}.js データで tunnel/bridge 判定が正しく動作しているか tests/property/distance-m-update-paths.test.js で検証。削除したコードが「本当に dead」だったか、業務 flow に影響がないか確認。"
    },
    {
      "severity": "low",
      "category": "distance-calculation",
      "location": "map-matcher.js:L2700-L2800 (gap routing の detour ratio guard)",
      "description": "gap routing の誤 snap 過大ガードとして GAP_MAX_DETOUR_RATIO (3.0) を使用しているが、この閾値が経験的な値で、理論的根拠が不明。DIST-CALC-001 と類似: 「GPS 直線距離が道路ジオメトリ距離の代わりに混入」するリスク。detour ratio 3.0 は「道路距離 / 直線距離 <= 3.0」を許容するが、実際の道路網では detour ratio 2.0 を超えるケースは稀 (高速道路の大回り等)。3.0 は緩すぎて、誤 snap による遠回り経路を通過させる可能性。",
      "recommendation": "実機データで gap routing の detour ratio 分布を分析し、適切な閾値を決定 (例: p95 = 2.0 → 閾値 2.5)。detour ratio > 3.0 の事例を dlog で収集し、誤 snap か正当な大回りかを判別。tests/property/distance-m-update-paths.test.js に「detour ratio guard が過大課金を防いでいるか」のテストを追加。"
    }
  ],
  "summary": "10 件のリスクを検出。高 severity 3 件: (1) 車別k機構の dormant 状態 orphan 化 (KI-003 類似)、(2) billing_frozen ガード漏れ (KI-004 類似)、(3) decoder 未ロード時の過少課金 (KI-005 類似)。中 severity 4 件: (4) smoothedRawMode 時の freeze 無効化、(5) 後方互換キーの orphan 化、(6) 加速度判定不能時の GPS drift 計上、(7) Worker B の cache 戦略不明 (SW-CACHE-001 類似)。低 severity 3 件: (8) accuracy 緩和による低精度点混入、(9) dead code 削除の検証不足 (KI-002 類似)、(10) gap routing の detour ratio 閾値が緩すぎる。全体的に「新距離エンジン (pipeline-distance) の並列経路」と「条件分岐で到達しない dormant コード」に過去事例と類似のリスクが集中。特に billing_frozen / isStationary freeze のガード漏れは「確定後も距離が増える」過大請求の直接原因となる可能性が高く、最優先で実機検証が必要。"
}
```
</details>

### #20 [ai-bug-hunter] weekly report 2026-07-26 (10 risks)
（作られた日 2026-07-26 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-07-26

**Model:** claude-sonnet-4-5-20250929

**Summary:** 白紙書き直し (2026-05-30) による大規模リファクタリングで、KI-002 (mass deletion 576 行) と同規模の変更が実施されているが、旧 5 経路集計ロジックの完全削除と pipelineDeltaM 単一経路への一本化が「後方互換キー温存」「コメント中の旧行番号参照」「既存 mmIncrementM 算出ロジック 1 byte 不変」等の不整合を残している。KI-003 (business.js 全関数 dead code 化) / KI-005 (RegionLoader 永続的 undefined) と類似の「orphan 化リスク」が高い。特に distance_m / business_distance_m の running ガード適用が実際のコードで検証されていない場合、KI-004 (idle 中 business_distance_m 増加) が再発する可能性がある。pipeline-distance.js のロード失敗時の silent failure (距離駆動完全停止) は KI-003 と同じ「業務全体停止」リスクを持つ。実機テスト + npm run test + audit:knip で regression check を最優先で実施すべき。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L1-L1691
  - ★白紙書き直し (2026-05-30) で旧 5 経路集計 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) を全廃し、距離駆動を pipelineDeltaM 単一経路に一本化したが、既存キー (mm_distance_m / offroad_distance_m / gap_fill_total_m 等) を「後方互換キー (= 0 のまま温存)」として残置している。KI-003 (business.js 全関数 dead code 化) と類似のリスク: index.html / business.js が実際にこれらのキーを読んでいるか不明で、orphan 化している可能性がある。
  - 推奨対処: audit:knip で未使用 export を検出し、index.html / business.js の実際の参照箇所を grep で確認する。参照が 0 件なら段階的に削除 (KI-003 の教訓: 削除は呼出側削除と同 commit で実施)。
- **[high]** `state-machine` @ meter.js:L551-L661
  - distance_m 加算経路が「running gate 内の state.distance_m += pipelineDeltaM」の 1 経路のみと主張しているが、コード中に「L551 Tier1 commit / L661 retroactive / L1168 gap fill / L1190 Off-Road incremental / L1691 setDistance」の 5 経路への言及が残っている。実際のコードでは pipelineDeltaM のみが加算されているように見えるが、コメントと実装の不整合がある。KI-004 (idle 中 business_distance_m 増加) と類似: running ガードが本当に全経路に適用されているか不明。
  - 推奨対処: meter.js の実際の distance_m 加算箇所を全て grep し、running ガード適用を確認する。コメント中の「L551/L661/L1168/L1190/L1691」が旧コードへの参照なら削除し、新コードの実際の行番号に更新する。
- **[high]** `billing-guard` @ meter.js:L551-L661 (推定)
  - business_distance_m の加算経路が「business_active gate で加算」と記載されているが、実際のコードが提供されていないため、KI-004 (idle 中 business_distance_m 増加) と同じ「state.running === false でも business_distance_m が更新される」バグが再発している可能性がある。特に pipelineDeltaM を business_distance_m に加算する箇所で running && business_active の二重ガードが必要。
  - 推奨対処: business_distance_m += pipelineDeltaM の実際のコード箇所を確認し、if (state.running && state.business_active) ガードが適用されているか検証する。tests/property/distance-m-update-paths.test.js に business_distance_m の running ガード検証を追加する。
- **[medium]** `distance-calculation` @ map-matcher.js:L157-L200 (_confirmedRoadDelta)
  - pipeline-distance.js の importScripts 失敗時に self.PipelineDistance が undefined のまま残り、_getPipelineTracker が null を返すが、_confirmedRoadDelta は例外を握りつぶして 0 を返すだけ。この場合、距離駆動が完全停止し、meter.js の distance_m が一切増えなくなる。KI-003 (業務単位処理機能停止) と類似の「silent failure」で、運転手が「距離が増えない」ことに気付くまで検出されない。
  - 推奨対処: pipeline-distance.js のロード失敗時に self.postMessage({ type: 'pipelineLoadError', error: _pdErr }) で main に通知し、UI で警告を表示する。既存 Viterbi mmIncrementM 経路へのフォールバックを明示的に実装する。
- **[medium]** `dead-code` @ map-matcher.js:L1-L2000
  - 既存の mmIncrementM / tentativeIncrementM / tentativeDistanceM 算出ロジックが「1 byte 不変」として残置されているが、meter.js が実際にこれらの値を使用しているか不明。白紙書き直しで pipelineDeltaM に一本化したなら、旧経路は dead code 化している可能性がある。KI-005 (RegionLoader 永続的 undefined・Tier 3 dead code 化) と類似: typeof guard で safe だが永続的に false 評価される経路が残存。
  - 推奨対処: meter.js の update 関数で m.mmIncrementM / m.tentativeIncrementM / m.tentativeDistanceM を実際に参照しているか grep で確認する。参照が 0 件なら段階的に削除し、pipelineDeltaM のみに一本化する。
- **[medium]** `ai-autonomy` @ meter.js:L1-L1691
  - 白紙書き直しで 576 行削除 (KI-002 mass deletion と同規模) が実施されたが、削除された旧 5 経路集計ロジックが実際に「機能していない」ことの検証が不明。KI-002 の教訓「削除コードが distance_m 加算 / Worker B 起動 / 業務 flow に使われていたため業務全体が機能停止」と同じリスク: 旧経路が実は edge case で使われていた可能性。
  - 推奨対処: npm run test + e2e で regression check を実施し、実機で代行開始→距離加算→業務終了の full flow を確認する。旧 5 経路が担っていた gap fill / Off-Road の機能が pipelineDeltaM で完全にカバーされているか検証する。
- **[medium]** `sensor-dropout` @ gps-worker.js:L1-L800
  - 加速度サンプル null 時の GPS 単独 fallback (L800-807) が実装されているが、iOS Safari で permission 拒否された場合に accelSamples が永続的に null になり、静止判定が checkPositionStationary (位置半径のみ) に fallback する。この場合、GPS jitter (数 cm) が累積され「動かしていないのに距離が増える」事象 (KI-004 と類似) が発生する可能性がある。
  - 推奨対処: iOS Safari で加速度 permission 拒否時の挙動を実機テストで確認する。checkPositionStationary の stationary_radius_m (3m) が GPS jitter を十分に吸収できるか検証し、必要なら radius を縮小する (1m 等)。
- **[low]** `sw-cache` @ meter.js:L1 (importScripts 'pipeline-distance.js')
  - map-matcher.js が pipeline-distance.js を importScripts で読み込むが、Service Worker の cache 戦略が不明。KI-001 (SW cache 破壊・古いコード実行) と類似: CACHE_NAME 更新漏れで古い pipeline-distance.js が実行され続け、新しい距離計算ロジックが反映されない可能性がある。
  - 推奨対処: sw.js の PRECACHE_FILES に 'pipeline-distance.js' が含まれているか確認する。.github/workflows/auto-version.yml で commit SHA ベースの CACHE_NAME 自動更新が pipeline-distance.js にも適用されているか検証する。
- **[low]** `encoding` @ meter.js:L1-L1691
  - 白紙書き直しで大量のコメント (★設計変更宣言 / ★絶対不可侵 等) が追加されているが、KI-001 (Unicode 文字混入) のリスク: GitHub ウェブエディタ経由で編集された場合、スマートクォート (" ") やバッククォート (` `) が混入し、JS パーサーが SyntaxError で停止する可能性がある。
  - 推奨対処: push 前に node --check meter.js で構文チェックを実施する。grep -c 'data-cfemail' meter.js で Cloudflare 汚染を確認する。CLAUDE.md の「GitHub ウェブエディタ使用禁止」ルールを遵守する。
- **[low]** `gps-accuracy` @ gps-worker.js:L1-L800
  - accuracy > 50m で GPS 点を skip する既存ロジックが残っているが、Fix② (2026-05-28) で accuracy_moving_extreme_m (35m) への引き上げが実施されている。この 2 つの閾値 (50m と 35m) の整合性が不明で、50m ガードが先に発火して 35m ガードが dead code 化している可能性がある。KI-005 (RegionLoader 永続的 undefined) と類似の「永続的に false 評価される経路」。
  - 推奨対処: gps-worker.js の accuracy ガード箇所を全て grep し、50m と 35m の適用順序を確認する。50m ガードが先なら 35m に統一するか、移動時 / 静止時で分岐を明示する。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-07-26T16:01:40.219Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L1-L1691",
      "description": "★白紙書き直し (2026-05-30) で旧 5 経路集計 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) を全廃し、距離駆動を pipelineDeltaM 単一経路に一本化したが、既存キー (mm_distance_m / offroad_distance_m / gap_fill_total_m 等) を「後方互換キー (= 0 のまま温存)」として残置している。KI-003 (business.js 全関数 dead code 化) と類似のリスク: index.html / business.js が実際にこれらのキーを読んでいるか不明で、orphan 化している可能性がある。",
      "recommendation": "audit:knip で未使用 export を検出し、index.html / business.js の実際の参照箇所を grep で確認する。参照が 0 件なら段階的に削除 (KI-003 の教訓: 削除は呼出側削除と同 commit で実施)。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L551-L661",
      "description": "distance_m 加算経路が「running gate 内の state.distance_m += pipelineDeltaM」の 1 経路のみと主張しているが、コード中に「L551 Tier1 commit / L661 retroactive / L1168 gap fill / L1190 Off-Road incremental / L1691 setDistance」の 5 経路への言及が残っている。実際のコードでは pipelineDeltaM のみが加算されているように見えるが、コメントと実装の不整合がある。KI-004 (idle 中 business_distance_m 増加) と類似: running ガードが本当に全経路に適用されているか不明。",
      "recommendation": "meter.js の実際の distance_m 加算箇所を全て grep し、running ガード適用を確認する。コメント中の「L551/L661/L1168/L1190/L1691」が旧コードへの参照なら削除し、新コードの実際の行番号に更新する。"
    },
    {
      "severity": "high",
      "category": "billing-guard",
      "location": "meter.js:L551-L661 (推定)",
      "description": "business_distance_m の加算経路が「business_active gate で加算」と記載されているが、実際のコードが提供されていないため、KI-004 (idle 中 business_distance_m 増加) と同じ「state.running === false でも business_distance_m が更新される」バグが再発している可能性がある。特に pipelineDeltaM を business_distance_m に加算する箇所で running && business_active の二重ガードが必要。",
      "recommendation": "business_distance_m += pipelineDeltaM の実際のコード箇所を確認し、if (state.running && state.business_active) ガードが適用されているか検証する。tests/property/distance-m-update-paths.test.js に business_distance_m の running ガード検証を追加する。"
    },
    {
      "severity": "medium",
      "category": "distance-calculation",
      "location": "map-matcher.js:L157-L200 (_confirmedRoadDelta)",
      "description": "pipeline-distance.js の importScripts 失敗時に self.PipelineDistance が undefined のまま残り、_getPipelineTracker が null を返すが、_confirmedRoadDelta は例外を握りつぶして 0 を返すだけ。この場合、距離駆動が完全停止し、meter.js の distance_m が一切増えなくなる。KI-003 (業務単位処理機能停止) と類似の「silent failure」で、運転手が「距離が増えない」ことに気付くまで検出されない。",
      "recommendation": "pipeline-distance.js のロード失敗時に self.postMessage({ type: 'pipelineLoadError', error: _pdErr }) で main に通知し、UI で警告を表示する。既存 Viterbi mmIncrementM 経路へのフォールバックを明示的に実装する。"
    },
    {
      "severity": "medium",
      "category": "dead-code",
      "location": "map-matcher.js:L1-L2000",
      "description": "既存の mmIncrementM / tentativeIncrementM / tentativeDistanceM 算出ロジックが「1 byte 不変」として残置されているが、meter.js が実際にこれらの値を使用しているか不明。白紙書き直しで pipelineDeltaM に一本化したなら、旧経路は dead code 化している可能性がある。KI-005 (RegionLoader 永続的 undefined・Tier 3 dead code 化) と類似: typeof guard で safe だが永続的に false 評価される経路が残存。",
      "recommendation": "meter.js の update 関数で m.mmIncrementM / m.tentativeIncrementM / m.tentativeDistanceM を実際に参照しているか grep で確認する。参照が 0 件なら段階的に削除し、pipelineDeltaM のみに一本化する。"
    },
    {
      "severity": "medium",
      "category": "ai-autonomy",
      "location": "meter.js:L1-L1691",
      "description": "白紙書き直しで 576 行削除 (KI-002 mass deletion と同規模) が実施されたが、削除された旧 5 経路集計ロジックが実際に「機能していない」ことの検証が不明。KI-002 の教訓「削除コードが distance_m 加算 / Worker B 起動 / 業務 flow に使われていたため業務全体が機能停止」と同じリスク: 旧経路が実は edge case で使われていた可能性。",
      "recommendation": "npm run test + e2e で regression check を実施し、実機で代行開始→距離加算→業務終了の full flow を確認する。旧 5 経路が担っていた gap fill / Off-Road の機能が pipelineDeltaM で完全にカバーされているか検証する。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L1-L800",
      "description": "加速度サンプル null 時の GPS 単独 fallback (L800-807) が実装されているが、iOS Safari で permission 拒否された場合に accelSamples が永続的に null になり、静止判定が checkPositionStationary (位置半径のみ) に fallback する。この場合、GPS jitter (数 cm) が累積され「動かしていないのに距離が増える」事象 (KI-004 と類似) が発生する可能性がある。",
      "recommendation": "iOS Safari で加速度 permission 拒否時の挙動を実機テストで確認する。checkPositionStationary の stationary_radius_m (3m) が GPS jitter を十分に吸収できるか検証し、必要なら radius を縮小する (1m 等)。"
    },
    {
      "severity": "low",
      "category": "sw-cache",
      "location": "meter.js:L1 (importScripts 'pipeline-distance.js')",
      "description": "map-matcher.js が pipeline-distance.js を importScripts で読み込むが、Service Worker の cache 戦略が不明。KI-001 (SW cache 破壊・古いコード実行) と類似: CACHE_NAME 更新漏れで古い pipeline-distance.js が実行され続け、新しい距離計算ロジックが反映されない可能性がある。",
      "recommendation": "sw.js の PRECACHE_FILES に 'pipeline-distance.js' が含まれているか確認する。.github/workflows/auto-version.yml で commit SHA ベースの CACHE_NAME 自動更新が pipeline-distance.js にも適用されているか検証する。"
    },
    {
      "severity": "low",
      "category": "encoding",
      "location": "meter.js:L1-L1691",
      "description": "白紙書き直しで大量のコメント (★設計変更宣言 / ★絶対不可侵 等) が追加されているが、KI-001 (Unicode 文字混入) のリスク: GitHub ウェブエディタ経由で編集された場合、スマートクォート (\" \") やバッククォート (` `) が混入し、JS パーサーが SyntaxError で停止する可能性がある。",
      "recommendation": "push 前に node --check meter.js で構文チェックを実施する。grep -c 'data-cfemail' meter.js で Cloudflare 汚染を確認する。CLAUDE.md の「GitHub ウェブエディタ使用禁止」ルールを遵守する。"
    },
    {
      "severity": "low",
      "category": "gps-accuracy",
      "location": "gps-worker.js:L1-L800",
      "description": "accuracy > 50m で GPS 点を skip する既存ロジックが残っているが、Fix② (2026-05-28) で accuracy_moving_extreme_m (35m) への引き上げが実施されている。この 2 つの閾値 (50m と 35m) の整合性が不明で、50m ガードが先に発火して 35m ガードが dead code 化している可能性がある。KI-005 (RegionLoader 永続的 undefined) と類似の「永続的に false 評価される経路」。",
      "recommendation": "gps-worker.js の accuracy ガード箇所を全て grep し、50m と 35m の適用順序を確認する。50m ガードが先なら 35m に統一するか、移動時 / 静止時で分岐を明示する。"
    }
  ],
  "summary": "白紙書き直し (2026-05-30) による大規模リファクタリングで、KI-002 (mass deletion 576 行) と同規模の変更が実施されているが、旧 5 経路集計ロジックの完全削除と pipelineDeltaM 単一経路への一本化が「後方互換キー温存」「コメント中の旧行番号参照」「既存 mmIncrementM 算出ロジック 1 byte 不変」等の不整合を残している。KI-003 (business.js 全関数 dead code 化) / KI-005 (RegionLoader 永続的 undefined) と類似の「orphan 化リスク」が高い。特に distance_m / business_distance_m の running ガード適用が実際のコードで検証されていない場合、KI-004 (idle 中 business_distance_m 増加) が再発する可能性がある。pipeline-distance.js のロード失敗時の silent failure (距離駆動完全停止) は KI-003 と同じ「業務全体停止」リスクを持つ。実機テスト + npm run test + audit:knip で regression check を最優先で実施すべき。"
}
```
</details>

### #19 [ai-bug-hunter] weekly report 2026-07-19 (0 risks)
（作られた日 2026-07-19 ／ 指摘 0 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-07-19

**Model:** claude-sonnet-4-5-20250929

**Summary:** JSON parse error: Expected ',' or ']' after array element in JSON at position 7190

### Detected Risks

No risks detected (or execution failed).

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-07-19T15:54:42.393Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [],
  "summary": "JSON parse error: Expected ',' or ']' after array element in JSON at position 7190",
  "_raw": "```json\n{\n  \"risks\": [\n    {\n      \"severity\": \"high\",\n      \"category\": \"dead-code\",\n      \"location\": \"meter.js:L1-L1691\",\n      \"description\": \"★白紙書き直し (2026-05-30) で旧 5 経路集計 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) を全廃し、距離駆動を pipelineDeltaM 単一経路に一本化したが、既存キー (mm_distance_m / offroad_distance_m / gap_fill_total_m 等) を「後方互換のため 0 のまま温存」している。KI-005 (RegionLoader 永続的 undefined・Tier 3 dead code 化) と同じパターン: 参照値化されたキーが index.html / business.js から実際に読まれているか grep で検証されていない可能性。読まれていなければ dead code として削除すべきだが、読まれている場合は「0 固定値を返す orphan キー」として新規開発者の混乱を招く (= KI-005 の「Tier 3 が何か分からなくなる読解負荷」と同一)。\",\n      \"recommendation\": \"index.html / business.js での mm_distance_m / offroad_distance_m / gap_fill_total_m / tier2_pending_m / business_tier2_pending_m の参照を grep で全数確認。参照が 0 件なら削除 (KI-005 と同じ 235 行削除相当)。参照があれば comment で「後方互換・常に 0・新規コードでは使用禁止」を明記し、将来の段階的削除計画を CLAUDE.md に記載する。\"\n    },\n    {\n      \"severity\": \"high\",\n      \"category\": \"state-machine\",\n      \"location\": \"met"
}
```
</details>

### #18 [ai-bug-hunter] weekly report 2026-07-12 (10 risks)
（作られた日 2026-07-12 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-07-12

**Model:** claude-sonnet-4-5-20250929

**Summary:** 10 件のリスクを検出。高 severity 3 件 (dead code 温存・business_distance_m の running gate 欠落可能性・例外時の状態不整合)、中 severity 4 件 (定数依存関係の暗黙化・accel fallback の初期化漏れ・SW cache stale code・停車中 creep 二重保険の分岐)、低 severity 3 件 (escape hatch dead code・gap routing guard 救済経路欠落・mass deletion の自律判断可能性)。特に「白紙書き直し」による旧経路削除は KI-002 (mass deletion) / KI-003 (business.js dead code) / KI-005 (RegionLoader 欠落) と類似の orphan 化リスクが高く、後方互換キーの参照確認と dead code 検出が最優先。business_distance_m の running gate 欠落は KI-004 (idle 中増加) の再発リスクで billing-critical。例外時の状態不整合は cascade 過少 (良い GPS 点の連鎖棄却) を引き起こす可能性があり、gps-worker.js の bypass 化 (2026-06-04) との整合性確認が必要。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L1-L1691
  - ★白紙書き直し (2026-05-30) で旧 5 経路集計 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) を全廃し、距離駆動を pipelineDeltaM 単一経路に一本化したが、既存キー (mm_distance_m / offroad_distance_m / gap_fill_count 等) を「後方互換キー (= 0 のまま温存)」として残置している。KI-003 (business.js 全関数 dead code 化) と類似: リファクタリング時に呼出側を削除し定義だけが残る orphan 化リスク。index.html / business.js が実際にこれらのキーを読んでいるか不明 (= grep で確認必要)。読んでいなければ dead code。
  - 推奨対処: index.html / business.js での mm_distance_m / offroad_distance_m / gap_fill_* 等の参照を grep で確認。参照が 0 件なら knip warn で検出し、司さん明示指示後に削除。参照があれば comment で「後方互換キー (= index.html L### で参照)」と明記し、将来の削除候補として issue 化。
- **[high]** `state-machine` @ meter.js:L551-L661
  - KI-004 (idle 中 business_distance_m 増加) と類似: state.distance_m += pipelineDeltaM (L551 付近) は running gate 内だが、business_distance_m += pipelineDeltaM (L661 付近) は business_active gate 内。コメントでは「business_active gate で加算」と明記されているが、実際のコードで business_active && running の二重 gate になっているか確認必要。business_active=true && running=false (= 業務中だが空車) で business_distance_m が増える可能性。
  - 推奨対処: business_distance_m 加算箇所 (L661 付近) で `if (state.business_active && state.running)` の二重 gate を確認。running gate が欠落していれば追加。tests/property/distance-m-update-paths.test.js に business_distance_m の running gate verify を追加 (= KI-004 regression 防止)。
- **[high]** `distance-calculation` @ map-matcher.js:L157-L200 (_confirmedRoadDelta)
  - ★L1 配線 (2026-05-31) で距離源を「確定道路読み取り」へ一本化したが、_confirmedRoadDelta 内の例外処理 (try/catch) で deltaM=0 を返す際、lastPosition / lastRawPosition / __rawDispBuf 等の状態変数が更新されない可能性。KI-005 (RegionLoader 欠落) と類似: 例外時の no-op が状態不整合を生む。例外が連続すると「前回位置が古いまま」で次回の jump / doppler gate が誤動作し、良い GPS 点を棄却する cascade 過少リスク。
  - 推奨対処: _confirmedRoadDelta の catch ブロックで return 0 する前に、呼出側 (map-matcher.js L1168 付近) で lastPosition / lastRawPosition を更新するか、例外時も「位置は更新・距離だけ 0」の分離処理を追加。例外発生率を dlog で監視し、連続例外時は Worker B 再起動を検討。
- **[medium]** `gps-accuracy` @ gps-worker.js:L400-L450 (accuracy 天井)
  - ★Fix② (2026-05-28) で accuracy_moving_max_m=20 → accuracy_moving_extreme_m=35 へ引き上げたが、CONFIG.accuracy_moving_extreme_m (=35) と SAGE_HUSA_R_MAX_M (=35) が「偶然一致」している。将来どちらか一方だけを変更すると、Kalman の R̂ 上限と GPS 受理上限が乖離し、「Kalman は R̂=35 で平滑するが GPS は acc=40 を受理」のような不整合が起きる。KI-001 (Unicode 混入) と類似: 定数の暗黙的依存関係が文書化されていない。
  - 推奨対処: gps-worker.js の冒頭 comment で「accuracy_moving_extreme_m と SAGE_HUSA_R_MAX_M は必ず一致させること (= Kalman R̂ 上限と GPS 受理上限の同期)」と明記。変更時は両方を同時に更新する絶対ルールを CLAUDE.md に追加。CI で const 値の一致を assert するテストを追加 (tests/config-sync.test.js)。
- **[medium]** `sensor-dropout` @ gps-worker.js:L500-L600 (accel 判定不能時 fallback)
  - KI-004 / SENS-DROP-001 と類似: 加速度サンプル null 時の GPS 単独 fallback (checkPositionStationary) は「位置半径のみ」で判定するが、_posStillStart が null のまま (= 初回 GPS / reset 直後) だと checkPositionStationary が常に false を返し、isStationary=false で drift を計上する。iOS 権限拒否 (= accel 永久 null) + 初回 GPS で creep が発生するリスク。
  - 推奨対処: checkPositionStationary 内で _posStillStart === null 時の初期化処理を追加 (= 初回 GPS で anchor を設定)。または accel 判定不能時は「安全側 (= isStationary=true)」に倒し、drift を計上しない保守的 fallback に変更。tests/sensor-dropout.test.js で accel=null + 初回 GPS のケースを verify。
- **[medium]** `sw-cache` @ meter.js:L1-L10 (importScripts 'pipeline-distance.js')
  - KI-006 (SW cache 破壊) と類似: map-matcher.js L157 で `importScripts('pipeline-distance.js')` を try/catch で包んでいるが、Service Worker の cache が古い pipeline-distance.js を返し続けると、新しい meter.js (= pipelineDeltaM を期待) と古い pipeline-distance.js (= API 不一致) の組み合わせで例外が発生し、距離駆動が no-op (= deltaM=0) になる。SW の CACHE_NAME 更新漏れで stale code が実行される典型パターン。
  - 推奨対処: .github/workflows/auto-version.yml で sw.js の CACHE_NAME を commit SHA に自動更新する際、pipeline-distance.js も PRECACHE_FILES に含まれているか確認。含まれていなければ追加。tests/e2e/flow-standard.spec.js で pipelineDeltaM > 0 を assert し、stale code 検出を自動化。
- **[medium]** `billing-guard` @ meter.js:L551 / L661 (pipelineDeltaM 加算)
  - BILL-GUARD-001 と類似: pipelineDeltaM 加算は running gate 内だが、map-matcher.js L1168 付近の `if (_effectivelyStationary)` で pipelineDeltaM=0 にする「二重保険」がある。しかし _pdSmoothed() (= smoothedRawMode) 時は「時間軸ズレ」を理由に 0 化を skip している (L1168 comment)。この分岐が正しく動作しないと、停車中に pipelineDeltaM > 0 が漏れ、distance_m が増える creep リスク。
  - 推奨対処: tests/property/distance-m-update-paths.test.js に「isStationary=true 時の pipelineDeltaM=0」を verify するテストを追加 (= smoothedRawMode の有無で分岐)。実機で smoothedRawMode=true 時の creep を監視し、0 化 skip が妥当か再検証。妥当でなければ「エンジン側 ZUPT+cap が担保」の前提を tests/smoothed-flush-on-reset.test.js で assert。
- **[low]** `dead-code` @ meter.js:L200-L250 (_offRoadGraceUntil / OFFROAD_GRACE_AFTER_START_MS)
  - KI-005 (RegionLoader 欠落) と類似: _offRoadGraceUntil は「旧 Off-Road grace period の escape hatch 用 (= テスト互換・新距離では未使用だが API 維持)」と comment されているが、実際に参照している箇所が grep で 0 件なら dead code。API 維持の理由 (= どのテストが依存しているか) が不明。
  - 推奨対処: _offRoadGraceUntil の参照箇所を grep で確認。参照が 0 件なら knip warn で検出し、司さん明示指示後に削除。参照があれば comment で「tests/xxx.test.js L### で使用」と明記。API 維持が不要なら _setOffRoadGraceUntil も削除候補。
- **[low]** `distance-calculation` @ map-matcher.js:L1168-L1200 (gap routing guard)
  - ★Phase2-a (2026-05-27) で gap routing に「誤 snap 過大ガード」(= 同一道路 polyline 経路のみ採用 / 直線距離比 <= GAP_MAX_DETOUR_RATIO) を追加したが、guard 不通過時は skipped=1 で mmIncrementM=0 になり、meter.js も fill しない (= 過少安全側)。しかし「persistent miss は Off-Road が捕捉」と comment されているが、新 meter.js では Off-Road が廃止されている (= L1-L10 comment で明記)。guard 不通過が連続すると過少が累積するリスク。
  - 推奨対処: gap routing guard 不通過時の救済経路を確認。Off-Road 廃止後は「meter.js の速度×時間 fallback」が唯一の救済だが、dtSec<=60s+mmWorker 時は fill しない (= L1168 comment) ため、救済が機能しない。guard 条件 (GAP_MAX_DETOUR_RATIO=3.0) を緩和するか、guard 不通過時も「直線距離 × 0.8」等の保守的 fallback を追加し、過少を緩和。
- **[low]** `ai-autonomy` @ meter.js:L1-L1691 (全体)
  - KI-002 (mass deletion) と類似: 「白紙書き直し (2026-05-30)」で 576 行相当の旧距離経路 (5 経路集計 / 13 orphan helper / Viterbi mmIncrementM 集計 / tier2 preview 二重回路 / α-β filter) を削除したが、削除の commit log / issue が不明。司さんの明示指示なしで「自律判断」で削除した可能性。絶対ルール「指示されていない変更を勝手に行うことを禁止する」に抵触するリスク。
  - 推奨対処: 白紙書き直しの commit log (2026-05-30 付近) を確認し、司さんの明示指示があったか検証。指示がなければ「自律削除」として KI-002 と同様の事故。今後は大量削除 (= 50 行以上) を分割 commit + 各 commit で実機確認する workflow を CLAUDE.md に明記。dead code 削除は司さん明示指示後のみ実行する絶対ルールを再確認。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-07-12T15:57:03.940Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L1-L1691",
      "description": "★白紙書き直し (2026-05-30) で旧 5 経路集計 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) を全廃し、距離駆動を pipelineDeltaM 単一経路に一本化したが、既存キー (mm_distance_m / offroad_distance_m / gap_fill_count 等) を「後方互換キー (= 0 のまま温存)」として残置している。KI-003 (business.js 全関数 dead code 化) と類似: リファクタリング時に呼出側を削除し定義だけが残る orphan 化リスク。index.html / business.js が実際にこれらのキーを読んでいるか不明 (= grep で確認必要)。読んでいなければ dead code。",
      "recommendation": "index.html / business.js での mm_distance_m / offroad_distance_m / gap_fill_* 等の参照を grep で確認。参照が 0 件なら knip warn で検出し、司さん明示指示後に削除。参照があれば comment で「後方互換キー (= index.html L### で参照)」と明記し、将来の削除候補として issue 化。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L551-L661",
      "description": "KI-004 (idle 中 business_distance_m 増加) と類似: state.distance_m += pipelineDeltaM (L551 付近) は running gate 内だが、business_distance_m += pipelineDeltaM (L661 付近) は business_active gate 内。コメントでは「business_active gate で加算」と明記されているが、実際のコードで business_active && running の二重 gate になっているか確認必要。business_active=true && running=false (= 業務中だが空車) で business_distance_m が増える可能性。",
      "recommendation": "business_distance_m 加算箇所 (L661 付近) で `if (state.business_active && state.running)` の二重 gate を確認。running gate が欠落していれば追加。tests/property/distance-m-update-paths.test.js に business_distance_m の running gate verify を追加 (= KI-004 regression 防止)。"
    },
    {
      "severity": "high",
      "category": "distance-calculation",
      "location": "map-matcher.js:L157-L200 (_confirmedRoadDelta)",
      "description": "★L1 配線 (2026-05-31) で距離源を「確定道路読み取り」へ一本化したが、_confirmedRoadDelta 内の例外処理 (try/catch) で deltaM=0 を返す際、lastPosition / lastRawPosition / __rawDispBuf 等の状態変数が更新されない可能性。KI-005 (RegionLoader 欠落) と類似: 例外時の no-op が状態不整合を生む。例外が連続すると「前回位置が古いまま」で次回の jump / doppler gate が誤動作し、良い GPS 点を棄却する cascade 過少リスク。",
      "recommendation": "_confirmedRoadDelta の catch ブロックで return 0 する前に、呼出側 (map-matcher.js L1168 付近) で lastPosition / lastRawPosition を更新するか、例外時も「位置は更新・距離だけ 0」の分離処理を追加。例外発生率を dlog で監視し、連続例外時は Worker B 再起動を検討。"
    },
    {
      "severity": "medium",
      "category": "gps-accuracy",
      "location": "gps-worker.js:L400-L450 (accuracy 天井)",
      "description": "★Fix② (2026-05-28) で accuracy_moving_max_m=20 → accuracy_moving_extreme_m=35 へ引き上げたが、CONFIG.accuracy_moving_extreme_m (=35) と SAGE_HUSA_R_MAX_M (=35) が「偶然一致」している。将来どちらか一方だけを変更すると、Kalman の R̂ 上限と GPS 受理上限が乖離し、「Kalman は R̂=35 で平滑するが GPS は acc=40 を受理」のような不整合が起きる。KI-001 (Unicode 混入) と類似: 定数の暗黙的依存関係が文書化されていない。",
      "recommendation": "gps-worker.js の冒頭 comment で「accuracy_moving_extreme_m と SAGE_HUSA_R_MAX_M は必ず一致させること (= Kalman R̂ 上限と GPS 受理上限の同期)」と明記。変更時は両方を同時に更新する絶対ルールを CLAUDE.md に追加。CI で const 値の一致を assert するテストを追加 (tests/config-sync.test.js)。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L500-L600 (accel 判定不能時 fallback)",
      "description": "KI-004 / SENS-DROP-001 と類似: 加速度サンプル null 時の GPS 単独 fallback (checkPositionStationary) は「位置半径のみ」で判定するが、_posStillStart が null のまま (= 初回 GPS / reset 直後) だと checkPositionStationary が常に false を返し、isStationary=false で drift を計上する。iOS 権限拒否 (= accel 永久 null) + 初回 GPS で creep が発生するリスク。",
      "recommendation": "checkPositionStationary 内で _posStillStart === null 時の初期化処理を追加 (= 初回 GPS で anchor を設定)。または accel 判定不能時は「安全側 (= isStationary=true)」に倒し、drift を計上しない保守的 fallback に変更。tests/sensor-dropout.test.js で accel=null + 初回 GPS のケースを verify。"
    },
    {
      "severity": "medium",
      "category": "sw-cache",
      "location": "meter.js:L1-L10 (importScripts 'pipeline-distance.js')",
      "description": "KI-006 (SW cache 破壊) と類似: map-matcher.js L157 で `importScripts('pipeline-distance.js')` を try/catch で包んでいるが、Service Worker の cache が古い pipeline-distance.js を返し続けると、新しい meter.js (= pipelineDeltaM を期待) と古い pipeline-distance.js (= API 不一致) の組み合わせで例外が発生し、距離駆動が no-op (= deltaM=0) になる。SW の CACHE_NAME 更新漏れで stale code が実行される典型パターン。",
      "recommendation": ".github/workflows/auto-version.yml で sw.js の CACHE_NAME を commit SHA に自動更新する際、pipeline-distance.js も PRECACHE_FILES に含まれているか確認。含まれていなければ追加。tests/e2e/flow-standard.spec.js で pipelineDeltaM > 0 を assert し、stale code 検出を自動化。"
    },
    {
      "severity": "medium",
      "category": "billing-guard",
      "location": "meter.js:L551 / L661 (pipelineDeltaM 加算)",
      "description": "BILL-GUARD-001 と類似: pipelineDeltaM 加算は running gate 内だが、map-matcher.js L1168 付近の `if (_effectivelyStationary)` で pipelineDeltaM=0 にする「二重保険」がある。しかし _pdSmoothed() (= smoothedRawMode) 時は「時間軸ズレ」を理由に 0 化を skip している (L1168 comment)。この分岐が正しく動作しないと、停車中に pipelineDeltaM > 0 が漏れ、distance_m が増える creep リスク。",
      "recommendation": "tests/property/distance-m-update-paths.test.js に「isStationary=true 時の pipelineDeltaM=0」を verify するテストを追加 (= smoothedRawMode の有無で分岐)。実機で smoothedRawMode=true 時の creep を監視し、0 化 skip が妥当か再検証。妥当でなければ「エンジン側 ZUPT+cap が担保」の前提を tests/smoothed-flush-on-reset.test.js で assert。"
    },
    {
      "severity": "low",
      "category": "dead-code",
      "location": "meter.js:L200-L250 (_offRoadGraceUntil / OFFROAD_GRACE_AFTER_START_MS)",
      "description": "KI-005 (RegionLoader 欠落) と類似: _offRoadGraceUntil は「旧 Off-Road grace period の escape hatch 用 (= テスト互換・新距離では未使用だが API 維持)」と comment されているが、実際に参照している箇所が grep で 0 件なら dead code。API 維持の理由 (= どのテストが依存しているか) が不明。",
      "recommendation": "_offRoadGraceUntil の参照箇所を grep で確認。参照が 0 件なら knip warn で検出し、司さん明示指示後に削除。参照があれば comment で「tests/xxx.test.js L### で使用」と明記。API 維持が不要なら _setOffRoadGraceUntil も削除候補。"
    },
    {
      "severity": "low",
      "category": "distance-calculation",
      "location": "map-matcher.js:L1168-L1200 (gap routing guard)",
      "description": "★Phase2-a (2026-05-27) で gap routing に「誤 snap 過大ガード」(= 同一道路 polyline 経路のみ採用 / 直線距離比 <= GAP_MAX_DETOUR_RATIO) を追加したが、guard 不通過時は skipped=1 で mmIncrementM=0 になり、meter.js も fill しない (= 過少安全側)。しかし「persistent miss は Off-Road が捕捉」と comment されているが、新 meter.js では Off-Road が廃止されている (= L1-L10 comment で明記)。guard 不通過が連続すると過少が累積するリスク。",
      "recommendation": "gap routing guard 不通過時の救済経路を確認。Off-Road 廃止後は「meter.js の速度×時間 fallback」が唯一の救済だが、dtSec<=60s+mmWorker 時は fill しない (= L1168 comment) ため、救済が機能しない。guard 条件 (GAP_MAX_DETOUR_RATIO=3.0) を緩和するか、guard 不通過時も「直線距離 × 0.8」等の保守的 fallback を追加し、過少を緩和。"
    },
    {
      "severity": "low",
      "category": "ai-autonomy",
      "location": "meter.js:L1-L1691 (全体)",
      "description": "KI-002 (mass deletion) と類似: 「白紙書き直し (2026-05-30)」で 576 行相当の旧距離経路 (5 経路集計 / 13 orphan helper / Viterbi mmIncrementM 集計 / tier2 preview 二重回路 / α-β filter) を削除したが、削除の commit log / issue が不明。司さんの明示指示なしで「自律判断」で削除した可能性。絶対ルール「指示されていない変更を勝手に行うことを禁止する」に抵触するリスク。",
      "recommendation": "白紙書き直しの commit log (2026-05-30 付近) を確認し、司さんの明示指示があったか検証。指示がなければ「自律削除」として KI-002 と同様の事故。今後は大量削除 (= 50 行以上) を分割 commit + 各 commit で実機確認する workflow を CLAUDE.md に明記。dead code 削除は司さん明示指示後のみ実行する絶対ルールを再確認。"
    }
  ],
  "summary": "10 件のリスクを検出。高 severity 3 件 (dead code 温存・business_distance_m の running gate 欠落可能性・例外時の状態不整合)、中 severity 4 件 (定数依存関係の暗黙化・accel fallback の初期化漏れ・SW cache stale code・停車中 creep 二重保険の分岐)、低 severity 3 件 (escape hatch dead code・gap routing guard 救済経路欠落・mass deletion の自律判断可能性)。特に「白紙書き直し」による旧経路削除は KI-002 (mass deletion) / KI-003 (business.js dead code) / KI-005 (RegionLoader 欠落) と類似の orphan 化リスクが高く、後方互換キーの参照確認と dead code 検出が最優先。business_distance_m の running gate 欠落は KI-004 (idle 中増加) の再発リスクで billing-critical。例外時の状態不整合は cascade 過少 (良い GPS 点の連鎖棄却) を引き起こす可能性があり、gps-worker.js の bypass 化 (2026-06-04) との整合性確認が必要。"
}
```
</details>

### #17 [ai-bug-hunter] weekly report 2026-07-05 (10 risks)
（作られた日 2026-07-05 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-07-05

**Model:** claude-sonnet-4-5-20250929

**Summary:** 白紙書き直し (2026-05-30) で距離駆動を pipelineDeltaM 単一経路に一本化したが、旧 5 経路の残骸 (mm_distance_m / offroad_distance_m 等の後方互換キー) が dead code 化している可能性が最大のリスク (KI-003 類似)。また pipeline-distance.js のロード失敗時に距離が完全停止する fallback 欠如 (KI-003 類似) と、running / business_active gate の不整合 (KI-004 類似) が高 severity。その他、既存 Viterbi mmIncrementM の dead code 化、LRU eviction による tracker 状態喪失、drain window での距離喪失など、中〜低 severity のリスクが複数存在。全体として「新旧機能の混在期」に特有の orphan 化 / 不整合リスクが顕著。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L1-L1691
  - ★白紙書き直し (2026-05-30) で旧 5 経路集計 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) を全廃し、距離駆動を pipelineDeltaM 単一経路に一本化したが、既存キー (mm_distance_m / offroad_distance_m / gap_fill_count 等) を「後方互換キー (= 0 のまま温存)」として残置している。KI-003 (business.js 全関数 dead code 化) と類似: リファクタリング時に呼出側を削除し定義だけが残る orphan 化リスク。index.html / business.js が実際にこれらのキーを読んでいるか不明 (= grep で確認必要)。読んでいなければ dead code。
  - 推奨対処: index.html / business.js での mm_distance_m / offroad_distance_m / gap_fill_count / tier2_pending_m 等の参照を grep で確認。参照 0 なら knip で検出し削除。参照があれば「後方互換キー」として comment に明記し、将来の削除計画を立てる。
- **[high]** `state-machine` @ meter.js:L551-L661
  - distance_m 加算経路が「running gate 内の state.distance_m += pipelineDeltaM」の 1 経路のみと宣言されているが、setDistance (L1691) が「復元用」として distance_m を直接代入している。KI-004 (idle 中 business_distance_m 増加) と類似: state.running ガードが無い経路で距離が更新される可能性。setDistance が業務中 (running=true) に呼ばれた場合、pipelineDeltaM 経路と二重計上になるリスク。
  - 推奨対処: setDistance の呼出元 (index.html / business.js) を確認し、running=true 時に呼ばれないことを保証。または setDistance 内で if (state.running) { return; } ガードを追加し、業務中の外部設定を禁止する。
- **[high]** `distance-calculation` @ map-matcher.js:L157-L200 (_confirmedRoadDelta)
  - pipeline-distance.js の importScripts が失敗した場合、self.PipelineDistance が undefined のまま _getPipelineTracker が null を返し、_confirmedRoadDelta が 0 を返す。この時 meter.js は pipelineDeltaM=0 で距離が増えず、既存 Viterbi mmIncrementM も「廃止」されているため距離が完全停止する。KI-003 (業務単位処理機能停止) と類似: 新機能の導入で既存 fallback 経路を削除し、新機能が失敗すると全体が機能停止。
  - 推奨対処: pipeline-distance.js のロード失敗時に既存 Viterbi mmIncrementM 経路を fallback として残す。または importScripts の catch block で self.postMessage({ type: 'error', message: 'pipeline-distance load failed' }) を送り、main 側で UI に警告を出す。
- **[medium]** `billing-guard` @ meter.js:L551-L661
  - pipelineDeltaM の加算が running gate 内にあるが、business_distance_m の加算が business_active gate 内にある。両者の gate 条件が異なるため、running=true かつ business_active=false の状態 (= 代行中だが業務外) で distance_m だけが増え、business_distance_m が増えない不整合が発生する。KI-004 (idle 中 business_distance_m 増加) の逆パターン: 業務外で課金距離だけが増える。
  - 推奨対処: business_distance_m の加算条件を「running && business_active」に統一し、両者の gate を同期させる。または「代行中 (running=true) は必ず業務中 (business_active=true)」という不変条件を assert で確認する。
- **[medium]** `dead-code` @ map-matcher.js:L1-L2000
  - 既存 Viterbi mmIncrementM / tentativeIncrementM / tentativeDistanceM の算出ロジックが「1 byte 不変」として残置されているが、meter.js が実際に使用しているのは pipelineDeltaM のみ。mmIncrementM 等が postMessage で送られているが、meter.js の update 関数内で参照されていない可能性 (= grep で確認必要)。KI-005 (RegionLoader 永続的 undefined・Tier 3 dead code 化) と類似: 別 Phase で撤去予定だった機能が参照だけ残り dead code 化。
  - 推奨対処: meter.js の update 関数内で m.mmIncrementM / m.tentativeIncrementM / m.tentativeDistanceM の参照を grep で確認。参照 0 なら map-matcher.js の該当算出ロジックを削除。参照があれば「後方互換」として comment に明記。
- **[medium]** `sensor-dropout` @ gps-worker.js:L1-L1000
  - pipeline-distance.js への ingest で speedSrc='hav' (= haversine 代用速度) を -1 (不明) として渡しているが、gps-worker.js が speedSrc を付与しない旧経路 (後方互換) では speedKmh がそのまま採用される。この時 haversine 代用速度が Doppler として誤認され、gap 補完が straight に落ちず微速×dt で潰れる可能性。KI-001 (Unicode 文字混入) と類似: 後方互換経路で新旧の混在が起きる。
  - 推奨対処: gps-worker.js の processPosition で speedSrc が未設定の場合、既定値として speedSrc='hav' を付与する。または map-matcher.js の _confirmedRoadDelta で msg.speedSrc が null の場合は -1 (不明) として扱う fallback を追加。
- **[medium]** `gps-accuracy` @ gps-worker.js:L400-L500 (processPosition)
  - accuracy 天井の緩和条件が「移動時 (直前 frame 非静止)」と「生 GPS 変位継続性 (disp_window=4 点の net>6m)」の 2 系統あるが、両者の優先順位が不明確。disp_window バッファ (__rawDispBuf) が 4 点未満の場合、変位継続性判定が機能せず accuracy が厳格 base のままになり、屋内徐行の良い fix が棄却される可能性。KI-004 (idle 中 business_distance_m 増加) と類似: 判定条件の不整合で意図しない挙動。
  - 推奨対処: __rawDispBuf.length < disp_window の場合の fallback 挙動を明示的に定義する。例: バッファ不足時は「移動時」条件のみで accuracy を緩和し、変位継続性判定は skip する。
- **[low]** `sw-cache` @ meter.js:L1-L1691
  - meter.js が白紙書き直しされたが、Service Worker (sw.js) の CACHE_NAME が更新されていない可能性。KI-001 (SW cache 破壊・古いコード実行) と類似: デプロイ後も古い meter.js が cache から返され、新距離エンジン (pipelineDeltaM) が動作しない。
  - 推奨対処: .github/workflows/auto-version.yml で sw.js の CACHE_NAME が commit SHA に自動更新されることを確認。または meter.js の先頭に version comment (// meter.js v2026-05-30) を追加し、実機で version が一致するか確認。
- **[low]** `dead-code` @ map-matcher.js:L157-L200 (_pipelineTrackers)
  - 県別 pipeline tracker が LRU eviction で破棄されるが、eviction 後に同じ県に戻った場合、tracker が再生成される。この時 tracker の内部状態 (累積距離 / 前回 snap) がリセットされ、初回 ingest が deltaM=0 ('first') になる。これが頻繁に起きると距離が過少化する可能性。KI-005 (RegionLoader 欠落) と類似: lazy load の再生成で状態が失われる。
  - 推奨対処: LRU eviction の頻度を実機で計測し、DECODER_LRU_CAP=4 が妥当か確認。頻繁に eviction が起きる場合は CAP を 6-8 に増やす。または eviction 時に tracker の累積距離を保存し、再生成時に復元する。
- **[low]** `billing-guard` @ meter.js:L551-L661
  - _drainMmUntil (= 代行開始直後の Worker B バッファ残骸 drain) が MM_DRAIN_AFTER_START_MS=500ms の間 pipelineDeltaM を 0 化するが、この間に実際に走行した距離が失われる可能性。drain window 中に 500ms × 60km/h = 8.3m の距離が発生しうる。KI-004 (idle 中 business_distance_m 増加) と類似: gate 条件で距離が失われる。
  - 推奨対処: MM_DRAIN_AFTER_START_MS を 500ms から 200ms に短縮し、drain window を最小化する。または drain 中の pipelineDeltaM を別変数に累積し、drain 終了後に一括加算する。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-07-05T16:06:18.604Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L1-L1691",
      "description": "★白紙書き直し (2026-05-30) で旧 5 経路集計 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) を全廃し、距離駆動を pipelineDeltaM 単一経路に一本化したが、既存キー (mm_distance_m / offroad_distance_m / gap_fill_count 等) を「後方互換キー (= 0 のまま温存)」として残置している。KI-003 (business.js 全関数 dead code 化) と類似: リファクタリング時に呼出側を削除し定義だけが残る orphan 化リスク。index.html / business.js が実際にこれらのキーを読んでいるか不明 (= grep で確認必要)。読んでいなければ dead code。",
      "recommendation": "index.html / business.js での mm_distance_m / offroad_distance_m / gap_fill_count / tier2_pending_m 等の参照を grep で確認。参照 0 なら knip で検出し削除。参照があれば「後方互換キー」として comment に明記し、将来の削除計画を立てる。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L551-L661",
      "description": "distance_m 加算経路が「running gate 内の state.distance_m += pipelineDeltaM」の 1 経路のみと宣言されているが、setDistance (L1691) が「復元用」として distance_m を直接代入している。KI-004 (idle 中 business_distance_m 増加) と類似: state.running ガードが無い経路で距離が更新される可能性。setDistance が業務中 (running=true) に呼ばれた場合、pipelineDeltaM 経路と二重計上になるリスク。",
      "recommendation": "setDistance の呼出元 (index.html / business.js) を確認し、running=true 時に呼ばれないことを保証。または setDistance 内で if (state.running) { return; } ガードを追加し、業務中の外部設定を禁止する。"
    },
    {
      "severity": "high",
      "category": "distance-calculation",
      "location": "map-matcher.js:L157-L200 (_confirmedRoadDelta)",
      "description": "pipeline-distance.js の importScripts が失敗した場合、self.PipelineDistance が undefined のまま _getPipelineTracker が null を返し、_confirmedRoadDelta が 0 を返す。この時 meter.js は pipelineDeltaM=0 で距離が増えず、既存 Viterbi mmIncrementM も「廃止」されているため距離が完全停止する。KI-003 (業務単位処理機能停止) と類似: 新機能の導入で既存 fallback 経路を削除し、新機能が失敗すると全体が機能停止。",
      "recommendation": "pipeline-distance.js のロード失敗時に既存 Viterbi mmIncrementM 経路を fallback として残す。または importScripts の catch block で self.postMessage({ type: 'error', message: 'pipeline-distance load failed' }) を送り、main 側で UI に警告を出す。"
    },
    {
      "severity": "medium",
      "category": "billing-guard",
      "location": "meter.js:L551-L661",
      "description": "pipelineDeltaM の加算が running gate 内にあるが、business_distance_m の加算が business_active gate 内にある。両者の gate 条件が異なるため、running=true かつ business_active=false の状態 (= 代行中だが業務外) で distance_m だけが増え、business_distance_m が増えない不整合が発生する。KI-004 (idle 中 business_distance_m 増加) の逆パターン: 業務外で課金距離だけが増える。",
      "recommendation": "business_distance_m の加算条件を「running && business_active」に統一し、両者の gate を同期させる。または「代行中 (running=true) は必ず業務中 (business_active=true)」という不変条件を assert で確認する。"
    },
    {
      "severity": "medium",
      "category": "dead-code",
      "location": "map-matcher.js:L1-L2000",
      "description": "既存 Viterbi mmIncrementM / tentativeIncrementM / tentativeDistanceM の算出ロジックが「1 byte 不変」として残置されているが、meter.js が実際に使用しているのは pipelineDeltaM のみ。mmIncrementM 等が postMessage で送られているが、meter.js の update 関数内で参照されていない可能性 (= grep で確認必要)。KI-005 (RegionLoader 永続的 undefined・Tier 3 dead code 化) と類似: 別 Phase で撤去予定だった機能が参照だけ残り dead code 化。",
      "recommendation": "meter.js の update 関数内で m.mmIncrementM / m.tentativeIncrementM / m.tentativeDistanceM の参照を grep で確認。参照 0 なら map-matcher.js の該当算出ロジックを削除。参照があれば「後方互換」として comment に明記。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L1-L1000",
      "description": "pipeline-distance.js への ingest で speedSrc='hav' (= haversine 代用速度) を -1 (不明) として渡しているが、gps-worker.js が speedSrc を付与しない旧経路 (後方互換) では speedKmh がそのまま採用される。この時 haversine 代用速度が Doppler として誤認され、gap 補完が straight に落ちず微速×dt で潰れる可能性。KI-001 (Unicode 文字混入) と類似: 後方互換経路で新旧の混在が起きる。",
      "recommendation": "gps-worker.js の processPosition で speedSrc が未設定の場合、既定値として speedSrc='hav' を付与する。または map-matcher.js の _confirmedRoadDelta で msg.speedSrc が null の場合は -1 (不明) として扱う fallback を追加。"
    },
    {
      "severity": "medium",
      "category": "gps-accuracy",
      "location": "gps-worker.js:L400-L500 (processPosition)",
      "description": "accuracy 天井の緩和条件が「移動時 (直前 frame 非静止)」と「生 GPS 変位継続性 (disp_window=4 点の net>6m)」の 2 系統あるが、両者の優先順位が不明確。disp_window バッファ (__rawDispBuf) が 4 点未満の場合、変位継続性判定が機能せず accuracy が厳格 base のままになり、屋内徐行の良い fix が棄却される可能性。KI-004 (idle 中 business_distance_m 増加) と類似: 判定条件の不整合で意図しない挙動。",
      "recommendation": "__rawDispBuf.length < disp_window の場合の fallback 挙動を明示的に定義する。例: バッファ不足時は「移動時」条件のみで accuracy を緩和し、変位継続性判定は skip する。"
    },
    {
      "severity": "low",
      "category": "sw-cache",
      "location": "meter.js:L1-L1691",
      "description": "meter.js が白紙書き直しされたが、Service Worker (sw.js) の CACHE_NAME が更新されていない可能性。KI-001 (SW cache 破壊・古いコード実行) と類似: デプロイ後も古い meter.js が cache から返され、新距離エンジン (pipelineDeltaM) が動作しない。",
      "recommendation": ".github/workflows/auto-version.yml で sw.js の CACHE_NAME が commit SHA に自動更新されることを確認。または meter.js の先頭に version comment (// meter.js v2026-05-30) を追加し、実機で version が一致するか確認。"
    },
    {
      "severity": "low",
      "category": "dead-code",
      "location": "map-matcher.js:L157-L200 (_pipelineTrackers)",
      "description": "県別 pipeline tracker が LRU eviction で破棄されるが、eviction 後に同じ県に戻った場合、tracker が再生成される。この時 tracker の内部状態 (累積距離 / 前回 snap) がリセットされ、初回 ingest が deltaM=0 ('first') になる。これが頻繁に起きると距離が過少化する可能性。KI-005 (RegionLoader 欠落) と類似: lazy load の再生成で状態が失われる。",
      "recommendation": "LRU eviction の頻度を実機で計測し、DECODER_LRU_CAP=4 が妥当か確認。頻繁に eviction が起きる場合は CAP を 6-8 に増やす。または eviction 時に tracker の累積距離を保存し、再生成時に復元する。"
    },
    {
      "severity": "low",
      "category": "billing-guard",
      "location": "meter.js:L551-L661",
      "description": "_drainMmUntil (= 代行開始直後の Worker B バッファ残骸 drain) が MM_DRAIN_AFTER_START_MS=500ms の間 pipelineDeltaM を 0 化するが、この間に実際に走行した距離が失われる可能性。drain window 中に 500ms × 60km/h = 8.3m の距離が発生しうる。KI-004 (idle 中 business_distance_m 増加) と類似: gate 条件で距離が失われる。",
      "recommendation": "MM_DRAIN_AFTER_START_MS を 500ms から 200ms に短縮し、drain window を最小化する。または drain 中の pipelineDeltaM を別変数に累積し、drain 終了後に一括加算する。"
    }
  ],
  "summary": "白紙書き直し (2026-05-30) で距離駆動を pipelineDeltaM 単一経路に一本化したが、旧 5 経路の残骸 (mm_distance_m / offroad_distance_m 等の後方互換キー) が dead code 化している可能性が最大のリスク (KI-003 類似)。また pipeline-distance.js のロード失敗時に距離が完全停止する fallback 欠如 (KI-003 類似) と、running / business_active gate の不整合 (KI-004 類似) が高 severity。その他、既存 Viterbi mmIncrementM の dead code 化、LRU eviction による tracker 状態喪失、drain window での距離喪失など、中〜低 severity のリスクが複数存在。全体として「新旧機能の混在期」に特有の orphan 化 / 不整合リスクが顕著。"
}
```
</details>

### #16 [ai-bug-hunter] weekly report 2026-06-28 (10 risks)
（作られた日 2026-06-28 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-06-28

**Model:** claude-sonnet-4-5-20250929

**Summary:** 白紙書き直し (2026-05-30) による大規模リファクタリングで、KI-002 (mass deletion) / KI-003 (dead code 化) / KI-004 (idle 中加算) と類似のリスクが複数検出された。特に (1) 後方互換キーの orphan 化、(2) running gate の実装確認不能、(3) 平滑モード時の停車中加算、(4) importScripts 失敗の silent 握りつぶし、(5) 576 行削除の自律判断疑惑が高リスク。実機テストと audit:knip による未使用 export 検出を優先実施すべき。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L1-L1691
  - ★白紙書き直し (2026-05-30) で旧 5 経路集計 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) を全廃し、距離駆動を pipelineDeltaM 単一経路に一本化したが、既存キー (mm_distance_m / offroad_distance_m / gap_fill_total_m 等) を「後方互換キー (= 0 のまま温存)」として残置している。KI-003 (business.js 全関数 dead code 化) と類似のリスク: index.html / business.js が実際にこれらのキーを読んでいるか不明で、orphan 化している可能性がある。
  - 推奨対処: audit:knip で未使用 export を検出し、index.html / business.js の実際の参照箇所を grep で確認する。参照が 0 件なら段階的に削除 (KI-003 の教訓: 削除は呼出側削除と同 commit で実施)。
- **[high]** `state-machine` @ meter.js:L551-L661
  - pipelineDeltaM の加算が running gate 内 (L551 付近) で実行されているが、コード全文が truncated されているため実際の gate 実装が確認できない。KI-004 (idle 中 business_distance_m 増加) と類似のリスク: state.running === false 時に pipelineDeltaM が加算される経路が存在する可能性がある。特に setDistance (L1691) は復元用 API で running 状態に関係なく呼ばれるため、復元時に running=false でも distance_m が設定される。
  - 推奨対処: 全 pipelineDeltaM 加算経路 (L551 / setDistance / 他) に `if (state.running)` ガードが適用されているか確認する。tests/property/distance-m-update-paths.test.js で running=false 時の加算が 0 であることを verify する。
- **[high]** `billing-guard` @ map-matcher.js:L1168-L1190
  - Worker B の _confirmedRoadDelta (L1168-L1190 付近) が pipelineDeltaM を算出する際、isStationary freeze (L1168 以降) で `if (_effectivelyStationary) _pipelineDeltaM_now = 0` を実行しているが、_pdSmoothed() 判定で平滑モード時は 0 化をスキップしている。KI-004 と類似のリスク: 平滑モード時に停車中でも pipelineDeltaM が非ゼロで返され、meter 側で distance_m に加算される可能性がある。
  - 推奨対処: _pdSmoothed() 分岐の妥当性を実機テストで確認する。平滑モード時の停車中 distance_m 増加が観測されたら、エンジン側 ZUPT+cap が時間軸ズレを吸収できているか検証する。
- **[medium]** `dead-code` @ map-matcher.js:L157
  - pipeline-distance.js の importScripts が try/catch で包まれており、失敗時は self.PipelineDistance 未定義のまま並列 tracker が no-op になる。L157 の guard で「並列計測の無効化のみ (課金経路に一切伝播させない)」と宣言しているが、実際には pipelineDeltaM=0 が返され続けるため、meter 側で distance_m が増えなくなる (= 課金距離が 0 のまま)。KI-003 と類似のリスク: importScripts 失敗が silent に握りつぶされ、業務全体が機能停止する。
  - 推奨対処: importScripts 失敗時に self.postMessage({ type: 'error', reason: 'pipeline-distance load failed' }) で main に通知し、UI で警告を表示する。既存 Viterbi mmIncrementM 経路が生存しているか確認する (コメントでは「影響ゼロで生存」と主張しているが、白紙書き直しで廃止されている可能性)。
- **[medium]** `mass-deletion` @ meter.js:L1-L1691
  - 白紙書き直し (2026-05-30) で 576 行相当の旧距離ロジック (5 経路集計 / 13 orphan helper / Viterbi mmIncrementM 集計 / tier2 preview 二重回路 / α-β filter) を削除したが、KI-002 (Claude Code 自律セッションによる 576 行 mass deletion) と同じ行数の削除が発生している。削除が「司さん明示指示後」に実行されたか不明で、自律判断での横展開の可能性がある。
  - 推奨対処: 削除 commit の履歴を確認し、司さんの明示指示があったか検証する。削除コードが実際に機能していた経路 (distance_m 加算 / Worker B 起動 / 業務 flow) に影響していないか、実機テストで regression check を実施する。
- **[medium]** `distance-calculation` @ map-matcher.js:L1168
  - _confirmedRoadDelta が outSnap (= Viterbi 確定 snap) を sample.snap として ingest に渡しているが、outSnap 不足 (roadIndex/snapLat/snapLng 欠落) 時は ingest 内部で従来 snap に退避する。DIST-CALC-001 と類似のリスク: 従来 snap が greedy 最近傍 SnapCache.snap の場合、GPS 直線距離が混入する可能性がある。
  - 推奨対処: ingest 内部の従来 snap 退避経路が GPS.calcDistance (haversine) を使っていないか確認する。使っている場合は Semgrep taint rule (distance-m-no-gps-line.yml) で検出されるはずだが、Worker B 内のコードが対象外の可能性がある。
- **[medium]** `sensor-dropout` @ gps-worker.js:L1-L1000
  - 加速度サンプル null 時の GPS 単独 fallback (L800-807 Fix① 新構造) が実装されているが、iOS Safari で permission 拒否された場合に accelSamples が永続的に null になる可能性がある。SENS-DROP-001 と類似のリスク: 加速度判定不能で checkPositionStationary fallback に落ちるが、A3 速度 drift (3.1km/h) で位置半径判定が defeat され、停車中も isStationary=false になる可能性がある。
  - 推奨対処: iOS Safari で加速度 permission 拒否時の実機テストを実施し、停車中 distance_m 増加が観測されないか確認する。観測された場合は checkPositionStationary の半径閾値 (stationary_radius_m=3) を拡大する。
- **[low]** `sw-cache` @ meter.js:L1
  - meter.js の白紙書き直し (2026-05-30) で CACHE_NAME が更新されていない可能性がある。SW-CACHE-001 と類似のリスク: sw.js の PRECACHE_FILES に旧 meter.js が含まれたまま新 meter.js がデプロイされると、stale code が実行され続ける。
  - 推奨対処: .github/workflows/auto-version.yml で sw.js CACHE_NAME が commit SHA に自動更新されているか確認する。手動 CACHE_NAME 更新漏れがないか sw.js を grep する。
- **[low]** `gps-accuracy` @ gps-worker.js:L1-L1000
  - bypass 化 (2026-06-04) で accuracy 天井を accuracy_moving_extreme_m=35 に引き上げたが、GPS-ACC-001 と類似のリスク: 都市部の高層ビル谷間で GPS 反射波により accuracy=35m の点が大量に受理され、Worker B の Viterbi snap が外れ値を吸収しきれない可能性がある。
  - 推奨対処: 実機テストで accuracy=35m の点が distance_m に加算される頻度を測定する。過大課金が観測された場合は accuracy_moving_extreme_m を 25m に引き下げる。
- **[low]** `dead-code` @ map-matcher.js:L1-L2000
  - DECODER_LRU_CAP=4 で県別 RoadDecoder を LRU eviction しているが、eviction 時に対応する pipeline tracker を破棄している (L157 付近)。KI-005 (RegionLoader 永続的 undefined) と類似のリスク: 県跨ぎ trip で再 load された decoder が同一バイト列から同一結果を再構築する保証があるか不明で、距離計算の再現性が失われる可能性がある。
  - 推奨対処: 県跨ぎ trip の実機テストで、同一経路を往復した時に distance_m が一致するか確認する。一致しない場合は tracker の reset() が完全初期化を保証しているか検証する。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-06-28T16:08:38.701Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L1-L1691",
      "description": "★白紙書き直し (2026-05-30) で旧 5 経路集計 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) を全廃し、距離駆動を pipelineDeltaM 単一経路に一本化したが、既存キー (mm_distance_m / offroad_distance_m / gap_fill_total_m 等) を「後方互換キー (= 0 のまま温存)」として残置している。KI-003 (business.js 全関数 dead code 化) と類似のリスク: index.html / business.js が実際にこれらのキーを読んでいるか不明で、orphan 化している可能性がある。",
      "recommendation": "audit:knip で未使用 export を検出し、index.html / business.js の実際の参照箇所を grep で確認する。参照が 0 件なら段階的に削除 (KI-003 の教訓: 削除は呼出側削除と同 commit で実施)。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L551-L661",
      "description": "pipelineDeltaM の加算が running gate 内 (L551 付近) で実行されているが、コード全文が truncated されているため実際の gate 実装が確認できない。KI-004 (idle 中 business_distance_m 増加) と類似のリスク: state.running === false 時に pipelineDeltaM が加算される経路が存在する可能性がある。特に setDistance (L1691) は復元用 API で running 状態に関係なく呼ばれるため、復元時に running=false でも distance_m が設定される。",
      "recommendation": "全 pipelineDeltaM 加算経路 (L551 / setDistance / 他) に `if (state.running)` ガードが適用されているか確認する。tests/property/distance-m-update-paths.test.js で running=false 時の加算が 0 であることを verify する。"
    },
    {
      "severity": "high",
      "category": "billing-guard",
      "location": "map-matcher.js:L1168-L1190",
      "description": "Worker B の _confirmedRoadDelta (L1168-L1190 付近) が pipelineDeltaM を算出する際、isStationary freeze (L1168 以降) で `if (_effectivelyStationary) _pipelineDeltaM_now = 0` を実行しているが、_pdSmoothed() 判定で平滑モード時は 0 化をスキップしている。KI-004 と類似のリスク: 平滑モード時に停車中でも pipelineDeltaM が非ゼロで返され、meter 側で distance_m に加算される可能性がある。",
      "recommendation": "_pdSmoothed() 分岐の妥当性を実機テストで確認する。平滑モード時の停車中 distance_m 増加が観測されたら、エンジン側 ZUPT+cap が時間軸ズレを吸収できているか検証する。"
    },
    {
      "severity": "medium",
      "category": "dead-code",
      "location": "map-matcher.js:L157",
      "description": "pipeline-distance.js の importScripts が try/catch で包まれており、失敗時は self.PipelineDistance 未定義のまま並列 tracker が no-op になる。L157 の guard で「並列計測の無効化のみ (課金経路に一切伝播させない)」と宣言しているが、実際には pipelineDeltaM=0 が返され続けるため、meter 側で distance_m が増えなくなる (= 課金距離が 0 のまま)。KI-003 と類似のリスク: importScripts 失敗が silent に握りつぶされ、業務全体が機能停止する。",
      "recommendation": "importScripts 失敗時に self.postMessage({ type: 'error', reason: 'pipeline-distance load failed' }) で main に通知し、UI で警告を表示する。既存 Viterbi mmIncrementM 経路が生存しているか確認する (コメントでは「影響ゼロで生存」と主張しているが、白紙書き直しで廃止されている可能性)。"
    },
    {
      "severity": "medium",
      "category": "mass-deletion",
      "location": "meter.js:L1-L1691",
      "description": "白紙書き直し (2026-05-30) で 576 行相当の旧距離ロジック (5 経路集計 / 13 orphan helper / Viterbi mmIncrementM 集計 / tier2 preview 二重回路 / α-β filter) を削除したが、KI-002 (Claude Code 自律セッションによる 576 行 mass deletion) と同じ行数の削除が発生している。削除が「司さん明示指示後」に実行されたか不明で、自律判断での横展開の可能性がある。",
      "recommendation": "削除 commit の履歴を確認し、司さんの明示指示があったか検証する。削除コードが実際に機能していた経路 (distance_m 加算 / Worker B 起動 / 業務 flow) に影響していないか、実機テストで regression check を実施する。"
    },
    {
      "severity": "medium",
      "category": "distance-calculation",
      "location": "map-matcher.js:L1168",
      "description": "_confirmedRoadDelta が outSnap (= Viterbi 確定 snap) を sample.snap として ingest に渡しているが、outSnap 不足 (roadIndex/snapLat/snapLng 欠落) 時は ingest 内部で従来 snap に退避する。DIST-CALC-001 と類似のリスク: 従来 snap が greedy 最近傍 SnapCache.snap の場合、GPS 直線距離が混入する可能性がある。",
      "recommendation": "ingest 内部の従来 snap 退避経路が GPS.calcDistance (haversine) を使っていないか確認する。使っている場合は Semgrep taint rule (distance-m-no-gps-line.yml) で検出されるはずだが、Worker B 内のコードが対象外の可能性がある。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L1-L1000",
      "description": "加速度サンプル null 時の GPS 単独 fallback (L800-807 Fix① 新構造) が実装されているが、iOS Safari で permission 拒否された場合に accelSamples が永続的に null になる可能性がある。SENS-DROP-001 と類似のリスク: 加速度判定不能で checkPositionStationary fallback に落ちるが、A3 速度 drift (3.1km/h) で位置半径判定が defeat され、停車中も isStationary=false になる可能性がある。",
      "recommendation": "iOS Safari で加速度 permission 拒否時の実機テストを実施し、停車中 distance_m 増加が観測されないか確認する。観測された場合は checkPositionStationary の半径閾値 (stationary_radius_m=3) を拡大する。"
    },
    {
      "severity": "low",
      "category": "sw-cache",
      "location": "meter.js:L1",
      "description": "meter.js の白紙書き直し (2026-05-30) で CACHE_NAME が更新されていない可能性がある。SW-CACHE-001 と類似のリスク: sw.js の PRECACHE_FILES に旧 meter.js が含まれたまま新 meter.js がデプロイされると、stale code が実行され続ける。",
      "recommendation": ".github/workflows/auto-version.yml で sw.js CACHE_NAME が commit SHA に自動更新されているか確認する。手動 CACHE_NAME 更新漏れがないか sw.js を grep する。"
    },
    {
      "severity": "low",
      "category": "gps-accuracy",
      "location": "gps-worker.js:L1-L1000",
      "description": "bypass 化 (2026-06-04) で accuracy 天井を accuracy_moving_extreme_m=35 に引き上げたが、GPS-ACC-001 と類似のリスク: 都市部の高層ビル谷間で GPS 反射波により accuracy=35m の点が大量に受理され、Worker B の Viterbi snap が外れ値を吸収しきれない可能性がある。",
      "recommendation": "実機テストで accuracy=35m の点が distance_m に加算される頻度を測定する。過大課金が観測された場合は accuracy_moving_extreme_m を 25m に引き下げる。"
    },
    {
      "severity": "low",
      "category": "dead-code",
      "location": "map-matcher.js:L1-L2000",
      "description": "DECODER_LRU_CAP=4 で県別 RoadDecoder を LRU eviction しているが、eviction 時に対応する pipeline tracker を破棄している (L157 付近)。KI-005 (RegionLoader 永続的 undefined) と類似のリスク: 県跨ぎ trip で再 load された decoder が同一バイト列から同一結果を再構築する保証があるか不明で、距離計算の再現性が失われる可能性がある。",
      "recommendation": "県跨ぎ trip の実機テストで、同一経路を往復した時に distance_m が一致するか確認する。一致しない場合は tracker の reset() が完全初期化を保証しているか検証する。"
    }
  ],
  "summary": "白紙書き直し (2026-05-30) による大規模リファクタリングで、KI-002 (mass deletion) / KI-003 (dead code 化) / KI-004 (idle 中加算) と類似のリスクが複数検出された。特に (1) 後方互換キーの orphan 化、(2) running gate の実装確認不能、(3) 平滑モード時の停車中加算、(4) importScripts 失敗の silent 握りつぶし、(5) 576 行削除の自律判断疑惑が高リスク。実機テストと audit:knip による未使用 export 検出を優先実施すべき。"
}
```
</details>

### #15 [ai-bug-hunter] weekly report 2026-06-21 (0 risks)
（作られた日 2026-06-21 ／ 指摘 0 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-06-21

**Model:** claude-sonnet-4-5-20250929

**Summary:** JSON parse error: Expected ',' or ']' after array element in JSON at position 7639

### Detected Risks

No risks detected (or execution failed).

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-06-21T16:33:33.944Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [],
  "summary": "JSON parse error: Expected ',' or ']' after array element in JSON at position 7639",
  "_raw": "```json\n{\n  \"risks\": [\n    {\n      \"severity\": \"high\",\n      \"category\": \"dead-code\",\n      \"location\": \"meter.js:L1-L1691\",\n      \"description\": \"★白紙書き直し (2026-05-30) で旧 5 経路集計 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) を全廃し、距離駆動を pipelineDeltaM 単一経路に一本化したが、既存キー (mm_distance_m / offroad_distance_m / gap_fill_total_m 等) を「後方互換のため 0 のまま温存」している。KI-005 (RegionLoader 永続的 undefined・Tier 3 dead code 化) と同じパターン: 参照値化されたキーが index.html / business.js から実際に読まれているか grep で検証されていない可能性。読まれていなければ dead code として削除すべきだが、読まれている場合は「0 固定値を返す orphan キー」として新規開発者の混乱を招く (= KI-005 の「Tier 3 が何か分からなくなる読解負荷」と同一)。\",\n      \"recommendation\": \"index.html / business.js での mm_distance_m / offroad_distance_m / gap_fill_total_m / tier2_pending_m / business_tier2_pending_m の参照を grep で全数確認。参照が 0 件なら削除 (KI-005 と同じ 235 行削除相当)。参照があれば comment で「後方互換・常に 0・新規コードでは使用禁止」を明記し、将来の段階的削除計画を CLAUDE.md に記載する。\"\n    },\n    {\n      \"severity\": \"high\",\n      \"category\": \"state-machine\",\n      \"location\": \"met"
}
```
</details>

### #14 [ai-bug-hunter] weekly report 2026-06-14 (0 risks)
（作られた日 2026-06-14 ／ 指摘 0 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-06-14

**Model:** claude-sonnet-4-5-20250929

**Summary:** JSON parse error: Expected ',' or ']' after array element in JSON at position 7746

### Detected Risks

No risks detected (or execution failed).

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-06-14T16:22:34.436Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [],
  "summary": "JSON parse error: Expected ',' or ']' after array element in JSON at position 7746",
  "_raw": "```json\n{\n  \"risks\": [\n    {\n      \"severity\": \"high\",\n      \"category\": \"dead-code\",\n      \"location\": \"meter.js:L1-L1691\",\n      \"description\": \"★白紙書き直し後の orphan 関数リスク★: meter.js が「白紙書き直し」で距離経路を単一化 (state.distance_m += pipelineDeltaM のみ) したが、旧 5 経路 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) の helper 関数群 (13 orphan helper・Viterbi mmIncrementM 集計・tier2 preview 二重回路・α-β filter) が「★この新ファイルには存在しない★」と宣言されている。しかし index.html / business.js が旧 API (getState の mm_*/offroad_*/gap_fill_* キー) を読む可能性があり、KI-003 (business.js 全関数 dead code 化) と同じ「呼出側削除と定義側削除の不整合」リスクがある。特に「後方互換キー (= 0 のまま温存)」が実際に参照されているか不明で、参照側が「0 以外を期待」していた場合に業務集計が機能停止する。\",\n      \"recommendation\": \"① index.html / business.js で mm_distance_m / offroad_distance_m / gap_fill_total_m を grep し、参照箇所が「0 固定値」を許容するか確認。② 許容しない場合は参照側を修正 (= 新 distance_m / pipelineDeltaM ベースに移行)。③ knip で getState 返却キーの未使用検出を実施し、温存キーが本当に必要か検証。④ 削除は「指示されていない変更を勝手に行うことを禁止する」絶対ルールに従い司さん明示指示後のみ実施。\"\n    },\n    {\n      \"severity\": \"high\""
}
```
</details>

### #13 [ai-bug-hunter] weekly report 2026-06-07 (10 risks)
（作られた日 2026-06-07 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-06-07

**Model:** claude-sonnet-4-5-20250929

**Summary:** 最重要リスクは「state.running / business_active ガード漏れ」(KI-004 類似) で、Off-Road Mode / business_distance_m / Tier 2 preview の 3 経路で idle 中加算の可能性。次に「setBusinessDistance orphan 化」(KI-003 類似) と「SW cache 古いコード実行」(SW-CACHE-001)。GPS accuracy 詐称 (GPS-ACC-001) と gap fill 速度異常値 (DIST-CALC-001) は中程度。全体として「絶対ルール (課金ガード / GPS 直線禁止)」の遵守は概ね良好だが、state gate の適用漏れが散見される。推奨対応: (1) 全 distance 加算経路に running/business_active ガード追加、(2) audit:knip で unused export 検出、(3) SW CACHE_NAME の CI 検証追加。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L257-L305
  - Off-Road Mode の _trackHaversineBetweenGps / _calculateOffRoadIncrement が GPS 直線距離 (haversine) を累積する経路だが、呼び出し側 (L514 retroactive / L979 Off-Road) で state.running ガードが適用されているか不明瞭。KI-004 (idle 中 business_distance_m 増加) と同様に、state.running=false 時に _haverAccumSinceLastCommit が累積され続けるリスク。
  - 推奨対処: _trackHaversineBetweenGps 内で state.running チェックを追加し、running=false 時は return で早期終了。または呼び出し側 (L514) で running ガード適用を明示的に comment で宣言。
- **[high]** `state-machine` @ meter.js:L934
  - business_distance_m += 経路 (L934) に「連続点 ZUPT」ガードが追加されているが、この判定ロジック (_isBusinessMicroMotion) が state.running ガードと独立して動作。state.running=false (空車中) でも ZUPT 判定が false なら business_distance_m が増加する可能性。KI-004 と同根の「idle 中加算」リスク。
  - 推奨対処: L934 の business_distance_m += 経路に `if (!state.business_active) return;` ガード追加。または _isBusinessMicroMotion 内で business_active チェックを組み込む。
- **[high]** `billing-guard` @ map-matcher.js:L2800-L2850 (推定)
  - Worker B の mmResult.tentativeIncrementM (Tier 2 preview) 計算経路で、prevSnap → bestEmit 間の道路距離を calcRoadDistance で算出しているが、main 側の state.running ガード適用が不明。main の tier2_pending_m += tentativeIncrementM (L未特定) で running=false 時も加算される可能性。KI-004 類似リスク。
  - 推奨対処: Worker B に main 側の state.running 状態を msg.running で伝達し、running=false 時は tentativeIncrementM=0 を強制。または main 側 tier2_pending_m += 経路に running ガード追加。
- **[medium]** `dead-code` @ meter.js:L1172 setBusinessDistance
  - setBusinessDistance は外部 API として export されているが、呼び出し元が不明 (grep で business.js / index.html に見当たらない可能性)。KI-003 (business.js 全関数 dead code 化) と同様に、リファクタリング時に呼び出し側が削除され orphan 化するリスク。
  - 推奨対処: audit:knip で setBusinessDistance の unused export を確認。使用箇所が 0 なら削除、または Business.js から明示的に呼び出す経路を追加して comment で宣言。
- **[medium]** `sensor-dropout` @ gps-worker.js:L596-L598
  - 加速度サンプル null 時の GPS 単独 fallback (finalStationary = gpsStationary) は実装済だが、compass null 時の Kalman Q 調整が未実装。compass 不在時に CONFIG._kalman_Q_override が設定されず、typeCode 連動 Q のみで動作。SENS-DROP-001 の「compass 不在で Kalman の方向融合が効かない」リスク。
  - 推奨対処: compass null 時の Q 調整ロジックを追加 (例: compassHeading == null なら Q を 1.2 倍に緩める)。または compass 不在時の diagnostic log を追加して影響範囲を可視化。
- **[medium]** `distance-calculation` @ meter.js:L824 calculateGapFill
  - gap fill は speed × time で距離を推定しているが、lastSpeedKmh が GPS spike (異常値) の場合に過大な距離が加算されるリスク。DIST-CALC-001 の「直線距離混入」とは異なるが、速度ベース推定の信頼性問題。
  - 推奨対処: calculateGapFill 内で lastSpeedKmh の物理上限 (160 km/h) clamp を追加。または gap fill 前に lastSpeedKmh の妥当性を gps-worker.js の加速度判定で検証。
- **[medium]** `sw-cache` @ sw.js (コード未提供)
  - SW-CACHE-001 の「CACHE_NAME 更新漏れで古いコード実行」リスク。auto-version.yml で commit SHA 自動更新されているが、meter.js / map-matcher.js の大規模変更時に SW が古い cache を返し続ける可能性。特に Worker B (map-matcher.js) は precache 対象のため影響大。
  - 推奨対処: デプロイ後に DevTools Application タブで CACHE_NAME が最新 commit SHA と一致するか確認。または CI で sw.js の CACHE_NAME と git rev-parse HEAD の一致を assert。
- **[low]** `gps-accuracy` @ map-matcher.js:L254-L255 / L302-L303
  - accuracy > 50m で haversine skip は実装済だが、一部 Android 端末で accuracy=3 詐称 (GPS-ACC-001) の場合に skip が効かない。実際の精度が 50m 超でも accuracy 値が信頼できず、GPS ジャンプが distance_m に混入するリスク。
  - 推奨対処: accuracy 値の信頼性を端末 UserAgent で判定し、詐称端末では accuracy × 1.5 等の補正係数を適用。または連続 2 サンプル間の距離が物理上限超過時に accuracy 値を無視して skip。
- **[low]** `billing-guard` @ meter.js:L863 wait_sec
  - wait_sec は running=true のみ加算と comment にあるが、実装コードが提供範囲外で確認不能。KI-004 と同様に running ガード漏れの可能性。
  - 推奨対処: wait_sec 加算経路 (L863 付近) で `if (!state.running) return;` ガードが存在するか確認。未実装なら追加し、★設計変更宣言として comment 記載。
- **[low]** `dead-code` @ meter.js:L1365 (推定・コード未提供)
  - distance_m 更新経路 5 つ (L440/L514/L961/L979/L1365) のうち L1365 が提供コード範囲外。KI-005 (RegionLoader 欠落で Tier 3 dead code) と同様に、呼び出し経路が存在しない可能性。
  - 推奨対処: L1365 の実装箇所を特定し、呼び出し元が存在するか確認。dead code なら削除し、tests/property/distance-m-update-paths.test.js の C1 検証を 4 経路に修正。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-06-07T16:13:00.047Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L257-L305",
      "description": "Off-Road Mode の _trackHaversineBetweenGps / _calculateOffRoadIncrement が GPS 直線距離 (haversine) を累積する経路だが、呼び出し側 (L514 retroactive / L979 Off-Road) で state.running ガードが適用されているか不明瞭。KI-004 (idle 中 business_distance_m 増加) と同様に、state.running=false 時に _haverAccumSinceLastCommit が累積され続けるリスク。",
      "recommendation": "_trackHaversineBetweenGps 内で state.running チェックを追加し、running=false 時は return で早期終了。または呼び出し側 (L514) で running ガード適用を明示的に comment で宣言。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L934",
      "description": "business_distance_m += 経路 (L934) に「連続点 ZUPT」ガードが追加されているが、この判定ロジック (_isBusinessMicroMotion) が state.running ガードと独立して動作。state.running=false (空車中) でも ZUPT 判定が false なら business_distance_m が増加する可能性。KI-004 と同根の「idle 中加算」リスク。",
      "recommendation": "L934 の business_distance_m += 経路に `if (!state.business_active) return;` ガード追加。または _isBusinessMicroMotion 内で business_active チェックを組み込む。"
    },
    {
      "severity": "high",
      "category": "billing-guard",
      "location": "map-matcher.js:L2800-L2850 (推定)",
      "description": "Worker B の mmResult.tentativeIncrementM (Tier 2 preview) 計算経路で、prevSnap → bestEmit 間の道路距離を calcRoadDistance で算出しているが、main 側の state.running ガード適用が不明。main の tier2_pending_m += tentativeIncrementM (L未特定) で running=false 時も加算される可能性。KI-004 類似リスク。",
      "recommendation": "Worker B に main 側の state.running 状態を msg.running で伝達し、running=false 時は tentativeIncrementM=0 を強制。または main 側 tier2_pending_m += 経路に running ガード追加。"
    },
    {
      "severity": "medium",
      "category": "dead-code",
      "location": "meter.js:L1172 setBusinessDistance",
      "description": "setBusinessDistance は外部 API として export されているが、呼び出し元が不明 (grep で business.js / index.html に見当たらない可能性)。KI-003 (business.js 全関数 dead code 化) と同様に、リファクタリング時に呼び出し側が削除され orphan 化するリスク。",
      "recommendation": "audit:knip で setBusinessDistance の unused export を確認。使用箇所が 0 なら削除、または Business.js から明示的に呼び出す経路を追加して comment で宣言。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L596-L598",
      "description": "加速度サンプル null 時の GPS 単独 fallback (finalStationary = gpsStationary) は実装済だが、compass null 時の Kalman Q 調整が未実装。compass 不在時に CONFIG._kalman_Q_override が設定されず、typeCode 連動 Q のみで動作。SENS-DROP-001 の「compass 不在で Kalman の方向融合が効かない」リスク。",
      "recommendation": "compass null 時の Q 調整ロジックを追加 (例: compassHeading == null なら Q を 1.2 倍に緩める)。または compass 不在時の diagnostic log を追加して影響範囲を可視化。"
    },
    {
      "severity": "medium",
      "category": "distance-calculation",
      "location": "meter.js:L824 calculateGapFill",
      "description": "gap fill は speed × time で距離を推定しているが、lastSpeedKmh が GPS spike (異常値) の場合に過大な距離が加算されるリスク。DIST-CALC-001 の「直線距離混入」とは異なるが、速度ベース推定の信頼性問題。",
      "recommendation": "calculateGapFill 内で lastSpeedKmh の物理上限 (160 km/h) clamp を追加。または gap fill 前に lastSpeedKmh の妥当性を gps-worker.js の加速度判定で検証。"
    },
    {
      "severity": "medium",
      "category": "sw-cache",
      "location": "sw.js (コード未提供)",
      "description": "SW-CACHE-001 の「CACHE_NAME 更新漏れで古いコード実行」リスク。auto-version.yml で commit SHA 自動更新されているが、meter.js / map-matcher.js の大規模変更時に SW が古い cache を返し続ける可能性。特に Worker B (map-matcher.js) は precache 対象のため影響大。",
      "recommendation": "デプロイ後に DevTools Application タブで CACHE_NAME が最新 commit SHA と一致するか確認。または CI で sw.js の CACHE_NAME と git rev-parse HEAD の一致を assert。"
    },
    {
      "severity": "low",
      "category": "gps-accuracy",
      "location": "map-matcher.js:L254-L255 / L302-L303",
      "description": "accuracy > 50m で haversine skip は実装済だが、一部 Android 端末で accuracy=3 詐称 (GPS-ACC-001) の場合に skip が効かない。実際の精度が 50m 超でも accuracy 値が信頼できず、GPS ジャンプが distance_m に混入するリスク。",
      "recommendation": "accuracy 値の信頼性を端末 UserAgent で判定し、詐称端末では accuracy × 1.5 等の補正係数を適用。または連続 2 サンプル間の距離が物理上限超過時に accuracy 値を無視して skip。"
    },
    {
      "severity": "low",
      "category": "billing-guard",
      "location": "meter.js:L863 wait_sec",
      "description": "wait_sec は running=true のみ加算と comment にあるが、実装コードが提供範囲外で確認不能。KI-004 と同様に running ガード漏れの可能性。",
      "recommendation": "wait_sec 加算経路 (L863 付近) で `if (!state.running) return;` ガードが存在するか確認。未実装なら追加し、★設計変更宣言として comment 記載。"
    },
    {
      "severity": "low",
      "category": "dead-code",
      "location": "meter.js:L1365 (推定・コード未提供)",
      "description": "distance_m 更新経路 5 つ (L440/L514/L961/L979/L1365) のうち L1365 が提供コード範囲外。KI-005 (RegionLoader 欠落で Tier 3 dead code) と同様に、呼び出し経路が存在しない可能性。",
      "recommendation": "L1365 の実装箇所を特定し、呼び出し元が存在するか確認。dead code なら削除し、tests/property/distance-m-update-paths.test.js の C1 検証を 4 経路に修正。"
    }
  ],
  "summary": "最重要リスクは「state.running / business_active ガード漏れ」(KI-004 類似) で、Off-Road Mode / business_distance_m / Tier 2 preview の 3 経路で idle 中加算の可能性。次に「setBusinessDistance orphan 化」(KI-003 類似) と「SW cache 古いコード実行」(SW-CACHE-001)。GPS accuracy 詐称 (GPS-ACC-001) と gap fill 速度異常値 (DIST-CALC-001) は中程度。全体として「絶対ルール (課金ガード / GPS 直線禁止)」の遵守は概ね良好だが、state gate の適用漏れが散見される。推奨対応: (1) 全 distance 加算経路に running/business_active ガード追加、(2) audit:knip で unused export 検出、(3) SW CACHE_NAME の CI 検証追加。"
}
```
</details>

### #12 [ai-bug-hunter] weekly report 2026-05-31 (10 risks)
（作られた日 2026-05-31 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-05-31

**Model:** claude-sonnet-4-5-20250929

**Summary:** 10 件のリスクを検出。最重要は (1) Off-Road Mode の retroactive 加算経路 (L514) が GPS 直線距離を課金に混入させる可能性 (DIST-CALC-001 違反)、(2) business_distance_m += 経路 (L934) に running ガード不在で空車中 GPS jitter 累積リスク (KI-004 類似)、(3) setDistance / setBusinessActive の呼び出し元不明で orphan 化の可能性 (KI-003 類似)。全て過去事例 (KI-002/003/004, BILL-GUARD-001, DIST-CALC-001) と類似パターンで、絶対ルール「GPS 直線距離での課金禁止」「distance_m 更新経路は 5 つのみ」「実装済み機能は必ず接続」に抵触するリスクあり。即座の確認・修正推奨。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L257-L305
  - Off-Road Mode の _trackHaversineBetweenGps / _calculateOffRoadIncrement が GPS 直線距離 (haversine) を累積する経路だが、呼び出し側 (L514 retroactive / L979 Off-Road) で state.running ガードが適用されているか不明瞭。KI-004 (idle 中 business_distance_m 増加) と同様に、state.running=false 時に _haverAccumSinceLastCommit が累積され続けるリスク。
  - 推奨対処: _trackHaversineBetweenGps 内で state.running チェックを追加。または呼び出し側 (L514) で running ガード適用を明示的にコメント記載。既存 L979 の running ガード (L976-977) が retroactive 経路 (L514) にも適用されているか確認。
- **[high]** `state-machine` @ meter.js:L934
  - business_distance_m += 経路 (L934) に state.business_active ガードが適用されているが、state.running ガードは適用されていない。Phase 2 設計変更で「business_active gate のみ」に変更されたが、KI-004 の教訓 (idle 中加算防止) と矛盾。空車中 (running=false) でも business_active=true なら GPS jitter で累積する可能性。
  - 推奨対処: L934 の business_distance_m += 経路に state.running ガード追加を検討。または Phase 2 設計意図 (空車中も業務距離に含める) が正しいなら、★設計変更宣言で「空車中も加算する仕様」を明示し、GPS jitter 対策 (accuracy>50m / isStationary skip) が十分か再確認。
- **[medium]** `distance-calculation` @ meter.js:L514
  - retroactive 加算経路 (L460-466 旧コード / L514 現コード) で _haverAccumSinceLastCommit (GPS 直線距離累積) を state.distance_m に加算している。BILL-GUARD-001 / DIST-CALC-001 の「GPS 直線距離での課金禁止」絶対ルールに抵触する可能性。Off-Road Mode の ★絶対ルール適用外区間 宣言があるが、通常 HMM モード復帰時の retroactive 加算が「適用外区間」に該当するか不明瞭。
  - 推奨対処: L514 の retroactive 加算が「Off-Road Mode 中の haversine 累積」のみを対象とし、通常 HMM モード中は _haverAccumSinceLastCommit=0 であることを確認。または L514 の条件分岐で _offRoadActive=true 時のみ加算するよう明示化。
- **[high]** `dead-code` @ meter.js:L1172-L1181
  - setBusinessDistance / setDistance の外部 API が存在するが、呼び出し元が不明。KI-003 (business.js 全関数 dead code 化) と同様に、リファクタリング時に呼び出し側が削除され orphan 化している可能性。特に setDistance は「距離を外部から直接セット」する危険な API で、課金根拠 distance_m を上書きできるため、呼び出し元が存在しない場合は即削除すべき。
  - 推奨対処: grep で setDistance / setBusinessDistance の呼び出し元を確認。存在しない場合は即削除 (mass-deletion KI-002 の教訓に従い、司さん明示指示後のみ)。存在する場合は呼び出し経路を ★設計変更宣言 でコメント記載。
- **[medium]** `sw-cache` @ 全体
  - sw.js の CACHE_NAME 更新が .github/workflows/auto-version.yml で自動化されているが、meter.js / map-matcher.js / gps-worker.js の変更が precache に反映されるまでのラグが存在。KI-001 (SW-CACHE-001) の「デプロイ後も古いコード実行」リスク。特に Phase 1.ZUPT / Phase 2 business_active gate / Tier 2 preview 等の設計変更が stale cache で動作すると、司さんの実機で「修正したのに直っていない」報告が続く。
  - 推奨対処: デプロイ後に司さんの実機で「Application」タブの cache version を確認。CACHE_NAME が commit SHA と一致しない場合は手動で cache clear。または sw.js の activate ハンドラで旧 cache delete が確実に動作しているか確認。
- **[medium]** `sensor-dropout` @ gps-worker.js:L596-598
  - 加速度サンプル null 時の GPS 単独 fallback (L596-598) が存在するが、compass null 時の fallback が不明瞭。SENS-DROP-001 の「compass 不在で Kalman の方向融合が効かない」リスク。特に iOS Safari は DeviceMotionEvent 取得失敗が頻発するため、compassHeading=null 時の Kalman Q 値が typeCode 連動の動的値に fallback するか確認が必要。
  - 推奨対処: gps-worker.js の processPosition 内で compassHeading=null 時の CONFIG._kalman_Q_override 設定経路を確認。null 時は T5 の _getDynamicBaseQ() に fallback することを ★設計変更宣言 で明示。
- **[low]** `gps-accuracy` @ meter.js:L440 / L514 / L961 / L979
  - distance_m += 5 経路全てに accuracy>50m ガードが適用されているが、map-matcher.js の _onMmWorkerMessage (Worker B 出力) には accuracy ガードが存在しない。GPS-ACC-001 の「GPS 精度劣化・ジャンプ」が Worker B 経由で混入する可能性。特に都市部の高層ビル谷間で GPS 反射波により位置が 30-100m ジャンプした場合、Worker B が異常な mmIncrementM を出力するリスク。
  - 推奨対処: map-matcher.js の _onMmWorkerMessage 内で msg.accuracy (main から forward) をチェックし、accuracy>50m 時は mmIncrementM=0 に強制。または main 側の L440 で m.mmIncrementM 加算前に accuracy チェックを追加。
- **[medium]** `distance-calculation` @ map-matcher.js:L1365
  - tentativeIncrementM (Tier 2 preview) の計算で _routeDistance (道路距離) を使用しているが、物理上限 200m の sanity check のみで jumpProb チェックが存在しない。DIST-CALC-001 の「直線距離混入」リスクは回避されているが、GPS jump 時に異常な tentativeIncrementM が tier2_pending_m に累積され、表示が急増する可能性。
  - 推奨対処: L1365 の tentativeIncrementM 計算経路に jumpProb チェック (T9_HARD_SKIP_PROB) を追加。jumpProb 高時は tentativeIncrementM=0 に強制し、表示の急増を防ぐ。
- **[high]** `state-machine` @ meter.js:L1172-L1181 / business.js (未提供)
  - setBusinessActive の呼び出し元が business.js と記載されているが、business.js のコードが提供されていないため、呼び出しタイミングが不明。KI-003 の「業務単位処理機能停止」と同様に、business.js が orphan 化している可能性。特に Phase 2 設計変更で business_active gate が導入されたが、Business.start/end が Meter.setBusinessActive を呼んでいない場合、business_distance_m が永遠に 0 のまま。
  - 推奨対処: business.js の Business.start / Business.end / Business.resume / Business.discard で Meter.setBusinessActive(true/false) が呼ばれているか確認。呼ばれていない場合は即座に配線追加 (絶対ルール「実装済みの機能は必ず全て課金・業務フローに接続」)。
- **[medium]** `billing-guard` @ map-matcher.js:L1500-L1510
  - Worker B の mmIncrementM / tentativeIncrementM を msg.isStationary=true 時に強制 0 化する経路 (L1500-1510) が存在するが、main 側から msg.isStationary が正しく forward されているか不明。gps-worker.js の finalStationary 判定 (3 点 AND: GPS+C-1+C-2) が main 経由で Worker B に伝達される経路が存在しない場合、Worker B 側の isStationary ガードが機能せず、停車中も mmIncrementM が出力される。
  - 推奨対処: meter.js の update() 内で gpsResult.isStationary を Worker B に postMessage('gps', {isStationary: ...}) で forward する経路を確認。存在しない場合は即座に追加 (KI-004 の再発防止)。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-05-31T20:54:53.489Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L257-L305",
      "description": "Off-Road Mode の _trackHaversineBetweenGps / _calculateOffRoadIncrement が GPS 直線距離 (haversine) を累積する経路だが、呼び出し側 (L514 retroactive / L979 Off-Road) で state.running ガードが適用されているか不明瞭。KI-004 (idle 中 business_distance_m 増加) と同様に、state.running=false 時に _haverAccumSinceLastCommit が累積され続けるリスク。",
      "recommendation": "_trackHaversineBetweenGps 内で state.running チェックを追加。または呼び出し側 (L514) で running ガード適用を明示的にコメント記載。既存 L979 の running ガード (L976-977) が retroactive 経路 (L514) にも適用されているか確認。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L934",
      "description": "business_distance_m += 経路 (L934) に state.business_active ガードが適用されているが、state.running ガードは適用されていない。Phase 2 設計変更で「business_active gate のみ」に変更されたが、KI-004 の教訓 (idle 中加算防止) と矛盾。空車中 (running=false) でも business_active=true なら GPS jitter で累積する可能性。",
      "recommendation": "L934 の business_distance_m += 経路に state.running ガード追加を検討。または Phase 2 設計意図 (空車中も業務距離に含める) が正しいなら、★設計変更宣言で「空車中も加算する仕様」を明示し、GPS jitter 対策 (accuracy>50m / isStationary skip) が十分か再確認。"
    },
    {
      "severity": "medium",
      "category": "distance-calculation",
      "location": "meter.js:L514",
      "description": "retroactive 加算経路 (L460-466 旧コード / L514 現コード) で _haverAccumSinceLastCommit (GPS 直線距離累積) を state.distance_m に加算している。BILL-GUARD-001 / DIST-CALC-001 の「GPS 直線距離での課金禁止」絶対ルールに抵触する可能性。Off-Road Mode の ★絶対ルール適用外区間 宣言があるが、通常 HMM モード復帰時の retroactive 加算が「適用外区間」に該当するか不明瞭。",
      "recommendation": "L514 の retroactive 加算が「Off-Road Mode 中の haversine 累積」のみを対象とし、通常 HMM モード中は _haverAccumSinceLastCommit=0 であることを確認。または L514 の条件分岐で _offRoadActive=true 時のみ加算するよう明示化。"
    },
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L1172-L1181",
      "description": "setBusinessDistance / setDistance の外部 API が存在するが、呼び出し元が不明。KI-003 (business.js 全関数 dead code 化) と同様に、リファクタリング時に呼び出し側が削除され orphan 化している可能性。特に setDistance は「距離を外部から直接セット」する危険な API で、課金根拠 distance_m を上書きできるため、呼び出し元が存在しない場合は即削除すべき。",
      "recommendation": "grep で setDistance / setBusinessDistance の呼び出し元を確認。存在しない場合は即削除 (mass-deletion KI-002 の教訓に従い、司さん明示指示後のみ)。存在する場合は呼び出し経路を ★設計変更宣言 でコメント記載。"
    },
    {
      "severity": "medium",
      "category": "sw-cache",
      "location": "全体",
      "description": "sw.js の CACHE_NAME 更新が .github/workflows/auto-version.yml で自動化されているが、meter.js / map-matcher.js / gps-worker.js の変更が precache に反映されるまでのラグが存在。KI-001 (SW-CACHE-001) の「デプロイ後も古いコード実行」リスク。特に Phase 1.ZUPT / Phase 2 business_active gate / Tier 2 preview 等の設計変更が stale cache で動作すると、司さんの実機で「修正したのに直っていない」報告が続く。",
      "recommendation": "デプロイ後に司さんの実機で「Application」タブの cache version を確認。CACHE_NAME が commit SHA と一致しない場合は手動で cache clear。または sw.js の activate ハンドラで旧 cache delete が確実に動作しているか確認。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L596-598",
      "description": "加速度サンプル null 時の GPS 単独 fallback (L596-598) が存在するが、compass null 時の fallback が不明瞭。SENS-DROP-001 の「compass 不在で Kalman の方向融合が効かない」リスク。特に iOS Safari は DeviceMotionEvent 取得失敗が頻発するため、compassHeading=null 時の Kalman Q 値が typeCode 連動の動的値に fallback するか確認が必要。",
      "recommendation": "gps-worker.js の processPosition 内で compassHeading=null 時の CONFIG._kalman_Q_override 設定経路を確認。null 時は T5 の _getDynamicBaseQ() に fallback することを ★設計変更宣言 で明示。"
    },
    {
      "severity": "low",
      "category": "gps-accuracy",
      "location": "meter.js:L440 / L514 / L961 / L979",
      "description": "distance_m += 5 経路全てに accuracy>50m ガードが適用されているが、map-matcher.js の _onMmWorkerMessage (Worker B 出力) には accuracy ガードが存在しない。GPS-ACC-001 の「GPS 精度劣化・ジャンプ」が Worker B 経由で混入する可能性。特に都市部の高層ビル谷間で GPS 反射波により位置が 30-100m ジャンプした場合、Worker B が異常な mmIncrementM を出力するリスク。",
      "recommendation": "map-matcher.js の _onMmWorkerMessage 内で msg.accuracy (main から forward) をチェックし、accuracy>50m 時は mmIncrementM=0 に強制。または main 側の L440 で m.mmIncrementM 加算前に accuracy チェックを追加。"
    },
    {
      "severity": "medium",
      "category": "distance-calculation",
      "location": "map-matcher.js:L1365",
      "description": "tentativeIncrementM (Tier 2 preview) の計算で _routeDistance (道路距離) を使用しているが、物理上限 200m の sanity check のみで jumpProb チェックが存在しない。DIST-CALC-001 の「直線距離混入」リスクは回避されているが、GPS jump 時に異常な tentativeIncrementM が tier2_pending_m に累積され、表示が急増する可能性。",
      "recommendation": "L1365 の tentativeIncrementM 計算経路に jumpProb チェック (T9_HARD_SKIP_PROB) を追加。jumpProb 高時は tentativeIncrementM=0 に強制し、表示の急増を防ぐ。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L1172-L1181 / business.js (未提供)",
      "description": "setBusinessActive の呼び出し元が business.js と記載されているが、business.js のコードが提供されていないため、呼び出しタイミングが不明。KI-003 の「業務単位処理機能停止」と同様に、business.js が orphan 化している可能性。特に Phase 2 設計変更で business_active gate が導入されたが、Business.start/end が Meter.setBusinessActive を呼んでいない場合、business_distance_m が永遠に 0 のまま。",
      "recommendation": "business.js の Business.start / Business.end / Business.resume / Business.discard で Meter.setBusinessActive(true/false) が呼ばれているか確認。呼ばれていない場合は即座に配線追加 (絶対ルール「実装済みの機能は必ず全て課金・業務フローに接続」)。"
    },
    {
      "severity": "medium",
      "category": "billing-guard",
      "location": "map-matcher.js:L1500-L1510",
      "description": "Worker B の mmIncrementM / tentativeIncrementM を msg.isStationary=true 時に強制 0 化する経路 (L1500-1510) が存在するが、main 側から msg.isStationary が正しく forward されているか不明。gps-worker.js の finalStationary 判定 (3 点 AND: GPS+C-1+C-2) が main 経由で Worker B に伝達される経路が存在しない場合、Worker B 側の isStationary ガードが機能せず、停車中も mmIncrementM が出力される。",
      "recommendation": "meter.js の update() 内で gpsResult.isStationary を Worker B に postMessage('gps', {isStationary: ...}) で forward する経路を確認。存在しない場合は即座に追加 (KI-004 の再発防止)。"
    }
  ],
  "summary": "10 件のリスクを検出。最重要は (1) Off-Road Mode の retroactive 加算経路 (L514) が GPS 直線距離を課金に混入させる可能性 (DIST-CALC-001 違反)、(2) business_distance_m += 経路 (L934) に running ガード不在で空車中 GPS jitter 累積リスク (KI-004 類似)、(3) setDistance / setBusinessActive の呼び出し元不明で orphan 化の可能性 (KI-003 類似)。全て過去事例 (KI-002/003/004, BILL-GUARD-001, DIST-CALC-001) と類似パターンで、絶対ルール「GPS 直線距離での課金禁止」「distance_m 更新経路は 5 つのみ」「実装済み機能は必ず接続」に抵触するリスクあり。即座の確認・修正推奨。"
}
```
</details>

### #11 [ai-bug-hunter] weekly report 2026-05-31 (0 risks)
（作られた日 2026-05-31 ／ 指摘 0 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-05-31

**Model:** (unknown)

**Summary:** execution failed

### Detected Risks

No risks detected (or execution failed).

**Error:** `ANTHROPIC_API_KEY 未設定`

<details><summary>Raw JSON</summary>

```json
{
  "error": "ANTHROPIC_API_KEY 未設定",
  "risks": [],
  "summary": "execution failed"
}
```
</details>

### #10 [ai-bug-hunter] weekly report 2026-05-31 (0 risks)
（作られた日 2026-05-31 ／ 指摘 0 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-05-31

**Model:** (unknown)

**Summary:** execution failed

### Detected Risks

No risks detected (or execution failed).

**Error:** `ANTHROPIC_API_KEY 未設定`

<details><summary>Raw JSON</summary>

```json
{
  "error": "ANTHROPIC_API_KEY 未設定",
  "risks": [],
  "summary": "execution failed"
}
```
</details>

### #9 [ai-bug-hunter] weekly report 2026-05-31 (0 risks)
（作られた日 2026-05-31 ／ 指摘 0 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-05-31

**Model:** (unknown)

**Summary:** execution failed

### Detected Risks

No risks detected (or execution failed).

**Error:** `ANTHROPIC_API_KEY 未設定`

<details><summary>Raw JSON</summary>

```json
{
  "error": "ANTHROPIC_API_KEY 未設定",
  "risks": [],
  "summary": "execution failed"
}
```
</details>

---

## Daikou-app-test（12 件）

### #27 [ai-bug-hunter] weekly report 2026-08-16 (10 risks)
（作られた日 2026-08-16 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-08-16

**Model:** claude-sonnet-4-5-20250929

**Summary:** 10件のリスクを検出。最重要は①billing_frozen(確定凍結)ガードの距離加算経路への未適用(high・過大請求の根治不完全)、②車別k機構のdead code化リスク(high・KI-003類似)、③outSnap=null時のfallback経路不明瞭(high・過少リスク)。中程度は④後方互換キーの実参照不明(medium・KI-003類似)、⑤LRU eviction後の再load失敗時フォールバック欠落(medium・KI-002類似)、⑥bypass化後のaccuracy極端値ガード漏れ(medium・過大リスク)、⑦accel不能時fallbackの閾値甘さ(medium・creepリスク)。低は⑧SW cache更新漏れ(low・KI-001類似)、⑨gap routing guardの_via信頼性不明(low)、⑩running/isStationary非同期競合(low・代行開始直後creep)。全体的に「白紙書き直し後の配線検証不足」と「既存ガード機構の新経路への未適用」が目立つ。KI-002(mass deletion)の教訓「指示されていない変更を勝手に行うことを禁止」に照らすと、billing_frozenガードの距離経路への適用は「指示された修正(確定凍結)の横展開」として必須だが欠落している可能性が高い。audit:knip + dependency-cruiser + 実機テスト(特にcert/タクシー経路)での回帰検証を推奨。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L92-L157
  - 車別k機構(_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY)が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では_kForDelta=1.0で非作用(dormant)。KI-003(business.js全関数dead code化)と類似の「呼出されない状態」リスク。_daikouDistFactor>1.0時に_activeVehicleKが実際に距離に乗算される経路が存在しない(L355 _kForDelta=1.0固定)ため、calibrateVehicleK/setBusinessActive内のk更新ロジックが孤立している可能性。
  - 推奨対処: audit:knipで_activeVehicleK/_resolveVK/_factoryK/calibrateVehicleKの実呼出経路を検証。代行経路で本当に非作用なら「dormant but required for cert」を明示的にテストで保護(tests/cert-k-path.test.js等)。タクシー/cert経路の実機テストがない場合、KI-003同様に「定義だけ残って機能停止」状態に陥るリスク。
- **[high]** `state-machine` @ meter.js:L355, map-matcher.js:L1543-L1570
  - billing_frozen(到着確定で課金凍結)フラグがmeter.js L355の距離加算経路に適用されていない。state.running && !state.billing_frozenのガードが必要だが、現状はrunningのみ。KI-004(idle中business_distance_m増加)と同構造で「確定後もメーターが動き続けて総額が伸びる過大請求」(司さん実機報告2026-07-23)の根治が不完全。map-matcher.js側も_pipelineDeltaM_nowを算出後にbilling_frozen状態を考慮していない。
  - 推奨対処: meter.js L355の距離加算を`if (state.running && !state.billing_frozen)`に変更。map-matcher.jsにもbilling_frozen状態をmsg経由で伝達し、frozen時はpipelineDeltaM=0を強制。tests/property/billing-frozen-guard.test.jsで確定後の距離増加ゼロを検証。
- **[high]** `distance-calculation` @ map-matcher.js:L1543-L1570, meter.js:L355
  - _confirmedRoadDelta(確定道路読み取り)がoutSnap(Viterbi確定経路)を受け取るが、outSnapがnull/undefined時のフォールバック経路が不明瞭。L1547-1550で`pref=outSnap.prefecture || _snapAcrossPrefs`とあるが、_snapAcrossPrefsが失敗した場合、_getPipelineTracker(null)→nullでdeltaM=0となり、GPS空白でない区間でも距離が加算されない過少リスク。KI-005(RegionLoader欠落でTier3 dead)と類似の「fallback経路が実は動かない」パターン。
  - 推奨対処: _confirmedRoadDelta内でoutSnap=null時の明示的なフォールバック(最近傍道路snap等)を実装。または呼出側(L1543)でoutSnap必須を保証し、null時はskipped=1でmeter.js gap fill経路に委ねる設計を明文化。tests/property/distance-m-update-paths.test.jsでoutSnap=null caseを追加。
- **[medium]** `dead-code` @ meter.js:L200-L250 (後方互換キー)
  - tier2_pending_m/business_tier2_pending_m/gps_predictive_distance_m/mm_distance_m/offroad_distance_m等の「旧5経路廃止で参照値化・0のまま温存」キーが、index.html/business.jsから実際に読まれているか不明。KI-003(business.js全関数dead code化)と同様、「呼出側削除済だが定義だけ残った」状態の可能性。特にmm_distance_mはL355でpipeline deltaと同値をmirrorするコメントがあるが、実際のmirror代入コードが見当たらない(grep必要)。
  - 推奨対処: audit:knipでstate.tier2_pending_m等の参照箇所を全検索。index.html/business.jsが実際に読んでいない場合は削除(後方互換破棄を明示)。mm_distance_mのmirror代入が欠落している場合は実装するか、コメントを「mirror廃止・常に0」に修正。
- **[medium]** `ai-autonomy` @ map-matcher.js:L400-L450 (LRU eviction)
  - decoder LRU eviction(_evictDecoderLRU)でRoadDecoderのbytes/grid/offsetTableをnull化してGC解放するが、eviction後に同一県への再loadが失敗した場合のフォールバック経路が不明。loadRoads on-demand再loadが「enqueueRetry経由で救済」とあるが、enqueueRetryの実装がmap-matcher.js内に見当たらない(main側の責務?)。KI-002(mass deletion)と類似の「削除したコードの依存先が実は動かない」リスク。
  - 推奨対処: enqueueRetryの実装箇所を確認(main側ならコメントで明示)。再load失敗時のフォールバック(最寄り県decoder使用等)を実装。tests/lru-eviction.test.jsでeviction→再load→距離加算の一貫性を検証。OOM対策は重要だが、過少課金(距離0化)を生むなら本末転倒。
- **[medium]** `gps-accuracy` @ gps-worker.js:L800-L850 (bypass化・生位置→Worker B)
  - 距離経路に渡す位置を「Kalman平滑後→生の観測lat/lng」に切替えた(bypass化)が、生位置のaccuracy>35m(SAGE_HUSA_R_MAX_M)の極端値が硬棄却されずにWorker Bに届く可能性。accuracy_moving_extreme_m=35でガードしているが、L700-L750のaccuracy天井判定後にbypass(L800 return {lat,lng})で生位置を返すため、天井判定がKalman入力のみに作用しWorker B入力には無効化されている可能性。KI-001(unicode corruption)と類似の「修正が別経路に波及していない」パターン。
  - 推奨対処: gps-worker.js L800のreturn前にaccuracy>SAGE_HUSA_R_MAX_Mの硬棄却を再適用(return null)。またはWorker B側(map-matcher.js)でaccuracy>35mの点をskip。tests/property/gps-accuracy-extreme.test.jsでacc=50m点が距離に混入しないことを検証。
- **[medium]** `sensor-dropout` @ gps-worker.js:L600-L650 (accel判定不能時fallback)
  - 加速度サンプルnull時の静止判定fallback(checkPositionStationary)が、iOS権限拒否等で永続的にaccel=nullの端末で「位置半径のみ」判定に退化する。KI-004(idle中business_distance_m増加)と類似の「GPS jitter(数cm)も累積」リスク。checkPositionStationaryのstationary_radius_m=3mは通常時の閾値だが、accel不能時は更に厳格化(1m等)すべきでは? 現状は_posStillStart anchor更新ロジックがaccel有無で分岐していない。
  - 推奨対処: accel判定不能時のstationary_radius閾値を別定数(stationary_radius_accel_fallback_m=1m等)に分離。または「accel不能端末では業務開始を許可しない」UI制約を追加(index.htmlで事前チェック)。tests/sensor-dropout.test.jsでaccel=null時のcreep量を検証。
- **[low]** `sw-cache` @ 全体(sw.js言及なし)
  - meter.js/map-matcher.js/gps-worker.jsの白紙書き直し(2026-05-30)後、sw.jsのCACHE_NAMEが更新されているか不明。KI-001(SW cache破壊)と同様、「修正したはずのバグが実機で再現」リスク。特にpipeline-distance.js(新距離エンジン)のimportScripts追加がsw.jsのPRECACHE_FILESに反映されていない場合、古いpipeline-distance.jsがキャッシュから読まれ続ける。
  - 推奨対処: .github/workflows/auto-version.ymlがpipeline-distance.js/k-calib.jsを検出してCACHE_NAME更新をトリガーするか確認。sw.jsのPRECACHE_FILES配列にpipeline-distance.js/k-calib.jsが含まれているか検証。実機で「Application」タブのCache Storageを確認し、最新commit SHAのキャッシュが生成されているか確認。
- **[low]** `distance-calculation` @ map-matcher.js:L1200-L1250 (gap routing guard)
  - gap routing(MM_GAP_RESET_SEC<dtSec<=GAP_ROUTE_MAX_SEC)の誤snap過大ガード(GAP_MAX_DETOUR_RATIO=3.0)が、「同一道路polyline経路のみ採用」(_via==='polyline')と「直線距離比<=3.0」の2条件ANDだが、_via==='polyline'の判定がcalcRoadDistance/_routeDistance内部の実装に依存。_routeDistance実装が見当たらないため、_via値の信頼性が不明。KI-005(RegionLoader欠落)と類似の「依存先が実は動かない」リスク。
  - 推奨対処: _routeDistance実装を確認(別ファイル?)し、_via==='polyline'が確実に同一道路経路のみを示すことを検証。tests/gap-routing-guard.test.jsで別道路tile経路(_via!=='polyline')がskipされることを確認。GAP_MAX_DETOUR_RATIO=3.0の根拠(実測データ等)をドキュメント化。
- **[low]** `state-machine` @ meter.js:L355, gps-worker.js:L800
  - meter.jsのrunning gateとgps-worker.jsのisStationary判定が非同期(Worker経由)のため、「running=true直後の1-2 GPS点でisStationary=trueが残存」する競合リスク。KI-004(idle中business_distance_m増加)の亜種で、代行開始直後の数秒間にGPS jitterが距離に混入する可能性。特にwarmup GPS(primeFromWarmup)が代行開始前の静止状態を引き継ぐ場合、isStationary=trueのまま最初のupdateが走る。
  - 推奨対処: Meter.start()でrunning=trueに設定後、gps-workerに'forceNonStationary'メッセージを送信してisStationaryを即座にfalseに同期。またはmeter.js L355で`state.running && !msg.isStationary`の二重ガードを追加(既存のisStationary freeze機構と整合)。tests/start-race-condition.test.jsで代行開始直後の距離加算を検証。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-08-16T15:10:41.172Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L92-L157",
      "description": "車別k機構(_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY)が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では_kForDelta=1.0で非作用(dormant)。KI-003(business.js全関数dead code化)と類似の「呼出されない状態」リスク。_daikouDistFactor>1.0時に_activeVehicleKが実際に距離に乗算される経路が存在しない(L355 _kForDelta=1.0固定)ため、calibrateVehicleK/setBusinessActive内のk更新ロジックが孤立している可能性。",
      "recommendation": "audit:knipで_activeVehicleK/_resolveVK/_factoryK/calibrateVehicleKの実呼出経路を検証。代行経路で本当に非作用なら「dormant but required for cert」を明示的にテストで保護(tests/cert-k-path.test.js等)。タクシー/cert経路の実機テストがない場合、KI-003同様に「定義だけ残って機能停止」状態に陥るリスク。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L355, map-matcher.js:L1543-L1570",
      "description": "billing_frozen(到着確定で課金凍結)フラグがmeter.js L355の距離加算経路に適用されていない。state.running && !state.billing_frozenのガードが必要だが、現状はrunningのみ。KI-004(idle中business_distance_m増加)と同構造で「確定後もメーターが動き続けて総額が伸びる過大請求」(司さん実機報告2026-07-23)の根治が不完全。map-matcher.js側も_pipelineDeltaM_nowを算出後にbilling_frozen状態を考慮していない。",
      "recommendation": "meter.js L355の距離加算を`if (state.running && !state.billing_frozen)`に変更。map-matcher.jsにもbilling_frozen状態をmsg経由で伝達し、frozen時はpipelineDeltaM=0を強制。tests/property/billing-frozen-guard.test.jsで確定後の距離増加ゼロを検証。"
    },
    {
      "severity": "high",
      "category": "distance-calculation",
      "location": "map-matcher.js:L1543-L1570, meter.js:L355",
      "description": "_confirmedRoadDelta(確定道路読み取り)がoutSnap(Viterbi確定経路)を受け取るが、outSnapがnull/undefined時のフォールバック経路が不明瞭。L1547-1550で`pref=outSnap.prefecture || _snapAcrossPrefs`とあるが、_snapAcrossPrefsが失敗した場合、_getPipelineTracker(null)→nullでdeltaM=0となり、GPS空白でない区間でも距離が加算されない過少リスク。KI-005(RegionLoader欠落でTier3 dead)と類似の「fallback経路が実は動かない」パターン。",
      "recommendation": "_confirmedRoadDelta内でoutSnap=null時の明示的なフォールバック(最近傍道路snap等)を実装。または呼出側(L1543)でoutSnap必須を保証し、null時はskipped=1でmeter.js gap fill経路に委ねる設計を明文化。tests/property/distance-m-update-paths.test.jsでoutSnap=null caseを追加。"
    },
    {
      "severity": "medium",
      "category": "dead-code",
      "location": "meter.js:L200-L250 (後方互換キー)",
      "description": "tier2_pending_m/business_tier2_pending_m/gps_predictive_distance_m/mm_distance_m/offroad_distance_m等の「旧5経路廃止で参照値化・0のまま温存」キーが、index.html/business.jsから実際に読まれているか不明。KI-003(business.js全関数dead code化)と同様、「呼出側削除済だが定義だけ残った」状態の可能性。特にmm_distance_mはL355でpipeline deltaと同値をmirrorするコメントがあるが、実際のmirror代入コードが見当たらない(grep必要)。",
      "recommendation": "audit:knipでstate.tier2_pending_m等の参照箇所を全検索。index.html/business.jsが実際に読んでいない場合は削除(後方互換破棄を明示)。mm_distance_mのmirror代入が欠落している場合は実装するか、コメントを「mirror廃止・常に0」に修正。"
    },
    {
      "severity": "medium",
      "category": "ai-autonomy",
      "location": "map-matcher.js:L400-L450 (LRU eviction)",
      "description": "decoder LRU eviction(_evictDecoderLRU)でRoadDecoderのbytes/grid/offsetTableをnull化してGC解放するが、eviction後に同一県への再loadが失敗した場合のフォールバック経路が不明。loadRoads on-demand再loadが「enqueueRetry経由で救済」とあるが、enqueueRetryの実装がmap-matcher.js内に見当たらない(main側の責務?)。KI-002(mass deletion)と類似の「削除したコードの依存先が実は動かない」リスク。",
      "recommendation": "enqueueRetryの実装箇所を確認(main側ならコメントで明示)。再load失敗時のフォールバック(最寄り県decoder使用等)を実装。tests/lru-eviction.test.jsでeviction→再load→距離加算の一貫性を検証。OOM対策は重要だが、過少課金(距離0化)を生むなら本末転倒。"
    },
    {
      "severity": "medium",
      "category": "gps-accuracy",
      "location": "gps-worker.js:L800-L850 (bypass化・生位置→Worker B)",
      "description": "距離経路に渡す位置を「Kalman平滑後→生の観測lat/lng」に切替えた(bypass化)が、生位置のaccuracy>35m(SAGE_HUSA_R_MAX_M)の極端値が硬棄却されずにWorker Bに届く可能性。accuracy_moving_extreme_m=35でガードしているが、L700-L750のaccuracy天井判定後にbypass(L800 return {lat,lng})で生位置を返すため、天井判定がKalman入力のみに作用しWorker B入力には無効化されている可能性。KI-001(unicode corruption)と類似の「修正が別経路に波及していない」パターン。",
      "recommendation": "gps-worker.js L800のreturn前にaccuracy>SAGE_HUSA_R_MAX_Mの硬棄却を再適用(return null)。またはWorker B側(map-matcher.js)でaccuracy>35mの点をskip。tests/property/gps-accuracy-extreme.test.jsでacc=50m点が距離に混入しないことを検証。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L600-L650 (accel判定不能時fallback)",
      "description": "加速度サンプルnull時の静止判定fallback(checkPositionStationary)が、iOS権限拒否等で永続的にaccel=nullの端末で「位置半径のみ」判定に退化する。KI-004(idle中business_distance_m増加)と類似の「GPS jitter(数cm)も累積」リスク。checkPositionStationaryのstationary_radius_m=3mは通常時の閾値だが、accel不能時は更に厳格化(1m等)すべきでは? 現状は_posStillStart anchor更新ロジックがaccel有無で分岐していない。",
      "recommendation": "accel判定不能時のstationary_radius閾値を別定数(stationary_radius_accel_fallback_m=1m等)に分離。または「accel不能端末では業務開始を許可しない」UI制約を追加(index.htmlで事前チェック)。tests/sensor-dropout.test.jsでaccel=null時のcreep量を検証。"
    },
    {
      "severity": "low",
      "category": "sw-cache",
      "location": "全体(sw.js言及なし)",
      "description": "meter.js/map-matcher.js/gps-worker.jsの白紙書き直し(2026-05-30)後、sw.jsのCACHE_NAMEが更新されているか不明。KI-001(SW cache破壊)と同様、「修正したはずのバグが実機で再現」リスク。特にpipeline-distance.js(新距離エンジン)のimportScripts追加がsw.jsのPRECACHE_FILESに反映されていない場合、古いpipeline-distance.jsがキャッシュから読まれ続ける。",
      "recommendation": ".github/workflows/auto-version.ymlがpipeline-distance.js/k-calib.jsを検出してCACHE_NAME更新をトリガーするか確認。sw.jsのPRECACHE_FILES配列にpipeline-distance.js/k-calib.jsが含まれているか検証。実機で「Application」タブのCache Storageを確認し、最新commit SHAのキャッシュが生成されているか確認。"
    },
    {
      "severity": "low",
      "category": "distance-calculation",
      "location": "map-matcher.js:L1200-L1250 (gap routing guard)",
      "description": "gap routing(MM_GAP_RESET_SEC<dtSec<=GAP_ROUTE_MAX_SEC)の誤snap過大ガード(GAP_MAX_DETOUR_RATIO=3.0)が、「同一道路polyline経路のみ採用」(_via==='polyline')と「直線距離比<=3.0」の2条件ANDだが、_via==='polyline'の判定がcalcRoadDistance/_routeDistance内部の実装に依存。_routeDistance実装が見当たらないため、_via値の信頼性が不明。KI-005(RegionLoader欠落)と類似の「依存先が実は動かない」リスク。",
      "recommendation": "_routeDistance実装を確認(別ファイル?)し、_via==='polyline'が確実に同一道路経路のみを示すことを検証。tests/gap-routing-guard.test.jsで別道路tile経路(_via!=='polyline')がskipされることを確認。GAP_MAX_DETOUR_RATIO=3.0の根拠(実測データ等)をドキュメント化。"
    },
    {
      "severity": "low",
      "category": "state-machine",
      "location": "meter.js:L355, gps-worker.js:L800",
      "description": "meter.jsのrunning gateとgps-worker.jsのisStationary判定が非同期(Worker経由)のため、「running=true直後の1-2 GPS点でisStationary=trueが残存」する競合リスク。KI-004(idle中business_distance_m増加)の亜種で、代行開始直後の数秒間にGPS jitterが距離に混入する可能性。特にwarmup GPS(primeFromWarmup)が代行開始前の静止状態を引き継ぐ場合、isStationary=trueのまま最初のupdateが走る。",
      "recommendation": "Meter.start()でrunning=trueに設定後、gps-workerに'forceNonStationary'メッセージを送信してisStationaryを即座にfalseに同期。またはmeter.js L355で`state.running && !msg.isStationary`の二重ガードを追加(既存のisStationary freeze機構と整合)。tests/start-race-condition.test.jsで代行開始直後の距離加算を検証。"
    }
  ],
  "summary": "10件のリスクを検出。最重要は①billing_frozen(確定凍結)ガードの距離加算経路への未適用(high・過大請求の根治不完全)、②車別k機構のdead code化リスク(high・KI-003類似)、③outSnap=null時のfallback経路不明瞭(high・過少リスク)。中程度は④後方互換キーの実参照不明(medium・KI-003類似)、⑤LRU eviction後の再load失敗時フォールバック欠落(medium・KI-002類似)、⑥bypass化後のaccuracy極端値ガード漏れ(medium・過大リスク)、⑦accel不能時fallbackの閾値甘さ(medium・creepリスク)。低は⑧SW cache更新漏れ(low・KI-001類似)、⑨gap routing guardの_via信頼性不明(low)、⑩running/isStationary非同期競合(low・代行開始直後creep)。全体的に「白紙書き直し後の配線検証不足」と「既存ガード機構の新経路への未適用」が目立つ。KI-002(mass deletion)の教訓「指示されていない変更を勝手に行うことを禁止」に照らすと、billing_frozenガードの距離経路への適用は「指示された修正(確定凍結)の横展開」として必須だが欠落している可能性が高い。audit:knip + dependency-cruiser + 実機テスト(特にcert/タクシー経路)での回帰検証を推奨。"
}
```
</details>

### #26 [ai-bug-hunter] weekly report 2026-08-09 (0 risks)
（作られた日 2026-08-09 ／ 指摘 0 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-08-09

**Model:** claude-sonnet-4-5-20250929

**Summary:** JSON parse error: Unterminated string in JSON at position 7691

### Detected Risks

No risks detected (or execution failed).

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-08-09T15:20:19.521Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [],
  "summary": "JSON parse error: Unterminated string in JSON at position 7691",
  "_raw": "```json\n{\n  \"risks\": [\n    {\n      \"severity\": \"high\",\n      \"category\": \"dead-code\",\n      \"location\": \"meter.js:L92-L155\",\n      \"description\": \"車別k機構(_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY)が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では_kForDelta=1.0で非作用(dormant)。KI-003(business.js全関数dead code化)と類似: リファクタリング時に呼出側削除→関数定義だけ残存→orphan化のリスク。_postVehicleK(L92)がpipeline側obdVehicleKへ送る経路は生きているが、meter層の距離乗算×_activeVehicleKは代行では完全bypass。calibrateVehicleK(L1495 export)も精算時cert較正でのみ呼ばれる想定だが、代行autoCalibK ON時は別経路(worker側学習K)が支配し、この関数が実際に呼ばれるか不明。knip/dependency-cruiserでorphan検出されていない可能性。\",\n      \"recommendation\": \"audit:knipで_activeVehicleK/_resolveVK/_factoryK/calibrateVehicleKの呼出経路を検証。代行経路で実際に使われていないなら「タクシー専用」と明示し、テストでcert経路の生存を保証。削除する場合は司さん明示指示後、分割commitで実機確認(KI-002絶対ルール準拠)。\"\n    },\n    {\n      \"severity\": \"high\",\n      \"category\": \"billing-guard\",\n      \"location\": \"meter.js:L355(推定・_kForDelta適用箇所)\",\n      \"description\": \"コメントL355「_kForDelta・source"
}
```
</details>

### #22 [ai-bug-hunter] weekly report 2026-07-26 (10 risks)
（作られた日 2026-07-26 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-07-26

**Model:** claude-sonnet-4-5-20250929

**Summary:** 10 件のリスクを検出。高 severity 3 件: (1) 車別k機構の dormant 状態 orphan 化 (KI-003 類似)、(2) billing_frozen ガード漏れ (KI-004 類似)、(3) decoder 未ロード時の過少課金 (KI-005 類似)。中 severity 4 件: (4) smoothedRawMode 時の freeze 無効化、(5) 後方互換キーの orphan 化、(6) 加速度判定不能時の GPS drift 計上、(7) Worker B の cache 戦略不明 (SW-CACHE-001 類似)。低 severity 3 件: (8) accuracy 緩和による低精度点混入、(9) dead code 削除の検証不足 (KI-002 類似)、(10) gap routing の detour ratio 閾値が緩すぎる。全体的に「新距離エンジン (pipeline-distance) の並列経路」と「条件分岐で到達しない dormant コード」に過去事例と類似のリスクが集中。特に billing_frozen / isStationary freeze のガード漏れは「確定後も距離が増える」過大請求の直接原因となる可能性が高く、最優先で実機検証が必要。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L92-L155
  - 車別k機構 (_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY) が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では _kForDelta=1.0 で非作用 (dormant) 状態。KI-003 (business.js 全関数 dead code 化) と類似: 「呼出されない状態」ではなく「条件分岐で永遠に到達しない状態」で orphan 化している可能性。autoCalibK ON 時は meter 層の k は完全に非作用だが、コードは削除されず残存。
  - 推奨対処: audit:knip で未使用 export を検証。代行経路 (autoCalibK ON) とタクシー経路 (autoCalibK OFF) の両方で実機テストを実施し、_activeVehicleK/_resolveVK が実際に呼ばれているか dlog で確認。dormant 状態のコードは「将来削除予定」を明示するか、テストで生存を証明すること。
- **[high]** `state-machine` @ meter.js:L355-L380 + map-matcher.js:L2890-L2920
  - billing_frozen フラグ (確定後の課金距離凍結) が meter.js に追加されているが、map-matcher.js の pipelineDeltaM 算出経路 (_confirmedRoadDelta) には billing_frozen のガードが存在しない。KI-004 (idle 中 business_distance_m 増加) と類似: 「state.running ガードを全経路に適用」したはずが、新エンジン (pipeline-distance) の並列経路に漏れている可能性。確定後も Worker B が pipelineDeltaM > 0 を返し続けると、meter.js の running gate 内で distance_m が増加する。
  - 推奨対処: map-matcher.js の _confirmedRoadDelta 内で msg.billing_frozen をチェックし、frozen=true 時は deltaM=0 を返すガードを追加。または meter.js の running gate 内に billing_frozen チェックを追加 (if (state.running && !state.billing_frozen))。tests/property/distance-m-update-paths.test.js に billing_frozen 時の distance_m 不変を検証するテストを追加。
- **[high]** `distance-calculation` @ map-matcher.js:L2890-L2920 (_confirmedRoadDelta)
  - 新距離エンジン (pipeline-distance) の ingest 失敗時に deltaM=0 を返すが、失敗理由が「道路データ未ロード」「decoder 未ロード」「例外」のいずれかが不明。KI-005 (RegionLoader 永続的 undefined) と類似: 「typeof undefined ガードで safe」だが永続的に false 評価で dead code 化している可能性。県跨ぎ時に decoder が LRU eviction されると、再ロードまでの間 deltaM=0 が連続し、実際の走行距離が計上されない (過少課金)。
  - 推奨対処: _confirmedRoadDelta の try/catch 内で失敗理由を dlog 出力 (decoder 未ロード / ingest 例外 / tracker 未生成)。県跨ぎ時の decoder 再ロード完了までの gap を meter.js の gap fill (速度×時間) で補完する経路を確認。tests/property/distance-m-update-paths.test.js に「decoder 未ロード時の fallback」テストを追加。
- **[medium]** `billing-guard` @ map-matcher.js:L2950-L2970
  - isStationary freeze 時に pipelineDeltaM を 0 化する処理が「smoothedRawMode 補正」で条件分岐している (_pdSmoothed() が false の時のみ 0 化)。KI-004 (idle 中 business_distance_m 増加) と類似: 「全経路に running ガード適用」したはずが、smoothedRawMode=true 時は freeze が効かず、停車中も pipelineDeltaM > 0 が返る可能性。コメントでは「エンジン側 ZUPT+cap が担保」とあるが、二重保険の片方が条件付きで無効化されている。
  - 推奨対処: smoothedRawMode=true 時の停車中 distance_m 増加を実機テストで検証。pipeline-distance.js の ZUPT (Zero Velocity Update) が確実に deltaM=0 を返すことを tests/property/distance-m-update-paths.test.js で確認。または map-matcher.js の freeze を無条件化し、エンジン側 ZUPT との二重保険を維持。
- **[medium]** `dead-code` @ meter.js:L1200-L1300 (後方互換キー)
  - tier2_pending_m / business_tier2_pending_m / gps_predictive_distance_m / offroad_distance_m / offroad_count / gap_fill_count / gap_fill_total_m が「旧 5 経路廃止で参照値化・0 のまま温存」とコメントされているが、index.html / business.js が実際に読んでいるか不明。KI-003 (business.js 全関数 dead code 化) と類似: 「呼出側を削除し定義だけが残された orphan」状態の可能性。これらのキーが index.html で参照されていない場合、getState の返却オブジェクトに無駄なプロパティが残存。
  - 推奨対処: index.html / business.js で tier2_pending_m 等の後方互換キーが実際に参照されているか grep で確認。参照が 0 件なら削除し、getState の返却オブジェクトを軽量化。参照がある場合は「後方互換のため残置」を明示し、将来削除予定を記載。
- **[medium]** `sensor-dropout` @ gps-worker.js:L800-L850 (accel 判定不能時の fallback)
  - 加速度サンプル null 時の GPS 単独 fallback (checkPositionStationary) が実装されているが、iOS Safari で permission 拒否された場合の挙動が不明。KI-004 と SENS-DROP-001 の複合: 「加速度判定不能で GPS jitter 通過」により、停車中なのに distance_m が増える可能性。checkPositionStationary が _posStillStart (位置半径 anchor) を使うが、この anchor が GPS drift で移動すると、真の静止でも isStationary=false になる。
  - 推奨対処: iOS Safari で加速度 permission 拒否時の実機テストを実施。checkPositionStationary の _posStillStart が GPS drift で移動しないよう、anchor 更新条件を厳格化 (例: accuracy < 10m かつ速度 < 1 km/h の時のみ更新)。または加速度判定不能時は「安全側=静止扱い」にし、GPS jitter を計上しない。
- **[medium]** `sw-cache` @ map-matcher.js:L1-L50 (importScripts)
  - pipeline-distance.js / k-calib.js を importScripts で動的ロードしているが、Service Worker の cache 戦略が不明。SW-CACHE-001 と類似: 「CACHE_NAME を更新しないと古い code が実行され続ける」リスク。pipeline-distance.js が更新されても Worker B が古い version を cache から読み込むと、距離計算ロジックが旧版のまま動作し、修正したはずのバグが再現する。
  - 推奨対処: sw.js の PRECACHE_FILES に pipeline-distance.js / k-calib.js が含まれているか確認。.github/workflows/auto-version.yml で commit SHA ベースの CACHE_NAME 更新が Worker B の importScripts にも適用されているか検証。tests/e2e/flow-standard.spec.js に「Worker B が最新 version を読み込んでいるか」のチェックを追加。
- **[low]** `gps-accuracy` @ gps-worker.js:L600-L650 (accuracy 天井の動的緩和)
  - 移動時の accuracy 上限を accuracy_moving_extreme_m (35m) に緩和しているが、この緩和条件が「直前 frame 非静止」または「生 GPS 変位継続性」の OR 条件。GPS-ACC-001 と類似: 「GPS 精度劣化時の距離計算ロジック混入」により、accuracy 35m の低精度点が distance_m に加算される可能性。Worker B の Viterbi snap が外れ値を吸収する前提だが、連続して低精度点が来ると snap miss が連鎖し、GPS 直線距離が混入する。
  - 推奨対処: accuracy 35m の点が連続した場合の Worker B の挙動を実機テストで検証。Viterbi の emission scoring で accuracy > 20m の点に十分なペナルティが適用されているか確認。または accuracy 緩和を 20m → 25m 程度に抑え、35m は「真に使い物にならない極端値」の硬棄却のみに使用。
- **[low]** `mass-deletion` @ map-matcher.js:L500-L600 (P4/P5 廃止コメント)
  - cellular tunnel hint / accelLayerHint が「2026-05-09 (P4/P5 廃止)」とコメントされ、関連コードが削除されているが、削除 commit が個別に記録されていない。KI-002 (mass deletion) と類似: 「dead code 削除を自律判断で実行」し、実際には機能している経路を削除してしまった可能性。コメントでは「layer (v6 attribute) で代替済」とあるが、代替実装が正しく動作しているか検証されていない。
  - 推奨対処: cellular tunnel hint / accelLayerHint の削除 commit を git log で特定し、削除前後の実機テスト結果を比較。layer (v6 attribute) + tunnels-/bridges-{pref}.js データで tunnel/bridge 判定が正しく動作しているか tests/property/distance-m-update-paths.test.js で検証。削除したコードが「本当に dead」だったか、業務 flow に影響がないか確認。
- **[low]** `distance-calculation` @ map-matcher.js:L2700-L2800 (gap routing の detour ratio guard)
  - gap routing の誤 snap 過大ガードとして GAP_MAX_DETOUR_RATIO (3.0) を使用しているが、この閾値が経験的な値で、理論的根拠が不明。DIST-CALC-001 と類似: 「GPS 直線距離が道路ジオメトリ距離の代わりに混入」するリスク。detour ratio 3.0 は「道路距離 / 直線距離 <= 3.0」を許容するが、実際の道路網では detour ratio 2.0 を超えるケースは稀 (高速道路の大回り等)。3.0 は緩すぎて、誤 snap による遠回り経路を通過させる可能性。
  - 推奨対処: 実機データで gap routing の detour ratio 分布を分析し、適切な閾値を決定 (例: p95 = 2.0 → 閾値 2.5)。detour ratio > 3.0 の事例を dlog で収集し、誤 snap か正当な大回りかを判別。tests/property/distance-m-update-paths.test.js に「detour ratio guard が過大課金を防いでいるか」のテストを追加。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-07-26T15:57:33.060Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L92-L155",
      "description": "車別k機構 (_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY) が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では _kForDelta=1.0 で非作用 (dormant) 状態。KI-003 (business.js 全関数 dead code 化) と類似: 「呼出されない状態」ではなく「条件分岐で永遠に到達しない状態」で orphan 化している可能性。autoCalibK ON 時は meter 層の k は完全に非作用だが、コードは削除されず残存。",
      "recommendation": "audit:knip で未使用 export を検証。代行経路 (autoCalibK ON) とタクシー経路 (autoCalibK OFF) の両方で実機テストを実施し、_activeVehicleK/_resolveVK が実際に呼ばれているか dlog で確認。dormant 状態のコードは「将来削除予定」を明示するか、テストで生存を証明すること。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L355-L380 + map-matcher.js:L2890-L2920",
      "description": "billing_frozen フラグ (確定後の課金距離凍結) が meter.js に追加されているが、map-matcher.js の pipelineDeltaM 算出経路 (_confirmedRoadDelta) には billing_frozen のガードが存在しない。KI-004 (idle 中 business_distance_m 増加) と類似: 「state.running ガードを全経路に適用」したはずが、新エンジン (pipeline-distance) の並列経路に漏れている可能性。確定後も Worker B が pipelineDeltaM > 0 を返し続けると、meter.js の running gate 内で distance_m が増加する。",
      "recommendation": "map-matcher.js の _confirmedRoadDelta 内で msg.billing_frozen をチェックし、frozen=true 時は deltaM=0 を返すガードを追加。または meter.js の running gate 内に billing_frozen チェックを追加 (if (state.running && !state.billing_frozen))。tests/property/distance-m-update-paths.test.js に billing_frozen 時の distance_m 不変を検証するテストを追加。"
    },
    {
      "severity": "high",
      "category": "distance-calculation",
      "location": "map-matcher.js:L2890-L2920 (_confirmedRoadDelta)",
      "description": "新距離エンジン (pipeline-distance) の ingest 失敗時に deltaM=0 を返すが、失敗理由が「道路データ未ロード」「decoder 未ロード」「例外」のいずれかが不明。KI-005 (RegionLoader 永続的 undefined) と類似: 「typeof undefined ガードで safe」だが永続的に false 評価で dead code 化している可能性。県跨ぎ時に decoder が LRU eviction されると、再ロードまでの間 deltaM=0 が連続し、実際の走行距離が計上されない (過少課金)。",
      "recommendation": "_confirmedRoadDelta の try/catch 内で失敗理由を dlog 出力 (decoder 未ロード / ingest 例外 / tracker 未生成)。県跨ぎ時の decoder 再ロード完了までの gap を meter.js の gap fill (速度×時間) で補完する経路を確認。tests/property/distance-m-update-paths.test.js に「decoder 未ロード時の fallback」テストを追加。"
    },
    {
      "severity": "medium",
      "category": "billing-guard",
      "location": "map-matcher.js:L2950-L2970",
      "description": "isStationary freeze 時に pipelineDeltaM を 0 化する処理が「smoothedRawMode 補正」で条件分岐している (_pdSmoothed() が false の時のみ 0 化)。KI-004 (idle 中 business_distance_m 増加) と類似: 「全経路に running ガード適用」したはずが、smoothedRawMode=true 時は freeze が効かず、停車中も pipelineDeltaM > 0 が返る可能性。コメントでは「エンジン側 ZUPT+cap が担保」とあるが、二重保険の片方が条件付きで無効化されている。",
      "recommendation": "smoothedRawMode=true 時の停車中 distance_m 増加を実機テストで検証。pipeline-distance.js の ZUPT (Zero Velocity Update) が確実に deltaM=0 を返すことを tests/property/distance-m-update-paths.test.js で確認。または map-matcher.js の freeze を無条件化し、エンジン側 ZUPT との二重保険を維持。"
    },
    {
      "severity": "medium",
      "category": "dead-code",
      "location": "meter.js:L1200-L1300 (後方互換キー)",
      "description": "tier2_pending_m / business_tier2_pending_m / gps_predictive_distance_m / offroad_distance_m / offroad_count / gap_fill_count / gap_fill_total_m が「旧 5 経路廃止で参照値化・0 のまま温存」とコメントされているが、index.html / business.js が実際に読んでいるか不明。KI-003 (business.js 全関数 dead code 化) と類似: 「呼出側を削除し定義だけが残された orphan」状態の可能性。これらのキーが index.html で参照されていない場合、getState の返却オブジェクトに無駄なプロパティが残存。",
      "recommendation": "index.html / business.js で tier2_pending_m 等の後方互換キーが実際に参照されているか grep で確認。参照が 0 件なら削除し、getState の返却オブジェクトを軽量化。参照がある場合は「後方互換のため残置」を明示し、将来削除予定を記載。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L800-L850 (accel 判定不能時の fallback)",
      "description": "加速度サンプル null 時の GPS 単独 fallback (checkPositionStationary) が実装されているが、iOS Safari で permission 拒否された場合の挙動が不明。KI-004 と SENS-DROP-001 の複合: 「加速度判定不能で GPS jitter 通過」により、停車中なのに distance_m が増える可能性。checkPositionStationary が _posStillStart (位置半径 anchor) を使うが、この anchor が GPS drift で移動すると、真の静止でも isStationary=false になる。",
      "recommendation": "iOS Safari で加速度 permission 拒否時の実機テストを実施。checkPositionStationary の _posStillStart が GPS drift で移動しないよう、anchor 更新条件を厳格化 (例: accuracy < 10m かつ速度 < 1 km/h の時のみ更新)。または加速度判定不能時は「安全側=静止扱い」にし、GPS jitter を計上しない。"
    },
    {
      "severity": "medium",
      "category": "sw-cache",
      "location": "map-matcher.js:L1-L50 (importScripts)",
      "description": "pipeline-distance.js / k-calib.js を importScripts で動的ロードしているが、Service Worker の cache 戦略が不明。SW-CACHE-001 と類似: 「CACHE_NAME を更新しないと古い code が実行され続ける」リスク。pipeline-distance.js が更新されても Worker B が古い version を cache から読み込むと、距離計算ロジックが旧版のまま動作し、修正したはずのバグが再現する。",
      "recommendation": "sw.js の PRECACHE_FILES に pipeline-distance.js / k-calib.js が含まれているか確認。.github/workflows/auto-version.yml で commit SHA ベースの CACHE_NAME 更新が Worker B の importScripts にも適用されているか検証。tests/e2e/flow-standard.spec.js に「Worker B が最新 version を読み込んでいるか」のチェックを追加。"
    },
    {
      "severity": "low",
      "category": "gps-accuracy",
      "location": "gps-worker.js:L600-L650 (accuracy 天井の動的緩和)",
      "description": "移動時の accuracy 上限を accuracy_moving_extreme_m (35m) に緩和しているが、この緩和条件が「直前 frame 非静止」または「生 GPS 変位継続性」の OR 条件。GPS-ACC-001 と類似: 「GPS 精度劣化時の距離計算ロジック混入」により、accuracy 35m の低精度点が distance_m に加算される可能性。Worker B の Viterbi snap が外れ値を吸収する前提だが、連続して低精度点が来ると snap miss が連鎖し、GPS 直線距離が混入する。",
      "recommendation": "accuracy 35m の点が連続した場合の Worker B の挙動を実機テストで検証。Viterbi の emission scoring で accuracy > 20m の点に十分なペナルティが適用されているか確認。または accuracy 緩和を 20m → 25m 程度に抑え、35m は「真に使い物にならない極端値」の硬棄却のみに使用。"
    },
    {
      "severity": "low",
      "category": "mass-deletion",
      "location": "map-matcher.js:L500-L600 (P4/P5 廃止コメント)",
      "description": "cellular tunnel hint / accelLayerHint が「2026-05-09 (P4/P5 廃止)」とコメントされ、関連コードが削除されているが、削除 commit が個別に記録されていない。KI-002 (mass deletion) と類似: 「dead code 削除を自律判断で実行」し、実際には機能している経路を削除してしまった可能性。コメントでは「layer (v6 attribute) で代替済」とあるが、代替実装が正しく動作しているか検証されていない。",
      "recommendation": "cellular tunnel hint / accelLayerHint の削除 commit を git log で特定し、削除前後の実機テスト結果を比較。layer (v6 attribute) + tunnels-/bridges-{pref}.js データで tunnel/bridge 判定が正しく動作しているか tests/property/distance-m-update-paths.test.js で検証。削除したコードが「本当に dead」だったか、業務 flow に影響がないか確認。"
    },
    {
      "severity": "low",
      "category": "distance-calculation",
      "location": "map-matcher.js:L2700-L2800 (gap routing の detour ratio guard)",
      "description": "gap routing の誤 snap 過大ガードとして GAP_MAX_DETOUR_RATIO (3.0) を使用しているが、この閾値が経験的な値で、理論的根拠が不明。DIST-CALC-001 と類似: 「GPS 直線距離が道路ジオメトリ距離の代わりに混入」するリスク。detour ratio 3.0 は「道路距離 / 直線距離 <= 3.0」を許容するが、実際の道路網では detour ratio 2.0 を超えるケースは稀 (高速道路の大回り等)。3.0 は緩すぎて、誤 snap による遠回り経路を通過させる可能性。",
      "recommendation": "実機データで gap routing の detour ratio 分布を分析し、適切な閾値を決定 (例: p95 = 2.0 → 閾値 2.5)。detour ratio > 3.0 の事例を dlog で収集し、誤 snap か正当な大回りかを判別。tests/property/distance-m-update-paths.test.js に「detour ratio guard が過大課金を防いでいるか」のテストを追加。"
    }
  ],
  "summary": "10 件のリスクを検出。高 severity 3 件: (1) 車別k機構の dormant 状態 orphan 化 (KI-003 類似)、(2) billing_frozen ガード漏れ (KI-004 類似)、(3) decoder 未ロード時の過少課金 (KI-005 類似)。中 severity 4 件: (4) smoothedRawMode 時の freeze 無効化、(5) 後方互換キーの orphan 化、(6) 加速度判定不能時の GPS drift 計上、(7) Worker B の cache 戦略不明 (SW-CACHE-001 類似)。低 severity 3 件: (8) accuracy 緩和による低精度点混入、(9) dead code 削除の検証不足 (KI-002 類似)、(10) gap routing の detour ratio 閾値が緩すぎる。全体的に「新距離エンジン (pipeline-distance) の並列経路」と「条件分岐で到達しない dormant コード」に過去事例と類似のリスクが集中。特に billing_frozen / isStationary freeze のガード漏れは「確定後も距離が増える」過大請求の直接原因となる可能性が高く、最優先で実機検証が必要。"
}
```
</details>

### #19 [ai-bug-hunter] weekly report 2026-07-19 (10 risks)
（作られた日 2026-07-19 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-07-19

**Model:** claude-sonnet-4-5-20250929

**Summary:** 10件のリスクを検出。高severity 3件(車別k機構のdead code疑惑/business_distance_m二重ガード不足/pipeline-distance未ロード時の距離停止)が最優先対応。KI-003/KI-004/KI-005の過去事例パターン(dead code化/state-machine gate漏れ/永続的undefined)が複数箇所で再現されている。特にmeter.js L355のbusiness_distance_m加算とmap-matcher.js L1168のisStationary freeze条件の不整合が、KI-004と同構造の「idle中加算」リスクを内包。pipeline-distance.js importScripts失敗時のfallbackが「距離ゼロ」で、KI-005同様の機能停止リスク。中severity 4件(accuracy天井遷移lag/加速度null時fallback精度/SW cache stale/creep freeze条件甘)は実機テスト+property testで検証必要。低severity 3件(後方互換キー放置/tracker eviction時reset漏れ/worker reset時ZUPT初期化)は将来バグ温床のため段階的改善推奨。全体として「指示されていない変更を勝手に行うことを禁止する」絶対ルール遵守のため、各リスクの修正は司さん明示指示後に分割commit+実機確認で実施すべき。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L92-L157
  - 車別k機構(_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY)が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では_kForDelta=1.0で非作用(dormant)。KI-003(business.js全関数dead code化)と類似の「呼出されない状態」リスク。_postVehicleK(L92)がworkerへ送るが、代行autoCalibK ON時はmeter層のk乗算は完全bypass。コメントで「削除するとcert経路が壊れる」と防衛しているが、実際の呼出経路(cert/タクシー運用)の実機テストが不足していれば、KI-003同様に「定義だけ残って機能停止」状態の可能性。
  - 推奨対処: cert/タクシー経路の実機テスト(k適用確認)を追加。autoCalibK OFF時の_kForDelta適用経路(L355付近)の存在確認。knip/dependency-cruiserでcert経路のexport使用を継続監視。代行/cert/タクシーの3経路を明示的に分岐させ、各経路のテストケースを独立実装。
- **[high]** `state-machine` @ meter.js:L355, map-matcher.js:L1168-L1190
  - business_distance_mへの加算が「running gate内」ではなく「business_active gate内」で行われている(コメントL66)。KI-004(idle中business_distance_m増加)の再発リスク。map-matcher.js L1168-L1190の_confirmedRoadDelta→pipelineDeltaMの経路で、isStationary freeze(L1168)はあるがbusiness_active gateが見当たらない。meter.js L355で`if (state.running)`内で加算しているが、business_distance_mは`if (state.business_active)`でも二重ガードすべき(KI-004修正commit cd68ecd6参照)。
  - 推奨対処: meter.js L355付近でbusiness_distance_m加算に`if (state.business_active)`の二重ガードを追加。tests/property/distance-m-update-paths.test.jsにbusiness_distance_m用のrunning+business_active二重ガード検証を追加。Semgrep ruleでbusiness_distance_m更新箇所のbusiness_active gate必須化を検出。
- **[high]** `distance-calculation` @ map-matcher.js:L1168-L1190
  - _confirmedRoadDelta内でpipeline-distance.jsのingestを呼び、pipelineDeltaMを算出しているが、ingest失敗/未ロード時のfallback(return 0)が「距離ゼロ」。KI-005(RegionLoader永続的undefined)と類似の「永続的に0評価でdead code化」リスク。importScripts('pipeline-distance.js')失敗時(L157 try/catch)、self.PipelineDistanceがundefinedのまま→_getPipelineTracker(L243)がnull返却→_confirmedRoadDelta(L1168)が0返却→meter.jsのstate.distance_mが永遠に増えない(=課金距離停止)。KI-005の「typeof RegionLoader !== 'undefined'ガードで永続false」と同構造。
  - 推奨対処: pipeline-distance.js未ロード時の明示的エラー通知(workerからmainへpostMessage)を追加。mainでpipelineDeltaM=0が連続する場合の警告ログ/fallback経路(既存mmIncrementM使用)を実装。importScripts失敗をCI/e2eテストで検出(404/fetch errorシミュレーション)。
- **[medium]** `gps-accuracy` @ gps-worker.js:L800-L850
  - accuracy天井の動的緩和(accuracy_moving_extreme_m=35m)が「移動時のみ」適用されるが、判定が`_isStationaryLast`(前frameの静止判定)に依存。KI-004の「state.running問わず加算」と類似の時間差バグリスク。静止→移動の遷移1frame目で、まだ_isStationaryLast=trueのため天井が厳格base(~10m)のまま→移動開始直後の良いfix(acc 12-17m)が棄却→距離過少。GPS-ACC-001の「停車中なのにdistance_mが増える」の逆パターン(移動中なのに距離が増えない)。
  - 推奨対処: _isStationaryLastではなく現frameのisStationary判定後にaccuracy天井を再評価。または移動開始後N秒間は天井を緩和維持するhysteresis追加。tests/property/でstationary→moving遷移時のaccuracy天井変化を検証。
- **[medium]** `sensor-dropout` @ gps-worker.js:L900-L950, map-matcher.js:L1168
  - 加速度サンプルnull時のfallback(checkPositionStationary)が位置半径のみで判定するが、lastPositionがKalman平滑後の値。SENS-DROP-001(センサー消失でstationary判定が常時false)と類似。iOS権限拒否時、accelVariance=null→posStationary判定に退避するが、Kalman filterのlag(約40m)で位置半径が実際より大きく見え→偽moving判定→creep計上。map-matcher.js L1168のisStationary freeze条件が`msg.isStationary === true || msg.speedKmh < 2`だが、加速度null時のfallback判定精度が低いと、この条件をすり抜けてcreepが発生。
  - 推奨対処: checkPositionStationary内で生位置(lastRawPosition)を使用するよう変更。加速度null時の専用radius閾値(より厳格)を追加。tests/でiOS権限拒否シミュレーション(accelSamples=null)時のcreep量を検証。
- **[medium]** `sw-cache` @ meter.js:L1-L50(importScripts), map-matcher.js:L157
  - pipeline-distance.js/k-calib.jsのimportScripts失敗をtry/catchで握りつぶしているが、SW-CACHE-001(古いコード実行)と組み合わさると「古いpipeline-distance.jsが永続的にロードされ続ける」リスク。sw.jsのCACHE_NAME更新漏れ→古いpipeline-distance.jsがcacheから返却→importScripts成功(古い版)→新しい距離計算ロジックが反映されない。KI-001(unicode corruption)同様、デプロイ後も「修正したのに直っていない」状態が続く。
  - 推奨対処: pipeline-distance.js/k-calib.jsにversion文字列を埋め込み、importScripts後にversion不一致を検出してworkerからmainへ警告。sw.jsのauto-version.ymlでpipeline-distance.js/k-calib.jsもCACHE_NAME算出対象に追加。e2eテストでSW cache staleness検出(version mismatch時のfallback動作確認)。
- **[medium]** `billing-guard` @ meter.js:L355, map-matcher.js:L1168-L1190
  - pipelineDeltaMの加算が`if (state.running)`内(L355)だが、map-matcher.js側のisStationary freeze(L1168)が`msg.isStationary === true || msg.speedKmh < 2`。BILL-GUARD-001(課金ガード漏れ)リスク。speedKmh=2.5km/h(freeze条件外)でも実質停止の場合、pipelineDeltaM>0が返却→running=true時に加算→creep。KI-004の「全5経路にif (state.running)ガード追加」と同様の対策が、新pipelineDeltaM経路では不完全(isStationary条件が甘い)。
  - 推奨対処: map-matcher.js L1168のfreeze条件を`msg.isStationary === true || msg.speedKmh < CONFIG.speed_limit_kmh(=3)`に統一。meter.js L355でpipelineDeltaM加算前に追加ガード`if (m.isStationary) pipelineDeltaM=0`を二重保険として追加。tests/property/でspeedKmh=2-3km/h境界のcreep検証。
- **[low]** `dead-code` @ meter.js:L200-L250(後方互換キー)
  - tier2_pending_m/business_tier2_pending_m/gps_predictive_distance_m/offroad_distance_m等の後方互換キーが「常に0」で温存されている。KI-005(RegionLoader完全撤去で235行削除)と逆の「削除すべきだが残置」パターン。index.html/business.jsが読む可能性があるため残しているが、実際の参照が0件ならKI-002(mass deletion)の逆リスク(不要コードの永続化→将来バグ温床)。knip warnで検出されるはずだが、「warning止まり(即削除禁止)」ルールで放置されている可能性。
  - 推奨対処: index.html/business.jsでの後方互換キー参照をgrep全数調査。参照0件なら段階的削除(deprecation warning→次版で削除)。参照ありなら明示的なdeprecatedコメント追加+将来削除予定日を記載。knip warnを定期レビューし、orphan exportの削減計画を立てる。
- **[low]** `distance-calculation` @ map-matcher.js:L243-L280(_getPipelineTracker)
  - 県別trackerのLRU eviction(DECODER_LRU_CAP=4)で、evict時にtracker.reset()を呼ばずに_pipelineTrackers.delete()のみ実行(L280)。DIST-CALC-001(累積誤差)リスク。trackerが内部で累積状態(lastSnap/累積距離等)を持つ場合、GC前にreset()で状態クリアすべき。再load時に新trackerが生成されるが、旧trackerのメモリリークやGC遅延で、一時的に2つのtrackerが同一県で並存→距離二重計上の可能性(低確率だが理論上あり得る)。
  - 推奨対処: _evictDecoderLRU内でtracker削除前にtk.reset()を呼び出し、内部状態を明示的にクリア。pipeline-distance.jsのcreateDistanceTrackerがreset()メソッドを公開しているか確認(未公開なら追加)。tests/でLRU eviction→再load時の距離累積値が正しいか検証(県跨ぎtrip simulation)。
- **[low]** `state-machine` @ gps-worker.js:L1000-L1050(_isStationaryLast)
  - _isStationaryLastが「前frameの静止判定をcarry」する設計(Phase 1.ZUPT用)だが、worker reset時(type='reset')に_isStationaryLast=falseで初期化される。業務開始直後の1frame目で、実際は静止中でもZUPT非適用→Kalman Qが通常値→GPS noise由来driftが抑制されない→初回GPS点でcreep発生の可能性。KI-004の「業務開始時の初期化不整合」と類似。BILL-GUARD-001の「業務開始前から距離が増える」リスク。
  - 推奨対処: worker reset時に_isStationaryLast=trueで初期化(安全側=停止扱い)。または業務開始後N秒間は強制ZUPT適用。tests/でworker reset直後の1frame目GPS点でのcreep量を検証(stationary状態からのreset simulation)。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-07-19T15:49:54.786Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L92-L157",
      "description": "車別k機構(_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY)が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では_kForDelta=1.0で非作用(dormant)。KI-003(business.js全関数dead code化)と類似の「呼出されない状態」リスク。_postVehicleK(L92)がworkerへ送るが、代行autoCalibK ON時はmeter層のk乗算は完全bypass。コメントで「削除するとcert経路が壊れる」と防衛しているが、実際の呼出経路(cert/タクシー運用)の実機テストが不足していれば、KI-003同様に「定義だけ残って機能停止」状態の可能性。",
      "recommendation": "cert/タクシー経路の実機テスト(k適用確認)を追加。autoCalibK OFF時の_kForDelta適用経路(L355付近)の存在確認。knip/dependency-cruiserでcert経路のexport使用を継続監視。代行/cert/タクシーの3経路を明示的に分岐させ、各経路のテストケースを独立実装。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L355, map-matcher.js:L1168-L1190",
      "description": "business_distance_mへの加算が「running gate内」ではなく「business_active gate内」で行われている(コメントL66)。KI-004(idle中business_distance_m増加)の再発リスク。map-matcher.js L1168-L1190の_confirmedRoadDelta→pipelineDeltaMの経路で、isStationary freeze(L1168)はあるがbusiness_active gateが見当たらない。meter.js L355で`if (state.running)`内で加算しているが、business_distance_mは`if (state.business_active)`でも二重ガードすべき(KI-004修正commit cd68ecd6参照)。",
      "recommendation": "meter.js L355付近でbusiness_distance_m加算に`if (state.business_active)`の二重ガードを追加。tests/property/distance-m-update-paths.test.jsにbusiness_distance_m用のrunning+business_active二重ガード検証を追加。Semgrep ruleでbusiness_distance_m更新箇所のbusiness_active gate必須化を検出。"
    },
    {
      "severity": "high",
      "category": "distance-calculation",
      "location": "map-matcher.js:L1168-L1190",
      "description": "_confirmedRoadDelta内でpipeline-distance.jsのingestを呼び、pipelineDeltaMを算出しているが、ingest失敗/未ロード時のfallback(return 0)が「距離ゼロ」。KI-005(RegionLoader永続的undefined)と類似の「永続的に0評価でdead code化」リスク。importScripts('pipeline-distance.js')失敗時(L157 try/catch)、self.PipelineDistanceがundefinedのまま→_getPipelineTracker(L243)がnull返却→_confirmedRoadDelta(L1168)が0返却→meter.jsのstate.distance_mが永遠に増えない(=課金距離停止)。KI-005の「typeof RegionLoader !== 'undefined'ガードで永続false」と同構造。",
      "recommendation": "pipeline-distance.js未ロード時の明示的エラー通知(workerからmainへpostMessage)を追加。mainでpipelineDeltaM=0が連続する場合の警告ログ/fallback経路(既存mmIncrementM使用)を実装。importScripts失敗をCI/e2eテストで検出(404/fetch errorシミュレーション)。"
    },
    {
      "severity": "medium",
      "category": "gps-accuracy",
      "location": "gps-worker.js:L800-L850",
      "description": "accuracy天井の動的緩和(accuracy_moving_extreme_m=35m)が「移動時のみ」適用されるが、判定が`_isStationaryLast`(前frameの静止判定)に依存。KI-004の「state.running問わず加算」と類似の時間差バグリスク。静止→移動の遷移1frame目で、まだ_isStationaryLast=trueのため天井が厳格base(~10m)のまま→移動開始直後の良いfix(acc 12-17m)が棄却→距離過少。GPS-ACC-001の「停車中なのにdistance_mが増える」の逆パターン(移動中なのに距離が増えない)。",
      "recommendation": "_isStationaryLastではなく現frameのisStationary判定後にaccuracy天井を再評価。または移動開始後N秒間は天井を緩和維持するhysteresis追加。tests/property/でstationary→moving遷移時のaccuracy天井変化を検証。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L900-L950, map-matcher.js:L1168",
      "description": "加速度サンプルnull時のfallback(checkPositionStationary)が位置半径のみで判定するが、lastPositionがKalman平滑後の値。SENS-DROP-001(センサー消失でstationary判定が常時false)と類似。iOS権限拒否時、accelVariance=null→posStationary判定に退避するが、Kalman filterのlag(約40m)で位置半径が実際より大きく見え→偽moving判定→creep計上。map-matcher.js L1168のisStationary freeze条件が`msg.isStationary === true || msg.speedKmh < 2`だが、加速度null時のfallback判定精度が低いと、この条件をすり抜けてcreepが発生。",
      "recommendation": "checkPositionStationary内で生位置(lastRawPosition)を使用するよう変更。加速度null時の専用radius閾値(より厳格)を追加。tests/でiOS権限拒否シミュレーション(accelSamples=null)時のcreep量を検証。"
    },
    {
      "severity": "medium",
      "category": "sw-cache",
      "location": "meter.js:L1-L50(importScripts), map-matcher.js:L157",
      "description": "pipeline-distance.js/k-calib.jsのimportScripts失敗をtry/catchで握りつぶしているが、SW-CACHE-001(古いコード実行)と組み合わさると「古いpipeline-distance.jsが永続的にロードされ続ける」リスク。sw.jsのCACHE_NAME更新漏れ→古いpipeline-distance.jsがcacheから返却→importScripts成功(古い版)→新しい距離計算ロジックが反映されない。KI-001(unicode corruption)同様、デプロイ後も「修正したのに直っていない」状態が続く。",
      "recommendation": "pipeline-distance.js/k-calib.jsにversion文字列を埋め込み、importScripts後にversion不一致を検出してworkerからmainへ警告。sw.jsのauto-version.ymlでpipeline-distance.js/k-calib.jsもCACHE_NAME算出対象に追加。e2eテストでSW cache staleness検出(version mismatch時のfallback動作確認)。"
    },
    {
      "severity": "medium",
      "category": "billing-guard",
      "location": "meter.js:L355, map-matcher.js:L1168-L1190",
      "description": "pipelineDeltaMの加算が`if (state.running)`内(L355)だが、map-matcher.js側のisStationary freeze(L1168)が`msg.isStationary === true || msg.speedKmh < 2`。BILL-GUARD-001(課金ガード漏れ)リスク。speedKmh=2.5km/h(freeze条件外)でも実質停止の場合、pipelineDeltaM>0が返却→running=true時に加算→creep。KI-004の「全5経路にif (state.running)ガード追加」と同様の対策が、新pipelineDeltaM経路では不完全(isStationary条件が甘い)。",
      "recommendation": "map-matcher.js L1168のfreeze条件を`msg.isStationary === true || msg.speedKmh < CONFIG.speed_limit_kmh(=3)`に統一。meter.js L355でpipelineDeltaM加算前に追加ガード`if (m.isStationary) pipelineDeltaM=0`を二重保険として追加。tests/property/でspeedKmh=2-3km/h境界のcreep検証。"
    },
    {
      "severity": "low",
      "category": "dead-code",
      "location": "meter.js:L200-L250(後方互換キー)",
      "description": "tier2_pending_m/business_tier2_pending_m/gps_predictive_distance_m/offroad_distance_m等の後方互換キーが「常に0」で温存されている。KI-005(RegionLoader完全撤去で235行削除)と逆の「削除すべきだが残置」パターン。index.html/business.jsが読む可能性があるため残しているが、実際の参照が0件ならKI-002(mass deletion)の逆リスク(不要コードの永続化→将来バグ温床)。knip warnで検出されるはずだが、「warning止まり(即削除禁止)」ルールで放置されている可能性。",
      "recommendation": "index.html/business.jsでの後方互換キー参照をgrep全数調査。参照0件なら段階的削除(deprecation warning→次版で削除)。参照ありなら明示的なdeprecatedコメント追加+将来削除予定日を記載。knip warnを定期レビューし、orphan exportの削減計画を立てる。"
    },
    {
      "severity": "low",
      "category": "distance-calculation",
      "location": "map-matcher.js:L243-L280(_getPipelineTracker)",
      "description": "県別trackerのLRU eviction(DECODER_LRU_CAP=4)で、evict時にtracker.reset()を呼ばずに_pipelineTrackers.delete()のみ実行(L280)。DIST-CALC-001(累積誤差)リスク。trackerが内部で累積状態(lastSnap/累積距離等)を持つ場合、GC前にreset()で状態クリアすべき。再load時に新trackerが生成されるが、旧trackerのメモリリークやGC遅延で、一時的に2つのtrackerが同一県で並存→距離二重計上の可能性(低確率だが理論上あり得る)。",
      "recommendation": "_evictDecoderLRU内でtracker削除前にtk.reset()を呼び出し、内部状態を明示的にクリア。pipeline-distance.jsのcreateDistanceTrackerがreset()メソッドを公開しているか確認(未公開なら追加)。tests/でLRU eviction→再load時の距離累積値が正しいか検証(県跨ぎtrip simulation)。"
    },
    {
      "severity": "low",
      "category": "state-machine",
      "location": "gps-worker.js:L1000-L1050(_isStationaryLast)",
      "description": "_isStationaryLastが「前frameの静止判定をcarry」する設計(Phase 1.ZUPT用)だが、worker reset時(type='reset')に_isStationaryLast=falseで初期化される。業務開始直後の1frame目で、実際は静止中でもZUPT非適用→Kalman Qが通常値→GPS noise由来driftが抑制されない→初回GPS点でcreep発生の可能性。KI-004の「業務開始時の初期化不整合」と類似。BILL-GUARD-001の「業務開始前から距離が増える」リスク。",
      "recommendation": "worker reset時に_isStationaryLast=trueで初期化(安全側=停止扱い)。または業務開始後N秒間は強制ZUPT適用。tests/でworker reset直後の1frame目GPS点でのcreep量を検証(stationary状態からのreset simulation)。"
    }
  ],
  "summary": "10件のリスクを検出。高severity 3件(車別k機構のdead code疑惑/business_distance_m二重ガード不足/pipeline-distance未ロード時の距離停止)が最優先対応。KI-003/KI-004/KI-005の過去事例パターン(dead code化/state-machine gate漏れ/永続的undefined)が複数箇所で再現されている。特にmeter.js L355のbusiness_distance_m加算とmap-matcher.js L1168のisStationary freeze条件の不整合が、KI-004と同構造の「idle中加算」リスクを内包。pipeline-distance.js importScripts失敗時のfallbackが「距離ゼロ」で、KI-005同様の機能停止リスク。中severity 4件(accuracy天井遷移lag/加速度null時fallback精度/SW cache stale/creep freeze条件甘)は実機テスト+property testで検証必要。低severity 3件(後方互換キー放置/tracker eviction時reset漏れ/worker reset時ZUPT初期化)は将来バグ温床のため段階的改善推奨。全体として「指示されていない変更を勝手に行うことを禁止する」絶対ルール遵守のため、各リスクの修正は司さん明示指示後に分割commit+実機確認で実施すべき。"
}
```
</details>

### #18 [ai-bug-hunter] weekly report 2026-07-12 (10 risks)
（作られた日 2026-07-12 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-07-12

**Model:** claude-sonnet-4-5-20250929

**Summary:** 白紙書き直し後のmeter.js/map-matcher.js/gps-worker.jsから10個のリスクを検出。最重要は①車別k機構のdead code疑惑(cert経路以外で孤立)、②source-aware k適用の分岐不全(OBD距離過少化)、③旧5経路削除後の後方互換キー参照不整合(orphan/誤動作)。中程度リスクは④running gate内isStationaryガード欠落(停車中加算漏れ)、⑤outSnap不足時のgreedy snap退避(GPS直線混入)、⑥bypass化後のaccuracy 20-35m受理(multipath誤snap)、⑦compass null時のQ調整無効化(過少化)。低リスクは⑧SW cache更新漏れ(stale code)、⑨decoder evict時のtracker破棄(1点欠落)、⑩Unicode混入(SyntaxError)。過去事例(KI-002 mass deletion/KI-003 dead code/KI-004 idle加算/KI-005 RegionLoader欠落)と類似パターンが複数存在し、特に大規模リファクタリング(白紙書き直し)後の呼出経路不整合・後方互換性破壊・センサーfallback欠落が顕著。knip/dependency-cruiser/property test/実機trace検証による早期検出が必須。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L92-L157
  - 車別k機構(_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY)が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では_kForDelta=1.0で非作用(dormant)。KI-003(business.js全関数dead code化)と類似の「呼出されない状態」リスク。_postVehicleK(L92)がworkerへ送るが、代行距離係数>1.0時はmeter層のk乗算が実質無効化されており、タクシー/cert以外では孤立している可能性。
  - 推奨対処: knip/dependency-cruiserでexport使用状況を検証。代行経路で_activeVehicleKが実際に距離計算に影響するパスがあるか、tests/business.test.jsで外部API経路を確認。コメント「削除するとcert経路が壊れる」が真か、cert専用テストで検証すべき。
- **[high]** `state-machine` @ meter.js:L355-L360
  - _kForDelta(随伴車k適用判定)がsource-aware化されているが、pipelineDeltaSrcが'obd'以外の時は常に1.0を返す。この分岐が正しく動作しない場合、KI-004(idle中business_distance_m増加)と同様に「意図しない距離加算」が発生する。特にautoCalibK経路でpipelineDeltaSrcが誤って'gps'になると、学習Kが適用されず距離が系統的に過少化する。
  - 推奨対処: pipelineDeltaSrcの全設定箇所(map-matcher.js:L1455/_lastDeltaSrc)を検証し、OBD駆動時に必ず'obd'が返ることをproperty testで保証。source-aware k適用のテストケース(tests/property/distance-m-update-paths.test.js)を追加し、OBD/GPS各経路でkが正しく適用/非適用されることを確認。
- **[high]** `mass-deletion` @ meter.js:L200-L250
  - 旧5経路(mm commit/retro/gap fill/Off-Road/setDistance)が「この新ファイルには存在しない」と宣言されているが、後方互換キー(mm_distance_m/offroad_distance_m/gap_fill_total_m等)は0のまま温存されている。KI-002(576行mass deletion)と類似の「大量削除後の不整合」リスク。index.html/business.jsがこれらのキーを読む前提だが、実際に参照されているか不明。参照されていない場合はorphan、参照されている場合は常に0で誤動作の可能性。
  - 推奨対処: index.html/business.jsで後方互換キーの実参照箇所をgrep。参照がなければknip warnで検出し、司さん明示指示後に削除。参照がある場合は「常に0で正常動作するか」を実機テストで確認。特にbusiness_tier2_pending_mが0固定でbusiness.js集計が壊れていないか検証。
- **[medium]** `billing-guard` @ meter.js:L600-L650
  - running gateでpipelineDeltaMを加算する単一経路は存在するが、isStationaryガードが明示的に見当たらない。KI-004と同様に「停車中なのにdistance_mが増える」リスク。map-matcher.jsでisStationary時にpipelineDeltaM=0にする二重保険があるが(L1430)、meter側にもガードがないと、workerメッセージ遅延/欠落時に停車中加算が漏れる。
  - 推奨対処: meter.jsのrunning gate内(state.distance_m += pipelineDeltaM箇所)に`if (!state.last_isStationary)`ガードを追加。tests/property/distance-m-update-paths.test.jsでisStationary=true時のdistance_m不変をassert。worker側0化とmeter側ガードの二重防御で、メッセージ欠落時も安全を保証。
- **[medium]** `distance-calculation` @ map-matcher.js:L1300-L1350
  - _confirmedRoadDelta(L1300)が「確定道路読み取り」の唯一の距離源だが、outSnapがnull/不足時のfallback経路が不明瞭。pipeline-distance.jsのingest内部でsnap退避するとコメントされているが、退避先がgreedy最近傍SnapCache.snapの場合、DIST-CALC-001(GPS直線距離混入)リスク。特にViterbi窓が空(初回GPS/softReset直後)でbestEmit=nullの時、haversine直線が距離に混入する可能性。
  - 推奨対処: outSnap不足時のingest挙動をpipeline-distance.jsのコードで確認。greedy snapに退避する場合、その経路が「道路ジオメトリ準拠」を満たすか検証。満たさない場合はdeltaM=0を返すfail-safeを追加。tests/でViterbi窓空時の距離加算が0またはsanitizer経由のみであることをassert。
- **[medium]** `gps-accuracy` @ gps-worker.js:L800-L850
  - bypass化(2026-06-04)で「点を消さず全点をWorker Bに届ける」方針に変更されたが、accuracy>35m(SAGE_HUSA_R_MAX_M)の極端値のみ硬棄却し、20-35mの中程度誤差点は受理してViterbiに委ねる。GPS-ACC-001(ジャンプ/ドリフト)リスクが残存。特にiOS SafariでaccuracyがCFNetworkで詐称される場合(accuracy=3だが実際は30m)、Viterbi emissionが誤った高スコアを付け、誤snapが距離に混入する。
  - 推奨対処: Sage-Husa adaptive R(L650-L680)のinnovation RMSが実効的なaccuracy補正として機能しているか、実機traceで検証。accuracy詐称端末でR̂が正しく上昇し、Kalman Kが小さくなることを確認。Viterbi emission scoringでもaccuracyを使う場合、R̂補正後の値を使うようmap-matcher.jsに伝達する仕組みを検討。
- **[medium]** `sensor-dropout` @ gps-worker.js:L900-L950
  - 加速度サンプルnull時のfallback(checkPositionStationary)は存在するが(L1050)、compassHeading=null時のKalman Q動的調整(L558-573)が無効化される。SENS-DROP-001(センサー消失)と類似。iOS SafariでDeviceOrientationEvent取得失敗が頻発する環境で、コンパス融合Qが常にtypeCode連動値になり、方向不整合時のGPS信頼度調整が機能しない。結果、multipath時のKalman平滑が過剰になり、距離が過少化する可能性。
  - 推奨対処: compassHeading=null時のQ調整fallback(例: 方向不整合検出不能時はQ大=GPS信頼)を明示的に実装。iOS Safari環境でのcompass取得率をdlogで監視し、取得率<50%の端末では別の信頼度指標(accuracy RMS等)でQ調整する代替経路を検討。
- **[low]** `sw-cache` @ meter.js:L1-L50
  - meter.jsは白紙書き直し(2026-05-30)されたが、sw.jsのPRECACHE_FILES配列にmeter.jsが含まれているか不明。SW-CACHE-001(stale code実行)リスク。特にauto-version.ymlがmeter.jsの変更を検知してCACHE_NAMEを更新しない場合、デプロイ後も旧meter.js(5経路版)がキャッシュから実行され、新pipelineDistanceが呼ばれず距離が0のまま、という事象が起きうる。
  - 推奨対処: sw.jsのPRECACHE_FILES配列にmeter.jsが含まれることを確認。.github/workflows/auto-version.ymlがmeter.js変更時にCACHE_NAMEを更新するトリガーを持つか検証。tests/e2e/flow-standard.spec.jsで「[SW] 登録完了」後のmeter.js versionログを確認し、デプロイ後に新コードが実行されることをassert。
- **[low]** `dead-code` @ map-matcher.js:L200-L250
  - DECODER_LRU_CAP=4でdecoderをevictする際、対応するpipeline trackerも破棄する(L235)が、evict後に同一県を再loadした時のtracker再生成が「距離truthは meter側」とコメントされている。しかし、tracker破棄→再生成の間にGPS点が届いた場合、その点のdeltaMが0('first')になり、1点分の距離が欠落する。KI-005(RegionLoader欠落)と類似の「lazy load時の欠落」リスク。
  - 推奨対処: 県跨ぎ再load時の初回ingest deltaM=0が許容範囲(数m)か、実機traceで検証。許容できない場合、evict前にtrackerの内部状態(lastSnap等)をシリアライズし、再生成時に復元する仕組みを検討。または、evict対象県の最終GPS点をworker内に保持し、再load後の初回ingestで連続性を保つ。
- **[low]** `unicode-corruption` @ meter.js:L1-L1700 (全体)
  - meter.jsは白紙書き直しで新規作成されたファイルだが、KI-001(Unicode混入)リスクは常に存在。特にテンプレートリテラル`${}`が多用されており(L355/L600等)、GitHub web editor経由の編集でスマートクォート化されるとSyntaxErrorでビルド失敗。CLAUDE.mdのpush前チェック(grep data-cfemail/node --check)が実行されているか不明。
  - 推奨対処: meter.js編集時は必ずローカルeditor(VS Code)を使用し、GitHub web editor禁止を徹底。PR前に`node --check js/meter.js`と`grep -c 'data-cfemail' js/meter.js`(=0期待)を実行。CI(test.yml)でeslint --fixが全.jsファイルに適用されることを確認し、Unicode混入を自動検出。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-07-12T15:51:16.991Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L92-L157",
      "description": "車別k機構(_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY)が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では_kForDelta=1.0で非作用(dormant)。KI-003(business.js全関数dead code化)と類似の「呼出されない状態」リスク。_postVehicleK(L92)がworkerへ送るが、代行距離係数>1.0時はmeter層のk乗算が実質無効化されており、タクシー/cert以外では孤立している可能性。",
      "recommendation": "knip/dependency-cruiserでexport使用状況を検証。代行経路で_activeVehicleKが実際に距離計算に影響するパスがあるか、tests/business.test.jsで外部API経路を確認。コメント「削除するとcert経路が壊れる」が真か、cert専用テストで検証すべき。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L355-L360",
      "description": "_kForDelta(随伴車k適用判定)がsource-aware化されているが、pipelineDeltaSrcが'obd'以外の時は常に1.0を返す。この分岐が正しく動作しない場合、KI-004(idle中business_distance_m増加)と同様に「意図しない距離加算」が発生する。特にautoCalibK経路でpipelineDeltaSrcが誤って'gps'になると、学習Kが適用されず距離が系統的に過少化する。",
      "recommendation": "pipelineDeltaSrcの全設定箇所(map-matcher.js:L1455/_lastDeltaSrc)を検証し、OBD駆動時に必ず'obd'が返ることをproperty testで保証。source-aware k適用のテストケース(tests/property/distance-m-update-paths.test.js)を追加し、OBD/GPS各経路でkが正しく適用/非適用されることを確認。"
    },
    {
      "severity": "high",
      "category": "mass-deletion",
      "location": "meter.js:L200-L250",
      "description": "旧5経路(mm commit/retro/gap fill/Off-Road/setDistance)が「この新ファイルには存在しない」と宣言されているが、後方互換キー(mm_distance_m/offroad_distance_m/gap_fill_total_m等)は0のまま温存されている。KI-002(576行mass deletion)と類似の「大量削除後の不整合」リスク。index.html/business.jsがこれらのキーを読む前提だが、実際に参照されているか不明。参照されていない場合はorphan、参照されている場合は常に0で誤動作の可能性。",
      "recommendation": "index.html/business.jsで後方互換キーの実参照箇所をgrep。参照がなければknip warnで検出し、司さん明示指示後に削除。参照がある場合は「常に0で正常動作するか」を実機テストで確認。特にbusiness_tier2_pending_mが0固定でbusiness.js集計が壊れていないか検証。"
    },
    {
      "severity": "medium",
      "category": "billing-guard",
      "location": "meter.js:L600-L650",
      "description": "running gateでpipelineDeltaMを加算する単一経路は存在するが、isStationaryガードが明示的に見当たらない。KI-004と同様に「停車中なのにdistance_mが増える」リスク。map-matcher.jsでisStationary時にpipelineDeltaM=0にする二重保険があるが(L1430)、meter側にもガードがないと、workerメッセージ遅延/欠落時に停車中加算が漏れる。",
      "recommendation": "meter.jsのrunning gate内(state.distance_m += pipelineDeltaM箇所)に`if (!state.last_isStationary)`ガードを追加。tests/property/distance-m-update-paths.test.jsでisStationary=true時のdistance_m不変をassert。worker側0化とmeter側ガードの二重防御で、メッセージ欠落時も安全を保証。"
    },
    {
      "severity": "medium",
      "category": "distance-calculation",
      "location": "map-matcher.js:L1300-L1350",
      "description": "_confirmedRoadDelta(L1300)が「確定道路読み取り」の唯一の距離源だが、outSnapがnull/不足時のfallback経路が不明瞭。pipeline-distance.jsのingest内部でsnap退避するとコメントされているが、退避先がgreedy最近傍SnapCache.snapの場合、DIST-CALC-001(GPS直線距離混入)リスク。特にViterbi窓が空(初回GPS/softReset直後)でbestEmit=nullの時、haversine直線が距離に混入する可能性。",
      "recommendation": "outSnap不足時のingest挙動をpipeline-distance.jsのコードで確認。greedy snapに退避する場合、その経路が「道路ジオメトリ準拠」を満たすか検証。満たさない場合はdeltaM=0を返すfail-safeを追加。tests/でViterbi窓空時の距離加算が0またはsanitizer経由のみであることをassert。"
    },
    {
      "severity": "medium",
      "category": "gps-accuracy",
      "location": "gps-worker.js:L800-L850",
      "description": "bypass化(2026-06-04)で「点を消さず全点をWorker Bに届ける」方針に変更されたが、accuracy>35m(SAGE_HUSA_R_MAX_M)の極端値のみ硬棄却し、20-35mの中程度誤差点は受理してViterbiに委ねる。GPS-ACC-001(ジャンプ/ドリフト)リスクが残存。特にiOS SafariでaccuracyがCFNetworkで詐称される場合(accuracy=3だが実際は30m)、Viterbi emissionが誤った高スコアを付け、誤snapが距離に混入する。",
      "recommendation": "Sage-Husa adaptive R(L650-L680)のinnovation RMSが実効的なaccuracy補正として機能しているか、実機traceで検証。accuracy詐称端末でR̂が正しく上昇し、Kalman Kが小さくなることを確認。Viterbi emission scoringでもaccuracyを使う場合、R̂補正後の値を使うようmap-matcher.jsに伝達する仕組みを検討。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L900-L950",
      "description": "加速度サンプルnull時のfallback(checkPositionStationary)は存在するが(L1050)、compassHeading=null時のKalman Q動的調整(L558-573)が無効化される。SENS-DROP-001(センサー消失)と類似。iOS SafariでDeviceOrientationEvent取得失敗が頻発する環境で、コンパス融合Qが常にtypeCode連動値になり、方向不整合時のGPS信頼度調整が機能しない。結果、multipath時のKalman平滑が過剰になり、距離が過少化する可能性。",
      "recommendation": "compassHeading=null時のQ調整fallback(例: 方向不整合検出不能時はQ大=GPS信頼)を明示的に実装。iOS Safari環境でのcompass取得率をdlogで監視し、取得率<50%の端末では別の信頼度指標(accuracy RMS等)でQ調整する代替経路を検討。"
    },
    {
      "severity": "low",
      "category": "sw-cache",
      "location": "meter.js:L1-L50",
      "description": "meter.jsは白紙書き直し(2026-05-30)されたが、sw.jsのPRECACHE_FILES配列にmeter.jsが含まれているか不明。SW-CACHE-001(stale code実行)リスク。特にauto-version.ymlがmeter.jsの変更を検知してCACHE_NAMEを更新しない場合、デプロイ後も旧meter.js(5経路版)がキャッシュから実行され、新pipelineDistanceが呼ばれず距離が0のまま、という事象が起きうる。",
      "recommendation": "sw.jsのPRECACHE_FILES配列にmeter.jsが含まれることを確認。.github/workflows/auto-version.ymlがmeter.js変更時にCACHE_NAMEを更新するトリガーを持つか検証。tests/e2e/flow-standard.spec.jsで「[SW] 登録完了」後のmeter.js versionログを確認し、デプロイ後に新コードが実行されることをassert。"
    },
    {
      "severity": "low",
      "category": "dead-code",
      "location": "map-matcher.js:L200-L250",
      "description": "DECODER_LRU_CAP=4でdecoderをevictする際、対応するpipeline trackerも破棄する(L235)が、evict後に同一県を再loadした時のtracker再生成が「距離truthは meter側」とコメントされている。しかし、tracker破棄→再生成の間にGPS点が届いた場合、その点のdeltaMが0('first')になり、1点分の距離が欠落する。KI-005(RegionLoader欠落)と類似の「lazy load時の欠落」リスク。",
      "recommendation": "県跨ぎ再load時の初回ingest deltaM=0が許容範囲(数m)か、実機traceで検証。許容できない場合、evict前にtrackerの内部状態(lastSnap等)をシリアライズし、再生成時に復元する仕組みを検討。または、evict対象県の最終GPS点をworker内に保持し、再load後の初回ingestで連続性を保つ。"
    },
    {
      "severity": "low",
      "category": "unicode-corruption",
      "location": "meter.js:L1-L1700 (全体)",
      "description": "meter.jsは白紙書き直しで新規作成されたファイルだが、KI-001(Unicode混入)リスクは常に存在。特にテンプレートリテラル`${}`が多用されており(L355/L600等)、GitHub web editor経由の編集でスマートクォート化されるとSyntaxErrorでビルド失敗。CLAUDE.mdのpush前チェック(grep data-cfemail/node --check)が実行されているか不明。",
      "recommendation": "meter.js編集時は必ずローカルeditor(VS Code)を使用し、GitHub web editor禁止を徹底。PR前に`node --check js/meter.js`と`grep -c 'data-cfemail' js/meter.js`(=0期待)を実行。CI(test.yml)でeslint --fixが全.jsファイルに適用されることを確認し、Unicode混入を自動検出。"
    }
  ],
  "summary": "白紙書き直し後のmeter.js/map-matcher.js/gps-worker.jsから10個のリスクを検出。最重要は①車別k機構のdead code疑惑(cert経路以外で孤立)、②source-aware k適用の分岐不全(OBD距離過少化)、③旧5経路削除後の後方互換キー参照不整合(orphan/誤動作)。中程度リスクは④running gate内isStationaryガード欠落(停車中加算漏れ)、⑤outSnap不足時のgreedy snap退避(GPS直線混入)、⑥bypass化後のaccuracy 20-35m受理(multipath誤snap)、⑦compass null時のQ調整無効化(過少化)。低リスクは⑧SW cache更新漏れ(stale code)、⑨decoder evict時のtracker破棄(1点欠落)、⑩Unicode混入(SyntaxError)。過去事例(KI-002 mass deletion/KI-003 dead code/KI-004 idle加算/KI-005 RegionLoader欠落)と類似パターンが複数存在し、特に大規模リファクタリング(白紙書き直し)後の呼出経路不整合・後方互換性破壊・センサーfallback欠落が顕著。knip/dependency-cruiser/property test/実機trace検証による早期検出が必須。"
}
```
</details>

### #17 [ai-bug-hunter] weekly report 2026-07-05 (10 risks)
（作られた日 2026-07-05 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-07-05

**Model:** claude-sonnet-4-5-20250929

**Summary:** 10個のリスクを検出。最重要は(1)車別k機構のorphan化リスク(KI-003類似・dead code)、(2)business_distance_m加算のrunning gate欠落疑惑(KI-004類似・idle中加算)、(3)smoothedRawMode時のisStationary=true中pipelineDeltaM>0リスク(BILL-GUARD-001・停車中加算)。中程度リスクは後方互換キーのorphan化、加速度null時のfallback整合性、gap routing失敗時の二重計上/欠落、accuracy緩和と変位継続性ゲートの誤判定。低リスクはSW cache更新、MCMメッセージ未処理、Unicode混入。全て過去事例(KI-001〜005)またはバグパターン(BILL-GUARD/DIST-CALC/GPS-ACC/SENS-DROP/SW-CACHE)に該当。絶対ルール「指示されていない変更を勝手に行うことを禁止する」を遵守し、各リスクは司さん明示指示後に対処すること。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L92-L157
  - 車別k機構(_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY)が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では_kForDelta=1.0で非作用(dormant)。KI-003(business.js全関数dead code化)と類似のorphan化リスク。_postVehicleK(L92)が呼ばれる経路とcalibrateVehicleK(L1495 export)の実呼出を確認する必要がある。knip/dependency-cruiserで未使用export検出が必要。
  - 推奨対処: audit:knipで_activeVehicleK/_resolveVK/_factoryK/calibrateVehicleKの呼出経路を検証。代行モード(autoCalibK ON)でこれらの関数が本当に到達不能ならdead code削除の明示指示を待つ。タクシー/cert経路のテストケース(tests/business.test.js等)で外部API経路を維持確認。
- **[high]** `state-machine` @ meter.js:L355-L400
  - pipelineDeltaM加算経路でrunning gateが適用されているが、business_distance_m加算(L380付近)のrunning gateが明示的に見えない。KI-004(idle中business_distance_m増加)と同じ構造。state.running===falseでもbusiness_distance_m+=pipelineDeltaMが実行される可能性。コメント「business_distance_m は running=true のみ」(絶対ルール)と実装の乖離。
  - 推奨対処: L380付近のbusiness_distance_m加算に`if (state.running)`ガードを明示的に追加。KI-004修正(commit cd68ecd6)と同様の5経路全てにガード適用を確認。tests/property/distance-m-update-paths.test.jsでbusiness_distance_m経路のrunning gate検証を追加。
- **[high]** `billing-guard` @ map-matcher.js:L1800-L1850
  - _confirmedRoadDelta内でpipelineDeltaMを算出しているが、isStationary判定後の0化(L2100付近)が「smoothedRawMode補正」で条件分岐(!_pdSmoothed()時のみ0化)。平滑モード時はisStationary=trueでもpipelineDeltaM>0が返る可能性。KI-004(idle中distance_m増加)のbusiness_distance_m版リスク。BILL-GUARD-001パターン(停車中加算)に該当。
  - 推奨対処: smoothedRawMode時のcreep防止をエンジン側ZUPT+capに完全委任するなら、その動作をtests/で検証。または_pdSmoothed()分岐を削除しisStationary時は無条件で0化(二重保険)。meter.js側でもrunning gate内加算を確認。
- **[medium]** `dead-code` @ meter.js:L200-L250
  - 後方互換キー(tier2_pending_m/business_tier2_pending_m/gps_predictive_distance_m/offroad_distance_m等)が「旧5経路廃止で参照値化・0のまま温存」とあるが、index.html/business.jsが実際に読んでいるか不明。KI-003(business.js全関数dead code化)と同じorphan化リスク。これらのキーがindex.htmlで参照されていない場合、getStateの肥大化とメモリ浪費。
  - 推奨対処: index.html/business.jsでtier2_pending_m等の参照をgrep確認。参照0ならgetStateから削除(但し司さん明示指示後のみ・KI-002絶対ルール遵守)。knip warnで未使用field検出。
- **[medium]** `sensor-dropout` @ gps-worker.js:L800-L850
  - accelVariance/accelDeviation計算でaccelSamplesがnull/空配列時にnull返却。checkPositionStationaryへのfallbackは機能するが、SENS-DROP-001パターン(加速度null時の判定不能)。iOS Safari permission拒否時にisStationaryが常時false/trueに固定される可能性。KI-004の「加速度null時はGPS判定のみ」と整合するが、GPS速度を主信号にしない新設計(Fix①)との整合性要確認。
  - 推奨対処: accelSamples null時のfallback経路(checkPositionStationary)が本当にGPS速度非依存か確認。iOS permission拒否時のテストケース追加。診断ログ(_postGpsDbg)でaccel null頻度を監視。
- **[medium]** `distance-calculation` @ map-matcher.js:L1500-L1600
  - _routeDistance内でcalcRoadDistance(polyline弧長)とrouting距離を使い分けているが、routing失敗時のfallback経路が不明瞭。DIST-CALC-001パターン(直線距離混入)のリスク。gap routing(GAP_ROUTE_MAX_SEC以下)で_via!=='polyline'または_detourOk===false時にskipped=1だが、その後のmeter.js側fallback(速度×時間)との二重計上/欠落リスク。
  - 推奨対処: gap routing失敗時のskipped=1とmeter.js側fill条件(dtSec>MM_GAP_RESET_SEC && dtSec<=GAP_ROUTE_MAX_SEC && mmWorker有)の整合性を確認。tests/でgap routing失敗ケースの距離加算経路を検証。
- **[medium]** `gps-accuracy` @ gps-worker.js:L600-L700
  - accuracy上限緩和(accuracy_moving_extreme_m=35)と変位継続性ゲート(disp_window/disp_net_m)の組み合わせで、真静止時のdrift点(acc 10-17m)が「継続前進」と誤判定され受理される可能性。GPS-ACC-001パターン(停車中distance_m増加)。__rawDispBufのnet変位計算が独立ジッタ(真静止)と徐行(継続前進)を正しく区別できるか要検証。
  - 推奨対処: 真静止時の__rawDispBuf net変位が6m未満に収まることをテストで確認。disp_window=4/disp_net_m=6のパラメータ妥当性を実機検証。診断ログでnet変位とisStationaryの相関を監視。
- **[low]** `sw-cache` @ meter.js:L1-L50
  - meter.js自体にCACHE_NAME/version情報が含まれていない。SW-CACHE-001パターン(古いコード実行)のリスク。sw.jsのPRECACHE_FILESにmeter.jsが含まれていても、meter.js内部の変更がSW updateをトリガーしない可能性。auto-version.ymlがmeter.jsのハッシュをSW CACHE_NAMEに反映しているか不明。
  - 推奨対処: .github/workflows/auto-version.ymlがmeter.js変更時にsw.js CACHE_NAMEを更新することを確認。tests/e2e/flow-standard.spec.jsで「[SW] 登録完了」ログのversion表示を検証。
- **[low]** `dead-code` @ map-matcher.js:L400-L500
  - VITERBI_N_MAX/VITERBI_N_MIN/MCM latency自己監視機構が実装されているが、_viterbiShrinkLogged/mcmShrink/mcmRecoverメッセージの受信側(main)での処理が不明。これらのメッセージがindex.htmlで未処理ならdead code。KI-005(RegionLoader永続的undefined)と同じ構造。
  - 推奨対処: index.htmlでmcmShrink/mcmRecoverメッセージのハンドラ存在を確認。未処理なら診断専用として明示コメント追加。knipで未使用message type検出。
- **[low]** `encoding` @ meter.js:L1-L2000 (全体)
  - meter.jsのコメント内に日本語文字列が多数含まれる。KI-001(Unicode文字混入)のリスク。GitHub webエディタ経由の編集でスマートクォート化される可能性。特にL92-L157のコメント「★注記(2026-07・監査): 以下の車別k機構...」等の長文コメント。
  - 推奨対処: push前にgrep -c 'data-cfemail' meter.js(=0期待)とnode --check meter.jsを実行。CLAUDE.md規定のチェックを遵守。ローカルeditorからのcommit必須。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-07-05T16:03:40.716Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L92-L157",
      "description": "車別k機構(_activeVehicleK/_resolveVK/_factoryK/FACTORY_K/_clampVK/calibrateVehicleK/CERTK_SAFETY)が「デッドではない=タクシー/cert経路で生きてる」とコメントされているが、代行経路では_kForDelta=1.0で非作用(dormant)。KI-003(business.js全関数dead code化)と類似のorphan化リスク。_postVehicleK(L92)が呼ばれる経路とcalibrateVehicleK(L1495 export)の実呼出を確認する必要がある。knip/dependency-cruiserで未使用export検出が必要。",
      "recommendation": "audit:knipで_activeVehicleK/_resolveVK/_factoryK/calibrateVehicleKの呼出経路を検証。代行モード(autoCalibK ON)でこれらの関数が本当に到達不能ならdead code削除の明示指示を待つ。タクシー/cert経路のテストケース(tests/business.test.js等)で外部API経路を維持確認。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L355-L400",
      "description": "pipelineDeltaM加算経路でrunning gateが適用されているが、business_distance_m加算(L380付近)のrunning gateが明示的に見えない。KI-004(idle中business_distance_m増加)と同じ構造。state.running===falseでもbusiness_distance_m+=pipelineDeltaMが実行される可能性。コメント「business_distance_m は running=true のみ」(絶対ルール)と実装の乖離。",
      "recommendation": "L380付近のbusiness_distance_m加算に`if (state.running)`ガードを明示的に追加。KI-004修正(commit cd68ecd6)と同様の5経路全てにガード適用を確認。tests/property/distance-m-update-paths.test.jsでbusiness_distance_m経路のrunning gate検証を追加。"
    },
    {
      "severity": "high",
      "category": "billing-guard",
      "location": "map-matcher.js:L1800-L1850",
      "description": "_confirmedRoadDelta内でpipelineDeltaMを算出しているが、isStationary判定後の0化(L2100付近)が「smoothedRawMode補正」で条件分岐(!_pdSmoothed()時のみ0化)。平滑モード時はisStationary=trueでもpipelineDeltaM>0が返る可能性。KI-004(idle中distance_m増加)のbusiness_distance_m版リスク。BILL-GUARD-001パターン(停車中加算)に該当。",
      "recommendation": "smoothedRawMode時のcreep防止をエンジン側ZUPT+capに完全委任するなら、その動作をtests/で検証。または_pdSmoothed()分岐を削除しisStationary時は無条件で0化(二重保険)。meter.js側でもrunning gate内加算を確認。"
    },
    {
      "severity": "medium",
      "category": "dead-code",
      "location": "meter.js:L200-L250",
      "description": "後方互換キー(tier2_pending_m/business_tier2_pending_m/gps_predictive_distance_m/offroad_distance_m等)が「旧5経路廃止で参照値化・0のまま温存」とあるが、index.html/business.jsが実際に読んでいるか不明。KI-003(business.js全関数dead code化)と同じorphan化リスク。これらのキーがindex.htmlで参照されていない場合、getStateの肥大化とメモリ浪費。",
      "recommendation": "index.html/business.jsでtier2_pending_m等の参照をgrep確認。参照0ならgetStateから削除(但し司さん明示指示後のみ・KI-002絶対ルール遵守)。knip warnで未使用field検出。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L800-L850",
      "description": "accelVariance/accelDeviation計算でaccelSamplesがnull/空配列時にnull返却。checkPositionStationaryへのfallbackは機能するが、SENS-DROP-001パターン(加速度null時の判定不能)。iOS Safari permission拒否時にisStationaryが常時false/trueに固定される可能性。KI-004の「加速度null時はGPS判定のみ」と整合するが、GPS速度を主信号にしない新設計(Fix①)との整合性要確認。",
      "recommendation": "accelSamples null時のfallback経路(checkPositionStationary)が本当にGPS速度非依存か確認。iOS permission拒否時のテストケース追加。診断ログ(_postGpsDbg)でaccel null頻度を監視。"
    },
    {
      "severity": "medium",
      "category": "distance-calculation",
      "location": "map-matcher.js:L1500-L1600",
      "description": "_routeDistance内でcalcRoadDistance(polyline弧長)とrouting距離を使い分けているが、routing失敗時のfallback経路が不明瞭。DIST-CALC-001パターン(直線距離混入)のリスク。gap routing(GAP_ROUTE_MAX_SEC以下)で_via!=='polyline'または_detourOk===false時にskipped=1だが、その後のmeter.js側fallback(速度×時間)との二重計上/欠落リスク。",
      "recommendation": "gap routing失敗時のskipped=1とmeter.js側fill条件(dtSec>MM_GAP_RESET_SEC && dtSec<=GAP_ROUTE_MAX_SEC && mmWorker有)の整合性を確認。tests/でgap routing失敗ケースの距離加算経路を検証。"
    },
    {
      "severity": "medium",
      "category": "gps-accuracy",
      "location": "gps-worker.js:L600-L700",
      "description": "accuracy上限緩和(accuracy_moving_extreme_m=35)と変位継続性ゲート(disp_window/disp_net_m)の組み合わせで、真静止時のdrift点(acc 10-17m)が「継続前進」と誤判定され受理される可能性。GPS-ACC-001パターン(停車中distance_m増加)。__rawDispBufのnet変位計算が独立ジッタ(真静止)と徐行(継続前進)を正しく区別できるか要検証。",
      "recommendation": "真静止時の__rawDispBuf net変位が6m未満に収まることをテストで確認。disp_window=4/disp_net_m=6のパラメータ妥当性を実機検証。診断ログでnet変位とisStationaryの相関を監視。"
    },
    {
      "severity": "low",
      "category": "sw-cache",
      "location": "meter.js:L1-L50",
      "description": "meter.js自体にCACHE_NAME/version情報が含まれていない。SW-CACHE-001パターン(古いコード実行)のリスク。sw.jsのPRECACHE_FILESにmeter.jsが含まれていても、meter.js内部の変更がSW updateをトリガーしない可能性。auto-version.ymlがmeter.jsのハッシュをSW CACHE_NAMEに反映しているか不明。",
      "recommendation": ".github/workflows/auto-version.ymlがmeter.js変更時にsw.js CACHE_NAMEを更新することを確認。tests/e2e/flow-standard.spec.jsで「[SW] 登録完了」ログのversion表示を検証。"
    },
    {
      "severity": "low",
      "category": "dead-code",
      "location": "map-matcher.js:L400-L500",
      "description": "VITERBI_N_MAX/VITERBI_N_MIN/MCM latency自己監視機構が実装されているが、_viterbiShrinkLogged/mcmShrink/mcmRecoverメッセージの受信側(main)での処理が不明。これらのメッセージがindex.htmlで未処理ならdead code。KI-005(RegionLoader永続的undefined)と同じ構造。",
      "recommendation": "index.htmlでmcmShrink/mcmRecoverメッセージのハンドラ存在を確認。未処理なら診断専用として明示コメント追加。knipで未使用message type検出。"
    },
    {
      "severity": "low",
      "category": "encoding",
      "location": "meter.js:L1-L2000 (全体)",
      "description": "meter.jsのコメント内に日本語文字列が多数含まれる。KI-001(Unicode文字混入)のリスク。GitHub webエディタ経由の編集でスマートクォート化される可能性。特にL92-L157のコメント「★注記(2026-07・監査): 以下の車別k機構...」等の長文コメント。",
      "recommendation": "push前にgrep -c 'data-cfemail' meter.js(=0期待)とnode --check meter.jsを実行。CLAUDE.md規定のチェックを遵守。ローカルeditorからのcommit必須。"
    }
  ],
  "summary": "10個のリスクを検出。最重要は(1)車別k機構のorphan化リスク(KI-003類似・dead code)、(2)business_distance_m加算のrunning gate欠落疑惑(KI-004類似・idle中加算)、(3)smoothedRawMode時のisStationary=true中pipelineDeltaM>0リスク(BILL-GUARD-001・停車中加算)。中程度リスクは後方互換キーのorphan化、加速度null時のfallback整合性、gap routing失敗時の二重計上/欠落、accuracy緩和と変位継続性ゲートの誤判定。低リスクはSW cache更新、MCMメッセージ未処理、Unicode混入。全て過去事例(KI-001〜005)またはバグパターン(BILL-GUARD/DIST-CALC/GPS-ACC/SENS-DROP/SW-CACHE)に該当。絶対ルール「指示されていない変更を勝手に行うことを禁止する」を遵守し、各リスクは司さん明示指示後に対処すること。"
}
```
</details>

### #16 [ai-bug-hunter] weekly report 2026-06-28 (0 risks)
（作られた日 2026-06-28 ／ 指摘 0 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-06-28

**Model:** claude-sonnet-4-5-20250929

**Summary:** JSON parse error: Expected ',' or ']' after array element in JSON at position 6794

### Detected Risks

No risks detected (or execution failed).

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-06-28T16:07:35.555Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [],
  "summary": "JSON parse error: Expected ',' or ']' after array element in JSON at position 6794",
  "_raw": "```json\n{\n  \"risks\": [\n    {\n      \"severity\": \"high\",\n      \"category\": \"dead-code\",\n      \"location\": \"meter.js:L1-L1691\",\n      \"description\": \"★白紙書き直し (2026-05-30) で旧 5 経路 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) を全廃し、新エンジン (pipeline-distance) の単一経路 (pipelineDeltaM) に一本化したと宣言しているが、実際には旧経路の関数定義・変数・ロジックが大量に残存している可能性がある。KI-003 (business.js 全関数 dead code 化) と同じパターン: リファクタリング時に呼出側を削除したが定義側が orphan として残り、後で「実は使われていた」ことが判明するリスク。特に `_trackHaversineBetweenGps` / `_calculateOffRoadIncrement` / `calculateGapFill` 等の helper 関数が「13 orphan helper」として言及されているが、コード本体には grep 可能な形で残っている可能性が高い。\",\n      \"recommendation\": \"1. `npm run audit:knip` で未使用 export を検出し、旧 5 経路の関数が本当に呼出 0 件か確認する。2. grep で `_trackHaversineBetweenGps` / `_calculateOffRoadIncrement` / `calculateGapFill` の呼出箇所を全検索し、残存経路がないか確認する。3. 旧経路が完全に不要なら KI-003 の教訓に従い「定義削除と呼出削除を同 commit で実施」し、段階的削除を避ける。4. tests/property/distance-m-update-paths.test.js C1 で「5 経路のみ verify」と書かれているが、新アーキでは「1 経路 (pipelineDeltaM) "
}
```
</details>

### #15 [ai-bug-hunter] weekly report 2026-06-21 (0 risks)
（作られた日 2026-06-21 ／ 指摘 0 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-06-21

**Model:** claude-sonnet-4-5-20250929

**Summary:** JSON parse error: Expected ',' or ']' after array element in JSON at position 7491

### Detected Risks

No risks detected (or execution failed).

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-06-21T16:29:29.594Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [],
  "summary": "JSON parse error: Expected ',' or ']' after array element in JSON at position 7491",
  "_raw": "```json\n{\n  \"risks\": [\n    {\n      \"severity\": \"high\",\n      \"category\": \"dead-code\",\n      \"location\": \"meter.js:L1-L1691\",\n      \"description\": \"★白紙書き直し (2026-05-30) で旧 5 経路集計 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) を全廃し、新エンジン (pipeline-distance) の単一経路 (state.distance_m += pipelineDeltaM) に一本化したと宣言しているが、実際には setDistance (L1691 相当) が「復元用」として残存している。KI-003 (business.js 全関数 dead code 化) と同様に、呼出側 (index.html / business.js) が setDistance を呼んでいるか grep で確認されていない可能性がある。setDistance が orphan 化していれば復元機能が停止し、タスクキル後の distance_m 復元が不能になる。\",\n      \"recommendation\": \"setDistance の呼出箇所を index.html / business.js で grep 確認し、実際に使われているか検証する。使われていなければ KI-003 と同じ「業務単位処理機能停止」が発生する。knip / dependency-cruiser で未使用 export を検出し、テストで復元経路を維持確認する。\"\n    },\n    {\n      \"severity\": \"high\",\n      \"category\": \"state-machine\",\n      \"location\": \"meter.js:L551 / L661 / L1168 / L1190\",\n      \"description\": \"コメントで「distance_m 加算は running gate 内の state.distance_m += pipelineDeltaM の ★1 経路のみ"
}
```
</details>

### #13 [ai-bug-hunter] weekly report 2026-06-14 (0 risks)
（作られた日 2026-06-14 ／ 指摘 0 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-06-14

**Model:** claude-sonnet-4-5-20250929

**Summary:** JSON parse error: Expected ',' or ']' after array element in JSON at position 7612

### Detected Risks

No risks detected (or execution failed).

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-06-14T16:21:11.051Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [],
  "summary": "JSON parse error: Expected ',' or ']' after array element in JSON at position 7612",
  "_raw": "```json\n{\n  \"risks\": [\n    {\n      \"severity\": \"high\",\n      \"category\": \"dead-code\",\n      \"location\": \"meter.js:L30-L40 + map-matcher.js:L1-L50\",\n      \"description\": \"★白紙書き直し後の orphan 関数リスク★: meter.js は「旧 5 経路集計 / 13 orphan helper / Viterbi mmIncrementM 集計 / tier2 preview 二重回路 / α-β filter は存在しない」と宣言するが、map-matcher.js は依然として mmIncrementM / tentativeIncrementM / tentativeDistanceM を算出・送信している (L1800-1850)。meter.js 側でこれらを受信・参照する経路が knip で orphan 判定される可能性 (= KI-003 business.js 全関数 dead code 化の再発パターン)。特に tentativeIncrementM は「commit を待たない preview」として設計されているが、新 meter.js が state.tier2_pending_m を常に 0 温存 (L95) しているため、Worker B が送信しても main 側で使われない = 576 行 mass deletion の前兆。\",\n      \"recommendation\": \"audit:knip で mmIncrementM / tentativeIncrementM / tentativeDistanceM の参照経路を検証。meter.js の getState / update で実際に使用されているか grep 確認。使用されていなければ map-matcher.js の算出ロジックごと削除 (= 指示外変更禁止ルールに従い司さん明示指示後のみ)。\"\n    },\n    {\n      \"severity\": \"high\",\n      \"category\": \"distance-calculation\",\n      \"location\": \"m"
}
```
</details>

### #12 [ai-bug-hunter] weekly report 2026-06-07 (10 risks)
（作られた日 2026-06-07 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-06-07

**Model:** claude-sonnet-4-5-20250929

**Summary:** 白紙書き直し (clean-rebuild-pipeline) により距離駆動が単一経路 (pipelineDeltaM) に統合されたが、(1) pipeline-distance.js の importScripts 失敗時の fallback 不在、(2) Worker B reset の race condition、(3) 後方互換キーの orphan 化リスク、(4) GAP_ROUTE_MAX_SEC と GAP_FILL_MAX_SEC の同期不整合、(5) isStationary 誤分類による accuracy 天井の過剰厳格化、(6) accel 不能時の fallback が旧ロジック (GPS 速度依存) のまま、(7) business_active の外部依存による機能停止リスク、(8) sw.js cache 更新の言及なし、(9) _offRoadGraceUntil の orphan 変数、(10) _smoothDisplay の step 計算無駄、が検出された。特に (1)(2)(4) は課金停止 or 二重計上の致命的リスクであり、KI-003 (dead code 化) / KI-004 (idle 中加算) / KI-005 (RegionLoader 欠落) と同様のパターンが再現されている。絶対ルール「指示されていない変更を勝手に行うことを禁止する」に照らすと、白紙書き直しは司さん明示指示の範囲内だが、fallback 経路の削除や外部依存の導入は「横展開」に該当する可能性がある。実機テスト + knip warn + dependency-cruiser で早期検出が必須。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L1-L1691
  - ★白紙書き直し★により旧 meter.js の距離 5 経路集計 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) が全廃され、新 meter.js は state.distance_m += pipelineDeltaM の単一経路のみ。しかし後方互換キー (mm_distance_m / offroad_distance_m / gap_fill_total_m 等) を 0 のまま温存している。KI-005 (RegionLoader 永続的 undefined・Tier 3 dead code 化) と同様に、将来の開発者が「これらのキーが何か」分からなくなる読解負荷が発生し、新規バグの温床となる。特に index.html / business.js が読む前提のため削除できず orphan 化リスクが高い。
  - 推奨対処: 後方互換キーに ★設計変更宣言★ として「旧 5 経路廃止・常に 0・index.html が読む」を明記する comment を追加。knip warn で継続監視し、index.html / business.js の参照箇所を特定して将来の削除計画を立てる。
- **[high]** `distance-calculation` @ map-matcher.js:L1800-L1850 (_confirmedRoadDelta)
  - 新距離エンジン (pipeline-distance.js) の importScripts 失敗時、self.PipelineDistance が undefined のまま _getPipelineTracker が null を返し、_confirmedRoadDelta が 0 を返す。この時 mmResult.pipelineDeltaM=0 が main に送られ、meter.js は state.distance_m += 0 で距離が増えない (= 課金停止)。try/catch で握りつぶしているため main 側は「Worker B が生きている」と誤認し、既存 Viterbi mmIncrementM 経路も並行稼働しているが main が pipelineDeltaM を優先採用すると距離が 0 のまま。KI-003 (business.js 全関数 dead code 化) と同様の「呼出側は生きているが実装が no-op」状態で、実機テストまで発覚しない。
  - 推奨対処: importScripts('pipeline-distance.js') 失敗時に self.postMessage({ type: 'pipelineLoadError', error }) で main に通知し、meter.js 側で fallback 経路 (既存 Viterbi mmIncrementM) に切替える。または Worker B 起動時に PipelineDistance の存在を確認し、未定義なら roadsLoaded で error を返す。
- **[high]** `state-machine` @ meter.js:L200-L250 (start 関数)
  - Meter.start() は mmWorker に 'reset' を ASYNC で送るが、直前 commit が queue に残り start 完了直後の tick で届く race を MM_DRAIN_AFTER_START_MS=500ms の drain window で回避している。しかし _drainMmUntil の設定は start() 内で Date.now() + 500 だが、Worker B の 'reset' message 処理完了タイミングは不定 (Worker の event loop 次第)。Worker B が reset を処理する前に GPS が届くと、旧 business の残骸が pipelineDeltaM に混入し「代行開始直後に 0.17km」が発生する可能性がある。KI-004 (idle 中 business_distance_m 増加) と同様の「state 遷移タイミングの race」。
  - 推奨対処: Worker B の 'reset' message handler で self.postMessage({ type: 'resetAck' }) を返し、main 側で resetAck を受信するまで _drainMmUntil を延長する。または start() で mmWorker.postMessage('reset') 後に Promise で resetAck を await してから state.running=true にする。
- **[medium]** `gps-accuracy` @ gps-worker.js:L800-L850 (processPosition の accuracy 天井)
  - ★Fix② (2026-05-28) で移動時 accuracy 上限を accuracy_moving_extreme_m=35m に緩和したが、静止時は base (10m 程度) のまま厳格。しかし isStationary 判定は accel variance 主体 (Fix①) で GPS 速度を主信号にしないため、低速徐行 (1-2 km/h) が accel variance 小で isStationary=true に誤分類されると accuracy 上限が厳格になり、屋内の acc 10-17m の実走行点が棄却される (SE t2 -0.98% 実測)。KI-004 と同様の「静止判定の誤分類による距離過少」。監査 wf_1cd1ef59 で disp_window/disp_net_m による継続性ゲートを追加したが、これは accuracy 緩和の判定のみで isStationary 自体は修正していない。
  - 推奨対処: isStationary 判定に「継続前進」条件を追加し、disp_net_m > 6m なら accel variance が小でも isStationary=false にする。または accuracy 緩和を isStationary ではなく「直近 N 秒の正味変位」で判定し、静止/徐行の二値ではなく連続的に緩和する。
- **[medium]** `sensor-dropout` @ gps-worker.js:L600-L650 (calcAccelVariance / calcAccelMagnitudeDeviation)
  - 加速度サンプル null 時の fallback は checkPositionStationary (位置半径のみ) だが、iOS Safari で permission 拒否されると accelSamples が永続的に null になり、静止判定が GPS 位置半径のみに依存する。この時 GPS drift (3m radius 超) で isStationary=false になり、空車中も distance_m が増える。KI-004 (idle 中 business_distance_m 増加) と同パターン。Fix① (2026-05-28) で accel 主体に変更したが、accel 不能時の fallback が旧ロジック (GPS 速度依存) のまま。
  - 推奨対処: accel 不能時の fallback を「GPS 速度 < 2 km/h かつ 位置半径 < 3m」の AND 条件にし、drift だけで isStationary=false にならないようにする。または accel permission 拒否時に main 側で警告を出し、運転手に permission 付与を促す。
- **[medium]** `distance-calculation` @ map-matcher.js:L1500-L1600 (GAP_ROUTE_MAX_SEC と meter.js の同期)
  - Phase2-a (2026-05-27) で gap 道路 routing 上限 GAP_ROUTE_MAX_SEC=60s を導入したが、comment に「★meter.js の同名定数と必ず一致させること★」とある。しかし meter.js 側の GAP_FILL_MAX_SEC=120 と値が異なる (60 vs 120)。Worker B は dtSec > 60s で skip し、meter.js は dtSec <= 120s で gap fill を試みるため、60-120s の gap で Worker B が skip しても meter.js が速度×時間で補完する設計だが、comment の「一致」と実装が矛盾している。将来の変更時に片方だけ変えると二重計上 or 欠落が発生する。
  - 推奨対処: GAP_ROUTE_MAX_SEC と GAP_FILL_MAX_SEC の関係を明示する comment を追加 (「Worker B は 60s まで routing・meter.js は 120s まで速度補完・60-120s は meter.js のみ」)。または両方を同じ定数にして二重計上を完全回避する。
- **[medium]** `billing-guard` @ meter.js:L400-L450 (update 関数の running gate)
  - update 関数内で state.running gate 内で state.distance_m += pipelineDeltaM を実行しているが、business_distance_m は business_active gate で加算している。business_active は Business.start/end で外部設定されるため、Meter.start() と Business.start() の呼出順序が逆転すると business_active=false のまま代行が開始され、business_distance_m が増えない。KI-003 (business.js 全関数 dead code 化) と同様の「外部依存による機能停止」。
  - 推奨対処: Meter.start() 内で business_active の状態を確認し、false なら warning を出す。または Business.start() を Meter.start() の前に必ず呼ぶ順序を index.html で強制する (comment で明記)。
- **[low]** `dead-code` @ meter.js:L100-L150 (_offRoadGraceUntil / OFFROAD_GRACE_AFTER_START_MS)
  - comment に「旧 Off-Road grace period の escape hatch 用 (= テスト互換・新距離では未使用だが API 維持)」とあるが、_offRoadGraceUntil は _setOffRoadGraceUntil (テスト用 escape hatch) でしか設定されず、本番コードでは参照されていない。KI-005 (RegionLoader 永続的 undefined) と同様の orphan 変数。knip warn で検出される可能性が高い。
  - 推奨対処: _offRoadGraceUntil を削除するか、テスト専用であることを明示する comment を追加。または将来の Off-Road 復活に備えて残すなら「Phase X で再導入予定」と明記する。
- **[low]** `sw-cache` @ 全体 (sw.js への言及なし)
  - meter.js / map-matcher.js / gps-worker.js の白紙書き直しにより、ファイル名は同じだが内容が大幅変更されている。しかし sw.js の CACHE_NAME 更新や precache リストの変更に関する言及がない。KI-001 (Service Worker cache 破壊・古いコード実行) と同様に、デプロイ後も旧コードが実行され続ける可能性がある。特に Worker B (map-matcher.js) は importScripts で読み込まれるため、sw.js の precache に含まれていないと 404 になる。
  - 推奨対処: 白紙書き直し後の初回デプロイ時に sw.js の CACHE_NAME を手動更新し、precache リストに pipeline-distance.js を追加する。または .github/workflows/auto-version.yml で commit SHA ベースの自動更新を確認する。
- **[low]** `distance-calculation` @ map-matcher.js:L1900-L2000 (_smoothDisplay の overshoot ゼロ保証)
  - meter.js の _smoothDisplay 関数は「★overshoot ゼロ★: display ≤ target (overshoot ゼロ) かつ 単調非減少」を保証しているが、実装は next > tgt なら next = tgt で clamp している。しかし dtFrame が極端に大きい (タブ復帰で数秒) 場合、step = eff * dtFrame が gap を超えて next > tgt になる可能性がある。DISP_MAX_FRAME_DT_S=0.4s で dtFrame を clamp しているが、この clamp 後も step > gap なら next = display + step > tgt になる。最終的に next = tgt で clamp されるため overshoot は起きないが、step 計算が無駄になる。
  - 推奨対処: step = Math.min(eff * dtFrame, gap) で step を gap で clamp し、next = display + step が必ず tgt 以下になるようにする。または dtFrame clamp を先に行い、step 計算前に gap との比較を入れる。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-06-07T16:10:32.140Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L1-L1691",
      "description": "★白紙書き直し★により旧 meter.js の距離 5 経路集計 (mm commit / retro Off-Road / gap fill / Off-Road incremental / setDistance) が全廃され、新 meter.js は state.distance_m += pipelineDeltaM の単一経路のみ。しかし後方互換キー (mm_distance_m / offroad_distance_m / gap_fill_total_m 等) を 0 のまま温存している。KI-005 (RegionLoader 永続的 undefined・Tier 3 dead code 化) と同様に、将来の開発者が「これらのキーが何か」分からなくなる読解負荷が発生し、新規バグの温床となる。特に index.html / business.js が読む前提のため削除できず orphan 化リスクが高い。",
      "recommendation": "後方互換キーに ★設計変更宣言★ として「旧 5 経路廃止・常に 0・index.html が読む」を明記する comment を追加。knip warn で継続監視し、index.html / business.js の参照箇所を特定して将来の削除計画を立てる。"
    },
    {
      "severity": "high",
      "category": "distance-calculation",
      "location": "map-matcher.js:L1800-L1850 (_confirmedRoadDelta)",
      "description": "新距離エンジン (pipeline-distance.js) の importScripts 失敗時、self.PipelineDistance が undefined のまま _getPipelineTracker が null を返し、_confirmedRoadDelta が 0 を返す。この時 mmResult.pipelineDeltaM=0 が main に送られ、meter.js は state.distance_m += 0 で距離が増えない (= 課金停止)。try/catch で握りつぶしているため main 側は「Worker B が生きている」と誤認し、既存 Viterbi mmIncrementM 経路も並行稼働しているが main が pipelineDeltaM を優先採用すると距離が 0 のまま。KI-003 (business.js 全関数 dead code 化) と同様の「呼出側は生きているが実装が no-op」状態で、実機テストまで発覚しない。",
      "recommendation": "importScripts('pipeline-distance.js') 失敗時に self.postMessage({ type: 'pipelineLoadError', error }) で main に通知し、meter.js 側で fallback 経路 (既存 Viterbi mmIncrementM) に切替える。または Worker B 起動時に PipelineDistance の存在を確認し、未定義なら roadsLoaded で error を返す。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L200-L250 (start 関数)",
      "description": "Meter.start() は mmWorker に 'reset' を ASYNC で送るが、直前 commit が queue に残り start 完了直後の tick で届く race を MM_DRAIN_AFTER_START_MS=500ms の drain window で回避している。しかし _drainMmUntil の設定は start() 内で Date.now() + 500 だが、Worker B の 'reset' message 処理完了タイミングは不定 (Worker の event loop 次第)。Worker B が reset を処理する前に GPS が届くと、旧 business の残骸が pipelineDeltaM に混入し「代行開始直後に 0.17km」が発生する可能性がある。KI-004 (idle 中 business_distance_m 増加) と同様の「state 遷移タイミングの race」。",
      "recommendation": "Worker B の 'reset' message handler で self.postMessage({ type: 'resetAck' }) を返し、main 側で resetAck を受信するまで _drainMmUntil を延長する。または start() で mmWorker.postMessage('reset') 後に Promise で resetAck を await してから state.running=true にする。"
    },
    {
      "severity": "medium",
      "category": "gps-accuracy",
      "location": "gps-worker.js:L800-L850 (processPosition の accuracy 天井)",
      "description": "★Fix② (2026-05-28) で移動時 accuracy 上限を accuracy_moving_extreme_m=35m に緩和したが、静止時は base (10m 程度) のまま厳格。しかし isStationary 判定は accel variance 主体 (Fix①) で GPS 速度を主信号にしないため、低速徐行 (1-2 km/h) が accel variance 小で isStationary=true に誤分類されると accuracy 上限が厳格になり、屋内の acc 10-17m の実走行点が棄却される (SE t2 -0.98% 実測)。KI-004 と同様の「静止判定の誤分類による距離過少」。監査 wf_1cd1ef59 で disp_window/disp_net_m による継続性ゲートを追加したが、これは accuracy 緩和の判定のみで isStationary 自体は修正していない。",
      "recommendation": "isStationary 判定に「継続前進」条件を追加し、disp_net_m > 6m なら accel variance が小でも isStationary=false にする。または accuracy 緩和を isStationary ではなく「直近 N 秒の正味変位」で判定し、静止/徐行の二値ではなく連続的に緩和する。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L600-L650 (calcAccelVariance / calcAccelMagnitudeDeviation)",
      "description": "加速度サンプル null 時の fallback は checkPositionStationary (位置半径のみ) だが、iOS Safari で permission 拒否されると accelSamples が永続的に null になり、静止判定が GPS 位置半径のみに依存する。この時 GPS drift (3m radius 超) で isStationary=false になり、空車中も distance_m が増える。KI-004 (idle 中 business_distance_m 増加) と同パターン。Fix① (2026-05-28) で accel 主体に変更したが、accel 不能時の fallback が旧ロジック (GPS 速度依存) のまま。",
      "recommendation": "accel 不能時の fallback を「GPS 速度 < 2 km/h かつ 位置半径 < 3m」の AND 条件にし、drift だけで isStationary=false にならないようにする。または accel permission 拒否時に main 側で警告を出し、運転手に permission 付与を促す。"
    },
    {
      "severity": "medium",
      "category": "distance-calculation",
      "location": "map-matcher.js:L1500-L1600 (GAP_ROUTE_MAX_SEC と meter.js の同期)",
      "description": "Phase2-a (2026-05-27) で gap 道路 routing 上限 GAP_ROUTE_MAX_SEC=60s を導入したが、comment に「★meter.js の同名定数と必ず一致させること★」とある。しかし meter.js 側の GAP_FILL_MAX_SEC=120 と値が異なる (60 vs 120)。Worker B は dtSec > 60s で skip し、meter.js は dtSec <= 120s で gap fill を試みるため、60-120s の gap で Worker B が skip しても meter.js が速度×時間で補完する設計だが、comment の「一致」と実装が矛盾している。将来の変更時に片方だけ変えると二重計上 or 欠落が発生する。",
      "recommendation": "GAP_ROUTE_MAX_SEC と GAP_FILL_MAX_SEC の関係を明示する comment を追加 (「Worker B は 60s まで routing・meter.js は 120s まで速度補完・60-120s は meter.js のみ」)。または両方を同じ定数にして二重計上を完全回避する。"
    },
    {
      "severity": "medium",
      "category": "billing-guard",
      "location": "meter.js:L400-L450 (update 関数の running gate)",
      "description": "update 関数内で state.running gate 内で state.distance_m += pipelineDeltaM を実行しているが、business_distance_m は business_active gate で加算している。business_active は Business.start/end で外部設定されるため、Meter.start() と Business.start() の呼出順序が逆転すると business_active=false のまま代行が開始され、business_distance_m が増えない。KI-003 (business.js 全関数 dead code 化) と同様の「外部依存による機能停止」。",
      "recommendation": "Meter.start() 内で business_active の状態を確認し、false なら warning を出す。または Business.start() を Meter.start() の前に必ず呼ぶ順序を index.html で強制する (comment で明記)。"
    },
    {
      "severity": "low",
      "category": "dead-code",
      "location": "meter.js:L100-L150 (_offRoadGraceUntil / OFFROAD_GRACE_AFTER_START_MS)",
      "description": "comment に「旧 Off-Road grace period の escape hatch 用 (= テスト互換・新距離では未使用だが API 維持)」とあるが、_offRoadGraceUntil は _setOffRoadGraceUntil (テスト用 escape hatch) でしか設定されず、本番コードでは参照されていない。KI-005 (RegionLoader 永続的 undefined) と同様の orphan 変数。knip warn で検出される可能性が高い。",
      "recommendation": "_offRoadGraceUntil を削除するか、テスト専用であることを明示する comment を追加。または将来の Off-Road 復活に備えて残すなら「Phase X で再導入予定」と明記する。"
    },
    {
      "severity": "low",
      "category": "sw-cache",
      "location": "全体 (sw.js への言及なし)",
      "description": "meter.js / map-matcher.js / gps-worker.js の白紙書き直しにより、ファイル名は同じだが内容が大幅変更されている。しかし sw.js の CACHE_NAME 更新や precache リストの変更に関する言及がない。KI-001 (Service Worker cache 破壊・古いコード実行) と同様に、デプロイ後も旧コードが実行され続ける可能性がある。特に Worker B (map-matcher.js) は importScripts で読み込まれるため、sw.js の precache に含まれていないと 404 になる。",
      "recommendation": "白紙書き直し後の初回デプロイ時に sw.js の CACHE_NAME を手動更新し、precache リストに pipeline-distance.js を追加する。または .github/workflows/auto-version.yml で commit SHA ベースの自動更新を確認する。"
    },
    {
      "severity": "low",
      "category": "distance-calculation",
      "location": "map-matcher.js:L1900-L2000 (_smoothDisplay の overshoot ゼロ保証)",
      "description": "meter.js の _smoothDisplay 関数は「★overshoot ゼロ★: display ≤ target (overshoot ゼロ) かつ 単調非減少」を保証しているが、実装は next > tgt なら next = tgt で clamp している。しかし dtFrame が極端に大きい (タブ復帰で数秒) 場合、step = eff * dtFrame が gap を超えて next > tgt になる可能性がある。DISP_MAX_FRAME_DT_S=0.4s で dtFrame を clamp しているが、この clamp 後も step > gap なら next = display + step > tgt になる。最終的に next = tgt で clamp されるため overshoot は起きないが、step 計算が無駄になる。",
      "recommendation": "step = Math.min(eff * dtFrame, gap) で step を gap で clamp し、next = display + step が必ず tgt 以下になるようにする。または dtFrame clamp を先に行い、step 計算前に gap との比較を入れる。"
    }
  ],
  "summary": "白紙書き直し (clean-rebuild-pipeline) により距離駆動が単一経路 (pipelineDeltaM) に統合されたが、(1) pipeline-distance.js の importScripts 失敗時の fallback 不在、(2) Worker B reset の race condition、(3) 後方互換キーの orphan 化リスク、(4) GAP_ROUTE_MAX_SEC と GAP_FILL_MAX_SEC の同期不整合、(5) isStationary 誤分類による accuracy 天井の過剰厳格化、(6) accel 不能時の fallback が旧ロジック (GPS 速度依存) のまま、(7) business_active の外部依存による機能停止リスク、(8) sw.js cache 更新の言及なし、(9) _offRoadGraceUntil の orphan 変数、(10) _smoothDisplay の step 計算無駄、が検出された。特に (1)(2)(4) は課金停止 or 二重計上の致命的リスクであり、KI-003 (dead code 化) / KI-004 (idle 中加算) / KI-005 (RegionLoader 欠落) と同様のパターンが再現されている。絶対ルール「指示されていない変更を勝手に行うことを禁止する」に照らすと、白紙書き直しは司さん明示指示の範囲内だが、fallback 経路の削除や外部依存の導入は「横展開」に該当する可能性がある。実機テスト + knip warn + dependency-cruiser で早期検出が必須。"
}
```
</details>

### #11 [ai-bug-hunter] weekly report 2026-05-31 (0 risks)
（作られた日 2026-05-31 ／ 指摘 0 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-05-31

**Model:** claude-sonnet-4-5-20250929

**Summary:** JSON parse error: Expected ',' or ']' after array element in JSON at position 7308

### Detected Risks

No risks detected (or execution failed).

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-05-31T16:04:14.241Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [],
  "summary": "JSON parse error: Expected ',' or ']' after array element in JSON at position 7308",
  "_raw": "```json\n{\n  \"risks\": [\n    {\n      \"severity\": \"high\",\n      \"category\": \"dead-code\",\n      \"location\": \"meter.js:L1-L1691\",\n      \"description\": \"★白紙書き直し後の meter.js が「旧 5 経路集計 / 13 orphan helper / Viterbi mmIncrementM 集計 / tier2 preview 二重回路 / α-β filter は存在しない」と宣言しているが、実際には mmIncrementM / tentativeIncrementM / tentativeDistanceM を受信・処理する経路が残存 (L1-1691 全体)。KI-003 (business.js 全関数 dead code 化) と同じ「リファクタリング時の呼出側削除で orphan 化」リスク。新 pipelineDeltaM 経路と旧 mmIncrementM 経路が並存し、どちらが distance_m を駆動するか不明瞭。\",\n      \"recommendation\": \"旧 mmIncrementM 経路が本当に dead code なら knip で検出されるはず。実際に使われているなら「存在しない」宣言が虚偽。meter.js の公開メソッド signature (L1-30 プロパティ) と実装の整合性を tests/business.test.js で外部 API 経路維持確認。旧経路が live なら comment 修正、dead なら削除 (但し司さん明示指示後のみ・KI-002 絶対ルール)。\"\n    },\n    {\n      \"severity\": \"high\",\n      \"category\": \"distance-calculation\",\n      \"location\": \"map-matcher.js:L1800-L1850 (推定・_confirmedRoadDelta)\",\n      \"description\": \"★L1 配線 (2026-05-31) で「距離源を Viterbi 確定経路 (outSnap = bestEmit) へ一本化」と宣言してい"
}
```
</details>

### #7 [ai-bug-hunter] weekly report 2026-05-24 (10 risks)
（作られた日 2026-05-24 ／ 指摘 10 件）

## 🤖 AI Bug Hunter — Weekly Report

**Date:** 2026-05-24

**Model:** claude-sonnet-4-5-20250929

**Summary:** 10 件のリスクを検出。高 severity 3 件: ① Off-Road Mode の dead accumulation (KI-005 類似)、② business_distance_m の複数経路更新 (KI-004 類似)、③ tentativeIncrementM の haversine fallback 混入 (DIST-CALC-001 潜在違反)。中 severity 4 件: ④ 巨大ファイルの SW cache リスク (KI-001 類似)、⑤ Worker B の isStationary ガード単一化、⑥ compass null 時の fallback 不明瞭 (SENS-DROP-001)、⑦ accuracy ガード漏れ (GPS-ACC-001)。低 severity 3 件: ⑧ tentativeIncrementM 初回 step の挙動不明瞭、⑨ Worker A/B 間の isStationary 同期遅延、⑩ tentativeIncrementM 物理上限の環境依存。全体として「複数経路で同じ state を更新」「fallback 経路の暗黙的挙動」「Worker 間の状態同期」が主要リスク。過去事例 (KI-004 / KI-005 / DIST-CALC-001) と類似のパターンが多く、既存の防止策 (ガード追加 / 経路単一化 / 明示的コメント) を適用可能。

### Detected Risks

- **[high]** `dead-code` @ meter.js:L257-L305
  - Phase 1.C Off-Road Mode の _trackHaversineBetweenGps / _calculateOffRoadIncrement が GPS 直線距離 (haversine) を累積する経路だが、Off-Road 起動条件 (snap miss 5 連続) が Worker B の commit 遅延や grace period (5秒) で発火しにくい設計。結果として _haverAccumSinceLastCommit が永続的に蓄積されるが使われない (= dead accumulation) リスク。KI-005 RegionLoader 欠落と類似の「条件分岐が永遠に false 評価で経路が dead」パターン。
  - 推奨対処: Off-Road 起動頻度を実機ログで検証し、grace period 後も snap miss 5 連続が実際に発生するか確認。発生しない場合は _haverAccumSinceLastCommit 累積経路を削除 (= KI-005 と同じ dead code 削除手順)。または Off-Road 起動条件を緩和 (snap miss 3 連続等) して経路を活性化。
- **[high]** `state-machine` @ meter.js:L934 / map-matcher.js:L2890
  - business_distance_m の加算経路が 2 箇所に分散: ① meter.js L934 (haversine 連続点 ZUPT ガード) ② map-matcher.js L2890 (Worker B mmIncrement 経路)。KI-004 idle 中 business_distance_m 増加事象と類似の「複数経路で同じ state を更新」設計。Worker B が isStationary=true でも mmIncrement>0 を返す場合 (例: Viterbi flush 時の残骸 commit) に ② 経路で加算され、① の ZUPT ガードが無効化される。
  - 推奨対処: business_distance_m 加算経路を単一化: Worker B 側で isStationary 判定を受け取り mmIncrement / tentativeIncrement を 0 化する現行設計 (L2890) を維持し、meter.js L934 の haversine 経路を削除。または ① ② 両経路で isStationary ガードを二重適用 (defense in depth) し、どちらか一方が漏れても停車中加算ゼロを保証。
- **[high]** `distance-calculation` @ meter.js:L1172 / map-matcher.js:L1650
  - Tier 2 リードインジケータ (tentativeIncrementM) の算出経路が Worker B 内の _routeDistance (= dec.calcRoadDistance) を使用。_routeDistance は tile Dijkstra / backbone / OSRM / haversine の 4 段 fallback だが、最終 fallback の haversine (GPS 直線距離) が tier2_pending_m に混入すると「GPS 直線距離での課金は禁止」絶対ルールに抵触。現状は tier2_pending_m が表示専用で distance_m には影響しないが、将来の機能拡張 (例: tier2 を課金に昇格) で課金経路に混入するリスク。DIST-CALC-001 パターンの潜在的違反。
  - 推奨対処: _routeDistance の haversine fallback を tentativeIncrementM 算出時のみ無効化: _routeDistance に引数 allowHaversineFallback=false を追加し、tentativeIncrementM 経路では haversine 失敗時に 0 を返す。または tentativeIncrementM を完全に別関数 (_routeDistanceStrictRoadOnly) で実装し、haversine 経路を含まない設計に分離。
- **[medium]** `sw-cache` @ meter.js:L1-L2890 / map-matcher.js:L1-L2890
  - meter.js / map-matcher.js の両ファイルが 2800+ 行の巨大ファイルで、Service Worker の PRECACHE 対象。KI-001 SW-CACHE-001 パターンの「CACHE_NAME 更新漏れで古いコード実行」リスクが高い。auto-version.yml で commit SHA 自動更新されているが、ファイルサイズが大きいため iOS Safari の cache 戦略で stale code が残りやすい (= 修正が reach しない)。
  - 推奨対処: meter.js を機能別に分割 (例: meter-core.js / meter-offroad.js / meter-tier2.js) し、各ファイルを 500 行以下に抑える。分割後も PRECACHE 対象を維持し、auto-version.yml で全ファイルの CACHE_NAME を更新。分割により SW update の granularity が向上し、stale code リスクが低減。
- **[medium]** `billing-guard` @ map-matcher.js:L2890
  - Worker B の mmIncrement / tentativeIncrement 0 化ロジック (msg.isStationary=true 時) が Worker B 内で完結しているが、main 側の state.running ガードと二重適用されていない。KI-004 と類似の「ガード漏れ」リスク: Worker B が isStationary 判定を受け取れない場合 (例: main → Worker メッセージ送信失敗) に停車中でも mmIncrement>0 が返る。
  - 推奨対処: defense in depth: Worker B 側の isStationary ガードを維持しつつ、main 側 (meter.js L440 / L514 等) でも state.running && !state.isStationary の二重ガードを追加。どちらか一方が失敗しても停車中加算ゼロを保証。または Worker B → main の mmResult に isStationary フラグを含め、main 側で最終判定を行う設計に変更。
- **[medium]** `sensor-dropout` @ gps-worker.js:L596-L598
  - 加速度サンプル null 時の GPS 単独 fallback (C-1+C-2 判定不能) が実装されているが、compass null 時の fallback が不明瞭。gps-worker.js L596 の「加速度判定不能 → GPS判定のみ」は明示されているが、compass が null の場合の Kalman Q 値調整 (T5 typeCode 連動) が _getDynamicBaseQ() に fallback する挙動が暗黙的。SENS-DROP-001 パターンの「センサー消失時の挙動不整合」リスク。
  - 推奨対処: compass null 時の Kalman Q fallback を明示的にログ出力: gps-worker.js L596 付近に「compass 不在 → typeCode 連動 Q のみ」の wlog を追加。または compass null 時の Q 値を CONFIG に明示 (例: kalman_Q_no_compass=3.5) し、typeCode 不明時と区別。
- **[medium]** `gps-accuracy` @ map-matcher.js:L2890 / gps-worker.js:L596
  - Worker B の mmIncrement 0 化ロジックが isStationary=true のみで判定し、GPS accuracy 値を考慮していない。GPS-ACC-001 パターンの「GPS 精度劣化時の距離混入」リスク: 停車中でも accuracy>50m の GPS が届いた場合、Worker B は mmIncrement を 0 化するが、その前段の _routeDistance で accuracy チェックが漏れていると異常値が混入する可能性。
  - 推奨対処: Worker B の mmIncrement 算出前に accuracy ガードを追加: map-matcher.js L2890 付近で msg.accuracy>50 なら mmIncrement=0 / tentativeIncrement=0 を強制。または _routeDistance の入口で accuracy チェックを追加し、異常値を早期 return。
- **[low]** `dead-code` @ meter.js:L1172 / map-matcher.js:L1650
  - Tier 2 リードインジケータの tentativeIncrementM が prevSnap (前 step の bestEmit) から current bestEmit までの道路距離を算出する設計だが、prevSnap が null の場合 (= 代行開始直後 / reset 直後) に tentativeIncrementM=0 で据え置かれる。この「初回 GPS step で tentativeIncrementM=0」の挙動が意図的か不明瞭で、KI-005 と類似の「初期化経路が dead」リスク。
  - 推奨対処: prevSnap=null 時の tentativeIncrementM 算出を明示的にコメント: map-matcher.js L1650 付近に「初回 GPS step は prevSnap=null のため tentativeIncrementM=0 (= 表示は distance_m のみ)」の設計意図を記載。または初回 GPS step で lastWarmupGps を prevSnap として使用し、warmup 済なら初回から tentativeIncrementM>0 を算出。
- **[low]** `state-machine` @ meter.js:L934 / gps-worker.js:L596
  - business_distance_m の ZUPT ガード (L934) が gps-worker.js の isStationary 判定 (3 点 AND: GPS+C-1+C-2) に依存しているが、Worker A (gps-worker.js) と Worker B (map-matcher.js) の判定タイミングがずれる可能性。Worker A が isStationary=true を返した後、Worker B が古い isStationary=false の状態で mmIncrement を算出すると、L934 の ZUPT ガードが無効化される。KI-004 と類似の「複数 Worker 間の状態不整合」リスク。
  - 推奨対処: Worker A の isStationary 判定を Worker B に同期: main 側で Worker A の isStationary 結果を受け取った後、Worker B に msg.isStationary として送信する現行設計を維持。ただし Worker A → main → Worker B の伝達遅延 (数 ms) を考慮し、Worker B 側で「直近 N step の isStationary 履歴」を保持して多数決判定を行う設計に強化。
- **[low]** `distance-calculation` @ meter.js:L1172 / map-matcher.js:L1650
  - tentativeIncrementM の物理上限チェック (200m/step) が map-matcher.js L1650 で実装されているが、この上限値が「1 GPS step (~1-5Hz) で 200m 超は GPS jump」という前提に基づく。iOS Safari の GPS 1Hz 制限下では 1 step = 1 秒なので 200m = 720km/h 相当で妥当だが、Android Chrome の 5Hz 環境では 1 step = 0.2 秒で 200m = 3600km/h 相当となり過剰に緩い。DIST-CALC-001 パターンの「物理上限が環境依存で不整合」リスク。
  - 推奨対処: tentativeIncrementM の物理上限を GPS 周期 (dt) ベースに動的化: map-matcher.js L1650 で prevSnap.timestamp と msg.timestamp の差分 dt を算出し、物理上限 = 160km/h × dt + 余裕 50m に変更。iOS 1Hz / Android 5Hz の両環境で同じ物理法則を適用し、異常値 skip の精度を向上。

<details><summary>Raw JSON</summary>

```json
{
  "timestamp": "2026-05-24T15:57:59.310Z",
  "model": "claude-sonnet-4-5-20250929",
  "target_files": [
    "js/meter.js",
    "js/map-matcher.js",
    "js/gps-worker.js"
  ],
  "risks": [
    {
      "severity": "high",
      "category": "dead-code",
      "location": "meter.js:L257-L305",
      "description": "Phase 1.C Off-Road Mode の _trackHaversineBetweenGps / _calculateOffRoadIncrement が GPS 直線距離 (haversine) を累積する経路だが、Off-Road 起動条件 (snap miss 5 連続) が Worker B の commit 遅延や grace period (5秒) で発火しにくい設計。結果として _haverAccumSinceLastCommit が永続的に蓄積されるが使われない (= dead accumulation) リスク。KI-005 RegionLoader 欠落と類似の「条件分岐が永遠に false 評価で経路が dead」パターン。",
      "recommendation": "Off-Road 起動頻度を実機ログで検証し、grace period 後も snap miss 5 連続が実際に発生するか確認。発生しない場合は _haverAccumSinceLastCommit 累積経路を削除 (= KI-005 と同じ dead code 削除手順)。または Off-Road 起動条件を緩和 (snap miss 3 連続等) して経路を活性化。"
    },
    {
      "severity": "high",
      "category": "state-machine",
      "location": "meter.js:L934 / map-matcher.js:L2890",
      "description": "business_distance_m の加算経路が 2 箇所に分散: ① meter.js L934 (haversine 連続点 ZUPT ガード) ② map-matcher.js L2890 (Worker B mmIncrement 経路)。KI-004 idle 中 business_distance_m 増加事象と類似の「複数経路で同じ state を更新」設計。Worker B が isStationary=true でも mmIncrement>0 を返す場合 (例: Viterbi flush 時の残骸 commit) に ② 経路で加算され、① の ZUPT ガードが無効化される。",
      "recommendation": "business_distance_m 加算経路を単一化: Worker B 側で isStationary 判定を受け取り mmIncrement / tentativeIncrement を 0 化する現行設計 (L2890) を維持し、meter.js L934 の haversine 経路を削除。または ① ② 両経路で isStationary ガードを二重適用 (defense in depth) し、どちらか一方が漏れても停車中加算ゼロを保証。"
    },
    {
      "severity": "high",
      "category": "distance-calculation",
      "location": "meter.js:L1172 / map-matcher.js:L1650",
      "description": "Tier 2 リードインジケータ (tentativeIncrementM) の算出経路が Worker B 内の _routeDistance (= dec.calcRoadDistance) を使用。_routeDistance は tile Dijkstra / backbone / OSRM / haversine の 4 段 fallback だが、最終 fallback の haversine (GPS 直線距離) が tier2_pending_m に混入すると「GPS 直線距離での課金は禁止」絶対ルールに抵触。現状は tier2_pending_m が表示専用で distance_m には影響しないが、将来の機能拡張 (例: tier2 を課金に昇格) で課金経路に混入するリスク。DIST-CALC-001 パターンの潜在的違反。",
      "recommendation": "_routeDistance の haversine fallback を tentativeIncrementM 算出時のみ無効化: _routeDistance に引数 allowHaversineFallback=false を追加し、tentativeIncrementM 経路では haversine 失敗時に 0 を返す。または tentativeIncrementM を完全に別関数 (_routeDistanceStrictRoadOnly) で実装し、haversine 経路を含まない設計に分離。"
    },
    {
      "severity": "medium",
      "category": "sw-cache",
      "location": "meter.js:L1-L2890 / map-matcher.js:L1-L2890",
      "description": "meter.js / map-matcher.js の両ファイルが 2800+ 行の巨大ファイルで、Service Worker の PRECACHE 対象。KI-001 SW-CACHE-001 パターンの「CACHE_NAME 更新漏れで古いコード実行」リスクが高い。auto-version.yml で commit SHA 自動更新されているが、ファイルサイズが大きいため iOS Safari の cache 戦略で stale code が残りやすい (= 修正が reach しない)。",
      "recommendation": "meter.js を機能別に分割 (例: meter-core.js / meter-offroad.js / meter-tier2.js) し、各ファイルを 500 行以下に抑える。分割後も PRECACHE 対象を維持し、auto-version.yml で全ファイルの CACHE_NAME を更新。分割により SW update の granularity が向上し、stale code リスクが低減。"
    },
    {
      "severity": "medium",
      "category": "billing-guard",
      "location": "map-matcher.js:L2890",
      "description": "Worker B の mmIncrement / tentativeIncrement 0 化ロジック (msg.isStationary=true 時) が Worker B 内で完結しているが、main 側の state.running ガードと二重適用されていない。KI-004 と類似の「ガード漏れ」リスク: Worker B が isStationary 判定を受け取れない場合 (例: main → Worker メッセージ送信失敗) に停車中でも mmIncrement>0 が返る。",
      "recommendation": "defense in depth: Worker B 側の isStationary ガードを維持しつつ、main 側 (meter.js L440 / L514 等) でも state.running && !state.isStationary の二重ガードを追加。どちらか一方が失敗しても停車中加算ゼロを保証。または Worker B → main の mmResult に isStationary フラグを含め、main 側で最終判定を行う設計に変更。"
    },
    {
      "severity": "medium",
      "category": "sensor-dropout",
      "location": "gps-worker.js:L596-L598",
      "description": "加速度サンプル null 時の GPS 単独 fallback (C-1+C-2 判定不能) が実装されているが、compass null 時の fallback が不明瞭。gps-worker.js L596 の「加速度判定不能 → GPS判定のみ」は明示されているが、compass が null の場合の Kalman Q 値調整 (T5 typeCode 連動) が _getDynamicBaseQ() に fallback する挙動が暗黙的。SENS-DROP-001 パターンの「センサー消失時の挙動不整合」リスク。",
      "recommendation": "compass null 時の Kalman Q fallback を明示的にログ出力: gps-worker.js L596 付近に「compass 不在 → typeCode 連動 Q のみ」の wlog を追加。または compass null 時の Q 値を CONFIG に明示 (例: kalman_Q_no_compass=3.5) し、typeCode 不明時と区別。"
    },
    {
      "severity": "medium",
      "category": "gps-accuracy",
      "location": "map-matcher.js:L2890 / gps-worker.js:L596",
      "description": "Worker B の mmIncrement 0 化ロジックが isStationary=true のみで判定し、GPS accuracy 値を考慮していない。GPS-ACC-001 パターンの「GPS 精度劣化時の距離混入」リスク: 停車中でも accuracy>50m の GPS が届いた場合、Worker B は mmIncrement を 0 化するが、その前段の _routeDistance で accuracy チェックが漏れていると異常値が混入する可能性。",
      "recommendation": "Worker B の mmIncrement 算出前に accuracy ガードを追加: map-matcher.js L2890 付近で msg.accuracy>50 なら mmIncrement=0 / tentativeIncrement=0 を強制。または _routeDistance の入口で accuracy チェックを追加し、異常値を早期 return。"
    },
    {
      "severity": "low",
      "category": "dead-code",
      "location": "meter.js:L1172 / map-matcher.js:L1650",
      "description": "Tier 2 リードインジケータの tentativeIncrementM が prevSnap (前 step の bestEmit) から current bestEmit までの道路距離を算出する設計だが、prevSnap が null の場合 (= 代行開始直後 / reset 直後) に tentativeIncrementM=0 で据え置かれる。この「初回 GPS step で tentativeIncrementM=0」の挙動が意図的か不明瞭で、KI-005 と類似の「初期化経路が dead」リスク。",
      "recommendation": "prevSnap=null 時の tentativeIncrementM 算出を明示的にコメント: map-matcher.js L1650 付近に「初回 GPS step は prevSnap=null のため tentativeIncrementM=0 (= 表示は distance_m のみ)」の設計意図を記載。または初回 GPS step で lastWarmupGps を prevSnap として使用し、warmup 済なら初回から tentativeIncrementM>0 を算出。"
    },
    {
      "severity": "low",
      "category": "state-machine",
      "location": "meter.js:L934 / gps-worker.js:L596",
      "description": "business_distance_m の ZUPT ガード (L934) が gps-worker.js の isStationary 判定 (3 点 AND: GPS+C-1+C-2) に依存しているが、Worker A (gps-worker.js) と Worker B (map-matcher.js) の判定タイミングがずれる可能性。Worker A が isStationary=true を返した後、Worker B が古い isStationary=false の状態で mmIncrement を算出すると、L934 の ZUPT ガードが無効化される。KI-004 と類似の「複数 Worker 間の状態不整合」リスク。",
      "recommendation": "Worker A の isStationary 判定を Worker B に同期: main 側で Worker A の isStationary 結果を受け取った後、Worker B に msg.isStationary として送信する現行設計を維持。ただし Worker A → main → Worker B の伝達遅延 (数 ms) を考慮し、Worker B 側で「直近 N step の isStationary 履歴」を保持して多数決判定を行う設計に強化。"
    },
    {
      "severity": "low",
      "category": "distance-calculation",
      "location": "meter.js:L1172 / map-matcher.js:L1650",
      "description": "tentativeIncrementM の物理上限チェック (200m/step) が map-matcher.js L1650 で実装されているが、この上限値が「1 GPS step (~1-5Hz) で 200m 超は GPS jump」という前提に基づく。iOS Safari の GPS 1Hz 制限下では 1 step = 1 秒なので 200m = 720km/h 相当で妥当だが、Android Chrome の 5Hz 環境では 1 step = 0.2 秒で 200m = 3600km/h 相当となり過剰に緩い。DIST-CALC-001 パターンの「物理上限が環境依存で不整合」リスク。",
      "recommendation": "tentativeIncrementM の物理上限を GPS 周期 (dt) ベースに動的化: map-matcher.js L1650 で prevSnap.timestamp と msg.timestamp の差分 dt を算出し、物理上限 = 160km/h × dt + 余裕 50m に変更。iOS 1Hz / Android 5Hz の両環境で同じ物理法則を適用し、異常値 skip の精度を向上。"
    }
  ],
  "summary": "10 件のリスクを検出。高 severity 3 件: ① Off-Road Mode の dead accumulation (KI-005 類似)、② business_distance_m の複数経路更新 (KI-004 類似)、③ tentativeIncrementM の haversine fallback 混入 (DIST-CALC-001 潜在違反)。中 severity 4 件: ④ 巨大ファイルの SW cache リスク (KI-001 類似)、⑤ Worker B の isStationary ガード単一化、⑥ compass null 時の fallback 不明瞭 (SENS-DROP-001)、⑦ accuracy ガード漏れ (GPS-ACC-001)。低 severity 3 件: ⑧ tentativeIncrementM 初回 step の挙動不明瞭、⑨ Worker A/B 間の isStationary 同期遅延、⑩ tentativeIncrementM 物理上限の環境依存。全体として「複数経路で同じ state を更新」「fallback 経路の暗黙的挙動」「Worker 間の状態同期」が主要リスク。過去事例 (KI-004 / KI-005 / DIST-CALC-001) と類似のパターンが多く、既存の防止策 (ガード追加 / 経路単一化 / 明示的コメント) を適用可能。"
}
```
</details>

---

★写した数★ 全 27 件（うち 指摘が入っている物 15 件）