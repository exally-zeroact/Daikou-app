// ============================================================
// ★請求書アプリへの自動投入が本当に入ること★ 2026-08-05
//
//   ★何が起きたか（司さん「①やれっていよろがぼけなんのために作ったんだ」）★
//     自動投入の flag を立てた。関数は 200 を返した。★なのに1件も入らなかった。★
//     理由: distance に 5.4 を入れていたが、請求書アプリの distance は★整数の列★。
//           Postgres が弾き、Edge Function の catch が握り潰していた。
//     ＝★作った時から一度も動いたことがなかった。立てるまで誰も気づけなかった。★
//
//   ★なぜテストが無かったか★
//     行を作る所が Edge Function の中に埋まっていて、外から触れなかった。
//     ⇒ meisai-row.js に出して、★本物のDBの列の型★と突き合わせる。
//
//   ★列の型は実測（本番 tnfwipbgfgjaymlszeid・2026-08-05）★
//     amount integer / distance integer / people integer / date date / extra jsonb
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  MEISAI_COLUMNS,
  buildMeisaiRows,
  businessDate,
  refOf,
  planMeisaiWrite,
} from '../../supabase/functions/dk-sync-jobs/meisai-row.js';

const OWNER = '9607d66a-e756-4fcd-9920-511d870fa28d';
const DEV = 'f3527369-9df3-47c4-93a8-b6e532a4ce92';

// 司さんの実データそのまま（8/3・8/4 の請求書払い）
const REAL = [
  {
    seq: 1,
    distance_m: 5362,
    fare_yen: 2200,
    payment_type: 'invoice',
    customer_name: 'Lounge Chouchou',
    start_address: '今治市富田新港',
    end_address: '今治市北浜町',
  },
  {
    seq: 5,
    distance_m: 2134,
    fare_yen: 1400,
    payment_type: 'invoice',
    customer_name: 'エスプリ アマン',
    start_address: '今治市旭町',
    end_address: '今治市東鳥生町',
  },
];
const build = (trips, opts) =>
  buildMeisaiRows({
    ownerId: OWNER,
    deviceId: DEV,
    shiftStartMs: 1785835513046,
    trips,
    ...(opts || {}),
  });

// ★これが本丸★ 列の型と、作った値が合っているか
function checkAgainstSchema(row) {
  const bad = [];
  Object.keys(row).forEach((col) => {
    const type = MEISAI_COLUMNS[col];
    const v = row[col];
    if (!type) return bad.push(col + ': ★請求書アプリに無い列★');
    if (v === null) return;
    if (type === 'integer' && !Number.isInteger(v))
      bad.push(col + ': 整数の列に ' + JSON.stringify(v));
    // ★小数2桁の列（距離）★ 3桁以上入れると DB 側で丸められて画面とズレる
    if (type === 'numeric2') {
      if (typeof v !== 'number' || !isFinite(v)) bad.push(col + ': 数でない ' + JSON.stringify(v));
      else if (Math.round(v * 100) !== v * 100)
        bad.push(col + ': 小数が2桁を超える ' + JSON.stringify(v));
    }
    if (type === 'text' && typeof v !== 'string')
      bad.push(col + ': 文字の列に ' + JSON.stringify(v));
    if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v)))
      bad.push(col + ': 日付の形でない ' + JSON.stringify(v));
    if (type === 'jsonb' && (typeof v !== 'object' || Array.isArray(v)))
      bad.push(col + ': jsonb でない');
    if (type === 'uuid' && !/^[0-9a-f-]{36}$/i.test(String(v))) bad.push(col + ': uuid でない');
  });
  return bad;
}

