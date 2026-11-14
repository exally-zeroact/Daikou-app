// ============================================================
// scripts/kurabe-meisai-naosu.mjs
// ★明細の 直しの 2つの 道が 同じ 姿に なるかを 比べる（ずれの 見張り）★ 2026-11-14 件⑧b（設計 4.1）
//
//   同じ 決まりが 2か所に 在る：
//     請求書アプリの 道＝明細を PATCH（0円の 印も）→ Edge dk-fix-fare（supabase/functions/dk-fix-fare/index.ts）
//     入力の 道      ＝倉庫の 関数 public.dk_meisai_naosu（1つの 取引）
//   ★どちらかだけ 直すと 黙って ずれる★＝同じ 準備・同じ 額で 両方を 走らせ、倉庫の 姿を 比べる。
//
//   ★やり方★（テスト倉庫は 明細 0行・持ち主 null＝作り物を 取引の 中で 作る）
//     ① 取引（DO の 塊）の 中で 準備（持ち主・同じ 車×日の 2回目・使わない 回・明細・手打ち）→ 前の 姿を 取る
//        → 事務所の 人として rpc を 呼ぶ → 後の 姿を 取る → ★例外で 全部 戻す★（倉庫には 1行も 残らない）
//     ② 前の 姿を 偽の 倉庫に 写し、請求書アプリと 同じ PATCH（daikou-seikyu.html saveEdit の 0円の 印）をして
//        ★本物の index.ts★を typescript で JS に して 走らせる（esm.sh の import だけ 偽の 倉庫に 差し替え）
//     ③ 明細の 額・0円の 印・代行の 額・業務の 合計・手打ち（売上・請求書）・外した 件数 を 比べる
//
//   ★向き先の 止め（設計 4.1 任意 N1）★ honbanNoTome の --honban 抜けは 使わない＝★TEST_REF だけ★ 通す。
//     ref は ★書く URL から★ 取り直して 見る（URL を 作る 所と 見る 所が ずれても 止まる）。
//     --waza-ref <ref> で 向き先を 替えて 止まる 事を 試す（--honban を 付けても 止まる）。
//
//   使い方:
//     node scripts/kurabe-meisai-naosu.mjs [--edge <index.ts の 道>]   … テスト倉庫で 比べる（倉庫に 残らない）
//     （⑧a の 前の index.ts は ⑥請求書の 手打ち外しが 無い＝請求書の 額で ずれる。⑧a の 後の 頭で 走らせる）
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { TEST_REF } from './honban-tome.mjs';
import { readToken } from './db-token.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// ---------- 向き先 ----------
export function kakuSaki(ref) {
  return 'https://api.supabase.com/v1/projects/' + ref + '/database/query';
}
// 書く URL から ref を 取り直して TEST_REF だけ 通す（--honban は 見ない）
export function sakiNoTome(url) {
  const m = /^https:\/\/api\.supabase\.com\/v1\/projects\/([a-z0-9]{20})\/database\/query$/.exec(
    String(url)
  );
  if (!m) return 'NG: 書く 先の 形が 違う（' + url + '）。1文字も 当てていない';
  if (m[1] !== TEST_REF)
    return (
      'NG: 向き先 ' +
      m[1] +
      ' は テスト倉庫で ない。この 台本は テスト倉庫だけ（--honban でも 止まる）'
    );
  return null;
}

// ---------- 作り物（テスト倉庫の 決まった 行・tameshi で 使った 物と 同じ） ----------
export const UID = '69db352f-a3e3-4651-b02f-93f9f5a8451a';
const CO = '00000000-0000-4000-8000-000000000001';
const DEV = '00000000-0000-4000-9000-000000000001';
const SH1 = '00000000-0000-4000-a000-000000000001'; // 08-01 18:00 JST・回 1=2200 2=1800 3=5800
const SH2 = '00000000-0000-4000-a000-000000000002'; // 別の 車・同じ 日
const SH3 = '00000000-0000-4000-a000-000000000003'; // 同じ 車・08-02（別の 日）
const SHX = '00000000-0000-4000-a000-0000000000b1'; // 作る：同じ 車×日の 2回目（22:00 JST・代行 1件 1000）
const SHE = '00000000-0000-4000-a000-0000000000b2'; // 作る：同じ 車×日の 使わない 回（excluded）
const SH1_MS = Date.parse('2026-08-01T09:00:00Z');
const SHX_MS = Date.parse('2026-08-01T13:00:00Z');
const MID = '11111111-1111-4111-8111-111111111111';

