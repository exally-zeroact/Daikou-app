# ライセンス本実装 STEP1 セットアップパッケージ（再開用・2026-07-02準備）

会社URL/QR+署名トークン方式の **STEP1=Supabase署名の土台**。再開の合言葉＝「**ライセンス本実装 STEP1から**」。
設計の全体像は memory `project_daikome_license_code_activation_design_2026-06-30`。STEP0/2(状態機械)は実装済(js/license-v2.js・テスト12件緑・push 6ef274ad)。

## STEP1で作る3つ
1. Ed25519 鍵ペア（秘密鍵=Edge Functionのsecret / 公開鍵=アプリ同梱してlicense-v2が検証）
2. `dk_companies` テーブル（会社ID・URLトークン・status ON/OFF・台数N）
3. Edge Function `dk-issue-license`（会社検証→署名トークン発行）

---

## 手順①：鍵ペア生成（1回だけ・PC上でnode）
```bash
node -e "const c=require('crypto');const{publicKey,privateKey}=c.generateKeyPairSync('ed25519');console.log('=PUBLIC(raw base64url・アプリ同梱)=');console.log(publicKey.export({format:'jwk'}).x);console.log('=PRIVATE(pkcs8 pem・Edge Function secret DK_LICENSE_PRIVKEY)=');console.log(privateKey.export({format:'pem',type:'pkcs8'}));"
```
- 出力の **PUBLIC(raw base64url)** → license-v2.js に定数で埋め込む（公開鍵は公開してよい）。
- 出力の **PRIVATE(pkcs8 pem)** → Supabase の Edge Function secret `DK_LICENSE_PRIVKEY` に登録（★絶対にrepoに置かない・チャットに貼らない★）。
- ※WebCrypto の Ed25519 検証は raw 32byte 公開鍵を import する。jwk.x が base64url の raw。Deno署名は pkcs8 を import。→ deploy時に往復で疎通確認する（compat要検証項目）。

## 手順②：dk_companies 表（SQL Editorで1回・前のRPCに"足す"だけ）
```sql
create table if not exists dk_companies (
  company_id uuid primary key default gen_random_uuid(),
  url_token  text unique not null,          -- 会社固有URLの ?c=<これ>(推測不能・crypto乱数)
  name       text default '',
  status     text not null default 'on',     -- 'on' | 'off'(未払い停止)
  seat_limit int  not null default 1,        -- 契約台数N
  plan       text default '',
  created_at timestamptz default now()
);
alter table dk_companies enable row level security;   -- 直アクセス不可・Edge Function(service_role)経由のみ

-- 会社1件作る例(司さんの自社テスト用):
-- insert into dk_companies(url_token, name, status, seat_limit) values (encode(gen_random_bytes(16),'hex'), '自社', 'on', 6);
```

## 手順③：Edge Function `dk-issue-license`（署名トークン発行）
`supabase/functions/dk-issue-license/index.ts`（下は骨子・deploy時に微調整）:
```ts
// 入力: { url_token, device_id, vin } → 会社検証(status/seat)→ 署名トークン返す
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const EXP_MS = 60*24*60*60*1000  // 2ヶ月
Deno.serve(async (req) => {
  const { url_token, device_id, vin } = await req.json()
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: co } = await sb.from('dk_companies').select('*').eq('url_token', url_token).single()
  if (!co) return json({ ok:false, reason:'invalid' })
  // (任意) 台数チェック: dk_licensed_devices 等で company の active device 数 < seat_limit
  const payload = { company_id: co.company_id, device_id, vin: vin||'', status: co.status, exp: Date.now()+EXP_MS }
  const token = await signEd25519(payload, Deno.env.get('DK_LICENSE_PRIVKEY')!)
  return json({ ok:true, token })
})
```
### ★トークン契約(client の license-v2.verifyLicenseToken と厳密一致・ここがズレると本番で検証全失敗)★
```
payloadB64 = base64url( utf8( JSON.stringify(payload) ) )
署名対象   = utf8bytes(payloadB64)         ← ★payloadB64 の "文字列" のバイトに署名(JSONを再直列化しない)★
token      = payloadB64 + "." + base64url(signature)
base64url  = '+'→'-' '/'→'_' パディング('=')なし
```
signEd25519 の実装(Deno WebCrypto):
```ts
async function signEd25519(payload, pkcs8Pem) {
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(pkcs8Pem), { name:'Ed25519' }, false, ['sign'])
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await crypto.subtle.sign({ name:'Ed25519' }, key, new TextEncoder().encode(payloadB64)) // ★payloadB64文字列に署名★
  return payloadB64 + '.' + b64url(new Uint8Array(sig))
}
// b64url = base64→url-safe置換+パディング除去 / pemToDer = PEM base64本文をデコード
```
- deploy: `supabase functions deploy dk-issue-license` ＋ secret設定: `supabase secrets set DK_LICENSE_PRIVKEY="<pkcs8 pem>"`
- anon から POST 可（会社検証はurl_tokenで行う・service_roleはEdge内のみ）。

## 手順④：疎通確認（テスト先行スクリプト・俺が用意）
- ★済(2026-07-03)★: client 側 `license-v2.verifyLicenseToken(token, 公開鍵)` + `evaluateLicenseToken` を
  テスト先行で実装済(tests/unit/license-v2-verify.test.js・11件緑)。テスト内でその場生成した
  Ed25519鍵で「正=valid / 改ざん=invalid / 別鍵=invalid / 期限切れ=expired / status:off=expired /
  偽トークンでも running=true は allowed」を確認済。★環境の Ed25519 WebCrypto 往復は実測OK★。
- 残: 司さんが手順①の PUBLIC(jwk.x) を渡す → license-v2.js に定数で埋め込む(現状は呼出側が公開鍵を渡す設計)。
- 残: Edge Function を deploy 後、実発行トークンを↑の verify に通して往復疎通(status off→expired 含む)。

---

## 役割分担（再開時）
- ★司さんがやる★: ①鍵生成(node 1コマンド)→PRIVATEをsecret登録・PUBLICを俺に渡す / ②SQL貼る / ③`supabase functions deploy`（or 俺が手順を出す）。
- ★俺がやる★: license-v2 に署名検証(crypto)を足す(テスト先行)・PUBLIC鍵を同梱・issue疎通スクリプト・以降STEP3(URL活性化UI+警告+更新ボタン)。

## 要検証(捏造せず deploy時に実測)
- ★済★: raw公開鍵(jwk.x 32byte) の import→verify 往復は node WebCrypto で実測OK(正=true/改ざん=false)。
- ★残(gate ON 前の必須ゲート)★: WebCrypto Ed25519 が Android Chrome(対象端末)で使えるか実機確認。
  現 verifyLicenseToken は未対応環境で fail-closed(=全トークン invalid→unlicensed)。gate OFF の今は無害だが、
  ★gate を ON にする前に必ず feature-detect し、非対応なら tweetnacl(JS実装) へ fallback する★。でないと
  非対応端末の正規ユーザーまで unlicensed になる(業務中 running=true だけは常に allowed で救済される)。
- ★残★: pkcs8秘密鍵(サーバ) で署名したトークンを、raw公開鍵(クライアント) で検証する実鍵での往復(deploy時)。

再開: 「ライセンス本実装 STEP1から」→ この docs/LICENSE_STEP1_SETUP.md を開いて①から。
