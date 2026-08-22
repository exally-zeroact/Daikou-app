// ============================================================
// ★引っ越しの作りは 今回限り。撤去の期限を「見張り」にする★（2026-08-22）
//
//   ★なぜ試験にするか★
//     2026-07-21 に「請求書の書き出しはやめる」と決めた物が、pushされず ★26日 動き続けた★。
//     ★口約束は消えない。試験にすれば消える★。
//
//   ★決まり★
//     引っ越し（js/dk-migrate.js とその呼び出し）は ★2026-09-30 まで★。
//     過ぎても残っていたら ★この試験が赤になる★。
//     撤去は ★テスト線と本番を1コミットで同時に★（片方だけ残さない）。
//
//   ★なぜ常設しないか★
//     ・テスト版は 2026-08-21 から ★ホーム画面に入れられない(display=browser)★
//     ・事務所は ★反対側のメーターのQRを出せない★（本番・テスト両方）
//     ⇒ 同じ状態は もう作れない。★引っ越しが要る端末は 今の3台だけ★。
//     ・本番に「他のアドレスから中身を受け取る口」を 永久に開けておくのは危ない。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATE_JS = path.join(ROOT, 'js', 'dk-migrate.js');
const DEADLINE = '2026-09-30'; // ★この日を過ぎたら撤去★（JSTの終わり）

describe('★引っ越しの作りは 期限で撤去する★', () => {
  const past = new Date() > new Date(DEADLINE + 'T23:59:59+09:00');
  const exists = fs.existsSync(MIGRATE_JS);

  it(`★${DEADLINE} を過ぎたら 引っ越しの作りが残っていてはいけない★`, () => {
    if (!past) {
      // まだ期限内。残っていてよい（この試験は期限を過ぎた日から効く）
      expect(true).toBe(true);
      return;
    }
    expect(
      exists,
      `★期限(${DEADLINE})を過ぎている。js/dk-migrate.js を消し、index.html の呼び出しも同じコミットで消せ★`
    ).toBe(false);
  });

  it(`★${DEADLINE} を過ぎたら index.html から呼び出しも消えている★`, () => {
    if (!past) {
      expect(true).toBe(true);
      return;
    }
    const h = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(h, '★index.html に dk-migrate.js の呼び出しが残っている★').not.toContain(
      'js/dk-migrate.js'
    );
    expect(h, '★帯のボタンが 引っ越しのままになっている★').not.toContain('DKMigrateStart');
  });

  it('★期限内は、期限がコードの中に書いてある（探さなくても分かる）★', () => {
    if (!exists) {
      expect(true).toBe(true);
      return;
    }
    const s = fs.readFileSync(MIGRATE_JS, 'utf8');
    expect(s, '★撤去の期限がコードに書いていない★').toContain(DEADLINE);
  });
});
