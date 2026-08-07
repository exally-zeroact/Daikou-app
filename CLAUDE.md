# CLAUDE.md

## 実行方針

本番リポジトリ（Daikou-app / Exally）へのpush以外は全て確認なしで実行する。

-----

## リポジトリ構成

|リポジトリ          |種別  |ローカルパス                        |
|---------------|----|------------------------------|
|Daikou-app-test|テスト版|C:\Users\zeroa\Daikou-app-test|
|Daikou-app     |本番  |C:\Users\zeroa\Daikou-app     |
|Exally-test    |テスト版|C:\Users\zeroa\Exally-test    |
|Exally         |本番  |C:\Users\zeroa\Exally         |

### 開発ルール

- テスト版：複数修正まとめてpushOK
- 本番：1修正→実機確認→次（複数push禁止）
- デプロイ：GitHub push → Vercel自動（1〜2分）

### 認証方式

- GitHub CLI（gh）OAuthのみ
- PATをURLに埋め込み絶対禁止

-----

## 禁止事項

- GitHubウェブエディタ（鉛筆アイコン）使用禁止（Cloudflare汚染が入る）
- CSS変数禁止（直接hex値のみ）
- #1A2B22をコードブロックに使用禁止

-----

## push前チェック（必須）

```bash
# JS構文チェック
node --check {ファイル名}

# div開閉チェック（差分=0であること）
grep -c '<div' {ファイル名}
grep -c '</div' {ファイル名}

# Cloudflare汚染チェック（0であること）
grep -c 'data-cfemail' {ファイル名}
```

-----

## 過去の失敗パターン（再発防止）

|パターン                  |対策                 |
|----------------------|-------------------|
|スマートクォート（" "）混入       |ASCII文字のみ使用        |
|バッククォート種別ミス           |標準バッククォート（`）のみ     |
|Unicode省略記号（…）混入      |`...`を使う           |
|PATをgit configのURLに直書き|gh認証のみ・URLにトークン含めない|

-----

## デザイン値

|項目         |値                                                 |
|-----------|--------------------------------------------------|
|mint       |#52B788                                           |
|mint-dark  |#3D9E72                                           |
|mint-bg    |#F0FAF4                                           |
|コードブロック背景  |#C8ECD8                                           |
|コードブロックテキスト|#1A4A2E                                           |
|ロゴフォント     |DM Mono / 20px / weight500 / letter-spacing:-0.5px|
|本文フォント     |Noto Sans JP                                      |
|DM Mono使用箇所|ロゴ・価格・数式・コードブロック・TSV                              |

-----

## ファイル構造

```
Daikou-app/
├── index.html
├── js/
│   ├── gps.js
│   ├── business.js
│   ├── meter.js
│   └── region-loader.js
└── data/
    ├── roads-{pref}.js       # 県別47ファイル
    ├── bridges-{region}.js   # 地方別8ファイル（県別移行予定）
    ├── tunnels-{region}.js   # 地方別8ファイル（県別移行予定）
    └── meta.json

