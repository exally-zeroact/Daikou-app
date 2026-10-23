// ============================================================
// ★★手で 入れた 車の 時数は saveTebiki の 写しで 書く★★ 2026-10-23（対立役 A-3）
//
//   時数を 入力の 画面へ 移した（司さん 10-23）。手で 入れた 車の 時間（dk_manual_days.hours）を
//   別の 写しで 書くと、次の saveTebiki（電子決済・実費 等）が cur.hours＝古い 値（0）で 上書きし、
//   ★給料が 黙って 0 に なる★。⇒ 時数も saveTebiki の 同じ 写し・同じ 行で 送る。
//   わざと壊す（2026-10-23 実測）：saveTebiki の field === 'hours' の 枝を 消す ⇒ 時数が expenses に 入り ★赤★
// ============================================================
globalThis.window = globalThis;
require('../../js/jippi-hozon.js');
const J = globalThis.JippiHozon;

function okutta() {
  const log = [];
  globalThis.DKSession = {
    rest(sess, p, o) {
      log.push({ p, m: o.method, body: o.body ? JSON.parse(o.body) : null });
      return Promise.resolve({ ok: true });
    },
  };
  return log;
}

describe('★手で 入れた 車の 時数（saveTebiki の hours）★', () => {
  it('小数の 時間を そのまま（0.25 刻み 等を 丸めない）・実費に 入れない', async () => {
    okutta();
    const b = await J.saveTebiki({}, 'c1', '2026-08-03', 'd1', {}, 'hours', '7.75');
    expect(b.hours).toBe(7.75);
    expect(b.expenses).toEqual({});
  });
  it('★時数の 後に 電子決済を 打っても 時数は 消えない★（返った 行を 次の cur に する＝画面と 同じ）', async () => {
    const log = okutta();
    let cur = {};
    cur = await J.saveTebiki({}, 'c1', '2026-08-03', 'd1', cur, 'hours', '5');
    cur = await J.saveTebiki({}, 'c1', '2026-08-03', 'd1', cur, 'denshi_yen', '300');
    cur = await J.saveTebiki({}, 'c1', '2026-08-03', 'd1', cur, 'toll', '800');
    expect(log.map((x) => x.body.hours)).toEqual([5, 5, 5]);
    expect(cur).toMatchObject({ hours: 5, denshi_yen: 300, toll_yen: 800 });
  });
  it('空・0・字は 0（給料は 出ない＝入れ漏れの 印が 出る）', async () => {
    okutta();
    for (const v of ['', '0', 'abc', '-3']) {
      const b = await J.saveTebiki({}, 'c1', '2026-08-03', 'd1', { hours: 4 }, 'hours', v);
      expect(b.hours, v).toBe(0);
    }
  });
  it('時数を 打っても 売上・回数・足した 実費は 持ち越す', async () => {
    okutta();
    const b = await J.saveTebiki(
      {},
      'c1',
      '2026-08-03',
      'd1',
      { sales_yen: 8000, trip_count: 3, expenses: { kabc: 500 } },
      'hours',
      '6'
    );
    expect(b).toMatchObject({ sales_yen: 8000, trip_count: 3, expenses: { kabc: 500 }, hours: 6 });
  });
});

describe('★手で 入れた 1日ぶんを 消す（delTebiki）★', () => {
  it('その 日の その 車の 1行だけ DELETE', async () => {
    const log = okutta();
    await J.delTebiki({}, 'c1', '2026-08-03', 'manual-x1');
    expect(log[0].m).toBe('DELETE');
    expect(log[0].p).toBe(
      'dk_manual_days?company_id=eq.c1&work_date=eq.2026-08-03&device_id=eq.manual-x1'
    );
  });
  it('倉庫が 断ったら 投げる', async () => {
    globalThis.DKSession = {
      rest() {
        return Promise.resolve({ ok: false, status: 403 });
      },
    };
    await expect(J.delTebiki({}, 'c1', '2026-08-03', 'd1')).rejects.toMatchObject({ status: 403 });
  });
});
