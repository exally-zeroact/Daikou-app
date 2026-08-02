'use strict';
// ============================================================
// ★倉庫の鍵の探し場所が、道具ごとにズレていないこと 2026-08-02★
//
//   ★実際にやらかした★
//     auth-redirect-allow.mjs を作った時、探し場所を2つしか書かなかった:
//       %TEMP%\daikome-db-token.json / ~/.supabase-token
//     実物は ★%TEMP%\nomiya-db-url-prod.json★ に入っていた
//     （apply-supabase-sql.mjs はそこまで探していた）。
//     結果「鍵が見つかりません」と★誤って診断し、司さんの手番にしてしまった★。
//     ＝鍵は最初から有ったのに、自分の道具が見ていなかっただけ。
//
//   道具ごとに探し場所を書くと必ずズレる。
//   → scripts/db-token.mjs を唯一の正にして、他の道具は自分で書かない。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(ROOT, 'scripts');

// 鍵を使う道具（増えたらここに足す）
const USERS = ['apply-supabase-sql.mjs', 'auth-redirect-allow.mjs', 'db-snapshot.mjs'];

function read(f) {
  return fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
}
function exists(f) {
  return fs.existsSync(path.join(SCRIPTS, f));
}

describe('★鍵の探し場所は1箇所だけ★', () => {
  it('scripts/db-token.mjs が在る', () => {
    expect(exists('db-token.mjs')).toBe(true);
  });

  it('★探し場所に nomiya-db-url-prod.json が入っている（実物がここに在った）★', async () => {
    const m = await import('../../scripts/db-token.mjs');
    const list = m.candidatePaths().map((p) => path.basename(p));
    expect(list, '実物が在る場所を見ていない＝また「鍵が無い」と誤診断する').toContain(
      'nomiya-db-url-prod.json'
    );
    expect(list).toContain('daikome-db-token.json');
  });

  it('見つからない時に「どこを探したか」を人に見せられる', async () => {
    const m = await import('../../scripts/db-token.mjs');
    const w = m.whereWeLooked();
    expect(w.length).toBeGreaterThan(2);
    expect(w[0]).toContain('SUPABASE_ACCESS_TOKEN');
  });

  it('見張る対象が実在する（空振りしていない）', () => {
    expect(USERS.filter(exists).length).toBeGreaterThan(0);
  });

  it('★どの道具も自分で探し場所を書いていない★', () => {
    const offenders = [];
    for (const f of USERS) {
      if (!exists(f)) continue;
      const src = read(f);
      // 自分でファイル名を書いている＝ズレる元
      const writesOwn = /daikome-db-token\.json|nomiya-db-url|\.supabase-token/.test(src);
      const usesShared = /from '\.\/db-token\.mjs'/.test(src);
      if (writesOwn && !usesShared) offenders.push(f + '（自分で探し場所を書いている）');
      if (!usesShared) offenders.push(f + '（db-token.mjs を使っていない）');
    }
    expect(offenders, '探し場所がズレると、鍵が有るのに「無い」と誤診断する').toEqual([]);
  });
});
