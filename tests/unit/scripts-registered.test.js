// tests/unit/scripts-registered.test.js
//
// ★「在るのに 0回 回っていない試験」を もう作らせない★ 2026-08-27（指示役の裁定①）
//
//   ★同じ穴を 3度 踏みました★
//     ① scripts/check-hosts.mjs … 2026-08-02 に作って ★0回★（2026-08-21 に毎朝へ登録）
//     ② tests/gate-realdevice-creep.js … 2026-06-12 以来 ★0回★（2026-08-27 に登録・今 赤だった）
//     ③ tests/truedist-obd-engine-gate.js --k-neverover … 同上 ★0回★（★距離・課金の見張り★）
//   ⇒ ★4度めを 作らせない為に、ここで 機械に数えさせる★。
//
//   ★2026-08-28 追記：穴が もう1つ ありました★
//     ここは ★package.json の script★ しか見ていませんでした。
//     ⇒ ★script すら無い tests/直下の .js が 15本★ 在りました（★その中に
//        タイヤ真値の見張り gate-road-distance も 入っていました★）。
//     ⇒ 下の「②tests/直下の .js」で そこも 数えます。
//
//   決まり:
//     package.json の ★test:* / check:*★ は、次のどちらかでなければ 赤。
//       (A) ★どれかの workflow が 実際に呼んでいる★
//       (B) ★下の「手元の道具」に 名前と理由が書いてある★
//     ＝★新しく足した試験は 登録するか、理由を書くか、どちらかを必ずやる★
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// ★CIに入れない物＝1本ずつ 理由を書く★（理由が書けない物は 登録するか 消す）
const TEMOTO_NO_DOUGU = {
  // ─ 人が手で使う物（CIでは動かない／動かす意味がない）─
  'test:watch': '★人が見ながら回す物★（vitest の見張りモード＝終わらない。CIでは動かせない）',
  'test:e2e:ui': '★人が見ながら回す物★（playwright の画面。CIでは動かせない）',
  'test:names': '★道具★（前回の赤い試験の名前を出すだけ。試験ではない）',

  // ─ 束ねただけの物（中身は それぞれ CI に入っている）─
  check: '★束ねただけ★（lint/format/stylelint＝自動で直す物＋audit。中の audit は CI に在る）',
  'check:logic':
    '★束ねただけ★（test / test:replay / test:replay-display / test:mm-priority＝4本とも CI に在る）',
  'check:all': '★束ねただけ★（check ＋ check:logic）',
  'test:cert': '★束ねただけ★（中の7本は cert-gate.yml の matrix に 1本ずつ在る）',

  // ─ 数字を測る物（赤にならない設計）─
  //   ★test:stryker は 2026-08-27 に 消しました★
  //     ・123秒で ConfigError（初回テストが赤）＝★動きません★（私の試験を外しても同じ＝前から）
  //     ・thresholds.break=null ＝★元から 赤にならない設計★＝見張りとして働かない
  //     ・設定ファイル自身に「dry-run 常時 fail」と書いてあった
  //     ⇒ 指示役の裁定「消す」。stryker.config.mjs / vitest.stryker.config.js /
  //        devDependencies(@stryker-mutator/core, /vitest-runner) も 一緒に消しました。
  'test:coverage':
    '★KPIを測る物★（vitest --coverage。落ちる条件が無い＝赤にならない。数字が要る時に手元で回す。2026-08-27 実測 138秒・37.85%）',

  // ─ 今 赤なので 保留（勝手に基準化しない）─
  'test:verify-9677':
    '★2026-08-27 に 赤★（今のエンジン 9,065.75m / 基準 9,220.9m ＝ −155.14m・−1.68%）。★原因＝比べている物差しが違う★：基準は 2026-05-31 の「道路の当てはめ(Viterbi確定snap)」の値、今のエンジンは 2026-06-06 に変わった「平滑した生GPSの弦」。★エンジンの不具合ではない★。どうするかは 指示役の裁定待ち（詳しくは tests/verify-new-meter-9677.js の頭）',
};

function scripts() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts || {};
}

function workflowsText() {
  const dir = path.join(ROOT, '.github', 'workflows');
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
}

describe('★試験は「登録する」か「理由を書く」かの どちらか★', () => {
  const S = scripts();
  const WF = workflowsText();
  const shiken = Object.keys(S).filter((k) => /^(test|check)/.test(k));

  it('★試験らしき script が 1本も見つからない、という事は無い★', () => {
    expect(shiken.length, '★数え方が壊れた（package.json を読めていない）★').toBeGreaterThan(20);
  });

  it('★どの workflow も呼ばない試験は、理由が書いてある物だけ★', () => {
    const komatta = [];
    shiken.forEach((k) => {
      if (WF.includes('npm run ' + k)) return; // (A) CI が呼んでいる
      if (TEMOTO_NO_DOUGU[k]) return; // (B) 理由が書いてある
      komatta.push(k);
    });
    expect(
      komatta,
      '★この試験は 誰も回していません★\n' +
        '  ⇒ ★どれかの workflow に登録する★ か\n' +
        '  ⇒ ★tests/unit/scripts-registered.test.js の TEMOTO_NO_DOUGU に 名前と理由を書く★\n' +
        '  （理由が書けないなら ★その試験は 消してください★）\n' +
        '  ★「在るのに0回」は 2026-08-27 までに 3度 踏んでいます★'
    ).toEqual([]);
  });

  it('★理由だけ残って 中身が消えた物 が無い★（掃除し忘れを止める）', () => {
    const yurei = Object.keys(TEMOTO_NO_DOUGU).filter((k) => !S[k]);
    expect(
      yurei,
      '★package.json に無い物の理由が 残っています★（消した時に 一緒に消してください）'
    ).toEqual([]);
  });

  it('★理由は 1行 書いてある（空にしない）★', () => {
    const karappo = Object.keys(TEMOTO_NO_DOUGU).filter(
      (k) => !TEMOTO_NO_DOUGU[k] || TEMOTO_NO_DOUGU[k].trim().length < 10
    );
    expect(karappo, '★理由が空です★').toEqual([]);
  });

  it('★距離・課金の見張りは 必ず CI に在る★（ここだけは 理由で逃がさない）', () => {
    // ★実際に 2026-08-27 まで 回っていなかった2本★
    const kanarazu = ['test:gate-creep', 'test:k-neverover'];
    kanarazu.forEach((k) => {
      expect(S[k], `★${k} が package.json から消えている★`).toBeTruthy();
      expect(
        WF.includes('npm run ' + k),
        `★${k} が どの workflow にも入っていない★\n` +
          '  ＝停まっている時の距離・過大ゼロ の見張りが 誰も回さない状態に戻っています'
      ).toBe(true);
    });
  });
});

