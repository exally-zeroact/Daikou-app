# ダイコメ 実装状況

最終更新: 2026-05-24
管理: 司さん + Claude

main HEAD: f5246719 (= 2026-05-24・走行中の距離表示を予測補間で滑らか化)
sw.js CACHE_NAME: daikome-f524671 (= CI auto-update・タスクキル再起動で新仕様有効化)

このファイルはダイコメの Map Matching / 距離計測 / 課金 / UI / リリース準備の実装状況を一元管理する。
セッション間で継続してメンテナンスする。

## 距離方式 (= 2026-05-24 確定)
- ★ distance_m (= 課金根拠) ★ = 道路 snap (= Worker B mmIncrementM) 主 + retroactive haversine 補完
  + Off-Road haversine + gap fill + setDistance の・5 経路 (= state.running gate)
  ・表示: display_distance_m = max(distance_m, gps_predictive, distance_m+tier2_pending_m) + 予測補間 + Reconciliation rate 100m/sec
  ・preview: tier2_pending_m (= Worker B tentativeIncrementM 累積 + commit 時差分減算・単調増加)
- ★ business_distance_m (= 業務総走行) ★ = distance_m と同じ道路 snap 5 経路 + state.business_active gate 並記
  ・Off-Road incremental のみ・business 側に・屋内 ZUPT ガード追加 (= 連続点 30s net 変位 < 10m AND 現 haver < 5m → skip)
  ・preview: business_tier2_pending_m (= 課金 tier2_pending_m と・完全非共有・別 if ブロック・別変数)
  ・表示: business_display_distance_m (= business_distance_m + business_tier2_pending_m + 予測補間 + Reconciliation rate 100m/sec)
- ★ 表示層 予測補間 ★ = target_velocity_mps (= 直近 1 秒の target 増分/dt・自己整合) で・GPS 待ち間も滑らか先取り
  ・屋内/停車 (= target 0 進捗) → velocity 0 → 予測 0
  ・UI refresh: startUiTimer 100ms (= 10Hz)

────────────────────────────────────────────────────────────────────

## 絶対ルール (全セッション共通・例外なし)

- 実装済みの機能は必ず全て課金・業務フローに接続すること
- 「業務継続性」を理由に機能を参照値・dead code にしないこと
- 設計変更をした場合は必ず報告すること
- 安全側への勝手な格下げ禁止
- 距離計算は道路ジオメトリに沿った距離で課金・GPS 直線距離での課金は禁止
  - 「直線距離」= A→B の一発 haversine 課金を意味する
  - Kalman 平滑化済み GPS 連続点を polyline として累積した距離は許可
  - オフライン保持の道路データに沿った距離は許可
- リアルタイム交通流は対象外
- OBD-II / Web Bluetooth は実装しない

## ダイコメ哲学

- 「完全オフライン」ではなく「オフラインでもオンラインと同等に使える」
- 売り: ユーザーはスマホ 1 台用意するだけ・専用ハード不要
- 業務遂行は完全オフライン・補助同期はオンライン時に piggyback
- LINE 連携で更新通知・同期タイミングは LINE 接続時に乗せる

## 距離加算ポリシー (確定済)

- 全加算 (タクシー方式)
- U-turn / バック走行 / oneway 違反 snap も全て加算
- ONEWAY_PENALTY / TURN_RESTRICTION_PENALTY は snap 選択補助のみ
  距離加算は止めない
- T9 jumpProb は意図的逆走を検出しない設計

────────────────────────────────────────────────────────────────────

## ✅ 実装済み機能

### Map Matching コア (Phase A-D・全完了)

