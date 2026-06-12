# ダイコメ 距離パイプライン 白紙書き直し — 実装契約書 (2026-05-29)

ブランチ `clean-rebuild-pipeline` で実施。main(テストアプリ配信)は壊さない。
司さん指示「白紙にしてから繋げ・繋ぎ忘れのないように」に従い、**守る契約を先に固定 → 中身を白紙 → 検証を後で繋ぐ**。

---

## A. 絶対に保つ契約(壊すと index.html / business.js / gps.js / Worker B が死ぬ = 繋ぎ忘れ)

### A-1. 公開メソッド 37 個(Meter object・呼び出し側が依存・シグネチャ不変)
start / stop / businessEnd / reset / resume / update / updateGpsOnly / primeFromWarmup /
setElapsedAccumulated / getState / getMMStats / setFareConfig / getFareConfig / **calcFare** /
getNearestAddress / isAddressDataReady / setDistance / setLastGps / setMapMatcher / isMmReady /
setBusinessDistance / setBusinessActive / setSurchargeActive / toggleSurcharge /
getActiveSurcharges / getSurchargeMultiplier / setVehicleType / getVehicleType /
_setDrainMmUntil / _setOffRoadGraceUntil(テスト hook)

### A-2. calcFare 料金式(meter.js L1425〜・**1 byte 不変・丸ごと移植**)
1000m以下 ¥1,300 / 以降 420mごと +¥100。tiers→vehicle→surcharge→auto→wait→clamp→round の多段。
境界(1000/1420/1421/1840…)の既存挙動を回帰テストで固定。

### A-3. getState が返す state 形(40+ field・index.html が直接読む)
running / distance_m / distanceSource / fare_yen / elapsed_sec / business_active /
display_distance_m / business_display_distance_m / mm_distance_m / offroad_distance_m /
gap_fill_total_m / wait_sec … 既存キーは全て維持(消すと UI が undefined 参照)。

### A-4. Worker B プロトコル(map-matcher との繋ぎ目)
送信: loadRoads{pref,roadsData} / configPlatform{isIOS} / position{...} / reset。
受信: mmResult{snapped,snap,committed,mmIncrementM,tentativeIncrementM,isStationary} / roadsLoaded{ok}。
setMapMatcher(adapter) で接続・roadsLoaded ack で _workerLoadedPrefs 更新。

### A-5. 課金距離の意味論
distance_m = running=true 中の「道路 snap 累積(mmIncrementM)」。GPS 直線距離での課金は禁止。

### A-6. Viterbi scoring 式 / Kalman フィルタ(アルゴリズム中核は再利用・式は不変)

### A-7. ★データ層(司さん指摘・絶対保つ・壊すと距離/住所/防災/配信が全部死ぬ)★
- **道路データ** roads-{pref}.js(47県・v7 形式: 24bit attr bitmap + varint + base64 + 全通過グリッド)
  → これが 9,436m を出す source。形式変更不可。
- **roads-decoder.js**: RoadDecoder API(decodeRoadAt / buildOffsetTable / getRoadsNear /
  snapToNearestRoad / snapAllWithin / calcRoadDistance / isRestrictedTransition)。v4-v7 マルチ対応。
  → snap 段はこの decoder を通す。消費側は形式変更時も無変更(roads-decoder が吸収)が原則。
- **データ読込**: region-loader / data-loader(IndexedDB cache)・window.ROADS_{PREF} グローバル代入。
- **sw.js precache 規約**: 全国共通バンドルは PRECACHE / 県別(poi/hazard/roads)は SWR。**触らない**。
- **その他データ**: poi-{pref} / hazard-{type}-{pref}(5種×47県)/ addresses-fine/coarse(getNearestAddress 用)/
  bridges / tunnels / road-attrs / DEM由来 incline。形式・出典(OSM ODbL / KSJ / 地理院)維持。
- **★距離計算は道路データの道なり(road polyline)に沿う・GPS直線距離での課金は禁止★**(A-5 と一体)。
- 不可侵ファイル: **mm-data-pipeline.js / sw.js**(memory 既出の触らないファイル)。

---

## B. 白紙にする(=今の mess・配線監査13件 + 重複層)

- orphaned/死にコード13件: gps_predictive_distance_m / display dead state / _osrmTeacher /
  _tier2Segments / checkStationary旧 / cellular hint / _DISP_* 定数 / _HYBRID_* / prevSnap /
  _activePinnedTile / _lastKnownLat磁気偏差 / OSRM batch trigger
- 重複層: 停止判定4箇所→1 / 精度クランプ3箇所→1 / bearing計算3モジュール→1 / 距離表示3実装→1
- 過剰: business sanity clamp(haver×3) / Off-Road grace 5層state machine / gap 60s完全skip

## C. 白紙で組む 6 段(各段 単一責務・前段出力を後段が必ず read)

1. **GPS取得**(gps.js onPosition): raw正規化1本。A3 haversine速度は診断のみ。
2. **受理**(gps-worker acceptFix): 静止判定1実装 + 精度クランプ1実装。速度異常は「位置棄却」やめ「速度distrust」。
3. **snap**(map-matcher): Viterbi → 道なり弧長 mmIncrementM。候補K拡張・gap routable全評価。
4. **集計**(meter accrue): running gate内 distance_m += mmIncrementM → calcFare。business mirror。
5. **display**(meter reconcile): 実値read only・速度予測補間 + 10m grid・単調・実値超えない。
6. **calcFare**(不変移植)。

## D. 実装順(段階導入でなく・依存順・最終1 commit)

1. ★契約回帰テスト先行★: calcFare境界 + getState形 + Worker Bプロトコル を固定する test(白紙前後で不変保証)
2. 白紙実装(B削除 + C6段)を branch で一気に
3. ★白紙コードに★ オラクル接続: tests/real-trace-roadsnap(9,436m) + フルpipeline replay で
   distance_m が Google -4%〜0%(9,330m+)に乗るか検証
4. 全9ツール一斉検査 PASS → main merge
5. 実機 running=true trace で確認 → 初めて「直った」宣言

---

## E. 検証の物差し(既に在る)
- 自前道路クリーン snap = **9,436m**(tests/real-trace-roadsnap.js・オフライン・ゲート無し理想値)
- Google道なり = 9,718m / 生GPS = 9,276m → 正解レンジ 9,300〜9,700m
- 目標: 白紙パイプラインの distance_m が このレンジ(国交省 -4%〜0%)に乗る

完全オフライン前提。calcFare/料金は不変。実機確認まで「直った」と言わない。
