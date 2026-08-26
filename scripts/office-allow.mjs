// ============================================================
// scripts/office-allow.mjs
// ★事務所で通してよい物の一覧を「HTMLから機械で洗い出す」★ 2026-08-02
//
//   ★なぜ作るか（指示役の実測）★
//     事務所は総当たり /:path* でメーターを丸ごと見せ、/sw.js と /index.html だけ
//     名指しで塞いでいた。実測すると、これが全部 200 で出ていた:
//       fare.html / settings.html / history.html / help.html
//       ★manifest.json★ / js/meter.js / js/gps.js / data/coarse-jp.js …
//     ＝★新しい画面が増えるたびに塞ぎ忘れる★形。今回の事故そのもの。
//
//     特に manifest.json が効く。事務所のページが1箇所でも相対参照でこれを読んだ瞬間、
//     ★iPhoneのホーム画面に「事務所」の顔でメーターが入る★。
//
//   ★直し方は逆向き★
//     「名指しで塞ぐ」をやめて「★通す物だけ通す★」にする。
//     通す物は目視で決めない。事務所4画面(+ログイン)のHTMLから参照を機械で拾う。
//     一覧とHTMLがズレたら赤にする（増やし忘れ・減らし忘れの両方）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 事務所が見せる画面（ここが起点）
export const OFFICE_PAGES = [
  'dashboard.html',
  'uriage.html',
  'kyuryo.html',
  'shukei.html',
  'login.html',
];

