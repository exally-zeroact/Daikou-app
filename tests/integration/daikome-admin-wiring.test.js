'use strict';
// ============================================================
// ★ダイコメ 管理画面（運営＝司さん専用）★ 2026-08-07
//
//   司さん「ダイコメの管理アプリを（Exally系の）ように作って
//           そこでおれが権限持つようしろ」
//         「ダイコメ用の作れや 最終は別アプリやろが」
//         「だれがそんな指示したんど おれは管理画面っていよろが」
//
//   ★他のアプリの管理画面を全部見てから作った（2026-08-07）★
//     payslip-app/admin.html（Kyually）／ nomiya-app/castally-admin.html（Castally）
//     どちらも同じ形:
//       ログイン → 管理者か判定 → お客さん一覧 → ★押して切り替えるだけ★
//       人の追加・削除・招待は無い。管理者を増やすのもSQL手打ち。
//     代行請求・アマかせには管理画面そのものが無い。
//
//   ★ダイコメで押す物は「プラン」ではなく 使う/止める と 席数★
//     dk_companies.status / seat_limit は★元からある★。新しい仕組みは足さない。
//
//   ★倉庫の側で実際にログインして確かめた（テストDB）★
//     ① 運営は管理者と分かる／お客さんははじかれる
//     ② 運営には会社が全部見える（2社）
//     ③ お客さんには他社が★0件★
//     ④ 運営が「止める」を押せる（on→off）
//     ⑤ 席数を変えられる（3→9）
//     ⑥ ★お客さんは他社を止められない・席数も変えられない★
//        （返り値が空＝1行も書き換わっていない。1回目は既にoffで判定できず、
//          onに戻してからやり直した）
// ============================================================
const fs = require('fs');
const path = require('path');
// ★道具を そのまま動かして確かめる為★（ソースを読むだけにしない）
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'daikome-admin.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'js', 'daikome-admin.js'), 'utf8');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'apply-dk-admins.sql'), 'utf8');

describe('★他のアプリの管理画面と同じ形であること★', () => {
  it('画面は3つの状態を出し分ける（ログイン / 権限なし / 一覧）', () => {
    ['id="login"', 'id="denied"', 'id="panel"'].forEach(function (s) {
      expect(HTML, s + ' が無い').toContain(s);
    });
    expect(JS).toMatch(/\['login', 'denied', 'panel'\]/);
  });

  it('メール＋パスワードで入る（やり方を増やしていない）', () => {
    expect(JS, '★パスワードで入る形になっていない★').toContain('signInWithPassword');
    // ★2026-08-07 見方を正した★
    //   司さん「新規ではいるボタン作れ」で、はじめての人向けに
    //   ★1回だけメールを送ってパスワードを決めてもらう★道を足した。
    //   事務所のログイン(login.html)と同じ形。これは「入り方が増えた」のではなく
    //   ★パスワードを決める道★。毎回メールで入る形（魔法のリンク）にはしていない。
    expect(JS, '★毎回メールで入る形になっている★').not.toMatch(/magiclink/i);
    expect(JS, 'パスワードを決める道が無い').toContain('updateUser({ password:');
  });

  it('権限が無ければ はっきり断る', () => {
    expect(HTML).toContain('ダイコメの運営ではありません');
    expect(JS).toMatch(/show\('denied'\)/);
  });

  it('しぼり込み・更新・件数がある（他の2つと同じ）', () => {
    expect(HTML).toContain('id="q"');
    expect(HTML).toContain('id="refresh"');
    // 整形で改行が入るので、文字と数の出どころを別々に見る（書き方に縛られない）
    expect(JS, '★件数を出していない★').toContain('全部で ');
    expect(JS, '★件数の元が rows でない★').toContain('rows.length');
    expect(JS, '★止めている会社の数を出していない★').toContain('止めている会社 ');
  });

  // ★2026-08-07 直した★ 元は signUp も禁じていたが、それは行き過ぎだった。
  //   signUp は「自分のアカウントを自分で作る」＝他のアプリのログインと同じ普通の道で、
  //   ★他人を足す/消す★ではない。禁じるのは「運営が他人を操作する」道だけにする。
  it('★人の追加・削除は入れていない★（他の2つにも無い）', () => {
    expect(JS, '★勝手に機能を足している★').not.toMatch(/admin\/users|招待|inviteUser|delete\(\)/);
    expect(JS, '★サービス鍵を置いている★').not.toMatch(/service_role|SERVICE_KEY/);
  });
});

