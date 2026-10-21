// ★★「続ける」の 送り直しで 事務所が 直した 額を 戻さない（dk_trips の 側）★★ 2026-10-22 司さん「触ってよし」
//   受け口 dk-sync-jobs は 送りが 届くと dk_trips を 端末の 額で 入れ直す。事務所が 請求書の 一覧で 直した 額
//   （dk-fix-fare が dk_trips.fare_yen に 写した 物）が、運転手が 何も 直していない 送り直しで 戻っていた。
//   決めは meisai-row.js の planJimushoModoshi（受け口は 入れる 前に これを 呼ぶ）。
//   わざと壊す：下の 判じの 1つを 外す ⇒ どれかが 赤
import { describe, it, expect } from 'vitest';
import { planJimushoModoshi } from '../../supabase/functions/dk-sync-jobs/meisai-row.js';

const DEV = 'dev1';
const MS = 1790000000000;
const ref = (seq) => `${DEV}:${MS}:${seq}`;
const seikyu = (seq, fare) => ({
  seq,
  fare_yen: fare,
  customer_name: 'A社',
  payment_type: 'invoice',
});
const gyou = (seq, amount, meter, o) =>
  Object.assign(
    { id: 'm' + seq, amount, extra: { dk_ref: ref(seq), dk_meter_yen: meter }, deleted_at: null },
    o || {}
  );
const keikaku = (trips, meisai) =>
  planJimushoModoshi({ deviceId: DEV, shiftStartMs: MS, trips, meisai });

describe('★事務所が 直した 額を 守る（planJimushoModoshi）★', () => {
  it('メーターは 変わらず 明細の 額だけ 違う＝事務所が 直した ⇒ 明細の 額を 使う・差を 合計に 足す', () => {
    const r = keikaku(
      [seikyu(1, 1600), seikyu(2, 3000)],
      [gyou(1, 2000, 1600), gyou(2, 3000, 3000)]
    );
    expect(r.bySeq).toEqual({ 1: 2000 });
    expect(r.sa).toBe(400);
  });
  it('事務所が 下げた 額も 守る（差は 負）', () => {
    const r = keikaku([seikyu(1, 2500)], [gyou(1, 1600, 2500)]);
    expect(r.bySeq).toEqual({ 1: 1600 });
    expect(r.sa).toBe(-900);
  });
  it('メーターの 額が 変わった（運転手が 営業中に 直した）⇒ 端末の 額（最後に 直した 方）', () => {
    const r = keikaku([seikyu(1, 2200)], [gyou(1, 1600, 2500)]);
    expect(r.bySeq).toEqual({});
    expect(r.sa).toBe(0);
  });
  it('事務所が 消した 行・印の 無い 行・額の 無い 行・明細の 無い 乗車は 触らない', () => {
    expect(
      keikaku([seikyu(1, 2500)], [gyou(1, 1600, 2500, { deleted_at: '2026-10-21T00:00:00Z' })])
        .bySeq
    ).toEqual({});
    expect(keikaku([seikyu(1, 2500)], [gyou(1, 1600, null)]).bySeq).toEqual({});
    expect(keikaku([seikyu(1, 2500)], [gyou(1, null, 2500)]).bySeq).toEqual({});
    expect(keikaku([seikyu(1, 2500)], []).bySeq).toEqual({});
  });
  it('★現金の 乗車には 写さない★（請求書払い→現金に 直した 乗車に 明細が 残っていても）', () => {
    const genkin = { seq: 1, fare_yen: 2500, customer_name: '', payment_type: 'cash' };
    expect(keikaku([genkin], [gyou(1, 1600, 2500)]).bySeq).toEqual({});
    const namaeNashi = { seq: 1, fare_yen: 2500, customer_name: '', payment_type: 'invoice' };
    expect(keikaku([namaeNashi], [gyou(1, 1600, 2500)]).bySeq).toEqual({});
  });
  it('別の 端末・別の 勤務の 行とは 繋がない（dk_ref の 頭が 違う）', () => {
    const tanin = gyou(1, 1600, 2500, { extra: { dk_ref: `dev2:${MS}:1`, dk_meter_yen: 2500 } });
    const betsuGyoumu = gyou(1, 1600, 2500, {
      extra: { dk_ref: `${DEV}:${MS + 1}:1`, dk_meter_yen: 2500 },
    });
    expect(keikaku([seikyu(1, 2500)], [tanin, betsuGyoumu]).bySeq).toEqual({});
  });
  it('倉庫から 文字で 返る 数（"2000.00"）も 数で 比べる', () => {
    const r = keikaku([seikyu(1, 1600)], [gyou(1, '2000', '1600')]);
    expect(r.bySeq).toEqual({ 1: 2000 });
    expect(keikaku([seikyu(1, 1600)], [gyou(1, '1600.00', '1600')]).bySeq).toEqual({});
  });
  it('★戻しの 無い 勤務は 空＝今と 1円も 変わらない★（入力が 空・壊れていても 落ちない）', () => {
    expect(keikaku([], [])).toEqual({ bySeq: {}, sa: 0 });
    expect(planJimushoModoshi(null)).toEqual({ bySeq: {}, sa: 0 });
    expect(keikaku([seikyu(1, 2500)], [gyou(1, 2500, 2500)])).toEqual({ bySeq: {}, sa: 0 });
  });
});