| ID | 機能 | 場所 | 状態 |
|----|------|------|------|
| M1 | log 空間 emission (underflow 防止) | map-matcher.js | 実装済 |
| M3 | Viterbi 窓 N=15/N=10 適応・top-2 commit | map-matcher.js | 実装済 |
| M5 | Catmull-Rom centripetal alpha=0.5 | map-matcher.js | 実装済 |
| M6 | Tile pin during routing | map-matcher.js | 実装済 |
| M7 | Grid bias LRU・OSRM /match 教師信号 | map-matcher.js | 実装済 |
| G1 | HDOP/PDOP 推定 (trajectory ベース) | map-matcher.js | 実装済 |
| G3 | 地磁気偏差テーブル補正 | gps-worker.js | 実装済 |
| G6 | iOS 1Hz GPS 補正 (N=10) | map-matcher.js | 実装済 |
| D1 | OSM access タグ・private 除外 | map-matcher.js + roads-decoder.js + build-roads.js | 実装済 |
| D3 | 緊急輸送道路 boost ×1.05 | map-matcher.js | 実装済 |
| D4 | 道路種別速度 cap (参照値・F7 で動作位置変更) | map-matcher.js / meter.js | 実装済 |
| F7 | calculateGapFill 速度クランプ 160km/h 絶対上限 | meter.js | 実装済 |
| B1 | roadsLoaded ack Set 管理 | meter.js | 実装済 |

### Map Matching 拡張 (T1-T12・全完了)

commit a5eec56a で T1+T2+T3+T8+T10+T11+T12 を一括実装し、
T4-T7・T9 と合わせて全 12 機能完了。

| ID | 機能 | 場所 | 状態 |
|----|------|------|------|
| T1 | DEM 3D 距離補正 (急坂対応) | map-matcher.js _apply3DCorrection | ✅ 実装済 (commit a5eec56a) |
| T2 | タイル間 border node 接続 (multi-tile Dijkstra) | map-matcher.js _runTileDijkstraMulti | ✅ 実装済 (commit a5eec56a) |
| T3 | POI proximity prior +5% | map-matcher.js (framework) | ✅ framework のみ・実 POI データ未投入 |
| T4 | turn:restriction 違反ペナルティ ×0.05 | map-matcher.js + roads-decoder.js | ✅ framework のみ・実 restrictions データ未投入 |
| T5 | Adaptive Kalman Q (道路種別連動) | gps-worker.js + gps.js + meter.js | ✅ 実装済 |
| T6 | maxspeed σ_perp チューニング (8 段階) | map-matcher.js + roads-decoder.js + build-roads.js | ✅ 実装済・47 県 v7 build 済 |
| T7 | 道路曲率による σ_perp 動的化 | map-matcher.js | ✅ 実装済 |
| T8 | Cross-user pheromone (Firebase) | map-matcher.js + firebase.js + meter.js | ✅ framework のみ・Firebase 本番運用未開始 |
| T9 | GPS jump 検出 + 確率ベース判定 | map-matcher.js | ✅ 実装済 |
| T10 | Lane-level matching (dual carriageway) | map-matcher.js | ✅ 実装済 (commit a5eec56a) |
| T11 | 時間帯条件付き oneway / 通行制限 | map-matcher.js (framework) | ✅ framework のみ・実データ未投入 |
| T12 | DeviceMotion 拡大活用 (急ブレーキ・慣性 quality) | gps-worker.js | ✅ 実装済 (急ブレーキのみ・慣性は quality check 止まり) |

### Phase 1: フォールバック強化 (全完了・2026-05-10)

| ID | 機能 | 詳細 | 場所 |
|----|------|------|------|
| Phase1.B | トンネル A→B polyline 精緻化 | ✅ 実装完了 (commit c18b2c57)。region-loader.js に findTunnelByPosition / findBridgeByPosition / calcInfraPolylineDistance を追加。meter.js calculateGapFill が A・B 両方が同じ infra 上にあれば polyline 距離で計算・Math.max(polylineDist, naive) で過少課金防止 | meter.js + region-loader.js |
| Phase1.C | Off-Road Mode (GPS polyline 累積) | ✅ 実装完了 (commit fa11e75f)。snap 連続失敗 5 回検出で起動・retroactive add で取り漏れ補填・Worker B 復帰で二重課金回避し終了。state.offroad_distance_m / offroad_count を追加 | meter.js + map-matcher.js |
| Phase1.ZUPT | Zero Velocity Update | ✅ 実装完了 (commit 00a12687)。KalmanGPS class に setZuptActive 追加・ZUPT active 時 Q=0.01 (≒vx/vy=0) で位置共分散維持。直前 frame の isStationary を carry し 1 frame lag で適用 | gps-worker.js |

