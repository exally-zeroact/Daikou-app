# 売上から引く物（高速・橋・その他）を「何日から」で変える（設計 v1・2026-10-18）

司さんの決め（10-17・人・役割の何日からと同じ）：
- 変える日は使う人が選ぶ（既定は今日・過去も先も）。その日から次の変更の日までその値。その日より前は前の値。
- 過去の日を選んだら、その日から後は遡って新しい額（売上表・給料・月次・紙・本人の明細）。止めない・警告で縛らない。

## 範囲
- 売上表の「売上から引くもの」の3つ（deduct_toll・deduct_bridge・deduct_other＝dk_sales_settings の列）だけ。
- 会社が足した実費（dk_expense_kinds・いつも引く）・実費の額そのもの・other_label は変えない。

## 今（10-18 測った）
- 引き方の1か所＝js/uriage-agg.js の deductOf(edit, settings)。呼ぶ所：
  - payroll-daily.js buildCtx の業務ごと（日が分かる）と手で入れた日（work_date）の2か所＝給料・月次（GetsujiAgg は CTX の expense）・shukei の紙の売上・本人の明細。
  - uriage-agg.js byDevice（車ごとに ★足してから1回★ deductOf）。byDay は日ごとに byDevice を通す。売上表の画面と売上の紙（ROWS・DAYS）。
  - kami-shukei.js kaisha：月次の紙に「引く物」の名前を刷る（設定の3つの真偽を直に読む）。
- 本番の倉庫（SELECT）：dk_sales_settings 1行（高速・橋を引く・その他は引かない）・会社 11・実費に額が在る業務の直し 1行・手で入れた日 1行。テストの倉庫：設定の行 0（既定）。

## 置き場＝新しい表 dk_uriage_rireki（役割の件と同じ形）
- `daikome.dk_uriage_rireki (rireki_id uuid pk, company_id fk cascade, key in ('toll','bridge','other'), from_date date, value boolean not null, created_at, unique (company_id, key, from_date))`。
- 列（dk_sales_settings）＝最初の記録より前の日の値。古い版のタブは表を知らず列だけ書く＝記録は消えない。
- 守り：持ち主だけ読む・書く・消す（4つの policy）・authenticated だけ・窓は security_invoker。
- 本人の明細の関数（dk_kyuryo_get）に 'uriageRireki'（その会社の記録）を足す。
- ★本番の倉庫を2つ変える（表・本人の明細の関数）＝当てる前に司さんに許しを訊く★。倉庫を先に当ててから画面を出す。

## 計算（引き方の1か所は UriageAgg のまま）
- `UriageAgg.rirekiKumu(rows)`：key ごとに日付の古い順。undefined＝記録無し。null・配列でない・形が違う（key が3つ以外・日付の形・value が真偽でない）＝throw。
- `UriageAgg.settingsOnDay(settings, kumi, 日)`：normSettings(列) に、各 key の from_date ≤ 日 で一番新しい記録を重ねる。記録が無ければ normSettings(列) そのもの。
- payroll-daily.js buildCtx：業務・手で入れた日の expense を `deductOf(e, settingsOnDay(列, kumi, その日))`。記録の読みは業務を回す前。読めない＝yakuDame wake 'uriageRireki'（明細・紙・月次・本人を止める・訳の字は売上から引く物と言う）。
- uriage-agg.js byDevice(shifts, edits, labels, settings, kumi)：引く額を ★業務ごとに★ その日の決まりで deductOf して足す。足し算が線形なので記録が無い時は今と1円も違わない（試験で今の式と突き合わせる）。byDay も kumi を通す。
- 売上表の画面：記録が読めない時は数字・紙を出さず訳を出す（売上の直しが読めない時と同じ止め方）。
- 月次の紙（kami-shukei kaisha）：その月の日ごとに引くかを引き、月の中で変わる物は「高速代（1〜14日）」の様に日の幅を付けて刷る。