describe('★請求書アプリの列に、そのまま入る値になっていること★', () => {
  it('司さんの実データ2件が、列の型と全部合う', () => {
    build(REAL).forEach((r) => expect(checkAgainstSchema(r), JSON.stringify(r)).toEqual([]));
  });

  // ============================================================
  // ★距離は実測どおり出す★ 2026-08-05
  //   司さん「5.36kmなら5.36kmってだせやぼけ なんで切り上げしとんど ごまかさすな」
  //   請求書アプリの distance が integer だったので 5.36km が「5km」になっていた。
  //   → 列を numeric(8,2) に広げ、メーターの画面と同じ小数2桁で入れる。
  // ============================================================
  it('★5.36km なら 5.36km と出る★（丸めてごまかさない）', () => {
    const rows = build([
      { seq: 1, distance_m: 5362, fare_yen: 2000, payment_type: 'invoice', customer_name: 'A' },
    ]);
    expect(rows[0].distance, '★丸めて 5km にしている★').toBe(5.36);
  });

  it('★司さんの実データが、メーターの画面と同じ数字になる★', () => {
    // 実測値そのまま（メーターは (m/1000).toFixed(2) で出している）
    [
      [5356.50464367155, 5.36],
      [5316.66953670697, 5.32],
      [2129.60241742354, 2.13],
    ].forEach(([m, km]) => {
      const rows = build([
        { seq: 1, distance_m: m, fare_yen: 2000, payment_type: 'invoice', customer_name: 'A' },
      ]);
      expect(rows[0].distance, m + 'm').toBe(km);
      expect(rows[0].distance, '★メーターの画面と数字が違う★').toBe(Number((m / 1000).toFixed(2)));
    });
  });

  it('★切り上げも切り捨てもしない★', () => {
    const at = (m) =>
      build([
        { seq: 1, distance_m: m, fare_yen: 2000, payment_type: 'invoice', customer_name: 'A' },
      ])[0].distance;
    expect(at(5999), '★切り上げている★').toBe(6);
    expect(at(5004), '★切り上げている★').toBe(5);
    expect(at(4)).toBe(0);
    expect(at(0)).toBe(0);
    // ★ちょうど半分(5005m=5.005km)の扱いは、メーターに合わせる★
    //   メーターは (m/1000).toFixed(2) で「5.00」と出す。請求書だけ 5.01 にはしない。
    //   (2進数では 5.005 がわずかに小さいため。理屈より★画面と一致すること★を採る)
    expect(at(5005), '★メーターは 5.00 と出しているのにズレている★').toBe(5);
    // ★丸め方の違いで実際にズレていた例★
    expect(at(3425), '★メーターは 3.42 と出しているのにズレている★').toBe(3.42);
  });

  it('★どんな距離でもメーターの画面と一致する★（1件も食い違わせない）', () => {
    for (let m = 0; m <= 60000; m += 137) {
      const rows = build([
        { seq: 1, distance_m: m, fare_yen: 2000, payment_type: 'invoice', customer_name: 'A' },
      ]);
      expect(rows[0].distance, m + 'm で ' + rows[0].distance).toBe(Number((m / 1000).toFixed(2)));
      // DB は小数2桁までしか持てない。3桁以上を入れると黙って丸められて画面とズレる。
      //   (0.14*100 が 14.000000000000002 になる浮動小数のクセがあるので、
      //    掛け算で比べず「2桁に丸めた文字」と一致するかで見る)
      expect(rows[0].distance.toFixed(2), m + 'm で桁あふれ').toBe(
        String(rows[0].distance.toFixed(2))
      );
      expect(Number(rows[0].distance.toFixed(2)), m + 'm で桁あふれ').toBe(rows[0].distance);
    }
  });

  it('料金も整数（小数の料金が来ても落ちない）', () => {
    const rows = build([
      { seq: 1, distance_m: 5000, fare_yen: 2200.4, payment_type: 'invoice', customer_name: 'A' },
    ]);
    expect(Number.isInteger(rows[0].amount)).toBe(true);
    expect(rows[0].amount).toBe(2200);
  });

  it('★丸めて消える距離は extra に実測mで残る★（請求書アプリの表は変えない）', () => {
    const rows = build(REAL);
    expect(rows[0].extra.dk_distance_m).toBe(5362);
    expect(rows[1].extra.dk_distance_m).toBe(2134);
  });
});