### Phase 2: AI 訓練データ蓄積 framework (全完了・2026-05-10)

| ID | 機能 | 詳細 | 場所 |
|----|------|------|------|
| Phase2.A | training-collector | ✅ 実装完了 (commit ce7e4c93)。js/training-collector.js 新規・IndexedDB 'daikome-training'/'samples'・80 sample×3 軸 (20Hz 4 秒)・FIFO 50,000 件・位置情報非保存 | js/training-collector.js + meter.js + index.html |
| Phase2.B | training-uploader | ✅ 実装完了 (commit 46964bc4)。js/training-uploader.js 新規・WiFi+充電+1日gate+500sample threshold・CompressionStream gzip best-effort・SW Background Sync (Android Chrome) + visibilitychange/online (iOS) | js/training-uploader.js + firebase.js + sw.js + index.html |
| Phase2.C | 蓄積データの仕様 | 1 サンプル ≈ 2KB・1 trip 約 300KB・gzip 50KB・最大 100MB ローカル保持 | spec |

### Phase 3: 同意 UI + 利用規約 (全完了・2026-05-10)

| ID | 機能 | 詳細 | 場所 |
|----|------|------|------|
| Phase3.UI | 注意書き表示 | ✅ 実装完了 (commit 87f878c2)。初回起動時オーバーレイバナー (緑系・1 回限り)・OK/閉じるで consent 確定・即時 refreshEnabledFromStorage | index.html |
| Phase3.Settings | 設定画面 | ✅ 実装完了。settings.html の「学習データ提供」セクション・トグル/詳細 collapsible/過去データ削除ボタン | settings.html |
| Phase3.Terms | 利用規約改定 | ✅ 実装完了。settings.html 内に inline 段落 (送信される/されない の明示) | settings.html (inline) |

### fareConfig v2 (commit 62e27a4b・2026-05-10)

旧 v1 (base/add 単一倍率) を v2 (tiers + surcharges[] + autoSurcharges + vehicles + wait + minFare/maxFare + rounding) に拡張。
calcFare を 7-step pipeline 化 (tiers/fallback → vehicle → manual → auto → wait → clamp → rounding)。

| 項目 | 詳細 | 場所 |
|------|------|------|
| fare.html 新規 | 8 タブ (基本/段階/割増/自動割増/車種/待機/区間/確認)・portrait/landscape 自動切替・mint カラー・DM Mono/Noto Sans JP | fare.html (785 行) |
| tiers 段階料金 | 距離区切りで段階的に単価変更可能 | js/meter.js calcFare |
| vehicle 車種別倍率 | 軽/普通/ワゴン等の係数 | js/meter.js + js/firebase.js |
| 手動 surcharges[] | 任意数の割増を ID 管理・トグル制御 | js/meter.js |
| autoSurcharges | 時間帯/曜日条件で自動付与 | js/meter.js calcFare |
| wait 料金 | 待機時間課金 | js/meter.js calcFare |
| min/max clamp + rounding | 下限/上限/丸め | js/meter.js calcFare |
| Firebase v1→v2 自動 migration | loadFareConfig 内で書き戻し (surchargeRate → surcharges[0]='legacy') | js/firebase.js |
| 追加 API | toggleSurcharge / setSurchargeActive / getActiveSurcharges / getSurchargeMultiplier / setVehicleType / getVehicleType | js/meter.js |

絶対ルール準拠: 全実装は calcFare 内で実倍率として消費・参照値や dead code 化なし。

### リリース前保護機能 (commit d30d7290・2026-05-10)

