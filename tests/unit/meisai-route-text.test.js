// ============================================================
// ★請求書の行き先を、司さんの手入力と同じ形にする★ 2026-08-09
//
//   ★司さんの言葉★
//     「おれの手入力と同じようにやれよ、話し合って今治市は除けて町までつけるって
//       ゆうたろが、市外だけ松山市とかつけるって」
//
//   ★今どうなっていたか★
//     supabase/functions/dk-sync-jobs/meisai-row.js
//         destination: String(t.end_address || '')   ← ★到着地だけ★
//     ダイコメは 出発地・経由地・到着地 の3つを送っているのに、
//     受け取る側が到着地しか使っていなかった。
//     8/7 が「たかと〜東鳥生〜東門」なのは★司さんが手で書いた★から。
//     8/8 の「西条市実報寺」は機械が作った分。
//
//   ★決めた形★
//     ・出発地〜経由地〜到着地 を「〜」でつなぐ
//     ・★地元の市（今治市）は市名を落として 町名だけ★
//     ・★市外だけ 市名を付ける（松山市○○）★
//     ・同じ所が続く時はまとめる／空はとばす
//     ・★取れなかった所は、あるものだけでつなぐ（勝手に埋めない）★
// ============================================================
import * as R from '../../supabase/functions/dk-sync-jobs/meisai-row.js';

const HOME = '今治市';

describe('★地元の市は落とす／市外は付ける★', () => {
  it('地元の市は 市名を落として 町名だけ', () => {
    expect(R.placeText('今治市常盤町', HOME)).toBe('常盤町');
    expect(R.placeText('今治市松本町', HOME)).toBe('松本町');
  });

  it('★市外は 市名を付けたまま★', () => {
    expect(R.placeText('松山市道後町', HOME)).toBe('松山市道後町');
    expect(R.placeText('西条市実報寺', HOME)).toBe('西条市実報寺');
  });

  it('地元だが町名が取れていない時は そのまま（「付近」だけにしない）', () => {
    expect(R.placeText('今治市 付近', HOME)).toBe('今治市 付近');
    expect(R.placeText('今治市', HOME)).toBe('今治市');
  });

  it('空・こわれた値は 空にする（落ちない）', () => {
    expect(R.placeText('', HOME)).toBe('');
    expect(R.placeText(null, HOME)).toBe('');
    expect(R.placeText(undefined, HOME)).toBe('');
  });
});

describe('★出発〜経由〜到着をつなぐ★', () => {
  const trip = (o) => Object.assign({ start_address: '', end_address: '', waypoints: [] }, o);

  it('出発と到着だけ', () => {
    expect(
      R.routeText(trip({ start_address: '今治市大西', end_address: '今治市小泉' }), HOME)
    ).toBe('大西〜小泉');
  });

  it('★経由地も入る（司さんの手入力と同じ形）★', () => {
    const t = trip({
      start_address: '今治市たかと',
      end_address: '今治市東門町',
      waypoints: [{ address: '今治市東鳥生町' }],
    });
    expect(R.routeText(t, HOME)).toBe('たかと〜東鳥生町〜東門町');
  });

  it('★市外が混ざる時は そこだけ市名が付く★', () => {
    const t = trip({ start_address: '今治市松本町', end_address: '松山市道後町' });
    expect(R.routeText(t, HOME)).toBe('松本町〜松山市道後町');
  });

  it('出発が取れていない時は 到着だけ（今までと同じ）', () => {
    expect(R.routeText(trip({ end_address: '西条市実報寺' }), HOME)).toBe('西条市実報寺');
  });

  it('同じ所が続く時は まとめる', () => {
    const t = trip({
      start_address: '今治市常盤町',
      end_address: '今治市常盤町',
      waypoints: [{ address: '今治市常盤町' }],
    });
    expect(R.routeText(t, HOME)).toBe('常盤町');
  });

  it('全部空なら 空（勝手に埋めない）', () => {
    expect(R.routeText(trip({}), HOME)).toBe('');
  });
});

describe('★明細の行に入る形★', () => {
  it('destination が つないだ形になり、出発地は今までどおり extra にも残る', () => {
    const rows = R.buildMeisaiRows({
      ownerId: 'u1',
      deviceId: 'd1',
      shiftStartMs: Date.UTC(2026, 7, 8, 10, 0),
      homeCity: HOME,
      trips: [
        {
          seq: 1,
          payment_type: 'invoice',
          customer_name: '株式会社 生野組',
          start_address: '今治市大西',
          end_address: '西条市実報寺',
          waypoints: [],
          fare_yen: 4300,
          distance_m: 5362,
        },
      ],
      done: new Set(),
    });
    expect(rows.length).toBe(1);
    expect(rows[0].destination, '★つないだ形になっていない★').toBe('大西〜西条市実報寺');
    expect(rows[0].extra.dk_from, '出発地が残っていない').toBe('今治市大西');
    expect(rows[0].distance).toBe(5.36);
  });

  it('★地元の市を渡さなくても 既定の「今治市」で落とす★（ZERO代行はここが地元）', () => {
    const rows = R.buildMeisaiRows({
      ownerId: 'u1',
      deviceId: 'd1',
      shiftStartMs: Date.UTC(2026, 7, 8, 10, 0),
      trips: [
        {
          seq: 1,
          payment_type: 'invoice',
          customer_name: 'A',
          start_address: '今治市大西',
          end_address: '今治市小泉',
          waypoints: [],
        },
      ],
      done: new Set(),
    });
    expect(rows[0].destination, '★既定の地元(今治市)が効いていない★').toBe('大西〜小泉');
  });
});
