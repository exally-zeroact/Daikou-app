// ============================================================
// ★現金に 戻した 代行の 明細の 行を 外す／請求書払いに 戻ったら 戻す（2026-10-12）★
//   司さんの 決まり「外したら 外す」。決めは meisai-row.js の planMeisaiHazushi。
//   ★分からない 時は 触らない★を 縛る。★出した 月も 外す・戻す★（2026-10-22 司さん「よい」）。
// ============================================================
import { describe, it, expect } from 'vitest';
import { planMeisaiHazushi } from '../../supabase/functions/dk-sync-jobs/meisai-row.js';

const DEV = 'dev-1';
const SS = 1791000000000;
const ref = (seq) => `${DEV}:${SS}:${seq}`;
const row = (id, seq, over) =>
  Object.assign(
    { id, extra: { dk_ref: ref(seq) }, company: '見本商事', date: '2026-10-11', deleted_at: null },
    over || {}
  );
const genkin = (seq) => ({ seq, payment_type: 'cash', customer_id: null, customer_name: '' });
const seikyu = (seq) => ({
  seq,
  payment_type: 'invoice',
  customer_id: 'c1',
  customer_name: '見本商事',
});
const plan = (o) => planMeisaiHazushi(Object.assign({ deviceId: DEV, shiftStartMs: SS }, o));

describe('★はっきり 現金に した 代行の 行だけ 外す★', () => {
  it('現金に 戻した 代行の 行は 外す', () => {
    const p = plan({ trips: [genkin(1), seikyu(2)], existing: [row('a', 1), row('b', 2)] });
    expect(p.hides).toEqual([{ id: 'a', ref: ref(1) }]);
    expect(p.restores).toEqual([]);
  });

  it('請求書払いの まま（名前が 空でも）なら 外さない＝黙って 請求漏れに しない', () => {
    const namaeNashi = { seq: 1, payment_type: 'invoice', customer_id: 'c1', customer_name: '' };
    const p = plan({ trips: [namaeNashi], existing: [row('a', 1)] });
    expect(p.hides).toEqual([]);
  });

  it('代行が 送りに 居ない 行は 触らない（分からない）', () => {
    const p = plan({ trips: [genkin(2)], existing: [row('a', 1)] });
    expect(p.hides).toEqual([]);
  });

  it('区分が 変（customer_id が 欠けている・数）なら 触らない', () => {
    const kaketa = { seq: 1, payment_type: 'cash' };
    const hen = { seq: 2, payment_type: 'cash', customer_id: 5 };
    const p = plan({ trips: [kaketa, hen], existing: [row('a', 1), row('b', 2)] });
    expect(p.hides).toEqual([]);
  });

  it('別の 勤務・別の 端末の 行は 触らない', () => {
    const p = plan({
      trips: [genkin(1)],
      existing: [
        row('x', 1, { extra: { dk_ref: `${DEV}:${SS + 1}:1` } }),
        row('y', 1, { extra: { dk_ref: `other:${SS}:1` } }),
        row('z', 1, { extra: { dk_ref: `${DEV}:${SS}:1x` } }),
      ],
    });
    expect(p.hides).toEqual([]);
  });

  it('既に 消されている 行は 外さない（二度 外さない）', () => {
    const p = plan({
      trips: [genkin(1)],
      existing: [row('a', 1, { deleted_at: '2026-10-11T00:00:00Z' })],
    });
    expect(p.hides).toEqual([]);
  });
});

describe('★請求書払いに 戻ったら、端末が 外した 行だけ 戻す★', () => {
  it('端末が 外した 行（記録が 在る）は 戻す', () => {
    const p = plan({
      trips: [seikyu(1)],
      existing: [row('a', 1, { deleted_at: '2026-10-11T00:00:00Z' })],
      kiroku: [{ meisai_id: 'a', hidden_at: '2026-10-11T00:00:00.000Z' }],
    });
    expect(p.restores).toEqual([{ id: 'a', ref: ref(1) }]);
  });

  it('事務所が 消した 行（記録が 無い）は 生き返らせない', () => {
    const p = plan({
      trips: [seikyu(1)],
      existing: [row('a', 1, { deleted_at: '2026-10-11T00:00:00Z' })],
      kiroku: [],
    });
    expect(p.restores).toEqual([]);
  });

  it('戻った 先が 名前の 空な 請求書払いなら 戻さない（入れる 側の 決まりと 同じ）', () => {
    const namaeNashi = { seq: 1, payment_type: 'invoice', customer_id: 'c1', customer_name: '' };
    const p = plan({
      trips: [namaeNashi],
      existing: [row('a', 1, { deleted_at: '2026-10-11T00:00:00Z' })],
      kiroku: [{ meisai_id: 'a', hidden_at: '2026-10-11T00:00:00.000Z' }],
    });
    expect(p.restores).toEqual([]);
  });
});

