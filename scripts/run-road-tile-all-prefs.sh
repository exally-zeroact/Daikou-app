#!/usr/bin/env bash
# 道路防災 3 種 (flood/jizen/yobo) × 47 都道府県 = 141 ファイル一括生成
#
# 使い方:
#   bash scripts/run-road-tile-all-prefs.sh                    # 3 種全部
#   bash scripts/run-road-tile-all-prefs.sh --kind=flood       # 1 種だけ
#
# レジューム:
#   data/road-{kind}-{pref}.js が count > 0 で存在 → スキップ

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

KINDS=(flood jizen yobo)
KIND_FILTER=""
for a in "$@"; do
  case "$a" in --kind=*) KIND_FILTER="${a#--kind=}" ;; esac
done

LOG="$ROOT/tmp/road-tile-progress.log"
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "=========================================="
echo "  road-tile (flood/jizen/yobo) × 47 県 一括生成"
echo "  kind filter: ${KIND_FILTER:-all}"
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

TOTAL=$(( ${#PREFS[@]} * (${#KINDS[@]}) ))
[ -n "$KIND_FILTER" ] && TOTAL=${#PREFS[@]}
COMPLETED=0; SKIPPED=0; FAILED=0
FAILED_LIST=()
START_EPOCH=$(date +%s)

run_one() {
  local PREF=$1
  local KIND=$2
  local OUT="data/road-${KIND}-${PREF}.js"
  if [ -f "$OUT" ]; then
    local C=$(grep -oE '"count":[0-9]+' "$OUT" | head -1 | grep -oE '[0-9]+')
    if [ -n "$C" ] && [ "$C" -ge 0 ] && [ -s "$OUT" ]; then
      # 存在し JSON valid → スキップ (count==0 もカバレッジ無し県として acceptable)
      echo "    レジューム: $OUT (count=$C) → スキップ"
      SKIPPED=$((SKIPPED + 1))
      COMPLETED=$((COMPLETED + 1))
      return 0
    fi
  fi
  local T_START=$(date +%s)
  set +e
  local OUTPUT=$(node scripts/fetch-road-tile-hazard.js "$PREF" --kind=$KIND 2>&1)
  local RC=$?
  set -e
  echo "$OUTPUT" | tail -6
  local T_END=$(date +%s)
  local ELAPSED=$((T_END - T_START))
  if [ $RC -eq 0 ] && [ -f "$OUT" ]; then
    echo "    ✅ $PREF $KIND (${ELAPSED}s)"
    COMPLETED=$((COMPLETED + 1))
  else
    echo "    ❌ $PREF $KIND RC=$RC (${ELAPSED}s)"
    FAILED=$((FAILED + 1))
    FAILED_LIST+=("$PREF/$KIND")
  fi
}

for i in "${!PREFS[@]}"; do
  PREF="${PREFS[$i]}"
  IDX=$((i + 1))
  echo ""
  echo "─────────────────────────────────────────"
  echo "[$IDX/${#PREFS[@]}] ▼ $PREF  $(date '+%H:%M:%S')"
  echo "─────────────────────────────────────────"
  for KIND in "${KINDS[@]}"; do
    if [ -n "$KIND_FILTER" ] && [ "$KIND" != "$KIND_FILTER" ]; then continue; fi
    echo "  - $KIND:"
    run_one "$PREF" "$KIND"
  done
  ELAPSED_TOTAL=$(($(date +%s) - START_EPOCH))
  ELAPSED_HM=$(printf '%dm%02ds' $((ELAPSED_TOTAL/60)) $((ELAPSED_TOTAL%60)))
  echo "  進捗: 完了 $COMPLETED ・スキップ $SKIPPED ・失敗 $FAILED ・経過 $ELAPSED_HM"
done

echo ""
echo "=========================================="
echo "  最終レポート"
echo "=========================================="
ELAPSED_TOTAL=$(($(date +%s) - START_EPOCH))
echo "総所要時間: $(printf '%dm%02ds' $((ELAPSED_TOTAL/60)) $((ELAPSED_TOTAL%60)))"
echo "完了: $COMPLETED / $TOTAL"
echo "スキップ: $SKIPPED"
echo "失敗: $FAILED"
[ ${#FAILED_LIST[@]} -gt 0 ] && echo "失敗: ${FAILED_LIST[*]}"
echo "Finished: $(date '+%Y-%m-%d %H:%M:%S')"
