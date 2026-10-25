// ============================================================
// scripts/apply-kyuryo-fuda.mjs
// ★本人の 明細を 24時間 パスワード 無しで 見る 札★ 2026-10-21 司さん
//   「パスワードなしで入れる時間を設けてそれこしたら再度パスワード入れ直しは分かる」
//   決め（司さん）＝24時間・会社の 倉庫が 札を 出す（携帯には 期限つきの 札だけ・4桁は 置かない）
//
//   ★当てる 物（1つの 取引で＝片方だけ 入る 間を 作らない・対立役 N2）★
//     ① dk_kyuryo_get … 照らす 所に 札の 枝（p_pw が 'fuda:' で 始まる）を 足した 版
//     ② dk_kyuryo_fuda … パスワードが 合ったら 札を 出す（照らしは dk_kyuryo_verify の 1か所）
//     ③ grant execute on dk_kyuryo_fuda to anon, authenticated
//   ★材料の 関数を 別に 切り出さない★（daikome の 部屋は 外に 出ていて 関数は 既定で 誰でも 呼べる＝対立役 S1）
//
//   ★守り★
//     ・SQL ファイルから 2つの 塊だけ 切り出す（別の 文が 紛れていない・security definer・search_path 固定）
//     ・★md5 の 門★：倉庫の 今の get が「揃えろ」の 版（MAE_SOROERO）か 当てる 版 の 時だけ 当てる
//     ・当てる 塊の md5 が 4桁の 道具に 書いた 版（K4 の ato）と 同じ
//     ・向き先は js/dk-config.js・★本番は --honban を 付けた 時だけ★（scripts/honban-tome.mjs）
//     ・当てた 後 ★読み戻して★ 2つの md5・在って ほしい 字・誰が 呼べるか（proacl）を 数える
//
//   ★出す 順＝倉庫が 先・画面が 後★（古い 画面は 'fuda:' を 送らない＝倉庫だけ 先に 入っても 何も 変わらない）
//   ★戻す 順＝画面が 先・倉庫が 後★（本番前の 対立役 N2）：倉庫の get だけ 古い 版に 戻すと、札を 持つ 端末が
//     'fuda:…' を パスワードとして 送り、開く たびに 間違いを 数えて 3回で 止まる（事務所の 作り直しが 要る）
//   ★本番の 手元（js/dk-config.js が 本番）で 打つ★：--honban なのに 向き先が 本番で ない 時は 止める（対立役 S1）
//
//   使い方:
//     node scripts/apply-kyuryo-fuda.mjs            … 見るだけ
//     node scripts/apply-kyuryo-fuda.mjs --ateru    … テスト線で 当てる
//     node scripts/apply-kyuryo-fuda.mjs --ateru --honban … 本番で 当てる
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readToken, whereWeLooked } from './db-token.mjs';
import { HONBAN_REF, honbanNoTome } from './honban-tome.mjs';
import {
  kiridasu as kiridasuGet,
  kazoeru as kazoeruGet,
  KAZU_RETSU_Q,
  kazuRetsuNoMon,
} from './apply-kyuryo-get.mjs';
import { KANSUU as K4, honbunMd5 } from './apply-kyuryo-pw-4keta.mjs';

// ★倉庫の 今の get＝「揃えろ」の 版（2026-10-20・両方の 倉庫で md5 を 読んだ 2026-10-21）★
export const MAE_SOROERO = 'eb7fe6bb3c31cafa4cd920f9e04d8474';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_FILE = path.join(ROOT, 'supabase', 'apply-kyuryo-honnin-kansuu.sql');
export const GRANT =
  'grant execute on function public.dk_kyuryo_fuda(text, text) to anon, authenticated;';

// ★get の 塊に 在って ほしい 札の 字★
export const FUDA_GET_ARU = [
  ["if p_pw like 'fuda:%' then", '札の 枝'],
  [
    "encode(digest(substr(p_pw, 6), 'sha256'), 'hex')",
    '札は sha256 で 照らす（倉庫に 素の 札を 置かない）',
  ],
  ["split_part(d, '|', 2)::bigint > extract(epoch from now())", '期限を 見る'],
  ["'fuda_kire'", '札が 無い・切れた 時の 訳'],
  ['coalesce(r.device_tokens', 'null の 列でも 落ちない'],
];
// ★fuda の 塊に 在って ほしい 字★
export const FUDA_ARU = [
  [
    'v := public.dk_kyuryo_verify(p_token, p_pw);',
    '照らしは verify の 1か所（3回で 止める を 2か所に 書かない）',
  ],
  ["if (v ->> 'ok') is distinct from 'true' then", '合わなければ verify の 返りを そのまま'],
  ["encode(gen_random_bytes(24), 'hex')", '札は 48桁の 乱数'],
  ["interval '24 hours'", '24時間（司さん）'],
  ["encode(digest(v_fuda, 'sha256'), 'hex')", '倉庫には sha256 だけ'],
  ['limit 4', '期限内の 札は 新しい 4本まで'],
];

