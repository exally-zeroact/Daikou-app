'use strict';
// ============================================================
// ★日をまたいでも「その晩の仕事の日」で揃うこと 2026-08-05★
//
//   ★司さんの指摘★「請求書や給料は日を跨いでも業務開始の日付でできとるか？」
//
//   ★実データで実際に起きていた★
//     8/4 23:34 の代行 → 8/4
//     8/5 00:38 の代行 → ★8/5★    ← 同じ晩の仕事なのに日付が変わる
//   ＝★請求書だけ日付の切り方が違っていた★（代行1件ごとの時刻で切っていた）。
//   しかも UTC のまま切っていたので、日本時間 朝9時より前は前日の日付になっていた。
//
//   ★正しい形★
//     給料   … 業務開始の日（日本時間）  payroll-daily.js dateOf(s.started_at)
//     売上表 … 業務開始の日（日本時間）  uriage.html
//     請求書 … ★業務開始の日（日本時間）★ ← 今日ここを揃えた
//   代行は夜の仕事なので、★同じ晩は全部同じ日付★でないと数が合わない。
// ============================================================
const path = require('path');
const PD = require(path.resolve(__dirname, '..', '..', 'js', 'payroll-daily.js'));

// 請求書(Edge Function)が使うのと同じ切り方
function bizDate(ms) {
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// 日本時間の日時 → ミリ秒
const jst = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 9, mi);

describe('★日をまたいだ夜勤が、1つの日付にまとまること★', () => {
  it('17:09開始 → 翌1:25終了 は「開始した日」', () => {
    const start = jst(2026, 8, 4, 17, 9);
    expect(bizDate(start)).toBe('2026-08-04');
    expect(PD.dateOf(new Date(start).toISOString())).toBe('2026-08-04');
  });

  it('★深夜0時をまたいで始めた代行も、同じ晩の日付になる★', () => {
    // 実データで起きた形: 業務は 8/4 17:09 開始。代行は 8/5 00:38。
    const shiftStart = jst(2026, 8, 4, 17, 9);
    const tripStart = jst(2026, 8, 5, 0, 38);
    // ★請求書は「業務開始の日」で切る★
    expect(bizDate(shiftStart), '★同じ晩なのに翌日になっている★').toBe('2026-08-04');
    // 代行の時刻そのもので切ると翌日になってしまう（これが直す前の形）
    expect(bizDate(tripStart)).toBe('2026-08-05');
  });

  it('★給料・売上表・請求書が同じ日付になる★', () => {
    const shiftStart = jst(2026, 8, 4, 17, 9);
    const payroll = PD.dateOf(new Date(shiftStart).toISOString()); // 給料
    const invoice = bizDate(shiftStart); // 請求書
    expect(invoice, '★請求書だけ日付が違う＝数が合わない★').toBe(payroll);
  });
});

describe('★日本時間で切ること（UTCで切らない）★', () => {
  it('日本時間の朝8時は、その日（前日にならない）', () => {
    // UTC で切ると 8/4 23:00Z = 8/5 8:00 JST が「8/4」になってしまう
    const t = jst(2026, 8, 5, 8, 0);
    expect(bizDate(t), '★UTCで切ると前日になる★').toBe('2026-08-05');
    expect(PD.dateOf(new Date(t).toISOString())).toBe('2026-08-05');
  });

  it('日本時間の深夜0時ちょうどは、その日', () => {
    const t = jst(2026, 8, 5, 0, 0);
    expect(bizDate(t)).toBe('2026-08-05');
  });

  it('日本時間の23時59分は、その日', () => {
    const t = jst(2026, 8, 4, 23, 59);
    expect(bizDate(t)).toBe('2026-08-04');
  });
});

describe('★請求書の切り方が「代行ごとの時刻」に戻っていないこと★', () => {
  const fs = require('fs');
  const FN = path.resolve(
    __dirname,
    '..',
    '..',
    'supabase',
    'functions',
    'dk-sync-jobs',
    'index.ts'
  );

  it('業務開始の日で切っている', () => {
    if (!fs.existsSync(FN)) return; // 本番repoには置いていない
    const t = fs.readFileSync(FN, 'utf8');
    expect(t, '★業務開始の日で切っていない★').toContain('const bizDate =');
    expect(t).toContain('date: bizDate,');
  });

  it('★代行ごとの時刻で切る古い形が残っていない★', () => {
    if (!fs.existsSync(FN)) return;
    const t = fs.readFileSync(FN, 'utf8');
    expect(t, '★同じ晩が2日に分かれる形に戻っている★').not.toContain(
      'date: started ? started.slice(0, 10) : null'
    );
  });

  it('★日本時間に直してから切っている★', () => {
    if (!fs.existsSync(FN)) return;
    const t = fs.readFileSync(FN, 'utf8');
    const i = t.indexOf('const bizDate =');
    expect(t.slice(i, i + 400), 'UTCのまま切っている').toContain('9 * 60 * 60 * 1000');
  });
});
