#!/usr/bin/env bash
# cache-name-oshi.sh — sw.js の 版名（CACHE_NAME）を 付けて 押す（auto-version.yml から 呼ぶ・2026-10-17）
#
#   使い方:  bash scripts/cache-name-oshi.sh [枝]      （枝の 既定は main・repo の 根で 走らせる）
#
#   ★前の 形の ぶつかり（テスト線 10-14 run 38510361673・38507209331 / 本番 10-10 run 38039446706・10-16 run 38881711241）★
#     2本 続けて 押すと、後の bot は 押し返され、git pull --rebase で sw.js が ぶつかり failure。
#     先の bot は 版名を 積んだ 後に 取り消される 事が ある（★取り消し＝積んでいない、では 無い★）。
#     cancel-in-progress を 止めても 直らない（checkout は 引き金の commit で、main の 頭で 無い・対立役 10-17）。
#   ★今の 形★ 押し返されたら 自分の commit を 捨てて 枝の 頭を 取り直し、
#     ・頭が sw.js だけを 変え、版名が daikome-<その 親の 短い印>（＝別の bot が もう 付けた）なら 何も しない
#       ★sw.js だけ、では 判じない★ 人が sw.js だけを 直した commit（版名 そのまま）を bot と 取り違えると、
#       中身に 古い 版名が 残る（対立役 10-17 S-1・09-28 6ce5ee626 が その 形）
#     ・そうで なければ 頭の 短い印で 版名を 付け直して 押す
#     ＝rebase を しないので sw.js が ぶつからない。
#   ★失敗は 赤★ fetch・reset・commit の 失敗、版名を 書けない（行の 形が 変わった）、3回 押し返された＝exit 1
#   ★揃っていない 所（別件・10-17 対立役 N-5）★ auto-version.yml の 1.5段目は「引き金の push で sw.js が
#     少しでも 変わったら 付けない」。この 道具の「付けない」とは 物差しが 違う（人が sw.js と 他を 一緒に 押すと
#     版名の commit は 0本の まま＝前から 同じ）。
set -u
B="${1:-main}"

tsukeru() {
  name="daikome-$(git rev-parse --short=7 HEAD)"
  sed -i -E "s/(const CACHE_NAME = )['\"][^'\"]*['\"]/\1'$name'/" sw.js
  # ★sed が 当たらない 時に「もう 付いている」と 言って 緑で 終わらない★（対立役 N-2）
  if ! grep -qF "const CACHE_NAME = '$name';" sw.js; then
    echo "sw.js に 版名 $name を 書けなかった（版名の 行の 形が 変わった？）"
    exit 1
  fi
}

botNoAtama() {
  [ "$(git diff --name-only HEAD^ HEAD)" = "sw.js" ] || return 1
  grep -qF "const CACHE_NAME = 'daikome-$(git rev-parse --short=7 HEAD^)';" sw.js
}

for attempt in 1 2 3; do
  if [ "$attempt" -gt 1 ]; then
    echo "押し返された（$((attempt - 1)) 回目）＝枝の 頭を 取り直す"
    git fetch -q origin "$B" || exit 1
    git reset -q --hard "origin/$B" || exit 1
    if botNoAtama; then
      echo "枝の 頭は もう 版名の commit＝何も しない"
      exit 0
    fi
  fi
  tsukeru
  if git diff --quiet sw.js; then
    echo "版名は もう $name＝何も しない"
    exit 0
  fi
  git add sw.js
  git commit -q -m "chore: auto-update CACHE_NAME to $name" || exit 1
  if git push -q origin "HEAD:$B"; then
    echo "押した: $name（$attempt 回目）"
    exit 0
  fi
done
echo "3 回 押し返された"
exit 1
