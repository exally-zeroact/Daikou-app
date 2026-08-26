# 事務所ホスト（社長用の画面を出す入れ物）

2026-08-02

## これは何か

ダイコメは**2つの顔**を持っている。

| 顔       | 誰が使う       | 何をする                           |
| -------- | -------------- | ---------------------------------- |
| メーター | ドライバー     | 業務開始・距離・料金（圏外で動く） |
| 事務所   | 社長（司さん） | 売上表・給料・月次集計             |

同じ入れ物に両方を入れていたら、司さんに
**「どのURLもここにしかいかんけど」**（＝どのURLを開いてもメーターが出る）
と言われた。原因はメーター用のサービスワーカーで、電波が一瞬揺れるとどのURLでも
メーターを身代わりに出していた。**入れ物ごと分ける**のがこの仕組み。

## 4つの入れ物

|        | メーター（ドライバー）       | 事務所（社長）                    |
| ------ | ---------------------------- | --------------------------------- |
| テスト | `daikou-app-test.vercel.app` | `daikome-jimusho-test.vercel.app` |
| 本番   | `daikou-app.vercel.app`      | `daikome-jimusho.vercel.app`      |

正の表は **`scripts/dk-hosts.mjs`**。増やす・変える時はそこを直す。

## 事務所は画面を1枚も持っていない

`vercel.json` だけ。メーター側（＝このrepoがgitから自動デプロイしている物）を
そのまま見せている。

**だから手で上げる物が無い。** 画面を直す → repo に push → メーターが自動更新 →
事務所にもそのまま出る。ここを触るのは「どのメーターを見せるか」を変える時だけ。

## 一番こわい間違い

**本番の事務所が、テストのメーターを見てしまうこと。**

そうなると本番の事務所で出したQRを読んだ従業員が、**全員テスト版で走り始める**。
実績は本番に1件も入らない。しかも画面はいつもどおり動くので、誰も気づかない。

これを防ぐために：

- `scripts/dk-hosts.mjs` … どの事務所がどのメーターを見るべきかの表
- `tests/unit/dk-hosts-pairing.test.js` … 表そのものの矛盾を見る（ネットに出ない）
- `tests/unit/dk-config-app-base-host.test.js` … repoの素性を **git の remote から**
  取って APP_BASE を照合する（＝ファイルを丸ごとコピーしても誤魔化せない）
- `scripts/check-hosts.mjs` … **実物を叩いて**表と突き合わせる

```
node scripts/check-hosts.mjs            # 4ホスト全部
node scripts/check-hosts.mjs --side prod
```

## 事務所にサービスワーカーを置かない

置いた瞬間に「電波が揺れるとどのURLもメーターに化ける」が戻る。
`check-hosts.mjs` が `sw.js` の有無を見て赤にする。

## メーター側の `/dashboard.html` は事務所へ 308

ドライバーの端末からは事務所に触らせない。ただし **308 だけでは足りない**
（旧サービスワーカーが残っている端末は横取りして 308 を見ない）ので、

1. `sw.js` の `OFFICE_PATHS` で事務所の4画面を network-only にした
2. メーター内の「事務所をひらく」は `OFFICE_BASE` へ直行させた（メーターを踏まない）

の3重にしてある。

## `/office/` という遠回りがある理由

事務所は `/dashboard.html` をメーターに取りに行く。それが 308 で事務所へ送り返されると
**事務所 → メーター → 事務所 → …** の無限ループになる。
`/office/` は送り返されない入口。事務所はそちらを取りに行く。

## `vercel.json` に説明を書けない

**`_comment` を足すとデプロイが丸ごと失敗する。**

```
The `vercel.json` schema validation failed with the following message:
should NOT have additional property `_comment`
```

（2026-08-02 に実際に踏んだ。本番配信は直前の正常版のままだったので実害は無かったが、
変更が乗らないまま「push したから直った」と思い込む一歩手前だった。）

なので説明はこの README に書く。`vercel.json` は素の設定だけ。
知らないキーが混ざっていないかは `tests/unit/dk-config-app-base-host.test.js` が見る。

## ★通す物だけ通す（塞ぎ方を逆にした・2026-08-02）★

最初は「総当たり `/:path*` で丸ごと通し、`/sw.js` と `/index.html` だけ名指しで塞ぐ」に
していた。実物を叩いたら、**これが全部200で出ていた**。

