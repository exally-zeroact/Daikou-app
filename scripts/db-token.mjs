// ============================================================
// scripts/db-token.mjs
// ★倉庫(Supabase)の鍵の探し場所 ─ ここが唯一の正★ 2026-08-02
//
//   ★なぜ1箇所にするか（実際にやらかした）★
//     auth-redirect-allow.mjs を作った時、探し場所を2つしか書かなかった:
//       %TEMP%\daikome-db-token.json / ~/.supabase-token
//     ところが実物は ★%TEMP%\nomiya-db-url-prod.json★ に入っていた
//     （apply-supabase-sql.mjs はそこまで探していた）。
//     結果「鍵が無い」と★誤って診断して、司さんの手番にしてしまった★。
//     道具ごとに探し場所を書くと必ずズレる。だからここ1箇所にする。
//
//   ★鍵は画面に出さない★ どのファイルから読んだか(from)だけ返す。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ★探し場所の一覧（この順に見る）★
//   増やす時はここだけ直す。tests/unit/db-token-sources.test.js が
//   「どの道具もこの一覧を使っている」ことを見張る。
export function candidatePaths() {
  const tmp = process.env.TEMP || process.env.TMP || os.tmpdir();
  return [
    path.join(tmp, 'daikome-db-token.json'),
    path.join(tmp, 'nomiya-db-url-prod.json'),
    path.join(tmp, 'nomiya-db-url.json'),
    path.join(os.homedir(), '.supabase-token'),
  ];
}

export function readToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) {
    return { token: process.env.SUPABASE_ACCESS_TOKEN, from: '環境変数 SUPABASE_ACCESS_TOKEN' };
  }
  for (const f of candidatePaths()) {
    try {
      if (!fs.existsSync(f)) continue;
      const raw = fs.readFileSync(f, 'utf8').trim();
      const tok = raw.startsWith('{') ? JSON.parse(raw).token : raw;
      if (typeof tok === 'string' && tok.startsWith('sbp_')) {
        return { token: tok, from: path.basename(f) };
      }
    } catch (_) {
      /* 次を見る */
    }
  }
  return null;
}

// 見つからなかった時に、どこを探したかを人に見せる（次の人が迷わない）
export function whereWeLooked() {
  return ['環境変数 SUPABASE_ACCESS_TOKEN', ...candidatePaths()];
}