## 画面（売上表の「売上から引くもの」）
- 3つのチェックの上に「何日から」（既定は今日＝JST・空＝最初から＝今と同じく列を直す）。
- チェックは ★選んだ日に効く値★ を出す。日付を変えたら出し直す。
- チェックを変えた時：日付が在る＝その場で記録を書く（同じ日・同じ鍵の記録が在れば直す・無ければ足す）。列は変えない。日付が空＝今と同じ（列を保存）。
- 記録の在る鍵で日付を空にした時は「空は 最初の 記録より 前の 日だけ 変わります」と出す。
- 「記録 N」を押すと日付順に並び、日付・引く／引かないを直す・消すができる（その場で倉庫へ）。
- 書いた後は記録を読み直して数字を出し直す。

## 守る試験
- 単体：記録が無いと今と同じ額（undefined と []・byDevice の業務ごとの足し方＝今の式）／記録の日から後だけ引き方が変わる／次の記録まで／先の日は今日に効かない／形が違う＝止める（給料も売上表も）／本人の画面（crew）でも同じ／手で入れた日も同じ／月次の紙の名前の幅／呼び口が全部記録を渡す／読みが limit>1000。
- 画面：日付在りでチェックを変えると dk_uriage_rireki へ書き dk_sales_settings は書かない／日付空で列／選んだ日の値を出す／読めない＝止める／給料の明細の実費が日で変わる。
- 倉庫（rollback）：持ち主だけ・よその会社は書けない・同じ日2件を断る・2026-02-30 を断る・本人の関数が会社の記録を返す。

## 覚え（前から在る・この件で変えない）
- kami-shukei の真偽の読み（`!== false`）と normSettings（`!!`）は null の時に食い違う。列は not null なので今は起きない。
- 売上の紙（uriage.html の kamiK）は「引く物」に全部の実費の名前を hiku:true で渡す（前から）。
- 古い版のタブは記録を知らず列の値で計算する（人・役割の件と同じ形）。

## 対立役 1回目の指摘と答え（10-18）
- 止1（売上表は読めなかった＝空の記録）→ uriage.html は記録を `rirekiYomu`（別に数える softList）で読み、読めない＝null＝数字・紙を出さない（RIREKI_DAME）。記録も列も書かせない（kakasenai）。画面の試験 ②。
- 止2（月次の売上ボタン）→ renderUri は CTX に `uriageRireki` の止め・売上の直しが読めない業務が在れば売上を出さない。getsuji-agg は `out.uriageRireki` を別の印にし、紙の字を本当の訳に。画面の試験 ⑩（外すと赤）。
- 止3（設定が読めない時に既定で列を上書き）→ 設定を別に数えて読み（SS_YOMI）、読めない時は列も記録も書かない。列に書く時は変えた鍵だけ送る。画面の試験 ⑨・④（外すと赤）。
- 直1 → 記録は `on_conflict=company_id,key,from_date`＋merge-duplicates で足すか直す。倉庫の rollback ⑥ で窓越しに通る（2:false）。
- 直2 → 書いている間はチェックを押せない（KAKI_CHU）。列が書けなければ元の値へ戻す。記録が書けなければ読み直して戻す。
- 直3 → 選んだ日が見ている月より後なら「この月の数字は変わりません」、後ろに記録が在れば「◯ の記録まで」。
- 直4 → 月次の紙の日ごとの引き方は UriageAgg.settingsOnDay（1か所）。記録が無い時は前のまま。2回変わる月も幅を並べる（試験）。
- 直5 → 本人の画面で関数が記録を返さない時は「会社に知らせてください」。
- 直6 → 門に `from daikome.dk_uriage_rireki u` を足した。
- 小数（manual_days の double）は記録が在る時だけ業務ごとの足し方になる。記録が無い会社は今の式そのもの。

## テストの倉庫で確かめた（tests/db-tameshi/uriage-rireki.rollback.sql）
1 書ける＝2／2 同じ日の2件目＝ことわり／3 2026-02-30＝ことわり／4 よその会社＝ことわり／5 持ち主でない人＝0／6 窓から on conflict＝2:false／7 窓から直す・消す＝1/1／8 鍵が3つ以外＝ことわり／9 値が空＝ことわり／10 本人の関数＝1。期待と全部同じ。
