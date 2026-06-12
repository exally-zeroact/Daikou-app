# ダイコメ 全体監査レポート(認定基準ベース)

- 対象: `C:/Users/zeroa/Daikou-app-test` ダイコメ(代行運転メーター PWA・完全オフライン・タクシー業界参入前提)
- 監査基点: **deploy 済 HEAD `9181da3c`**(未検証 scaffold は stash 退避済 = 対象外)
- 物差し: 計量法 特定計量器(タクシーメーター検定)+ 国交省 GPS ソフトメーター認定 — 片公差 **−4%〜0%(過大推計不可)**・静止 creep 10m 以内・改ざん不能 audit trail・封印パラメータ・significant fault 自動表示/停止・1年無調整維持・タイヤ外径補正
- 監査種別: read-only(コードを 1byte も変更していない。Glob/Grep/Read + node 実行=sim/gate のみ)
- 不可侵の前提(司さん裁定マター): `distance_m`(道なり snap 累積=課金根拠)/ `calcFare`(base1300/1000m +100/420m)/ tier / running gate / business 分離。本監査は「足りてる/危うい」を述べるが「変えろ」とは決めつけない。

---

## (0) エグゼクティブ要約

課金の **never-over 床は鉄壁**(full-pipeline N=120 で過大 0/120・max 0.00000m、単調違反 0、latch 不一致 0)。表示が距離を超える/先取り課金は**構造的に発生していない**。しかし **認定インフラ(封印パラメータ・改ざん不能 audit trail・significant fault 自動停止・タイヤ外径補正・1年無調整維持)は1つも実装が存在せず**、緑 ≠ 認定可。最大の認定致命傷は2つ — ①GPS 穴(トンネル/ビル街)で **coast over-fill が距離精度 over 側 +58.47%(median +2.16%)に達し、認定 −4〜0% 帯を破る過大課金**、②停車後にメーターが追従しきれず **stop-residual max 578m(full-pipeline 実測)/ 停車中前進 20% パターン**。加えて Firebase RTDB が **全 PII path で無認証 world-readable**、距離認定核では「Viterbi 確定経路へ一本化」という MEMORY 前提が実装と乖離(実課金は毎点 emission argmax 駆動)、OSRM teacher の network 依存が課金距離を非決定化。認定到達には距離供給側の de-bias と認定インフラ新設が必須で、いずれも distance_m 設計核に隣接するため司さん裁定が要る。

---

## (1) カテゴリー別【足りてない(missing)】

### C1 距離計算 / map-matching 核

| 項目 | 影響 | severity | 証拠 |
|---|---|---|---|
| 課金距離が Viterbi MAP 経路でなく毎点 emission argmax(bestEmit)で駆動。MEMORY「Viterbi 確定経路へ一本化」と実装が乖離 | 単点ブレで隣接/対向/並走路へ flip した snap がそのまま課金。窓平滑は非課金 mmIncrementM 止まり。over +58.47% の主因の一つ | **P0** | map-matcher.js:3090-3103, 3187, 3361 / meter.js:238-245 課金は pipelineDeltaM のみ |
| 別道路 routing 採用上限が緩い(routed/chord ≤ 4.0 かつ ≤2000m/区間) | gap/交差点の誤 snap が道路網で繋がると実弦の最大4倍まで道なり課金 = 過大課金の正体 | **P0** | pipeline-distance.js:899-908(routingMaxRatio=4.0 / perSegmentMaxM=2000) |
| タイヤ外径補正(車輪径キャリブレーション)が距離核に不在 | 端末別 −14%〜+6.6% バラつき(実機3台)を補正する恒久係数が無い。認定必須要件 | P1 | pipeline-distance.js L30/L108 の「将来 OBD」コメントのみ・実補正 absent |
| パラメータ封印 / 変更 audit trail / significant-fault が距離核に無い | DEFAULTS が opts で無記録上書き可能 | P1 | pipeline-distance.js:711-721, 1020-1029 / audit/seal/fault keyword absent |
| same-road 区間に窓ベース誤 snap 是正が無い(連結性拘束は別道路 branch のみ) | 並走路に揃って flip した系統誤差が補正されない | P1 | pipeline-distance.js:885-895 / 897-941 |
| coast never-over 天井が「区間 GPS 弦」のみで累積過大を縛らない | 長い直線トンネルで弦が長いと減速分を埋め累積過大化 | P1 | pipeline-distance.js:972-990(L980 弦 clamp のみ) |
| snapMaxDistM=50m 固定で accuracy 連動が無い | acc 50m 級ビル街で誤った並走路へ snap 成立しやすい | P2 | pipeline-distance.js:45 / map-matcher.js:1287 |

