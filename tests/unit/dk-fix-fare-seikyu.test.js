'use strict';
// ============================================================
// 件⑧ 2026-11-14 dk-fix-fare が 入力の 請求書の 手打ち（dk_shift_edits.seikyu_yen）を 外すか
//   司さん「請求書アプリで金額直しても事務所の入力の請求書に反映されんのはなぜ・お互い反映やないんか」
//   本物の index.ts を typescript で JS に して、esm.sh の import を 偽の 倉庫に 差し替え、Deno.serve の 手を 呼ぶ。
//   わざと壊す（11-14 実測）：.in('shift_id', ids) を .eq('shift_id', shift.shift_id) に／excluded の 確かめを 外す／
//     ⑥を ③の 前へ 動かす／日の 境を UTC に ⇒ 全部 赤（下の「壊し」）
// ============================================================
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'supabase/functions/dk-fix-fare/index.ts'), 'utf8');

function nise(db, fail) {
  fail = fail || {};
  function q(table) {
    const st = { table, f: [], op: 'select', vals: null, sel: false, count: false };
    const rows = () => db[table] || (db[table] = []);
    const match = (r) => st.f.every((fn) => fn(r));
    const b = {
      select() {
        st.sel = true;
        return b;
      },
      update(vals, o) {
        st.op = 'update';
        st.vals = vals;
        st.count = !!(o && o.count);
        return b;
      },
      eq(c, v) {
        st.f.push((r) => r[c] === v);
        return b;
      },
      gte(c, v) {
        st.gte = true;
        st.f.push((r) => Date.parse(r[c]) >= Date.parse(v));
        return b;
      },
      lt(c, v) {
        st.f.push((r) => Date.parse(r[c]) < Date.parse(v));
        return b;
      },
      in(c, vs) {
        st.f.push((r) => vs.indexOf(r[c]) >= 0);
        return b;
      },
      not(c, op, v) {
        if (op !== 'is' || v !== null) throw new Error('nise: not ' + op);
        st.f.push((r) => r[c] !== null && r[c] !== undefined);
        return b;
      },
      run() {
        const k = table + ':' + st.op;
        const k2 = k + ':' + (st.vals ? Object.keys(st.vals).join(',') : st.gte ? 'gte' : '');
        if (fail[k] || fail[k2]) return { data: null, error: { message: 'nise fail ' + k } };
        const hit = rows().filter(match);
        if (st.op === 'update') {
          hit.forEach((r) => Object.assign(r, st.vals));
          return {
            data: st.sel ? hit.map((r) => ({ ...r })) : null,
            error: null,
            count: hit.length,
          };
        }
        return { data: hit.map((r) => ({ ...r })), error: null };
      },
      maybeSingle() {
        const r = b.run();
        if (r.error) return Promise.resolve(r);
        return Promise.resolve({ data: r.data[0] || null, error: null });
      },
      then(ok, ng) {
        return Promise.resolve(b.run()).then(ok, ng);
      },
    };
    return b;
  }
  return {
    createClient() {
      return {
        auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
        from: q,
      };
    },
  };
}