// ★dk_kyuryo_fuda の 1本だけを 切り出す★（他の 文が 紛れていたら 投げる）
export function kiridasuFuda(sql) {
  const s = String(sql).replace(/\r\n/g, '\n');
  const re =
    /create or replace function public\.dk_kyuryo_fuda\(p_token text, p_pw text\)\n[\s\S]*?\n\$fn\$;/;
  const m = s.match(re);
  if (!m) throw new Error('dk_kyuryo_fuda の 塊が 見つからない');
  const block = m[0];
  const a = block.indexOf('$fn$');
  const b = block.lastIndexOf('$fn$');
  if (a < 0 || a === b) throw new Error('$fn$ の 囲いが 読めない');
  const soto = block.slice(0, a) + block.slice(b + 4);
  if ((soto.match(/;/g) || []).length !== 1) throw new Error('囲いの 外に 別の 文が 在る');
  if (!/security definer/.test(block.slice(0, a))) throw new Error('security definer が 無い');
  if (!/set search_path = daikome, public, extensions/.test(block.slice(0, a)))
    throw new Error('search_path を 固定していない');
  const naka = block.slice(a + 4, b).replace(/--[^\n]*/g, '');
  const ng = naka.match(
    /\b(insert|delete|drop|truncate|alter|grant|revoke|create|exception|raise)\b/i
  );
  if (ng) throw new Error('札の 関数に ' + ng[0] + ' が 在る');
  // ★書くのは 本人の 鍵の 行（札の 列）だけ★
  for (const u of naka.match(/\bupdate\b\s+\S+/gi) || []) {
    if (!/^update\s+daikome\.dk_kyuryo_pub$/i.test(u.trim()))
      throw new Error('札の 関数に ' + u + ' が 在る');
  }
  return block;
}

function kazoeruIchi(def, list) {
  const d = String(def || '');
  const aru = list.map(([k, w]) => ({ k, w, ok: d.includes(k) }));
  return { aru, ok: d.length > 0 && aru.every((x) => x.ok) };
}
export function kazoeruFudaGet(def) {
  const g = kazoeruGet(def);
  const f = kazoeruIchi(def, FUDA_GET_ARU);
  return { aru: g.aru.concat(f.aru), nai: g.nai, ok: g.ok && f.ok };
}
export function kazoeruFuda(def) {
  return kazoeruIchi(def, FUDA_ARU);
}

// ★当てる 前の 門★（倉庫の 今の get の md5 と 当てる 塊）＝止める 訳の 一覧（空なら 通す）
export function fudaNoMon(getBlock, fudaBlock, kuraGetMd5, kuraVerifyMd5) {
  const ng = [];
  // ★札は 照らしを verify に 任せる＝倉庫の verify が 4桁の 道具に 書いた 版で ない 時は 当てない★（本番前の 対立役 N3）
  const v = K4.find((x) => x.na === 'dk_kyuryo_verify');
  if (!v || kuraVerifyMd5 !== v.ato)
    ng.push(
      '倉庫の verify（' +
        kuraVerifyMd5 +
        '）が 4桁の 道具に 書いた 版（' +
        (v && v.ato) +
        '）と 違う'
    );
  const k = K4.find((x) => x.na === 'dk_kyuryo_get');
  const m = honbunMd5(getBlock);
  if (!k || m !== k.ato)
    ng.push(
      '当てる get の md5（' + m + '）が 4桁の 道具に 書いた 版（' + (k && k.ato) + '）と 違う'
    );
  if (!kazoeruFudaGet(getBlock).ok) ng.push('当てる get に 在って ほしい 字が 足りない');
  if (!kazoeruFuda(fudaBlock).ok) ng.push('当てる fuda に 在って ほしい 字が 足りない');
  if (kuraGetMd5 !== MAE_SOROERO && kuraGetMd5 !== m)
    ng.push('倉庫の 今の get（' + kuraGetMd5 + '）が「揃えろ」の 版でも 当てる 版でも ない');
  return ng;
}

// ★1つの 取引で 送る 字★
export function okuruJi(getBlock, fudaBlock) {
  return ['begin;', getBlock, fudaBlock, GRANT, 'commit;'].join('\n');
}