describe('★入れる中身が正しいこと★', () => {
  it('請求先・行き先・出発地・料金がそのまま', () => {
    const [a] = build(REAL);
    expect(a.company).toBe('Lounge Chouchou'); // companies.name と同じ文字列
    // ★2026-08-09 仕様変更★: 行き先は 到着地だけ → ★出発〜経由〜到着★ に。
    //   司さん「今治市は除けて町までつける、市外だけ松山市とかつける」
    //   ＝ 地元(今治市)は市名を落とす。出発地は今までどおり extra にも残る。
    expect(a.destination).toBe('富田新港〜北浜町');
    expect(a.extra.dk_from).toBe('今治市富田新港');
    expect(a.amount).toBe(2200); // ★メーター確定の料金をいじらない★
  });

  it('★日付は業務開始の日（日本時間）★＝同じ晩は同じ日付', () => {
    // 8/4 15:44 開始の勤務。日をまたいだ代行も同じ 8/4 になること
    expect(businessDate(1785835513046)).toBe('2026-08-04');
    build(REAL).forEach((r) => expect(r.date).toBe('2026-08-04'));
  });

  it('日本時間の朝（UTCだと前日）でもずれない', () => {
    expect(businessDate(Date.UTC(2026, 7, 5, 0, 30))).toBe('2026-08-05'); // 日本 9:30
    expect(businessDate(Date.UTC(2026, 7, 4, 15, 30))).toBe('2026-08-05'); // 日本 0:30
  });
});

describe('★入れてはいけない物を入れないこと★', () => {
  it('現金の代行は入れない', () => {
    expect(
      build([
        { seq: 1, distance_m: 5000, fare_yen: 2000, payment_type: 'cash', customer_name: 'A' },
      ])
    ).toEqual([]);
  });

  it('請求先が決まっていない代行は入れない', () => {
    expect(
      build([
        { seq: 1, distance_m: 5000, fare_yen: 2000, payment_type: 'invoice', customer_name: '' },
      ])
    ).toEqual([]);
  });

  it('★既に入っている物は二度入れない★（司さんの手入力と二重にしない）', () => {
    const done = new Set([refOf(DEV, 1785835513046, 1)]);
    const rows = build(REAL, { done });
    expect(rows.length).toBe(1);
    expect(rows[0].extra.dk_ref).toBe(refOf(DEV, 1785835513046, 5));
  });

  it('鍵は送り直しでも変わらない（端末:勤務開始:何件目）', () => {
    const a = build(REAL)[0].extra.dk_ref;
    const b = build(REAL)[0].extra.dk_ref;
    expect(a).toBe(b);
    expect(a).toBe(DEV + ':1785835513046:1');
  });

  it('業務開始が読めない時は1件も作らない', () => {
    expect(
      buildMeisaiRows({ ownerId: OWNER, deviceId: DEV, shiftStartMs: 0, trips: REAL })
    ).toEqual([]);
    expect(
      buildMeisaiRows({ ownerId: OWNER, deviceId: DEV, shiftStartMs: NaN, trips: REAL })
    ).toEqual([]);
  });

  it('壊れた入力でも落ちない', () => {
    expect(() => buildMeisaiRows({})).not.toThrow();
    expect(() => buildMeisaiRows({ trips: [null, undefined, {}] })).not.toThrow();
  });
});

