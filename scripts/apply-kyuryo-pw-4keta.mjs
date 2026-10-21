// ============================================================
// scripts/apply-kyuryo-pw-4keta.mjs
// ★本人の パスワード 4桁・3回 続けて 間違えたら 止める★ 2026-10-20（docs/pw-4keta.md）
//   司さん 10-19「パスワードは 4桁に しろ」「3回 間違えたら」「新しく URL や QR コードを 作成し直す」・10-20「続けて 3回」
//   本番の 倉庫に 当てて よい＝「1やれ」（この 件だけ）
//
//   ★1つの 取引で 当てる★（列 2つ・窓・関数 6本＝途中まで 入って 止まらない）
//     ① 当てる 前（取引の 中）：6本の md5 が 決めた 前の 版（10-19 夜 の 本番・テスト）か 直した 版か・
//        列が もう 在れば 型が 合うか。違えば 誤りを 投げて 何も 変えない
//     ② 列（alter table … add column if not exists）・窓（with (security_invoker = on) の 1文）・関数 6本
//     ③ commit の 前（取引の 中）：窓の security_invoker・6本の provolatile・作り物の 行で
//        違う→違う→止まる→止まると 正しくても 開かない→合うと 数が 0 に 戻る を 1周（行は 消す）。違えば 誤り＝巻き戻る
//   ★md5 の 門★：切り出した 塊の md5 が ATO（この 道具に 書いた 版）で なければ 当てない（対立役 S2・別の 版を 黙って 運ばない）
//   ★照らす 3本の 守り★（kiridasuPw）：最初の 文が `select … for update`・`exception`／`raise` が 無い（対立役 直4）・
//     null の 守り（is distinct from）・4桁の 形（[0-9]・null を 先に）
//   使い方:
//     node scripts/apply-kyuryo-pw-4keta.mjs                  … 見るだけ
//     node scripts/apply-kyuryo-pw-4keta.mjs --ateru          … テスト線で 当てる
//     node scripts/apply-kyuryo-pw-4keta.mjs --ateru --honban … 本番で 当てる（本番の 手元で）
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken, whereWeLooked } from './db-token.mjs';
import { HONBAN_REF, honbanNoTome } from './honban-tome.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const MAMORI_PW = [['for update;', '最初に 行を 鍵で 取る（GET の rpc で 落ちる・同時でも 順に）']];
const TERASU = [
  [
    'if p_pw is null or r.pw_hash is distinct from crypt(p_pw, r.pw_hash) then',
    '空（null）の パスワードは 必ず 違う',
  ],
  ["return json_build_object('ok', false, 'reason', 'tomatta');", '止まって いれば 照らさない'],
  ['set pw_miss = least(pw_miss + 1, 3),', '違えば 数える'],
  [
    'update daikome.dk_kyuryo_pub set pw_miss = 0 where token = p_token;',
    '合えば 続けての 数を 0 に（続けて 3回）',
  ],
];

