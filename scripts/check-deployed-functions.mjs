/* ============================================================
   ★配ってある関数 と repo の中身が同じか★を機械で見る（2026-08-19）

   ★なぜ要るか（実際に起きた事）★
     請求書の行き先を「出発〜経由〜到着」にする直しは 2026-08-09 にテスト線へ入ったのに、
     ★本番の倉庫に配られていなかった★。本番は 08-05 版（到着地だけ）のまま10日 動き続け、
     ★本番の明細は「1地点だけ」で入り続けた★。
     しかも ★本番repo には supabase/functions が1本も無かった★＝何が動いているか追えなかった。

   ★push もCI緑も「客に届いた」ではない★。届いたかは ★配ってある物を読んで★ 確かめる。

   使い方:
     node scripts/check-deployed-functions.mjs            … 数えて表を出す（違えば exit 1）
     SUPABASE_ACCESS_TOKEN=sbp_... node scripts/...       … 鍵を環境変数で渡す

   仕組み:
     ① 向き先(project ref)は ★js/dk-config.js の SB_URL から読む★（repoの向き先以外は見ない）
     ② supabase/functions/<名前>/ ごとに、配ってある中身を Management API で取る
     ③ repo のソースから ★文字列（"..." / '...'）を抜き出して指紋★ にし、
        配ってある中身に全部 在るかを見る
        （配る時に TypeScript は JS へ組み直されるので ★型や書き方は消える★。
          文字列は消えないので、これが一番 素直な突き合わせになる）
     ④ 1つでも欠けていたら ★赤★（＝配り直しが要る）
   ============================================================ */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const FN_DIR = path.join(ROOT, "supabase", "functions");

function projectRef() {
  const cfg = fs.readFileSync(path.join(ROOT, "js", "dk-config.js"), "utf8");
  const m = cfg.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!m) throw new Error("js/dk-config.js から倉庫の向き先(SB_URL)が読めない");
  return m[1];
}

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const tmp = process.env.TEMP || process.env.TMP || "/tmp";
  for (const f of ["daikome-db-token.json", "nomiya-db-url-prod.json", "nomiya-db-url.json"]) {
    const p = path.join(tmp, f);
    if (fs.existsSync(p)) {
      try {
        const t = JSON.parse(fs.readFileSync(p, "utf8")).token;
        if (t) return t;
      } catch (_) {
        /* 次を探す */
      }
    }
  }
  throw new Error(
    "鍵が無い（SUPABASE_ACCESS_TOKEN 環境変数、または %TEMP%\\daikome-db-token.json）"
  );
}

// ソースから「配っても消えない印」を抜く
//   ①文字列リテラル … 組み直しても消えない
//   ★②関数の名前★  … 中身を直した時に増える/消える物。文字列だけだと
//                      「1文字の区切り（〜）を足しただけの直し」を見逃す（実際に危なかった）
export function fingerprint(src, max = 10) {
  const out = [];
  const seen = new Set();
  const push = (s) => {
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  // ②関数の名前（先に入れる＝必ず見る印にする）
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]{3,})\s*\(/g)) push(m[1]);
  // ①文字列リテラル（長い順）
  const lits = [];
  const re = /(['"])((?:\\.|(?!\1)[^\\\n]){12,80})\1/g;
  let m;
  while ((m = re.exec(src))) {
    const s = m[2];
    if (/^[\s\W]*$/.test(s)) continue; // 記号だけは印にしない
    if (/^https?:\/\//.test(s)) continue; // URLは環境で変わる
    lits.push(s);
  }
  lits.sort((a, b) => b.length - a.length).forEach(push);
  return out.slice(0, max);
}

async function api(url, tok, raw) {
  const r = await fetch(url, {
    headers: { Authorization: "Bearer " + tok, "User-Agent": "daikome-check" },
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} ${url}`);
  return raw ? await r.text() : await r.json();
}

async function main() {
  if (!fs.existsSync(FN_DIR)) {
    console.error("★supabase/functions が無い★（配ってある物のソースがrepoに無い状態）");
    process.exit(1);
  }
  const ref = projectRef();
  const tok = token();
  const slugs = fs
    .readdirSync(FN_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const list = await api(`https://api.supabase.com/v1/projects/${ref}/functions`, tok);
  const byslug = new Map(list.map((f) => [f.slug, f]));

  console.log(`倉庫(project) = ${ref}`);
  console.log(`repo の関数 = ${slugs.length}本 / 配ってある関数 = ${list.length}本`);

  let ng = 0;
  for (const slug of slugs) {
    const dir = path.join(FN_DIR, slug);
    const src = fs
      .readdirSync(dir)
      .filter((f) => /\.(ts|js|mjs)$/.test(f))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
    const marks = fingerprint(src);
    const meta = byslug.get(slug);
    if (!meta) {
      console.log(`  ★配られていない★ ${slug}`);
      ng++;
      continue;
    }
    const body = await api(
      `https://api.supabase.com/v1/projects/${ref}/functions/${slug}/body`,
      tok,
      true
    );
    const missing = marks.filter((s) => !body.includes(s));
    const day = new Date(meta.updated_at).toISOString().slice(0, 16).replace("T", " ");
    if (missing.length) {
      ng++;
      console.log(
        `  ★古い/違う★ ${slug} ver${meta.version} 最後に配った日=${day} 印${marks.length}個中★${missing.length}個 欠け★`
      );
      for (const s of missing.slice(0, 3)) console.log(`      欠けている印: 「${s}」`);
    } else {
      console.log(
        `  一致        ${slug} ver${meta.version} 最後に配った日=${day} 印${marks.length}個 全部在り`
      );
    }
  }
  if (ng) {
    console.error(
      `\n★${ng}本が repo と違う＝配り直しが要る★（push も CI緑も「客に届いた」ではない）`
    );
    process.exit(1);
  }
  console.log("\n配ってある物と repo の中身は同じ（全部一致）");
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((e) => {
    console.error("★数えられなかった★:", e.message);
    process.exit(1);
  });
}
