'use strict';
// ============================================================
// ★明細の 直しの 2つの 道の 比べの 台本（scripts/kurabe-meisai-naosu.mjs）の 守り★ 2026-11-14 件⑧b
//   台本 本体は テスト倉庫に 当てて 比べる（鍵が 要る＝CI では 走らせない・手元で 走らせた 結果は 紙に）。
//   ここでは 倉庫に 届かない 所を 縛る：
//     ① 向き先は TEST_REF だけ（本番＋--honban・知らない 倉庫＝倉庫へ 1回も 向かわず exit 2）＝子で 走らせ fetch を 数える
//     ② 場面の SQL は 全部 例外で 終わる（取引が 戻る＝倉庫に 残さない）・commit を 含まない
//     ③ Edge の 道（本物の index.ts を 偽の 倉庫で）が 代行・合計・売上の 手打ち・0円の 印を 直す
//     ④ 比べが ずれを 拾う（同じ 姿＝0・1か所 違う＝1）
//   ★わざと壊して 赤に なった 記録（2026-11-14 実測）★ 下の「壊し」の 行を 参照
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const DAIHON = path.join(ROOT, 'scripts', 'kurabe-meisai-naosu.mjs');
const HON = 'tnfwipbgfgjaymlszeid';
const TEST = 'khawdrnvssdenumbiwfg';
const SHIRANAI = 'zzzzzzzzzzzzzzzzzzzz';

let K;
let NISE_DIR;
beforeAll(async () => {
  K = await import(pathToFileURL(DAIHON).href);
  NISE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kurabe-'));
  fs.writeFileSync(
    path.join(NISE_DIR, 'nise-fetch.mjs'),
    "globalThis.fetch = async (u) => { process.stdout.write('NISE_FETCH ' + String(u).slice(0, 80) + '\\n'); throw new Error('nise'); };\n"
  );
});
afterAll(() => NISE_DIR && fs.rmSync(NISE_DIR, { recursive: true, force: true }));

function hashiru(hiki) {
  const r = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(path.join(NISE_DIR, 'nise-fetch.mjs')).href, DAIHON, ...hiki],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { SUPABASE_ACCESS_TOKEN: 'sbp_tsukurimono' }),
    }
  );
  return {
    status: r.status,
    fetchKazu: (r.stdout.match(/^NISE_FETCH /gm) || []).length,
    out: r.stdout + r.stderr,
  };
}

describe('① 向き先の 止め（子で 走らせて 倉庫へ 向かった 数を 数える）', { timeout: 60000 }, () => {
  it('本番＋--honban＝向かわず exit 2', () => {
    const r = hashiru(['--waza-ref', HON, '--honban']);
    expect(r.fetchKazu, r.out).toBe(0);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('--honban でも 止まる');
  });
  it('知らない 倉庫＝向かわず exit 2', () => {
    const r = hashiru(['--waza-ref', SHIRANAI]);
    expect(r.fetchKazu, r.out).toBe(0);
    expect(r.status, r.out).toBe(2);
  });
  it('テスト倉庫＝向かう（止めが 道を 塞いでいる 証し）・行き先は テスト倉庫', () => {
    const r = hashiru([]);
    expect(r.fetchKazu, r.out).toBeGreaterThan(0);
    expect(r.out).toContain('/projects/' + TEST + '/');
    expect(r.out).not.toContain(HON);
  });
  it('URL から ref を 取り直す（作る 所と 見る 所が ずれても 止まる）', () => {
    expect(K.sakiNoTome(K.kakuSaki(TEST))).toBe(null);
    expect(K.sakiNoTome(K.kakuSaki(HON))).toMatch(/^NG/);
    expect(
      K.sakiNoTome('https://api.supabase.com/v1/projects/' + TEST + '/database/query?x=1')
    ).toMatch(/^NG/);
    expect(K.sakiNoTome('https://example.com/v1/projects/' + TEST + '/database/query')).toMatch(
      /^NG/
    );
  });
});

describe('② 場面の SQL は 取引が 戻る 形', () => {
  it('全部 例外で 終わり・commit を 含まず・関数を 事務所の 人として 呼ぶ', () => {
    expect(K.BAMEN.length).toBeGreaterThanOrEqual(5);
    for (const b of K.BAMEN) {
      const s = K.bamenSql(b);
      expect(s).toMatch(/raise exception 'KEKKA%'[^;]*;\s*end \$do\$;\s*$/);
      expect(s).not.toMatch(/\bcommit\b/i);
      expect(s).toContain('set local role authenticated');
      expect(s).toContain('public.dk_meisai_naosu(');
    }
  });
});

