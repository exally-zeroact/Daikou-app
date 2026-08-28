'use strict';
// ============================================================
// ★認定ゲート(cert-gate)の修理が、そのrepoに入っていること 2026-08-03★
//
//   ★何が起きていたか（測って確定）★
//     2026-08-02 に cert-gate を作り直した（sparse-checkout → 11本に分割 → cancelled検知）。
//     ところが★その修理を本番repo(Daikou-app)へ同期していなかった★。
//     結果:
//       Daikou-app-test  直近8回 = 全部 success
//       Daikou-app       直近6回 = ★全部 cancelled★（最後の成功は 2026-06-12）
//     本番側は修理前のまま、きっかり20分で打ち切られ続けていた。
//     ＝★距離＝課金を守るゲートが、本番側では一度も完走していない★。
//
//   ★なぜ「片側だけ直る」が起きるか★
//     ダイコメは repo が2つ（テスト用・本番用）で、直しは片方に入れて同期する。
//     同期の対象から漏れたファイルは★静かに古いまま残る★。
//     しかも cancelled は緑でも赤でもないので、GitHubの画面を見ても気づけない。
//
//   ★このテストの立て方★
//     「相手のrepoと差分を取る」ではなく、
//     ★どちらのrepoでも「修理が入っていること」を自分で確かめる★形にする。
//     こうすれば、同期し忘れた側が★自分のCIで赤になる★（相手を見に行かなくていい）。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WF = path.join(ROOT, '.github', 'workflows');
const CERT = path.join(WF, 'cert-gate.yml');

const src = () => fs.readFileSync(CERT, 'utf8');

describe('★認定ゲートの修理が入っていること★', () => {
  it('cert-gate.yml が在る', () => {
    expect(fs.existsSync(CERT), '.github/workflows/cert-gate.yml が無い').toBe(true);
  });

  it('★sparse-checkout が入っている（これが無いと checkout だけで4分かかる）★', () => {
    const t = src();
    expect(t, 'sparse-checkout が無い＝修理前のまま').toContain('sparse-checkout');
    // 何を取るかまで見る（増やす時は実測してから）
    expect(t).toMatch(/sparse-checkout:\s*\|/);
    expect(t).toContain('data/roads-ehime.js');
    expect(t).toContain('sparse-checkout-cone-mode: false');
  });

  it('★ゲートごとにジョブを分けている（1本にまとめると20分で打ち切られる）★', () => {
    const t = src();
    expect(t).toContain('matrix:');
    expect(t).toMatch(/fail-fast:\s*false/);
  });

  it('★11本のゲートが全部並んでいる★', () => {
    const t = src();
    const NEEDED = [
      'test:gate-snap',
      'test:sim-cert',
      'test:gate-kp',
      'test:obd-engine',
      'test:quant',
      'test:gate-doppler',
      'test:gate-cert3env',
      'test:gate-spread',
      'test:gate-tunnel',
      'test:gate-bg-freeze',
      'test:gate-gnss-degraded',
    ];
    const missing = NEEDED.filter((n) => !t.includes(n));
    expect(missing, '走らないゲートがある＝守れていない').toEqual([]);
  });

  it('★そのゲートの npm script が実在する（名前だけ書いて動かない、を防ぐ）★', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const t = src();
    const used = Array.from(t.matchAll(/npm run (test:[\w-]+)/g)).map((m) => m[1]);
    expect(used.length, 'ゲートが1本も書かれていない').toBeGreaterThan(10);
    const missing = used.filter((s) => !pkg.scripts[s]);
    expect(missing, 'package.json に無いゲートを呼んでいる').toEqual([]);
  });

  it('★ジョブごとに timeout がある（1本が詰まって全体を巻き込まない）★', () => {
    expect(src()).toMatch(/timeout-minutes:\s*\$\{\{\s*matrix\.timeout\s*\}\}/);
  });

  // ★ここが再発防止の本体★
  //   20回すり抜けた本当の理由は「遅い」ことではなく、
  //   cancelled が緑でも赤でもなく「緑を確認してから進む」の網に引っかからなかったこと。
  it('★cancelled / timed_out を赤にする総合結果ジョブがある★', () => {
    const t = src();
    expect(t, '総合結果ジョブが無い＝打ち切られても気づけない').toContain('cert-gate-result');
    expect(t).toMatch(/needs:\s*gate/);
    expect(t).toMatch(/if:\s*always\(\)/);
    // success 以外を赤にしていること
    expect(t).toMatch(/needs\.gate\.result/);
    expect(t).toContain('exit 1');
  });

  it('★soft(非ブロック)にしているゲートには理由が書いてある★', () => {
    const t = src();
    const lines = t.split('\n');
    const softLines = lines.filter((l) => /soft:\s*true/.test(l));
    softLines.forEach((l) => {
      expect(l.includes('#'), 'soft にした理由が書かれていない: ' + l.trim()).toBe(true);
    });
  });
});

describe('★同期でテスト側の値を持ち込んでいないこと★', () => {
  // APP_BASE の事故と同じ形を、CIの設定でもやらないための目。
  it('cert-gate.yml に ホスト名・repo名 が入っていない', () => {
    const t = src();
    [/daikou-app/i, /daikome/i, /vercel/i, /jimusho/i].forEach((re) => {
      expect(re.test(t), 'repoごとに違う値が書かれている: ' + re).toBe(false);
    });
  });

  it('他のワークフローにも テスト側のホストが混ざっていない', () => {
    // ★2026-08-28: 前は「無ければ return」＝★何も見ずに緑★でした。
    //   .github/workflows は ★必ず在る★（CIは full checkout・test.yml:17 実測）。
    //   無いなら ★消えた／場所が変わった★ので 赤にします。
    expect(fs.existsSync(WF), '★.github/workflows が 在りません★').toBe(true);
    const offenders = [];
    for (const f of fs.readdirSync(WF).filter((x) => /\.ya?ml$/.test(x))) {
      const t = fs.readFileSync(path.join(WF, f), 'utf8');
      // 「-test」側の住所が本番repoのCIに紛れ込んでいたら事故
      if (/daikou-app-test\.vercel\.app|daikome-jimusho-test\.vercel\.app/.test(t)) {
        offenders.push(f);
      }
    }
    // テストrepo自身は自分の住所を書いてよい
    const isTestRepo = fs.existsSync(path.join(ROOT, 'js', 'dk-config.js'))
      ? /daikou-app-test/.test(fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8'))
      : false;
    if (!isTestRepo) expect(offenders, '本番のCIにテスト側の住所が混ざっている').toEqual([]);
  });
});