// ============================================================
// ★あとから直した代行が、請求書アプリにも届くこと★ 2026-08-05
//
//   司さん「その業務押したら追加料金や値引きや請求書などちゃんと編集できな」
//   メーターで直すと業務が送り直される。ところが★既に入っている行は飛ばす★
//   作りだったので、請求書アプリだけ古い金額のまま残っていた。
// ============================================================
describe('★直した代行が請求書アプリにも届くこと★', () => {
  const REF = DEV + ':1785835513046:1';
  const rows = () => build([REAL[0]]); // 2200円 / 5km

  const existing = (over) =>
    Object.assign(
      {
        id: 'row-1',
        extra: { dk_ref: REF, dk_source: 'daikome', dk_distance_m: 5362 },
        company: 'Lounge Chouchou',
        date: '2026-08-04',
        // ★2026-08-09: 行き先は つないだ形（地元の市は落とす）★
        destination: '富田新港〜北浜町',
        amount: 2200,
        distance: 5.36,
      },
      over || {}
    );

  it('まだ無ければ入れる', () => {
    const p = planMeisaiWrite(rows(), []);
    expect(p.inserts.length).toBe(1);
    expect(p.updates.length).toBe(0);
  });

  it('★同じ中身なら何もしない★（無駄に書かない）', () => {
    const p = planMeisaiWrite(rows(), [existing()]);
    expect(p.inserts.length).toBe(0);
    expect(p.updates.length, '変わっていないのに書き込んでいる').toBe(0);
  });

  it('★DBが返す "5.36"（文字）でも「変わった」と見ない★', () => {
    // Supabase は numeric を文字で返す。文字くらべだと毎回書き込んでしまう。
    const p = planMeisaiWrite(rows(), [existing({ distance: '5.36', amount: '2200' })]);
    expect(p.updates.length, '★送るたびに毎回書き込んでいる★').toBe(0);
  });

  it('★"5.30" と 5.3 も同じと見る★（末尾の0で毎回書き込まない）', () => {
    const r = build([
      {
        seq: 1,
        distance_m: 5300,
        fare_yen: 2200,
        payment_type: 'invoice',
        customer_name: 'Lounge Chouchou',
        // ★2026-08-09: 行き先が つないだ形になったので、比べる相手と同じ道のりにする★
        //   （このテストが見ているのは 数の比べ方であって 行き先ではない）
        start_address: '今治市富田新港',
        end_address: '今治市北浜町',
      },
    ]);
    expect(r[0].distance).toBe(5.3);
    const cur = existing({ distance: '5.30' });
    cur.extra = { dk_ref: REF, dk_source: 'daikome', dk_distance_m: 5300 };
    const p = planMeisaiWrite(r, [cur]);
    expect(p.updates.length, '★5.30 と 5.3 を別物と見ている★').toBe(0);
  });

  it('本当に距離が変わったら直す', () => {
    const p = planMeisaiWrite(rows(), [existing({ distance: '9.99' })]);
    expect(p.updates[0].patch.distance).toBe(5.36);
  });

  it('★値引きして金額が変わったら直す★', () => {
    const p = planMeisaiWrite(rows(), [existing({ amount: 9999 })]);
    expect(p.inserts.length).toBe(0);
    expect(p.updates.length).toBe(1);
    expect(p.updates[0].id).toBe('row-1');
    expect(p.updates[0].patch.amount, '★古い金額のまま残る★').toBe(2200);
  });

  it('★請求先を付け替えたら直す★', () => {
    const p = planMeisaiWrite(rows(), [existing({ company: 'よその会社' })]);
    expect(p.updates[0].patch.company).toBe('Lounge Chouchou');
  });

  it('★司さんが後から書いた 備考・人数・名前 は絶対に触らない★', () => {
    const p = planMeisaiWrite(rows(), [existing({ amount: 9999 })]);
    const patch = p.updates[0].patch;
    ['note', 'people', 'name'].forEach((c) => {
      expect(Object.prototype.hasOwnProperty.call(patch, c), '★' + c + ' を書き換えている★').toBe(
        false
      );
    });
  });

  it('★変わった列だけ直す★（全部上書きしない）', () => {
    const p = planMeisaiWrite(rows(), [existing({ amount: 9999 })]);
    expect(Object.keys(p.updates[0].patch).sort()).toEqual(['amount']);
  });

  it('正確な距離が変わったら extra も直す（他の自由項目は残す）', () => {
    const cur = existing();
    cur.extra = { dk_ref: REF, dk_source: 'daikome', dk_distance_m: 1, dk_from: '今治市富田新港' };
    const p = planMeisaiWrite(rows(), [cur]);
    expect(p.updates[0].patch.extra.dk_distance_m).toBe(5362);
    expect(p.updates[0].patch.extra.dk_from, '★自由項目を消している★').toBe('今治市富田新港');
  });

  it('よその代行の行に手を出さない', () => {
    const p = planMeisaiWrite(rows(), [existing({ id: 'x', extra: { dk_ref: 'よそ:1:1' } })]);
    expect(p.inserts.length).toBe(1);
    expect(p.updates.length).toBe(0);
  });

  it('壊れた入力でも落ちない', () => {
    expect(() => planMeisaiWrite(null, null)).not.toThrow();
    expect(() => planMeisaiWrite(rows(), [null, {}, { extra: null }])).not.toThrow();
  });
});

