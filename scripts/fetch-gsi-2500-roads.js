#!/usr/bin/env node
// [ARCHIVED 2026-05-09] GSI 1/2,500統合スクリプト
// 測量法申請リスクにより現在は未使用
// 将来国土地理院がオープンデータ化した場合に再活用予定
// build-roads.jsの--gsi-2500-dirフラグ未指定時は実行されない
/**
 * fetch-gsi-2500-roads.js
 *
 * 国土地理院 基盤地図情報 (FGD) 1/2,500 道路縁データの取得手順.
 *
 * 残念ながら国土地理院のダウンロードサービスは:
 *   1. ユーザ登録 (無料・氏名 + メール) 必須
 *   2. ダウンロードページの form 経由のみ (= API 自動化困難)
 *   3. zip 形式・メッシュ単位
 *
 * 自動 fetch は不可・本スクリプトは「手順表示と URL ビルド」のみ.
 * 実取得は OPERATOR が手動でブラウザ経由で行う.
 *
 * 取得後は以下のフローで build-roads.js に投入する:
 *   1. fetch-gsi-2500-roads.js で対象メッシュコード一覧を表示
 *   2. https://fgd.gsi.go.jp/download/ で手動ダウンロード
 *   3. zip 解凍 → input/{pref}/gsi-2500/ に展開
 *   4. node parse-gsi-2500-gml.js input/{pref}/gsi-2500/ --output=tmp/{pref}/
 *   5. node merge-gsi-into-osm.js {OSM-input} {tmp/{pref}/} > input/{pref}/merged.geojson
 *   6. node build-roads.js input/{pref}/merged.geojson data/ {pref}
 *
 * 使い方:
 *   node scripts/fetch-gsi-2500-roads.js <pref>
 *   node scripts/fetch-gsi-2500-roads.js ehime
 */

'use strict';

const PREFECTURES_DID_MESHES = {
  // 各県の主要 DID (人口集中地区) を含む二次メッシュコード
  // 国土地理院の二次メッシュ一覧から抽出 (将来要拡充)
  // 例: 5237 = 松山市付近・5238 = 今治市付近
  ehime: ['5132', '5133', '5232', '5233', '5234', '5235', '5237', '5238', '5333', '5334'],
  tokyo: ['5339', '5340', '5439', '5440', '5538', '5539'],
  osaka: ['5135', '5136', '5235', '5236'],
  kanagawa: ['5239', '5339'],
  // 他 47 県分は OPERATOR が国土地理院 mesh tool で確認して追加
};

function main(){
  const pref = process.argv[2];
  if(!pref){
    console.error('Usage: node scripts/fetch-gsi-2500-roads.js <prefecture>');
    console.error('Available presets: ' + Object.keys(PREFECTURES_DID_MESHES).join(', '));
    process.exit(1);
  }
  const meshes = PREFECTURES_DID_MESHES[pref];
  if(!meshes){
    console.error('No DID mesh preset for ' + pref + '・国土地理院 mesh tool で確認後追加してください');
    process.exit(1);
  }
  console.log('国土地理院 1/2,500 道路縁データ ' + pref + ' 用ダウンロード手順');
  console.log('');
  console.log('Step 1: ブラウザで以下にアクセス (ユーザ登録必須・無料):');
  console.log('  https://fgd.gsi.go.jp/download/menu.php');
  console.log('');
  console.log('Step 2: 「基盤地図情報 (縮尺レベル 2500)」を選択');
  console.log('');
  console.log('Step 3: 以下の二次メッシュをダウンロード対象として追加:');
  for(const m of meshes){
    console.log('  - ' + m);
  }
  console.log('');
  console.log('Step 4: 「道路縁」レイヤを選択してダウンロード');
  console.log('');
  console.log('Step 5: zip を以下に展開:');
  console.log('  input/' + pref + '/gsi-2500/');
  console.log('');
  console.log('Step 6: GML → GeoJSON 変換:');
  console.log('  node scripts/parse-gsi-2500-gml.js input/' + pref + '/gsi-2500/ \\');
  console.log('       --output=tmp/' + pref + '/gsi-geojson/');
  console.log('');
  console.log('Step 7: build に投入:');
  console.log('  node scripts/build-roads.js input/' + pref + '/streets.geojson \\');
  console.log('       data/ ' + pref + ' \\');
  console.log('       --gsi-2500-dir=tmp/' + pref + '/gsi-geojson/');
  console.log('');
  console.log('注: 商用利用には 国土地理院長承認 第○○号 の取得が必要 (出典明記必須)');
}

if(require.main === module) main();
