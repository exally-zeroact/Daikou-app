// ============================================================
// scripts/db-snapshot.mjs
// ★本番倉庫の「前後で何が動いたか」を機械で突き合わせる（2026-08-02）★
//
//   端から端まで通す時、この倉庫には★他アプリの実データが同居している★
//   （meisai 1,099件 / pay_* / companies …）。
//   「増えたのが想定した表・想定した件数だけ」を目で確かめるのは無理なので機械でやる。
//   ★想定外の表が1行でも動いていたら、そこで止めて報告する★
//
//   使い方（★読むだけ。1行も書かない★）:
//     node scripts/db-snapshot.mjs --save before
//     …作業…
//     node scripts/db-snapshot.mjs --save after
//     node scripts/db-snapshot.mjs --diff before after --expect e2e_stage1
//
//   控えの置き場: %TEMP%\daikome-snapshot-<名前>.json（repoには入れない）
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readToken as readTokenShared } from './db-token.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ─── 想定（何がどれだけ増えてよいか）──────────────────────
//   [最小, 最大]。ここに書いていない表は ★±0 でなければ違反★
export const EXPECT = {
  // 第1段階（①〜③）: 請求書アプリに1社足し、スマホ1台を有効化し、代行を1件流す
  // ★手順1（2026-08-02・司さんが自分で通す版）★
  //
  //   ★どちらを使うかは「通す前の控えを見てから」決める。推測で先に固定しない★
  //     会社が既に有る → step1            （【1】②の登録画面は出ない）
  //     会社がまだ無い → step1_new_company （【1】②で登録する＝dk_companies +1 が正しい通り方）
  //   決め打ちすると、正しく通ったのに赤 という誤判定になる（両方向で起こりうる）。
  //   確かめ方: dk_companies を owner のメールで引く（scripts/db-snapshot.mjs --whose <email>）
  //
  //   共通: 請求書アプリは触らない ＝ companies / meisai は ±0
  step1: {
    dk_company_devices: [1, 1], // QRで有効化するスマホ1台
    dk_shifts: [1, 1], // 業務開始〜終了 1晩
    dk_trips: [1, 2], // 代行1件（走り直したら2件）
    // ★companies / dk_companies / meisai は ±0★
  },

  // 会社がまだ無かった場合（司さんが【1】②で登録する）
  step1_new_company: {
    dk_companies: [1, 1], // ★ここだけ違う★
    dk_company_devices: [1, 1],
    dk_shifts: [1, 1],
    dk_trips: [1, 2],
  },

  //   ★テスト用アカウントで通す（2026-08-02）★ので dk_companies も1件増える
  e2e_stage1: {
    dk_shifts: [1, 1],
    dk_trips: [1, 2],
    companies: [1, 1], // 請求先「テスト建設（消してよい）」
    dk_companies: [1, 1], // ダイコメの会社「テスト代行（消してよい）」
    dk_company_devices: [1, 1], // 予備の端末1台
    meisai: [0, 0], // ★第1段階では絶対に増えない（フラグがオフ）★
  },
  // 第2段階①: フラグを立てて1件流す → meisai が1行だけ増える
  e2e_stage2_first: {
    dk_shifts: [0, 1],
    dk_trips: [0, 2],
    meisai: [1, 1],
  },
  // 第2段階②: ★同じ勤務を再送 → 1行も増えてはいけない（二重請求になる）★
  e2e_stage2_resend: {},
};

function n(v) {
  const x = typeof v === 'number' ? v : parseInt(v, 10);
  return isFinite(x) ? x : null;
}

// ─── 突き合わせ（純ロジック・テスト対象）──────────────────
export function diff(before, after, expect_) {
  const out = { ok: false, violations: [], changes: [] };
  try {
    if (!before || typeof before !== 'object' || !after || typeof after !== 'object') {
      out.violations.push('前後の控えが揃っていない（比べられない）');
      return out;
    }
    const exp = expect_ && typeof expect_ === 'object' ? expect_ : {};
    const names = new Set(Object.keys(before).concat(Object.keys(after)));

    names.forEach(function (t) {
      const b = n(before[t]);
      const a = n(after[t]);

      if (b === null) {
        out.violations.push(`★知らない表が生えている★ ${t}（後だけに在る: ${a}件）`);
        return;
      }
      if (a === null) {
        out.violations.push(`★表が消えている★ ${t}（前: ${b}件）`);
        return;
      }

      const d = a - b;
      if (d !== 0) out.changes.push({ table: t, before: b, after: a, delta: d });

      const range = exp[t] || [0, 0];
      const lo = n(range[0]) === null ? 0 : n(range[0]);
      const hi = n(range[1]) === null ? lo : n(range[1]);

      if (d < lo || d > hi) {
        const want = lo === hi ? `${lo >= 0 ? '+' : ''}${lo}` : `+${lo}〜+${hi}`;
        const got = `${d >= 0 ? '+' : ''}${d}`;
        out.violations.push(
          `${t}: 想定 ${want} なのに ${got}（${b}件 → ${a}件）` +
            (exp[t] ? '' : ' ★動いてはいけない表★')
        );
      }
    });

    out.ok = out.violations.length === 0;
    return out;
  } catch (e) {
    out.violations.push('突き合わせで落ちた: ' + (e && e.message));
    return out;
  }
}

// ─── ここから下は実行部（通信する）──────────────────────
function snapPath(name) {
  const tmp = process.env.TEMP || process.env.TMP || os.tmpdir();
  return path.join(tmp, 'daikome-snapshot-' + String(name).replace(/[^\w-]/g, '') + '.json');
}