### C2 課金 / 料金

| 項目 | 影響 | severity | 証拠 |
|---|---|---|---|
| タイヤ外径補正が課金距離パイプラインに不在 | 車両依存系統誤差を補正できず端末/車両差で −4〜0% を破る | **P0** | meter.js calcFare L644-737 補正項なし・js 全体 grep absent |
| 封印パラメータ(料金 tariff 保護)が無い | 誰でも UI から base_fare 等を上書き保存 → setFareConfig で即反映。封印/権限/ロックなし | **P0** | meter.js:198 無制限 spread merge / index.html:11500-11503 |
| 料金パラメータ変更の改ざん不能 audit trail が無い | version=2 を付け上書きするのみ。旧値/変更者/時刻/署名いずれも残らずサイレント上書き | **P0** | index.html:11494-11496 / changelog/hash grep absent |
| significant fault 時の自動表示/計測停止が課金側に無い | worker 不在時 gap-fill が speed×時間で課金継続 = 故障時も黙って課金 | P1 | meter.js:519-540 / fault gate なし |
| 最終料金丸めが Math.round(切上げ発生)で never-over を破る | 割増/車種倍率で非丸め値になると顧客を上方向に丸める。node 実測 over 136/543 件・max +5円 | P1 | meter.js:734 / node 実測(1.15x, rounding10) |
| tiers 経路と legacy 経路で端数式が不一致(tiers に off-by-one +1) | tiers 有効化で同距離 1420m が +¥100 過大(legacy ¥1400 / tiers ¥1500) | P1 | meter.js:665 floor+1 vs :677 ceil(node 実測) |
| 夜間割増がトリップ途中で全累積額に遡及適用 | 22:00 跨ぎで既走行分含め全 fare が突然 ×1.2、不連続ジャンプ | P1 | meter.js:703 毎 calcFare で現在時刻評価・全額乗算 |
| プレビュー料金表が実課金と不一致 | 1420m を ¥1500 提示するが実課金 ¥1400 | P2 | index.html:11140 floor+1 ≠ meter.js:677 ceil |

> caveat: Math.round 過大と tiers off-by-one は default config(料金が100の倍数)では不発の**潜在過大**。割増/車種倍率/tiers を認定運用で有効化した瞬間に顕在化(割増前提なら実質 P0)。

### C3 表示層 / メーター UX

| 項目 | 影響 | severity | 証拠 |
|---|---|---|---|
| 停車検知 → display 即 latch 経路が無い。catch-up は常に「下から」rate 律速のみ。latch は stop()/businessEnd()(支払時)のみ | 信号/経由地停車で追いつき途中に固まり、その後も登り続ける = 司さん報告「固まり→停車後ドン」の数値的真因 | **P0** | meter.js L399/L412 latch、L500 isStationary 受信するも表示層へ未伝播、L868 eff cap 24m/s |
| 追従上限 DISP_CATCHUP_MAX_MPS=24m/s が大 gap 復帰を停車後の長時間クリープに変える。決定済アーキ「cap 全廃+表示素通し」が未実装 | CONTINUOUS=1 でも no-lump 55.5% FAIL = cap 自体が独立した failure source | **P0** | meter.js L101/L868 / node: CONTINUOUS=1 で PASS 214/500(42.8%) |
| 高速×低 GPS cadence で 1fix=50m 級 lump が日常発生(トンネル不要)・停車時即収束保護なし | 高速降車/幹線停車で停車後クリープ | P1 | node: 25m/s・fixDt=2s で stop-residual 53.6m |
| 表示 sim が gap を lump setDistance 注入し実 coast 分岐を通さない(harness が production を映さない) | 500 の (4)(5) max(1426m/969m)が誇張。full-pipeline 578m が信頼値 | P1 | sim-display-montecarlo.js L88-93 |
| DISP_CLOSE_TAU_S=3.0 spring が cap 律速で停車収束を保証しない(設計意図と実挙動が乖離) | コメント「停車時残差0」が実測と矛盾 | P2 | meter.js L864 closeRate=gap/3.0 → L868 24m/s 頭打ち |

### C4 センサー / 信号活用