// ★CIに入れない tests/直下の .js＝1本ずつ 理由を書く★（2026-08-28・指示役の裁定②）
//   ★1本ずつ 実際に回してから 決めました★（回るか／何秒か／緑か赤か）
const TESTS_NO_TEMOTO = {
  'kp-segment-score.js':
    '★引数が要る道具★（node tests/kp-segment-score.js <traceFile> <kpStart> <kpEnd>。引数なしで回すと usage を出して終わる。2026-08-28 実測 0.2秒・戻り値1）',
  'sim-display-montecarlo.js':
    '★数字を出すだけ★（画面の見え方をモンテカルロで並べる。合否の線が無い＝赤にならない。2026-08-28 実測 0.7秒・戻り値0）',
  'bench-oldphone-decode-dedup.js':
    '★速さの測定★（古いスマホでの1点あたりの時間）＋★repo の外の実物（C:/Users/zeroa/gpstrace.json）を見ます★＝CIでは動きません。合否は出しますが 機械の速さで揺れるので CIに入れません。2026-08-28 実測 0.8秒・戻り値0（★手元に実物が在ったから緑★）。',
  'real-trace-roadsnap.js':
    '★遠くの倉庫（debug_traces）から 実物を取ってくる作り★＝★CIでは動きません★（繋がらない）。2026-08-28 に ★取れない時は「未測定」と言って 赤で終わる★形に直しました（前は 緑で終わっていた＝何も見ていないのに緑）。実測 6.4秒・戻り値1。',
  'verify-display-frame-clamp.js':
    '★2026-08-28 に 赤★（1フレーム飛び 22.7m > 10）。★画面の見え方★（課金距離ではない）。★裁定待ち★（直す／今の数を基準にする／消す）',
  'verify-display-gap-recovery.js':
    '★2026-08-28 に 赤★（復帰の追従速度 29.70 m/s > 25＝「ドン」と飲む）。★画面の見え方★（課金距離ではない）。★裁定待ち★',
};

describe('★tests/直下の .js も 登録するか 理由を書くか★', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const S2 = scripts();
  const cmds = Object.values(S2).join(' | ');
  const WF2 = workflowsText();
  const files = fs2
    .readdirSync(path2.join(ROOT, 'tests'))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

  it('★数えられている★（0本なら 数え方が壊れている）', () => {
    expect(files.length, '★tests/直下の .js が読めない★').toBeGreaterThan(20);
  });

  it('★どこからも呼ばれない .js は、理由が書いてある物だけ★', () => {
    const komatta = files.filter((f) => {
      if (cmds.indexOf('tests/' + f) >= 0) return false; // package.json が呼んでいる
      if (WF2.indexOf('tests/' + f) >= 0) return false; // workflow が直接 呼んでいる
      if (TESTS_NO_TEMOTO[f]) return false; // 理由が書いてある
      return true;
    });
    expect(
      komatta,
      '★この .js は 誰も回していません★\n' +
        '  ⇒ ★package.json に名前を付けて workflow に登録する★ か\n' +
        '  ⇒ ★TESTS_NO_TEMOTO に 名前と理由を書く★（回らないなら 消す）\n' +
        '  ★2026-08-28 に 15本 見つかりました（うち タイヤ真値の見張りも 入っていた）★'
    ).toEqual([]);
  });

  it('★理由だけ残って 中身が消えた物 が無い★', () => {
    const yurei = Object.keys(TESTS_NO_TEMOTO).filter(
      (f) => !fs2.existsSync(path2.join(ROOT, 'tests', f))
    );
    expect(yurei, '★tests/ に無い物の理由が 残っています★').toEqual([]);
  });

  it('★距離・課金の見張りは 必ず 呼ばれている★（理由で逃がさない）', () => {
    // ★2026-08-28 まで 誰も回していなかった物★
    ['gate-road-distance.js', 'truedist-score-0610.js', 'replay-obd-main.js'].forEach((f) => {
      expect(
        cmds.indexOf('tests/' + f) >= 0 || WF2.indexOf('tests/' + f) >= 0,
        '★' +
          f +
          ' が どこからも呼ばれていない★\n' +
          '  ＝タイヤ真値／過大ゼロ の見張りが 誰も回さない状態に戻っています'
      ).toBe(true);
    });
  });
});