| ID | 機能 | 詳細 | 場所 |
|----|------|------|------|
| S1 | 複数タブ guard (BroadcastChannel) | チャンネル名 'daikome-tab-guard'・他タブ検出時に閲覧専用化 (赤バナー + ボタン disabled + window._tabReadOnly)・onBusinessStart でも block+toast | index.html |
| S2 | ~~業務開始忘れ警告~~ | ★ 2026-05-23 a8fb51a0 で・お節介ルール適用・完全削除済 (= businessForgotBanner / _checkBusinessForgot / 全関連 logic) ★ | (削除済) |
| S3 | 業務終了 confirm + 1 trip 上限警告 | onBusinessEnd 冒頭で confirm dialog・setInterval 30 秒で distance>500km なら赤警告バナー・running=false で自動非表示 | index.html |
| M1 | DAIKOME_APP_VERSION 設定 | index.html `<head>` 冒頭に `<script>window.DAIKOME_APP_VERSION='1.0.0';</script>`・training-collector が deviceId と一緒に記録 | index.html + js/training-collector.js |
| M2 | sw.js firebase-sync dead handler 削除 | 旧 'firebase-sync' tag は誰も register していなかった・'training-upload' のみ残す | sw.js |

### UI 大改修 (commit 0c705436・2026-05-10)・★ 2026-05-24 ナビ再設計で・以下 変更 ★