| 項目 | 影響 | severity | 証拠 |
|---|---|---|---|
| 加速度センサー(静止判定で検証済の物理信号)が pipeline-distance の coast/gap 補間に未配線 | 穴中に減速/停止した事実を距離 pipeline が知らず coast over-fill +58.47% を生む。accel-stationary を coast 停止トリガに使えば物理的に潰せる | **P0** | pipeline-distance.js:10 入力は {lat,lng,t,acc,spd} のみ / gps-worker.js:783-836 で判定済だが echo は boolean のみ |
| GPS native heading(course)が map-matcher に未 forward。compass null で heading scoring が完全無効化 | iPhone で compass=null 常態化時に snap 絞り込み最有力信号を失う。SE heading-align p90 80.9° の有力因 | P1 | gps-worker.js:570/691(reject のみ・result に無し:891-908)/ meter.js:608/629 compass のみ forward |
| ジャイロ(rotationRate)が距離/heading/snap いずれにも未接続(完全死蔵・収集→echo のみ) | GPS 穴中の進行方向維持・交差点旋回検出に最も効く信号を捨てている | P1 | gps.js:266-274 収集 → gps-worker.js:903-904 length echo のみ |
| altitude の DEM layer score が coarse すぎる DEM(0.05°≈5.5km grid・valid 4.3%)+ iOS 高度誤差で実効ほぼ無力 | 高架/地下 disambiguation に寄与せず、gap FAIL の一因 | P2 | data/dem-jp.js valid=14306(4.3%)/ map-matcher.js:1238-1256 |
| compass-Q 融合が speed≥5km/h かつ moved≥5m でのみ発火(低速/停車で未反映) | 市街地徐行/渋滞で heading が Kalman に反映されない | P2 | gps-worker.js:692-697 |

### C5 認定要件

| 項目 | 影響 | severity | 証拠 |
|---|---|---|---|
| 改ざん不能 audit trail が完全不在(fare_config を単一ノードへ in-place 上書き・履歴ゼロ) | 計量法核要件「封印パラメータの変更履歴」を満たさず検定不可 | **P0** | firebase.js:346-356 .set() のみ / index.html:11489-11507 |
| 封印パラメータ機構が存在しない(fare_config/default が無認証公開書込) | 封印された計量パラメータを誰でも上書き可能 = 検定の封印要件と正反対 | **P0** | tmp/rtdb-rules-merged.json:15-19 .write に auth なし |
| significant fault 自動表示/計測停止インターロックが不在 | GPS 喪失時も coast で課金継続・警告/停止なし。「GPS 信号弱」は受動ラベルのみ | **P0** | index.html:6724-6735 textContent 差替のみ / pipeline-distance.js:972-990 |
| タイヤ外径補正が完全不在 | 検定が前提とする車輪基準補正の概念自体がコードに無い | **P0** | pipeline-distance.js:108-109 コメントのみ |
| −4〜0% 片公差を構造的に保証する機構が不在(per-segment 弦 clamp のみ) | gap で over +58.47% = 検定 fatal | **P0** | sim N=120 over max +58.47% / pipeline-distance.js:980 |
| 1年無調整維持を担保する仕組みが弱い/不在(fareConfig が非業務中リモート随時上書き可) | 検定後封印期間中も値が変わりうる。frozen は単一セッション内のみ | P1 | meter.js:131/193-199 / firebase.js:324-344 |
| 計測値(距離/料金確定値)の完全性検証(署名/HMAC)が不在 | 確定運賃の改ざん不能性が担保されない | P1 | signature/hmac/checksum grep ゼロ / rules sessions_log 署名検証なし |
| 検定対応 UI/手順(封印状態・パラメータ版・公差確認)が docs/コードに不在 | 検定実務に対応不能 | P1 | docs に認定/検定/封印 設計書なし |
| 改ざん不能ログのオフライン保証が弱い(RTDB 前提だが完全オフライン前提と矛盾) | オフライン中の改ざん不能ローカル保存が未確認 | P2 | 未確認(crypto/hmac ヒットゼロ) |

### C6 オフライン / PWA / 状態復元

| 項目 | 影響 | severity | 証拠 |
|---|---|---|---|
| firebase-config.js が typeof guard なしで initializeApp() 実行(完全オフライン違反の単一点) | cold-offline 初回で firebase undefined → ReferenceError throw・FB 永久未初期化 | P1 | firebase-config.js:12 / 対照 index.html:4790 は guard あり |
| 外部 CDN 依存4本(firebase gstatic)が critical path に同期 script・SW キャッシュ不能 | cold-offline で telemetry/crash/training が全滅 | P1 | index.html:4799-4810 / sw.js:271 cross-origin skip |
| コアアプリ JS(meter/business/gps-worker/map-matcher/pipeline-distance)が PRECACHE 未登録 | install 直後オフライン化で課金エンジン未キャッシュ = 白画面の窓 | P1 | sw.js:40-82 に /js/ なし / index.html:5435 new Worker |
| page-lifecycle の pagehide/freeze 保存が elapsed_sec を欠落させ最終書込で上書き消去 | 復元で経過時間が常に巻き戻る(課金/距離は非依存) | P2 | page-lifecycle.js:62-77 vs index.html:7015 |
| LINE 通知併用が deploy 済コードに不在(MEMORY「LINE 通知併用必須」) | cold-offline 安全網が crash_reports(online 必須)に偏る | P2 | line.me/LIFF grep absent ※外部機能で scope 外の可能性=未確認 |
| business_state に失効チェックなし(driving は 24h gate・非対称) | 古い業務の限定的ゾンビ復元 | P2 | index.html:6192 vs business.js:916-983 |

