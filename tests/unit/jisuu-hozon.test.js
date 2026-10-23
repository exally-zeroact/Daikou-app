// ============================================================
// わざと壊す（2026-10-23 実測）：noriNashi の「dev === own」を 消す ⇒ ★自分の 車には 印を 出さない★ が 赤
// ★★時数の 判じと 保存の 部品（js/jisuu-hozon.js）★★ 2026-10-23
//
//   司さん「給料の時数を入れるを入力の各車ごとに経費の下に時数、乗った人…して
//           給料タブは確認と従業員の設定だけにして」
//   ⇒ 入れ漏れの 判じと 時数の 保存を 入力の 画面と 給料の 画面で 1つに した。
//   守る 事：
//     ①判じは 給料の 計算（PayrollDaily.buildCtx）と 同じ 材料で 数える
//       （elapsed_sec・ended_at から 出る 車の 時間／自分の 車／名簿に 居ない 人）
//     ②送る 中身は 給料の 画面が 前から 送っていた 形と 1文字も 違わない
//     ③倉庫が 断ったら 返事ごと 投げる（呼ぶ 側が 訳を 出す）
// ============================================================
globalThis.window = globalThis;
require('../../js/uriage-agg.js');
require('../../js/daiko-payroll.js');
require('../../js/payroll-period.js');
const PD = require('../../js/payroll-daily.js');
require('../../js/jisuu-hozon.js');
const J = globalThis.JisuuHozon;

const A = 'car-a';
const B = 'car-b';
const OWN = 'car-own';
const HI = '2026-08-01';

function ctxOf(o) {
  return PD.buildCtx(
    Object.assign(
      {
        payrollSettings: { owner_device_id: OWN },
        labels: [],
        shifts: [],
        edits: [],
        manualDays: [],
        employees: [
          { employee_id: 'e1', name: '一', active: true },
          { employee_id: 'e2', name: '二', active: true },
        ],
        workHours: [],
      },
      o
    )
  );
}
function shift(id, dev, sec, yen) {
  return {
    shift_id: id,
    device_id: dev,
    started_at: '2026-08-01T01:00:00Z',
    ended_at: new Date(Date.parse('2026-08-01T01:00:00Z') + sec * 1000).toISOString(),
    elapsed_sec: sec,
    fare_total_yen: yen,
  };
}
function wh(emp, dev, h) {
  return { work_date: HI, employee_id: emp, device_id: dev, hours: h };
}

describe('★入れ漏れの 判じ（noriNashi）★', () => {
  it('売上の 在る 車に 乗った人が 居ない ⇒ 印', () => {
    const ctx = ctxOf({ shifts: [shift('s1', A, 3600, 5000)] });
    expect(J.noriNashi(ctx, HI)).toEqual({ cars: [A], hito: [] });
  });
  it('★自分の 車には 印を 出さない★（ownerDeviceId）', () => {
    const ctx = ctxOf({ shifts: [shift('s1', OWN, 3600, 5000)] });
    expect(J.noriNashi(ctx, HI).cars).toEqual([]);
  });
  it('★乗った人の 時間が 空でも 車の 時間（elapsed_sec）が 在れば 印なし★', () => {
    const ctx = ctxOf({ shifts: [shift('s1', A, 7200, 5000)], workHours: [wh('e1', A, 0)] });
    expect(J.noriNashi(ctx, HI)).toEqual({ cars: [], hito: [] });
  });
  it('elapsed_sec が 無くても 始まり〜終わり で 車の 時間が 出る＝印なし', () => {
    const s = shift('s1', A, 0, 5000);
    s.elapsed_sec = null;
    s.ended_at = '2026-08-01T03:00:00Z';
    const ctx = ctxOf({ shifts: [s], workHours: [wh('e1', A, 0)] });
    expect(J.noriNashi(ctx, HI).cars).toEqual([]);
  });
  it('車の 時間も 人の 時間も 0 ⇒ 給料が 出ない＝印', () => {
    const ctx = ctxOf({
      manualDays: [{ work_date: HI, device_id: A, sales_yen: 0, hours: 0 }],
      workHours: [wh('e1', A, 0)],
    });
    expect(J.noriNashi(ctx, HI).cars).toEqual([A]);
  });
  it('手で 入れた 車の 時間（dk_manual_days.hours）で 印が 消える', () => {
    const ctx = ctxOf({
      manualDays: [{ work_date: HI, device_id: A, sales_yen: 8000, hours: 5 }],
      workHours: [wh('e1', A, 0)],
    });
    expect(J.noriNashi(ctx, HI).cars).toEqual([]);
  });
  it('記録の 無い 車（空も）に 乗って 時間の 在る 人 ⇒ hito', () => {
    const ctx = ctxOf({ workHours: [wh('e1', B, 3), wh('e2', '', 2)] });
    expect(J.noriNashi(ctx, HI).hito.sort()).toEqual(['e1', 'e2']);
  });
  it('名簿に 居ない 人は 数えない（計算も 知らない）', () => {
    const ctx = ctxOf({ shifts: [shift('s1', A, 3600, 5000)], workHours: [wh('zz', A, 3)] });
    expect(J.noriNashi(ctx, HI).cars).toEqual([A]);
  });
  it('2回 走った 車は 時間を 足す（2回目だけ 直しても 1回目は 自動）', () => {
    const ctx = ctxOf({
      shifts: [shift('s1', A, 3600, 5000), shift('s2', A, 1800, 2000)],
      edits: [{ shift_id: 's2', hours: 2 }],
    });
    expect(ctx.byDate[HI][A].hours).toBe(3);
  });
});

