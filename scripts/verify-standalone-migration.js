#!/usr/bin/env node
'use strict';
// ============================================================================
// ダイコメ 独立プロジェクト 移設後 自動検証 (2026-07-31)
//
//   ★目的: 「新しい倉庫(Supabaseプロジェクト)へ引っ越しが正しく終わったか」を人の目でなく機械で判定する。★
//   移設は「一部だけ旧倉庫を指したまま」が一番危ない。このスクリプトが全部緑にならない限り
//   移設完了と言わない。
//
//   使い方:
//     node scripts/verify-standalone-migration.js
//     node scripts/verify-standalone-migration.js --company=<url_token>   ← 署名往復まで検証(推奨)
//
//   接続先は js/dk-config.js から読む(単一真実源)。引数で上書きしない = 実際にアプリが使う先を検証する。
//
//   --company を付けると「実際にライセンスを1枚発行して、アプリ同梱の公開鍵で検証する」所まで通す。
//   ★注意: そのとき使う端末IDは 'verify-migration-probe' 固定。会社の席を1つ消費する。
//     検証後は dashboard の端末一覧から「外す」か、SQL で削除して席を戻すこと(最後に案内を出す)。
// ============================================================================

const path = require('path');

const cfg = require(path.join('..', 'js', 'dk-config.js'));
const LicenseV2 = require(path.join('..', 'js', 'license-v2.js'));

const PROBE_DEVICE = 'verify-migration-probe';

const args = process.argv.slice(2);
const companyArg = (args.find((a) => a.startsWith('--company=')) || '').split('=')[1] || '';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, detail) {
  pass++;
  console.log('  ✅ ' + name + (detail ? '  (' + detail + ')' : ''));
}
function ng(name, detail) {
  fail++;
  failures.push(name + (detail ? ' — ' + detail : ''));
  console.log('  ❌ ' + name + (detail ? '  (' + detail + ')' : ''));
}

