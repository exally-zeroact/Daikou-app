# この 7本は テスト線から 1バイトも変えずに写した物（2026-08-19）

## なぜ写したか

★本番repo（Daikou-app）に supabase/functions が1本も無かった★。
つまり **本番の倉庫で動いている関数のソースが git に無い＝何が動いているか追えない** 状態だった。

その結果 実際に起きた事：

- 請求書の行き先を「出発〜経由〜到着」にする直し（`meisai-row.js` の `routeText()`）は
  **2026-08-09 にテスト線へ入っていた**
- ところが **本番の倉庫に配られていなかった**（本番は 2026-08-05 版＝到着地だけ）
- ＝ **本番の明細は10日間「1地点だけ」で入り続けた**（司さんが実機で発見）

★push も CI緑も「客に届いた」ではない★。

## 写した元（実測）

| 項目 | 値 |
|---|---|
| 写した元 repo | `exally-zeroact/Daikou-app-test`（テスト線） |
| 写した元 commit | `8c00dfee`（origin/main・2026-08-18） |
| 写した日 | 2026-08-19 |
| 写し方 | `git show origin/main:<path>` をそのまま保存（**1バイトも変えていない**） |

| sha256（先頭16桁） | バイト | ファイル |
|---|---|---|
| `03efdb69dfe2d366` | 3,235 | `dk-company-manage/index.ts` |
| `8fb135e13f644917` | 4,918 | `dk-customers/index.ts` |
| `9fc208fce3e6fe66` | 5,312 | `dk-issue-license/index.ts` |
| `42d3148b6f01038d` | 4,436 | `dk-register-company/index.ts` |
| `54596f651dd6bca8` | 2,563 | `dk-reissue/index.ts` |
| `f72a6cfd02d9062f` | 13,639 | `dk-sync-jobs/index.ts` |
| `b1b21781702355e8` | 11,000 | `dk-sync-jobs/meisai-row.js` |

★ファイルの頭に「写した元」を書かずに、この1枚にまとめてある★のは、
**1バイトでも足すと テスト線との sha 突き合わせができなくなる**ため。
（＝ 正本は テスト線。ここは写し。中身で比べられる形を優先した）

## 配ってある物と repo が同じか（2026-08-19 実測）

`node scripts/check-deployed-functions.mjs` で数えた本番倉庫（`tnfwipbgfgjaymlszeid`）の姿：

| 関数 | 配ってある版 | 最後に配った日 | repo と同じか |
|---|---|---|---|
| `dk-customers` | ver5 | 2026-08-05 | 一致 |
| `dk-issue-license` | ver7 | 2026-07-29 | 一致 |
| `dk-register-company` | ver5 | 2026-07-29 | 一致 |
| `dk-sync-jobs` | ver12 | 2026-08-05 | ★古い（`routeText` / `placeText` が無い）★ |
| `dk-company-manage` | — | — | ★配られていない★ |
| `dk-reissue` | — | — | ★配られていない★ |

**★配り直しは 司さんのOKの後★**（倉庫のデータは触らない・関数を配るだけ）。
配った後は、本番の明細に「出発〜経由〜到着」が入る事を実データで確かめる。
