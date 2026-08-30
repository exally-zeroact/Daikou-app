#!/usr/bin/env bash
# ============================================================
# ★★本番ビルドを 1回に する（Vercel の お金）★★ 2026-08-30
#
#   ★Vercel の 決まり★
#     ここで ★0 で 終われば「建てない」★／★1 で 終われば「建てる」★
#     （vercel.json の "ignoreCommand" から 呼ばれます）
#
#   ★なぜ 要るか（ビルドログの 実物・2026-08-30 12:00 本番）★
#     Cloning completed: ★4:26.827★ ／ Build Completed ★[28s]★
#     ⇒★時間の 94% が clone★（repo が 3.3GB あるため）
#     その clone を ★1回の 変更で 2回★ 走らせていました:
#       ①PR を merge → 建てる（この時 sw.js は ★まだ 古い版名★）
#       ②auto-version が sw.js を 書き換えて もう1コミット
#       ③もう一度 建てる（★客に 届くのは こちら★）
#     ⇒★①は 捨て玉★。①を 建てなければ ★本番は 1回★で 済みます。
#
#   ★決め方（この1本だけ）★
#     ・本番(main)以外 …………………… ★必ず 建てる★（下見は 今までどおり）
#     ・本番で sw.js が 変わった …… ★建てる★（＝客に 届く版）
#     ・本番で sw.js が 変わっていない … ★建てない★（②が すぐ 来る）
#
#   ★★分からない時は 建てる★★
#     前のコミットが 読めない・git が 使えない 等は ★必ず 建てます★。
#     ＝★迷ったら 配る★（「黙って 何も 配信されない」を 作らない）。
#
#   ★これが 落ちた時の 保険★
#     .github/workflows/hanmei-mihari.yml が 毎日
#     ★実配信の 版名★と ★repo の 版名★を 突き合わせます（ずれたら 赤）。
# ============================================================
set -u

echo "[ignore] branch=${VERCEL_GIT_COMMIT_REF:-?} sha=${VERCEL_GIT_COMMIT_SHA:-?}"

# ─── ①本番(main)以外は 必ず 建てる ───
if [ "${VERCEL_GIT_COMMIT_REF:-}" != "main" ]; then
  echo "[ignore] 本番の枝では ありません → ★建てます★"
  exit 1
fi

# ─── ②前のコミットと 比べられるか ───
if ! git rev-parse --verify -q HEAD^ >/dev/null 2>&1; then
  echo "[ignore] 前のコミットが 読めません → ★迷ったら 建てます★"
  exit 1
fi

# ─── ③sw.js が 変わったか ───
if git diff --name-only HEAD^ HEAD 2>/dev/null | grep -qx 'sw.js'; then
  echo "[ignore] sw.js が 変わりました（＝客に 届く版）→ ★建てます★"
  exit 1
fi

echo "[ignore] sw.js は 変わっていません → ★建てません★（版名コミットが すぐ 来ます）"
exit 0
