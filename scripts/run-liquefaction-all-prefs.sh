#!/usr/bin/env bash
# 47 都道府県分の液状化ハザード (重ねるハザードマップ 08_03_ekijoka_zenkoku) を順次生成
#
# 使い方:
#   bash scripts/run-liquefaction-all-prefs.sh           # zoom=12
#   bash scripts/run-liquefaction-all-prefs.sh --zoom=11 # zoom=11
#
# レジューム:
#   data/hazard-liquefaction-{pref}.js が既存 → スキップ
# タイルキャッシュ : tmp/liq-tiles/{zoom}/{x}_{y}.png  (再 DL 不要)

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ZOOM_ARG=""
for a in "$@"; do
  case "$a" in --zoom=*) ZOOM_ARG="$a";; esac
done

LOG="$ROOT/tmp/liquefaction-progress.log"
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "=========================================="
echo "  liquefaction 47 県 一括生成 (zoom=${ZOOM_ARG:-default 12})"
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

  OUT="data/hazard-liquefaction-$PREF.js"
  # レジューム判定: ファイル存在 + count > 0 (空 stub "count":0 は再生成対象)
  if [ -f "$OUT" ]; then
    REAL_COUNT=$(grep -oE '"count":[0-9]+' "$OUT" | head -1 | grep -oE '[0-9]+')
    if [ -n "$REAL_COUNT" ] && [ "$REAL_COUNT" -gt 0 ]; then
      echo "  レジューム: $OUT 既存 (count=$REAL_COUNT) → スキップ"
      SKIPPED=$((SKIPPED + 1))
      COMPLETED=$((COMPLETED + 1))
      continue
    else
      echo "  既存 stub (count=${REAL_COUNT:-?}) → 再生成"
    fi
  fi

  T_START=$(date +%s)
  set +e
  OUTPUT=$(node scripts/fetch-liquefaction.js "$PREF" $ZOOM_ARG 2>&1)
  RC=$?
  set -e
  echo "$OUTPUT" | tail -10
  T_END=$(date +%s)
  ELAPSED=$((T_END - T_START))
  if [ $RC -eq 0 ] && [ -f "$OUT" ]; then
    echo "  ✅ $PREF 完了 (${ELAPSED}s)"
    COMPLETED=$((COMPLETED + 1))
  else
    echo "  ❌ $PREF 失敗 RC=$RC (${ELAPSED}s)"
    FAILED=$((FAILED + 1))
    FAILED_LIST+=("$PREF")
  fi

  ELAPSED_TOTAL=$(($(date +%s) - START_EPOCH))
  ELAPSED_HM=$(printf '%dm%02ds' $((ELAPSED_TOTAL/60)) $((ELAPSED_TOTAL%60)))
  echo "  進捗: $IDX/$TOTAL (完了 $COMPLETED ・スキップ $SKIPPED ・失敗 $FAILED ・経過 $ELAPSED_HM)"
done

echo
echo "=========================================="
echo "  最終レポート"
echo "=========================================="
ELAPSED_TOTAL=$(($(date +%s) - START_EPOCH))
echo "総所要時間: $(printf '%dm%02ds' $((ELAPSED_TOTAL/60)) $((ELAPSED_TOTAL%60)))"
echo "完了: $COMPLETED / $TOTAL"
echo "スキップ: $SKIPPED"
echo "失敗: $FAILED"
[ ${#FAILED_LIST[@]} -gt 0 ] && echo "失敗県: ${FAILED_LIST[*]}"
echo
echo "Finished: $(date '+%Y-%m-%d %H:%M:%S')"