### C7 テスト / CI / 品質保証

| 項目 | 影響 | severity | 証拠 |
|---|---|---|---|
| 認定直結ゲート(creep/snap/road-distance/doppler-rej)がどの CI/git hook にも未配線 | 手動 node 実行しない限り認定基準の回帰を検知できず緑のまま壊れる | **P0** | test.yml L28-32 / grep gate-* .github = 0 / .husky/pre-push は test+replay のみ |
| 表示層 Monte-Carlo(fullpipeline/display)もどの CI にも未配線 | 停車契約 (4)(5) の悪化を常時検知できない | **P0** | grep montecarlo .github = 0 |
| over 側 +58.47%(過大課金)を fail させる assert がどこにも無い。gate-road-distance は単一穴なし fixture・±3% のみ | 構造的過大を緑のまま出荷しうる | **P0** | gate-road-distance.js L45/L50-51 |
| 全 creep/stationary テストが実機の汚い GPS ジッタを再現しない(isStationary を入力で与える/同一座標固定) | creep 真因の回帰を捕まえられない | **P0** | gate-realdevice-creep.js L83/L88 / gate-road-distance.js L268-278 |
| gate-snap-accuracy の唯一の fail 条件が committedCount===0 のみ(heading/flip/residual は print のみ) | SE 方位崩れが悪化しても緑 | P1 | gate-snap-accuracy.js L354-357 |
| real-trace-creep テストが本番検出器でなくテスト内ローカル再実装で判定 | 本番検出器 regression を掴めない | P1 | real-trace-creep-stationary.test.js L47-56 |
| verify-display-smoothness が無制限 tick で settle させ時間契約を測れない・どの workflow にも無い | 停車契約 (4)(5) を構造的に見逃す | P1 | verify-display-smoothness.js L223/L182 |
| audit trail/封印/significant fault を検証するテストが皆無 | 認定必須要件のカバレッジゼロ | P1 | Glob tests/** に該当なし |
| 実機3台「画面値=真値」の独立再現が CI/ローカルに無い(gate は全て worker 迂回 replay) | 緑は necessary-not-sufficient のまま | P1 | gate-realdevice-doppler-rej.js L17-21 |
| under 側 −40.96%(blackout で埋め切れず)を fail させる下限 assert が無い | 課金安全側だが距離消失 UX 欠陥を検知不能 | P2 | gate-road-distance は穴なし fixture のみ |

### C8 死にコード再現性(missing 観点)

| 項目 | 影響 | severity | 証拠 |
|---|---|---|---|
| deploy 済 index.html が参照する js/license.js が **git 未追跡** | clean clone / Vercel deploy で 404・ライセンスゲート fetch 機能せず・認定対象ソースが VCS 外 | **P0** | git show HEAD:index.html L4965 参照あり / `git ls-files js/license.js` 空・実体 8956B |
| 認定で頼った検証ツール(gate-snap-accuracy/sim-fullpipeline/license-gate.test/validate-scoring)が全て git 未追跡かつ CI 未登録 | 別マシンで消える孤児・自動回帰網でない | P1 | `git status` で 5 ファイル `??` / package.json scripts 記載ゼロ |
| docs/LICENSE_SETUP.md 未追跡(RTDB スキーマ運用知識が揮発) | ライセンス機構の運用再現性が個人メモ依存 | P2 | `?? docs/LICENSE_SETUP.md` |

### C9 セキュリティ / プライバシー / データ

| 項目 | 影響 | severity | 証拠 |
|---|---|---|---|
| RTDB が全 PII path で .read:true(無認証 world-readable)。sessions_log(運賃+時刻)・debug_traces(生 lat/lng 移動経路)が誰でも curl で全件取得可能 | 個人情報漏えい・認定の最小権限前提に真っ向違反(個情法 P0) | **P0** | tmp/rtdb-rules-merged.json L4-5/L10-11/L28 |
| fare_config/sessions_log/vehicles の .write に認証なし | 課金根拠(封印パラメータ相当)を外部から改ざん可能 | **P0** | tmp/rtdb-rules-merged.json L7/L11/L16-18 |
| debug_traces 書込ゲートが平文ハードコード WRITE_KEY='DAIKOME_DEBUG_2026' のみ | なりすまし投入+公開読みで機密性も完全性も無い | **P0** | debug-trace.js:46 / debug-log-uploader.js:50 / index.html:5116 |
| OSRM /match に生 GPS 座標列を公開デモサーバへ POST(本番でも同一)・privacy.html 委託先に未記載 | 完全オフライン違反・未開示の第三者提供・SLA/DPA 無し | **P0** | osrm-client.js:40,76-82 / debug-config.js:268-269 / privacy.html:240-246,207 |
| debug_traces(生 lat/lng)の活性化が training 同意から完全分離・prod 以外で同意ゼロ ON | 最も機微な生 GPS が同意なく公開 RTDB へ | **P0** | debug-trace.js:79-94,124-132,181 / debug-config.js:18,29 |
| privacy.html 記載が実装と矛盾(§3 位置情報取得しない / §9 最小権限 vs 実態) | 規約不実記載(景表法/個情法リスク・認定で致命) | **P0** | privacy.html:207,263 vs debug-trace.js:124-132 / rules L10,28 |
| 学習同意バナーの「閉じる(✕)」が opt-in 化するダークパターン(OK/閉じる いずれも ON) | 有効な同意取得とは言えない | P1 | index.html:3886-3891,3913-3915,3783 |
| HTTP セキュリティヘッダ欠落(CSP/X-Content-Type-Options/Permissions-Policy) | inline script 多数の 567KB index.html で XSS 緩和なし | P1 | vercel.json headers に CSP 等なし |

> ★caveat: tmp/rtdb-rules-merged.json は Console 実 rules と一致保証なし(tmp 配下)。ただし client コメントが同 rules を前提に書かれ world-readable は設計意図として確定。実 Console 確認は司さん作業要=未確認。

### C10 アーキ整合 / 複雑性

| 項目 | 影響 | severity | 証拠 |
|---|---|---|---|
| 距離(課金)パスに network 依存の OSRM teacher が混入(weight 0.7 で transition blend → outSnap → distance_m) | online/offline で同一 trace の distance_m が非決定的。改ざん不能/再現性/完全オフライン前提に反する | **P0** | map-matcher.js:2282-2285,2274-2287 / osrm-client.js:40 / 配線 248-288→3418→meter.js:238-248 |
| distance_m 加算経路が実は2本(単一経路の設計主張が崩壊) | worker B 不在時 gap-fill(speed×time)が distance_m 直接加算・never-over coast 保護外 = 過大課金の穴 | **P0** | meter.js:519-540 / header 矛盾 L36-38 / 到達経路 index.html:5442-5457 |
| 道路距離 routing が2実装に分裂(RoadGraphRouter と tile/backbone CH が同一幾何を別アルゴ二重計算) | routing 乖離で snap 選択と距離が不整合・over +58% の一因。1幾何=2ルータは複雑化 | P1 | pipeline-distance.js:356-581 / map-matcher.js:473-524,1772-1878,2276 |
| 層分離を強制する arch テストが実質プレースホルダ(自明 assert + no-require-sw のみ) | 距離/表示/課金分離・単一経路・never-over の本質 invariant を機械検査せず | P1 | arch-rules.test.js:66-78,145 |

---

## (2) カテゴリー別【要らない=削る(unnecessary)】

| カテゴリー | 項目 | 理由 | removalRisk | 証拠 |
|---|---|---|---|---|
| C1 | Viterbi commit 機構一式(newCommitted/lastCommittedSnap/backtrace/top2 deferral)+ gap-routing guard + tentative + reset flush | 課金は pipelineDeltaM 単一経路のみ。これらは mm_distance_m/廃止 tier2/preview にしか流れず巨大 Viterbi 課金経路が宙に浮く | high(distance_m 隣接=司さん裁定) | meter.js:238-245 / map-matcher.js:3251,2931-2943 |
| C1 | tile routing / backbone graph / OSRM 教師 / pheromone / grid-bias / POI / cross-user pheromone の routing 群 | billing は別実装 RoadGraphRouter で算出され tile/backbone/OSRM routing は課金に届かない | high | pipeline-distance.js:356-581 / map-matcher.js:530,3121,3202,3291 |
| C1 | _prepareBatch computeDistance(同期バッチ・coast なし) | 本番は ingest 逐次のみ・本番非経路 | low | pipeline-distance.js:788,814-817 |
| C1 | _nearestNodeLinear(線形 fallback)・撤回機能の死コメント | index 構築済で通常到達せず保険 | low | pipeline-distance.js:635-648,373-377 |
| C2 / C3 / C8 / C10 | tier2_pending_m / business_tier2_pending_m / gps_predictive_distance_m / offroad_distance_m / offroad_count / gap_fill_count / gap_fill_total_m / mm_distance_m mirror(always-0 後方互換キー群) | 全て 0 固定の死荷物。state 形状を肥大化させ「どれが生きた距離か」を曖昧化。gps_predictive_distance_m は読み手ゼロだが deadcode テストが存在を固定=test 連動でしか消せない | medium(一部 high) | meter.js:73-84,347-357,461-471 / node 実測=0 / deadcode-and-accelbuffer-drain.test.js L96-97 |
| C2 | _calcFareForPreview の legacy 分岐(+1 off-by-one) | 線形列挙へ切替宣言済なのに第三の計算が残存・混乱源 | medium | index.html:11135-11142 vs 11195-11203 |
| C3 / C8 | DISP_CATCHUP_TAU_S 定数(void で lint 黙らせ) | 旧指数 catch-up 時定数・現等速設計で完全死蔵 | low | meter.js L95,L102 |
| C3 | DISP_RATE_EMA_ALPHA 経由 rate EMA + _target_velocity_mps(停車後クリープの一因) | 素通し設計では velocity 推定項自体が不要 | high | meter.js L832,L859,L865 |
| C3 / C10 | gap-fill 経路(meter.js update L519-540・Worker B 不在時のみ発火) | 本番は Worker B 常在で事実上発火しない死に近いコード(ただし C10 では「到達可能な第2課金経路」として missing 側にも計上) | high | meter.js L519-522 / index.html setMapMatcher 経由常在 |
| C3 / C8 | _offRoadGraceUntil escape hatch / checkStationary(旧 speed 静止判定)/ inertialDriftHint / hardBrake echo | 新距離で未使用と明記・consumer ゼロの dead-end | low〜medium | meter.js L154,L380 / gps-worker.js:443-465,415-441,906 |
| C4 | ジャイロ収集パイプライン(gps.js→worker の転送・echo) | 計算で未参照の純コスト。ただし将来 heading 維持に使う余地があり「削除」より「接続」が本筋 | low | gps.js:266-274,555-556 / gps-worker.js:903-904 / training-collector.js:182 が別経路 |
| C4 | フォールバック経路 processPositionFallback(Fix①〜④/ZUPT/compass-Q 無し) | worker 非対応ブラウザ皆無・判定が worker 経路と大幅乖離=検証外の隠れ経路 | medium | gps.js:630-735 vs gps-worker.js:561-909 |
| C5 | tmp/ の RTDB ルール backup JSON 複数残置 | repo に正本 rules が無く権威所在が不明瞭 | low | tmp/rtdb-rules-backup-*.json, rtdb-rules-merged.json / repo に database.rules.json なし |
| C5 | calcFare の add_distance_m<=0 ガード(不正値を黙って 1m 課金継続) | 認定上は fault 化すべきを黙殺する過剰フォールバック(変更は司さん裁定) | high | meter.js:663 |
| C6 / C9 | production PWA に焼き込まれた GitHub Contents API 自動 push(PAT 経路) | 開発専用 dead-in-prod・攻撃面/コード重量の純増 | low | index.html:9603-9710 |
| C6 / C9 | debug-trace.js / debug-log-uploader.js / openreplay / Sentry CDN の本番常駐 + console 全文外部送信 | offline-first を汚す外部依存・console に PII 混入→public RTDB 送信 | medium | index.html:4893,4963,5119 / debug-log-uploader.js:161-176 |
| C6 / C9 | index.html:5116 の inline trace upload(平文 writeKey 直書き・debug-trace.js と重複) | 同一 path への二重実装・平文 writeKey 露出を増やす | low | index.html:4984,5116 |
| C6 | misc-jp/peaks-jp/hiking-trails-jp/waterways-jp の SWR 登録(PRECACHE 除外済) | 「絶対使わない」と除外宣言済なのに fetch ハンドラに死に分岐残存 | low | sw.js:319,326-329 vs 52-54 |
| C9 | rules 内 test_logs($lid 数値のみ・.read:true / .write 可) | テスト path が公開 read/write 開放のまま | low | tmp/rtdb-rules-merged.json L23-26 |
| C8 / C10 | index.html.full-backup(548KB・12,215行) | git 履歴があるのに巨大手動複製が working tree 常駐・全行差分の死スナップショット | low | wc -l / diff 全行差分・参照ゼロ |
| C8 | スクラッチダンプ all_traces.json(6.1MB)/console_lines.txt(1.9MB)/seg1.json(299KB)・計約8.3MB 未追跡 | 参照ゼロの一過性ダンプ・.gitignore 未登録で誤コミット温床 | low | grep 0 hit / .gitignore 未登録 |
| C8 | r4-build-osrm.sh(別環境用 OSRM 構築スクリプト)・未追跡ルート .md 8件・docs 日付別 11件 | PWA 本体に不要な運用残骸/引き継ぎメモ乱立 | low〜medium | `??` 各ファイル / .gitignore は HANDOVER*/PROMPT_NEW_CHAT のみ |
| C8 | index.html L8149-8156 圏外補完 UI 分岐(offroad_count/gap_fill_count ガード) | meter.js で常に 0 固定 = 到達不能 UI | medium | meter.js L81-84 / index.html L8153-8156 |
| C10 | mmIncrementM / tentativeIncrementM / tentativeDistanceM(毎フレーム算出&postMessage されるが meter.js 非消費) | 純粋な CPU/帯域浪費+混乱源・司さん核心「複雑化するな」に直撃 | medium | map-matcher.js:3020-3303,3394-3419 / meter.js:227-297 |
| C10 | OSRM teacher 一式(osrm-client.js + _osrmTeacher/_addToOsrmBuffer/blend) | オフライン認定メーターに online teacher を入れる正当性なし・距離を非決定化。transition は自前 _routeDistance 単独で成立 | medium | osrm-client.js 全体 / map-matcher.js:32,821-827,2190-2285 |
| C10 | business.js last_meter_distance_m(自称「未使用」)/ DISP_CATCHUP_TAU_S | 毎フレーム更新するが読まれない死フィールド | low | business.js:42,245-246 / meter.js:95,102 |