// HTML から参照を拾う。src= / href= / rel=manifest の行き先。
//   ・http(s):// で始まる外の物は事務所を通らないので対象外
//   ・#... や javascript: や data: も対象外
export function refsIn(html) {
  const out = new Set();
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let u = m[1].trim();
    if (!u) continue;
    if (/^(https?:|data:|javascript:|mailto:|tel:|#)/i.test(u)) continue;
    u = u.split('#')[0].split('?')[0];
    if (!u) continue;
    out.add(u.startsWith('/') ? u : '/' + u);
  }
  return out;
}

// 画面どうしの行き先（location.href = 'kyuryo.html' 等）も拾う。
//   拾わないと「タブを押したら404」になる。
export function pageLinksIn(html) {
  const out = new Set();
  const re = /['"]([A-Za-z0-9_-]+\.html)['"]/g;
  let m;
  while ((m = re.exec(html))) out.add('/' + m[1]);
  return out;
}

// ★JSが 後から読む物★も拾う 2026-08-26
//   ★実際に穴が開いた★:
//     給料明細のPDFで vendor/html2canvas.min.js と vendor/jspdf.umd.min.js を
//     ★押した時に el.src = 'vendor/…' で読む★形にした。
//     refsIn は ★HTMLの src= / href= しか見ない★ので この2本を拾わず、
//     見張りは ★緑のまま★、事務所の住所では ★404★ になった。
//     ＝押しても紙が出ず、保険の window.print()（司さんが突き返した紙）に落ちる。
//   ★決まり「死にファイル判定に src= だけ使うな」の 裏返し★。
//
//   拾い方（★当てずっぽうにしない★）:
//     ①<script> の中の ★コメントを消してから★ 見る（説明文の中のファイル名を拾わない）
//     ②中身が「相対の道」＋「部品の拡張子」の 引用符つきの字だけ
//     ③★そのファイルが 実際に repo に在る物だけ★（綴り違い・作り話を通さない）
const BUHIN = /\.(?:js|mjs|css|woff2?|ttf|otf|png|svg|jpg|jpeg|webp|json)$/i;

export function runtimeRefsIn(html, root = ROOT) {
  const out = new Set();
  // ①コメントを消す（// … と /* … */）
  const nama = html.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  // ②引用符の中の 相対の道
  const re = /['"]((?:\.\/)?(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]{2,5})['"]/g;
  let m;
  while ((m = re.exec(nama))) {
    let u = m[1].trim().replace(/^\.\//, '');
    if (!BUHIN.test(u)) continue;
    if (u.startsWith('/')) u = u.slice(1);
    // ③実物が在る物だけ
    if (!fs.existsSync(path.join(root, u))) continue;
    out.add('/' + u);
  }
  return out;
}

// ★通す物の一覧（HTMLから機械で作る）★
export function buildAllowList(root = ROOT) {
  const allow = new Set(['/']);
  const missing = [];

  for (const p of OFFICE_PAGES) {
    const f = path.join(root, p);
    if (!fs.existsSync(f)) {
      missing.push(p);
      continue;
    }
    allow.add('/' + p);
    const html = fs.readFileSync(f, 'utf8');
    for (const r of refsIn(html)) allow.add(r);
    for (const r of pageLinksIn(html)) allow.add(r);
    for (const r of runtimeRefsIn(html, root)) allow.add(r);
  }

  // ★事務所の画面から行ける先が事務所に無いと、押した瞬間404になる★
  //   ただし「メーターの画面」は事務所に置かない＝ここで落とす。
  const METER_ONLY = new Set([
    '/index.html',
    '/fare.html',
    '/settings.html',
    '/history.html',
    '/help.html',
    '/manifest.json', // ★事務所は office-manifest.json を使う★
    '/sw.js',
  ]);
  for (const m of METER_ONLY) allow.delete(m);

  // アイコンは事務所のホーム画面追加に要る（office-manifest.json が指す）
  allow.add('/office-manifest.json');
  allow.add('/icon-192.png');
  allow.add('/icon-512.png');

  return { allow: Array.from(allow).sort(), missing, meterOnly: Array.from(METER_ONLY).sort() };
}

// 一覧 → Vercel の rewrites（★通す物だけ通し、残りは全部404★）
export function toRewrites(allow, meterBase) {
  const rw = [];
  // 事務所のトップ＝管理画面（メーターの /dashboard.html は308されるので /office/ から取る）
  rw.push({ source: '/', destination: `${meterBase}/office/dashboard.html` });
  for (const p of allow) {
    if (p === '/') continue;
    // 308で送り返される4画面は /office/ 経由（無限ループを避ける）
    const viaOffice = /^\/(dashboard|kyuryo|uriage|shukei)\.html$/.test(p);
    rw.push({ source: p, destination: meterBase + (viaOffice ? '/office' : '') + p });
  }
  // ★最後に総当たりを置かない★＝一覧に無い物は Vercel の404になる
  return rw;
}

// ★どちらの側のメーターを指すか★は 今の設定から読む（側を取り違えない）
export function meterBaseOf(root = ROOT) {
  const f = path.join(root, 'office-host', 'vercel.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const d = j.rewrites && j.rewrites[0] && j.rewrites[0].destination;
  if (!d) throw new Error('★今の行き先が読めない★');
  return new URL(d).origin;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('office-allow.mjs');
if (isMain) {
  const { allow, missing, meterOnly } = buildAllowList();
  if (process.argv.includes('--write')) {
    // ★作り直す★（目で書かない＝増やし忘れ・減らし忘れを止める）
    const base = meterBaseOf();
    const f = path.join(ROOT, 'office-host', 'vercel.json');
    const mae = JSON.parse(fs.readFileSync(f, 'utf8'));
    mae.rewrites = toRewrites(allow, base);
    fs.writeFileSync(f, JSON.stringify(mae, null, 2) + '\n', 'utf8');
    console.log('★書き直しました★', f, '／ 行き先', base, '／', mae.rewrites.length, '件');
    process.exit(0);
  }
  if (missing.length) console.error('★画面が見つからない★ ' + missing.join(', '));
  console.log('★事務所で通す物（HTMLから機械で洗い出した）★');
  allow.forEach((p) => console.log('  ' + p));
  console.log('\n★事務所には出さない（メーター専用）★');
  meterOnly.forEach((p) => console.log('  ' + p));
  console.log(`\n合計 ${allow.length} 件`);
}