// 比べる 形（どれも 請求書アプリの 道で 起こり得る 直し）
export const BAMEN = [
  {
    na: '回3つの 業務の 1件目 2200→2500（同じ 車×日に 2回目・使わない 回）',
    shift: 'SH1',
    ms: SH1_MS,
    seq: 1,
    mae: 2200,
    ato: 2500,
  },
  { na: '0円に する（0円の 印が 付く）', shift: 'SH1', ms: SH1_MS, seq: 2, mae: 1800, ato: 0 },
  {
    na: '直す 回が 使わない 回（請求書の 手打ちは 外さない）',
    shift: 'SH1',
    ms: SH1_MS,
    seq: 3,
    mae: 5800,
    ato: 6000,
    sh1Ex: true,
  },
  {
    na: '代行 1件の 業務（2回目）1000→1500',
    shift: 'SHX',
    ms: SHX_MS,
    seq: 1,
    mae: 1000,
    ato: 1500,
  },
  {
    na: '0円から 800（0円の 印が 外れる）',
    shift: 'SHX',
    ms: SHX_MS,
    seq: 1,
    mae: 0,
    ato: 800,
    in0: true,
  },
];

const STATE_SQL = `json_build_object(
  'meisai', (select json_agg(json_build_object('id',id,'user_id',user_id,'amount',amount,'extra',extra,'deleted_at',deleted_at)) from daikou.meisai where id='${MID}'),
  'dk_companies', (select json_agg(json_build_object('company_id',company_id,'owner_id',owner_id)) from daikome.dk_companies),
  'dk_company_devices', (select json_agg(json_build_object('company_id',company_id,'device_id',device_id)) from daikome.dk_company_devices),
  'dk_shifts', (select json_agg(json_build_object('shift_id',shift_id,'company_id',company_id,'device_id',device_id,'started_at',started_at,'excluded',excluded,'fare_total_yen',fare_total_yen) order by shift_id) from daikome.dk_shifts where company_id='${CO}'),
  'dk_trips', (select json_agg(json_build_object('shift_id',t.shift_id,'seq',t.seq,'fare_yen',t.fare_yen) order by t.shift_id, t.seq) from daikome.dk_trips t join daikome.dk_shifts s on s.shift_id=t.shift_id where s.company_id='${CO}'),
  'dk_shift_edits', (select json_agg(json_build_object('shift_id',shift_id,'uriage_yen',uriage_yen,'uriage_at',uriage_at,'seikyu_yen',seikyu_yen) order by shift_id) from daikome.dk_shift_edits where company_id='${CO}'))`;

export function bamenSql(b) {
  const sid = b.shift === 'SHX' ? SHX : SH1;
  const extra0 = b.in0 ? `,'ryokin_0_kimeta',true` : '';
  return `do $do$
declare r json; mae json; ato json;
begin
  update daikome.dk_companies set owner_id='${UID}' where company_id='${CO}';
  ${b.sh1Ex ? `update daikome.dk_shifts set excluded=true where shift_id='${SH1}';` : ''}
  insert into daikome.dk_shifts(shift_id,company_id,device_id,started_at,excluded,fare_total_yen) values
    ('${SHX}','${CO}','${DEV}','2026-08-01T13:00:00Z',false,1000),
    ('${SHE}','${CO}','${DEV}','2026-08-01T11:00:00Z',true,500);
  insert into daikome.dk_trips(shift_id,company_id,seq,distance_m,fare_yen) values ('${SHX}','${CO}',1,3000,1000), ('${SHE}','${CO}',1,2000,500);
  ${b.shift === 'SHX' ? `update daikome.dk_trips set fare_yen=${b.mae} where shift_id='${SHX}' and seq=1; update daikome.dk_shifts set fare_total_yen=${b.mae} where shift_id='${SHX}';` : ''}
  insert into daikou.meisai(id,user_id,company,date,amount,extra)
    values ('${MID}','${UID}','くらべ','2026-08-01',${b.mae},
            json_build_object('dk_source','daikome','dk_ref','${DEV}:${b.ms}:${b.seq}'${extra0})::jsonb);
  insert into daikome.dk_shift_edits(shift_id,company_id,uriage_yen,uriage_at,seikyu_yen) values
    ('${SH1}','${CO}',9999,now(),5000), ('${SHX}','${CO}',1200,now(),3000), ('${SHE}','${CO}',null,null,4000),
    ('${SH2}','${CO}',8888,now(),6000), ('${SH3}','${CO}',null,null,7000)
    on conflict (shift_id) do update set uriage_yen=excluded.uriage_yen, uriage_at=excluded.uriage_at, seikyu_yen=excluded.seikyu_yen;
  mae := ${STATE_SQL};
  perform set_config('request.jwt.claims', json_build_object('sub','${UID}','role','authenticated')::text, true);
  set local role authenticated;
  r := public.dk_meisai_naosu('${MID}'::uuid, ${b.ato}, ${b.mae});
  reset role;
  ato := ${STATE_SQL};
  raise exception 'KEKKA%', json_build_object('sid','${sid}','r',r,'mae',mae,'ato',ato);
end $do$;`;
}