---

## (3) sim 実数値の要点(全て HEAD 9181da3c の fresh node 実行)

**full-pipeline Monte-Carlo(N=120 が一次証拠・N=20 が裏付け。N=500 は ~88min でツール timeout 超過のため未完走)**

- allPass: **83/120 = 69.2%**(N=20 では 13/20 = 65.0% で整合)
- 契約 (1) 過大/over-charge FAIL: **0/120(max 0.00000m)** — never-over 鉄壁
- 契約 (2) 単調違反 FAIL: **0/120**
- 契約 (3) >10m/frame jump FAIL: **0/120(max 2.40m)**
- 契約 (4) stop-residual >1m FAIL: **24/120 = 20.0%(max 578.09m, p95 50.40m)**
- 契約 (5) stopped-but-moves FAIL: **24/120 = 20.0%(max 578.09m, p95 45.09m)**
- 契約 (6) latch 不一致 FAIL: **0/120(max 0.000000m)**
- 契約 (7) 距離精度 |err|>5% FAIL: **23/120 = 19.2%**(median 0.00% / p95|.| 24.95% / max|.| 58.47%)
  - **over 側(coast over-fill = 認定 −4〜0% 帯違反 = 過大課金): 32 件・median +2.16%・MAX +58.47%(認定致命)**
  - under 側(穴が埋まらない): 39 件・median −1.04%・MIN −40.96%