describe('★ダイコメ自身に持たせること（最後は別アプリ）★', () => {
  it('管理者の棚は daikome の中', () => {
    expect(SQL).toContain('create table if not exists daikome.dk_admins');
  });

  it('★Exally の表に寄りかかっていない★', () => {
    const code = SQL.split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(code, '★exally_admins を使うと独立できない★').not.toMatch(/exally_admins|exally\./i);
    expect(JS, '★画面が Exally の表を読んでいる★').not.toContain('exally_admins');
    expect(JS, 'ダイコメ自身の管理者表を見ていない').toContain("from('dk_admins')");
  });

  // ★2026-08-07 司さん「アドレスも勝手に決めるなや」★
  //   私が司さんのアドレスを SQL に直接書き込んで自動登録していた。
  //   誰を運営にするかは司さんが決めること。Kyually も コメントのままにしてある。
  it('★アドレスを直接書き込んでいない★（誰を運営にするかは司さんが決める）', () => {
    const code = SQL.split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    const mails = code.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [];
    expect(mails, '★実行される所にアドレスが書いてある★ ' + mails.join(', ')).toEqual([]);
    expect(code, '★勝手に管理者を登録している★').not.toMatch(/insert into daikome\.dk_admins/i);
  });

  it('登録のやり方は手順として残してある（コメント）', () => {
    expect(SQL, '登録の手順が書いていない').toContain('ここに運営のログインメール');
    expect(SQL, '外し方が書いていない').toContain('delete from daikome.dk_admins');
  });

  it('★管理者の一覧は漏らさない★（自分の行だけ読める）', () => {
    expect(SQL).toMatch(/dk_admins_read_self[\s\S]{0,120}account_id = auth\.uid\(\)/);
  });
});

describe('★運営だけが 見られる・変えられること★', () => {
  it('会社を全部見られるのは管理者だけ', () => {
    expect(SQL).toMatch(/dk_companies_admin_read[\s\S]{0,120}is_dk_admin\(\)/);
  });

  it('状態と席数を変えられるのは管理者だけ', () => {
    expect(SQL).toMatch(/dk_companies_admin_write[\s\S]{0,160}is_dk_admin\(\)/);
  });

  it('★お客さん自身の鍵は消していない★（今までどおり自分の会社は見える）', () => {
    // 追加した policy は admin 用だけ。既存の owner 用を drop していないこと。
    expect(SQL, '★お客さんが自分の会社を見られなくなる★').not.toMatch(
      /drop policy[^\n]*owner[^\n]*on daikome\.dk_companies/i
    );
  });

  it('端末数・最後に走った日を出すための鍵もある', () => {
    expect(SQL).toContain('dk_company_devices_admin_read');
    expect(SQL).toContain('dk_shifts_admin_read');
  });
});

