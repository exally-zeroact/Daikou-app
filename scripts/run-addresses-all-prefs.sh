#!/usr/bin/env bash
# 47県分の住所データを順次取得する オーケストレータ
#
# 使い方:
#   bash scripts/run-addresses-all-prefs.sh                  # 中精度のみ
#   bash scripts/run-addresses-all-prefs.sh --fine           # 詳細のみ
#   bash scripts/run-addresses-all-prefs.sh --coarse --fine  # 両方
#
# レジューム:
#   --coarse: input/{pref}/admin.geojson が既存ならスキップ
#   --fine  : input/{pref}/streets.csv が既存ならスキップ

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# モード判定
DO_COARSE=0
DO_FINE=0
for arg in "$@"; do
  [ "$arg" = "--coarse" ] && DO_COARSE=1
  [ "$arg" = "--fine" ]   && DO_FINE=1
done
# 引数なし or --coarse 単体 → 中精度デフォルト
if [ $DO_COARSE -eq 0 ] && [ $DO_FINE -eq 0 ]; then
  DO_COARSE=1
fi

LOG="$ROOT/tmp/address-fetch-progress.log"
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "=========================================="
echo "  addresses 47 県 一括取得"
echo "  modes: coarse=$DO_COARSE fine=$DO_FINE"
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

  ARGS=()
  RUN=0

  if [ $DO_COARSE -eq 1 ]; then
    if [ -f "input/$PREF/admin.geojson" ]; then
      :  # 中精度はスキップ判定後に詳細をチェックする
    else
      ARGS+=("--coarse"); RUN=1
    fi
  fi
  if [ $DO_FINE -eq 1 ]; then
    if [ -f "input/$PREF/streets.csv" ]; then
      :
    else
      ARGS+=("--fine"); RUN=1
    fi
  fi

  if [ $RUN -eq 0 ]; then
    echo "  レジューム: 既存ファイルあり → スキップ"
    SKIPPED=$((SKIPPED + 1))
    COMPLETED=$((COMPLETED + 1))
    continue
  fi

  set +e
  T_START=$(date +%s)
  node scripts/fetch-address-data.js "$PREF" "${ARGS[@]}" 2>&1 | tail -10
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