- hole vs no-hole FAIL: **hole 34/90 = 37.8% vs no-hole 3/30 = 10.0%** — gap(トンネル/ビル街)が失敗の主因

**display-only Monte-Carlo(N=500・既知値を完全再現)**

- allPass: **99/500 = 19.8%**
- 契約 (4) stop-residual FAIL: 387/500(max 1426.12m)
- 契約 (5) stopped-but-moves FAIL: 401/500(max 969.20m)
- 契約 (1)(2)(3)(6): 全て 0 FAIL
- lump(gap) vs no-lump: 322/355 = 90.7% vs 79/145 = 54.5%
- ★harness caveat: display sim は gap を lump setDistance で注入し実 coast 分岐を bypass。1426m/969m は誇張された harness 産物。**信頼すべきは full-pipeline の max 578m**。
- CONTINUOUS=1(距離連続化)実験: PASS 214/500(42.8%)・no-lump 依然 55.5% FAIL = **連続化だけでは不足、cap 除去が必須**。

**ゲート(全て PASS だが self-labeled PROXY=gps-worker 迂回・ground-truth road label なし)**

- creep(3 台): creep 0.0m all / distance_m iPhone13 9.71・SE 9.62・Android 10.35 km / max snap jump Android 340m
- doppler-rej: accept-rate iPhone13 95.7%(64 rejects, good-fix 1 件誤棄却)/ SE 99.8% / Android 100%。**3 台とも 2-leg タイヤ真値 12.32km を −1.97〜−2.70km 過少**(課金安全側だが精度 headroom を残す)
- snap-accuracy heading-align p90: iPhone13 19.42°・Android 15.82°・**iPhone SE 80.86°(突出 outlier・mean 24.18° vs 他 ~6°)** = SE map-matching の方位読みが顕著に悪い
- snap residual GPS→snap p90/max: iPhone13 4.79/92.87m・SE 4.07/20.01m・Android 3.82/22.58m・flip-flops 0 all

