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

// ★事務所の 画面（帯が 出る 所）★
const GAMEN = ['shukei.html', 'uriage.html', 'kyuryo.html', 'ryokinhyou.html', 'dashboard.html'];
const FOOT = read(path.join('js', 'jimusho-footer.js'));

describe('★事務所の 行き先は 下の 帯 ただ1つ★', () => {
  // ★★なぜ 変えたか（2026-09-05）★★
  //   前の 決まり（2026-08-01）＝★入口は 管理画面の 1つ★
  //     ⇒ 売上表／給料／月次集計を ★管理画面の 中の 窓（iframe）に はめ込む★ 形だった。
  //   2026-09-04 に 司さんの 指示で ★下の 帯（各ページへ 飛ぶ）★ を 足した。
  //     ⇒ ★上の タブ★ と ★下の 帯★ が ★同じ 仕事を 2回★ するように なった。
  //     ⇒ 会社設定の 画面で 月次集計を 開くと
  //        ★上は「月次集計」・下は「会社設定」が 光る★＝★食い違う★
  //     ⇒ 司さん 2026-09-05「★まず 設定タブが おかしい★」
  //   ★今の 決まり★
  //     ①行き先は ★下の 帯 ただ1つ★（js/jimusho-footer.js）
  //     ②上に 残すのは ★請求書 だけ★（別のアプリ・別ログインなので 帯に 入れられない）
  //     ③★はめ込む 窓（iframe）は 使わない★＝死にコードを 残さない
  //   ★押す 回数は 増えていません★（前も 今も 1押しで 行けます）
  //
  //   ★★わざと壊して 赤に なる事を 見た（2026-09-05 実測）★★
  //     ①dashboard に data-otab="uriage" を 戻す … ★赤★
  //     ②iframe（id="oframe"）を 戻す ………………… ★赤★
  //     ③帯の 名簿から 1枚 抜く …………………………… ★赤★

  it('★① 帯が 5枚 全部を 持っている（0本でも 緑、に しない）★', () => {
    expect(GAMEN.length, '★名簿が 空です＝何も 見ていません★').toBe(5);
    GAMEN.forEach((g) => {
      expect(fs.existsSync(path.join(ROOT, g)), '★' + g + ' が ありません★').toBe(true);
      expect(FOOT, '★帯の 名簿に ' + g + ' が ありません★').toContain(g);
      expect(read(g), '★' + g + ' が 帯を 読み込んでいません★').toContain('jimusho-footer.js');
    });
  });

  it('★★② 上に タブを 2つ 置かない（下の 帯と 食い違う）★★', () => {
    ['uriage', 'kyuryo', 'shukei', 'ryokin', 'dash'].forEach((t) => {
      expect(
        DASH,
        '★上に「' + t + '」の タブが 戻っています＝下の 帯と 光る 場所が 食い違います★'
      ).not.toContain('data-otab="' + t + '"');
    });
    // ★請求書 だけは 残す★（別のアプリ・別ログイン）
    expect(DASH, '★請求書へ 行けなくなっています★').toContain('data-otab="seikyu"');
  });

  it('★★③ はめ込む 窓（iframe）を 使わない／死にコードを 残さない★★', () => {
    expect(DASH, '★iframe が 戻っています★').not.toContain('id="oframe"');
    expect(DASH, '★iframe が 戻っています★').not.toContain('class="oframe"');
    ['function fitFrame', 'function markTab', 'dk_office_tab', 'frame-mode'].forEach((x) => {
      expect(
        DASH,
        '★使わなくなった 仕掛け「' + x + '」が 残っています★＝誰かが「使っている」と 読みます'
      ).not.toContain(x);
    });
  });

  it('★請求書は 別アプリ・別ログインなので 新しいタブで 開く★', () => {
    // ★行き先を 画面に 直書きしない★（2026-08-09・本番もテストも 本番の請求書へ 飛んでいた）
    expect(DASH).toContain('DKConfig.SEIKYU_BASE');
    expect(DASH).toContain("'/daikou-seikyu.html'");
    expect(DASH).toMatch(/window\.open\(SEIKYU_URL/);
  });

  it('★会社が 登録できるまで 請求書の ボタンを 出さない★', () => {
    expect(DASH).toContain("show('otabs', true)");
    expect(DASH).toContain("show('otabs', false)");
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

    // ★★2026-09-04（司さん）下の 帯に した★★
    //   「フッター 作って 各ページに 飛ぶようにしろ」
    //   ★前は 画面ごとに 手書きの リンク列★（中身が バラバラだった）
    //   ⇒ ★行き先は js/jimusho-footer.js の 1か所★
    it(p + ' は単体でも開ける（下の 帯から どこへでも 行ける）', () => {
      expect(src, '★上の 帯が ありません★').toContain('class="top');
      expect(src, '★下の 帯を 読んでいません★').toContain('js/jimusho-footer.js');
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
