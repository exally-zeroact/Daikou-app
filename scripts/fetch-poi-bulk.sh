#!/usr/bin/env bash
# fetch-poi-bulk.sh
#
# Geofabrik 地方PBF → osmium で POIタグ抽出 → 都道府県別 .poly で切出し → GeoJSON
# 既存 osm-update.yml と同じ「地方PBF」方式を踏襲（全国PBF 3.5GBは使わない）
#
# 使い方:
#   bash scripts/fetch-poi-bulk.sh [region]
#   region: shikoku | hokkaido | tohoku | kanto | chubu | kansai | chugoku | kyushu | all
#   省略時は all
#
# 必要環境:
#   - osmium-tool (Linux: apt install osmium-tool / Mac: brew install osmium-tool)
#   - curl, ls, mkdir
#
# 入出力:
#   入力: scripts/poly/{pref}.poly × 47（事前に build-poly-files.js で生成）
#   出力: input/{pref}/poi.geojson × その地方の県数

set -e

REGION_ARG="${1:-all}"

# 地方 → 都道府県リスト（build-roads.js と同じ・スペース区切り）
declare -A REGION_PREFS=(
  [hokkaido]="hokkaido"
  [tohoku]="aomori iwate miyagi akita yamagata fukushima"
  [kanto]="ibaraki tochigi gunma saitama chiba tokyo kanagawa"
  [chubu]="niigata toyama ishikawa fukui yamanashi nagano gifu shizuoka aichi"
  [kansai]="mie shiga kyoto osaka hyogo nara wakayama"
  [chugoku]="tottori shimane okayama hiroshima yamaguchi"
  [shikoku]="tokushima kagawa ehime kochi"
  [kyushu]="fukuoka saga nagasaki kumamoto oita miyazaki kagoshima okinawa"
)

if [ "$REGION_ARG" = "all" ]; then
  REGIONS="hokkaido tohoku kanto chubu kansai chugoku shikoku kyushu"
else
  REGIONS="$REGION_ARG"
fi

# osmium 必須チェック
if ! command -v osmium >/dev/null 2>&1; then
  echo "❌ osmium-tool が見つかりません" >&2
  echo "   Linux: sudo apt-get install -y osmium-tool" >&2
  echo "   Mac:   brew install osmium-tool" >&2
  echo "   Win:   WSL内 or Docker (iboates/osmium) 推奨" >&2
  echo "   ローカルWindowsで試すには: scripts/fetch-poi-pbf-local.js を使用" >&2
  exit 127
fi

# poly ディレクトリ存在チェック
if [ ! -d scripts/poly ]; then
  echo "❌ scripts/poly が見つかりません。先に build-poly-files.js を実行してください:" >&2
  echo "   node scripts/build-poly-files.js" >&2
  exit 1
fi

mkdir -p tmp input

echo "=========================================="
echo "  POI Bulk Fetch (osmium)"
echo "=========================================="
echo "  対象地方: $REGIONS"
echo

for REGION in $REGIONS; do
  PREFS="${REGION_PREFS[$REGION]}"
  if [ -z "$PREFS" ]; then
    echo "⚠️  unknown region: $REGION (skip)" >&2
    continue
  fi

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "▶ ${REGION} (県: $PREFS)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  URL="https://download.geofabrik.de/asia/japan/${REGION}-latest.osm.pbf"
  PBF="tmp/${REGION}.osm.pbf"
  POI_PBF="tmp/${REGION}-poi.osm.pbf"

  # 1. ダウンロード（既存があればスキップ）
  if [ -f "$PBF" ] && [ "$(find "$PBF" -mtime -1 2>/dev/null)" ]; then
    echo "  [1/4] DL skipped (cache <24h): $PBF"
  else
    echo "  [1/4] DL: $URL"
    curl -fsSL --max-time 1200 -o "$PBF" "$URL"
  fi
  ls -lh "$PBF" | awk '{print "       size:",$5}'

  # 2. POI タグ抽出
  echo "  [2/3] osmium tags-filter (POI tags)"
  osmium tags-filter "$PBF" \
    n/amenity w/amenity nwr/amenity \
    n/shop w/shop nwr/shop \
    n/tourism w/tourism nwr/tourism \
    n/leisure=golf_course,adult_gaming_centre,hot_spring \
    n/railway=station w/railway=station \
    n/highway=bus_stop \
    w/highway=services \
    n/aeroway=aerodrome,terminal w/aeroway=aerodrome,terminal \
    n/emergency=defibrillator \
    -o "$POI_PBF" --overwrite

  # 3. 地方単位で GeoJSON 化 → Node 側で県別分割
  # （以前は osmium extract -p .poly で県別切出ししていたが、
  #   北海道のような大きい PBF で「PBF error: blob contains no data or
  #   unknown compression method」が出るため osm-update.yml と同じ
  #   「regional GeoJSON → Node で重心最近傍振分け」方式に統一）
  REGION_GEOJSON="tmp/${REGION}-poi.geojson"
  echo "  [3/3] osmium export → ${REGION_GEOJSON}"
  osmium export "$POI_PBF" -f geojson -o "$REGION_GEOJSON" --overwrite

  echo "       split by prefecture (Node)"
  node scripts/split-poi-by-region.js "$REGION_GEOJSON" "$REGION"

  echo "✅ ${REGION} 完了"
  rm -f "$POI_PBF" "$REGION_GEOJSON"
  # 元PBFは他用途のために 24h 残す（次回のCIで再利用）
done

echo
echo "=========================================="
echo "  完了"
echo "=========================================="
echo
echo "📁 出力済み県別 POI GeoJSON:"
ls -la input/*/poi.geojson 2>/dev/null | head -50 || true