// ============================================================
// ★無い列に書きに行かないこと★ 2026-08-05
//
//   ★同じ穴を2回踏んだ★
//     1回目: meisai.distance が整数なのに 5.4 を入れて★1件も入らなかった★
//     2回目: dk_trips に customer_note が無いのに書きに行き、
//            ★勤務ごと受け取られず accepted:[] ＝実績が丸ごと上がらなくなった★
//            （本番に入れていたら全端末の実績が止まっていた）
//   ⇒ 関数が書きに行く列を、実測した列の表と突き合わせる。
// ============================================================
describe('★倉庫に無い列へ書きに行かないこと★', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'supabase', 'functions', 'dk-sync-jobs', 'index.ts'),
    'utf8'
  );
  const M = require('../../supabase/functions/dk-sync-jobs/meisai-row.js');

  it('★dk_trips に入れる列が、全部 実在する列★', () => {
    // .map((t, i) => ({ ... })) の中で dk_trips に入れる形を作っている
    const i = SRC.indexOf('shift_id: shiftRow.shift_id');
    expect(i, 'dk_trips に入れる所が見つからない').toBeGreaterThan(-1);
    const block = SRC.slice(i, SRC.indexOf("await sb.from('dk_trips').delete()", i));
    const keys = [];
    const re = /^\s{10}([a-z_]+):/gm;
    let m;
    while ((m = re.exec(block))) keys.push(m[1]);
    expect(keys.length, '列を1つも読み取れていない').toBeGreaterThan(5);
    const missing = keys.filter((k) => M.DK_TRIPS_COLUMNS.indexOf(k) < 0);
    expect(missing, '★倉庫に無い列へ書いている＝勤務ごと受け取られなくなる★').toEqual([]);
  });

  it('★「誰が乗ったか」の列が実在する★（無いと実績が丸ごと上がらない）', () => {
    expect(M.DK_TRIPS_COLUMNS, 'dk_trips に customer_note が無い').toContain('customer_note');
  });

  it('列の表が実物とずれていないこと（足したらここにも足す）', () => {
    // 実測(2026-08-05)。DBに列を足したのにここを直し忘れると、この本数で気づける。
    expect(M.DK_TRIPS_COLUMNS.length).toBe(16);
  });
});

describe('★立てても黙って落ちる、を二度とやらないこと★', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'supabase', 'functions', 'dk-sync-jobs', 'index.ts'),
    'utf8'
  );

  it('★入れられなかった理由を返している★（今回これが無くて原因が分からなかった）', () => {
    expect(SRC, '理由を返していない').toMatch(/return\s+'error:'/);
    expect(SRC, '入れた件数を返していない').toMatch(/return\s+'ok:'/);
    expect(SRC, '返事に meisai が入っていない').toContain('accepted, meisai');
  });

  it('★入れる時・直す時の失敗を捨てていない★', () => {
    expect(SRC, 'insert のエラーを受け取っていない').toContain(
      "const { error: iErr } = await sb.from('meisai').insert(plan.inserts)"
    );
    expect(SRC, '直す時のエラーを受け取っていない').toMatch(/const \{ error: uErr \}/);
    expect(SRC, '直した結果を返していない').toContain('件直した');
  });

  it('★行を作る所を関数の中に書き戻していない★（外に出ていないとテストできない）', () => {
    expect(SRC).toContain("from './meisai-row.js'");
    expect(SRC, '関数の中で行を組み立て直している').not.toMatch(/dk_source:\s*'daikome'/);
  });
});
