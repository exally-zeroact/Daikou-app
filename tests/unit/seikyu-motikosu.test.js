// ============================================================
// ★★請求書の 額（seikyu_yen）は 在る 時だけ 送る★★ 2026-10-06
//
//   司さん「請求書の額は 両方に 対応しろ」＝入力画面で 車ごとに 請求書を 打てる。
//   ★危ない 所（対立役 10-06）★ denshi_yen の ように 毎回 0 を 送ると、
//     倉庫に 列が まだ 無い 線（本番に SQL を 当てる 前）で 列が 無いと 弾かれ
//     ★実費の 保存が 全部 落ちる★。⇒ 打った 時か 既に 値が 在る 時だけ 送る。
//
//   わざと壊す（10-06 実測）：motikosuSeikyu を 毎回 body.seikyu_yen = cur.seikyu_yen || 0 に ⇒ ★赤★
// ============================================================
globalThis.window = globalThis;
require('../../js/jippi-hozon.js');
const J = globalThis.JippiHozon;

function okutta() {
  const log = [];
  globalThis.DKSession = {
    rest(sess, p, o) {
      log.push({ p, body: JSON.parse(o.body) });
      return Promise.resolve({ ok: true });
    },
  };
  return log;
}

describe('★走った 車（1回の 業務）★ karada', () => {
  it('列が 無い 線では 高速代を 打っても seikyu_yen の 鍵を 送らない', () => {
    const b = J.karada('s1', 'c1', { toll_yen: 0, denshi_yen: 500 }, 'toll', '1200');
    expect(Object.prototype.hasOwnProperty.call(b, 'seikyu_yen'), '★列が 無いのに 送る★').toBe(
      false
    );
    expect(b.toll_yen).toBe(1200);
    expect(b.denshi_yen, '★電子決済が 消えた★').toBe(500);
  });
  it('請求書を 打つと 入る', () => {
    const b = J.karada('s1', 'c1', {}, 'seikyu_yen', '10000');
    expect(b.seikyu_yen).toBe(10000);
  });
  it('前に 打った 請求書は 別の 欄を 打っても 消えない', () => {
    const b = J.karada('s1', 'c1', { seikyu_yen: 10000, denshi_yen: 300 }, 'bridge', '400');
    expect(b.seikyu_yen, '★請求書が 消えた★').toBe(10000);
    expect(b.denshi_yen, '★電子決済が 消えた★').toBe(300);
    expect(b.bridge_yen).toBe(400);
  });
  it('★請求書は 実費（expenses）に 入れない★（入れると 売上から 引かれて 給料が 下がる）', () => {
    const b = J.karada('s1', 'c1', {}, 'seikyu_yen', '10000');
    expect(b.expenses).toEqual({});
  });
});

describe('★走っていない 車（手で 入れた 1日）★ saveTebiki', () => {
  it('列が 無い 線では 送らない／打つと 入る／前の 額は 持ち越す', async () => {
    const log = okutta();
    await J.saveTebiki({}, 'c1', '2026-10-03', 'd1', { denshi_yen: 1400 }, 'toll', '800');
    expect(Object.prototype.hasOwnProperty.call(log[0].body, 'seikyu_yen')).toBe(false);
    await J.saveTebiki({}, 'c1', '2026-10-03', 'd1', {}, 'seikyu_yen', '8600');
    expect(log[1].body.seikyu_yen).toBe(8600);
    await J.saveTebiki({}, 'c1', '2026-10-03', 'd1', { seikyu_yen: 8600 }, 'toll', '800');
    expect(log[2].body.seikyu_yen, '★請求書が 消えた★').toBe(8600);
    expect(log[2].body.expenses).toEqual({});
  });
});

// ★★給料は 1円も 変わらない★★（司さん 10-06「1A」＝Excel の 計算シートに 請求書の 列は 無い）
describe('★請求書を 打っても 給料の もと（売上・実費）は 変わらない★', () => {
  it('buildCtx の 売上と 実費が seikyu_yen の 有無で 同じ', () => {
    globalThis.UriageAgg = require('../../js/uriage-agg.js');
    const PD = require('../../js/payroll-daily.js');
    const sh = [
      {
        shift_id: 's1',
        device_id: 'd1',
        started_at: '2026-10-03T11:00:00Z',
        fare_total_yen: 53300,
      },
    ];
    const md = [{ company_id: 'c1', work_date: '2026-10-03', device_id: 'd2', sales_yen: 9000 }];
    const nashi = PD.buildCtx({
      shifts: sh,
      edits: [{ shift_id: 's1', toll_yen: 500 }],
      manualDays: md,
    });
    const ari = PD.buildCtx({
      shifts: sh,
      edits: [{ shift_id: 's1', toll_yen: 500, seikyu_yen: 10000 }],
      manualDays: [Object.assign({ seikyu_yen: 8600 }, md[0])],
    });
    expect(ari.byDate, '★請求書で 給料の もとが 変わった★').toEqual(nashi.byDate);
    expect(nashi.byDate['2026-10-03'].d1.sales).toBe(53300);
  });
});
