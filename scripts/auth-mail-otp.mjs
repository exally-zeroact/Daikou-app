// ============================================================
// scripts/auth-mail-otp.mjs
// ★ログインのメールに「6桁の番号」を入れる★ 2026-08-03
//
//   ★なぜ変えるか（司さんの指摘が正解だった）★
//     今: メール届く → ★リンクを押す★ → ブラウザが開く → そっちでログイン
//         → ★アプリ側は「まだ誰も入っていない」ままなので、何回やっても聞かれる★
//     アプリとブラウザは別々の場所にログイン情報を持つ。リンクで飛ぶ限り直らない。
//     （「ホーム画面に追加すれば直る」は間違いだった。リンクがブラウザで開く以上、同じ）
//
//   後: メール届く → ★6桁の番号が書いてある★ → 開いている画面に打ち込む
//       → その場でログイン完了。★ブラウザに飛ばない★
//
//   ※リンクも残す（パソコンで開いている時はリンクの方が早い）。
//     番号を足すだけなので、今までのやり方も壊れない。
//
//   使い方:
//     node scripts/auth-mail-otp.mjs                    … 本番とテスト 両方の本文を見るだけ
//     node scripts/auth-mail-otp.mjs --test             … テストの倉庫だけ見る
//     node scripts/auth-mail-otp.mjs --prod --apply     … 本番に6桁を入れる
// ============================================================
import { readToken, whereWeLooked } from './db-token.mjs';

// ★倉庫は2つある (2026-08-07)★
//   兄弟の auth-redirect-allow.mjs は 8/7 に両対応へ直したのに、
//   ★この道具だけ本番の直書きが残っていた★＝テストrepoの道具なのに
//   本番の認証設定しか見えない/触れない形だった（片方だけ直して片方を置き去り）。
//   同じ形（--prod / --test / 既定=両方）に揃える。
const PROJECTS = {
  prod: 'tnfwipbgfgjaymlszeid',
  test: 'khawdrnvssdenumbiwfg',
};
// 後方互換（他から import された時は これまでどおり本番を指す）
export const PROJECT = PROJECTS.prod;

export const SUBJECT = 'ダイコメ ログイン用の番号';

// ★{{ .Token }} が6桁の番号★（Supabaseが差し込む）
export const TEMPLATE = [
  '<h2>ダイコメ ログイン</h2>',
  '<p>ログイン画面に、この番号を打ち込んでください。</p>',
  '<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0">{{ .Token }}</p>',
  '<p style="color:#666;font-size:13px">この番号は1時間で使えなくなります。</p>',
  '<hr style="border:0;border-top:1px solid #ddd;margin:20px 0">',
  '<p style="color:#666;font-size:13px">パソコンで開いている場合は、こちらを押しても入れます。</p>',
  '<p><a href="{{ .ConfirmationURL }}">ログインする</a></p>',
].join('\n');

// 6桁が入っているか（入っていなければ「番号を打つ」やり方が成立しない）
export function hasToken(tpl) {
  return /\{\{\s*\.Token\s*\}\}/.test(String(tpl || ''));
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('auth-mail-otp.mjs');
if (isMain) {
  const found = readToken();
  if (!found) {
    console.error('鍵が見つかりません。探した場所:');
    whereWeLooked().forEach((p) => console.error('  ' + p));
    process.exitCode = 2;
  } else {
    const H = { Authorization: 'Bearer ' + found.token, 'Content-Type': 'application/json' };
    console.log('鍵の出どころ: ' + found.from);

    // ★どの倉庫を見るか（既定は両方）★ 片方だけ見ると もう片方を置き去りにする。
    const which = process.argv.includes('--prod')
      ? ['prod']
      : process.argv.includes('--test')
        ? ['test']
        : ['prod', 'test'];

    let missingTotal = 0;
    for (const key of which) {
      const url = `https://api.supabase.com/v1/projects/${PROJECTS[key]}/config/auth`;
      console.log('\n================ ' + (key === 'prod' ? '本番' : 'テスト') + ' ================');
      const cur = await fetch(url, { headers: H }).then((r) => r.json());

      console.log('★今の本文★');
      console.log(cur.mailer_templates_magic_link_content || '(既定のまま)');
      const has = hasToken(cur.mailer_templates_magic_link_content);
      console.log('\n6桁の番号: ' + (has ? 'ある' : '★無い★'));
      if (!has) missingTotal++;

      // ★process.exit() を使わない★（兄弟の auth-redirect-allow.mjs と同じ理由:
      //   通信が開いたまま切ると Windows の node が落ちて終了コード9＝CIが赤と誤解する）
      if (process.argv.includes('--apply')) {
        const res = await fetch(url, {
          method: 'PATCH',
          headers: H,
          // ★メールの本文と件名だけ。他の設定には触らない★
          body: JSON.stringify({
            mailer_subjects_magic_link: SUBJECT,
            mailer_templates_magic_link_content: TEMPLATE,
          }),
        });
        if (!res.ok) {
          console.error('失敗: ' + res.status + ' ' + (await res.text()));
          process.exitCode = 1;
          continue;
        }
        const after = await fetch(url, { headers: H }).then((r) => r.json());
        console.log('\n★入れたあと★');
        console.log(after.mailer_templates_magic_link_content);
        const ok = hasToken(after.mailer_templates_magic_link_content);
        console.log('\n6桁の番号: ' + (ok ? 'ある' : '★入っていない★'));
        console.log('SITE_URL は ' + after.site_url + '（変えていない）');
        if (!ok) process.exitCode = 1;
      }
    }

    if (!process.argv.includes('--apply')) {
      console.log('\n見ただけです。入れるなら --apply を付けてください。');
      process.exitCode = missingTotal ? 1 : 0;
    }
  }
}
