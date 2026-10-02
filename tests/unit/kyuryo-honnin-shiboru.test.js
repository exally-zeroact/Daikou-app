'use strict';
// ============================================================
// ★★給料の 本人リンク＝倉庫の 関数 dk_kyuryo_get が 返す 物を 絞った★★ 2026-10-02
//
//   ★前★ 会社全部の 行を ★列ごと 丸ごと★ 返していた（to_jsonb(行)）
//     dk_work_hours  … ★同僚の employee_id と 時間★
//     dk_shift_edits … ★同僚の 備考(note)・その他の 名前★
//     dk_manual_days … ★備考(note)★
//     画面に 出ない だけで ★本人の 端末には 届いていた★。
//
//   ★今★ workHours は ★本人の 分だけ★／edits・manualDays は ★計算が 読む 列だけ★
//     （edits・manualDays の 行は ★みんなの売上★ に 効くので 会社ぶん 要る）
//
//   ★ここで 見る 2つ★
//     ① 倉庫の 関数の 字が そう なっているか
//     ② ★絞っても 本人の 給料が 1円も 変わらない★（本物の 計算 js/payroll-daily.js に 通す）
//        ＝ ★事務所の 画面で 出る 本人の 額とも 同じ★
//
//   ★わざと壊して 赤に なるのを 見た（2026-10-02）★
//     ・SQL を 直す前（to_jsonb(行)・本人で 絞らない）に 戻す ⇒ ★赤 4★（① の 4本）
//     ・edits から hours を 落とす（計算が 読む 列を 削り過ぎ）⇒ ★赤 2★（② 前と同じ／事務所と同じ）
//     戻すと 8/8 緑。
// ============================================================
const fs = require('fs');
const path = require('path');
const D = require('../../js/payroll-daily.js');

const SQL = fs
  .readFileSync(path.join(__dirname, '../../supabase/apply-kyuryo-honnin-kansuu.sql'), 'utf8')
  .replace(/\r\n/g, '\n');