// ★--honban なのに 向き先が 本番で ない 時は 止める★（本番前の 対立役 S1：テスト線の 手元で 打つと
//   テストの 倉庫に 当たり「OK」が 出て、本番には 何も 入らない）＝止める 訳（無ければ null）
export function honbanNoMuki(ref, args) {
  if (args.includes('--honban') && ref !== HONBAN_REF)
    return (
      'NG: --honban なのに 向き先が 本番で ない（js/dk-config.js は ' +
      ref +
      '）。本番の 手元で 打って ください'
    );
  return null;
}
// ★札の 関数の 形★（security definer・search_path 固定）＝止める 訳の 一覧
export function katachiNoMon(secdef, config) {
  const ng = [];
  if (secdef !== true) ng.push('fuda が security definer で ない');
  if (!/search_path=daikome, public, extensions/.test(String(config || '')))
    ng.push('fuda の search_path が 固定されて いない（' + config + '）');
  return ng;
}

// ★誰が 呼べるか★（anon と authenticated が 在る・知らない 役が 無い）
export function proaclNoMon(acl) {
  const s = String(acl || '');
  const ng = [];
  if (!/(^|[{,])anon=X/.test(s)) ng.push('anon が 呼べない（本人は ログインしていない）');
  if (!/(^|[{,])authenticated=X/.test(s)) ng.push('authenticated が 呼べない');
  return ng;
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
      'User-Agent': 'daikome-apply-kyuryo-fuda',
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

async function yomu(ref, token) {
  const r = await runSql(
    ref,
    token,
    "select md5(g.prosrc) as gm, pg_get_functiondef(g.oid) as gd, md5(f.prosrc) as fm, pg_get_functiondef(f.oid) as fd, f.proacl::text as acl, f.prosecdef as secdef, array_to_string(f.proconfig, ';') as config, (select md5(v.prosrc) from pg_proc v where v.oid = 'public.dk_kyuryo_verify(text,text)'::regprocedure) as vm from pg_proc g left join pg_proc f on f.oid = to_regprocedure('public.dk_kyuryo_fuda(text,text)') where g.oid = 'public.dk_kyuryo_get(text,text,date,date)'::regprocedure"
  );
  if (!r.ok || !r.body || !r.body[0])
    throw new Error('関数を 読めない: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  return r.body[0];
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
  const muki = honbanNoMuki(ref, args);
  if (muki) {
    console.error(muki);
    process.exit(3);
  }
  const tome = honbanNoTome(ref, args, !ateru);
  if (tome) {
    console.error(tome);
    process.exit(3);
  }
  console.log(
    '向き先: ' + (ref === HONBAN_REF ? '★本番★' : 'テスト') + ' ' + ref + ' ／ 鍵: ' + t.from
  );
  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const getBlock = kiridasuGet(sql);
  const fudaBlock = kiridasuFuda(sql);
  const mae = await yomu(ref, t.token);
  console.log(
    '当てる 前: get ' + mae.gm + ' ／ verify ' + mae.vm + ' ／ fuda ' + (mae.fm || '（無い）')
  );
  const ng = fudaNoMon(getBlock, fudaBlock, mae.gm, mae.vm);
  // ★回数・距離の 直しの 列が 無い 倉庫には 当てない★ 2026-10-25（get も 一緒に 当てる＝対立役 2回目 止1）
  const kz = await runSql(ref, t.token, KAZU_RETSU_Q);
  const kzNg = kazuRetsuNoMon(kz.ok ? kz.body : null);
  if (kzNg) ng.push(kzNg);
  if (ng.length) {
    ng.forEach((x) => console.error('  ★門★ ' + x));
    console.error('NG: 門で 止めた。当てていない');
    process.exit(7);
  }
  if (!ateru) {
    console.log('見るだけ（当てるには --ateru）。門は 通る');
    return;
  }
  const r = await runSql(ref, t.token, okuruJi(getBlock, fudaBlock));
  if (!r.ok) {
    console.error('NG: 当てられなかった ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 300));
    process.exit(4);
  }
  const ato = await yomu(ref, t.token);
  const gOk = ato.gm === honbunMd5(getBlock) && kazoeruFudaGet(ato.gd).ok;
  const fOk = ato.fm === honbunMd5(fudaBlock) && kazoeruFuda(ato.fd).ok;
  const aclNg = proaclNoMon(ato.acl).concat(katachiNoMon(ato.secdef, ato.config));
  console.log('当てた 後: get ' + ato.gm + (gOk ? ' 当てた 塊と 同じ' : ' ★違う★'));
  console.log('           fuda ' + ato.fm + (fOk ? ' 当てた 塊と 同じ' : ' ★違う★'));
  console.log(
    '           fuda を 呼べる 役 ' + ato.acl + (aclNg.length ? ' ★' + aclNg.join('・') + '★' : '')
  );
  const ok = gOk && fOk && !aclNg.length;
  console.log('\nKAKUNIN: ' + (ok ? 'OK' : '★NG★'));
  if (!ok) process.exit(5);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error('NG: ' + (e && e.message ? e.message : e));
    process.exit(1);
  });
}
