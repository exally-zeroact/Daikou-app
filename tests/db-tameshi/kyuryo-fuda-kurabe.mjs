// ★札（24時間 パスワード 無し）の 比べ★ 2026-10-21（対立役 N4）＝テスト線の 倉庫だけ・必ず rollback で 終わる
//   1つの 取引の 中で：今の dk_kyuryo_get の 返り → 新しい 関数を 当てる（DDL も 取引で 戻る）→
//   新しい get の パスワードの 返り・札の 返り の md5 が 同じか、札の 守りが 効くかを 数える。
//   比べる 人は 3通り：今いる人／辞めた 人で 働いた 日が 在る 人（取引の 中で 名簿から 外す）／範囲が 悪い
//   使い方：node tests/db-tameshi/kyuryo-fuda-kurabe.mjs <worktree> [--kowasu]
//     --kowasu … 新しい get から 鍵を 1つ 抜いて 当てる ⇒ md5 が 違って 赤（終わり値 4）を 見る
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] || '.');
const kowasu = process.argv.includes('--kowasu');
// --miru … 違う 行でも 誤りに せず 全部の 行を 出す（どこが 違うかを 見る 為・終わり値は 6）
const miru = process.argv.includes('--miru');
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const { readToken } = await imp('scripts/db-token.mjs');
const { TEST_REF } = await imp('scripts/honban-tome.mjs');
const { kiridasu } = await imp('scripts/apply-kyuryo-get.mjs');
const { kiridasuFuda, GRANT } = await imp('scripts/apply-kyuryo-fuda.mjs');
const src = fs.readFileSync(path.join(root, 'js', 'dk-config.js'), 'utf8');
const ref = src.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/)[1];
if (ref !== TEST_REF)
  throw new Error('テストの 倉庫 以外には 投げない（' + ref.slice(0, 4) + '…）');

const sql = fs.readFileSync(path.join(root, 'supabase', 'apply-kyuryo-honnin-kansuu.sql'), 'utf8');
let getBlock = kiridasu(sql);
const fudaBlock = kiridasuFuda(sql);
if (kowasu) {
  const a = "'tebikiJippi', true";
  if (getBlock.split(a).length !== 2) throw new Error('壊す 字が 掴めない');
  getBlock = getBlock.replace(a, "'tebikiJippi', false");
}

const G = (tok, pw, from, to) =>
  `md5(public.dk_kyuryo_get('${tok}', ${pw}, ${from}, ${to})::jsonb::text)`;