**未確認(本セッションで取得できず)**: N=500 full-pipeline 完走 / 実機3台「画面値=真値」のライブ再現(数値は fixture replay 由来)/ SE heading 80.86° の distance_m への下流影響分離 / iOS compass 拒否率・GPS 高度実誤差(外部事実)。

---

## (4) 認定到達までの優先順ロードマップ

### P0(認定致命 — 即着手)

1. **過大課金 over +58.47% の根治(距離供給側 de-bias)** — coast の累積 over-fill が −4〜0% 帯を破る。司さん指示で一律係数禁止のため、(a) 加速度 accel-stationary を coast 停止トリガに配線(穴中減速を物理的に検知)、(b) routingMaxRatio=4.0 / snapMaxDistM=50 の accuracy 連動厳格化、(c) billing に Viterbi 窓拘束を接続。**いずれも distance_m 設計核 = 司さん裁定マター**。
2. **distance_m 加算経路の一本化** — worker B 不在 gap-fill(speed×time・never-over 保護外)を含む第2経路を断つ。OSRM teacher の network 依存を distance パスから外し改ざん不能/再現性を回復(transition は自前 _routeDistance で成立)。司さん裁定マター。
3. **認定インフラ新設(現状ゼロ)** — ①封印パラメータ(fare_config を Auth 必須・自 device のみ write へ最小化)②改ざん不能 audit trail(変更全記録・署名)③significant fault 自動表示/計測停止 ④タイヤ外径補正パラメータ+入力 UI。
4. **RTDB rules の最小権限化** — 全 PII path の無認証 world-readable を Auth 必須+自 device/session のみへ。debug_traces/test_logs は write 封鎖か期限付き。privacy.html 記載と実装の不一致(位置情報取得・OSRM 越境)を解消し同意取得。
5. **CI ゲート昇格** — gate-road-distance(穴あり/減速 fixture 追加で over 側 fail 化)+ sim-fullpipeline-montecarlo(契約 4/5/7 を assert 化)を PR 必須ゲートへ。git 未追跡の js/license.js・検証ツール群を追跡化(clean deploy 404 防止)。
6. **停車後ドンの根治(表示層 cap 全廃+素通し)** — DISP_CATCHUP_MAX_MPS=24m/s cap と rate EMA を撤去し、停車検知 → display 即 latch を配線(isStationary を表示層へ伝播)。決定済アーキ「dead-reckon 連続化+表示素通し」を実装。

