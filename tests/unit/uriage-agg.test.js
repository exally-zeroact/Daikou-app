'use strict';
// ============================================================
// 売上表の集計ロジック テスト (2026-08-01)
//
//   司さんの要件:
//     「売上表には車ごとに 件数、実車距離、総走行距離」
//     「高速や橋代などは手で入力」
//     「どの部分でもこちら側でも編集できる」
//
//   ★守る性質★
//     1. 車ごとに正しくまとまる（別の車の数字が混ざらない）
//     2. メーターが確定した数字はそのまま（勝手に丸めない・作らない）
//     3. 手入力（高速代など）は元データと分けて持ち、足すのは表示のときだけ
//     4. 何が来ても throw しない（画面が真っ白にならない）
//     5. ★距離は「代行1件ごと」が正。合計距離は実績表示であって精度の根拠にしない★
// ============================================================
const Agg = require('../../js/uriage-agg.js');

function shift(over) {
  return Object.assign(
    {
      shift_id: 's1',
      device_id: 'devA',
      started_at: '2026-08-01T10:00:00.000Z',
      total_distance_m: 12345.6,
      actual_total_m: 8000.4,
      fare_total_yen: 9800,
      trip_count: 2,
    },
    over || {}
  );
}

describe('車ごとにまとめる', () => {
  it('同じ車の勤務が1行にまとまる', () => {
    const rows = Agg.byDevice(
      [
        shift({ shift_id: 's1', device_id: 'devA', trip_count: 2, fare_total_yen: 1000 }),
        shift({ shift_id: 's2', device_id: 'devA', trip_count: 3, fare_total_yen: 2000 }),
      ],
      [],
      []
    );
    expect(rows.length).toBe(1);
    expect(rows[0].device_id).toBe('devA');
    expect(rows[0].trip_count).toBe(5);
    expect(rows[0].fare_total_yen).toBe(3000);
  });

  it('★別の車の数字が混ざらない★', () => {
    const rows = Agg.byDevice(
      [
        shift({ shift_id: 's1', device_id: 'devA', trip_count: 2 }),
        shift({ shift_id: 's2', device_id: 'devB', trip_count: 7 }),
      ],
      [],
      []
    );
    const a = rows.find((r) => r.device_id === 'devA');
    const b = rows.find((r) => r.device_id === 'devB');
    expect(a.trip_count).toBe(2);
    expect(b.trip_count).toBe(7);
  });

  it('実車距離と総走行距離をそれぞれ足す（取り違えない）', () => {
    const rows = Agg.byDevice(
      [
        shift({ shift_id: 's1', total_distance_m: 10000, actual_total_m: 6000 }),
        shift({ shift_id: 's2', total_distance_m: 5000, actual_total_m: 1000 }),
      ],
      [],
      []
    );
    expect(rows[0].total_distance_m).toBe(15000);
    expect(rows[0].actual_total_m).toBe(7000);
    // 空車 = 総走行 − 実車
    expect(rows[0].empty_distance_m).toBe(8000);
  });

  // ★2026-08-04 期待値を変えた★
  //   旧: 名前が無ければ端末IDの短縮（abcdefgh…）を出す
  //   新: ★「車1」「車2」★を出す
  //   理由: 司さん「売上1の横の英語のやつ邪魔でしょうがない」。
  //   短縮しても英語の羅列であることに変わりないので、短縮形も名前として認めない。
  it('車の名前が付いていれば使う・無ければ「車1」を出す（UUIDは出さない）', () => {
    const rows = Agg.byDevice(
      [shift({ device_id: 'abcdefgh12345678' })],
      [],
      [{ device_id: 'abcdefgh12345678', label: '1号車' }]
    );
    expect(rows[0].label).toBe('1号車');

    const rows2 = Agg.byDevice([shift({ device_id: 'abcdefgh12345678' })], [], []);
    expect(rows2[0].label, '★端末IDが画面に出ている★').toBe('車1');
    expect(rows2[0].label).not.toMatch(/^[0-9a-f]{8}/);
  });

  it('★名前が無い車が複数あっても、それぞれ違う名前になる★', () => {
    const rows = Agg.byDevice(
      [shift({ device_id: 'aaaaaaaa11111111' }), shift({ device_id: 'bbbbbbbb22222222' })],
      [],
      []
    );
    const names = rows.map((r) => r.label).sort();
    expect(names).toEqual(['車1', '車2']);
  });
});

