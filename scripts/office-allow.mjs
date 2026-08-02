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

const isMain =
  process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('office-allow.mjs');
if (isMain) {
  const { allow, missing, meterOnly } = buildAllowList();
  if (missing.length) console.error('★画面が見つからない★ ' + missing.join(', '));
  console.log('★事務所で通す物（HTMLから機械で洗い出した）★');
  allow.forEach((p) => console.log('  ' + p));
  console.log('\n★事務所には出さない（メーター専用）★');
  meterOnly.forEach((p) => console.log('  ' + p));
  console.log(`\n合計 ${allow.length} 件`);
}