export const KANSUU = [
  {
    na: 'dk_kyuryo_pw_set',
    ato: '060f1074548db6184376e7f44846eb82',
    sig: 'dk_kyuryo_pw_set(text, text, text)',
    file: 'supabase/apply-kyuryo-honnin-kansuu.sql',
    atama:
      'create or replace function public.dk_kyuryo_pw_set(p_token text, p_init text, p_pw text)',
    pw: true,
    mae: '44286601d5660d650c35a53391f4425d',
    ARU: [
      ...MAMORI_PW,
      [
        'if p_init is null or r.init_code is distinct from p_init then',
        '空（null）の 初回コードは 必ず 違う',
      ],
      [
        "if p_pw is null or p_pw !~ '^[0-9]{4}$' then",
        '新しい パスワードは 数字 4桁（null・全角を 断る）',
      ],
      ['pw_miss = 0,', '決めたら 数を 0 に'],
    ],
    NAI: [['length(p_pw) < 8', '8文字 以上の 古い 決まり']],
  },
  {
    na: 'dk_kyuryo_verify',
    ato: '18bd0f7dd6164a36429ae7f1a5a02a2c',
    sig: 'dk_kyuryo_verify(text, text)',
    file: 'supabase/apply-kyuryo-honnin-kansuu.sql',
    atama: 'create or replace function public.dk_kyuryo_verify(p_token text, p_pw text)',
    pw: true,
    mae: '1d81c8812b1133ddc8f020ec09414fa3',
    ARU: [...MAMORI_PW, ...TERASU],
    NAI: [],
  },
  {
    na: 'dk_kyuryo_get',
    // 2026-10-20 司さん「揃えろ」＝手入力の 日の 足した 実費（m.expenses）と 印 tebikiJippi を 足した 版。
    //   4桁の 版（f8466f06…）の 倉庫へは scripts/apply-kyuryo-get.mjs が md5 の 門（MAE_4KETA）で 当てる
    // 2026-10-21 司さん「パスワードなしで入れる時間を設けて」＝札の 枝（'fuda:'）を 足した 版。
    //   「揃えろ」の 版（eb7fe6bb…）の 倉庫へは scripts/apply-kyuryo-fuda.mjs が md5 の 門（MAE_SOROERO）で 当てる
    ato: 'f1f6d63ce5e51c52bff9263c7e53ec6c',
    sig: 'dk_kyuryo_get(text, text, date, date)',
    file: 'supabase/apply-kyuryo-honnin-kansuu.sql',
    atama:
      'create or replace function public.dk_kyuryo_get(p_token text, p_pw text, p_from date, p_to date)',
    pw: true,
    mae: '695e805f903928247b788f3f22e9d563',
    ARU: [...MAMORI_PW, ...TERASU, ["'shimeRireki'", '締めの 記録を 返す（10-19 の 版の まま）']],
    NAI: [],
  },
  {
    na: 'dk_kyuryo_saihakkou',
    ato: 'f6f81f237120163be4bc66ab0b281fb1',
    sig: 'dk_kyuryo_saihakkou(uuid)',
    file: 'supabase/apply-kyuryo-haifu.sql',
    atama: 'create or replace function public.dk_kyuryo_saihakkou(p_employee_id uuid)',
    pw: false,
    mae: 'e3bbc487576d4ef1cc6df60134430955',
    ARU: [
      [
        "set token = encode(extensions.gen_random_bytes(16), 'hex'),",
        'token も 作り直す（古い URL は 開かない）',
      ],
      ['tomatta_at = null,', '止めを 消す'],
      ["'not_yours'", 'よその 会社の 人は 作り直さない'],
    ],
    NAI: [],
  },
  {
    na: 'dk_kyuryo_haifu',
    ato: '1b59d110da3da3c5939d86ee841e955c',
    sig: 'dk_kyuryo_haifu()',
    file: 'supabase/apply-kyuryo-haifu.sql',
    atama: 'create or replace function public.dk_kyuryo_haifu()',
    pw: false,
    insertOk: true,
    mae: '5812c9817109e774dbb940a46ab960ee',
    ARU: [['(p.tomatta_at is not null) as tomatta', '一覧に 止まって いるか']],
    NAI: [],
  },
  {
    na: 'dk_kyuryo_haifu_hitori',
    ato: 'fe294336b7148e5ac1abc11fbf885eff',
    sig: 'dk_kyuryo_haifu_hitori(uuid)',
    file: 'supabase/apply-kyuryo-haifu-hitori.sql',
    atama: 'create or replace function public.dk_kyuryo_haifu_hitori(p_employee_id uuid)',
    pw: false,
    insertOk: true,
    mae: 'ce276f7ac275896ab72cabe7171afa3c',
    ARU: [["'tomatta', (p.tomatta_at is not null)", '1人ぶんに 止まって いるか']],
    NAI: [],
  },
];

