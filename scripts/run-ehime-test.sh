#!/usr/bin/env bash
# 愛媛テストビルド一括実行
#
# 使い方（プロジェクトルートで）:
#   bash scripts/run-ehime-test.sh
#
# 入力: input/ehime/{emergency,school,flood,landslide,tsunami,liquefaction,fault,poi}.geojson
# 出力: data/{road-attrs,hazard-flood,hazard-landslide,hazard-tsunami,hazard-liquefaction,hazard-fault,poi}-ehime.js

set -e

PREF=ehime
IN=input/$PREF
OUT=data

echo "=========================================="
echo "  愛媛テストビルド実行"
echo "=========================================="

echo
echo "--- A. road-attrs ---"
node scripts/build-road-attrs.js "$PREF" "$IN/emergency.geojson" "$IN/school.geojson"

echo
echo "--- B. hazard ---"
for t in flood landslide tsunami liquefaction fault; do
  echo
  echo "  >>> hazard-$t"
  node scripts/build-hazard.js "$t" "$IN/$t.geojson" "$PREF"
done

echo
echo "--- C. POI ---"
node scripts/build-poi.js "$IN/poi.geojson" "$PREF"

echo
echo "=========================================="
echo "  サイズレポート (data/*-ehime.js)"
echo "=========================================="
ls -la "$OUT" | grep -E "(road-attrs|hazard-|poi)-$PREF\\.js" || true
echo
total=0
for f in "$OUT"/road-attrs-$PREF.js "$OUT"/hazard-*-$PREF.js "$OUT"/poi-$PREF.js; do
  if [ -f "$f" ]; then
    size=$(stat -c '%s' "$f" 2>/dev/null || stat -f '%z' "$f")
    total=$((total + size))
    printf "  %-50s %10d B  (%6.2f KB)\n" "$(basename "$f")" "$size" "$(echo "scale=2; $size/1024" | bc 2>/dev/null || python -c "print($size/1024)")"
  fi
done
echo
printf "  合計（roads-ehime.js を除く）: %d B (%.2f KB)\n" "$total" "$(echo "scale=2; $total/1024" | bc 2>/dev/null || python -c "print($total/1024)")"
echo
echo "✅ 完了"
