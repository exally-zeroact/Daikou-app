#!/usr/bin/env bash
# 47 都道府県分の road-attrs (緊急輸送道路 + スクールゾーン) を順次生成
#
# 使い方:
#   bash scripts/run-road-attrs-all-prefs.sh
#
# レジューム:
#   data/road-attrs-{pref}.js が既存 (size > 0) ならスキップ

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG="$ROOT/tmp/road-attrs-progress.log"
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "=========================================="
echo "  road-attrs 47 県 一括生成"
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

  OUT="data/road-attrs-$PREF.js"
  if [ -f "$OUT" ] && [ -s "$OUT" ]; then
    # 簡易整合性チェック: 中の numRoads と data/roads-$PREF.js の numRoads が一致するか
    EXPECTED=$(grep -oE '"numRoads":[0-9]+' "data/roads-$PREF.js" 2>/dev/null | head -1 | grep -oE '[0-9]+')
    ACTUAL=$(grep -oE '"numRoads":[0-9]+' "$OUT" | head -1 | grep -oE '[0-9]+')
    if [ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ]; then
      echo "  レジューム: $OUT 既存 (numRoads=$ACTUAL) → スキップ"
      SKIPPED=$((SKIPPED + 1))
      COMPLETED=$((COMPLETED + 1))
      continue
    else
      echo "  既存ファイルあるが numRoads 不整合 (expected=$EXPECTED actual=$ACTUAL) → 再生成"
    fi
  fi

  set +e
  T_START=$(date +%s)
  node scripts/fetch-road-attrs.js "$PREF" 2>&1 | tail -8
  RC=$?
  T_END=$(date +%s)
  ELAPSED=$((T_END - T_START))
  if [ $RC -eq 0 ]; then
    echo "  ✅ $PREF 完了 (${ELAPSED}s)"
    COMPLETED=$((COMPLETED + 1))
  else
    echo "  ❌ $PREF 失敗 RC=$RC (${ELAPSED}s)"
    FAILED=$((FAILED + 1))
    FAILED_LIST+=("$PREF")
  fi
  set -e

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
if [ ${#FAILED_LIST[@]} -gt 0 ]; then
  echo "失敗県: ${FAILED_LIST[*]}"
fi
echo
echo "Finished: $(date '+%Y-%m-%d %H:%M:%S')"
