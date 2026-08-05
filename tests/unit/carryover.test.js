'use strict';
// ============================================================
// ★業務終了の押し忘れに気づかせる 2026-08-05★
//
//   ★司さんの指摘★
//     業務終了を押し忘れたまま次の日を迎えると、
//     ★業務開始が効かない★（business.js: state.active なら return false）。
//     画面も「業務中」のままなので前の日の業務がそのまま続き、
//     ★2晩ぶんが1つにまとまって、日付がずれる★。
//
//   ★ここで気をつけること★
//     ・夜勤は日をまたぐのが普通（18時→翌9時）。★またいだだけで出したら毎晩じゃま★
//     ・勝手に締めない。★運転手に選ばせる★
//       （勝手に締めると、締めた時刻までの距離しか残らず、そのあと走った分が飛ぶ）
// ============================================================
const path = require('path');
const CO = require(path.resolve(__dirname, '..', '..', 'js', 'carryover.js'));

// 日本時間の日時 → ミリ秒
const jst = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 9, mi || 0);
const active = (start) => ({ active: true, start_time: start });

describe('★ふつうの夜勤では出さないこと（毎晩じゃまにしない）★', () => {
  it('17時開始 → 同じ日の23時に開いた', () => {
    const r = CO.check(active(jst(2026, 8, 4, 17, 0)), jst(2026, 8, 4, 23, 0));
    expect(r.carryOver, '同じ日なのに出ている').toBe(false);
  });

  it('★18時開始 → 翌朝9時（日をまたぐ普通の夜勤）★', () => {
    const r = CO.check(active(jst(2026, 8, 4, 18, 0)), jst(2026, 8, 5, 9, 0));
    expect(r.carryOver, '★普通の夜勤で毎晩出てしまう★').toBe(false);
  });

  it('17時開始 → 翌昼12時（19時間）でもまだ出さない', () => {
    const r = CO.check(active(jst(2026, 8, 4, 17, 0)), jst(2026, 8, 5, 12, 0));
    expect(r.carryOver).toBe(false);
  });
});

describe('★押し忘れには出すこと★', () => {
  it('★17時開始 → 翌日17時（24時間）＝押し忘れ★', () => {
    const r = CO.check(active(jst(2026, 8, 4, 17, 0)), jst(2026, 8, 5, 17, 0));
    expect(r.carryOver, '★押し忘れに気づけない★').toBe(true);
    expect(r.startedDay).toBe('2026-08-04');
    expect(r.today).toBe('2026-08-05');
    expect(Math.round(r.hours)).toBe(24);
  });

  it('2日ほったらかしでも出る', () => {
    const r = CO.check(active(jst(2026, 8, 4, 17, 0)), jst(2026, 8, 6, 19, 0));
    expect(r.carryOver).toBe(true);
  });

  it('★運転手が読める文が出る★', () => {
    const r = CO.check(active(jst(2026, 8, 4, 17, 0)), jst(2026, 8, 5, 17, 0));
    const m = CO.message(r);
    expect(m).toContain('08月04日');
    expect(m).toContain('まだ終わっていません');
    expect(m).toContain('終わらせますか');
  });
});

describe('★出してはいけない時に出さないこと★', () => {
  it('業務していない時', () => {
    expect(
      CO.check({ active: false, start_time: jst(2026, 8, 4, 17, 0) }, jst(2026, 8, 6, 17, 0))
        .carryOver
    ).toBe(false);
  });

  it('一度も業務を始めていない時', () => {
    expect(CO.check({ active: false, start_time: null }, Date.now()).carryOver).toBe(false);
  });

  it('★業務終了を押した後（limbo）は出さない★（続けるボタンで戻れる状態）', () => {
    // 終了済み = active:false。ここで出すと「終わっているのに終わらせますか」になる
    const r = CO.check(
      { active: false, ended: true, start_time: jst(2026, 8, 4, 17, 0) },
      jst(2026, 8, 6, 17, 0)
    );
    expect(r.carryOver).toBe(false);
  });

  it('壊れた状態でも落ちない', () => {
    expect(() => CO.check(null, Date.now())).not.toThrow();
    expect(() => CO.check({ active: true, start_time: 'こわれている' }, Date.now())).not.toThrow();
    expect(CO.check({ active: true, start_time: NaN }, Date.now()).carryOver).toBe(false);
  });

  it('出さない時は文も空', () => {
    expect(CO.message({ carryOver: false })).toBe('');
    expect(CO.message(null)).toBe('');
  });
});

describe('★日本時間で切ること★', () => {
  it('日本時間の朝8時は、その日（UTCで切ると前日になる）', () => {
    expect(CO.businessDay(jst(2026, 8, 5, 8, 0))).toBe('2026-08-05');
  });

  it('深夜0時ちょうどは、その日', () => {
    expect(CO.businessDay(jst(2026, 8, 5, 0, 0))).toBe('2026-08-05');
  });

  it('23時59分は、その日', () => {
    expect(CO.businessDay(jst(2026, 8, 4, 23, 59))).toBe('2026-08-04');
  });
});

describe('★勝手に締めないこと（判断するだけ）★', () => {
  it('この道具は業務の状態を変えない', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'js', 'carryover.js'), 'utf8');
    ['Business.end', 'Business.abandon', 'setItem', 'Meter.set'].forEach(function (w) {
      expect(src, '★' + w + ' に触っている＝勝手に締める恐れ★').not.toContain(w);
    });
  });
});
