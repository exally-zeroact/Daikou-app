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
//     node scripts/auth-redirect-allow.mjs --prod     … 本番の倉庫だけ 見る
//     node scripts/auth-redirect-allow.mjs --test     … テストの倉庫だけ 見る
//     node scripts/auth-redirect-allow.mjs --apply    … 足りない物を足す
//
//   ★当てる倉庫と 同じ側のホストしか 作りません★ 2026-08-25（指示役の裁定）
//     本番の倉庫に daikou-app-test を足す、という事は ★起きません★。
//
//   鍵は %TEMP%\daikome-db-token.json か 環境変数 SUPABASE_ACCESS_TOKEN から読む。
//   ★画面には出さない★
// ============================================================
import { HOSTS } from './dk-hosts.mjs';
// ★鍵の探し場所は scripts/db-token.mjs 1箇所だけ★
//   ここに自分で書くと必ずズレる（実際にズレて「鍵が無い」と誤診断した）。
import { readToken, whereWeLooked } from './db-token.mjs';

// ★倉庫は2つある (2026-08-07)★
//   テスト側が別の倉庫(DB-test)に切り替わったのに、この道具は本番だけを見ていた。
//   ＝★テスト側の許可リストが空のまま★になり、メールのリンクが
//     既定の戻り先(http://localhost:3000)に流れて★開けなかった★。
//   司さん「メール開いたらこれ（localhost）」で発覚。
//   使い方: node scripts/auth-redirect-allow.mjs [--test|--prod|--both] [--apply]
const PROJECTS = {
  prod: 'tnfwipbgfgjaymlszeid',
  test: 'khawdrnvssdenumbiwfg',
};
const PROJECT = PROJECTS.prod; // 後方互換（既存の呼び出しはこれまでどおり本番）

// 4ホストぶん、ログインが戻ってくる可能性のある住所
// ★その環境のホストだけ取り出す★ 2026-08-25（指示役の裁定）
//   ★踏みかけた事★
//     wantedUrls(HOSTS) は 4ホストぜんぶ を作るので、
//     `--prod --apply` を1回 押すと ★本番の許可リストに daikou-app-test が入る★。
//     ＝2026-08-23 に外した「環境の混ざり」が 黙って元に戻る。
//   ⇒ ★当てる倉庫と 同じ側のホストだけ★ を作る。
export function hostsOfSide(side, hosts = HOSTS) {
  const out = {};
  for (const [host, h] of Object.entries(hosts)) {
    if (h.side === side) out[host] = h;
  }
  return out;
}

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

  // ★どの倉庫を見るか（既定は両方）★
  //   片方だけ見ていたせいで、テスト側の許可リストが空のまま気づけなかった。
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
    console.log('★SITE_URL（触らない）★\n  ' + cur.site_url);
    console.log('\n★今の許可リスト★');
    const now = String(cur.uri_allow_list || '')
      .split(',')
      .filter(Boolean);
    if (!now.length) console.log('  ★1つも無い★');
    now.forEach((u) => console.log('  ' + u));

    // ★当てる倉庫と 同じ側のホストだけ★（反対側の住所は 作らない）
    const wanted = wantedUrls(hostsOfSide(key));
    const { list, added } = merge(cur.uri_allow_list, wanted);

    // ★押す前に 必ず 数を出す★ 2026-08-25（指示役の裁定③）
    console.log('');
    console.log('★数えます★');
    console.log('  今 入っている … ' + now.length + ' 件');
    console.log('  この道具が持つ（' + key + ' の2ホストぶん） … ' + wanted.length + ' 件');
    console.log('  ★足す★ … ' + added.length + ' 件');
    console.log('  ★触らない（今あるまま残す）★ … ' + now.length + ' 件');
    console.log('  足した後 … ' + list.length + ' 件');

    // ★反対側の住所を作っていないか 自分で確かめる★（作っていたら 押さずに止まる）
    const other = key === 'prod' ? 'test' : 'prod';
    const otherHosts = Object.keys(hostsOfSide(other));
    const mixed = added.filter((u) => otherHosts.some((h) => u.includes(h)));
    if (mixed.length) {
      console.error('');
      console.error('★止めます：' + key + ' の倉庫に ' + other + ' の住所を足そうとしました★');
      mixed.forEach((u) => console.error('  ' + u));
      process.exitCode = 1;
      continue;
    }
    console.log('\n★足りない物★');
    if (!added.length) console.log('  無し（' + key + ' の2ホスト 全部ある）');
    else added.forEach((u) => console.log('  + ' + u));
    missingTotal += added.length;

    // ★process.exit() を使わない (2026-08-02)★
    //   まだ開いている通信が有るうちに切ると Windows の node が
    //   「Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)」で落ち、
    //   ★中身は正しいのに終了コード 9★ になる（CIが赤と誤解する）。
    if (process.argv.includes('--apply') && added.length) {
      await applyList(url, H, list, wanted);
    }
  }

  if (!process.argv.includes('--apply')) {
    console.log('\n見ただけです。足すなら --apply を付けてください。');
    process.exitCode = missingTotal ? 1 : 0;
  } else {
    process.exitCode = 0;
  }
}

async function applyList(url, H, list, wanted) {
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
  // ★確かめるのも その側の住所だけ★（4本ぜんぶ見ると 反対側が無くて 嘘の赤になる）
  const still = (wanted || wantedUrls()).filter((u) => !after.uri_allow_list.includes(u));
  if (still.length) {
    console.error('★まだ足りない★ ' + still.join(', '));
    process.exitCode = 1;
    return;
  }
  console.log('この側の2ホスト 全部そろいました。');
}
