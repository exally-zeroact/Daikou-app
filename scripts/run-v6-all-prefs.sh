#!/usr/bin/env bash
# 47 県の roads-v6 を順次生成する オーケストレータ
#
# 各県:
#   1. fetch-dem-tiles.js で 5mDEM PNG 取得 (キャッシュ済はスキップ)
#   2. fetch-pref-roads-overpass.js で OSM 道路 取得 (7日キャッシュ)
#   3. build-roads.js --dem --only=<pref> で v6 ビルド
#
# レジューム:
#   data/roads-{pref}.js が "v":6 を含めばスキップ
#
# エラー:
#   1 県失敗しても次の県に進む (set +e セクション)
#
# 進捗ログ: tmp/v6-build-progress.log

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG="$ROOT/tmp/v6-build-progress.log"
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "=========================================="
echo "  roads v6 47 県 一括生成"
echo "  Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

# 地方 → 都道府県（build-roads.js が要求する region 引数決定用）
declare -A REGION_OF
for p in hokkaido; do REGION_OF[$p]=hokkaido; done
for p in aomori iwate miyagi akita yamagata fukushima; do REGION_OF[$p]=tohoku; done
for p in ibaraki tochigi gunma saitama chiba tokyo kanagawa; do REGION_OF[$p]=kanto; done
for p in niigata toyama ishikawa fukui yamanashi nagano gifu shizuoka aichi; do REGION_OF[$p]=chubu; done
for p in mie shiga kyoto osaka hyogo nara wakayama; do REGION_OF[$p]=kansai; done
for p in tottori shimane okayama hiroshima yamaguchi; do REGION_OF[$p]=chugoku; done
for p in tokushima kagawa ehime kochi; do REGION_OF[$p]=shikoku; done
for p in fukuoka saga nagasaki kumamoto oita miyazaki kagoshima okinawa; do REGION_OF[$p]=kyushu; done

# 47 県を北から南の順で並べる
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
  REGION="${REGION_OF[$PREF]}"
  IDX=$((i + 1))

  echo
  echo "─────────────────────────────────────────"
  echo "[$IDX/$TOTAL] ▼ $PREF ($REGION)  $(date '+%H:%M:%S')"
  echo "─────────────────────────────────────────"

  # レジューム判定
  OUT_FILE="data/roads-$PREF.js"
  if [ -f "$OUT_FILE" ] && grep -q '"v":6' "$OUT_FILE" 2>/dev/null; then
    SIZE=$(stat -c %s "$OUT_FILE" 2>/dev/null || stat -f %z "$OUT_FILE")
    echo "  レジューム: $OUT_FILE が既に v6 ($SIZE bytes) → スキップ"
    SKIPPED=$((SKIPPED + 1))
    COMPLETED=$((COMPLETED + 1))
    continue
  fi

  set +e
  T_START=$(date +%s)

  echo "  [1/3] DEM タイル DL"
  node scripts/fetch-dem-tiles.js "$PREF" 2>&1 | tail -3
  RC1=$?

  echo "  [2/3] Overpass 道路 fetch"
  node scripts/fetch-pref-roads-overpass.js "$PREF" 2>&1 | tail -3
  RC2=$?

  echo "  [3/3] build-roads --dem --only=$PREF"
  node scripts/build-roads.js \
    "tmp/$PREF-roads-v6.geojson" data "$REGION" --dem --only="$PREF" 2>&1 | tail -8
  RC3=$?

  T_END=$(date +%s)
  ELAPSED=$((T_END - T_START))

  if [ $RC1 -eq 0 ] && [ $RC2 -eq 0 ] && [ $RC3 -eq 0 ] && [ -f "$OUT_FILE" ]; then
    SIZE=$(stat -c %s "$OUT_FILE" 2>/dev/null || stat -f %z "$OUT_FILE")
    echo "  ✅ $PREF 完了 (${ELAPSED}s, ${SIZE} bytes)"
    COMPLETED=$((COMPLETED + 1))
  else
    echo "  ❌ $PREF 失敗 RC=$RC1/$RC2/$RC3 (${ELAPSED}s)"
    FAILED=$((FAILED + 1))
    FAILED_LIST+=("$PREF")
  fi
  set -e

  # 進捗サマリ
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
echo "スキップ (既存 v6): $SKIPPED"
echo "失敗: $FAILED"
if [ ${#FAILED_LIST[@]} -gt 0 ]; then
  echo "失敗県: ${FAILED_LIST[*]}"
fi

# v6 ファイルサイズ サマリ
echo
echo "▼ v6 ファイル一覧"
for PREF in "${PREFS[@]}"; do
  F="data/roads-$PREF.js"
  if [ -f "$F" ] && grep -q '"v":6' "$F" 2>/dev/null; then
    SIZE=$(stat -c %s "$F" 2>/dev/null || stat -f %z "$F")
    NUM=$(grep -oE '"numRoads":[0-9]+' "$F" | head -1 | grep -oE '[0-9]+')
    printf "  %-12s %10d bytes  numRoads=%s\n" "$PREF" "$SIZE" "$NUM"
  else
    printf "  %-12s (v6 なし)\n" "$PREF"
  fi
done

echo
echo "Finished: $(date '+%Y-%m-%d %H:%M:%S')"
