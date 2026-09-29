# ★★dk-sync-jobs を 戻す 手順★★（2026-09-29 に 書いた）

## ★先に 知っておく 事★

- **Supabase の Edge Function に「戻す」口は 無い**（実測 2026-09-29）
  - `GET /v1/projects/<ref>/functions/dk-sync-jobs/versions` → **404**
  - `/revisions` → **404**
  - ＝戻すには **古い 字を 自分で 持っていて、配り直す** しか ない。
- `GET /v1/projects/<ref>/functions/dk-sync-jobs/body` は 取れる（eszip）。
  だが **配る口は ソースを multipart で 渡す 形** なので、
  **eszip を そのまま 押し戻す 道は 無い**（＝「取れた≠戻せる」）。

## ★★一番 大事な 落とし穴★★

**古い `index.ts` は 借り物の 版を 固定していない**：

```
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
```

⇒ **古い 字を そのまま 配り直すと、借り物は その日の 最新に 入れ替わる**。
　 戻したのは **ver15 では なく「古い 論理 ＋ 新しい 借り物」の 別物**。

★だから 戻す 時は **必ず 版を 固定してから 配る**★

## ★戻し方（この順に）★

```bash
cd C:/Users/zeroa/Daikou-app

# ① 今の 字を 戻す（関数の 2本だけ）
git checkout 5c693cce1 -- supabase/functions/dk-sync-jobs/index.ts
git checkout 5c693cce1 -- supabase/functions/dk-sync-jobs/meisai-row.js

# ② ★借り物の 版を 固定する（ここを 飛ばすと 別物に なる）★
#    index.ts の import 行を こう 直す:
#      https://esm.sh/@supabase/supabase-js@2
#    → https://esm.sh/@supabase/supabase-js@2.116.0

# ③ commit しないと 配れない（道具は git show HEAD: しか 配らない）
git add supabase/functions/dk-sync-jobs
git commit -m "revert(kansuu): dk-sync-jobs を ver15 の 論理に 戻す（借り物は @2.116.0 で 固定）"

# ④ 配る
node scripts/deploy-edge-function.mjs --probe dk-sync-jobs   # 見るだけ
node scripts/deploy-edge-function.mjs dk-sync-jobs           # 配る

# ⑤ ★版が 上がった だけでは 証しに ならない★ ＝ 中身を 数える
node scripts/check-function-body.mjs dk-sync-jobs
```

## ★戻し先の 印（2026-09-29 に 数えた）★

| | |
|---|---|
| 配ってあった 版 | **ver15**（2026-09-11 07:05 配布・状態 ACTIVE） |
| その 中身の 大きさ | **294,924 B** |
| その sha256（頭20桁） | `80c2de456fc4316aa833` |
| その 字を 作った commit | **`5c693cce1`** |
| その時 本番 main | **`c266a9389`**（門を 写す 前） |
| 借り物 | 字は `@2`（固定なし）／配られた 物の 中は `2.116.0` |

控え（eszip と ソース 2本）は その日の 作業場に 置いた。
**この 紙が 正本**＝控えが 消えても 上の 手順で 作り直せる。

## ★戻した 後に 数える 事★

`node scripts/check-function-body.mjs dk-sync-jobs` で

- **在って ほしい 字**が `dk_meter_yen` / `deleted_at` / `yomeNakatta` /
  `naoseNakatta` / `IRE_JOUGEN` → **全部 無い** に なる（戻ったなら そう なる）
- `supabase-js@2.116.0` は **在る**／`supabase-js@2'` は **無い**
  （＝②を ちゃんと やった 証し。ここが `@2'` の ままなら **②を 飛ばしている**）