describe('★押す物は「使う/止める」と「席数」であること★', () => {
  // ボタンは JS が組み立てる（一覧は毎回作り直すため）
  it('プランではなく 状態を押す', () => {
    expect(JS, '★「使う」ボタンが無い★').toContain('>使う<');
    expect(JS, '★「止める」ボタンが無い★').toContain('>止める<');
    expect(JS).toMatch(/function setStatus/);
    // 押すボタンにプランの言葉を持ち込んでいないこと（案内文の「お試しください」は別）
    expect(JS, '★他アプリのプラン(体験/有料)を押すボタンにしている★').not.toMatch(
      />体験<|>お試し<|>有料<|>無料<|>停止</
    );
  });

  it('席数を変えられる', () => {
    expect(JS, '★席数の欄が無い★').toContain('data-act="seat"');
    expect(JS).toMatch(/function setSeat/);
    expect(JS, '席数が負になる').toContain('Math.max(0,');
  });

  it('★押した瞬間に画面を変え、失敗したら戻す★（待たせない）', () => {
    // var/let/const は整形の道具が変えるので、どれでも通るようにする
    expect(JS, '★状態: 失敗しても戻していない★').toMatch(
      /(var|let|const) before = r\.status;[\s\S]{0,220}r\.status = before;/
    );
    expect(JS, '★席数: 失敗しても戻していない★').toMatch(
      /(var|let|const) before = r\.seat;[\s\S]{0,260}r\.seat = before;/
    );
  });

  it('★止めた/使えるようにした を言葉で出す★', () => {
    expect(JS).toMatch(/を止めました/);
    expect(JS).toMatch(/使えるようにしました/);
  });
});

