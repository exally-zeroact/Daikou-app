'use strict';
// ============================================================
// ★重いワークフローが「黙って打ち切られる」形になっていないこと 2026-08-03★
//
//   ★2回続けて同じ形で刺された★
//     1回目 cert-gate      … 20回すべて cancelled（20分で打ち切り）
//     2回目 AI Bug Hunter  … 15:49:46→16:04:50 ＝ きっかり15分で打ち切り
//     どちらも原因は同じ:
//       ・repo 3,308MB のうち ★data/ が 3,293.8MB（99.6%）★ を丸ごと checkout していた
//       ・そして ★cancelled は緑でも赤でもない★ ので、一覧を見ても気づけない
//
//   だから2つを機械で縛る:
//     A. 重い道具は sparse-checkout で必要な物だけ取る
//     B. success 以外（cancelled / timed_out 含む）を赤にする総合結果ジョブを持つ
//
//   ※軽いワークフロー（数十秒で終わる物）まで縛ると邪魔なので、
//     ★対象を名指し★する。増えたらここに足す。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WF = path.join(ROOT, '.github', 'workflows');

// 重い＝data/ を丸ごと取ると打ち切られる物
const HEAVY = [
  { file: 'cert-gate.yml', result: 'cert-gate-result' },
  // ★bug-hunter.yml は 2026-08-25 に消した★（指示役の裁定）
  //   出していたのは週1の issue だけで、★27件が12週間 誰にも読まれず全部 open★だった。
  //   ★止めるだけだと いつか誰かが有効に戻す★ ので ワークフローごと消した。
];

const read = (f) => fs.readFileSync(path.join(WF, f), 'utf8');
const present = HEAVY.filter((h) => fs.existsSync(path.join(WF, h.file)));

describe('★重いワークフローが黙って打ち切られない形になっていること★', () => {
  it('見張る対象が実在する（空振りしていない）', () => {
    expect(present.length, '対象のワークフローが1つも無い').toBeGreaterThan(0);
  });

  present.forEach(({ file, result }) => {
    it(`${file} は sparse-checkout で必要な物だけ取る`, () => {
      const t = read(file);
      expect(t, `${file} が data/ ごと checkout している＝打ち切られる`).toContain(
        'sparse-checkout'
      );
      expect(t).toMatch(/sparse-checkout-cone-mode:\s*false/);
    });

    it(`★${file} は success 以外（cancelled / timed_out）を赤にする★`, () => {
      const t = read(file);
      expect(t, `${file} に総合結果ジョブが無い＝打ち切られても気づけない`).toContain(result);
      expect(t).toMatch(/if:\s*always\(\)/);
      expect(t).toContain('exit 1');
    });

    it(`${file} は data/ を丸ごと取っていない`, () => {
      const t = read(file);
      // sparse-checkout の中に「data」だけの行があったら全部取ってしまう
      const block = (t.match(/sparse-checkout:\s*\|([\s\S]*?)sparse-checkout-cone-mode/) || [])[1];
      if (!block) return;
      const lines = block
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      expect(lines, 'data/ を丸ごと取っている（3.29GB）').not.toContain('data');
    });
  });
});

describe('★ワークフローの timeout が実測より短くないこと★', () => {
  // 「timeout を伸ばして隠す」のは直したことにならないが、
  // 実測より短いままだと永久に打ち切られる。両方を避けるための下限。
  it('cert-gate の各ゲートに timeout がある', () => {
    // ★2026-08-28: 前は「無ければ return」＝★何も見ずに緑★でした。
    expect(
      fs.existsSync(path.join(WF, 'cert-gate.yml')),
      '★cert-gate.yml が 在りません★（見張りの本体が 消えています）'
    ).toBe(true);
    const t = read('cert-gate.yml');
    const timeouts = Array.from(t.matchAll(/^\s*timeout:\s*(\d+)/gm)).map((m) => Number(m[1]));
    expect(timeouts.length, 'ゲートごとの timeout が無い').toBeGreaterThan(10);
    // sim-cert は実測 6分19秒。10分未満だと危ない
    expect(Math.max(...timeouts)).toBeGreaterThanOrEqual(15);
    expect(Math.min(...timeouts)).toBeGreaterThanOrEqual(10);
  });
});