// 窓は 比べる 人の 勤務の 日から（テスト線は 8月の 数日だけ・辞めた 人の 93日 以内）
const A = '(select a from rng)';
const B = '(select b from rng)';
const RAN = A + ', ' + B;
const q = `begin;
create temp table k (n text, v text, e text);
create temp table m (n text, v text);
create temp table f (fuda text);
-- 今いる人 A（勤務時間の 在る 人）・辞めた 人に する B（勤務時間の 在る 別の 人）
create temp table hito as
  select e.company_id, e.employee_id, row_number() over (order by e.employee_id) as no
  from daikome.dk_employees e
  where e.active and exists (select 1 from daikome.dk_work_hours w where w.employee_id = e.employee_id )
  order by e.employee_id limit 2;
create temp table rng as select min(w.work_date) - 14 as a, min(w.work_date) + 62 as b from daikome.dk_work_hours w where w.employee_id in (select employee_id from hito);
insert into k values ('00 比べる 人が 2人', (select count(*)::text from hito), '2');
delete from daikome.dk_kyuryo_pub where employee_id in (select employee_id from hito);
insert into daikome.dk_kyuryo_pub (token, company_id, employee_id, init_code, pw_hash)
  select 'zz-fuda-' || no, company_id, employee_id, null, extensions.crypt('1234', extensions.gen_salt('bf')) from hito;
update daikome.dk_employees set active = false where employee_id = (select employee_id from hito where no = 2);
-- ① 今の get の 返り
insert into m select 'a', ${G('zz-fuda-1', "'1234'", A, B)};
insert into m select 'b', ${G('zz-fuda-2', "'1234'", A, B)};
insert into m select 'r', ${G('zz-fuda-1', "'1234'", B, A)};
-- ② 新しい 関数を 当てる
${getBlock}
${fudaBlock}
${GRANT}
-- ③ 新しい get の パスワードの 返りが 同じ
insert into k values ('01 今いる人 パスワード 同じ', (select (v = ${G('zz-fuda-1', "'1234'", A, B)})::text from m where n = 'a'), 'true');
insert into k values ('02 辞めた 人 パスワード 同じ', (select (v = ${G('zz-fuda-2', "'1234'", A, B)})::text from m where n = 'b'), 'true');
insert into k values ('03 範囲が 悪い 同じ', (select (v = ${G('zz-fuda-1', "'1234'", B, A)})::text from m where n = 'r'), 'true');
insert into k values ('04 辞めた 人の 返りは taishoku でない', (select (public.dk_kyuryo_get('zz-fuda-2', '1234', ${RAN})::jsonb->>'ok')), 'true');
-- ④ 札を 出す（違う パスワードは verify と 同じ 数え）
insert into k values ('05 違う パスワードで 札は 出ない', (select x->>'reason' || '/' || (x->>'nokori') from (select public.dk_kyuryo_fuda('zz-fuda-1', '0000')::jsonb x) z), 'bad_pw/2');
insert into f select public.dk_kyuryo_fuda('zz-fuda-1', '1234')::jsonb->>'fuda';
insert into k values ('06 札は 48桁の 16進', (select (fuda ~ '^[0-9a-f]{48}$')::text from f), 'true');
insert into k values ('07 合うと 数が 0', (select pw_miss::text from daikome.dk_kyuryo_pub where token = 'zz-fuda-1'), '0');
insert into k values ('08 倉庫に 素の 札は 無い', (select (not exists (select 1 from daikome.dk_kyuryo_pub p, unnest(p.device_tokens) d, f where d like '%' || f.fuda || '%'))::text), 'true');
-- ⑤ 札の 返りが パスワードと 同じ
insert into k values ('09 札で 今いる人 同じ', (select (m.v = ${G('zz-fuda-1', "'fuda:' || f.fuda", A, B)})::text from m, f where m.n = 'a'), 'true');
insert into k values ('10 札で 範囲が 悪い 同じ', (select (m.v = ${G('zz-fuda-1', "'fuda:' || f.fuda", B, A)})::text from m, f where m.n = 'r'), 'true');
-- ⑥ 札の 守り
insert into k values ('11 違う 札は fuda_kire', public.dk_kyuryo_get('zz-fuda-1', 'fuda:' || repeat('0', 48), ${RAN})::jsonb->>'reason', 'fuda_kire');
insert into k values ('12 違う 札は 数えない', (select pw_miss::text from daikome.dk_kyuryo_pub where token = 'zz-fuda-1'), '0');
insert into k values ('13 他の 人の 札では 開かない', (select public.dk_kyuryo_get('zz-fuda-2', 'fuda:' || fuda, ${RAN})::jsonb->>'reason' from f), 'fuda_kire');
insert into k values ('14 空の 札は fuda_kire', public.dk_kyuryo_get('zz-fuda-1', 'fuda:', ${RAN})::jsonb->>'reason', 'fuda_kire');
-- 6回 出すと 期限内は 新しい 5本（4本＋今の 1本）
--   1つの 取引の 中は now() が 同じ＝先の 札の 期限を 100秒 前へ ずらして「一番 古い」に する
update daikome.dk_kyuryo_pub set device_tokens = array(select split_part(d, '|', 1) || '|' || (split_part(d, '|', 2)::bigint - 100) from unnest(device_tokens) d) where token = 'zz-fuda-1';
select public.dk_kyuryo_fuda('zz-fuda-1', '1234') from generate_series(1, 6);
insert into k values ('15 札は 5本まで', (select cardinality(device_tokens)::text from daikome.dk_kyuryo_pub where token = 'zz-fuda-1'), '5');
insert into k values ('16 古い 札は 押し出された', (select public.dk_kyuryo_get('zz-fuda-1', 'fuda:' || fuda, ${RAN})::jsonb->>'reason' from f), 'fuda_kire');
-- 期限が 過ぎた 札
truncate f;
insert into f select public.dk_kyuryo_fuda('zz-fuda-1', '1234')::jsonb->>'fuda';
insert into k values ('17 新しい 札は 開く', (select public.dk_kyuryo_get('zz-fuda-1', 'fuda:' || fuda, ${RAN})::jsonb->>'ok' from f), 'true');
insert into k values ('18 期限は 24時間 先', (select (abs((public.dk_kyuryo_fuda('zz-fuda-1', '1234')::jsonb->>'kigen')::bigint / 1000 - extract(epoch from now() + interval '24 hours')::bigint) <= 5)::text), 'true');
update daikome.dk_kyuryo_pub set device_tokens = array(select split_part(d, '|', 1) || '|' || (extract(epoch from now())::bigint - 1) from unnest(device_tokens) d) where token = 'zz-fuda-1';
insert into k values ('19 期限切れの 札は fuda_kire', (select public.dk_kyuryo_get('zz-fuda-1', 'fuda:' || fuda, ${RAN})::jsonb->>'reason' from f), 'fuda_kire');
-- 作り直し（device_tokens を 空に）で 札が 消える
truncate f;
insert into f select public.dk_kyuryo_fuda('zz-fuda-1', '1234')::jsonb->>'fuda';
update daikome.dk_kyuryo_pub set device_tokens = '{}' where token = 'zz-fuda-1';
insert into k values ('20 作り直すと 札は fuda_kire', (select public.dk_kyuryo_get('zz-fuda-1', 'fuda:' || fuda, ${RAN})::jsonb->>'reason' from f), 'fuda_kire');
-- null の 列でも 落ちない
update daikome.dk_kyuryo_pub set device_tokens = null where token = 'zz-fuda-1';
insert into k values ('21 null の 列で 札は fuda_kire', public.dk_kyuryo_get('zz-fuda-1', 'fuda:abc', ${RAN})::jsonb->>'reason', 'fuda_kire');
insert into k values ('22 null の 列でも 札は 出る', (select (public.dk_kyuryo_fuda('zz-fuda-1', '1234')::jsonb->>'ok')), 'true');
-- 止まった 人は 札でも 開かない・札も 出ない
truncate f;
insert into f select public.dk_kyuryo_fuda('zz-fuda-1', '1234')::jsonb->>'fuda';
update daikome.dk_kyuryo_pub set tomatta_at = now() where token = 'zz-fuda-1';
insert into k values ('23 止まると 札でも 開かない', (select public.dk_kyuryo_get('zz-fuda-1', 'fuda:' || fuda, ${RAN})::jsonb->>'reason' from f), 'tomatta');
insert into k values ('24 止まると 札は 出ない', public.dk_kyuryo_fuda('zz-fuda-1', '1234')::jsonb->>'reason', 'tomatta');
insert into k values ('25 無い token', public.dk_kyuryo_fuda('zz-fuda-nai', '1234')::jsonb->>'reason', 'no_token');
-- 誰が 呼べるか
insert into k values ('26 fuda は anon が 呼べる', (select (proacl::text ~ '(^|[{,])anon=X')::text from pg_proc where oid = 'public.dk_kyuryo_fuda(text,text)'::regprocedure), 'true');
select n, v, e, case when v is distinct from e then ${miru ? "'★NG★'" : '(1 / (random() * 0))::text'} else 'ok' end as kekka from k order by n;
rollback;`;

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + readToken().token,
    'Content-Type': 'application/json',
    'User-Agent': 'dk-tameshi',
  },
  body: JSON.stringify({ query: q }),
});
const body = await r.json().catch(() => null);
if (Array.isArray(body)) body.forEach((x) => console.log(x.kekka, x.n, '=', x.v));
else console.log(r.status, JSON.stringify(body).slice(0, 600));
if (!r.ok) {
  console.error('NG: 倉庫が 誤りを 返した（' + r.status + '）');
  process.exitCode = 4;
} else if (!Array.isArray(body) || body.length === 0) {
  console.error('NG: 結果が 0行（何も 確かめて いない）');
  process.exitCode = 6;
} else if (body.some((x) => x.kekka !== 'ok')) {
  console.error('NG: 見込みと 違う 行が 在る');
  process.exitCode = 6;
} else console.log('全部 ' + body.length + '行 ok');
