#!/bin/bash
# ============================================================
# scripts/run-road-graph-tiled-all-prefs.sh
# build-road-graph-tiled.js を 47 都道府県 × 順次実行
# Phase B runtime 統合用のタイル data セット量産
# ============================================================
set -u

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
  echo " [$((ok + fail + 1))/${#PREFS[@]}] tiled road-graph for $pref"
  echo "================================================="
  if NODE_OPTIONS=--max-old-space-size=4096 node scripts/build-road-graph-tiled.js "$pref"; then
    ok=$((ok + 1))
  else
    fail=$((fail + 1))
    fail_list+=("$pref")
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