Exally/
├── book.html      # 5,998行・243KB・巨大ファイル注意
├── home.html
├── chat.html
├── claude.js      # APIモデル設定
└── vercel.json
```

-----

## Exally canvas-gridパフォーマンスルール

Exallyのコードを触るときのみ適用。

- setCell + recalcSheetをキー入力ごとに呼ばない
- recalcSheetはdebounce 150ms
- IME変換中はsetCell禁止
- visualViewportスロットル 100ms
- render()はrAFでバッチ処理
- getBoundingClientRectはキャッシュ

-----

## セッション開始時に必ず読むファイル

このリポジトリは ダイコメ (daikome) プロジェクト。
新しい Claude Code セッションを開始したら、以下を必ず読み込んで文脈を復元すること：

- `C:\Users\zeroa\zeroact-memory\team\global-rules.md`
- `C:\Users\zeroa\zeroact-memory\projects\daikome\memory.md`
- `C:\Users\zeroa\zeroact-memory\projects\daikome\decisions.md`
- `C:\Users\zeroa\zeroact-memory\projects\daikome\tasks.md`
- `C:\Users\zeroa\zeroact-memory\projects\daikome\rules.md`

-----

## 絶対ルール（全セッション共通・例外なし）

- 実装済みの機能は必ず全て課金・業務フローに接続すること
- 「業務継続性」を理由に機能を参照値・dead codeにしないこと
- 設計変更をした場合は必ずレポートに明記すること
- 安全側への勝手な格下げ禁止
- 距離計算はGoogleマップと同じようにGPSの座標を道路にスナップして道路に沿った距離で課金すること。GPS直線距離での課金は絶対に使わない

## 7. ★★コードを触る時の順番（全アプリ共通 HARD RULE・毎回・飛ばさない）★★

**①テストの道具を作る → ②テストで確かめる → ★③Claude Code が自分で実際に操作して確かめる★ → ④司さんに報告**

★このブロックは全アプリの CLAUDE.md に置く（新しく作るアプリにも必ず入れる）★
（司さん指示 2026-07-14「これから作るアプリもやから GitHub の気づく所に記憶しといて」）

### ① テストの道具が先（後付けにしない）
- 直す前に「どう測るか」を先に作る。★直してから測り方を考えると、直した物に都合のいい測り方になる★
- ★自分で書いたテストは、勘違いごと固定する★。あるべき挙動を強制する形にする
- ★わざと壊して赤になることを実測してから「緑」と呼ぶ★

### ② 全機能を実データで確かめる（計算・ロジック層）
- そのアプリの**本物のエンジン**に**全パターン（全入力の組合せ）**を流し、**期待値と assert で突き合わせる**
- 網羅・invariant・NaN/矛盾ゼロ・法定値は一次情報照合。★中間値でなく、ユーザーに見える出力で判定する★

### ③ ★Claude Code が実UIで全ボタン・全パターンを操作する★
- **人間より速く正確にできる Claude Code の強み**。実アプリを Playwright/jsdom で動かし、
  **全タブ・全ボタン・全入力**を実際に押す/打ち込む
- ★「repoに入った」「配信のバイトに入っている」「テストが緑」は、どれも操作したことにならない★
- 確認する: **JSエラー0**・各画面が描画・入力で正しく再計算・**出力(PDF/Excel/振込データ)の実生成**まで
  （＝配線が本当に生きているか）。破壊/DL/ダイアログ系はデナイリストで安全に
- ログインが要る画面は★テスト環境に自分のアカウントを作って通す★（本番で他人の垢を使わない）
- ★押していないなら「未測定」と書く★。0件・異常なしにしない

### ④ 報告
- ★報告の1行目★＝ push済みか／CIが緑か／実配信に乗っているか／★実際に操作したか★
- ★ローカル緑は CI緑ではない★。CIの結果を数字で出す
- ★見た目を変えたら、実アプリの実スクショを司さんに見せて、OKをもらうまで push しない★
  （作り物の見本ではなく★配信された本物の画面★を撮る）

### なぜ両方（②と③）要るか
計算libが緑でも「ボタンが押せる／画面が動く／出力が出る／配線されている」は**保証しない**
（過去の「lib は有るのに未配線」バグの型）。

★実際に起きた事故（2026-08-07）★
アマかせのログイン画面が Exally の緑のまま本番に配信されていた。
配信のバイトも確かめ、テストも緑だったが、★誰も本物の画面を開いていなかった★。
司さんが実機で見つけた。**「バイトを測った」は「見た」ではない。**

## 設計方針

- メーターの課金距離（state.distance_m）はMap Matching（mm）が主・GPS直線はMMが5秒以上沈黙した場合のfallbackのみ
- Worker B（map-matcher.js）に道路データが届いていない状態は絶対に許容しない
- distanceSourceは常にUI上で運転手が確認できるように表示すること
- 実装した機能が動いているかどうかを常に確認してレポートに記載すること

-----

## 国土地理院 1/2,500 道路縁データ統合手順 (Phase E・2026-05-09)

> **[ARCHIVED 2026-05-09]** 測量法 (測量成果の複製・使用承認) 申請リスクにより
> 本機能は**現在は未使用**。代替策として scripts/build-roads.js の DP_TOLERANCE を
> 5m → 3m に緩和し OSM polyline 実効精度を 1.7 倍化 (47 県再 build で実装済)。
> 将来 国土地理院がオープンデータ化した場合に再活用予定。
> 関連スクリプト (parse-gsi-2500-gml.js / merge-gsi-into-osm.js / fetch-gsi-2500-roads.js)
> およびこの節の手順は参考用に温存。--gsi-2500-dir フラグ未指定時は実行されない。

### 背景
OSM polyline (10-50m サンプル間隔) より高精度な国土地理院 基盤地図情報
1/2,500 道路縁データ (0.5-2.5m 精度) を build-roads.js に注入することで
都市部 DID (人口集中地区) の MM 精度を向上させる。

### データソース
- 配布元: 国土地理院 基盤地図情報ダウンロードサービス
- URL: https://fgd.gsi.go.jp/download/menu.php
- 形式: GML (XML)・二次メッシュ単位
- 利用条件: ユーザ登録 (氏名+メール・無料) 必須・自動 fetch 不可
- ライセンス: 国土地理院コンテンツ利用規約 (出典明記で商用可)

### 取得手順 (手動)
1. ブラウザで上記 URL にアクセス・ユーザ登録 (初回のみ)
2. 「基盤地図情報 (縮尺レベル 2500)」を選択
3. 対象都道府県の DID メッシュ一覧を確認:
   `node scripts/fetch-gsi-2500-roads.js <pref>`
4. 該当メッシュコードを画面上で選択
5. 「道路縁」レイヤを選択してダウンロード (zip)
6. zip を `input/<pref>/gsi-2500/` に展開

### 変換 + build 手順
```bash
# 1. GML → GeoJSON 変換
node scripts/parse-gsi-2500-gml.js input/ehime/gsi-2500/ \
     --output=tmp/ehime/gsi-geojson/