export function honbunMd5(block) {
  const a = block.indexOf('$fn$');
  const b = block.lastIndexOf('$fn$');
  return crypto
    .createHash('md5')
    .update(block.slice(a + 4, b))
    .digest('hex');
}

// ★その 関数の 塊だけ 切り出す★（囲いの 外に 別の 文が 無い・security definer・search_path 固定・危ない 字が 無い）
export function kiridasu(sql, k) {
  const s = String(sql).replace(/\r\n/g, '\n');
  const a0 = s.indexOf(k.atama + '\n');
  if (a0 < 0) throw new Error(k.na + ' の 塊が 見つからない');
  const owari = s.indexOf('\n$fn$;', a0);
  if (owari < 0) throw new Error(k.na + ' の 終わりが 見つからない');
  const block = s.slice(a0, owari + '\n$fn$;'.length);
  const a = block.indexOf('$fn$');
  const b = block.lastIndexOf('$fn$');
  if (a < 0 || a === b) throw new Error('$fn$ の 囲いが 読めない');
  const soto = block.slice(0, a) + block.slice(b + 4);
  if ((soto.match(/;/g) || []).length !== 1) throw new Error('囲いの 外に 別の 文が 在る');
  if (!/security definer/.test(block.slice(0, a))) throw new Error('security definer が 無い');
  if (!/set search_path = daikome, public, extensions/.test(block.slice(0, a)))
    throw new Error('search_path を 固定していない');
  const naka = block.slice(a + 4, b).replace(/--[^\n]*/g, '');
  const ng = naka.match(/\b(delete|drop|truncate|alter|grant|revoke|create)\b/i);
  if (ng) throw new Error(k.na + ' に ' + ng[0] + ' が 在る');
  const ins = naka.match(/\binsert\b[\s\S]*?;/gi) || [];
  if (ins.length && !k.insertOk) throw new Error(k.na + ' に insert が 在る');
  for (const i of ins) {
    if (
      !/insert into daikome\.dk_kyuryo_pub\b/i.test(i) ||
      !/on conflict[\s\S]*do nothing/i.test(i)
    )
      throw new Error(k.na + ' の insert が dk_kyuryo_pub の on conflict do nothing で ない');
  }
  const ups = naka.match(/\bupdate\b\s+(\S+)/gi) || [];
  for (const u of ups) {
    if (!/update\s+daikome\.dk_kyuryo_pub$/i.test(u.trim()))
      throw new Error(k.na + ' の update が dk_kyuryo_pub で ない: ' + u);
  }
  if (k.pw) {
    // ★照らす 3本の 守り★（対立役 直4）：例外の 受け皿で 25006 を 飲み込めない・最初の 文が 鍵を 取る
    if (/\bexception\b|\braise\b/i.test(naka))
      throw new Error(k.na + ' に exception／raise が 在る（GET の 落ちを 飲み込める）');
    const begin = naka.indexOf('\nbegin\n');
    const ichi = naka
      .slice(begin + 7)
      .split(';')[0]
      .replace(/\s+/g, ' ')
      .trim();
    if (
      !/^select \* into r from daikome\.dk_kyuryo_pub where token = p_token for update$/.test(ichi)
    )
      throw new Error(k.na + ' の 最初の 文が 行を 鍵で 取って いない: ' + ichi.slice(0, 80));
  }
  return block;
}

export function kazoeru(def, k) {
  const d = String(def || '').replace(/\r\n/g, '\n');
  const aru = k.ARU.map(([x, w]) => ({ x, w, ok: d.includes(x) }));
  const nai = k.NAI.map(([x, w]) => ({ x, w, ok: !d.includes(x) }));
  return { aru, nai, ok: d.length > 0 && aru.every((x) => x.ok) && nai.every((x) => x.ok) };
}

