# ダイコメ GPS 受理パイプライン 根治再設計レポート (2026-05-29)

実機トレース `-OtlpsOqAvS6LDHPCSef` (iPhone13 / device 7a9329f7 / 今治市 / running=true 実走) 解析。
4 調査統合: 業界調査 / 学術調査(GNSS航法フィルタ) / コード監査 / トレース定量。
distance_m 加算 5 経路・calcFare・Worker B Viterbi は **1byte 不変**。完全オフライン前提。
**実機検証前に「直った」とは一切宣言しない。**

---

## 1. 結論(真因)

**距離過少 8.54km vs 実走 9.28km(-736m / -7.9%)の単一支配要因は、Doppler-Speed Sanity Gate (gps-worker.js L661-689) が「速度の不整合を理由に高精度な位置 fix を丸ごと return null で破棄する」設計。**

- seg1(1582点・26.5分・raw haversine 9276m)の全 797 件 GPSREJ が **src=dop(Doppler起点)**
- 内訳: doppler sanity 321 / doppler投影由来 jump 473 / heading 1 / accuracy 2
- 却下点の doppler 速度 median 25〜38 m/s(90〜135km/h)に対し、実 ground speed は median **6.5 m/s(23km/h)**、20m/s 超は 1581区間中わずか1件(0.1%)
- → iPhone の Doppler が真速度を **3〜5倍 過大報告** → `|dopplerMs - haverMs| > 10 m/s` ゲートが誤発火 → 良質な位置(acc中央値4.2m)が速度ノイズだけで捨てられる

**損失内訳(合計 -736m = deficit と完全一致):**
| 原因 | 損失 |
|---|---|
| doppler sanity gate (return null) | -330m |
| doppler起点 jump gate | -300m |
| Meter over-clamp (283m→31m, 52m→14m) | -90m |
| MM gap-skip (過少安全側) | -14m |
| accuracy/heading | -2m |

---

## 2. 証拠(トレース × コード × 文献 の三点裏取り)

| 論点 | 結論 | 根拠 |
|---|---|---|
| どちらの速度が信頼できるか | **Doppler が正・haversine が noisy。否決の向きが逆** | Doppler は cm/s 精度(Xiaomi Mi8 RMS 2cm/s, Angrisano 2022 PMC9655395)、位置差分は m/s 級で短区間過大評価(Ranacher 2015 PMC4786863) |
| 位置を丸ごと捨てる是非 | **航法理論的に誤り。速度異常は位置の有効性を否定しない** | GNSS/INS 故障検出は位置(疑似距離)と速度(疑似距離レート)を別チャネル検証(USPTO 8374785)。一成分異常はその成分のみ除外し位置保持(Zair 2016 PMC4851094, Chang 2014, MERL TR2018-173) |
| ゲートの統計的妥当性 | **固定10m/s生差分は妥当な統計検定でない** | 正解は innovation 空間で Mahalanobis/NIS を共分散正規化し χ² 閾値判定(Chang 2014, Jiang&Zhang 2018 PMC5876522) |
| 発火頻度の異常性 | **約50%却下は物理的にあり得ず誤発火の証拠** | Doppler の真の外れ値率は約2.85%(Zair 2016) |
| 規制基準 | **-7.9% は基準逸脱** | 国交省令和7年1月認定要領: 距離誤差 -4.0%〜0%、過大禁止・過少も4%以内が義務(mlit 001860154.pdf)。認定済の二葉計器は GNSS 不良時に速度で位置を補足=捨てない(futabakeiki 2025-03) |

---

## 3. 根治再設計(gps-worker.js / gps.js のゲートのみ・段階導入せず一気)

### 設計原則
位置観測と速度観測は物理的に独立(Doppler=搬送波周波数シフト由来)。**速度の異常は位置の有効性を否定する根拠にならない。** ゆえに「位置は常に受理し、速度成分のみ信頼度を操作する」ソフト棄却へ作り直す。業界(逆共分散重み付け・適応ゲート)と学術(per-measurement exclusion・robust reweighting)の双方が支持する唯一の正解。

### 3.1 Doppler-Speed Sanity Gate (L661-689) — 全面置換
1. **`return null`(位置含む全破棄)を撤廃。位置 fix は無条件受理・lastPosition 毎フレーム更新。** これ単独で doppler 321 + 連鎖 jump 473 の大半が解消見込み。
2. **速度の信頼向きを反転**: haversine が Doppler と乖離したら haversine 側を疑う。外れた瞬間値は当該フレームの速度重みのみ下げ、位置は保持。
3. **doppler を検査するなら χ² 正規化 + per-measurement 除外に限定**: 生差分 `|dopplerMs - haverMs| > 10` 撤廃。速度残差を innovation 分散 S で正規化し NIS=r²/S を χ²(95%,1dof)=3.84 で判定。異常時も棄却は速度成分のみ。二重ログ由来の Δt 潰れを正規化前段で除去。
4. **閾値の物理整合**: 却下率が数%を大きく超えるなら閾値が誤り、という自己検証基準を組込む。

