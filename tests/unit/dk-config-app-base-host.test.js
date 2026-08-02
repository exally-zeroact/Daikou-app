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