// ★表の 列と 窓★（apply-kyuryo-honnin.sql の 印の 間の 2文だけ）
export function hyouToMado(sql) {
  const s = String(sql).replace(/\r\n/g, '\n');
  const a = s.indexOf('alter table daikome.dk_kyuryo_pub\n  add column if not exists pw_miss');
  if (a < 0) throw new Error('列を 足す 文が 見つからない');
  const a2 = s.indexOf(';', a) + 1;
  const alt = s.slice(a, a2);
  const v = s.indexOf(
    'create or replace view public.dk_kyuryo_pub with (security_invoker = on) as\n'
  );
  if (v < 0) throw new Error('窓の 文（security_invoker 付き）が 見つからない');
  const v2 = s.indexOf(';', v) + 1;
  const mado = s.slice(v, v2);
  const ng = (alt + mado)
    .replace(/--[^\n]*/g, '')
    .match(/\b(drop|delete|truncate|grant|revoke|insert|update)\b/i);
  if (ng) throw new Error('表と 窓の 文に ' + ng[0] + ' が 在る');
  if ((alt.match(/;/g) || []).length !== 1 || (mado.match(/;/g) || []).length !== 1)
    throw new Error('表と 窓の 文が 1つずつで ない');
  // ★表と 窓の 直の 権限を 外す 2文★（対立役 本番前 S1）＝字が ちょうど この 2文で ある 事を 見る
  const REVOKE = [
    'revoke all on table daikome.dk_kyuryo_pub from anon, authenticated;',
    'revoke all on table public.dk_kyuryo_pub from anon, authenticated;',
  ];
  REVOKE.forEach((r) => {
    if (!s.includes('\n' + r + '\n') && !s.endsWith('\n' + r))
      throw new Error('直の 権限を 外す 文が 見つからない: ' + r);
  });
  return { alt, mado, revoke: REVOKE.join('\n') };
}

export function blocksOf(root) {
  return KANSUU.map((k) => kiridasu(fs.readFileSync(path.join(root, k.file), 'utf8'), k));
}

// ★取引の 中で 当てる 前に 見る★（6本の md5 が 前の 版か 直した 版・列が 在れば 型）
export function maeNoMon(atoList) {
  const kumi = KANSUU.map(
    (k, i) =>
      `  if (select md5(prosrc) from pg_proc where oid = 'public.${k.sig}'::regprocedure) not in ('${k.mae}', '${atoList[i]}') then\n` +
      `    raise exception 'mae-mon: ${k.na} が 前の 版でも 直した 版でも ない';\n  end if;`
  ).join('\n');
  return `do $mae$\nbegin\n${kumi}\n  -- ★本番に だけ 在る 物★（対立役 本番前 D2）：表を 読む invoker の 関数・別の 窓が 在れば、revoke の 後に 客の 画面が 落ちる
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'daikome') and p.prosrc ilike '%dk_kyuryo_pub%' and not p.prosecdef) then
    raise exception 'mae-mon: 表を 読む security invoker の 関数が 在る';
  end if;
  --   窓は pg_depend で 数える（information_schema.view_table_usage は 本番で 0行を 返した＝持ち主の 見え方で 割れる・10-20 実測）
  if (select count(distinct rw.ev_class) from pg_depend d join pg_rewrite rw on rw.oid = d.objid
       where d.refobjid = 'daikome.dk_kyuryo_pub'::regclass and rw.ev_class <> 'daikome.dk_kyuryo_pub'::regclass) <> 1 then
    raise exception 'mae-mon: 表に 頼る 窓が 1つで ない';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'daikome' and table_name = 'dk_kyuryo_pub' and column_name = 'pw_miss' and data_type <> 'integer') then\n    raise exception 'mae-mon: pw_miss の 型が 違う';\n  end if;\n  if exists (select 1 from information_schema.columns where table_schema = 'daikome' and table_name = 'dk_kyuryo_pub' and column_name = 'tomatta_at' and data_type <> 'timestamp with time zone') then\n    raise exception 'mae-mon: tomatta_at の 型が 違う';\n  end if;\nend\n$mae$;`;
}