// ★2026-10-22 司さん「出した月の明細を運転手の直しで後から変えてよいか」＝「よい」★
//   前は 出した 月は 外さず 戻さず 止めていた（tometa）。今は 出した 月でも 外す・戻す（deta を 渡しても 見ない）。
//   わざと壊す：出した 月の 止めを 戻す ⇒ 赤
describe('★請求書を 出した 月でも 外す・戻す（司さん「よい」）★', () => {
  it('その 会社・その 月の 請求書を 出していても 外す', () => {
    const p = plan({
      trips: [genkin(1)],
      existing: [row('a', 1)],
      deta: ['見本商事|2026-10'],
    });
    expect(p.hides).toEqual([{ id: 'a', ref: ref(1) }]);
    expect(p.tometa, '止めた 物の 箱は もう 無い').toBeUndefined();
  });

  it('戻す 時も 出した 月で 戻す', () => {
    const p = plan({
      trips: [seikyu(1)],
      existing: [row('a', 1, { deleted_at: '2026-10-11T00:00:00Z' })],
      kiroku: [{ meisai_id: 'a', hidden_at: '2026-10-11T00:00:00.000Z' }],
      deta: ['見本商事|2026-10'],
    });
    expect(p.restores).toEqual([{ id: 'a', ref: ref(1) }]);
  });
});

describe('★記録の 時刻が 行の 消した 時刻と 同じ 時だけ 戻す★（taiketsu の 指摘3）', () => {
  it('事務所が 消し直した 行（時刻が 違う）は 記録が 在っても 戻さず、記録を 捨てる', () => {
    const p = plan({
      trips: [seikyu(1)],
      existing: [row('a', 1, { deleted_at: '2026-10-12T05:00:00+00:00' })],
      kiroku: [{ meisai_id: 'a', hidden_at: '2026-10-11T00:00:00.000Z' }],
    });
    expect(p.restores).toEqual([]);
    expect(p.sutekiroku).toEqual(['a']);
  });

  it('行が 生きているのに 記録が 在る（書きが 片方 落ちた）なら 記録を 捨てる', () => {
    const p = plan({
      trips: [seikyu(1)],
      existing: [row('a', 1)],
      kiroku: [{ meisai_id: 'a', hidden_at: '2026-10-11T00:00:00.000Z' }],
    });
    expect(p.restores).toEqual([]);
    expect(p.sutekiroku).toEqual(['a']);
  });

  it('同じ 時刻（倉庫の 書き方が 違っても）なら 戻し、記録は 捨てる 側に 入れない', () => {
    const p = plan({
      trips: [seikyu(1)],
      existing: [row('a', 1, { deleted_at: '2026-10-11T00:00:00+00:00' })],
      kiroku: [{ meisai_id: 'a', hidden_at: '2026-10-11T00:00:00.000Z' }],
    });
    expect(p.restores.length).toBe(1);
    expect(p.sutekiroku).toEqual([]);
  });
});

describe('★外す 行の 記録は 同じ 送りで 捨てない★（taiketsu：外して 記録を 消すと 戻せず 請求が 漏れる）', () => {
  it('記録が 残っている・行は 生きている・現金 → 外す 側に 入り、記録は 捨てない', () => {
    const p = plan({
      trips: [genkin(1)],
      existing: [row('a', 1)],
      kiroku: [{ meisai_id: 'a', hidden_at: '2026-10-11T00:00:00.000Z' }],
    });
    expect(p.hides).toEqual([{ id: 'a', ref: ref(1) }]);
    expect(p.sutekiroku, '外す 行の 記録を 捨てた＝戻せない 行に なる').toEqual([]);
  });

  it('記録だけ 残った 生きた 行を 現金で 外す 時は 記録を 捨てない（同じ 送りで 外す・前の 時刻を 使う）', () => {
    const p = plan({
      trips: [genkin(1)],
      existing: [row('a', 1)],
      kiroku: [{ meisai_id: 'a', hidden_at: '2026-10-11T00:00:00.000Z' }],
    });
    expect(p.hides).toEqual([{ id: 'a', ref: ref(1) }]);
    expect(p.sutekiroku).toEqual([]);
  });
});
