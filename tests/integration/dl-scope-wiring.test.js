'use strict';
// ============================================================
// ★「最新データを確認」が 全国204MB を落とさないこと 2026-08-03★
//
//   ★司さんの報告★「46県で止まる」「完了するまでもくそ遅い」
//
//   ★実測で確定した3つの欠陥★
//     1. 47都道府県ぶん・合計204MB を落としていた（携帯のWi-Fiで10〜25分）
//     2. fetch に★制限時間が無かった★ → 1県の応答が返らないと
//        ★永久に46/47のまま止まる★。エラーも出ない。これが「46で止まる」の正体。
//     3. cache:'reload' ＝ もう持っている県も毎回ぜんぶ落とし直す
//
//   ここでは「直した形が実際に配線されているか」を見る。
//   （どの県を選ぶかの正しさは tests/unit/dl-plan.test.js）
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const IDX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 「最新データを確認」の処理だけを切り出す
function fn() {
  const i = IDX.indexOf('async function _onCheckUpdate(');
  expect(i, '_onCheckUpdate が無い').toBeGreaterThan(-1);
  return IDX.slice(i, i + 4000);
}

describe('★止まらないこと（制限時間）★', () => {
  it('★1県ごとに制限時間がある★（無いと永久に46/47で止まる）', () => {
    const f = fn();
    expect(f, '制限時間が無い＝また止まる').toContain('AbortController');
    expect(f).toContain('ac.abort()');
    expect(f).toContain('signal: ac.signal');
  });

  it('制限時間の後片付けをしている（timerを残さない）', () => {
    expect(fn()).toContain('clearTimeout(timer)');
  });

  it('制限時間は大きい県(11.2MB)でも足りる長さ', () => {
    const m = IDX.match(/const DL_TIMEOUT_MS = (\d+)/);
    expect(m, 'DL_TIMEOUT_MS が無い').toBeTruthy();
    const ms = Number(m[1]);
    expect(ms).toBeGreaterThanOrEqual(30000);
    expect(ms, '長すぎると「止まった」のと同じになる').toBeLessThanOrEqual(120000);
  });
});

describe('★全国204MBを既定で落とさないこと★', () => {
  it('落とす県を選ぶ道具を通している', () => {
    const f = fn();
    expect(f).toContain('_dlTargets(');
    expect(IDX).toContain('function _dlTargets(');
  });

  it('★既定は「今いる県＋隣」★（planFor を使っている）', () => {
    const i = IDX.indexOf('function _dlTargets(');
    const body = IDX.slice(i, i + 900);
    expect(body).toContain('DLPlan.planFor');
  });

  it('★全国は明示で選んだ時だけ★', () => {
    const i = IDX.indexOf('function _dlTargets(');
    const body = IDX.slice(i, i + 900);
    expect(body).toContain('orderFor');
    expect(IDX).toContain('_st_onCheckUpdateAll');
  });

  it('★県が分からない時は全国に落とす★（少なく落として「地図が無い」より安全）', () => {
    const i = IDX.indexOf('function _dlTargets(');
    const body = IDX.slice(i, i + 900);
    expect(body).toContain('PREFECTURES_DL.slice()');
  });

  it('js/dl-plan.js を読み込んでいる（読まないと window.DLPlan が無い）', () => {
    expect(IDX).toContain('src="js/dl-plan.js"');
    expect(fs.existsSync(path.join(ROOT, 'js', 'dl-plan.js'))).toBe(true);
  });

  it('★読み込む順番★ dl-plan.js が 使う側より先に在る', () => {
    const src = IDX.indexOf('src="js/dl-plan.js"');
    const use = IDX.indexOf('function _dlTargets(');
    expect(src).toBeGreaterThan(-1);
    expect(src, 'dl-plan.js の読み込みが後ろにある＝使う時にまだ無い').toBeLessThan(use);
  });
});

describe('★持っている県を落とし直さないこと★', () => {
  it("cache:'reload' を使っていない", () => {
    expect(fn(), '毎回204MB取り直しになる').not.toContain("cache: 'reload'");
  });
});

describe('★画面から両方が選べること★', () => {
  it('この辺りだけ／全国ぶん の2つのボタンがある', () => {
    expect(IDX).toContain('id="_st_dlUpdateBtn"');
    expect(IDX).toContain('id="_st_dlUpdateAllBtn"');
    expect(IDX).toContain('_st_onCheckUpdateAll()');
  });

  it('全国のボタンには「時間がかかる」と書いてある', () => {
    const i = IDX.indexOf('id="_st_dlUpdateAllBtn"');
    expect(IDX.slice(i - 300, i + 300)).toContain('時間がかかります');
  });
});

describe('★距離・料金・業務の流れに触っていないこと★', () => {
  it('落とすファイルを選んでいるだけ（料金や距離を触っていない）', () => {
    const f = fn();
    ['calcFare', 'distance_m', 'setDistance', 'Meter.set', 'addDistance'].forEach(function (w) {
      expect(f, w + ' に触っている').not.toContain(w);
    });
  });

  it('落とすのは roads だけ（他の重いデータを増やしていない）', () => {
    const f = fn();
    expect(f).toContain("'/data/roads-' + pref + '.js'");
    expect(f).not.toContain('road-graph');
    expect(f).not.toContain('addresses-chiban');
  });
});