// ★commit の 前に 見る★（窓の security_invoker・6本の volatile・作り物の 行で 1周）
export function atoNoMon() {
  const vol = KANSUU.map(
    (k) =>
      `  if (select provolatile from pg_proc where oid = 'public.${k.sig}'::regprocedure) <> 'v' then\n    raise exception 'ato-mon: ${k.na} が volatile で ない';\n  end if;`
  ).join('\n');
  return `do $ato$
declare
  t text := 'zz-pw4keta-tameshi-' || md5(random()::text);
  j json;
begin
  -- ★画面の 鍵（anon・authenticated・public）が 表と 窓に 1つも 権限を 持たない★（列ごとの grant も・対立役 本番前 D1）
  if exists (
    select 1
      from unnest(array['anon', 'authenticated', 'public']) as y(yaku),
           unnest(array['daikome.dk_kyuryo_pub', 'public.dk_kyuryo_pub']) as h(hyou),
           unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as k(ken)
     where has_table_privilege(y.yaku, h.hyou, k.ken)
  ) or exists (
    select 1
      from unnest(array['anon', 'authenticated', 'public']) as y(yaku),
           unnest(array['daikome.dk_kyuryo_pub', 'public.dk_kyuryo_pub']) as h(hyou),
           unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) as k(ken)
     where has_any_column_privilege(y.yaku, h.hyou, k.ken)
  ) then
    raise exception 'ato-mon: 画面の 鍵が 表か 窓を 直に 読み書き できる（表・列の どこかの 権限）';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'dk_kyuryo_pub'
                    and coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=on%') then
    raise exception 'ato-mon: 窓に security_invoker=on が 無い';
  end if;
${vol}
  insert into daikome.dk_kyuryo_pub (token, company_id, employee_id, init_code, pw_hash)
  values (t, gen_random_uuid(), gen_random_uuid(), null, extensions.crypt('1234', extensions.gen_salt('bf')));
  j := public.dk_kyuryo_verify(t, '0000');
  if j->>'reason' is distinct from 'bad_pw' or (j->>'nokori')::int <> 2 then raise exception 'ato-mon: 1回目 %', j; end if;
  j := public.dk_kyuryo_verify(t, '1234');
  if j->>'ok' is distinct from 'true' then raise exception 'ato-mon: 合う %', j; end if;
  if (select pw_miss from daikome.dk_kyuryo_pub where token = t) <> 0 then raise exception 'ato-mon: 合っても 数が 0 に 戻らない'; end if;
  j := public.dk_kyuryo_verify(t, '0000');
  j := public.dk_kyuryo_get(t, '0001', current_date - 30, current_date);
  if j->>'reason' is distinct from 'bad_pw' or (j->>'nokori')::int <> 1 then raise exception 'ato-mon: get で 数えない %', j; end if;
  j := public.dk_kyuryo_verify(t, null);
  if j->>'reason' is distinct from 'tomatta' then raise exception 'ato-mon: 3回目で 止まらない %', j; end if;
  j := public.dk_kyuryo_verify(t, '1234');
  if j->>'reason' is distinct from 'tomatta' then raise exception 'ato-mon: 止まっても 正しいと 開く %', j; end if;
  j := public.dk_kyuryo_get(t, '1234', current_date - 30, current_date);
  if j->>'reason' is distinct from 'tomatta' then raise exception 'ato-mon: get が 止まらない %', j; end if;
  delete from daikome.dk_kyuryo_pub where token = t;
end
$ato$;`;
}

