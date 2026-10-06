// ============================================================
// ★★ほかの 払い方（日給・回数歩合・距離歩合・段階歩合・指定日の 割増）★★ 2026-10-06
//
//   司さん「この給料の決め方やったら対応できんやつもあることないか？」→「対応できるように対立でやれ」
//   「そもそも2人で1台やろが」＝回数・距離は 乗った 2人とも 車の 分を 全部（時数と 同じ）
//
//   ★守る 事★
//     ①何も 決めていなければ 今の 給料と 1円も 変わらない（Excel の 試験も 緑の まま）
//     ②どの 払い方も 手で 足した 答えと 合う
//
//   ★基本の 1日（手で 足した 答え）★
//     車A 売上 40,000・8時間／2種（35%・最低 時給 1,150）が 8時間
//     積立 5% ＝ 2,000 ／ 1時間 ＝ (40,000 − 2,000) ÷ 8 ＝ 4,750
//     歩合 ＝ 4,750 × 0.35 × 8 ＝ 13,300 ／ 最低保証 ＝ 1,150 × 8 ＝ 9,200 ⇒ 13,300
//
//   わざと壊す（10-06 実測）：compute の 日給「代わり」を「足す」に すり替える ⇒ ★赤★（日給の 段）
// ============================================================
const P = require('../../js/daiko-payroll.js');

const HI = '2026-10-03';
function nyuryoku(rate) {
  return {
    date: HI,
    cars: [{ id: 'A', sales: 40000, expense: 0, hours: 8 }],
    owner: {},
    staff: [{ name: '甲', role: '2種', hours: 8, car: 'A', rate: rate }],
    tripsByCar: { A: { trips: 4, jissha_m: 20000, sou_m: 50000 } },
  };
}
function kyuryo(extra, rate) {
  const st = { roles: { '2種': { rate: 0.35, floor: 1150 } } };
  if (extra !== undefined) st.extra = extra;
  return P.compute(nyuryoku(rate), st).staff[0].pay;
}
const R = (x) => Math.round(x * 100) / 100;

describe('★① 決めていなければ 今と 同じ★', () => {
  it('extra 無し・空・関係ない 日の 割増 で どれも 13,300', () => {
    expect(R(kyuryo(undefined))).toBe(13300);
    expect(R(kyuryo(null))).toBe(13300);
    expect(R(kyuryo({}))).toBe(13300);
    expect(R(kyuryo({ wariHi: { '2026-10-04': { mult: 2 } } }))).toBe(13300);
    expect(R(kyuryo({ roles: { '1種': { nikkyu: 99999 } } })), '★別の 役割の 設定が 効いた★').toBe(
      13300
    );
  });
});

describe('★日給★', () => {
  const ni = (nikkyu, mode, hoshou) => ({
    roles: { '2種': { nikkyu: nikkyu, nikkyuMode: mode, nikkyuHoshou: hoshou } },
  });
  it('代わり：日給 10,000（最低保証 9,200 より 上）⇒ 10,000', () => {
    expect(R(kyuryo(ni(10000, 'kawari')))).toBe(10000);
  });
  it('代わり：日給 8,000 でも 最低保証が 効けば 9,200／保証を 外せば 8,000', () => {
    expect(R(kyuryo(ni(8000, 'kawari')))).toBe(9200);
    expect(R(kyuryo(ni(8000, 'kawari', false)))).toBe(8000);
  });
  it('足す：13,300 + 10,000 ＝ 23,300', () => {
    expect(R(kyuryo(ni(10000, 'tasu')))).toBe(23300);
  });
  it('高い方：日給 15,000 と 歩合 13,300 ⇒ 15,000／日給 12,000 ⇒ 13,300', () => {
    expect(R(kyuryo(ni(15000, 'takai')))).toBe(15000);
    expect(R(kyuryo(ni(12000, 'takai')))).toBe(13300);
  });
});

describe('★回数・距離の 歩合★（1人で 乗った 日＝1台の 額を その人が 全部）', () => {
  it('1回 300円 × 4回 ＝ 1,200 ⇒ 14,500', () => {
    expect(R(kyuryo({ kaisu: 300 }))).toBe(14500);
  });
  it('1km 20円：客を 乗せた 20km ⇒ +400／全部の 50km ⇒ +1,000', () => {
    expect(R(kyuryo({ kyori: 20 }))).toBe(13700);
    expect(R(kyuryo({ kyori: 20, kyoriShu: 'sou' }))).toBe(14300);
  });
  it('最低保証と 比べる 側（既定）／比べた 後で 足す', () => {
    // 歩合 10% ＝ 4,750 × 0.1 × 8 ＝ 3,800 ＜ 保証 9,200
    expect(R(kyuryo({ kaisu: 300 }, 0.1)), '比べる 側：max(3,800+1,200, 9,200)').toBe(9200);
    expect(R(kyuryo({ kaisu: 300, kasanAto: true }, 0.1)), '比べた 後：9,200+1,200').toBe(10400);
  });
});