| 項目 | 詳細 | 場所 |
|------|------|------|
| 走行開始ボタン非表示 bug 修正 | screenIdle 初期 display:flex→none・screenBusinessStart 初期 display:none→flex・Business 未定義時も showScreen('businessStart') を強制呼出 | index.html |
| センサー許可ダイアログ修正 | screenBusinessStart に「センサーを許可する」明示ボタン (#btnSensorPermission)・iOS PWA 未許可時のみ表示・user gesture 経由で requestSensorPermission() 発火 | index.html |
| ボトムナビ ~~4 タブ~~ → ★ 3 タブ ★ | ★ 2026-05-24 2d8acb6a: 履歴タブ削除 → 業務/使い方/設定 3 タブ均等配置 ・履歴は・独立画面 (= screenIdle 内 .btn-history で到達) ★ | index.html |
| 横画面サイドナビ | ★ 2026-05-24 2d8acb6a + ef3349c1: 横画面 overlay (履歴/使い方/設定) + screenIdle + screenBusinessStart で・左 64px サイドレール表示・代行中/料金は・既存通り非表示 ★ class detection (= body.screen-xxx) で・iOS Safari :has() bug 回避 | index.html |
| help.html 新規 | 操作手順 7 + FAQ 6 アコーディオン形式・縦 1 列/横 2 列 grid | help.html (125 行) |
| history.html 新規 | 走行履歴ページ | history.html |
| settings.html シンプル化 | 通常: 料金設定リンク・学習データ提供 ON/OFF・過去データ削除のみ。隠し: 自動リセット・OSRM・精度テスト・走行履歴リンク (#devSection / #devSection2)。切替: タイトル「設定」5 秒長押し or URL hash #dev・localStorage に状態保存 | settings.html |
| 割増/追加料金 UI 分離 | surcharge-group に「割増」セクションラベル追加・extras-list 上に「追加料金」セクションラベル追加・renderExtras() 同名グループ化 ({name} ×{count} 累計表示)・デフォルト extras 配列を空に変更 (旧プリセット 6 件削除) | index.html |
| 縦横レスポンシブ | landscape 2 カラム/サイドナビ切替 | 全 HTML |

### データ・フォーマット

| 項目 | 状態 |
|------|------|
| roads-{pref}.js v7 (24-bit bitmap・maxspeed bit 16-18) | 47 県全 build 済・**実測 203.94 MB / 47 ファイル** (commit 0949ddde) |
| DP_TOLERANCE = 3m | 採択済 (DP=5→3 で 1.7 倍精度化)・47 県 build 反映済・基準 200MB を 6.5% 超過もユーザ判断で採択 = MM 精度優先 (commit 0949ddde) |
| tunnels-{region}.js / bridges-{region}.js | 既存・8 region 合計 9,644 トンネル / 6,309 km |
| DEM (5m mesh) tiles | 既存・47 県全カバー |
| backbone graph (cross-pref routing) | 既存・31 MB |
| Phase E (国土地理院 1/2,500) | ARCHIVED コメント追加・不採用確定 (測量法申請リスク)・スクリプト温存 |
| Overture Maps 不採用確定 | Japan は 100% OSM source・TomTom 寄与ゼロ・size 1.89x の 3 重不採用理由 |

### Firebase 連携

| 項目 | 状態 |
|------|------|
| sessions_log (走行履歴) | 既存稼働 |
| vehicles ステータス | 既存稼働 |
| fareConfig (料金設定 v2) | 稼働中・v1→v2 自動 migration あり |
| pheromone (T8 cross-user・markVisited / pushSessionAggregates) | framework のみ・本番運用未開始 |
| training data (Phase 2.B) | uploader 実装済・WiFi+充電 gate で送信 |
| debug_traces (= 較正用 GPS trace) | js/debug-trace.js・テストビルドで・既定 ON (= 42e1f689 2026-05-23)・本番 OFF |

────────────────────────────────────────────────────────────────────

## 2026-05-11 〜 05-24 追加実装 (= main HEAD f5246719 までに統合)

### 距離計測 大改修 (= 2026-05-24)

| commit | 内容 |
|--------|------|
| 87134c69 (feat) | ★ 業務距離 道路 snap 構成化 ★: business_distance_m を・GPS haversine 直接 (L991 旧) から・distance_m と同じ道路 snap 5 経路に移行 (= L506/L582/L1049/L1078)・business_active gate 並記・Off-Road incremental に・business 側のみ・屋内 ZUPT ガード (= 連続点 30s net 変位 < 10m AND 現 haver < 5m)・過去 dac45f03 真因「非対称ガード」を構造的回避 |
| 87134c69 | ★ business_tier2_pending_m 別回路 preview ★: 課金 tier2_pending_m とは・完全非共有・別 if ブロック・別変数・別計算 (= mm commit 確定減算 + tentativeIncrementM 累積)・課金 tier2 系 1 byte 不変 |
| f5246719 (feat) | ★ 走行中表示 予測補間 滑らか化 ★: target_velocity_mps (= 直近 1 秒 target 増分/dt・自己整合)・GPS 待ち間も・display 滑らか先取り・屋内/停車で velocity 0 → 予測 0・物理上限 60 m/sec・単調増加保証・rate 100 m/sec |
| f5246719 | ★ business_display_distance_m 新設 ★: 課金 display と同仕様・別 state (= 完全独立)・business.js getReport で・採用・state.total_distance_m mirror sync は 1 byte 不変 (= 永続化用) |
| f5246719 | UI startUiTimer: 500ms → 100ms (= 10Hz refresh・予測補間で stair-step 解消・バッテリー +1-3% 推定) |

### お節介バナー全削除 (= 「お節介バナー全面禁止」 恒久ルール 2026-05-23)

| commit | 削除対象 |
|--------|----------|
| a8fb51a0 (Phase 1) | businessForgotBanner (= 「🚗 走行を検知しました・業務開始していますか?」) |
| a8fb51a0 (Phase 2) | restoreBanner 単独表示 (= 「✅ 走行データを復元しました」)・「+Xm 補完」 追記時のみ・表示維持 |
| b8bd1900 (2026-05-24) | stopCandidateBanner (= 「⏸ 停車 5 分以上 — 実車終了ですか?」)・isStationary 判定本体は 1 byte 不変 |

### 住所表示 機能

| commit | 内容 |
|--------|------|
| 5378efb3 (feat) | 住所① fine 配線 + 丁目カット表示 (= 「今治市常盤町」) |
| bfddc5c7 (feat) | 住所① 案 C 高精度版 (= 町丁字 polygon + map-matched snap + 4 段 fallback・rural 100m DP・hokkaido 6.95MB / 47 県 69.5MB) |
| b90eb62c (feat) | 住所② 現在地ライブ表示 (= カーナビ風・waypointCard 末尾「→ 📡 現在地住所」・青パルス) |
| e8e3bf8a (feat) | 住所② 現在地ライブ常時表示・作り直し (= 重複回避撤去・「(現在地)」 サフィックス・3 段 fallback snap fresh → stale → raw GPS・「タップ」 赤強調 #e11d48) |

### ナビ再設計 + 横画面 layout

| commit | 内容 |
|--------|------|
| 2d8acb6a (feat) | ナビ再設計: 履歴タブ削除・縦画面 3 タブ均等 (= 業務/使い方/設定)・横画面 overlay 表示時のみ・左 64px サイドレール・代行中/料金 横画面は・既存通り非表示 |
| ef3349c1 (fix) | 横画面サイドレール拡張: screenIdle + screenBusinessStart 横画面でも・左 64px サイドレール表示・業務開始 button 幅崩れ修正 (= class detection で・iOS Safari :has() bug 回避) |

### 起動・履歴・debug 系

| commit | 内容 |
|--------|------|
| ec61fff4 (feat) | 起動最速化 方式E (= IDB parse cache + 即時 + 背景遅延 + 現在地県 priority load) |
| 88d9c0c6 (fix) | 履歴 3 個重複バグ修正 (= A 案・trip_key 冪等化) |
| 42e1f689 (feat) | debug-trace.js テストビルドで・既定 ON 化 (= noise calibration 30 日収集 加速) |
| 27e16b69 (fix) | COARSE 半径 3000m → 25000m + COORD_SCALE 定数化 (距離課金 完全無変更) |
| 88d9c0c6 / 29218a33 | CI auto-commit race 解消 (= test-results auto-commit step 削除) |

### address-fine データ build / 配信

| commit | 内容 |
|--------|------|
| c8d2b68b (chore) | --street/--rsdt/--chiban build scripts + tests + gitignore (= data 非配信化) |
| df079f3e (feat) | Page Lifecycle API・iOS PWA freeze/kill 時の・distance_m 永続化補完 (= ★ Phase A の・「Page Lifecycle API」 実装済 ★) |

────────────────────────────────────────────────────────────────────

## ❌ 未完了・残タスク

### 実機テスト (最優先・コードは全完了)

- [ ] 走行開始ボタン表示確認 (screenBusinessStart 初期表示)
- [ ] センサー許可動作確認 (iOS PWA・user gesture 経由)
- [ ] ★ ナビ 3 タブ動作確認 (業務/使い方/設定) ★ (= 2026-05-24 ナビ再設計・履歴タブ削除後)
- [ ] ★ 横画面サイドレール動作確認 (overlay/screenIdle/screenBusinessStart で 左 64px・代行中/料金は非表示) ★ (= 2026-05-24)
- [ ] ★ 業務距離 道路 snap 構成 動作確認 (= 屋内駐車 5 分で・総走行距離 増えない) ★ (= 2026-05-24 87134c69 本丸)
- [ ] ★ 走行中表示 予測補間 滑らか化 動作確認 ★ (= 2026-05-24 f5246719・走行中 driveDist / totalDist が滑らか連続・屋内駐車で進まない・料金不変)
- [ ] 縦横レイアウト切替確認 (landscape 2 カラム・サイドナビ)
- [ ] Phase 1.B トンネル polyline 計算確認 (実トンネルでの A→B 距離)
- [ ] Phase 1.C Off-Road Mode 確認 (snap 連続失敗 5 回・retroactive add・二重課金回避)
- [ ] Phase 1.ZUPT 停車中位置 frozen 確認 (信号停車・駐車中の Kalman ドリフト抑制)
- [ ] fareConfig v2 料金計算確認 (tiers/surcharge/vehicle/wait の 7-step pipeline)

### リリース必須

- [ ] iOS 実機 RAM 検証
- [ ] 本番リポジトリ (Daikou-app) へのマージ
- [ ] 法的ページ作成 (特商法・PP・利用規約)
- [ ] Vercel Pro アップグレード
- [ ] Stripe 統合
- [ ] PWA WebAPK 問題解決
- [ ] Oracle Cloud OSRM サーバー
- [ ] .gitignore に .env 系追加

### 運用作業 (データ投入・別途必要)

- [ ] T3 47 県 POI データ収集
- [ ] T4 turn:restriction 実データ投入
- [ ] T11 oneway:conditional 実データ投入
- [ ] T8 Firebase RTDB pheromone path 設計・運用

### 業務品質 (未着手)

| ID | 機能 | 詳細 |
|----|------|------|
| B7 | 決済種別記録 | 現金 / PayPay / クレカ |
| B10 | 車両管理 | 複数車両切替 |
| P1 | iOS Web Push 通知 | - |
| P7 | Brotli 圧縮 | - |
| V2 | 距離証明書発行 | - |

### Phase 4: AI 推論統合 (将来・リリース後・データ蓄積後・2-4 週間工数)

| ID | 機能 | 詳細 | 場所 |
|----|------|------|------|
| Phase4.A | モデル訓練 | Google Colab で CarSpeedNet 系統 LSTM を fine-tune・ONNX 化 | 司さん作業 |
| Phase4.B | ONNX Runtime Web 統合 | Worker B にロード・GPS 不在時に推論起動 | map-matcher.js 拡張 |
| Phase4.C | モデル配信 | js/models/carspeed.onnx を Service Worker でキャッシュ | sw.js |

実装条件: ユーザー数 50 driver 達成 OR 1000 trip 以上の訓練データ蓄積

────────────────────────────────────────────────────────────────────

## 🚫 不採用と確定済 (再評価条件付き)

| 項目 | 不採用理由 | 再評価条件 |
|------|----------|----------|
| 国土地理院 1/2,500 (Phase E) | 測量法承認申請リスク | 国土地理院がオープンデータ化した時 |
| Overture Maps Transportation | Japan は 100% OSM source・size 1.89x・寄与なし | TomTom Japan 寄与が顕著になった時 |
| OBD-II / Web Bluetooth | ユーザー判断 (スマホ単体哲学) | (再評価予定なし) |
| DP_TOLERANCE = 4 (格下げ) | 安全側格下げ禁止ルール | (再評価予定なし) |
| Federated Learning | 実装コスト過大・ダイコメ規模で overkill | 1000+ driver 規模になった時 |
| 国土数値情報 道路ライン | 1/25,000 精度・OSM より低精度 | (再評価予定なし) |
| DRM / MMS 商用ライセンス | 年額数百万-数千万・予算規模 | 大手参入時 |
| VICS / JARTIC | 絶対ルール「リアルタイム交通流対象外」 | (除外確定) |
| GPS 直線距離課金 | 絶対ルール禁止 | (再評価予定なし) |

不採用スクリプト (温存・ARCHIVED コメント付き):
- scripts/parse-gsi-2500-gml.js
- scripts/merge-gsi-into-osm.js
- scripts/fetch-gsi-2500-roads.js
- scripts/build-roads.js の --gsi-2500-dir 関連

────────────────────────────────────────────────────────────────────

## 想定 DER (距離誤差率)

| 段階 | DER 想定 | 状態 |
|------|---------|------|
| baseline (現状・Phase A-E + T1-T12 + DP=3) | 0.3-1.0% | ✅ 達成済 |
| Phase 1 完了後 | 0.2-0.7% | ✅ コード完了・実機検証待ち |
| Phase 2-3 完了後 (蓄積 framework・推論なし) | 0.2-0.7% | ✅ コード完了・効果は推論時 |
| Phase 4 完了後 (AI 推論統合) | 0.1-0.5% | 将来 |
| Google Maps (推定) | 0.5-1.5% | 比較対象 |

────────────────────────────────────────────────────────────────────

## blind spot (どの方式でも対応困難・全国スケール)

| 場所 | 全国数 | 業務遭遇率 | 1 件影響 |
|------|-------|-----------|--------|
| 地下駐車場 (深・3 階以上) | 7,500-16,000 箇所 | 都市 5-15% | 100-300m |
| 5km 超 OSM 未登録トンネル | 100-500 個 | <0.01% | 500m-2km |
| 大規模屋内通路 (倉庫・工場) | 数百-千 | 一般 0.5% | 100-500m |
| 超高層ビル街 multipath | 5-10 km² | 都市 5-15% | 50-200m |
| 山間部 GPS 弱林道 | 30,000 km 級 | <0.01% | 500-1000m |

業務影響: 1 trip 中 0.5-2% (一般代行)・5-10% (都市部代行)
1 件あたり 50-100 円課金漏れ
年間影響: 中規模 50 driver 業者で 7 万円/年
業界全体 (Apple/Google も) が完全解決していない領域・許容範囲

────────────────────────────────────────────────────────────────────

## 実装ロードマップ (リリース前コードは全完了)

| 順序 | フェーズ | 状態 |
|------|--------|------|
| 1 | Phase 1.B トンネル精緻化 | ✅ 完了 (c18b2c57) |
| 2 | Phase 1.C Off-Road Mode | ✅ 完了 (fa11e75f) |
| 3 | Phase 1.ZUPT | ✅ 完了 (00a12687) |
| 4 | Phase 2.A 訓練データ収集 | ✅ 完了 (ce7e4c93) |
| 5 | Phase 2.B 送信 framework | ✅ 完了 (46964bc4) |
| 6 | Phase 3.UI + Terms | ✅ 完了 (87f878c2) |
| 7 | fareConfig v2 + fare.html | ✅ 完了 (62e27a4b) |
| 8 | リリース前保護機能 S1+~~S2~~+S3+M1+M2 | ✅ 完了 (d30d7290)・S2 は・2026-05-23 a8fb51a0 で・お節介ルール適用・削除済 |
| 9 | UI 大改修 + ボトムナビ + help.html | ✅ 完了 (0c705436)・★ 2026-05-24 2d8acb6a + ef3349c1 で・3 タブ + 横画面サイドレールに再設計 ★ |
| 10 | お節介バナー全削除 (3 件) | ✅ 完了 (a8fb51a0 + b8bd1900・2026-05-23 〜 05-24) |
| 11 | 住所① + 住所② 機能 | ✅ 完了 (5378efb3 / bfddc5c7 / b90eb62c / e8e3bf8a・2026-05-22 〜 05-23) |
| 12 | Page Lifecycle API (= Phase A 既実装) | ✅ 完了 (df079f3e) |
| 13 | 起動最速化 方式 E | ✅ 完了 (ec61fff4) |
| 14 | 業務距離 道路 snap 構成 + business preview 別回路 | ✅ 完了 (87134c69・2026-05-24) |
| 15 | 走行中表示 予測補間 滑らか化 + business_display + UI 100ms | ✅ 完了 (f5246719・2026-05-24) |
| 16 | 統合テスト + 実機検証 + 本番マージ | 🔲 残タスク (= 14/15 は・push 後 実機検証 推奨) |

Phase 4 (AI 推論) は データ蓄積後に判断・別フェーズ

────────────────────────────────────────────────────────────────────

## 検証手段

- tests/replay-mm.js (合成 fixture・3 ケース)
- tests/meter-mm-priority.js (16 アサーション)
- tests/compare-baseline.js
- 実機テスト: トンネル・地下駐車場・私道・農道のシナリオ別計測 (リリース前)
- fareConfig v2: tiers/surcharge/vehicle/wait の組み合わせ料金計算実機確認

────────────────────────────────────────────────────────────────────

## 関連ドキュメント

- CLAUDE.md (本リポジトリのルール・絶対ルール)
- このファイル (IMPLEMENTATION_STATUS.md・実装状況管理)
- Claude memory (司さんの自動メモリ・横断的決定事項)