function readProjectRef() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
  const m = src.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/);
  if (!m) throw new Error('js/dk-config.js から向き先を読めなかった');
  return m[1];
}
async function runSql(ref, token, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'daikome-apply-kyuryo-pw-4keta',
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}
async function yomimodosu(ref, token, k) {
  const r = await runSql(
    ref,
    token,
    `select pg_get_functiondef('public.${k.sig}'::regprocedure) as d, md5(p.prosrc) as m from pg_proc p where p.oid = 'public.${k.sig}'::regprocedure`
  );
  if (!r.ok) throw new Error(k.na + ' を 読み戻せない: ' + r.status);
  const row = (r.body && r.body[0]) || {};
  return { d: row.d || '', m: row.m || '' };
}

async function main() {
  const args = process.argv.slice(2);
  const ateru = args.includes('--ateru');
  const t = readToken();
  if (!t) {
    console.error('NG: 鍵が無い（探した所: ' + whereWeLooked().join(' / ') + '）');
    process.exit(2);
  }
  const ref = readProjectRef();
  const tome = honbanNoTome(ref, args, !ateru);
  if (tome) {
    console.error(tome);
    process.exit(3);
  }
  console.log(
    '向き先: ' + (ref === HONBAN_REF ? '★本番★' : 'テスト') + ' ' + ref + ' ／ 鍵: ' + t.from
  );
  const blocks = blocksOf(ROOT);
  const atoList = blocks.map(honbunMd5);
  const { alt, mado, revoke } = hyouToMado(
    fs.readFileSync(path.join(ROOT, 'supabase', 'apply-kyuryo-honnin.sql'), 'utf8')
  );
  let mon = 0;
  for (let i = 0; i < KANSUU.length; i++) {
    const k = KANSUU[i];
    const kz = kazoeru(blocks[i], k);
    if (!kz.ok) {
      console.error('  ★門★ ' + k.na + ' の 塊に 在って ほしい 字が 無い／無くて ほしい 字が 在る');
      mon++;
    }
    const y = await yomimodosu(ref, t.token, k);
    console.log('■ ' + k.na + '  倉庫 md5=' + y.m + '  当てる 塊 md5=' + atoList[i]);
    if (atoList[i] !== k.ato) {
      console.error(
        '  ★門★ 当てる 塊の md5 が この 道具に 書いた 版（' +
          k.ato +
          '）と 違う（別の 版を 黙って 運ばない）'
      );
      mon++;
    }
    if (y.m !== k.mae && y.m !== atoList[i]) {
      console.error('  ★門★ 倉庫の 今の md5 が 前の 版（' + k.mae + '）でも 直した 版でも ない');
      mon++;
    }
  }
  if (mon) {
    console.error('NG: 門で 止めた（' + mon + '）。当てていない');
    process.exit(6);
  }
  if (!ateru) {
    console.log('見るだけ（当てるには --ateru）');
    return;
  }
  const q = ['begin;', maeNoMon(atoList), alt, mado, revoke, ...blocks, atoNoMon(), 'commit;'].join(
    '\n'
  );
  const r = await runSql(ref, t.token, q);
  if (!r.ok) {
    console.error(
      'NG: 当てられなかった（1つの 取引＝何も 変わって いない筈） ' +
        r.status +
        ' ' +
        JSON.stringify(r.body).slice(0, 400)
    );
    process.exit(4);
  }
  console.log('当てた時刻: ' + new Date().toISOString());
  let ng = 0;
  for (let i = 0; i < KANSUU.length; i++) {
    const k = KANSUU[i];
    const y = await yomimodosu(ref, t.token, k);
    const kz = kazoeru(y.d, k);
    console.log(
      '■ ' + k.na + '  md5(後)=' + y.m + (y.m === atoList[i] && kz.ok ? '  OK' : '  ★NG★')
    );
    if (y.m !== atoList[i] || !kz.ok) ng++;
  }
  console.log('KAKUNIN: ' + (ng ? '★NG★ ' + ng + '本' : 'OK'));
  if (ng) process.exit(5);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error('NG: ' + (e && e.message ? e.message : e));
    process.exit(1);
  });
}
