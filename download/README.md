# /download/ — Android APK 配布ディレクトリ

このディレクトリには PWA Builder で生成した `daikome.apk` を配置する.

## 配置手順

1. https://www.pwabuilder.com/ で本サイト URL (https://daikou-app.vercel.app) を入力
2. Android パッケージ生成 → ZIP ダウンロード → 中の `*.apk` を取出
3. `daikome.apk` にリネームして本ディレクトリへ配置
4. ZIP に同梱の `assetlinks.json` の `sha256_cert_fingerprints` を
   `/.well-known/assetlinks.json` のプレースホルダと差し替え
5. git commit + push → Vercel 自動 deploy

## 配信 URL (Vercel deploy 後)

  https://daikou-app.vercel.app/download/daikome.apk
  Content-Type: application/vnd.android.package-archive
  Content-Disposition: attachment

## 注意

- APK ファイル自体は git にコミットしない場合, .gitignore で除外する
- 公開時は assetlinks.json の SHA256 と APK 署名鍵の SHA256 が一致している必要あり