describe('★売上は実費を引いた分（司さん指示 2026-08-01）★', () => {
  it('既定は 高速代と橋代を引く（その他は引かない）', () => {
    const rows = Agg.byDevice(
      [shift({ shift_id: 's1', fare_total_yen: 50000 })],
      [{ shift_id: 's1', toll_yen: 3000, bridge_yen: 1000, other_yen: 500 }],
      []
    );
    expect(rows[0].fare_total_yen).toBe(50000); // 総額はそのまま持つ
    expect(rows[0].deduct_yen).toBe(4000); // 高速+橋
    expect(rows[0].net_fare_yen).toBe(46000); // ★これが売上★
  });

  it('★会社ごとに引くものを選べる★（その他も引く設定）', () => {
    const rows = Agg.byDevice(
      [shift({ shift_id: 's1', fare_total_yen: 50000 })],
      [{ shift_id: 's1', toll_yen: 3000, bridge_yen: 1000, other_yen: 500 }],
      [],
      { deduct_toll: true, deduct_bridge: true, deduct_other: true }
    );
    expect(rows[0].deduct_yen).toBe(4500);
    expect(rows[0].net_fare_yen).toBe(45500);
  });

  it('何も引かない設定にもできる', () => {
    const rows = Agg.byDevice(
      [shift({ shift_id: 's1', fare_total_yen: 50000 })],
      [{ shift_id: 's1', toll_yen: 3000, bridge_yen: 1000, other_yen: 500 }],
      [],
      { deduct_toll: false, deduct_bridge: false, deduct_other: false }
    );
    expect(rows[0].deduct_yen).toBe(0);
    expect(rows[0].net_fare_yen).toBe(50000);
  });

  it('高速だけ引く設定', () => {
    const rows = Agg.byDevice(
      [shift({ shift_id: 's1', fare_total_yen: 50000 })],
      [{ shift_id: 's1', toll_yen: 3000, bridge_yen: 1000, other_yen: 500 }],
      [],
      { deduct_toll: true, deduct_bridge: false, deduct_other: false }
    );
    expect(rows[0].deduct_yen).toBe(3000);
    expect(rows[0].net_fare_yen).toBe(47000);
  });

  it('設定が壊れていても落ちない（既定に倒す）', () => {
    expect(() =>
      Agg.byDevice([shift({ shift_id: 's1' })], [{ shift_id: 's1', toll_yen: 100 }], [], 'x')
    ).not.toThrow();
    const rows = Agg.byDevice(
      [shift({ shift_id: 's1', fare_total_yen: 1000 })],
      [{ shift_id: 's1', toll_yen: 100 }],
      [],
      null
    );
    expect(rows[0].net_fare_yen).toBe(900); // 既定=高速を引く
  });

  it('合計にも差引後が出る', () => {
    const rows = Agg.byDevice(
      [
        shift({ shift_id: 's1', device_id: 'devA', fare_total_yen: 10000 }),
        shift({ shift_id: 's2', device_id: 'devB', fare_total_yen: 20000 }),
      ],
      [
        { shift_id: 's1', toll_yen: 1000 },
        { shift_id: 's2', bridge_yen: 2000 },
      ],
      []
    );
    const t = Agg.total(rows);
    expect(t.fare_total_yen).toBe(30000);
    expect(t.deduct_yen).toBe(3000);
    expect(t.net_fare_yen).toBe(27000);
  });
});

