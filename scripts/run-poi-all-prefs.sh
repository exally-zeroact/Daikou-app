#!/usr/bin/env bash
# 47県分の POI を順次 Overpass で取得 + ビルドする オーケストレータ
#
# 各県:
#   1. fetch-pref-poi-overpass.js で OSM POI 取得 → input/{pref}/poi.geojson
#   2. build-poi.js で data/poi-{pref}.js 生成
#
# レジューム:
#   data/poi-{pref}.js が存在し traffic_signals|level_crossing|peak のいずれか
#   が含まれていれば「新カテゴリ込みで生成済」とみなしてスキップ

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG="$ROOT/tmp/poi-build-progress.log"
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "=========================================="
echo "  POI 47 県 一括生成 (50 カテゴリ・OSM Overpass)"
echo "  Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

PREFS=(
  hokkaido
  aomori iwate miyagi akita yamagata fukushima
  ibaraki tochigi gunma saitama chiba tokyo kanagawa
  niigata toyama ishikawa fukui yamanashi nagano gifu shizuoka aichi
  mie shiga kyoto osaka hyogo nara wakayama
  tottori shimane okayama hiroshima yamaguchi
  tokushima kagawa ehime kochi
  fukuoka saga nagasaki kumamoto oita miyazaki kagoshima okinawa
)

TOTAL=${#PREFS[@]}
COMPLETED=0
SKIPPED=0
FAILED=0
FAILED_LIST=()

START_EPOCH=$(date +%s)

for i in "${!PREFS[@]}"; do
  PREF="${PREFS[$i]}"
  IDX=$((i + 1))

  echo
  echo "─────────────────────────────────────────"
  echo "[$IDX/$TOTAL] ▼ $PREF  $(date '+%H:%M:%S')"
  echo "─────────────────────────────────────────"

  # レジューム判定: 新カテゴリ込みかどうか
  POI_FILE="data/poi-$PREF.js"
  if [ -f "$POI_FILE" ] && grep -qE '"(traffic_signals|level_crossing)"' "$POI_FILE" 2>/dev/null; then
    SIZE=$(stat -c %s "$POI_FILE" 2>/dev/null || stat -f %z "$POI_FILE")
    echo "  レジューム: 新カテゴリ込み ($SIZE bytes) → スキップ"
    SKIPPED=$((SKIPPED + 1))
    COMPLETED=$((COMPLETED + 1))
    continue
  fi

  set +e
  T_START=$(date +%s)

  echo "  [1/2] fetch-pref-poi-overpass"
  node scripts/fetch-pref-poi-overpass.js "$PREF" 2>&1 | tail -10
  RC1=$?

  echo "  [2/2] build-poi"
  if [ -f "input/$PREF/poi.geojson" ]; then
    node scripts/build-poi.js "input/$PREF/poi.geojson" "$PREF" 2>&1 | tail -3
    RC2=$?
  else
    echo "  poi.geojson not found"
    RC2=1
  fi

  T_END=$(date +%s)
  ELAPSED=$((T_END - T_START))

  if [ $RC1 -eq 0 ] && [ $RC2 -eq 0 ]; then
    echo "  ✅ $PREF 完了 (${ELAPSED}s)"
    COMPLETED=$((COMPLETED + 1))
  else
    echo "  ❌ $PREF 失敗 RC=$RC1/$RC2 (${ELAPSED}s)"
    FAILED=$((FAILED + 1))
    FAILED_LIST+=("$PREF")
  fi
  set -e

  ELAPSED_TOTAL=$(($(date +%s) - START_EPOCH))
  ELAPSED_HM=$(printf '%dh%02dm' $((ELAPSED_TOTAL/3600)) $(( (ELAPSED_TOTAL%3600)/60 )))
  echo "  進捗: $IDX/$TOTAL (完了 $COMPLETED ・スキップ $SKIPPED ・失敗 $FAILED ・経過 $ELAPSED_HM)"
done

echo
echo "=========================================="
echo "  最終レポート"
echo "=========================================="
ELAPSED_TOTAL=$(($(date +%s) - START_EPOCH))
echo "総所要時間: $(printf '%dh%02dm' $((ELAPSED_TOTAL/3600)) $(( (ELAPSED_TOTAL%3600)/60 )))"
echo "完了: $COMPLETED / $TOTAL"
echo "スキップ: $SKIPPED"
echo "失敗: $FAILED"
if [ ${#FAILED_LIST[@]} -gt 0 ]; then
  echo "失敗県: ${FAILED_LIST[*]}"
fi

echo
echo "Finished: $(date '+%Y-%m-%d %H:%M:%S')"