// dk_kyuryo_get の 中身だけ（コメント行は 外す）
function getBody() {
  const a = SQL.indexOf('function public.dk_kyuryo_get(');
  const b = SQL.indexOf('$fn$;', a);
  expect(a, '★dk_kyuryo_get が 見つからない（見張りが 空回り）★').toBeGreaterThan(0);
  return SQL.slice(a, b)
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');
}
// 'キー', ( … ) の 塊を 切り出す
function block(body, key) {
  const a = body.indexOf("'" + key + "'");
  expect(a, '★' + key + ' が 見つからない★').toBeGreaterThan(0);
  const rest = body.slice(a + key.length + 2);
  const next = rest.search(/\n\s*'[A-Za-z]+',\s*\(/);
  return next < 0 ? rest : rest.slice(0, next);
}

describe('① 倉庫の 関数の 字', () => {
  it('★workHours は 本人の 分だけ★（employee_id で 絞る）', () => {
    expect(block(getBody(), 'workHours')).toMatch(/w\.employee_id\s*=\s*r\.employee_id/);
  });
  for (const key of ['edits', 'workHours', 'manualDays']) {
    it('★' + key + ' は 行を 丸ごと 返さない★（to_jsonb(行) で 全部の 列が 出る）', () => {
      const b = block(getBody(), key);
      expect(b, '★' + key + ' が 列を 名指ししていない★').toMatch(/select\s+\w+\.\w+\s*,/);
      expect(b).not.toMatch(/to_jsonb\((ed|w|m)\)/);
      expect(b, '★' + key + ' に 備考(note) が 入っている★').not.toMatch(/\bnote\b/);
      expect(b).not.toMatch(/other_label/);
    });
  }
});

// ---- ② 本物の 計算に 通す ---------------------------------------------------
//   3人・2台・2日。★同じ 車に 2人 乗る 日★ と ★手入力の 日★ と ★実費の 直し★ を 入れる
const EMP = [
  { employee_id: 'e1', name: 'A', role: '2種', active: true, sort_order: 1 },
  { employee_id: 'e2', name: 'B', role: '1種', active: true, sort_order: 2 }, // ★本人★
  { employee_id: 'e3', name: 'C', role: '1種', active: true, sort_order: 3 },
];
const HONNIN = 'e2';
const LABELS = [
  { device_id: 'dev1', label: '1号車' },
  { device_id: 'dev2', label: '2号車' },
];
function shift(id, dev, date, fare, sec) {
  return {
    shift_id: id,
    device_id: dev,
    started_at: date + 'T20:00:00+09:00',
    elapsed_sec: sec,
    fare_total_yen: fare,
    trip_count: 1,
  };
}
const FULL = {
  shifts: [
    shift('s1', 'dev1', '2026-09-10', 31000, 8 * 3600),
    shift('s2', 'dev2', '2026-09-10', 22000, 6.5 * 3600),
    shift('s3', 'dev1', '2026-09-11', 27500, 7.25 * 3600),
  ],
  // ★倉庫の 行そのもの（備考つき）★
  edits: [
    {
      shift_id: 's1',
      company_id: 'c',
      toll_yen: 1200,
      bridge_yen: 0,
      other_yen: 300,
      other_label: '駐車場',
      note: '★同僚の 備考★',
      expenses: { x1: 500 },
      hours: null,
      updated_at: 't',
    },
    {
      shift_id: 's3',
      company_id: 'c',
      toll_yen: 0,
      bridge_yen: 400,
      other_yen: 0,
      other_label: '',
      note: 'メモ',
      expenses: null,
      hours: 8,
      updated_at: 't',
    },
  ],
  workHours: [
    {
      company_id: 'c',
      work_date: '2026-09-10',
      employee_id: 'e1',
      device_id: 'dev1',
      hours: 8,
      updated_at: 't',
    },
    {
      company_id: 'c',
      work_date: '2026-09-10',
      employee_id: 'e2',
      device_id: 'dev1',
      hours: 0,
      updated_at: 't',
    }, // 同じ車に 2人
    {
      company_id: 'c',
      work_date: '2026-09-10',
      employee_id: 'e3',
      device_id: 'dev2',
      hours: 6.5,
      updated_at: 't',
    },
    {
      company_id: 'c',
      work_date: '2026-09-11',
      employee_id: 'e2',
      device_id: 'dev1',
      hours: 0,
      updated_at: 't',
    },
    {
      company_id: 'c',
      work_date: '2026-09-12',
      employee_id: 'e3',
      device_id: 'dev2',
      hours: 5,
      updated_at: 't',
    },
    {
      company_id: 'c',
      work_date: '2026-09-12',
      employee_id: 'e2',
      device_id: 'dev2',
      hours: 5,
      updated_at: 't',
    },
  ],
  manualDays: [
    {
      company_id: 'c',
      work_date: '2026-09-12',
      device_id: 'dev2',
      sales_yen: 18000,
      hours: 5,
      toll_yen: 600,
      bridge_yen: 0,
      other_yen: 0,
      trip_count: 4,
      note: '★手入力の 備考★',
      expenses: {},
      denshi_yen: null,
      updated_at: 't',
    },
  ],
};
const DATES = ['2026-09-10', '2026-09-11', '2026-09-12'];

// ★新しい 関数が 返す 形★（SQL と 同じ 列だけ・workHours は 本人だけ）
function shibotta(full) {
  const pick = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k]]));
  return {
    shifts: full.shifts,
    edits: full.edits.map((e) =>
      pick(e, ['shift_id', 'toll_yen', 'bridge_yen', 'other_yen', 'expenses', 'hours'])
    ),
    workHours: full.workHours
      .filter((w) => w.employee_id === HONNIN)
      .map((w) => pick(w, ['work_date', 'employee_id', 'device_id', 'hours'])),
    manualDays: full.manualDays.map((m) =>
      pick(m, [
        'work_date',
        'device_id',
        'sales_yen',
        'hours',
        'toll_yen',
        'bridge_yen',
        'other_yen',
        'trip_count',
      ])
    ),
  };
}
function honninNoKyuryo(raw, employees) {
  const ctx = D.buildCtx({
    shifts: raw.shifts,
    edits: raw.edits,
    labels: LABELS,
    employees: employees,
    workHours: raw.workHours,
    manualDays: raw.manualDays,
    payrollSettings: null,
    salesSettings: null,
  });
  return DATES.map((d) => {
    const r = D.computeDay(d, ctx);
    const me = (r.staff || []).find((s) => s.employee_id === HONNIN);
    return { d, pay: me ? me.pay : 0, hours: me ? me.hours : 0, hourly: r.hourly };
  });
}

describe('② ★絞っても 本人の 給料は 1円も 変わらない★', () => {
  const honninDake = [EMP[1]];
  const mae = honninNoKyuryo(FULL, honninDake); // 前の 関数（全部 返す）
  const ato = honninNoKyuryo(shibotta(FULL), honninDake); // 新しい 関数
  const jimusho = honninNoKyuryo(FULL, EMP); // 事務所の 画面（全員・全部）

  it('★見張りが 空回り していない★（本人に 給料が 出る 日が 3日 在る）', () => {
    expect(mae.filter((x) => x.pay > 0).length).toBe(3);
  });
  it('★前と 今で 日ごとに 同じ★', () => {
    expect(ato).toEqual(mae);
  });
  it('★事務所の 画面で 出る 本人の 額とも 同じ★', () => {
    expect(ato).toEqual(jimusho);
  });
  it('★同僚の 備考は もう 届かない★', () => {
    expect(JSON.stringify(shibotta(FULL))).not.toMatch(/備考|駐車場|e1|e3/);
  });
});
