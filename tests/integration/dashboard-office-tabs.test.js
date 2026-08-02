'use strict';
// ============================================================
// 管理画面に事務所の画面をまとめた配線テスト 2026-08-01
//
//   司さんの疑問「なんで全部にURLがあるん？」への答え＝★入口は管理画面の1つ★。
//   売上表 / 給料 / 月次集計 は管理画面のタブの中に出す。
//   （中身は今まで通り1枚ずつの画面なので、単体URLでも開ける＝壊れたら1枚だけ切り離せる）
//
//   固定すること:
//     1. タブが4つ＋請求書（別アプリ）
//     2. タブの行き先が実在するファイル
//     3. 請求書だけは★別のログイン★なので新しいタブで開く（中に埋め込まない）
//     4. 会社が登録できるまでタブを出さない
//     5. 中に入った画面は自分の上のリンク列を隠す（1つのアプリに見える）
//     6. 単体URLで開いた時は今まで通り出る（隠しっぱなしにしない）
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DASH = read('dashboard.html');

describe('★入口は管理画面ひとつ★', () => {
  it('タブが5つある（会社の設定 / 売上表 / 給料 / 月次集計 / 請求書）', () => {
    ['dash', 'uriage', 'kyuryo', 'shukei', 'seikyu'].forEach((t) => {
      expect(DASH).toContain('data-otab="' + t + '"');
    });
  });

  it('タブの行き先のファイルが実在する', () => {
    ['uriage.html', 'kyuryo.html', 'shukei.html'].forEach((f) => {
      expect(DASH).toContain("'" + f + "'");
      expect(fs.existsSync(path.join(ROOT, f))).toBe(true);
    });
  });

  it('中に出す入れ物（iframe）がある', () => {
    expect(DASH).toContain('id="oframe"');
    expect(DASH).toContain('class="oframe"');
  });

  it('★請求書は別アプリ・別ログインなので新しいタブで開く（中に埋め込まない）★', () => {
    expect(DASH).toContain('https://exally-test.vercel.app/daikou-seikyu.html');
    expect(DASH).toMatch(/window\.open\(SEIKYU_URL/);
    // iframe の行き先に請求書を入れていないこと
    expect(DASH).not.toMatch(/TABS\s*=\s*\{[^}]*seikyu/);
  });

  it('★会社が登録できるまでタブを出さない★', () => {
    expect(DASH).toContain("show('otabs', true)");
    expect(DASH).toContain("show('otabs', false)");
  });

  it('同じタブを押し直しても読み込み直さない（入力中の値を消さない）', () => {
    expect(DASH).toContain("getAttribute('data-src') !== want");
  });

  it('開いていたタブを覚える', () => {
    expect(DASH).toContain('dk_office_tab');
    expect(DASH).toContain('localStorage');
  });

  it('画面の高さいっぱいに広げる（下が切れない）', () => {
    expect(DASH).toContain('function fitFrame');
    expect(DASH).toContain("window.addEventListener('resize', fitFrame)");
  });
});

describe('★中に入った画面は1つのアプリに見える★', () => {
  const pages = ['uriage.html', 'kyuryo.html', 'shukei.html'];

  pages.forEach((p) => {
    const src = read(p);

    it(p + ' は中に入っているかを見て embedded を付ける', () => {
      expect(src).toContain('window.self !== window.top');
      expect(src).toContain("classList.add('embedded')");
    });

    it(p + ' は embedded の時だけ上のリンク列を隠す', () => {
      expect(src).toMatch(/body\.embedded \.top/);
      // ★隠しっぱなしにしない（単体URLでは出る）★
      expect(src).not.toMatch(/\n\s*\.top\s*\{[^}]*display:\s*none/);
    });

    it(p + ' は読めない時（別ドメインに埋められた時）も落ちない', () => {
      // try/catch で囲ってあること
      const i = src.indexOf('window.self !== window.top');
      const around = src.slice(Math.max(0, i - 120), i + 260);
      expect(around).toContain('try {');
      expect(around).toContain('catch');
    });

    it(p + ' は単体でも開ける（今まで通りのリンク列を持っている）', () => {
      expect(src).toContain('class="top');
      expect(src).toContain('dashboard.html');
    });
  });
});

describe('★メーターから事務所へ戻れる（司さん「どのURLもここにしかいかん」対策）★', () => {
  const IDX = read('index.html');

  it('設定のなかに事務所へ行く行がある', () => {
    expect(IDX).toContain('data-office-link="1"');
    expect(IDX).toContain('事務所をひらく');
  });

  // ★2026-08-02 期待値を変えた★
  //   旧: location.href = 'dashboard.html'（メーターの中の住所）
  //   新: OFFICE_BASE（事務所ホストへ直行）
  //   理由: メーター側の /dashboard.html はサービスワーカーが預かってしまい、
  //         旧SWが残っている端末では 308 も新しい画面も届かない。
  //         最初から別ホストへ飛ばせば SW を一度も踏まない。
  it('★行き先が事務所ホスト(OFFICE_BASE)である★（メーター内の住所ではない）', () => {
    const i = IDX.indexOf('data-office-link="1"');
    const around = IDX.slice(i, i + 400);
    expect(around).toContain('OFFICE_BASE');
    expect(around).toMatch(/location\.href\s*=/);
  });

  it('社長用だと分かるように書いてある（ドライバーが迷わない）', () => {
    const i = IDX.indexOf('data-office-link="1"');
    expect(IDX.slice(i, i + 400)).toContain('社長用');
  });

  it('★会社URL(?c=) はメーターを開く物のまま（勝手に事務所へ飛ばさない）★', () => {
    // 会社URLはドライバーのスマホを使えるようにする物。ここを変えると有効化が壊れる。
    expect(IDX).not.toMatch(/\?c=[^'"]*['"]\s*\)?\s*;?\s*location\.replace/);
    const DASH2 = read('dashboard.html');
    expect(DASH2).toContain("'/?c=' +");
    expect(DASH2).toContain('COMPANY.url_token');
  });
});

describe('★事務所を別の住所で開いても、ドライバーに配る会社URLは壊れない★', () => {
  // 司さん「管理画面用のURLつくれや」→ 事務所は daikome-jimusho.vercel.app からも開ける。
  // その時 location.origin を使うと、ドライバーが「メーターの無い住所」へ飛ばされて有効化できない。
  it('会社URLは DKConfig.APP_BASE から組み立てる（location.origin ではない）', () => {
    const i = DASH.indexOf('会社URL(ドライバーに配る物)');
    expect(i).toBeGreaterThan(-1);
    const around = DASH.slice(i, i + 400);
    expect(around).toContain('APP_BASE');
    expect(around).not.toMatch(/^\s*currentUrl = location\.origin/m);
  });

  it('APP_BASE はメーターの住所を指している', () => {
    // ★どのメーターかは repo ごとに違う★ → tests/unit/dk-config-app-base-host.test.js が
    //   git の remote から素性を取って判定する。ここは「メーターの住所であること」だけ見る。
    const cfg = read('js/dk-config.js');
    expect(cfg).toMatch(/APP_BASE\s*=\s*'https:\/\/daikou-app(-test)?\.vercel\.app'/);
  });

  // ★2026-08-02 作り直し★
  //   旧: scripts/office-bundle.mjs（事務所へ「ファイルを写す」方式の一覧）を見ていた。
  //   その方式はやめた。事務所は★画面を1枚も持たず★メーターを proxy するだけになったので、
  //   写すファイルの一覧そのものが無くなった（＝office-bundle.mjs は削除）。
  //   正は office-host/vercel.json の1つだけ。二重に持つと必ず片方が古くなる。
  it('★事務所は画面を持たない（proxyだけ）★', () => {
    const oh = JSON.parse(read('office-host/vercel.json'));
    expect(Array.isArray(oh.rewrites)).toBe(true);
    // 事務所に置くファイルの一覧のような物を持っていないこと
    expect(oh.builds).toBeUndefined();
    expect(
      fs.existsSync(path.join(ROOT, 'scripts', 'office-bundle.mjs')),
      '古い正が残っている'
    ).toBe(false);
  });

  // ★2026-08-02 設計を逆にした（名指しで塞ぐ → 通す物だけ通す）★
  //   総当たりを置かないので、一覧に無い物は自動で404になる。栓の行は要らない。
  it('★事務所にメーター専用の物が入っていない（総当たりも無い）★', () => {
    const rw = JSON.parse(read('office-host/vercel.json')).rewrites;
    const src = rw.map((x) => x.source);
    expect(
      src.filter((s) => /[:*]/.test(s)),
      '総当たりが有ると元の穴が戻る'
    ).toEqual([]);
    ['/sw.js', '/index.html', '/manifest.json', '/fare.html'].forEach((p) => {
      expect(src, `${p} が事務所の住所で出る`).not.toContain(p);
    });
  });

  it('事務所が見せる4画面が repo に実在する', () => {
    ['dashboard.html', 'kyuryo.html', 'uriage.html', 'shukei.html', 'login.html'].forEach((f) => {
      expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true);
    });
  });
});

describe('★ログインは1つの実装だけ（毎回ログインの再発防止）★', () => {
  // 司さん「毎回ログインはどうにかならんのかね？／管理画面ログインしとったら他はなしでいけるんやないん？」
  it('管理画面は js/dk-session.js を使う（独自のログイン処理を持たない）', () => {
    expect(DASH).toContain('src="js/dk-session.js"');
    expect(DASH).toContain('DKSession.ensure()');
    // 自前の更新処理を持っていないこと
    expect(DASH).not.toContain('function refreshSess');
    expect(DASH).not.toContain('grant_type=refresh_token');
  });

  it('★通信が落ちただけでログアウトさせない★', () => {
    // 「配列が返らなければ goLogin」という書き方が戻ったら落ちる
    expect(DASH).not.toContain('if (!Array.isArray(cos)) return goLogin();');
    expect(DASH).toContain('DKSession.isAuthError');
  });

  it('4画面とも同じ保存場所を使う＝1回ログインすれば全部で使える', () => {
    const sess = read('js/dk-session.js');
    expect(sess).toContain("const KEY = 'dk_dash_sess'");
    ['uriage.html', 'kyuryo.html', 'shukei.html'].forEach((f) => {
      expect(read(f)).toContain('DKSession.ensure()');
    });
  });

  it('更新の取り合いを止める仕組みが入っている', () => {
    const sess = read('js/dk-session.js');
    expect(sess).toContain('_inflight');
    expect(sess).toContain('dk_dash_refresh');
  });
});

describe('★iPhoneがログインを7日で消すのを避ける（ホーム画面アプリ）★', () => {
  // 出典: WebKit公式 "Full Third-Party Cookie Blocking and More"
  //   Safari は7日そのサイトを触らないと script-writable storage を消す。
  //   ★ホーム画面に追加したWebアプリは独自のカウンタを持ち、対象外★
  it('ホーム画面アプリにするための札が入っている', () => {
    expect(DASH).toContain('rel="manifest"');
    expect(DASH).toContain('office-manifest.json');
    expect(DASH).toContain('apple-mobile-web-app-capable');
    expect(DASH).toContain('apple-touch-icon');
  });

  it('事務所用のマニフェストがあり、開くと事務所になる', () => {
    const m = JSON.parse(read('office-manifest.json'));
    expect(m.start_url).toBe('/dashboard.html');
    expect(m.display).toBe('standalone');
    expect(m.icons.length).toBeGreaterThan(0);
    m.icons.forEach((i) => {
      expect(fs.existsSync(path.join(ROOT, i.src.replace(/^\//, '')))).toBe(true);
    });
  });

  it('★事務所のマニフェストはサービスワーカーを呼ばない★（あの事故を戻さない）', () => {
    const raw = read('office-manifest.json');
    expect(raw).not.toContain('sw.js');
    expect(raw).not.toContain('serviceworker');
  });

  it('すすめの案内は iPhone の Safari で、まだアプリになっていない時だけ', () => {
    expect(DASH).toContain('function maybeShowA2HS');
    expect(DASH).toContain('/iPhone|iPad|iPod/');
    expect(DASH).toContain('navigator.standalone');
    expect(DASH).toContain("matchMedia('(display-mode: standalone)')");
  });

  it('一度閉じたら出し続けない（しつこくしない）', () => {
    expect(DASH).toContain('dk_a2hs_closed');
  });

  it('ログインのメールを覚える（入り直しを1タップに）', () => {
    const login = read('login.html');
    expect(login).toContain('dk_last_email');
  });
});
