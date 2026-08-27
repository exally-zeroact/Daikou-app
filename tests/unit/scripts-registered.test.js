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
  'test:coverage':
    '★KPIを測る物★（vitest --coverage。落ちる条件が無い＝赤にならない。数字が要る時に手元で回す。2026-08-27 実測 138秒・37.85%）',
  'test:stryker':
    '★今 動きません★（2026-08-27 実測：123秒で ConfigError「初回テストが赤」。★私の試験を外しても同じ＝前から★／設定にも「dry-run 常時 fail」と書いてある。加えて thresholds.break=null ＝ ★元から赤にならない設計★。直すか消すかは 別の回）',

  // ─ 今 赤なので 保留（勝手に基準化しない）─
  'test:verify-9677':
    '★2026-08-27 に 赤でした★（距離 9,065.75m / 目標 9,220.89m ＝ −155.14m・−1.68%）。★距離・課金なので 指示役の裁定を待つ★（creep と同じく「今日の数字を基準」にするか、直すか）',
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
