// ============================================================
// ★★赤の中身を 残す（上書きされない所へ）★★ 2026-08-29
//
//   ★何が困っていたか（実測）★
//     2026-08-29 に 全体を 18回 回して ★赤が 2回★ 出ました。
//     どちらも ★ディスクを 大きく触った直後の 1回目★（npm ci の後／file を書き直した後）。
//     ところが 結果は data/test-results/last-run.json に 書かれ、
//     ★次の回で 上書き★されます。＝★次の回が 緑だと 赤の中身が 消えます★。
//     私は それで 2回とも 中身を 取り逃がし、原因を 言えませんでした。
//
//   ★これは何をするか★
//     赤が 1本でも 出た回だけ、data/test-results/failures.log に ★足します（消しません）★。
//     1行 = 1本の赤。file名・試験名・出た文言 の 3つ。
//     ＝次に 揺れたら ★その場で 中身が 分かります★。
//
//   ★緑の回は 1文字も 書きません★（普段は 何も 増えません）
//   ★これは 見張りではありません★（合否を 出しません＝赤にも 緑にも しません）。
//     記録係です。だから CI の結果は 1本も 変わりません。
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

const LOG = path.join(__dirname, '..', '..', 'data', 'test-results', 'failures.log');
const KAGIRI = 4000; // ★1行が 長くなりすぎない為（file が 膨らむと 誰も読まない）★

function hitokoto(e) {
  const s = (e && (e.message || e.stack)) || String(e || '');
  return String(s)
    .replace(/[\r\n]+/g, ' / ')
    .slice(0, KAGIRI);
}

// ★ここは 決めごと★: この記録係が 落ちても 試験の結果を 変えない。
//   （記録を 取る為に 赤を 増やしたら 本末転倒）
function shizukani(fn) {
  try {
    fn();
  } catch (_) {
    /* 記録に 失敗しても 何もしない */
  }
}

// ★呼び名は vitest の版で 変わります★
//   4系＝onTestCaseResult / onTestRunEnd ／ 3系より前＝onFinished
//   ★どちらでも 拾えるように 両方 持ちます★（2026-08-29 実測: この repo は vitest 4.1.6）
class FailureRecorder {
  // ★書き出し先を 差し替えられるようにしてあります★
  //   理由 … この記録係自身の試験が ★本物の記録を 汚さない★為（毎回 行が増えると 誰も読まない）。
  //   ふだんは 何も渡しません＝上の LOG に 書きます。
  constructor(opts) {
    this.aka = [];
    this.logPath = (opts && opts.logPath) || LOG;
  }

  // ── vitest 4系 ──────────────────────────────
  onTestCaseResult(testCase) {
    shizukani(() => {
      const r = typeof testCase.result === 'function' ? testCase.result() : testCase.result;
      if (!r || (r.state !== 'failed' && r.state !== 'fail')) return;
      const fname = (testCase.module && testCase.module.moduleId) || '(file不明)';
      const namae = testCase.fullName || testCase.name || '(名前不明)';
      const e = (r.errors && r.errors[0]) || r.error;
      this.aka.push([fname, namae, hitokoto(e)].join('\t'));
    });
  }

  onTestRunEnd() {
    this.kaku();
  }

  // ── 3系より前（残しておく：版を上げ下げしても 効く）──
  onFinished(files) {
    shizukani(() => {
      const horu = (fname, oya, t) => {
        if (!t) return;
        const namae = oya ? oya + ' > ' + t.name : t.name;
        if (Array.isArray(t.tasks)) {
          t.tasks.forEach((k) => horu(fname, namae, k));
          return;
        }
        const r = t.result;
        if (!r || r.state !== 'fail') return;
        const e = (r.errors && r.errors[0]) || r.error;
        this.aka.push([fname, namae, hitokoto(e)].join('\t'));
      };
      (files || []).forEach((f) => (f.tasks || []).forEach((t) => horu(f.name, '', t)));
    });
    this.kaku();
  }

  kaku() {
    shizukani(() => {
      if (!this.aka.length) return; // ★緑の回は 書かない★
      const gyou = Array.from(new Set(this.aka)); // 両方の口から 入っても 1本にする
      this.aka = [];
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
      // ★時刻は 記録の要（いつ 揺れたかが 分からないと 追えない）★
      const atama = '# ' + new Date().toISOString() + '  赤 ' + gyou.length + '本';
      fs.appendFileSync(this.logPath, atama + '\n' + gyou.join('\n') + '\n', 'utf8');
    });
  }
}

module.exports = FailureRecorder;
module.exports.default = FailureRecorder;