// ★探し場所は scripts/db-token.mjs 1箇所だけ (2026-08-02)★
//   道具ごとに書くとズレる。実際にズレて、鍵が有るのに「無い」と誤診断した。
function readToken() {
  const found = readTokenShared();
  return found ? found.token : null;
}

function projectRef() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
  const m = src.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/);
  if (!m) throw new Error('js/dk-config.js から向き先を読めなかった');
  return m[1];
}

// ★読むだけ★ public の全表の行数を数える
async function takeSnapshot() {
  const token = readToken();
  if (!token) throw new Error('鍵が見つからない');
  const ref = projectRef();
  const query = `
    select relname as t, n_live_tup::text as c
      from pg_stat_user_tables
     where schemaname = 'public'
     order by relname`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error('倉庫に届かない ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const rows = await res.json();

  // n_live_tup は推定なので、大事な表だけ正確に数え直す
  const exact = [
    'meisai',
    'companies',
    'dk_shifts',
    'dk_trips',
    'dk_company_devices',
    'dk_companies',
    'dk_manual_days',
    'dk_work_hours',
    'dk_employees',
  ];
  const known = new Set(rows.map((r) => r.t));
  const targets = exact.filter((t) => known.has(t));
  const q2 = targets.map((t) => `select '${t}' t, count(*)::text c from ${t}`).join(' union all ');
  let exactRows = [];
  if (q2) {
    const r2 = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q2 }),
    });
    if (r2.ok) exactRows = await r2.json();
  }

  const snap = {};
  rows.forEach((r) => (snap[r.t] = parseInt(r.c, 10) || 0));
  exactRows.forEach((r) => (snap[r.t] = parseInt(r.c, 10) || 0));

  // ★どちらの想定を使うかを「控えた時の実際の状態」から決められるようにする★
  //   （会社が有るか無いかを覚えておかないと、後で決め打ちになる）
  let owners = [];
  try {
    const q3 = `select u.email, c.name, c.seat_limit,
        (select count(*)::int from dk_company_devices d where d.company_id=c.company_id) as devices
       from dk_companies c join auth.users u on u.id = c.owner_id order by u.email`;
    const r3 = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q3 }),
    });
    if (r3.ok) owners = await r3.json();
  } catch (_) {
    /* 取れなくても控え自体は使える */
  }

  return { ref, at: new Date().toISOString(), tables: snap, companies: owners };
}

async function main() {
  const args = process.argv.slice(2);
  const iSave = args.indexOf('--save');
  const iDiff = args.indexOf('--diff');
  const iExp = args.indexOf('--expect');

  if (iSave >= 0) {
    const name = args[iSave + 1] || 'snap';
    const snap = await takeSnapshot();
    fs.writeFileSync(snapPath(name), JSON.stringify(snap, null, 2), 'utf8');
    const keys = Object.keys(snap.tables);
    console.log(`控えた: ${keys.length}表 / 向き先 ${snap.ref} / ${snap.at}`);
    ['meisai', 'companies', 'dk_shifts', 'dk_trips', 'dk_company_devices'].forEach((t) => {
      if (snap.tables[t] !== undefined) console.log(`  ${t.padEnd(20)} ${snap.tables[t]}件`);
    });
    if (snap.companies && snap.companies.length) {
      console.log('\n― 会社（誰の物か）―  ★どの想定を使うかはここで決める★');
      snap.companies.forEach((c) =>
        console.log(`  ${String(c.email).padEnd(34)} ${c.name} / 有効化済 ${c.devices}台`)
      );
      console.log('  → 通す人の会社が上に有れば --expect step1（dk_companies ±0）');
      console.log('     無ければ --expect step1_new_company（登録するので +1）');
    }
    console.log('→ ' + snapPath(name));
    return;
  }

  if (iDiff >= 0) {
    const a = args[iDiff + 1];
    const b = args[iDiff + 2];
    const expName = iExp >= 0 ? args[iExp + 1] : null;
    const exp = expName ? EXPECT[expName] : {};
    if (expName && !EXPECT[expName]) throw new Error('知らない想定: ' + expName);
    const A = JSON.parse(fs.readFileSync(snapPath(a), 'utf8'));
    const B = JSON.parse(fs.readFileSync(snapPath(b), 'utf8'));
    const r = diff(A.tables, B.tables, exp);

    console.log(`― ${a} → ${b} ―  想定: ${expName || '(何も動かない)'}`);
    if (!r.changes.length) console.log('  動いた表: 無し');
    r.changes.forEach((c) =>
      console.log(`  ${c.table.padEnd(20)} ${c.before} → ${c.after}  (${c.delta > 0 ? '+' : ''}${c.delta})`)
    );
    if (r.ok) {
      console.log('\nDIFF RESULT: OK（想定した表・件数だけが動いた）');
      return;
    }
    console.log('\nDIFF RESULT: ★NG★ 想定外が動いている');
    r.violations.forEach((v) => console.log('  ✗ ' + v));
    process.exit(1);
  }

  console.log('使い方: --save <名前> / --diff <前> <後> [--expect e2e_stage1]');
}

// テストから import された時は実行しない
if (process.argv[1] && process.argv[1].endsWith('db-snapshot.mjs')) {
  main().catch((e) => {
    console.error('NG:', e && e.message ? e.message : e);
    process.exit(1);
  });
}