describe('★段階歩合★（その日の 売上で 率が 変わる）', () => {
  const dk = {
    roles: {
      '2種': {
        dankai: [
          { ijou: 50000, rate: 0.5 },
          { ijou: 30000, rate: 0.4 },
        ],
      },
    },
  };
  it('売上 40,000 は 30,000 以上の 段 40% ⇒ 4,750 × 0.4 × 8 ＝ 15,200', () => {
    expect(R(kyuryo(dk))).toBe(15200);
  });
  it('人ごとの 率（30%）が 打って あれば 人が 勝つ ⇒ 11,400', () => {
    expect(R(kyuryo(dk, 0.3))).toBe(11400);
  });
  it('境目の ちょうど（40,000 以上の 段）は その 段に 入る', () => {
    const x = { roles: { '2種': { dankai: [{ ijou: 40000, rate: 0.4 }] } } };
    expect(R(kyuryo(x))).toBe(15200);
    const y = { roles: { '2種': { dankai: [{ ijou: 40001, rate: 0.4 }] } } };
    expect(R(kyuryo(y)), '1円 足りない ⇒ 元の 35%').toBe(13300);
  });
});

describe('★指定日の 割増★', () => {
  const w = (mode) => ({ wariMode: mode, wariHi: { [HI]: { mult: 1.25, label: '大晦日' } } });
  it('歩合に 掛ける（既定）：13,300 × 1.25 ＝ 16,625', () => {
    expect(R(kyuryo(w()))).toBe(16625);
  });
  it('保証が 勝つ 日：歩合だけ（保証 9,200 の まま）／日の 給料 全体（9,200 × 1.25 ＝ 11,500）', () => {
    expect(R(kyuryo(w('buai'), 0.1))).toBe(9200);
    expect(R(kyuryo(w('zentai'), 0.1))).toBe(11500);
  });
});

describe('★設定の 形が 壊れていても 落ちない★', () => {
  it('段階の 0・負・文字 は 捨てる／日付で ない 割増は 捨てる', () => {
    const x = {
      roles: {
        '2種': {
          dankai: [
            { ijou: 0, rate: 0.9 },
            { ijou: 'あ', rate: 0.9 },
          ],
          nikkyu: 'x',
        },
      },
      wariHi: { あした: { mult: 3 }, [HI]: { mult: -1 } },
    };
    expect(R(kyuryo(x))).toBe(13300);
  });
});

// ★★倉庫の 行（pay_extra）→ 1日の 給料 まで 通す★★（配線が 抜けると 画面で 決めても 給料が 変わらない）
//   わざと壊す（10-06 実測）：payroll-daily.js の normSettings で pay_extra を 渡さない ⇒ ★赤★
describe('★倉庫の 行から 日の 給料 まで★', () => {
  globalThis.DaikoPayroll = P;
  globalThis.UriageAgg = require('../../js/uriage-agg.js');
  const PD = require('../../js/payroll-daily.js');
  function hi(pay_extra) {
    const ctx = PD.buildCtx({
      payrollSettings: {
        roles: { '2種': { rate: 0.35, floor: 1150 } },
        pay_extra: pay_extra,
      },
      shifts: [
        {
          shift_id: 's1',
          device_id: 'A',
          started_at: '2026-10-03T11:00:00Z',
          elapsed_sec: 28800,
          fare_total_yen: 40000,
          trip_count: 4,
          actual_total_m: 20000,
          total_distance_m: 50000,
        },
      ],
      edits: [],
      labels: [{ device_id: 'A', label: '4987' }],
      employees: [{ employee_id: 'e1', name: '甲', role: '2種', active: true }],
      workHours: [{ work_date: '2026-10-03', employee_id: 'e1', device_id: 'A', hours: 8 }],
      manualDays: [],
    });
    return PD.computeDay('2026-10-03', ctx).staff[0].pay;
  }
  it('決めていなければ 13,300', () => {
    expect(R(hi(null))).toBe(13300);
  });
  it('倉庫の pay_extra の 回数歩合（300円×4回）が 効いて 14,500', () => {
    expect(R(hi({ kaisu: 300 }))).toBe(14500);
  });
  it('手で 入れた 日の 距離も 距離歩合に 入る（1km 20円 × 20km）', () => {
    const ctx = PD.buildCtx({
      payrollSettings: {
        roles: { '2種': { rate: 0.35, floor: 1150 } },
        pay_extra: { kyori: 20 },
      },
      shifts: [],
      edits: [],
      labels: [{ device_id: 'A', label: '4987' }],
      employees: [{ employee_id: 'e1', name: '甲', role: '2種', active: true }],
      workHours: [{ work_date: '2026-10-03', employee_id: 'e1', device_id: 'A', hours: 8 }],
      manualDays: [
        {
          work_date: '2026-10-03',
          device_id: 'A',
          sales_yen: 40000,
          hours: 8,
          actual_total_m: 20000,
        },
      ],
    });
    expect(R(PD.computeDay('2026-10-03', ctx).staff[0].pay)).toBe(13700);
  });
});