```
daikome-jimusho/fare.html      200   ← メーターの画面が事務所の住所で出る
daikome-jimusho/settings.html  200
daikome-jimusho/history.html   200
daikome-jimusho/manifest.json  200   ← ★メーターのマニフェスト★
daikome-jimusho/js/meter.js    200
daikome-jimusho/data/coarse-jp.js 200
```

**名指しで塞ぐやり方は、画面が増えるたびに塞ぎ忘れる。** 今回の事故そのもの。

とくに `manifest.json` が効く。事務所のページが1箇所でも相対参照でこれを読んだ瞬間、
**iPhoneのホーム画面に「事務所」の顔でメーターが入る**。

だから逆にした。**通す物だけ一覧にして、総当たりを置かない。**
一覧に無い物は Vercel が勝手に404にする。

### 通す物は目視で決めない

`scripts/office-allow.mjs` が、事務所5画面（dashboard / uriage / kyuryo / shukei / login）の
HTMLから `src=` `href=` と画面どうしの行き先を**機械で洗い出す**。

```
node scripts/office-allow.mjs        # 一覧を見る
```

`tests/unit/office-allow-list.test.js` が
**一覧とHTMLがズレたら赤**にする（増やし忘れ・減らし忘れの両方）。

- HTMLに新しい js を足して一覧を直し忘れた → 赤
- 一覧から js を落とした（押しても動かない）→ 赤
- 総当たりを戻した → 赤
- `manifest.json` を通した → 赤

### 設定を作り直す手順

```
node -e "import('./scripts/office-allow.mjs').then(m=>{
  const {allow}=m.buildAllowList();
  const rw=m.toRewrites(allow,'https://daikou-app.vercel.app');   // 本番はこちら
  require('fs').writeFileSync('office-host/vercel.json',JSON.stringify({rewrites:rw},null,2)+'\n');
})"
```

`https://daikou-app-test.vercel.app` を渡せばテスト側。
**間違えるとQRが反対側を指す**ので、必ず `node scripts/check-hosts.mjs` で確かめる。

## 変える手順

1. この `vercel.json` を直す
2. Vercel の事務所プロジェクトへ反映
3. `node scripts/check-hosts.mjs` が緑になるまで確認

## ★GitHubに繋いだ（2026-08-26）★

それまで **この企画は GitHub に繋がっていなかった**（Vercel の `link` が null）。
最後の配信は **2026-08-02 の手動**。つまり **`vercel.json` を直しても
誰かが手で CLI を叩くまで 客に届かない** 形だった。**24日 誰も気づかなかった。**

実際に穴が開いた：給料明細のPDFが使う `vendor/html2canvas.min.js` `vendor/jspdf.umd.min.js` が
事務所の住所で **404**。押しても紙が出ず、保険の `window.print()`
（司さんが 8/25 に突き返した紙）に落ちる所だった。

### 設定（両方の企画）

| 企画                   | repo              | 枝     | Root Directory    |
| ---------------------- | ----------------- | ------ | ----------------- |
| `daikome-jimusho`      | `Daikou-app`      | `main` | **`office-host`** |
| `daikome-jimusho-test` | `Daikou-app-test` | `main` | **`office-host`** |

**Root Directory を `office-host` 以外にしてはいけない。**
repo の一番上にすると、事務所が **メーターを丸ごと出す**（2026-08-02 の事故そのもの）。
特に `manifest.json` が 200 になると **iPhone のホーム画面に「事務所」の顔でメーターが入る**。

### Preview 配信は止めてある

Ignored Build Step に次を入れてある（`VERCEL_ENV` が production 以外なら **exit 0＝建てない**）:

```
if [ "$VERCEL_ENV" != "production" ]; then exit 0; else exit 1; fi
```

理由は手間でもお金でもなく **環境の混ざり**。
**Preview の事務所は 本番のメーターを指す**（`vercel.json` の行き先が本番のまま）＝
テストのつもりで押した操作が本番のメーターに向く形が生まれる（指示役の裁定 2026-08-26）。
見た目を確かめたい時は **テスト側の事務所（`daikome-jimusho-test`）** で見る。

### 触った後に必ず回す

```
node scripts/check-hosts.mjs --side test   # または --side prod
```

**通す物30本が200／出してはいけない物11本が404** を1回で数える（毎朝07:00にも回っている）。
