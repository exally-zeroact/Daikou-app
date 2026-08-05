'use strict';
// ============================================================
// ★押し忘れの知らせが「作っただけで出ない」を防ぐ 2026-08-05★
//
//   js/carryover.js の判断が正しくても、呼ばれていなければ
//   ★また前の日の業務が開きっぱなしのまま次の晩が始まる★。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const IDX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

describe('★読み込まれていること★', () => {
  it('js/carryover.js が在る', () => {
    expect(fs.existsSync(path.join(ROOT, 'js', 'carryover.js'))).toBe(true);
  });

  it('index.html が読み込んでいる', () => {
    expect(IDX).toContain('src="js/carryover.js"');
  });
});

describe('★起動時に聞くこと★', () => {
  it('Business.load() の直後に呼んでいる', () => {
    const i = IDX.indexOf('Business.load();');
    expect(i).toBeGreaterThan(-1);
    const around = IDX.slice(i, i + 700);
    expect(around, '★押し忘れに気づけない★').toContain('_askCarryOver()');
  });

  it('_askCarryOver の中身がある', () => {
    const i = IDX.indexOf('function _askCarryOver()');
    expect(i).toBeGreaterThan(-1);
    const body = IDX.slice(i, i + 1800);
    expect(body).toContain('CarryOver.check');
    expect(body).toContain('Business.getState()');
  });
});

describe('★勝手に締めないこと（一番危ない）★', () => {
  it('運転手に聞いてから締める', () => {
    const i = IDX.indexOf('function _askCarryOver()');
    const body = IDX.slice(i, i + 1800);
    expect(body, '★聞かずに締めている★').toContain('window.confirm(');
    // 「いいえ」なら何もしない
    expect(body).toMatch(/if \(!yes\) return;/);
  });

  it('★聞く前に Business.end を呼んでいない★', () => {
    const i = IDX.indexOf('function _askCarryOver()');
    const body = IDX.slice(i, i + 1800);
    const ask = body.indexOf('window.confirm(');
    const end = body.indexOf('Business.end()');
    expect(ask).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(-1);
    expect(end, '★聞く前に締めている＝そのあと走った分が飛ぶ★').toBeGreaterThan(ask);
  });

  it('締めたら、その場で事務所へ送る', () => {
    const i = IDX.indexOf('function _askCarryOver()');
    const body = IDX.slice(i, i + 1800);
    expect(body).toContain('_syncAfterEnd()');
  });
});

describe('★業務を止めないこと★', () => {
  it('全体が try/catch で囲ってある', () => {
    const i = IDX.indexOf('function _askCarryOver()');
    const body = IDX.slice(i, i + 1800);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });
});

describe('★普通の夜勤では出さないこと（毎晩じゃまにしない）★', () => {
  const CO = require(path.join(ROOT, 'js', 'carryover.js'));
  const jst = (y, mo, d, h) => Date.UTC(y, mo - 1, d, h - 9, 0);

  it('18時開始 → 翌朝9時では出ない', () => {
    expect(
      CO.check({ active: true, start_time: jst(2026, 8, 4, 18) }, jst(2026, 8, 5, 9)).carryOver
    ).toBe(false);
  });

  it('★24時間ほったらかしで初めて出る★', () => {
    expect(
      CO.check({ active: true, start_time: jst(2026, 8, 4, 17) }, jst(2026, 8, 5, 17)).carryOver
    ).toBe(true);
  });
});