// ★★10-06 司さん「回数距離は1台としてやろが」★★
//   1台の 額（回数 × 1回いくら ＋ km × 1kmいくら）を 1回だけ 出し、乗った 人で 分ける
//   例：4回 × 300円 ＝ 1,200円／2種 35%・1種 30% ⇒ 役の 率の 比：1,200 × 35/65 ＝ 646.15・1,200 × 30/65 ＝ 553.85
describe('★1台の 回数・距離の 額を 乗った 2人で 分ける★', () => {
  function futari(extra) {
    const st = {
      roles: { '2種': { rate: 0.35, floor: 0 }, '1種': { rate: 0.3, floor: 0 } },
      extra: extra,
    };
    const r = P.compute(
      {
        date: HI,
        cars: [{ id: 'A', sales: 0, expense: 0, hours: 8 }],
        owner: {},
        staff: [
          { name: '甲', role: '2種', hours: 8, car: 'A' },
          { name: '乙', role: '1種', hours: 8, car: 'A' },
        ],
        tripsByCar: { A: { trips: 4, jissha_m: 0, sou_m: 0 } },
        crewByCar: { A: ['2種', '1種'] },
      },
      st
    );
    return r.staff.map((x) => R(x.kasan));
  }
  it('役の 率の 比（既定）：646.15 ＋ 553.85 ＝ 1,200（1台の 額が 2回 出ない）', () => {
    const k = futari({ kaisu: 300 });
    expect(k).toEqual([646.15, 553.85]);
    expect(R(k[0] + k[1]), '★1台の 額が 2倍に なっている★').toBe(1200);
  });
  it('人数で 等分：600 ＋ 600', () => {
    expect(futari({ kaisu: 300, bunpai: 'touwari' })).toEqual([600, 600]);
  });
  it('本人の 画面（相方の 行が 無い）でも crew が 在れば 同じ 額', () => {
    const st = {
      roles: { '2種': { rate: 0.35, floor: 0 }, '1種': { rate: 0.3, floor: 0 } },
      extra: { kaisu: 300 },
    };
    const r = P.compute(
      {
        date: HI,
        cars: [{ id: 'A', sales: 0, expense: 0, hours: 8 }],
        owner: {},
        staff: [{ name: '乙', role: '1種', hours: 8, car: 'A' }],
        tripsByCar: { A: { trips: 4 } },
        crewByCar: { A: ['2種', '1種'] },
      },
      st
    );
    expect(R(r.staff[0].kasan)).toBe(553.85);
  });
});

// ★★給料の 画面が 走った 記録の 距離を 取っている★★ 2026-10-06（対立役：事務所と 紙は 距離を 取らず 1km いくら が 0円＝本人の 画面と ずれた）
//   画面を 開く 試験は 作り物の 倉庫が 頼まれていない 列まで 返すので 見つけられない ⇒ 頼む 字そのものを 見る
//   わざと壊す（10-06 実測）：kyuryo.html の 2か所の どちらかから actual_total_m を 消す ⇒ ★赤★
describe('★給料の 画面は 走った 記録の 回数と 距離を 頼む★', () => {
  const fs = require('fs');
  const path = require('path');
  const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'kyuryo.html'), 'utf8');
  it('dk_shifts を 頼む 所 全部に trip_count・actual_total_m・total_distance_m が 在る', () => {
    const tanomi = HTML.match(/'dk_shifts\?select=[^']*'/g) || [];
    expect(tanomi.length, '★dk_shifts を 頼む 所が 見つからない★').toBeGreaterThanOrEqual(2);
    tanomi.forEach((t) => {
      ['trip_count', 'actual_total_m', 'total_distance_m'].forEach((k) => {
        expect(t, '★' + t + ' に ' + k + ' が 無い★').toContain(k);
      });
    });
  });
});