### P1(精度/堅牢性 — P0 と並行可)

7. GPS native heading を map-matcher へ forward(compass null 端末の snap 精度回復・SE 改善)。compass-Q 融合の低速ゲート緩和。
8. ジャイロを heading 維持/旋回検出に接続(現状完全死蔵を「接続して活かす」)。
9. 料金端数の floor 統一(Math.round 過大・tiers off-by-one・プレビュー不一致の解消)。夜間割増の区間別適用。
10. 実機3台「画面値=真値」の自動再現・汚い GPS ジッタ property テスト追加(creep 真因の回帰網)。
11. cold-offline 堅牢性: firebase-config.js を typeof guard 化・コアアプリ JS を PRECACHE 登録・外部 CDN を critical path から外す。
12. arch-rules.test を本質 invariant(距離/表示/課金分離・単一経路・never-over)の機械検査へ。1年無調整維持・完全性署名の検証テスト新設。

### P2(整理/UX — 認定後でも可)

13. 死にコード/残骸の削除(司さん裁定後): always-0 後方互換キー群・mmIncrementM/tentative・OSRM teacher 一式・index.html.full-backup・スクラッチダンプ ~8.3MB・GitHub PAT 自動 push・debug 計装の prod 既定 OFF。2ルータ(RoadGraphRouter / tile-CH)の統廃合。
14. DEM 解像度向上 or altitude layer score の見直し。under 側 −40.96%(blackout 距離消失)の UX 改善。
15. page-lifecycle elapsed_sec 保存修正・business_state 失効ガード・同意バナーの明示 opt-in 化・CSP 等セキュリティヘッダ追加・LINE 通知併用(scope 要確認)。

> 監査原則の再掲: 緑 ≠ 完成。全ゲートは proxy(gps-worker 迂回・ground-truth なし)で necessary-not-sufficient。実機3台の「画面値=真値」検証が未達の認定基準として残る。本監査はコードを 1byte も変更していない。
