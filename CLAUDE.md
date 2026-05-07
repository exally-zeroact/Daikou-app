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
