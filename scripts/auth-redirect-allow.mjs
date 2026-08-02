// ============================================================
// scripts/auth-redirect-allow.mjs
// ★ログインのメールが戻ってこられる住所（許可リスト）を4ホストに揃える★ 2026-08-02
//
//   ダイコメのログインは「メールのリンクを踏んで戻ってくる」方式。
//   Supabase は★戻り先が許可リストに載っている住所でないと弾く★。
//   事務所を新しい住所(daikome-jimusho-test)に作ったので、そこを足さないと
//   ★テストの事務所にログインできない★。
//
//   ★Site URL は絶対に触らない★
//     あれは「行き先が指定されていない時の既定の戻り先」。変えると
//     他のアプリのログインの戻り先まで動く。ここは許可リストに★足すだけ★。
//
//   使い方:
//     node scripts/auth-redirect-allow.mjs            … 今の状態を見るだけ
//     node scripts/auth-redirect-allow.mjs --apply    … 足りない物を足す
//
//   鍵は %TEMP%\daikome-db-token.json か 環境変数 SUPABASE_ACCESS_TOKEN から読む。
//   ★画面には出さない★
// ============================================================
import { HOSTS } from './dk-hosts.mjs';
// ★鍵の探し場所は scripts/db-token.mjs 1箇所だけ★
//   ここに自分で書くと必ずズレる（実際にズレて「鍵が無い」と誤診断した）。
import { readToken, whereWeLooked } from './db-token.mjs';

const PROJECT = 'tnfwipbgfgjaymlszeid';

// 4ホストぶん、ログインが戻ってくる可能性のある住所
export function wantedUrls(hosts = HOSTS) {
  const out = [];
  for (const [host, h] of Object.entries(hosts)) {
    const b = 'https://' + host;
    out.push(b, b + '/**');
    if (h.role === 'office') out.push(b + '/dashboard.html', b + '/login.html');
  }
  return out;
}

// 既にある物を消さずに、足りない物だけ足す（★消すのは事故のもと★）
export function merge(current, wanted) {
  const have = new Set(
    String(current || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const added = wanted.filter((u) => !have.has(u));
  added.forEach((u) => have.add(u));
  return { list: Array.from(have), added };
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('auth-redirect-allow.mjs');
if (isMain) {
  const found = readToken();
  if (!found) {
    console.error('鍵が見つかりません。探した場所:');
    whereWeLooked().forEach((p) => console.error('  ' + p));
    process.exit(2);
  }
  console.log('鍵の出どころ: ' + found.from);
  const H = { Authorization: 'Bearer ' + found.token, 'Content-Type': 'application/json' };
  const url = `https://api.supabase.com/v1/projects/${PROJECT}/config/auth`;

  const cur = await fetch(url, { headers: H }).then((r) => r.json());
  console.log('★SITE_URL（触らない）★\n  ' + cur.site_url);
  console.log('\n★今の許可リスト★');
  String(cur.uri_allow_list || '')
    .split(',')
    .filter(Boolean)
    .forEach((u) => console.log('  ' + u));

  const { list, added } = merge(cur.uri_allow_list, wantedUrls());
  console.log('\n★足りない物★');
  if (!added.length) console.log('  無し（4ホスト全部ある）');
  else added.forEach((u) => console.log('  + ' + u));

  // ★process.exit() を使わない (2026-08-02)★
  //   まだ開いている通信が有るうちに切ると Windows の node が
  //   「Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)」で落ち、
  //   ★中身は正しいのに終了コード 9★ になる（CIが赤と誤解する）。
  if (!process.argv.includes('--apply')) {
    console.log('\n見ただけです。足すなら --apply を付けてください。');
    process.exitCode = added.length ? 1 : 0;
  } else if (!added.length) {
    console.log('\n足す物はありません。');
    process.exitCode = 0;
  } else {
    await applyList(url, H, list);
  }
}

async function applyList(url, H, list) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: H,
    // ★uri_allow_list だけ送る。site_url は送らない＝触らない★
    body: JSON.stringify({ uri_allow_list: list.join(',') }),
  });
  if (!res.ok) {
    console.error('失敗: ' + res.status + ' ' + (await res.text()));
    process.exitCode = 1;
    return;
  }
  const after = await fetch(url, { headers: H }).then((r) => r.json());
  console.log('\n★足したあと★');
  String(after.uri_allow_list || '')
    .split(',')
    .filter(Boolean)
    .forEach((u) => console.log('  ' + u));
  console.log('\nSITE_URL は ' + after.site_url + '（変えていない）');
  const still = wantedUrls().filter((u) => !after.uri_allow_list.includes(u));
  if (still.length) {
    console.error('★まだ足りない★ ' + still.join(', '));
    process.exitCode = 1;
    return;
  }
  console.log('4ホスト全部そろいました。');
}