// ============================================================
// ★運営が新しいお客さんを登録できること★ 2026-08-07
//   司さん「おれが新規で登録してやるんやろが」
//   今までは★お客さん自身が事務所から登録する★形しか無かった。
//   売るのは司さんなので、司さんの側から登録して会社URL(QR)を渡せるようにした。
//
//   ★倉庫の側で実際に確かめた（テストDB）★
//     運営が登録 → 201・会社URLが出る／持ち主は空（お客さんが登録した時に埋まる）
//     ★運営でない人が登録 → 403★
//     作った会社は消して置き土産ゼロ
// ============================================================
// ============================================================
// ★はじめて入る道があること★ 2026-08-07
//   司さん「新規ではいるボタン作れ」
//   ログイン画面に★入る道が1つも無く★、パスワードを知らないと詰んでいた。
//   事務所のログイン(login.html)と同じ形にした。★決めるのは本人★。
// ============================================================
describe('★はじめて入る道があること★', () => {
  it('ログイン画面に「パスワードを忘れた」がある', () => {
    expect(HTML, '★入る道が無い★').toContain('id="toSetPw"');
    expect(HTML).toContain('パスワードを忘れた');
  });

  it('メールを送る → 決める、まで画面がそろっている', () => {
    ['id="sendCard"', 'id="sentCard"', 'id="setPwCard"', 'id="pw1"', 'id="pw2"'].forEach(
      function (s) {
        expect(HTML, s + ' が無い').toContain(s);
      }
    );
    expect(HTML, 'ログインに戻れない').toContain('id="toLogin"');
  });

  it('★決めるのは本人★（こちらでパスワードを決めていない）', () => {
    expect(JS, '本人が決める所が無い').toContain('updateUser({ password:');
    expect(JS, '★短いパスワードを通している★').toMatch(/p1\.length < 6/);
    expect(JS, '打ち間違い（2つ違う）を見ていない').toMatch(/p1 !== p2/);
  });

  it('メールのリンクから戻ったら、そのまま決める画面になる', () => {
    expect(JS).toMatch(/access_token=[\s\S]{0,120}setPwCard/);
  });

  it('戻り先はこの画面（別の場所に飛ばさない）', () => {
    expect(JS, '★戻り先を指していない＝既定の場所に流される★').toMatch(
      /redirectTo:[\s\S]{0,80}daikome-admin\.html/
    );
  });

  // ★2026-08-07 司さん「メール開いたらこれ（localhost）」★
  //   Supabase は★許可リストに無い戻り先を黙って捨てて★既定(SITE_URL)へ流す。
  //   テスト側の倉庫は SITE_URL が http://localhost:3000 で、そこへ飛んでいた。
  //   道具(auth-redirect-allow.mjs)が★本番しか見ていなかった★のが元の穴。
  it('★戻り先の許可リストを、本番とテストの両方に当てられること★', () => {
    const tool = fs.readFileSync(path.join(ROOT, 'scripts', 'auth-redirect-allow.mjs'), 'utf8');
    expect(tool, '★片方の倉庫しか見ていない★').toMatch(/PROJECTS\s*=\s*\{[\s\S]{0,200}test:/);
    expect(tool, 'テスト側の倉庫を知らない').toContain('khawdrnvssdenumbiwfg');
    expect(tool, '★SITE_URL を触っている★').not.toMatch(/site_url\s*:/);
  });

  // ★2026-08-25 指示役の裁定★
  //   ★見つかった本当の危険★
  //     この道具の wantedUrls(HOSTS) は ★4ホストぜんぶ★ の住所を作っていた。
  //     `--prod --apply` を1回 押すと ★本番の許可リストに daikou-app-test が入る★。
  //     ＝2026-08-23 に外した「環境の混ざり」（本番22→16）が 黙って元に戻る。
  //   ⇒ 外す（ダイコメが自分の戻り先を足せなくなる）でも
  //     許す（押した瞬間に混ざる）でもなく ★直す★。
  it('★反対側の環境のURLを 足そうとしない★（本番に -test を入れない）', async () => {
    const tool = await import(
      pathToFileURL(path.join(ROOT, 'scripts', 'auth-redirect-allow.mjs')).href
    );
    expect(typeof tool.hostsOfSide, '★側で絞る道具が無い★').toBe('function');

    const prod = tool.wantedUrls(tool.hostsOfSide('prod'));
    const test = tool.wantedUrls(tool.hostsOfSide('test'));
    expect(prod.length, '★本番側の住所が作れていない★').toBeGreaterThan(0);
    expect(test.length, '★テスト側の住所が作れていない★').toBeGreaterThan(0);

    // ★本番の分に テストのホストが 1つも混ざらない★
    const mixedInProd = prod.filter((u) => /daikou-app-test|daikome-jimusho-test/.test(u));
    expect(
      mixedInProd,
      `★本番に足す住所に テストが ${mixedInProd.length} 件 混ざっています★ ` +
        mixedInProd.join(' / ')
    ).toEqual([]);

    // ★テストの分に 本番のホストが 1つも混ざらない★
    const mixedInTest = test.filter((u) =>
      /daikou-app\.vercel|daikome-jimusho\.vercel/.test(u)
    );
    expect(
      mixedInTest,
      `★テストに足す住所に 本番が ${mixedInTest.length} 件 混ざっています★ ` +
        mixedInTest.join(' / ')
    ).toEqual([]);

    // ★押す前に 数を出す★（見たつもりで当てるのを防ぐ）
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'auth-redirect-allow.mjs'), 'utf8');
    expect(src, '★押す前に 数を出していない★').toContain('★数えます★');
    expect(src, '★混ざりを見つけても 止まらない★').toContain(
      'の住所を足そうとしました★'
    );
  });

  // ★2026-08-07 司さん「他のアプリでユーザーがやるように、なんで同じ構造にせんのど」★
  //   給料・飲み屋・アマかせが使う js/exally-login.js は
  //   ★メール+パスワードを打って「新規登録」を押すだけ★。メールのリンクは使わない。
  //   ここも同じ形にする（届くのを待たない／localhost に飛ぶ事故も起きない）。
  it('★他のアプリと同じ「新規登録」ボタンがある★', () => {
    expect(HTML, '★新規登録ボタンが無い★').toMatch(/id="signup"/);
    expect(HTML, '押し方の説明が無い').toMatch(/はじめての方は/);
    expect(JS, '★新規登録が繋がっていない★').toMatch(/\$\('signup'\)\.onclick/);
    expect(JS, 'signUp を呼んでいない').toMatch(/sb\.auth\s*\.?\s*signUp\(/);
  });

  it('★新規登録の直後にそのまま入れる★（メール確認が要らない設定のとき）', () => {
    expect(JS, '登録しただけで放り出している').toMatch(/data\.session[\s\S]{0,120}boot\(\)/);
    expect(JS, '確認が要る設定のときの入り直しが無い').toMatch(
      /signUp\([\s\S]{0,1400}signInWithPassword/
    );
  });

  it('既に登録済みの時に、何をすればいいか出す', () => {
    expect(JS, '「登録済み」で行き止まりになる').toMatch(/already registered/i);
    expect(JS, 'ログインを押せと言っていない').toMatch(/登録済みです[\s\S]{0,80}ログイン/);
  });

  it('パスワードを忘れた時の道も残っている', () => {
    expect(JS, 'パスワード再設定の道になっていない').toContain('resetPasswordForEmail');
    expect(HTML, '忘れた時の入口が無い').toMatch(/id="toSetPw"/);
  });

  // ★運営かどうかは dk_admins で決まる★
  //   新規登録は「ただの利用者」を作るだけ。ここが緩むと誰でも管理画面に入れる。
  it('★登録しただけの人は入れない（dk_admins を見ている）★', () => {
    expect(JS, '★運営かどうかを見ていない★').toMatch(/from\('dk_admins'\)/);
    expect(JS, '権限なしの画面へ行っていない').toMatch(/show\('denied'\)/);
  });

  it('送れなかった理由を分けて出す（何をすればいいか分かる）', () => {
    expect(JS, '続けて送った時の案内が無い').toMatch(/1分ほど待って/);
    expect(JS, '登録されていない時の案内が無い').toMatch(/登録されていません/);
  });
});

describe('★運営が新しい会社を登録できること★', () => {
  it('登録の欄がある（会社名・連絡先・台数）', () => {
    ['id="newName"', 'id="newContact"', 'id="newSeat"', 'id="newAdd"'].forEach(function (s) {
      expect(HTML, s + ' が無い').toContain(s);
    });
  });

  it('★会社名は必須★（名前の無い会社を作らせない）', () => {
    expect(JS).toMatch(/if \(!name\)[\s\S]{0,120}会社名を入れてください/);
  });

  it('★連絡先の打ち間違いをその場で止める★（空は許す）', () => {
    expect(JS).toMatch(/if \(contact &&[\s\S]{0,120}\[a-z\]\{2,\}/);
  });

  it('★渡す会社URLを出す★（登録して終わりにしない）', () => {
    expect(HTML).toContain('id="newUrl"');
    expect(JS, '会社URLを組み立てていない').toMatch(/APP_BASE[\s\S]{0,80}'\/\?c=' \+/);
    expect(HTML, 'コピーできない').toContain('id="newCopy"');
  });

  it('★url_token は毎回ちがう物を作る★（人が推せない長さ）', () => {
    expect(JS).toMatch(/getRandomValues/);
    expect(JS, '短すぎる').toMatch(/Uint8Array\(16\)/);
  });

  it('★台数は1以上★', () => {
    expect(JS).toMatch(/Math\.max\(1, parseInt\(\$\('newSeat'\)/);
  });

  it('登録できるのは運営だけ（倉庫の鍵）', () => {
    expect(SQL).toMatch(/dk_companies_admin_insert[\s\S]{0,140}is_dk_admin\(\)/);
  });

  it('★持ち主は空のまま★（お客さんが自分で事務所に登録した時に埋まる）', () => {
    // 運営が勝手に自分を持ち主にしない
    expect(JS, '★運営が持ち主になってしまう★').not.toMatch(/owner_id\s*:/);
  });
});

describe('★危ない物を置いていないこと★', () => {
  it('サービス鍵をブラウザに置いていない', () => {
    expect(JS, '★サービス鍵が漏れる★').not.toMatch(/service_role|SERVICE_ROLE/);
    expect(HTML, '★サービス鍵が漏れる★').not.toMatch(/service_role|SERVICE_ROLE/);
  });

  it('倉庫の向き先は共通の設定から取る（直書きしない）', () => {
    expect(JS).toContain('window.DKConfig');
    expect(JS, '★倉庫を直書きしている★').not.toMatch(/https:\/\/[a-z0-9]{16,}\.supabase\.co/);
  });

  it('★事務所の画面には出さない★（運営専用・お客さんに見せない）', () => {
    const allow = fs.readFileSync(path.join(ROOT, 'scripts', 'office-allow.mjs'), 'utf8');
    expect(allow, '★事務所に管理画面が並ぶ★').not.toContain('daikome-admin.html');
  });
});
