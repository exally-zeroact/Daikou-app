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
    customer_name: 'Xalqal Alqalqal',
    start_address: '今治市富田新港',
    end_address: '今治市北浜町',
  },
  {
    seq: 5,
    distance_m: 2134,
    fare_yen: 1400,
    payment_type: 'invoice',
    customer_name: 'カレホン カレホ',
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

// ============================================================
// ★★わざと壊した 記録（2026-09-29 夕・自分で 1つずつ 戻して 測った）★★
//   壊す前 ………………………………………………… 赤 0 / 全 47
//   ① 直す輪を 途中で return に 戻す …… 赤 1 / 47
//   ② 事務所が 消した 行に 書くに 戻す … 赤 1 / 47
//   ③ deleted_at を 読まないに 戻す …… 赤 1 / 47
//   ④ 読めない時 何も 入れないに 戻す … 赤 2 / 47
//   ⑤ 印を 丸めないに 戻す …………… 赤 1 / 47
//   戻した後 ………………………………………………… 赤 0 / 全 47
//
//   ★②は はじめ 赤 0 だった★＝偽の緑。試していた 行が
//   印も 他の列も 揃っていて ★守りを 外しても 直されない 行★ だった。
//   「壊したのに 赤に ならない＝まず 壊れているか」で 見つけて 直した。
// ============================================================

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
    expect(a.company).toBe('Xalqal Alqalqal'); // companies.name と同じ文字列
    // ★2026-08-09 仕様変更★: 行き先は 到着地だけ → ★出発〜経由〜到着★ に。
    //   司さん「今治市は除けて町までつける、市外だけ松山市とかつける」
    //   ＝ 地元(今治市)は市名を落とす。出発地は今までどおり extra にも残る。
    expect(a.destination).toBe('富田新港〜北浜町');
    // ★2026-08-25 決まりが変わった（司さん）★ 出発地も 地元の市を落とす。
    //   前は 生の住所のままだったので 一覧で「今治市富田新港〜北浜町」と 出発地にだけ市が残っていた。
    expect(a.extra.dk_from).toBe('富田新港');
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
        // ★★2026-09-29 足した＝dk_meter_yen（その時 メーターが 出していた 額）★★
        //   これが 無いと 「事務所が 手で 直した」と 「メーターが 変わった」を
        //   見分けられない。今の行は 印つきなので amount = dk_meter_yen に 揃える。
        extra: { dk_ref: REF, dk_source: 'daikome', dk_distance_m: 5362, dk_meter_yen: 2200 },
        company: 'Xalqal Alqalqal',
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
        customer_name: 'Xalqal Alqalqal',
        // ★2026-08-09: 行き先が つないだ形になったので、比べる相手と同じ道のりにする★
        //   （このテストが見ているのは 数の比べ方であって 行き先ではない）
        start_address: '今治市富田新港',
        end_address: '今治市北浜町',
      },
    ]);
    expect(r[0].distance).toBe(5.3);
    const cur = existing({ distance: '5.30' });
    // ★印も 揃える＝「何も 変わっていない」状態に する (2026-09-29)
    cur.extra = { dk_ref: REF, dk_source: 'daikome', dk_distance_m: 5300, dk_meter_yen: 2200 };
    const p = planMeisaiWrite(r, [cur]);
    expect(p.updates.length, '★5.30 と 5.3 を別物と見ている★').toBe(0);
  });

  it('本当に距離が変わったら直す', () => {
    const p = planMeisaiWrite(rows(), [existing({ distance: '9.99' })]);
    expect(p.updates[0].patch.distance).toBe(5.36);
  });

  it('★メーターが 変わったら 金額を 直す★（値引きを 届ける）', () => {
    // ★印（dk_meter_yen）が 9999 ＝メーターは 9999 だった → 今 2200 に 変わった
    const p = planMeisaiWrite(rows(), [
      existing({
        amount: 9999,
        extra: { dk_ref: REF, dk_source: 'daikome', dk_distance_m: 5362, dk_meter_yen: 9999 },
      }),
    ]);
    expect(p.inserts.length).toBe(0);
    expect(p.updates.length).toBe(1);
    expect(p.updates[0].id).toBe('row-1');
    expect(p.updates[0].patch.amount, '★値引きが 事務所に 届かない★').toBe(2200);
    expect(p.updates[0].patch.extra.dk_meter_yen, '★印を 進めないと 毎回 直しに 行く★').toBe(2200);
  });

  it('★請求先を付け替えたら直す★', () => {
    const p = planMeisaiWrite(rows(), [existing({ company: 'よその会社' })]);
    expect(p.updates[0].patch.company).toBe('Xalqal Alqalqal');
  });

  it('★司さんが後から書いた 備考・人数・名前 は絶対に触らない★', () => {
    // ★印を ずらして 「直す側」に 回してから 見る（直さないと 空振りに なる）
    const p = planMeisaiWrite(rows(), [
      existing({
        amount: 9999,
        extra: { dk_ref: REF, dk_source: 'daikome', dk_distance_m: 5362, dk_meter_yen: 9999 },
      }),
    ]);
    const patch = p.updates[0].patch;
    ['note', 'people', 'name'].forEach((c) => {
      expect(Object.prototype.hasOwnProperty.call(patch, c), '★' + c + ' を書き換えている★').toBe(
        false
      );
    });
  });

  it('★変わった列だけ直す★（全部上書きしない）', () => {
    const p = planMeisaiWrite(rows(), [
      existing({
        amount: 9999,
        extra: { dk_ref: REF, dk_source: 'daikome', dk_distance_m: 5362, dk_meter_yen: 9999 },
      }),
    ]);
    expect(Object.keys(p.updates[0].patch).sort()).toEqual(['amount', 'extra']);
  });

  it('★事務所が 手で 直した 金額は 送り直しで 戻さない★（司さん 2026-09-29）', () => {
    // ★印 2200 ＝メーターは 変わっていない。事務所が 1600 に 直した★
    const p = planMeisaiWrite(rows(), [existing({ amount: 1600 })]);
    const patch = p.updates.length ? p.updates[0].patch : {};
    expect(
      Object.prototype.hasOwnProperty.call(patch, 'amount'),
      '★事務所の 直しを メーターの 値に 戻している★'
    ).toBe(false);
  });

  it('★印が 無い行でも 運転手の 値引きは 届く★（2026-09-29 やり直し）', () => {
    // ★★交換比が 逆だったので 作り直した★★（対立役の 指摘・本番で 数えた）
    //   前の形「印が 無く 金額も ずれていたら 何もしない（人の裁き待ち）」は
    //     守る 相手 …… 7行（明細が 低い 6行 1,400円＋高い 1行 2,000円・2026-09-29 実測）
    //                  ＝★全部 30日の 外＝もう 送られない＝元から 安全★
    //     塞ぐ 相手 …… 83行・169,500円 ＝★これから 毎日 使う「値引きが 届く 道」★
    //   さらに 裁き待ちは ★誰も 読んでいなかった★（j.meisai の 読み手 0箇所）
    //   ⇒ ★読んで 直すのを やめ 構造で 直す★:
    //     印は 書いた 時に 必ず 付く ので ★新しい行は 最初から 守られる★。
    //     既に 在る行は ★1回きりの 埋め戻し★（apply-meisai-dkmeteryen-backfill.sql）。
    const cur = existing({ amount: 3000 });
    cur.extra = { dk_ref: REF, dk_source: 'daikome', dk_distance_m: 5362 }; // ★印なし★
    const yasui = rows();
    yasui[0].amount = 2500; // 運転手が 500円 値引き
    yasui[0].extra.dk_meter_yen = 2500;
    const p = planMeisaiWrite(yasui, [cur]);
    expect(p.updates[0].patch.amount, '★値引きが 事務所に 届かない★').toBe(2500);
    expect(p.updates[0].patch.extra.dk_meter_yen, '印を 付けていない＝次も 守れない').toBe(2500);
  });

  it('★印が 在れば 事務所の 直しは 守られる★（埋め戻しが 済んだ 後の 姿）', () => {
    // 印＝★メーターの 額★ で 埋める ので、事務所が 下げた 行も 守られる
    const cur = existing({
      amount: 1600, // 事務所が 手で 下げた
      extra: { dk_ref: REF, dk_source: 'daikome', dk_distance_m: 5362, dk_meter_yen: 2200 },
    });
    const p = planMeisaiWrite(rows(), [cur]);
    const patch = p.updates.length ? p.updates[0].patch : {};
    expect(
      Object.prototype.hasOwnProperty.call(patch, 'amount'),
      '★事務所の 直しを メーターの 値に 戻している★'
    ).toBe(false);
  });

  it('★新しく 入れる 行には 印が 入っている★', () => {
    const p = planMeisaiWrite(rows(), []);
    expect(p.inserts[0].extra.dk_meter_yen).toBe(2200);
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
  it('★事務所が 消した 行には 触らない★（本番 150行中 32行が 消されていた）', () => {
    // ★実測 2026-09-29★ daikou.meisai の dk_ref 付き 150行中 ★32行が deleted_at 付き★。
    //   読む select に deleted_at が 無く、planMeisaiWrite も 見ていなかった ので
    //   ★消した 行に 印を 打ち、条件次第で 金額も 戻していた★。
    // ★★この 見張りは 1度 偽の緑 だった（わざと 壊して ★赤 0★）★★
    //   はじめは `existing({ amount: 1600 })` だけ で 試したが、その行は
    //   印(dk_meter_yen=2200)も 他の 列も 揃っていて ★守りを 外しても 直されない★。
    //   ＝何を 測っても 0 に なる 形。「壊したのに 赤に ならない」で 見つけた。
    //   ⇒ ★守りを 外したら 必ず 書きに 行く 行★ に した：
    //     ・印(dk_meter_yen)が 無い → 金額を 上書きしに 行く
    //     ・行き先も 違う → 字も 上書きしに 行く
    const cur = existing({
      amount: 1600,
      destination: '事務所が 書き直した 行き先',
      extra: { dk_ref: REF, dk_source: 'daikome', dk_distance_m: 5362 },
    });
    cur.deleted_at = '2026-09-01T00:00:00Z';
    // 先に ★消されていなければ 必ず 直される 行★ だ と 見せておく
    const ikite = Object.assign({}, cur, { deleted_at: null });
    expect(
      planMeisaiWrite(rows(), [ikite]).updates.length,
      '★試している 行 が そもそも 直されない＝何を 測っても 0★'
    ).toBe(1);
    const p = planMeisaiWrite(rows(), [cur]);
    expect(p.updates.length, '★消した 行を 直している★').toBe(0);
    expect(p.inserts.length, '★消した 行を 入れ直している＝生き返る★').toBe(0);
  });

  it('★印は amount と 同じ 丸め方★（小数が 1件 出た日から 毎回 上書きし続ける）', () => {
    // 前は amount = Math.round(fare_yen) なのに 印だけ 丸めていなかった。
    //   今の 本番は fare_yen の 小数 ★0件 / 603件★（実測 2026-09-29）なので まだ 踏んでいないが、
    //   1件でも 出た日から ★meterMae(2500.4) ≠ meterIma(2500) で 毎回 上書き★に なる。
    const t = Object.assign({}, REAL[0], { fare_yen: 2500.4 });
    const r = build([t])[0];
    expect(r.extra.dk_meter_yen, '★印だけ 丸めていない★').toBe(r.amount);
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
    // ★2026-09-29 返事が 多行に なったので ★字の 並びでなく「ok: を 返しているか」で 見る★
    expect(SRC, '入れた件数を返していない').toContain("'ok:' +");
    expect(SRC, '返事に meisai が入っていない').toContain('accepted, meisai');
  });

  it('★読む時・入れる時・直す時の失敗を捨てていない★', () => {
    // ★★2026-09-29 狙いの 側へ 向け直した★★
    //   前は `insert(plan.inserts)` という ★書き方 そのもの★ を 探していた。
    //   unique 索引を 張ったので ★束で 入れると 1行の 衝突で 束ごと 落ちる★。
    //   ⇒ 1行ずつ 入れる 形に 変えた。★狙いは「失敗を 捨てない」★なので そちらを 見る。
    //   ★読む側も 足した★（前は 書き側だけ 受けていて 非対称＝対立役の 指摘）
    expect(SRC, '★明細を 読む 時の error を 受けていない★').toMatch(
      /const \{ data: exist, error: exErr \}/
    );
    // ★★この 1行は 2026-09-29 の 夕方に ★逆へ 向け直した★★
    //   朝は `if (exErr) return 'error:…'`（読めなければ 何も 書かない）を 正と していた。
    //   だが accepted は ★返り値を 見ずに 立つ★（index.ts:210・2026-08-01 の 決め）ので、
    //   読みが 1回 落ちた 晚の 勤務は ★明細が 空の まま 確定★に なる（永久に 欠ける）。
    //   「二重を 作るより…」と 書いたのは ★一意の 索引が 無かった 頃の 話★で、
    //   今は `meisai_dk_ref_uniq` が 本番・テスト 両方に 当たっている。
    //   ⇒ ★読めなくても 先へ 進む★に 変えた。新しい 姿は 下の
    //     「★明細を 読めなくても 入るものは 入れる★」で 見張る。
    expect(SRC, '★読めないと 何も 入れずに 抜けている★').not.toMatch(
      /return 'error:明細を 読めなかった/
    );
    expect(SRC, 'insert の error を 受け取っていない').toMatch(/const \{ error: iErr \}/);
    expect(SRC, '直す時の error を 受け取っていない').toMatch(/const \{ error: uErr \}/);
    expect(SRC, '直した結果を返していない').toContain('件直した');
  });

  it('★束で なく 1行ずつ 入れている★（索引が 1行 弾いても 残りを 落とさない）', () => {
    expect(SRC, '★まだ 束で 入れている＝1行の 衝突で 勤務丸ごと 黙って 欠ける★').not.toMatch(
      /insert\(plan\.inserts\)/
    );
    expect(SRC, '1行ずつ 回す 輪が 無い').toMatch(/for \(const row of plan\.inserts\)/);
    expect(SRC, '★衝突を 黙って 飲んでいる（数を 返していない）★').toMatch(/hajikareta/);
  });

  it('★他社の 明細を 触らない＝人の 絞りを 外していない★（2026-09-29）', () => {
    // ★★一度 外しかけて 自分で 気づいて 戻した★★
    //   planMeisaiWrite は ★dk_ref だけ★ で 突き合わせ、
    //   index.ts は `update(patch).eq('id', …)` ＝★行の id★ で 書く。
    //   user_id は 見ないし patch にも 入らない。
    //   ⇒ 読む時の 絞りを 外すと ★A社の 同期が B社の 明細行を 書き換える★。
    //   索引との 見方の ずれは「1行ずつ insert ＋ 23505 を 数える」で 受け止める。
    expect(SRC, '★人の 絞りを 外している＝他社の 明細を 書き換える★').toContain(
      ".eq('user_id', ownerId)"
    );
    // 直す時に user_id を 書き換えていない事（行の 持ち主を 奪わない）
    expect(SRC, '★直す時に user_id を 触っている★').not.toMatch(/patch\.user_id/);
  });

  it('★入れられなかった 数を 返事に 出している★（黙って 済ませない）', () => {
    // ★裁き待ち(machi)は やめた★＝返事に 出しても ★誰も 読んでいなかった★（j.meisai の 読み手 0箇所）。
    //   代わりに「既に 在った」「入らなかった」を 数えて 返す。
    expect(SRC, '★裁き待ちが 残っている（誰も 読まない 物）★').not.toMatch(/plan\.machi/);
    expect(SRC, '弾かれた数を 返していない').toContain('件 既に 在った');
    expect(SRC, '入らなかった数を 返していない').toContain('件 入らなかった');
  });

  it('★途中で 抜けない＝★入れる輪も 直す輪も★（半分の 請求書を 作らない）', () => {
    // ★★この 見張りは 2026-09-29 に ★自分で 壊していた★★
    //   前の 形は 窓を
    //     SRC.indexOf('for (const row of plan.inserts)') 〜 SRC.indexOf('for (const u of plan.updates)')
    //   で 取っていた ので、★直す輪は 窓の 外★。
    //   「途中で 抜けない」と 名乗りながら ★抜けている 方を 一度も 見ていなかった★。
    //   実際 直す輪には `if (uErr) return 'error:直し …'` が 残っていた（対立役が 見つけた）。
    //   ＝[[門が 自分の 見たい 所だけ 見ている]]。★窓を 両方に 広げた★。
    const ireBu = SRC.slice(
      SRC.indexOf('for (const row of plan.inserts)'),
      SRC.indexOf('for (const u of plan.updates)')
    );
    const naosuBu = SRC.slice(
      SRC.indexOf('for (const u of plan.updates)'),
      SRC.indexOf("return (\n      'ok:'")
    );
    expect(naosuBu.length, '★直す輪の 窓が 空＝測れていない★').toBeGreaterThan(50);
    expect(ireBu, '★入れる 輪の 中で 抜けている★').not.toMatch(/return 'error:/);
    expect(naosuBu, '★直す 輪の 中で 抜けている＝半分 直した まま 確定★').not.toMatch(
      /return 'error:/
    );
    expect(ireBu, '入らなかった数を 数えていない').toMatch(/shippai\+\+/);
    expect(naosuBu, '直せなかった数を 数えていない').toMatch(/naoseNakatta\+\+/);
  });

  it('★読む select に deleted_at が 入っている★', () => {
    expect(SRC, '★deleted_at を 取っていない＝消した 行か 分からない★').toMatch(
      /select\('id, extra,[^']*deleted_at'\)/
    );
  });

  it('★明細を 読めなくても 入るものは 入れる★（永久に 欠ける 口を 塞ぐ）', () => {
    // accepted は ★返り値を 見ずに 立つ★（2026-08-01 の 決め・そのまま）ので、
    //   読みが 落ちた 晚に `return 'error:…'` すると ★明細が 空の まま 確定★。
    //   一意の 索引が 当たった 今は 二重を DB が 弾く ので 先へ 進める。
    expect(SRC, '★読めないと 何も 入れずに 抜けている★').not.toMatch(
      /return 'error:明細を 読めなかった/
    );
    expect(SRC, '読めなかった 事を 返事に 出していない').toMatch(/yomeNakatta/);
    expect(SRC, '読めない時に 直しを やろうと している').toMatch(
      /planMeisaiWrite\(rows, yomeNakatta \? \[\] : exist/
    );
  });

  it('★往復に 上限が 在る★（誰でも 叩ける 口なので）', () => {
    expect(SRC, '上限が 無い').toMatch(/IRE_JOUGEN/);
    expect(SRC, '★上限が 効かない 形（偽の 番人）★').toMatch(/uchikiri >= IRE_JOUGEN/);
  });

  it('★行を作る所を関数の中に書き戻していない★（外に出ていないとテストできない）', () => {
    expect(SRC).toContain("from './meisai-row.js'");
    expect(SRC, '関数の中で行を組み立て直している').not.toMatch(/dk_source:\s*'daikome'/);
  });
});
