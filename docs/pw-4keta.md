# 本人の 明細の パスワードを 4桁に・3回 間違えたら 止める（設計 v3・2026-10-20）

司さんの 決め（10-19・指示役の セッションで 直接・記憶 project_daikome_4keta_pw_2026-10-19）：
- 「パスワードは 4桁に しろ」
- 「間違えた 人用で ユーザーが 対応できる ように しとけよ、例えば 新しく URL や QR コードを 作成し直す とか」
- 「3回 間違えたら」＝3回で 止める。戻すのは 事務所の「作り直す」。
- 本番の 倉庫に 当てて よい＝「1やれ」（この 件だけ）。「全部 きっちり 対立で やれや」。

## 先に 塞いだ 穴（10-19 夜・本番 2a80b9d3f・倉庫 14:54Z UTC）
- 照らす 所が null の パスワード・初回コードを「合う」に して いた＝`p_pw is null or pw_hash is distinct from crypt(…)`・`p_init is null or init_code is distinct from p_init`。
- ★書き直す 時に この 守りを 落とさない★（単体 tests/unit/kyuryo-pw-ana.test.js が 縛る・この 件で 3本の 新しい md5 に 書き換える）。

## 今（10-19 読んだ）
- 表 daikome.dk_kyuryo_pub（token・company_id・employee_id・init_code・pw_hash・device_tokens（使って いない）・consent_at・created_at・updated_at）。窓 public.dk_kyuryo_pub（init_code_ari・pw_ari）。
- 作り直し（saihakkou）は ★token を 替えない★＝URL は 同じ・`&c=` の 初回コードだけ 替わる。

## 作り
### 倉庫（元の ファイルの 中で 直す＝古い 版が ファイルに 残らない・対立役 S4）
- 表に 2列（apply-kyuryo-honnin.sql に 書く）：`pw_miss int not null default 0`（パスワードを 決めてから 間違えた 数）・`tomatta_at timestamptz`（止めた 時刻）。窓に 2列とも 出す（窓の 見張りの 決まり）。★窓は 式の 列（書き換えられない）・表と 窓は 画面の 鍵（anon・authenticated）から 直に 読み書き させない★（10-20 対立役 本番前 S1：前は 事務所の ログインで 表から pw_hash を 読め、止めも 外せた）。
- 照らし方（verify・get で 同じ・★最初に 行を 鍵で 取る★＝`select … for update`・対立役 S1/S2）：
  1. 行が 無い・pw_hash が 無い ＝ no_token（数えない）。
  2. tomatta_at が 在る ＝ reason 'tomatta'（照らさない）。
  3. 合わない（null・空も 合わない）＝ `pw_miss = pw_miss + 1`・3 に なったら tomatta_at = now()・返りは bad_pw＋nokori か tomatta。
  4. 合う ＝ ★pw_miss を 0 に 戻す★（司さん 10-20「続けて 3回」＝選ぶ 問いの 答え。tomatta_at には 触らない）。
  - `for update` は 読むだけの 取引（GET の rpc）で 落ちる＝GET で 総当たりできない。
- pw_set：新しい パスワードは ★数字 4桁 ちょうど★（`p_pw ~ '^[0-9]{4}$'`・違えば 'pw_4keta'）。決めたら pw_miss=0・tomatta_at=null。初回コードの 照らしは 今の まま（null は 違う）。
- saihakkou：★token も 作り直す★（司さん「新しく URL や QR コードを 作成し直す」・対立役 S3）＋ init_code 作り直し・pw_hash＝null・pw_miss=0・tomatta_at=null。古い URL は 開かない（no_token）。
- haifu・haifu_hitori：一覧に `tomatta` を 足す。
- ★もう 8文字 以上で 決めた 人は そのまま 開ける★（照らす 側は 長さを 見ない）。
### 当てる 道具（1つ）
- scripts/apply-kyuryo-pw-4keta.mjs：列 2つ（`alter table … add column if not exists`）＋ 窓 ＋ 関数 6本を ★1つの 取引★で。当てる 前に 倉庫の md5 が 今の 版（2a80b9d3f の 後）で なければ 止める・塊の md5 が 決めた 版で なければ 止める。get の update は `update daikome.dk_kyuryo_pub set pw_miss` の 形だけ 通す。
- 古い 道具（apply-kyuryo-get.mjs・apply-kyuryo-saihakkou.mjs・apply-kyuryo-pw-ana.mjs）の ARU に `for update`・`pw_miss` を 足し、古い 版を 当てても KAKUNIN が NG に なる 様に する。
### 画面
- 本人・はじめて：「パスワード（数字 4桁）を 決めてください。銀行などの 暗証番号と 同じに しないでください。」。欄は inputmode="numeric"・maxlength=4・確認の 欄も。数字 4桁で なければ 押させない。already_set なら 2回目の 画面へ 回す（対立役 k1）。
- 本人・2回目：欄は 絞らない（古い 8文字の 人が 打てる・対立役 N2）。違う＝「パスワードが 違います（あと N回 間違えると 止まります）」。止まった＝「3回 間違えたので 止めました。会社（事務所）に リンクを 作り直して もらってください。」（欄と ボタンを 出さない）。no_token＝「この リンクは 作り直されました。会社から 新しい リンクを もらってください。」。get が 途中で tomatta・no_token を 返した 時も 同じ。
- 事務所の 配る 一覧：止まった 人に「3回 間違えて 止まっています（「作り直す」で 新しい リンクを 配ります）」。作り直すと 古い リンク・QR は 使えなく なる 事を 札に 書く（対立役 k7）。
### 当てる 順（本番）
- 先に 本番で `init_code is not null and pw_hash is null`（今 決める 途中の 人）の 数を 数える（対立役 N4）。
- 倉庫が 先（1つの 取引）→ 画面。古い 画面の 間：はじめての 人は 8文字で 決めようと して pw_4keta で 断られる（訳は「できませんでした」）。2回目の 人は そのまま。