describe('手入力（高速代など）の扱い', () => {
  it('勤務に紐づく手入力が車ごとに合算される', () => {
    const rows = Agg.byDevice(
      [shift({ shift_id: 's1' }), shift({ shift_id: 's2' })],
      [
        { shift_id: 's1', toll_yen: 1200, bridge_yen: 300, other_yen: 0 },
        { shift_id: 's2', toll_yen: 800, bridge_yen: 0, other_yen: 500 },
      ],
      []
    );
    expect(rows[0].toll_yen).toBe(2000);
    expect(rows[0].bridge_yen).toBe(300);
    expect(rows[0].other_yen).toBe(500);
    expect(rows[0].expense_yen).toBe(2800); // 高速+橋+その他
  });

  it('★手入力は売上に混ぜない（別の数字として持つ）★', () => {
    const rows = Agg.byDevice(
      [shift({ shift_id: 's1', fare_total_yen: 9800 })],
      [{ shift_id: 's1', toll_yen: 1200 }],
      []
    );
    expect(rows[0].fare_total_yen).toBe(9800); // 売上は変わらない
    expect(rows[0].toll_yen).toBe(1200);
  });

  it('手入力がまだ無い勤務は 0 として扱う', () => {
    const rows = Agg.byDevice([shift({ shift_id: 's1' })], [], []);
    expect(rows[0].toll_yen).toBe(0);
    expect(rows[0].expense_yen).toBe(0);
  });

  it('壊れた手入力（数値でない）は 0 に倒す', () => {
    const rows = Agg.byDevice(
      [shift({ shift_id: 's1' })],
      [{ shift_id: 's1', toll_yen: 'あ', bridge_yen: null, other_yen: undefined }],
      []
    );
    expect(rows[0].expense_yen).toBe(0);
  });
});

describe('壊れたデータでも止まらない', () => {
  it('★何が来ても throw しない★', () => {
    expect(() => Agg.byDevice(null, null, null)).not.toThrow();
    expect(() => Agg.byDevice('x', 'y', 'z')).not.toThrow();
    expect(() => Agg.byDevice([null, undefined, 'x'], [null], [null])).not.toThrow();
    expect(Agg.byDevice(null, null, null)).toEqual([]);
  });

  it('車が分からない勤務は捨てる（どの車か分からない数字を出さない）', () => {
    const rows = Agg.byDevice(
      [shift({ device_id: '' }), shift({ device_id: null }), shift({ device_id: 'devA' })],
      [],
      []
    );
    expect(rows.length).toBe(1);
    expect(rows[0].device_id).toBe('devA');
  });

  it('数値でない距離・件数は 0 として扱う（NaN を画面に出さない）', () => {
    const rows = Agg.byDevice(
      [shift({ total_distance_m: 'x', actual_total_m: null, trip_count: undefined })],
      [],
      []
    );
    expect(rows[0].total_distance_m).toBe(0);
    expect(rows[0].actual_total_m).toBe(0);
    expect(rows[0].trip_count).toBe(0);
    expect(Number.isNaN(rows[0].empty_distance_m)).toBe(false);
  });
});

describe('表示の形', () => {
  it('メートルを km（小数1桁）にする', () => {
    expect(Agg.km(12345.6)).toBe('12.3');
    expect(Agg.km(0)).toBe('0.0');
    expect(Agg.km('x')).toBe('0.0');
    expect(Agg.km(null)).toBe('0.0');
  });

  it('合計行を出す', () => {
    const rows = Agg.byDevice(
      [
        shift({ shift_id: 's1', device_id: 'devA', trip_count: 2, fare_total_yen: 1000 }),
        shift({ shift_id: 's2', device_id: 'devB', trip_count: 3, fare_total_yen: 2000 }),
      ],
      [{ shift_id: 's1', toll_yen: 500 }],
      []
    );
    const t = Agg.total(rows);
    expect(t.trip_count).toBe(5);
    expect(t.fare_total_yen).toBe(3000);
    expect(t.expense_yen).toBe(500);
  });

  it('合計は空でも落ちない', () => {
    expect(() => Agg.total(null)).not.toThrow();
    expect(Agg.total(null).trip_count).toBe(0);
  });
});
