'use strict';
// ============================================================
// ★秘密の 一覧（KINSHI_JI）を 持つ workflow の 段は 全部 包み（scripts/kinshi-tsutsumu.sh）を 通る★ 2026-10-16
//   本体（他の 席の 写し）は 赤の 時に 一覧の 番号と 場所を 出す＝包まない 段が 1つでも 在れば 公開の ログに 出る
//   （対立役：test.yml の node24 の 段を 包み 忘れていた）。
//   ★見る 所★ 段の run: の 中身から 注釈（# の 後ろ）を 外した 字で、包みを 呼んでいるか（字を 探すだけだと
//     注釈に 包みの 名前を 書いた だけで 通った・対立役）。job の 高さの env: に 一覧を 置くのは 赤（段を 選べない）。
//   ★外す 物★ commit 文の 門（scripts/kinshi-commit-msg.mjs）＝出すのは sha の 頭・語の 数・本数だけ（番号を 出さない）。
//   ★わざと壊して 赤に なった 記録（2026-10-16）★
//     node24 の 段を 元の `node … | tee` に 戻す→1本 赤／戻した 上で 注釈に「# kinshi-tsutsumu.sh」を 書く→1本 赤
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WF = path.join(ROOT, '.github', 'workflows');

// 一覧の secret の 書き方（secrets.KINSHI_JI と secrets['KINSHI_JI'] の 両方）
const SECRET = /secrets(?:\.KINSHI_JI\b|\[\s*['"]KINSHI_JI['"]\s*\])/;
const fukasa = (l) => l.length - l.replace(/^ +/, '').length;

// 1本の yml を 段に 分ける：steps: の 下の「- 」で 始まる 行から 次の 同じ 深さの「- 」まで
function danNi(s) {
  const gyou = s.split(/\r?\n/);
  const out = [];
  const jobEnv = [];
  let stepsFukasa = -1;
  let cur = null;
  for (let i = 0; i < gyou.length; i++) {
    const l = gyou[i];
    if (/^\s*steps:\s*$/.test(l)) {
      stepsFukasa = fukasa(l);
      cur = null;
      continue;
    }
    if (stepsFukasa >= 0 && l.trim() && fukasa(l) <= stepsFukasa && !/^\s*-/.test(l)) {
      stepsFukasa = -1; // steps の 外へ 出た
      cur = null;
    }
    if (stepsFukasa >= 0 && /^\s*- /.test(l) && fukasa(l) >= stepsFukasa) {
      cur = { gyou: [l], i };
      out.push(cur);
      continue;
    }
    if (cur) cur.gyou.push(l);
    else if (SECRET.test(l)) jobEnv.push(i + 1);
  }
  return { dan: out, jobEnv };
}
// 段の run: の 中身（注釈を 外す）
function runNoNakami(d) {
  const t = [];
  let inRun = -1;
  for (const l of d.gyou) {
    const m = l.match(/^(\s*)(?:- )?run:\s*(.*)$/);
    if (m) {
      inRun = fukasa(l);
      if (m[2] && m[2] !== '|' && m[2] !== '>') t.push(m[2]);
      continue;
    }
    if (inRun >= 0) {
      if (l.trim() && fukasa(l) <= inRun) inRun = -1;
      else t.push(l);
    }
  }
  return t.map((x) => x.replace(/(^|\s)#.*$/, '')).join('\n');
}

describe('★KINSHI_JI を 持つ 段は 包みを 通る★', () => {
  const dan = [];
  const jobEnv = [];
  const zenbu = [];
  for (const f of fs.readdirSync(WF).filter((x) => /\.ya?ml$/.test(x))) {
    const s = fs.readFileSync(path.join(WF, f), 'utf8');
    zenbu.push({ f, s });
    const r = danNi(s);
    for (const d of r.dan) if (d.gyou.some((l) => SECRET.test(l))) dan.push({ f, d });
    for (const n of r.jobEnv) jobEnv.push(f + ':' + n);
  }
  it('数えた 段（0本を 見て 緑に しない）', () => {
    expect(dan.length).toBeGreaterThanOrEqual(5);
  });
  it('job の 高さに 一覧を 置かない（段を 選べない）', () => {
    expect(jobEnv).toEqual([]);
  });
  it('run: の 中身で 包みを 呼ぶ・包まずに 本体を 呼ばない・終わり値を 捨てない（commit 文の 門は 外す）', () => {
    const warui = [];
    for (const { f, d } of dan) {
      const run = runNoNakami(d);
      const na = f + ':' + (d.i + 1) + ' の 段';
      // 包みの 外で 本体を 呼ぶ 行（同じ 行に 包みが 無い）
      const soto = run
        .split('\n')
        .filter(
          (l) => /kinshi-ji\.test\.mjs|npm run kinshi\b/.test(l) && !/kinshi-tsutsumu\.sh/.test(l)
        );
      if (soto.length) warui.push(na + '（包まずに 本体を 呼ぶ）');
      if (!/kinshi-tsutsumu\.sh/.test(run) && !/kinshi-commit-msg\.mjs/.test(run))
        warui.push(na + '（包みを 呼ばない）');
      // 終わり値を 捨てる（|| true・|| :・continue-on-error）
      if (/kinshi-tsutsumu\.sh[^\n]*\|\|\s*(true|:)/.test(run))
        warui.push(na + '（包みの 終わり値を 捨てる）');
      if (d.gyou.some((l) => /^\s*continue-on-error:\s*true/.test(l)))
        warui.push(na + '（continue-on-error）');
    }
    expect(warui, '★包まずに 一覧を 持つ 段が 在る＝赤の 日に 番号が 公開の ログに 出る★').toEqual(
      []
    );
  });
  it('一覧を GITHUB_ENV に 流して 後の 段へ 渡さない', () => {
    const warui = [];
    for (const { f, s } of zenbu)
      s.split(/\r?\n/).forEach((l, i) => {
        if (/KINSHI_JI/.test(l) && /GITHUB_ENV/.test(l)) warui.push(f + ':' + (i + 1));
      });
    expect(warui).toEqual([]);
  });
});