## 守る 試験
- 倉庫（rollback・★期待と 違えば 1/(random()*0)★）：4桁で 決まる／8文字・3桁・英字・空白・null は 断る／2回 間違え→3回目で 止まる／止まると 正しい パスワードでも 開かない（verify・get）／合っても 数は 戻らない／作り直すと token が 替わり 古い token は no_token・数と 止めが 消える／よその 会社の 人は 作り直せない／8文字の 古い パスワードは 開く／一覧に tomatta／読むだけの 取引で verify を 呼ぶと 落ちる（GET の 真似）。
- 単体：3本＋saihakkou の 照らし方と md5（kyuryo-pw-ana を 書き換え）・理由の 字（tomatta・pw_4keta・bad_pw・nokori・no_token）が SQL と kyuryo.html で 同じ 組（対立役 k8）。
- 画面：はじめての 欄が 数字 4桁／違う 時の「あと N回」／止まった 時の 訳と 欄が 消える／作り直された リンクの 訳／already_set で 2回目へ／事務所の 一覧の「止まっています」。

## v3 の 足し（対立役 10-20 設計 v2 の 指摘と 司さんの 答え）
- 3回は ★続けて★（司さん 10-20）。正しく 開けば pw_miss=0（tomatta_at は 触らない＝同時に 走った 当たりが 止めを 外さない）。
- 止1 窓は `create or replace view public.dk_kyuryo_pub with (security_invoker = on) as …` の ★1文★。取引の 中で commit の 前に reloptions に security_invoker=on が 在るかを 見て、無ければ 止める（作り直すと 落ちるのを 測った）。
- 止2 POST＋`Prefer: tx=rollback`：テスト線の REST で 測った＝Preference-Applied が 返らない（効かない）。GET の rpc は 今は 通る（200）・for update で 落ちる 様に なる＝当てた 後に REST で GET を 1回 打って 確かめる。
- 直1 pw_set の 形の 門は `p_pw is null or p_pw !~ '^[0-9]{4}$'`（`\d` は 全角を 通す・null は not(~) で 通る＝測った）。
- 直2 古い 道具（apply-kyuryo-get.mjs・apply-kyuryo-saihakkou.mjs・apply-kyuryo-pw-ana.mjs）は、当てる 前に 倉庫に pw_miss 列が 在れば 止める（この 件の 後は 新しい 道具だけで 当てる）。
- 直3 新しい 道具は 1つの 取引の 中で：当てる 前に 6本の md5（今の 版）と 列の 型 → 当てる → commit の 前に reloptions・provolatile・作り物の 行で verify・get の 1周（違う→合う＝0 に 戻る→違う→違う（get）→null で 止まる→止まると 正しくても 開かない）を 見て、どれかが 違えば 誤りを 投げて 巻き戻す。★作り直し（saihakkou）は 持ち主の 印が 要るので 本番の 取引では 回さない★（テストの rollback 試験 23〜29 だけが 動かして 確かめる・本番では md5 と 字の 門）。
- 直4 照らす 3本（pw_set・verify・get）に `exception`・`raise` が 無い 事、最初の 文が `select … for update` で ある 事を 道具と 単体で 縛る。
- 直6 `check (pw_miss between 0 and 3)`（窓から 負の 数に できない）。
- 小：作り直しの 返り（token・init_code）で すぐ 画面の 控え HAIFU を 差し替える／pw_set は already_set を 形の 門より 先に 返す／全角の 数字は 決める・入れる 両方で 半角に 直してから 送る。
