#!/usr/bin/env bash
# 47県分のハザードデータを順次取得 + ビルドする オーケストレータ
#
# 各県:
#   1. fetch-hazard-data.js で A31/A40/A48 KSJ ZIP DL + GEOJSON 出力
#                         + OSM Overpass で fault.geojson 生成
#   2. build-hazard.js を 5 種別 (flood/landslide/tsunami/liquefaction/fault) 実行
#
# レジューム:
#   data/hazard-flood-{pref}.js が存在し count が 100 以上ならスキップ
#
# ログ: tmp/hazard-build-progress.log

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG="$ROOT/tmp/hazard-build-progress.log"
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "=========================================="
echo "  hazards 47 県 一括生成 (A31/A40/A48 + OSM fault)"
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

  # レジューム判定
  FLOOD_FILE="data/hazard-flood-$PREF.js"
  if [ -f "$FLOOD_FILE" ] && grep -q '"count":[1-9]' "$FLOOD_FILE" 2>/dev/null; then
    COUNT=$(grep -oE '"count":[0-9]+' "$FLOOD_FILE" | head -1 | grep -oE '[0-9]+')
    if [ "${COUNT:-0}" -ge 100 ]; then
      echo "  レジューム: flood count=$COUNT → スキップ"
      SKIPPED=$((SKIPPED + 1))
      COMPLETED=$((COMPLETED + 1))
      continue
    fi
  fi

  set +e
  T_START=$(date +%s)

  echo "  [1/2] fetch-hazard-data"
  node scripts/fetch-hazard-data.js "$PREF" 2>&1 | tail -8
  RC1=$?

  echo "  [2/2] build-hazard 5 種"
  RC2=0
  for t in flood landslide tsunami liquefaction fault; do
    INPUT="input/$PREF/$t.geojson"
    if [ -f "$INPUT" ]; then
      node scripts/build-hazard.js "$t" "$INPUT" "$PREF" 2>&1 | tail -2
      RC=$?
      if [ $RC -ne 0 ]; then RC2=$RC; fi
    else
      echo "    skip $t (input not found)"
    fi
  done

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