### 3.2 Jump Gate (L646-659) — doppler 投影の遮断
- jump 計算入力を **実測 GPS 位置のみ**に限定し doppler 投影を渡さない。
- 3.1 で lastPosition が毎フレーム更新されるため stale による Δt インフレが消え、jump 誤発火が構造的に解消。
- 閾値 50m/s は replay で実イベント 0 件(無実)→ **現状維持**。

### 3.3 その他ゲート — 現状維持
accuracy(replay で acc>20m 2件のみ)/ acceleration / heading(isReverse 後退保持済)は維持。

### 3.4 MM gap-skip / Meter clamp — 受理率回復で間接是正
3.1/3.2 で却下点が激減し受理点が連続化すれば gap-skip(seg1 で35件)・over-clamp(283m→31m)自体が発火しなくなる。**MM/Meter ロジックは触らず**入力健全化で -104m 回収。

### 3.5 不可侵境界
distance_m 加算 5 経路 / calcFare / Worker B Viterbi は 1byte 不変。改修は gps-worker.js 受理ゲート(L646 jump 入力, L661-689 doppler)と gps.js 速度 fallback(L519-538)に限定。位置を5経路へ供給する経路は同一・供給点が増えるだけ。

---

## 4. 検証計画(テストツール先行・実機操作を司さんに投げない)

- **STEP 1 fixture 整備(実装前)**: seg1 を fixture 化。現行コードで replay し doppler 321/jump 473/business 8540m を再現できることを正当性条件に。
- **STEP 2 改修後 replay 定量**: 同一 fixture で前後比較。doppler 却下→数%へ、business→-4%〜0%(国交省基準)内へ回復、distance_m/calcFare 出力が改修前と完全一致(不可侵の自動アサーション)。pipeline-gate/e2e/watchdog で 6 ガード stale 非発火確認。
- **STEP 3 実機検証(宣言の前提)**: 業務開始ボタン押下後の running=true trace のみ有効。eruda parser で却下削減・距離回復を実機確認。offline replay PASS かつ実機確認まで「直った」と宣言しない。

---

## 5. memory「A-4 発動不可」矛盾の決着

**メモリ記載が誤り、実機側が正。** コード監査(platform 分岐なし・iOS/Android 同一コード)+ 実機ログ(iPhone13 で約321回発火 + doppler起点 jump 約473回 = 約794回/26.6分)+ トレース定量(全797 GPSREJ が src=dop)が独立して一致。
**訂正後の文言**: 「A-4 Doppler gate は iOS でも発動・実機 iPhone13 で約794回確認・過少計上-7.9%の支配要因・位置全破棄方式は撤廃しソフト棄却へ再設計」

---

## 6. 未解決 / 追加データ

1. 却下 doppler 行 spd の正体(真のmultipathスパイク or iOS位置差分フォールバック)は trace だけでは弁別不能。GPSREJ サンプルは lat/lng/acc=0 dummy schema のため分布比較に留まる。
2. iOS coords.speed の由来は Apple 非公開。speedAccuracy を S に組込む妥当性は実機 raw 比較で要確認。
3. **追加トレースの要否**: 設計確定と STEP1-2 の offline 定量には現 seg1 trace で足りる。χ² ゲート閾値の実測校正と doppler スパイク真偽弁別には **doppler速度 + speedAccuracy + 生 coords.speed を含む再トレースが望ましい**(必須でなく精度上推奨)。

---

### 主要出典
- Angrisano et al. 2022, smartphone Doppler velocity, PMC9655395
- Ranacher et al. 2015, "Why GPS makes distances bigger than they are", PMC4786863 / arXiv:1504.04504
- Zair et al. 2016, GNSS Pseudo-Range/Doppler outlier detection, PMC4851094
- Chang 2014, Mahalanobis robust Kalman, J.Geodesy 88:391
- Jiang & Zhang 2018, Mahalanobis adaptive-robust GPS/INS, PMC5876522
- MERL TR2018-173, Robustifying Kalman against outliers
- Millard-Ball et al. 2019, Map-matching poor-quality GPS
- 国交省 特定運賃収受ソフトウェア認定要領(令和7年1月) mlit 001860154.pdf
- 二葉計器 ソフトメーター認定(2025-03)
