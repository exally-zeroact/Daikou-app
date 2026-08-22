'use strict';
// ============================================================
// ★本番倉庫の「前後で何が動いたか」を機械で突き合わせる（追加3）2026-08-02★
//
//   端から端まで通す時、本番倉庫には★他アプリの実データが同居している★
//   （meisai 1,099件 / pay_* / companies …）。
//   「増えたのが★想定した表・想定した件数だけ★」を人の目で確かめるのは無理。
//   ★想定外の表が1行でも動いていたら、そこで止めて報告する★ための判定をここで固定する。
//
//   ここで見るのは純ロジック（数の突き合わせ）だけ。通信は runner 側。
// ============================================================
const path = require('path');

let D;
beforeAll(async () => {
  D = await import('../../scripts/db-snapshot.mjs');
});

const BEFORE = {
  dk_shifts: 0,
  dk_trips: 0,
  companies: 24,
  dk_companies: 10,
  dk_company_devices: 18,
  meisai: 1099,
  pay_slips: 500,
  dk_employees: 0,
};

describe('★想定どおりに動いた時だけ OK★', () => {
  it('第1段階の想定どおり（shifts+1 / trips+1 / companies+1 / devices+1 / meisai±0）', () => {
    const after = Object.assign({}, BEFORE, {
      dk_shifts: 1,
      dk_trips: 1,
      companies: 25,
      dk_companies: 11,
      dk_company_devices: 19,
    });
    const r = D.diff(BEFORE, after, D.EXPECT.e2e_stage1);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('代行が2件でも通る（trips は +1〜2 の幅を許す）', () => {
    const after = Object.assign({}, BEFORE, {
      dk_shifts: 1,
      dk_trips: 2,
      companies: 25,
      dk_companies: 11,
      dk_company_devices: 19,
    });
    expect(D.diff(BEFORE, after, D.EXPECT.e2e_stage1).ok).toBe(true);
  });

  it('何も動いていなければ通る（実行前に道具を試す時）', () => {
    expect(D.diff(BEFORE, BEFORE, {}).ok).toBe(true);
  });
});

describe('★想定外が1行でも動いたら止める★', () => {
  it('★meisai が増えたら止める（第1段階では絶対に増えない）★', () => {
    const after = Object.assign({}, BEFORE, {
      dk_shifts: 1,
      dk_trips: 1,
      companies: 25,
      dk_companies: 11,
      dk_company_devices: 19,
      meisai: 1100,
    });
    const r = D.diff(BEFORE, after, D.EXPECT.e2e_stage1);
    expect(r.ok).toBe(false);
    expect(r.violations.join()).toContain('meisai');
  });

  it('★他アプリの表が動いたら止める（pay_slips）★', () => {
    const after = Object.assign({}, BEFORE, { dk_shifts: 1, pay_slips: 501 });
    const r = D.diff(BEFORE, after, D.EXPECT.e2e_stage1);
    expect(r.ok).toBe(false);
    expect(r.violations.join()).toContain('pay_slips');
  });

  it('★行が減っていたら止める（消してはいけない）★', () => {
    const after = Object.assign({}, BEFORE, { meisai: 1098 });
    const r = D.diff(BEFORE, after, D.EXPECT.e2e_stage1);
    expect(r.ok).toBe(false);
    expect(r.violations.join()).toContain('meisai');
  });

  it('想定より多く増えても止める（trips が3件）', () => {
    const after = Object.assign({}, BEFORE, {
      dk_shifts: 1,
      dk_trips: 3,
      companies: 25,
      dk_companies: 11,
      dk_company_devices: 19,
    });
    expect(D.diff(BEFORE, after, D.EXPECT.e2e_stage1).ok).toBe(false);
  });

  it('★表そのものが消えていたら止める★', () => {
    const after = Object.assign({}, BEFORE);
    delete after.meisai;
    const r = D.diff(BEFORE, after, D.EXPECT.e2e_stage1);
    expect(r.ok).toBe(false);
    expect(r.violations.join()).toContain('meisai');
  });

  it('★知らない表が生えていたら止める★', () => {
    const after = Object.assign({}, BEFORE, { nazo_table: 3 });
    const r = D.diff(BEFORE, after, D.EXPECT.e2e_stage1);
    expect(r.ok).toBe(false);
    expect(r.violations.join()).toContain('nazo_table');
  });
});

describe('★第2段階（自動投入）の想定★', () => {
  it('1件目は meisai +1 が想定どおり', () => {
    const after = Object.assign({}, BEFORE, { dk_shifts: 1, dk_trips: 1, meisai: 1100 });
    expect(D.diff(BEFORE, after, D.EXPECT.e2e_stage2_first).ok).toBe(true);
  });

  it('★再送で meisai が増えたら止める（二重請求になる）★', () => {
    const before2 = Object.assign({}, BEFORE, { meisai: 1100 });
    const after2 = Object.assign({}, before2, { meisai: 1101 });
    const r = D.diff(before2, after2, D.EXPECT.e2e_stage2_resend);
    expect(r.ok).toBe(false);
    expect(r.violations.join()).toContain('meisai');
  });

  it('再送で何も増えなければ通る', () => {
    const before2 = Object.assign({}, BEFORE, { meisai: 1100 });
    expect(D.diff(before2, before2, D.EXPECT.e2e_stage2_resend).ok).toBe(true);
  });
});

describe('★壊れた入力でも黙って通さない★', () => {
  it('前後どちらかが無ければ ok=false', () => {
    expect(D.diff(null, BEFORE, {}).ok).toBe(false);
    expect(D.diff(BEFORE, null, {}).ok).toBe(false);
    expect(D.diff(null, null, {}).ok).toBe(false);
  });
  it('throw しない', () => {
    expect(() => D.diff('x', 'y', 'z')).not.toThrow();
    expect(() => D.diff({}, {}, undefined)).not.toThrow();
  });
});

describe('想定の書き方', () => {
  it('第1段階の想定に meisai が ±0 で入っている（一番大事な行）', () => {
    expect(D.EXPECT.e2e_stage1.meisai).toEqual([0, 0]);
  });
  it('道具のファイルが実在する', () => {
    const fs = require('fs');
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'scripts', 'db-snapshot.mjs'))).toBe(
      true
    );
  });
});

