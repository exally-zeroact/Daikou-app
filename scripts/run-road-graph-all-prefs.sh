#!/bin/bash
# ============================================================
# scripts/run-road-graph-all-prefs.sh
# build-road-graph.js を 47 都道府県 × 順次実行
# ============================================================
set -u   # set -e は付けない（1 県失敗時に残り 46 県も処理する）

cd "$(dirname "$0")/.."

PREFS=(
  hokkaido
  aomori iwate miyagi akita yamagata fukushima
  ibaraki tochigi gunma saitama chiba tokyo kanagawa
  niigata toyama ishikawa fukui yamanashi nagano
  gifu shizuoka aichi mie
  shiga kyoto osaka hyogo nara wakayama
  tottori shimane okayama hiroshima yamaguchi
  tokushima kagawa ehime kochi
  fukuoka saga nagasaki kumamoto oita miyazaki kagoshima okinawa
)

ok=0
fail=0
fail_list=()
total_start=$(date +%s)

for pref in "${PREFS[@]}"; do
  echo ""
  echo "================================================="
  echo " [$((ok + fail + 1))/${#PREFS[@]}] road-graph for $pref"
  echo "================================================="
  if node scripts/build-road-graph.js "$pref"; then
    ok=$((ok + 1))
  else
    fail=$((fail + 1))
    fail_list+=("$pref")
    echo ""
    echo "!!! FAILED: $pref"
  fi
done

total_sec=$(($(date +%s) - total_start))
echo ""
echo "================================================="
echo " ALL DONE: ok=$ok fail=$fail total=${total_sec}s"
if [ "$fail" -gt 0 ]; then
  echo " failed: ${fail_list[*]}"
fi
echo "================================================="