function yobu(src, db, fail) {
  const js = ts.transpileModule(
    src.replace(/^import \{ createClient \} from [^\n]+\n/m, 'const { createClient } = __nise;\n'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  let te = null;
  const Deno = { serve: (h) => (te = h), env: { get: (k) => k } };
  // eslint-disable-next-line no-new-func
  new Function('Deno', '__nise', js)(Deno, nise(db, fail));
  return te(
    new Request('http://x/', {
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
      body: JSON.stringify({ meisai_id: 'm1' }),
    })
  ).then(async (r) => ({ status: r.status, j: await r.json() }));
}

// 11/11 の 形：d1 が 日本時間 11/11 に 2回（17:07 と 22:00）・同じ 日に 別の 車 d2・前の 日の d1・使わない 回
const S1 = Date.parse('2026-11-11T08:07:00.000Z'); // 日本時間 17:07
function db0(o) {
  o = o || {};
  return {
    meisai: [
      {
        id: 'm1',
        user_id: 'u1',
        amount: 14000,
        deleted_at: null,
        extra: { dk_source: 'daikome', dk_ref: 'd1:' + S1 + ':2' },
      },
    ],
    dk_companies: [{ company_id: 'c1', owner_id: 'u1' }],
    dk_company_devices: [
      { company_id: 'c1', device_id: 'd1' },
      { company_id: 'c1', device_id: 'd2' },
    ],
    dk_shifts: [
      {
        shift_id: 'a',
        company_id: 'c1',
        device_id: 'd1',
        started_at: new Date(S1).toISOString(),
        excluded: o.aEx || null,
      },
      {
        shift_id: 'b',
        company_id: 'c1',
        device_id: 'd1',
        started_at: '2026-11-11T13:00:00.000Z',
        excluded: null,
      },
      // 日本時間 11/12 0:00 ちょうど＝次の 日／11/11 0:00 ちょうど＝同じ 日
      {
        shift_id: 'tsugi',
        company_id: 'c1',
        device_id: 'd1',
        started_at: '2026-11-11T15:00:00.000Z',
        excluded: null,
      },
      {
        shift_id: 'atama',
        company_id: 'c1',
        device_id: 'd1',
        started_at: '2026-11-10T15:00:00.000Z',
        excluded: null,
      },
      {
        shift_id: 'mae',
        company_id: 'c1',
        device_id: 'd1',
        started_at: '2026-11-10T14:59:59.999Z',
        excluded: null,
      },
      {
        shift_id: 'tome',
        company_id: 'c1',
        device_id: 'd1',
        started_at: '2026-11-11T10:00:00.000Z',
        excluded: true,
      },
      {
        shift_id: 'd2',
        company_id: 'c1',
        device_id: 'd2',
        started_at: '2026-11-11T09:00:00.000Z',
        excluded: null,
      },
      {
        shift_id: 'yoso',
        company_id: 'c9',
        device_id: 'd1',
        started_at: '2026-11-11T09:30:00.000Z',
        excluded: null,
      },
    ],
    dk_trips: [
      { shift_id: 'a', seq: 1, fare_yen: 4500 },
      { shift_id: 'a', seq: 2, fare_yen: o.seq2 === false ? undefined : 1400 },
    ].filter((t) => t.fare_yen !== undefined),
    dk_shift_edits: ['a', 'b', 'tsugi', 'atama', 'mae', 'tome', 'd2', 'yoso'].map((id) => ({
      shift_id: id,
      seikyu_yen: id === 'b' ? 0 : 5900,
      uriage_yen: null,
    })),
  };
}
const seikyu = (db) => Object.fromEntries(db.dk_shift_edits.map((e) => [e.shift_id, e.seikyu_yen]));

describe('件⑧ dk-fix-fare が 入力の 請求書の 手打ちを 外す（車×日）', () => {
  it('同じ 車・同じ 日本時間の 日・使う 回は 全部 空（0＝請求書なし も）・他は 触らない', async () => {
    const db = db0();
    const r = await yobu(SRC, db);
    expect(r.status).toBe(200);
    expect(r.j.ok).toBe(true);
    expect(r.j.shift_total).toBe(4500 + 14000);
    expect(r.j.seikyu_hazushita).toBe(3);
    expect(seikyu(db)).toEqual({
      a: null,
      b: null,
      atama: null, // 日本時間 0:00 ちょうど＝その 日
      tsugi: 5900, // 次の 日の 0:00
      mae: 5900, // 前の 日の 23:59:59.999
      tome: 5900, // 使わない 印＝欄に 入らない
      d2: 5900, // 別の 車
      yoso: 5900, // よその 会社
    });
  });

  it('直した 回が excluded＝空に しない（止め2）', async () => {
    const db = db0({ aEx: true });
    const r = await yobu(SRC, db);
    expect(r.j.ok).toBe(true);
    expect(r.j.seikyu_hazushita).toBe(0);
    expect(seikyu(db).a).toBe(5900);
    expect(seikyu(db).b).toBe(0);
  });

  it('代行が 見つからない（no_trip）＝何も 直っていない＝手打ちも 残す（止め3）', async () => {
    const db = db0({ seq2: false });
    const r = await yobu(SRC, db);
    expect(r.j.reason).toBe('no_trip');
    expect(seikyu(db).a).toBe(5900);
    expect(seikyu(db).b).toBe(0);
  });

  it('代行を 直せない＝手打ちも 残す（止め3）', async () => {
    const db = db0();
    const r = await yobu(SRC, db, { 'dk_trips:update': true });
    expect(r.status).toBe(500);
    expect(seikyu(db).a).toBe(5900);
  });

  it('外せない＝黙らない（500 seikyu_reset_failed）', async () => {
    const db = db0();
    const r = await yobu(SRC, db, { 'dk_shift_edits:update:seikyu_yen': true });
    expect(r.status).toBe(500);
    expect(r.j.ok).toBe(false);
    expect(r.j.reason).toBe('seikyu_reset_failed');
    expect(r.j.updated).toBe(1); // 代行は 直った＝請求書アプリは「直せたか 分かりません」（もう一度 送るは 出さない）
    expect(seikyu(db).a).toBe(5900);
  });

  it('車×日の 回を 読めない＝黙らない・手打ちは 触らない', async () => {
    const db = db0();
    const r = await yobu(SRC, db, { 'dk_shifts:select:gte': true });
    expect(r.status).toBe(500);
    expect(r.j.reason).toBe('seikyu_reset_failed');
    expect(r.j.at).toBe('kuruma_hi');
    expect(seikyu(db).a).toBe(5900);
  });

  it('手で 入れた 行（駐車場代など）＝何も しない', async () => {
    const db = db0();
    db.meisai[0].extra = {};
    const r = await yobu(SRC, db);
    expect(r.j.reason).toBe('not_daikome');
    expect(seikyu(db).a).toBe(5900);
  });

  it('壊し：その 回だけ／excluded を 見ない／③の 前／UTC の 日 ⇒ 全部 赤', async () => {
    const kowasu = [
      SRC.replace(".in('shift_id', ids)", ".eq('shift_id', shift.shift_id)"),
      SRC.replace('if (shift.excluded !== true) {', 'if (true) {'),
      SRC.replace('const jst = 9 * 3600 * 1000;', 'const jst = 0;'),
    ];
    for (const s of kowasu) {
      expect(s).not.toBe(SRC);
      const a = db0();
      await yobu(s, a);
      const b = db0({ aEx: true });
      await yobu(s, b);
      const ok =
        JSON.stringify(seikyu(a)) ===
          JSON.stringify({
            a: null,
            b: null,
            tsugi: 5900,
            atama: null,
            mae: 5900,
            tome: 5900,
            d2: 5900,
            yoso: 5900,
          }) && seikyu(b).a === 5900;
      expect(ok, s.length).toBe(false);
    }
    // ③の 前へ 動かす＝no_trip でも 消える
    const i = SRC.indexOf('  // ⑥ ');
    const j = SRC.indexOf('  return json({\n    ok: true,');
    const roku = SRC.slice(i, j);
    const mae =
      SRC.slice(0, i).replace(
        '  // ③ その代行1件の',
        roku.replace(/count \|\| 0/g, '0').replace(/shift_total: goukei/g, 'shift_total: 0') +
          '  // ③ その代行1件の'
      ) + SRC.slice(j).replace('seikyu_hazushita: seikyuHazushita', 'seikyu_hazushita: 0');
    const c = db0({ seq2: false });
    await yobu(mae, c);
    expect(seikyu(c).a, '★③の 前でも 赤に ならない★').toBe(null);
  });
});