// 前の 姿（倉庫から 取った 形と 同じ 字）
const CO = 'c1';
const S1 = '2026-08-01T09:00:00+00:00';
function mae0(o) {
  o = o || {};
  return {
    meisai: [
      {
        id: 'm1',
        user_id: K.UID,
        amount: o.amount === undefined ? 2200 : o.amount,
        deleted_at: null,
        extra: { dk_source: 'daikome', dk_ref: 'd1:' + Date.parse(S1) + ':1', ...(o.extra || {}) },
      },
    ],
    dk_companies: [{ company_id: CO, owner_id: K.UID }],
    dk_company_devices: [{ company_id: CO, device_id: 'd1' }],
    dk_shifts: [
      {
        shift_id: 'a',
        company_id: CO,
        device_id: 'd1',
        started_at: S1,
        excluded: false,
        fare_total_yen: 4000,
      },
    ],
    dk_trips: [
      { shift_id: 'a', seq: 1, fare_yen: 2200 },
      { shift_id: 'a', seq: 2, fare_yen: 1800 },
    ],
    dk_shift_edits: [
      { shift_id: 'a', uriage_yen: 9999, uriage_at: '2026-08-01T10:00:00Z', seikyu_yen: null },
    ],
  };
}
const SRC = fs.readFileSync(path.join(ROOT, 'supabase/functions/dk-fix-fare/index.ts'), 'utf8');

describe('③ Edge の 道（本物の index.ts・偽の 倉庫）', () => {
  it('明細を 直すと 代行・合計・売上の 手打ちが 揃う', async () => {
    const r = await K.edgeNoMichi(SRC, mae0(), { ato: 2500 });
    expect(r.j.ok, JSON.stringify(r.j)).toBe(true);
    const s = K.sugata(r.ato);
    expect(s.meisai).toEqual({ amount: 2500, ryokin_0_kimeta: false });
    expect(s.trips).toEqual({ 'a:1': 2500, 'a:2': 1800 });
    expect(s.goukei).toEqual({ a: 4300 });
    expect(s.edits.a.uriage_yen).toBe(null);
    expect(s.edits.a.uriage_at).toBe(null);
  });
  it('0円＝印が 付く／0円から 直す＝印が 外れる（請求書アプリの saveEdit と 同じ）', async () => {
    const a = await K.edgeNoMichi(SRC, mae0(), { ato: 0 });
    expect(K.sugata(a.ato).meisai).toEqual({ amount: 0, ryokin_0_kimeta: true });
    const b = await K.edgeNoMichi(SRC, mae0({ amount: 0, extra: { ryokin_0_kimeta: true } }), {
      ato: 800,
    });
    expect(K.sugata(b.ato).meisai).toEqual({ amount: 800, ryokin_0_kimeta: false });
    expect(K.zeroNoShirushi({ ryokin_0_kimeta: true }, 0, 0)).toEqual({ ryokin_0_kimeta: true });
    expect(K.zeroNoShirushi({}, 0, 0)).toEqual({});
  });
  it('import の 差し替えが 外れたら 黙らず 落ちる', async () => {
    await expect(K.edgeNoMichi('Deno.env.get("x");', mae0(), { ato: 1 })).rejects.toThrow(
      /Deno.serve/
    );
  });
});

describe('④ 比べが ずれを 拾う', () => {
  it('同じ＝0・1か所 違う＝1（深い 所も）', async () => {
    const r = await K.edgeNoMichi(SRC, mae0(), { ato: 2500 });
    const a = K.sugata(r.ato);
    const b = JSON.parse(JSON.stringify(a));
    expect(K.kuraberu(a, b)).toEqual([]);
    b.edits.a.seikyu_yen = 5000;
    const c = K.kuraberu(a, b);
    expect(c.length).toBe(1);
    expect(c[0]).toContain('edits.a.seikyu_yen');
    const d = JSON.parse(JSON.stringify(a));
    delete d.trips['a:2'];
    expect(K.kuraberu(a, d).length).toBe(1);
  });
});
