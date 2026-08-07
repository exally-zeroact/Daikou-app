'use strict';
// ============================================================
// ★押せない時は「押せない姿」で出ること★ 2026-08-07
//
//   ★司さんの報告★
//     「代行開始ボタンが消える時がある」
//
//   ★掴んだ実バグ★
//     道データの版が上がると 印(daikome_warmup_v1)の版が合わなくなり、
//     準備ゲートが閉じ直して 代行開始ボタンが disabled + pointer-events:none になる。
//     ところが 較正ゲート(_updateCalibGate)が同じボタンに
//         pb.style.opacity = blocked ? '0.4' : ''
//     を毎回書き込むので ★薄さだけが消される★。
//     実測（版をズラした状態）: opacity=1 / pointer-events=none / disabled=true
//     ＝ 見た目は普通の青いボタン・押しても何も起きない。
//
//   ★直し方★
//     _applyDisabled は inline style をやめて class(.dk-gate-off) を付け外しする。
//     CSS 側を !important にしてあるので、あとから inline style を書かれても薄さが消えない。
//
//   ★なぜ画面テスト(E2E)でなく ここで固定するのか★
//     E2E で版をズラして測る形も作ったが、起動の速さで結果が変わって
//     16回に2回こけた（＝テスト自身が不安定）。不安定なテストは嘘をつくので置かない。
//     ここで見ているのは「どう書いてあるか」＝毎回同じ答えが出る。
//     実際の見た目は 実機で司さんに見てもらって確認済み(2026-08-07)。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// その関数の中身を切り出す
function bodyOf(fnName) {
  const i = HTML.indexOf('function ' + fnName + '(');
  if (i < 0) return null;
  const next = HTML.indexOf('\n        function ', i + 10);
  return HTML.slice(i, next > i ? next : i + 2000);
}

describe('★準備が終わるまで押せない時の姿★', () => {
  it('CSS に .dk-gate-off がある（薄く＋押せない）', () => {
    expect(HTML, '★.dk-gate-off の見た目が無い★').toContain('.dk-gate-off {');
    const i = HTML.indexOf('.dk-gate-off {');
    const rule = HTML.slice(i, i + 300);
    expect(rule, '★薄くならない★').toMatch(/opacity:\s*0\.4\s*!important/);
    expect(rule, '★押せてしまう★').toMatch(/pointer-events:\s*none\s*!important/);
  });

  it('★!important が付いている★（あとから inline style で消されないため）', () => {
    const i = HTML.indexOf('.dk-gate-off {');
    const rule = HTML.slice(i, i + 300);
    // _updateCalibGate が inline で opacity を書くので、class 側が勝つ必要がある
    expect(
      (rule.match(/!important/g) || []).length,
      '★!important が足りない＝薄さが消される★'
    ).toBeGreaterThanOrEqual(2);
  });

  it('★_applyDisabled は class を付ける（inline の opacity を書かない）★', () => {
    const body = bodyOf('_applyDisabled');
    expect(body, '_applyDisabled が見つからない').not.toBe(null);
    expect(body, '★class を付けていない★').toContain("classList.add('dk-gate-off')");
    expect(body, '★class を外していない★').toContain("classList.remove('dk-gate-off')");
    expect(
      /el\.style\.opacity\s*=\s*'0\.4'/.test(body),
      '★inline で薄さを書いている＝_updateCalibGate に上書きされて消える（元のバグ）★'
    ).toBe(false);
  });

  it('相手（_updateCalibGate）は今までどおり inline で opacity を書いている＝class が勝つ必要がある', () => {
    // ここが変わったら、この直しの前提が変わったということ
    expect(HTML).toMatch(/pb\.style\.opacity = blocked \? '0\.4' : ''/);
  });

  it('押せない理由を出す場所（dataReadyHint）が残っている', () => {
    expect(HTML).toContain('id="dataReadyHint"');
    expect(HTML).toContain('初回データ準備中');
  });
});