describe('★手順1（司さんが自分で通す版）の想定★', () => {
  // 請求書アプリは触らない・会社は登録済み ＝ 端末1台 + 勤務1件 + 代行1〜2件だけ
  it('想定どおりなら通る', () => {
    const after = Object.assign({}, BEFORE, {
      dk_company_devices: 19,
      dk_shifts: 1,
      dk_trips: 1,
    });
    expect(D.diff(BEFORE, after, D.EXPECT.step1).ok).toBe(true);
  });

  it('★請求先(companies)が増えたら止める（手順1では触らないはず）★', () => {
    const after = Object.assign({}, BEFORE, {
      dk_company_devices: 19,
      dk_shifts: 1,
      dk_trips: 1,
      companies: 25,
    });
    const r = D.diff(BEFORE, after, D.EXPECT.step1);
    expect(r.ok).toBe(false);
    expect(r.violations.join()).toContain('companies');
  });

  it('★meisai が増えたら止める（自動投入は既定オフのはず）★', () => {
    const after = Object.assign({}, BEFORE, { dk_shifts: 1, meisai: 1100 });
    expect(D.diff(BEFORE, after, D.EXPECT.step1).ok).toBe(false);
  });

  it('★端末が2台増えたら止める（1台だけのはず）★', () => {
    const after = Object.assign({}, BEFORE, {
      dk_company_devices: 20,
      dk_shifts: 1,
      dk_trips: 1,
    });
    expect(D.diff(BEFORE, after, D.EXPECT.step1).ok).toBe(false);
  });
});

describe('★会社が「有る/無い」で想定を変える（決め打ちしない）★', () => {
  // 指示役の指摘: 「会社は既にある」で固定すると、万一まだ無くて司さんが登録した時に
  // ★正しい通り方なのに赤★ になる。控えを見てから選ぶ。
  const RUN = { dk_company_devices: 19, dk_shifts: 1, dk_trips: 1 };

  it('会社が有る時: dk_companies が増えなければ通る', () => {
    expect(D.diff(BEFORE, Object.assign({}, BEFORE, RUN), D.EXPECT.step1).ok).toBe(true);
  });

  it('★会社が有るのに増えたら止める★', () => {
    const after = Object.assign({}, BEFORE, RUN, { dk_companies: 11 });
    expect(D.diff(BEFORE, after, D.EXPECT.step1).ok).toBe(false);
  });

  it('会社が無かった時: dk_companies +1 でも通る（正しい通り方）', () => {
    const after = Object.assign({}, BEFORE, RUN, { dk_companies: 11 });
    expect(D.diff(BEFORE, after, D.EXPECT.step1_new_company).ok).toBe(true);
  });

  it('★会社を作る想定なのに作られていなければ止める★', () => {
    const after = Object.assign({}, BEFORE, RUN);
    expect(D.diff(BEFORE, after, D.EXPECT.step1_new_company).ok).toBe(false);
  });

  it('どちらの想定でも 請求先と明細は ±0 のまま', () => {
    ['step1', 'step1_new_company'].forEach((k) => {
      const after = Object.assign({}, BEFORE, RUN, { dk_companies: 11, meisai: 1100 });
      expect(D.diff(BEFORE, after, D.EXPECT[k]).violations.join()).toContain('meisai');
    });
  });
});