async function main() {
  console.log('');
  console.log('==== ダイコメ 移設後検証 ====');
  console.log('倉庫(Supabase) : ' + cfg.SB_URL);
  console.log('アプリURL      : ' + cfg.APP_BASE);
  console.log('同梱公開鍵     : ' + LicenseV2.PUBLIC_KEY);
  console.log('');

  // ---- 1. 倉庫に繋がるか + メールログインが使えるか -------------------------
  //   ※ PostgREST のルート(/rest/v1/)は元から閉じていて 401 を返すので、そこは見ない。
  //     Auth の公開設定エンドポイントを見る = プロジェクト到達 + anonキー一致 + メール設定 が一度に分かる。
  console.log('[1] 倉庫に繋がる / メールログイン');
  try {
    const r = await fetch(cfg.SB_URL + '/auth/v1/settings', {
      headers: { apikey: cfg.ANON_KEY },
    });
    if (r.status === 200) {
      ok('倉庫に繋がる(anonキーが一致)');
      const s = await r.json().catch(() => ({}));
      const emailOn = s && s.external && s.external.email === true;
      if (emailOn) ok('メール(マジックリンク)ログインが有効');
      else ng('メール(マジックリンク)ログインが有効', 'Auth の Email プロバイダが OFF');
      // 新規登録が閉じていると、会社が自分でアカウントを作れない
      if (s && s.disable_signup === true)
        ng('新規登録が許可されている', 'disable_signup=true = 会社がアカウントを作れない');
      else ok('新規登録が許可されている');
    } else if (r.status === 401) {
      ng('倉庫に繋がる(anonキーが一致)', '401 = anonキーがこの倉庫のものと一致していない');
    } else {
      ng('倉庫に繋がる(anonキーが一致)', 'HTTP ' + r.status);
    }
  } catch (e) {
    ng('倉庫に繋がる(anonキーが一致)', String(e.message || e));
  }

  // ---- 2. 表が出来ていて、匿名では中身が見えない(RLS) -----------------------
  console.log('[2] 表とRLS(鍵)');
  for (const table of ['dk_companies', 'dk_company_devices']) {
    try {
      const r = await fetch(cfg.rest(table + '?select=*&limit=5'), {
        headers: cfg.headers(),
      });
      const body = await r.text();
      if (r.status === 404 || /does not exist/i.test(body)) {
        ng(table + ' が存在する', '表がまだ作られていない (migrate-standalone.sql 未実行?)');
        continue;
      }
      ok(table + ' が存在する');
      // 匿名で中身が返ってきたら情報漏れ = RLS が効いていない
      let rows = null;
      try {
        rows = JSON.parse(body);
      } catch (_) {
        /* ignore */
      }
      if (Array.isArray(rows) && rows.length === 0) {
        ok(table + ' は匿名から中身が見えない(RLS)', '0件');
      } else if (Array.isArray(rows)) {
        ng(table + ' は匿名から中身が見えない(RLS)', '★' + rows.length + '件 見えている=漏れ★');
      } else {
        // 401/403 等でも「見えない」は満たす
        ok(table + ' は匿名から中身が見えない(RLS)', 'HTTP ' + r.status);
      }
    } catch (e) {
      ng(table + ' の確認', String(e.message || e));
    }
  }

  // ---- 3. Edge Function が動いているか -----------------------------------
  console.log('[3] Edge Function');
  // 3-1 dk-issue-license: 引数不足 → 400 missing (= 関数が生きていて中身まで到達している証拠)
  try {
    const r = await fetch(cfg.fn('dk-issue-license'), {
      method: 'POST',
      headers: cfg.headers(),
      body: JSON.stringify({}),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 400 && j.reason === 'missing') ok('dk-issue-license がデプロイ済で応答する');
    else if (r.status === 404) ng('dk-issue-license がデプロイ済', '404 = 未デプロイ');
    else if (r.status === 401)
      ng('dk-issue-license がデプロイ済', '401 = anonキーが新倉庫と不一致');
    else ng('dk-issue-license がデプロイ済', 'HTTP ' + r.status + ' ' + JSON.stringify(j));
  } catch (e) {
    ng('dk-issue-license がデプロイ済', String(e.message || e));
  }

  // 3-2 dk-issue-license: 存在しない会社URL → 404 invalid_url (= DB照会まで到達)
  try {
    const r = await fetch(cfg.fn('dk-issue-license'), {
      method: 'POST',
      headers: cfg.headers(),
      body: JSON.stringify({ url_token: 'no-such-company-token', device_id: PROBE_DEVICE }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 && j.reason === 'invalid_url')
      ok('dk-issue-license が倉庫を照会できている');
    else if (j.reason === 'server_no_key')
      ng('dk-issue-license の秘密鍵', '★DK_LICENSE_PRIVKEY が未設定★');
    else if (j.reason === 'db_error') ng('dk-issue-license が倉庫を照会できている', 'DBエラー');
    else
      ng('dk-issue-license が倉庫を照会できている', 'HTTP ' + r.status + ' ' + JSON.stringify(j));
  } catch (e) {
    ng('dk-issue-license が倉庫を照会できている', String(e.message || e));
  }

  // 3-3 dk-register-company: 未ログイン → 401 (= 認証が配線されている)
  try {
    const r = await fetch(cfg.fn('dk-register-company'), {
      method: 'POST',
      headers: cfg.headers(),
      body: JSON.stringify({ company_name: 'probe' }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && j.reason === 'unauthorized')
      ok('dk-register-company が未ログインを弾く(認証配線OK)');
    else if (r.status === 404) ng('dk-register-company がデプロイ済', '404 = 未デプロイ');
    else ng('dk-register-company が未ログインを弾く', 'HTTP ' + r.status + ' ' + JSON.stringify(j));
  } catch (e) {
    ng('dk-register-company が未ログインを弾く', String(e.message || e));
  }

  // ---- 4. ★本命★ 署名の往復(サーバ秘密鍵 と アプリ同梱公開鍵 が噛み合うか) ----
  console.log('[4] 署名の往復(サーバ秘密鍵 ↔ アプリ同梱公開鍵)');
  if (!companyArg) {
    console.log(
      '  ⚠️  スキップ: --company=<url_token> を付けると実施。' +
        '★鍵の噛み合わせはここでしか分からない。移設完了と言う前に必ず1回通すこと。★'
    );
  } else {
    try {
      const r = await fetch(cfg.fn('dk-issue-license'), {
        method: 'POST',
        headers: cfg.headers(),
        body: JSON.stringify({ url_token: companyArg, device_id: PROBE_DEVICE, vin: '' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok || !j.token) {
        if (j.reason === 'seat_limit') ng('ライセンス発行', '契約台数が満席。席を空けてから再実行');
        else ng('ライセンス発行', 'HTTP ' + r.status + ' ' + JSON.stringify(j));
      } else {
        ok('ライセンス発行(署名トークンが返る)');
        const v = await LicenseV2.verifyLicenseTokenEmbedded(j.token);
        if (v && v.valid) {
          ok('★アプリ同梱の公開鍵で検証できる(鍵が噛み合っている)★');
          const ev = await LicenseV2.evaluateLicenseTokenEmbedded(j.token, Date.now(), {
            running: false,
          });
          if (ev.state === 'active' && ev.allowed === true)
            ok('状態が active・業務開始が許可される', 'あと' + ev.daysLeft + '日');
          else ng('状態が active', 'state=' + ev.state + ' allowed=' + ev.allowed);
          if (v.payload && v.payload.device_id === PROBE_DEVICE) ok('端末IDがトークンに入っている');
          else ng('端末IDがトークンに入っている', JSON.stringify(v.payload));
        } else {
          ng(
            '★アプリ同梱の公開鍵で検証できる★',
            '★鍵が噛み合っていない = js/license-v2.js の PUBLIC_KEY と ' +
              'Edge Function secret DK_LICENSE_PRIVKEY が別ペア★'
          );
        }
      }
    } catch (e) {
      ng('署名の往復', String(e.message || e));
    }
  }

  // ---- まとめ ------------------------------------------------------------
  console.log('');
  console.log('==== 結果: ' + pass + ' 件OK / ' + fail + ' 件NG ====');
  if (fail > 0) {
    console.log('');
    console.log('直すもの:');
    failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
    console.log('');
    console.log('★NGが1件でもある間は「移設完了」ではない。★');
  } else {
    console.log('全部OK。移設は正しく通っている。');
  }
  if (companyArg) {
    console.log('');
    console.log(
      '⚠️ 後片付け: 端末 "' +
        PROBE_DEVICE +
        '" が1席使っている。dashboard の端末一覧で「外す」か、SQLで削除して席を戻すこと:'
    );
    console.log("   delete from dk_company_devices where device_id = '" + PROBE_DEVICE + "';");
  }
  console.log('');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('検証スクリプトが落ちた:', e);
  process.exit(1);
});
