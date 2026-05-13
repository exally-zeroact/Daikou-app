#!/usr/bin/env bash
# 47 県を v7 (T6 maxspeed + DP=3) で再 build する一時オーケストレータ
# 2026-05-09 専用・国土地理院 1/2,500 不採用の代替策
# tmp/{pref}-roads-v6.geojson は既存 (Overpass cache) を再利用

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LOG="$ROOT/tmp/v7-rebuild-progress.log"
exec > >(tee -a "$LOG") 2>&1

declare -A REGION_OF
for p in hokkaido; do REGION_OF[$p]=hokkaido; done
for p in aomori iwate miyagi akita yamagata fukushima; do REGION_OF[$p]=tohoku; done
for p in ibaraki tochigi gunma saitama chiba tokyo kanagawa; do REGION_OF[$p]=kanto; done
for p in niigata toyama ishikawa fukui yamanashi nagano gifu shizuoka aichi; do REGION_OF[$p]=chubu; done
for p in mie shiga kyoto osaka hyogo nara wakayama; do REGION_OF[$p]=kansai; done
for p in tottori shimane okayama hiroshima yamaguchi; do REGION_OF[$p]=chugoku; done
for p in tokushima kagawa ehime kochi; do REGION_OF[$p]=shikoku; done
for p in fukuoka saga nagasaki kumamoto oita miyazaki kagoshima okinawa; do REGION_OF[$p]=kyushu; done

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
START_EPOCH=$(date +%s)

echo "=========================================="
echo "  v7 47 県再 build (T6 maxspeed + DP=3)"
echo "  Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

for i in "${!PREFS[@]}"; do
  PREF="${PREFS[$i]}"
  REGION="${REGION_OF[$PREF]}"
  IDX=$((i + 1))
  OUT_FILE="data/roads-$PREF.js"

  if [ -f "$OUT_FILE" ] && grep -q '"v":7' "$OUT_FILE" 2>/dev/null; then
    echo "[$IDX/$TOTAL] $PREF: 既に v7 → スキップ"
    SKIPPED=$((SKIPPED + 1))
    COMPLETED=$((COMPLETED + 1))
    continue
  fi

  GEOJSON="tmp/$PREF-roads-v6.geojson"
  if [ ! -f "$GEOJSON" ]; then
    echo "[$IDX/$TOTAL] $PREF: 入力 geojson なし・skip"
    FAILED=$((FAILED + 1))
    continue
  fi

  T_START=$(date +%s)
  echo "[$IDX/$TOTAL] $PREF ($REGION) ▼"

  set +e
  node scripts/build-roads.js "$GEOJSON" data "$REGION" --dem --only="$PREF" 2>&1 | tail -3
  RC=$?
  set -e
  T_END=$(date +%s)
  ELAPSED=$((T_END - T_START))

  if [ $RC -eq 0 ] && [ -f "$OUT_FILE" ]; then
    SIZE=$(stat -c %s "$OUT_FILE" 2>/dev/null || stat -f %z "$OUT_FILE")
    echo "  ✓ $PREF 完了 ${ELAPSED}s ${SIZE}B"
    COMPLETED=$((COMPLETED + 1))
  else
    echo "  ✗ $PREF 失敗 RC=$RC"
    FAILED=$((FAILED + 1))
  fi
  ELAPSED_TOTAL=$(($(date +%s) - START_EPOCH))
  printf "  進捗: %d/%d (完了%d/skip%d/失敗%d) 経過 %dh%02dm\n" \
    "$IDX" "$TOTAL" "$COMPLETED" "$SKIPPED" "$FAILED" \
    $((ELAPSED_TOTAL/3600)) $(((ELAPSED_TOTAL%3600)/60))
done

echo "=========================================="
echo "  完了: $COMPLETED / $TOTAL (skip $SKIPPED / failed $FAILED)"
echo "=========================================="
du -bcs data/roads-*.js | tail -1
