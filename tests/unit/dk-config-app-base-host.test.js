'use strict';
// ============================================================
// ★APP_BASE が「そのrepoの本当のホスト」を指しているかを機械で縛る 2026-08-02★
//
//   ★何が起きるところだったか★
//     本番repo(Daikou-app)には js/dk-config.js がまだ無い。
//     テストrepoから一式同期すると `APP_BASE = 'https://daikou-app-test.vercel.app'` が
//     そのまま入る。すると:
//       ★本番の事務所が出したQRを従業員が読んだ瞬間、全員テスト版のメーターで走り始める★
//     しかも起きる確率は100%。会社URL(?c=)は APP_BASE から組み立てているため。
//
//   ★なぜ「repoの素性」を git から取るのか★
//     package.json や repo内のファイルに書くと、★同期の時に一緒にコピーされて同じ間違いが通る★。
//     git の remote（＝CIでは GITHUB_REPOSITORY）は**同期でコピーされない場所**なので、
//     ファイルを丸ごと写しても誤魔化せない。ここが要。
//
//   ★このテストは恒久★ 同期のたびに効く。消さないこと。
// ============================================================
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

// repo名 → そのrepoが配信されている本当のホスト
const EXPECTED_APP_BASE = {
  'Daikou-app-test': 'https://daikou-app-test.vercel.app', // テスト版
  'Daikou-app': 'https://daikou-app.vercel.app', // ★本番★
};

// repo名 → その側の事務所ホスト（2026-08-02 追加）
//   ★ここが混ざると、本番の事務所がテストのメーターを見る＝QRが反対側を指す★
const EXPECTED_OFFICE_BASE = {
  'Daikou-app-test': 'https://daikome-jimusho-test.vercel.app',
  'Daikou-app': 'https://daikome-jimusho.vercel.app',
};

// ★同期でコピーされない所から素性を取る★
function repoName() {
  if (process.env.GITHUB_REPOSITORY) {
    return String(process.env.GITHUB_REPOSITORY).split('/').pop();
  }
  const url = execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim();
  return url
    .replace(/\.git$/, '')
    .split(/[/:]/)
    .pop();
}

function appBaseInConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
  const m = src.match(/const\s+APP_BASE\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

function officeBaseInConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
  const m = src.match(/const\s+OFFICE_BASE\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

function readJson(...p) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
}

describe('★APP_BASE は そのrepoのホストと一致していなければならない★', () => {
  it('repoの素性を取れる（取れなければ判定できないので落とす）', () => {
    const n = repoName();
    expect(typeof n).toBe('string');
    expect(n.length).toBeGreaterThan(0);
  });

  it('js/dk-config.js に APP_BASE が1つある', () => {
    expect(appBaseInConfig()).toMatch(/^https:\/\//);
  });

  it('★このrepoの APP_BASE が正しいホストを指している★', () => {
    const name = repoName();
    const want = EXPECTED_APP_BASE[name];
    if (!want) {
      throw new Error(
        '知らないrepoです: ' +
          name +
          '\n  → EXPECTED_APP_BASE に足してください。' +
          '★分からないまま通すと、QRが別のメーターを指したまま出荷される★'
      );
    }
    const got = appBaseInConfig();
    expect(got).toBe(want);
  });

  it('★テスト版のURLが本番repoに紛れ込んでいない★', () => {
    const name = repoName();
    if (name !== 'Daikou-app') return; // 本番repoでだけ効く
    const got = appBaseInConfig();
    expect(got).not.toContain('daikou-app-test');
  });

  it('★本番のURLがテストrepoに紛れ込んでいない★（逆向きの取り違えも止める）', () => {
    const name = repoName();
    if (name !== 'Daikou-app-test') return;
    expect(appBaseInConfig()).toBe('https://daikou-app-test.vercel.app');
  });
});

// ============================================================
// ★ここから ホスト単位のガード (2026-08-02 追加)★
//
//   それまで縛れていたのは js/dk-config.js の APP_BASE 1つだけだった。
//   ところが「どのメーターを見せるか」は他に2箇所ある:
//     ・vercel.json の 308 の行き先（メーター → 事務所）
//     ・office-host/vercel.json の proxy 先（事務所 → メーター）
//   どれか1つでも反対側を指すと、★QRが反対側のメーターを指したまま出荷される★。
//   3つとも同じ「側」であることを、repoの素性(git remote)から機械で縛る。
// ============================================================
describe('★事務所ホストも repo の側と一致していなければならない★', () => {
  it('OFFICE_BASE が dk-config.js にある', () => {
    expect(officeBaseInConfig()).toMatch(/^https:\/\//);
  });

  it('★このrepoの OFFICE_BASE が正しい事務所を指している★', () => {
    const name = repoName();
    const want = EXPECTED_OFFICE_BASE[name];
    if (!want) throw new Error('知らないrepoです: ' + name + ' → EXPECTED_OFFICE_BASE に足すこと');
    expect(officeBaseInConfig()).toBe(want);
  });

  it('★APP_BASE と OFFICE_BASE が同じ側である★（テストと本番が混ざっていない）', () => {
    const appIsTest = /daikou-app-test/.test(appBaseInConfig());
    const officeIsTest = /jimusho-test/.test(officeBaseInConfig());
    expect(officeIsTest, 'メーターと事務所で側が違う').toBe(appIsTest);
  });
});

describe('★vercel.json の行き先も同じ側であること★', () => {
  it('メーターの4画面が事務所へ 308 で送られている', () => {
    const v = readJson('vercel.json');
    const paths = (v.redirects || []).map((r) => r.source);
    ['/dashboard.html', '/kyuryo.html', '/uriage.html', '/shukei.html'].forEach((p) => {
      expect(paths, p + ' の308が無い').toContain(p);
    });
    (v.redirects || []).forEach((r) => {
      expect(r.permanent, r.source + ' が308でない').toBe(true);
    });
  });

  it('★308の行き先が このrepoの事務所である★', () => {
    const want = EXPECTED_OFFICE_BASE[repoName()];
    readJson('vercel.json').redirects.forEach((r) => {
      expect(r.destination.startsWith(want), `${r.source} → ${r.destination}`).toBe(true);
    });
  });

  // 事務所の rewrite は2種類ある:
  //   ・メーターへ見に行く物 (destination が https://…)
  //   ・★出してはいけない物を404にする栓★ (destination が / で始まる＝事務所内の実在しない所)
  function officeRewrites() {
    return readJson('office-host', 'vercel.json').rewrites;
  }
  const toMeter = (r) => /^https:/.test(r.destination);

  it('★事務所→メーターの proxy 先が このrepoのメーターである★', () => {
    const want = EXPECTED_APP_BASE[repoName()];
    const seen = officeRewrites().filter(toMeter);
    expect(seen.length, 'メーターを見に行く行が1つも無い').toBeGreaterThan(0);
    seen.forEach((r) => {
      expect(r.destination.startsWith(want), `${r.source} → ${r.destination}`).toBe(true);
    });
  });

  it('★無限ループにならない: 事務所は308される道を通らない★', () => {
    // 事務所が /dashboard.html を素直に取りに行くと 308 で自分へ返され、永久に回る。
    const redirected = readJson('vercel.json').redirects.map((r) => r.source);
    officeRewrites()
      .filter(toMeter)
      .forEach((r) => {
        const p = new URL(r.destination).pathname;
        expect(
          redirected.includes(p),
          `事務所が ${p} を取りに行っている＝308で送り返されて無限ループ`
        ).toBe(false);
      });
  });

  // ★2026-08-02 設計を逆にした★
  //   旧: 総当たり /:path* で丸ごと通し、/sw.js と /index.html だけ★名指しで塞ぐ★
  //       → 実測すると fare/settings/history/help/★manifest.json★/js/meter.js …が
  //         全部200で出ていた。★画面が増えるたびに塞ぎ忘れる★形。
  //   新: ★通す物だけ通す★（総当たりを置かない＝一覧に無い物は全部404）
  //   ここでは「総当たりが戻っていないこと」を見る。
  //   一覧そのものの正しさは tests/unit/office-allow-list.test.js。
  it('★総当たりを置かない（置いた瞬間に元の穴が戻る）★', () => {
    const bad = officeRewrites().filter((r) => /[:*]/.test(r.source));
    expect(bad, '総当たりが有ると、メーターの画面もmanifestも事務所の住所で出る').toEqual([]);
  });

  it('メーター側に /office/ の入口がある（事務所はここを取りに来る）', () => {
    const rw = readJson('vercel.json').rewrites || [];
    expect(rw.some((r) => r.source.startsWith('/office/'))).toBe(true);
  });

  // ★2026-08-02 実際に踏んだ★
  //   説明のつもりで vercel.json に "_comment" を足したら、Vercel が
  //     「should NOT have additional property `_comment`」でデプロイを丸ごと失敗させた。
  //   本番配信は直前の正常版のままだったので実害は無かったが、
  //   ★変更が乗っていないのに「push したから直った」と思い込む★一歩手前だった。
  //   説明は office-host/README.md に書く。ここは知らないキーが混ざっていないかを見る。
  // ★2度目なので設定ファイル全般に広げた (2026-08-03)★
  //   1度目 vercel.json  … デプロイが丸ごと失敗（配信は前の版のまま＝画面では気づけない）
  //   2度目 .eslintrc.json … 「ESLint configuration is invalid」で lint が丸ごと動かなくなった
  //   どちらも「説明を書きたい」から足した _comment。設定JSONにコメントは書けない。
  //   説明は README か、その設定を作る道具のコメントに書くこと。
  it('★設定JSONに _comment を書かない（設定ごと拒否されて丸ごと動かなくなる）★', () => {
    const CONFIGS = [
      'vercel.json',
      'office-host/vercel.json',
      '.eslintrc.json',
      '.stylelintrc.json',
    ];
    const offenders = [];
    const walk = (o, where) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach((x, i) => walk(x, `${where}[${i}]`));
      Object.keys(o).forEach((k) => {
        if (/^_/.test(k)) offenders.push(`${where}.${k}`);
        walk(o[k], `${where}.${k}`);
      });
    };
    // ★2026-08-28: 前は「無ければ return」＝★何も見ずに緑★でした（4本 全部 消えても 緑）。
    const nai = CONFIGS.filter((rel) => !fs.existsSync(path.join(ROOT, ...rel.split('/'))));
    expect(nai, '★設定ファイルが 在りません（CONFIGS を 直してください）★').toEqual([]);
    CONFIGS.forEach((rel) => {
      const p = path.join(ROOT, ...rel.split('/'));
      walk(JSON.parse(fs.readFileSync(p, 'utf8')), rel);
    });
    expect(offenders, '設定ごと拒否される（vercel.json / .eslintrc.json で実際に踏んだ）').toEqual(
      []
    );
  });

  it('★vercel.json に Vercel が知らないキーを足さない（デプロイが丸ごと失敗する）★', () => {
    const ALLOWED = new Set([
      'rewrites',
      'redirects',
      'headers',
      'cleanUrls',
      'trailingSlash',
      'functions',
      'crons',
      'regions',
      'framework',
      'buildCommand',
      'outputDirectory',
      'installCommand',
      'devCommand',
      'ignoreCommand',
      'public',
      'images',
      'git',
    ]);
    ['vercel.json', 'office-host/vercel.json'].forEach((rel) => {
      const obj = JSON.parse(fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8'));
      Object.keys(obj).forEach((k) => {
        expect(ALLOWED.has(k), `${rel} の "${k}" は Vercel が知らないキー`).toBe(true);
      });
    });
  });

  // ★期待を2回直した (2026-08-02)★
  //   1回目 旧: 「/sw.js の行が1つも無いこと」 → 総当たりが有ったので、行が無いと逆に素通りした
  //   2回目 新: ★総当たりをやめて「通す物だけ通す」にした★ので、
  //             sw.js は「一覧に入っていない」＝それだけで404になる。栓の行は要らない。
  it('★事務所にメーター専用の物が1つも入っていない★', () => {
    const src = readJson('office-host', 'vercel.json').rewrites.map((r) => r.source);
    [
      '/sw.js',
      '/index.html',
      '/manifest.json',
      '/fare.html',
      '/settings.html',
      '/history.html',
    ].forEach((p) => {
      expect(src, `${p} が一覧に入っている＝事務所の住所で出る`).not.toContain(p);
    });
  });
});

describe('★事務所の画面をメーターのSWが預からないこと★', () => {
  it('sw.js に OFFICE_PATHS があり、4画面を含む', () => {
    const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const m = src.match(/const\s+OFFICE_PATHS\s*=\s*(\/.+\/)\s*;/);
    expect(m, 'OFFICE_PATHS が無い').toBeTruthy();
    // eslint-disable-next-line no-eval
    const re = eval(m[1]);
    ['/dashboard.html', '/kyuryo.html', '/uriage.html', '/shukei.html'].forEach((p) => {
      expect(re.test(p), p + ' が OFFICE_PATHS に入っていない').toBe(true);
    });
    // メーター本体は絶対に含めない（含めたら圏外で業務が止まる）
    ['/', '/index.html', '/sw.js'].forEach((p) => {
      expect(re.test(p), '★' + p + ' を含めてはいけない（圏外運用が壊れる）★').toBe(false);
    });
  });

  it('fetch ハンドラが OFFICE_PATHS を network-only にしている', () => {
    const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const i = src.indexOf('OFFICE_PATHS.test');
    expect(i).toBeGreaterThan(-1);
    // navigationHandler(cache-first) より前で捕まえていないと意味がない
    expect(i).toBeLessThan(src.indexOf("req.mode === 'navigate'"));
  });

  it('メーター内の事務所リンクが OFFICE_BASE 直行になっている', () => {
    const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const i = src.indexOf('data-office-link="1"');
    expect(i).toBeGreaterThan(-1);
    const around = src.slice(i, i + 400);
    expect(around).toContain('OFFICE_BASE');
  });
});

describe('会社URL(ドライバーに配る物)の組み立て方', () => {
  it('★dashboard は location.origin ではなく APP_BASE から組む★', () => {
    const dash = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
    const i = dash.indexOf("'/?c=' +");
    expect(i).toBeGreaterThan(-1);
    const around = dash.slice(Math.max(0, i - 400), i + 100);
    expect(around).toContain('APP_BASE');
    // location.origin だけで組んでいたら、別の住所で開いた時に壊れたURLを配ってしまう
    expect(around).not.toMatch(/currentUrl\s*=\s*location\.origin\s*\+\s*'\/\?c='/);
  });

  it('APP_BASE の行に「本番ドメイン確定時はここを差し替える」の注意が残っている', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
    expect(src).toContain('APP_BASE');
    expect(src).toMatch(/会社URL|url_token/);
  });
});
