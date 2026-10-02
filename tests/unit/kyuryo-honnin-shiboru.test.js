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
//   ★10-02 夜（対立役に 叩かれて 作り直した）★
//     ・前の ② は ★列の 名簿を 手で 写していた★＝SQL から 列を 消しても 緑。事務所側も 設定 null で
//       計算していた＝「事務所と 同じ」は 会社の 設定の 点では ★嘘の 緑★ だった。
//     ・今は 列を ★SQL から 読み★、会社の 設定は ★既定と 違う 形★ で 比べる。
//     ・わざと壊す：SQL を 直す前（salesSettings 無し）に 戻す ⇒ ★ファイルごと 赤★（列が 読めない）
//                   edits から expenses を 外す ⇒ ★赤 2★ ／ 戻すと 14/14 緑
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

// ★★新しい 関数が 返す 列は ★SQL から 読み取る★（手で 写さない）★★ 2026-10-02 夜（対立役）
//   前は 列の 名簿を この 試験に 手で 写していた＝SQL から 列（expenses 等）を 消しても ★緑の まま★。
//   ⇒ dk_kyuryo_get の 'キー' の select の 並びを 字で 読み、その 列だけ 残す。
function retsu(key) {
  const b = block(getBody(), key);
  // 外側の select coalesce(jsonb_agg(…)) では なく ★棚を 読む 内側の select★
  const m = b.match(/select\s+((?:(?!select)[\s\S])*?)\s+from\s+daikome\./i);
  expect(m, '★' + key + ' の 列が 読めない★').toBeTruthy();
  return m[1].split(',').map((x) => x.trim().replace(/^\w+\./, ''));
}
// 会社の「売上から 何を 引くか」＝★既定と 違う★ 形で 比べる（既定だと ずれが 見えない）
const URIAGE_SETTEI = {
  company_id: 'c',
  deduct_toll: false,
  deduct_bridge: true,
  deduct_other: true,
  other_label: '駐車場',
  updated_at: 't',
};
function shibotta(full) {
  const pick = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k]]));
  return {
    shifts: full.shifts,
    edits: full.edits.map((e) => pick(e, retsu('edits'))),
    // ★本人で 絞るかは ① が SQL の 字で 見る★
    workHours: full.workHours
      .filter((w) => w.employee_id === HONNIN)
      .map((w) => pick(w, retsu('workHours'))),
    manualDays: full.manualDays.map((m) => pick(m, retsu('manualDays'))),
    salesSettings: pick(URIAGE_SETTEI, retsu('salesSettings')),
  };
}
function honninNoKyuryo(raw, employees, salesSettings) {
  const ctx = D.buildCtx({
    shifts: raw.shifts,
    edits: raw.edits,
    labels: LABELS,
    employees: employees,
    workHours: raw.workHours,
    manualDays: raw.manualDays,
    payrollSettings: null,
    salesSettings: salesSettings,
  });
  return DATES.map((d) => {
    const r = D.computeDay(d, ctx);
    const me = (r.staff || []).find((s) => s.employee_id === HONNIN);
    return { d, pay: me ? me.pay : 0, hours: me ? me.hours : 0, hourly: r.hourly };
  });
}

describe('② ★絞っても 本人の 給料は 1円も 変わらない★', () => {
  const honninDake = [EMP[1]];
  const s = shibotta(FULL);
  // ★本人の 画面は 関数が 返した 物だけで 計算する★（kyuryo.html：RAW.salesSettings = r.salesSettings）
  const ato = honninNoKyuryo(s, honninDake, s.salesSettings); // 新しい 関数
  const jimusho = honninNoKyuryo(FULL, EMP, URIAGE_SETTEI); // 事務所の 画面（全員・全部・会社の 設定）
  const maeNoHonnin = honninNoKyuryo(FULL, honninDake, null); // 前の 本人画面（設定を 読まず 既定）

  it('★見張りが 空回り していない★（本人に 給料が 出る 日が 3日 在る）', () => {
    expect(jimusho.filter((x) => x.pay > 0).length).toBe(3);
  });
  it('★事務所の 画面で 出る 本人の 額と 日ごとに 同じ★（会社の 設定が 既定と 違っても）', () => {
    expect(ato).toEqual(jimusho);
  });
  it('★前の 本人画面（設定を 読まない）は 事務所と ずれていた★＝この 試験が ずれを 見分けられる', () => {
    expect(
      maeNoHonnin,
      '★既定と 違う 設定でも ずれない＝試験の 材料が 実費に 当たっていない★'
    ).not.toEqual(jimusho);
  });
  it('★計算が 読む 列は 全部 返している★', () => {
    for (const k of ['shift_id', 'toll_yen', 'bridge_yen', 'other_yen', 'expenses', 'hours'])
      expect(retsu('edits'), '★edits に ' + k + ' が 無い★').toContain(k);
    for (const k of [
      'work_date',
      'device_id',
      'sales_yen',
      'hours',
      'toll_yen',
      'bridge_yen',
      'other_yen',
    ])
      expect(retsu('manualDays'), '★manualDays に ' + k + ' が 無い★').toContain(k);
    for (const k of ['deduct_toll', 'deduct_bridge', 'deduct_other'])
      expect(retsu('salesSettings'), '★salesSettings に ' + k + ' が 無い★').toContain(k);
  });
  it('★同僚の 備考は もう 届かない★', () => {
    // 会社の 設定（salesSettings の other_label）は 同僚の 物では ない＝同僚の 行だけ 見る
    const { edits, workHours, manualDays } = shibotta(FULL);
    expect(JSON.stringify({ edits, workHours, manualDays })).not.toMatch(/備考|駐車場|e1|e3/);
  });
});