function okutta(ok) {
  const log = [];
  globalThis.DKSession = {
    rest(sess, p, o) {
      log.push({ p, m: o.method, h: o.headers, body: o.body ? JSON.parse(o.body) : null });
      return Promise.resolve({ ok: ok !== false, status: ok === false ? 403 : 201 });
    },
  };
  return log;
}

describe('★保存（給料の 画面が 前から 送っていた 形と 同じ）★', () => {
  it('車の 時間＝時間の 列だけ（空は null＝自動）', async () => {
    const log = okutta();
    await J.saveCarHours({}, 's1', 'c1', '7.5');
    await J.saveCarHours({}, 's1', 'c1', '');
    expect(log[0].p).toBe('dk_shift_edits?on_conflict=shift_id');
    expect(log[0].h).toEqual({ Prefer: 'resolution=merge-duplicates' });
    expect(Object.keys(log[0].body).sort()).toEqual(
      ['company_id', 'hours', 'shift_id', 'updated_at'].sort()
    );
    expect(log[0].body.hours).toBe(7.5);
    expect(log[1].body.hours).toBe(null);
  });
  it('乗った人＝会社×日×人 で 1行（空の 時間は 0＝車の 時間）', async () => {
    const log = okutta();
    const b = await J.saveWorkHour({}, 'c1', HI, 'e1', A, '');
    expect(log[0].p).toBe('dk_work_hours?on_conflict=company_id,work_date,employee_id');
    expect(b).toMatchObject({
      company_id: 'c1',
      work_date: HI,
      employee_id: 'e1',
      device_id: A,
      hours: 0,
    });
    await J.saveWorkHour({}, 'c1', HI, 'e1', null, '3.25');
    expect(log[1].body.device_id).toBe('');
    expect(log[1].body.hours).toBe(3.25);
  });
  it('外す＝その 日の その 人の 1行だけ DELETE', async () => {
    const log = okutta();
    await J.delWorkHour({}, 'c1', HI, 'e1');
    expect(log[0].m).toBe('DELETE');
    expect(log[0].p).toBe(
      'dk_work_hours?company_id=eq.c1&work_date=eq.2026-08-01&employee_id=eq.e1'
    );
  });
  it('倉庫が 断ったら 返事ごと 投げる（黙って 済んだ 事に しない）', async () => {
    okutta(false);
    await expect(J.saveCarHours({}, 's1', 'c1', '1')).rejects.toMatchObject({ status: 403 });
    await expect(J.saveWorkHour({}, 'c1', HI, 'e1', A, '1')).rejects.toMatchObject({
      status: 403,
    });
    await expect(J.delWorkHour({}, 'c1', HI, 'e1')).rejects.toMatchObject({ status: 403 });
  });
});