# 2. build (--gsi-2500-dir フラグで内部 merge)
node scripts/build-roads.js \
     input/ehime/streets.geojson \
     data/ ehime \
     --gsi-2500-dir=tmp/ehime/gsi-geojson/

# 3. (代替) merge-gsi-into-osm.js を単体で実行する場合
node scripts/merge-gsi-into-osm.js \
     input/ehime/streets.geojson \
     tmp/ehime/gsi-geojson/ \
     > input/ehime/streets-merged.geojson
node scripts/build-roads.js input/ehime/streets-merged.geojson data/ ehime
```

### マッチングアルゴリズム
- 100m × 100m 空間 grid に GSI ポリラインを index 化
- 各 OSM polyline について grid で候補抽出
- Hausdorff 距離 < 5m なら "同じ道路" と判定し OSM の geometry を GSI に置換
- properties (highway/oneway/lanes 等の OSM タグ) は維持
- 結果フラグ: `gsi_2500_merged: true` を properties に付与

### カバレッジ
- 国土地理院 1/2,500 は DID (人口集中地区) のみ整備
- 全国の DID は OSM road 全体の約 30-40%
- 期待マッチング率: DID 内で 70-90%・全体で 25-35%
- 山間部・郊外・私道は OSM のみ (変化なし)

### 注意事項
- 47 県全データ (約 50GB+) のダウンロードは数日かかる
- 自動 fetch 不可 (login 必須) のため OPERATOR が手動取得
- メッシュコード一覧の prefecture mapping は scripts/fetch-gsi-2500-roads.js
  に書かれているが現状 4 県のみ (ehime/tokyo/osaka/kanagawa)
  他 43 県は OPERATOR が国土地理院 mesh tool で確認後追加
- 商用利用には「国土地理院長承認」表記が必須
- 47 県 build はローカル PC で 1 県あたり 5-30 分・全国で半日-1 日