// ---------- 偽の 倉庫（tests/unit/dk-fix-fare-seikyu.test.js の nise と 同じ 動き・uid を 渡す） ----------
export function nise(db, uid) {
  function q(table) {
    const st = { f: [], op: 'select', vals: null, sel: false };
    const rows = () => db[table] || (db[table] = []);
    const b = {
      select() {
        st.sel = true;
        return b;
      },
      update(vals) {
        st.op = 'update';
        st.vals = vals;
        return b;
      },
      eq(c, v) {
        st.f.push((r) => r[c] === v);
        return b;
      },
      gte(c, v) {
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
        const hit = rows().filter((r) => st.f.every((fn) => fn(r)));
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
        if (r.data.length > 1)
          return Promise.resolve({ data: null, error: { message: 'nise: 2行' } });
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
      return { auth: { getUser: async () => ({ data: { user: { id: uid } } }) }, from: q };
    },
  };
}

// 請求書アプリの saveEdit（daikou-seikyu.html）と 同じ 0円の 印（欄の 印が 無い 時）
export function zeroNoShirushi(extra, mae, ato) {
  const e = { ...(extra || {}) };
  if (ato === 0 && mae !== 0) e.ryokin_0_kimeta = true;
  else if (ato !== 0) delete e.ryokin_0_kimeta;
  return e;
}

export async function edgeNoMichi(src, mae, b) {
  const ts = require('typescript');
  const db = JSON.parse(JSON.stringify(mae));
  Object.keys(db).forEach((k) => (db[k] = db[k] || []));
  // 倉庫の 時刻の 字（+00:00）を Edge の toISOString と 同じ 字に（eq で 引く 為）
  db.dk_shifts.forEach((s) => (s.started_at = new Date(s.started_at).toISOString()));
  const m = db.meisai[0];
  m.extra = zeroNoShirushi(m.extra, m.amount, b.ato); // ① 請求書アプリの PATCH
  m.amount = b.ato;
  const js = ts.transpileModule(
    src.replace(/^import \{ createClient \} from [^\n]+\n/m, 'const { createClient } = __nise;\n'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  let te = null;
  const Deno = { serve: (h) => (te = h), env: { get: (k) => k } };
  new Function('Deno', '__nise', js)(Deno, nise(db, UID));
  if (!te)
    throw new Error('index.ts の Deno.serve が 呼ばれなかった（import の 差し替えが 外れた）');
  const r = await te(
    new Request('http://x/', {
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
      body: JSON.stringify({ meisai_id: m.id }),
    })
  );
  return { status: r.status, j: await r.json(), ato: db };
}

// 比べる 物だけ 取り出す（時刻の 中身は 比べない＝空か どうかだけ）
export function sugata(st) {
  const by = (a, k) => Object.fromEntries((a || []).map((x) => [k(x), x]));
  const m = (st.meisai || [])[0] || {};
  return {
    meisai: { amount: m.amount, ryokin_0_kimeta: (m.extra || {}).ryokin_0_kimeta === true },
    trips: Object.fromEntries(
      Object.entries(by(st.dk_trips, (t) => t.shift_id + ':' + t.seq)).map(([k, t]) => [
        k,
        t.fare_yen,
      ])
    ),
    goukei: Object.fromEntries((st.dk_shifts || []).map((s) => [s.shift_id, s.fare_total_yen])),
    edits: Object.fromEntries(
      (st.dk_shift_edits || []).map((e) => [
        e.shift_id,
        {
          uriage_yen: e.uriage_yen,
          uriage_at: e.uriage_at == null ? null : 'aru',
          seikyu_yen: e.seikyu_yen,
        },
      ])
    ),
  };
}

export function kuraberu(a, b, saki = '') {
  const chigai = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  keys.forEach((k) => {
    const x = a ? a[k] : undefined;
    const y = b ? b[k] : undefined;
    if (x && y && typeof x === 'object' && typeof y === 'object')
      chigai.push(...kuraberu(x, y, saki + k + '.'));
    else if (x !== y)
      chigai.push(
        saki + k + ': 請求書アプリの道=' + JSON.stringify(x) + ' 入力の道=' + JSON.stringify(y)
      );
  });
  return chigai;
}

// ---------- 走らせる ----------
async function main(args) {
  const i = args.indexOf('--waza-ref');
  const ref = i >= 0 ? args[i + 1] : TEST_REF;
  const url = kakuSaki(ref);
  const tome = sakiNoTome(url);
  if (tome) {
    console.log(tome);
    process.exit(2);
  }
  const e = args.indexOf('--edge');
  const edgePath =
    e >= 0 ? args[e + 1] : path.join(ROOT, 'supabase/functions/dk-fix-fare/index.ts');
  const src = fs.readFileSync(edgePath, 'utf8');
  console.log(
    'Edge の 道＝' +
      edgePath +
      '（⑥請求書の 手打ち外し ' +
      (src.includes('seikyu_hazushita') ? '在り' : '★無い★') +
      '）'
  );
  const t = readToken();
  let dame = 0;
  for (const b of BAMEN) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + t.token,
        'Content-Type': 'application/json',
        'User-Agent': 'daikome-kurabe',
      },
      body: JSON.stringify({ query: bamenSql(b) }),
    });
    const body = await res.text();
    let msg = body;
    try {
      msg = JSON.parse(body).message || body;
    } catch (_) {
      /* 字の まま */
    }
    const k = msg.indexOf('KEKKA');
    if (k < 0) {
      console.log('■ ' + b.na + ' ★取引が 走らなかった★ ' + res.status + ' ' + msg.slice(0, 300));
      dame++;
      continue;
    }
    const kekka = JSON.parse(msg.slice(k + 5).split('\n')[0]);
    const edge = await edgeNoMichi(src, kekka.mae, b);
    const chigai = kuraberu(sugata(edge.ato), sugata(kekka.ato));
    const rj = kekka.r || {};
    ['ok', 'uriage_hazushita', 'seikyu_hazushita', 'shift_total'].forEach((x) => {
      if (edge.j[x] !== rj[x])
        chigai.push(
          '返事.' +
            x +
            ': 請求書アプリの道=' +
            JSON.stringify(edge.j[x]) +
            ' 入力の道=' +
            JSON.stringify(rj[x])
        );
    });
    // 何も 変わっていない のに 一致、を 通さない（直しが 効いた 事も 見る）
    if (sugata(kekka.ato).meisai.amount !== b.ato)
      chigai.push('入力の 道で 明細が ' + b.ato + ' に なっていない');
    console.log(
      '■ ' +
        b.na +
        '：' +
        (chigai.length ? '★ずれ ' + chigai.length + '★' : '一致') +
        ' 返事=' +
        JSON.stringify(rj)
    );
    chigai.forEach((c) => console.log('    ' + c));
    if (chigai.length) dame++;
  }
  // 倉庫に 残っていない 事（明細 0・作った 回 0・持ち主 null）
  const ato = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + t.token,
      'Content-Type': 'application/json',
      'User-Agent': 'daikome-kurabe',
    },
    body: JSON.stringify({
      query: `select (select count(*) from daikou.meisai) m, (select count(*) from daikome.dk_shifts where shift_id in ('${SHX}','${SHE}')) s, (select owner_id from daikome.dk_companies where company_id='${CO}') o, (select count(*) from daikome.dk_shift_edits) e`,
    }),
  }).then((r) => r.text());
  console.log('後（全部 戻ったか＝m 0・s 0・o null・e 0）' + ato);
  const nokori = /"m":0,"s":0,"o":null,"e":0/.test(ato) ? 0 : 1;
  console.log(
    dame || nokori
      ? '★比べ NG＝ずれ ' + dame + '・残り ' + nokori + '★'
      : '比べ OK（' + BAMEN.length + '通り 全部 一致・倉庫に 残り 0）'
  );
  process.exit(dame || nokori ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.log('★止まった★ ' + (e && e.stack ? e.stack : e));
    process.exit(1);
  });
}
