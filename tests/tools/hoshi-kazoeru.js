'use strict';
// ============================================================
// ★★お客さんの 画面に 出る 字に ★ を 出さない＝数える 道具★★ 2026-10-10
//
//   ★なぜ★
//     ★ は 社内の 便りの 印（司さん・指示役・私の やりとり）。
//     お客さんには ★壊れた 字★に 見えます（会社 全部の 決まり・上限を 付けず 0本）。
//     2026-10-09 に Exally の 席から 横断で 渡された：Daikou-app に
//     注記の 外の ★入りの 字の 塊が 39個（9ファイル）＋ HTML の 本文 5行＋ manifest 2本。
//     ★を 数える 門は 無かった（tests/e2e/kyuryo-haifu.spec.js が 画面の 1か所を 見るだけ）。
//
//   ★見る 物★（門は tests/unit/hoshi-nashi.test.js）
//     ①JS の 字の 塊 まるごと＝acorn 8.16.0 の tokenizer で string と template を 全部
//       （画面へ 直に 書く 字・throw の 字・返す 訳・console も 入る＝白名簿 なし）
//       注記は 見ない（経緯は 残して よい）。読めない js は 赤。
//       数 9733（＝0x2605）が 注記の 外に 在れば 赤（fromCharCode / fromCodePoint で 作る 形）。
//     ②HTML は ★頭から 順に 1回で★ 読む（注記 → script → style → タグ → 本文）
//       ・先に 正規表現で script を 抜くと、注記の 中の「<script>」から 次の </script> までを
//         1つと 取り違え、本物の <script src> を 飲み込む（index.html の 注記で 実測・対立役）
//       ・本文・属性・隠れた 所（hidden・display:none）も 数える＝窓は JS が 開く
//       ・style="..." と <style> は CSS の 注記を 外してから 見る（content:"\2605" も 赤）
//     ③manifest（ホーム画面へ 入れる 時の 説明に 出る）
//     ④探す 形＝★ そのもの・★・\u{2605}・&#9733 系（頭の 0・; 無し も）・&#x2605 系・
//       &starf;・&bigstar;・CSS の \2605・%E2%98%85
//
//   ★見る 範囲★
//     git ls-files の *.js *.html と *manifest.json から 下を 除いた 物
//       tests/ scripts/ tools/ docs/ data/ supabase/ vendor/ node_modules/ *.min.js
//       根の 道具の 設定（*.config.js・lighthouserc.js＝試験・lint の 物）
//     ＋ html の <script src> が 指す repo の 中の ファイル（除いた 場所に 在っても 見る）
//       例：scripts/zeroact-test-commons/observability/*.js は 客に 配られている
//     ★data/ だけは src に 在っても 見ない★＝中身は OSM の 店・道の駅の ★本物の 名前★
//       （「ステラ★ほんべつ」「Can★Do」など）で 社内の 印では ない。消すと 名前が 変わる。
//       門の 歯で「data/ には ★が 在る」事を 確かめて、外す 訳が 生きている 事を 見る。
//     ★読み込まれるのに 見ていない js を 作らない★：
//       ・src が repo に 無い ファイルを 指したら 赤
//       ・JS の 字で repo の .js を 名指し（el.src='x.js'・importScripts・sw.js の 先取り 名簿）
//         した 物が 範囲の 外（data/ vendor/ *.min.js を 除く）なら 赤
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const acorn = require('acorn');

const ROOT = path.resolve(__dirname, '..', '..');

// 根の 道具の 設定（試験・lint・Lighthouse）は 客に 出ない＝名前の 形で 除く
const NOZOKU =
  /^(tests|scripts|tools|docs|data|supabase|vendor|node_modules)\/|\.min\.js$|^[\w-]+(\.[\w-]+)*\.config\.(js|mjs|cjs)$|^lighthouserc\.js$/;
const KARIMONO = /^(data|vendor)\/|\.min\.js$/; // 見ない 訳＝上の 説明（data＝本物の 名前・vendor/min＝借り物）

// ★ の 形（字の 生の 書き方で 探す）
const HOSHI =
  /★|\\u0*2605(?![0-9a-f])|\\u\{0*2605\}|&#0*9733(?![0-9])|&#x0*2605(?![0-9a-f])|&starf;|&bigstar;|\\0*2605(?![0-9a-f])|%E2%98%85|%u0*2605(?![0-9a-f])/i;

function cssNoChuukiWoKesu(s) {
  return String(s).replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function gyou(src, i) {
  let n = 1;
  for (let k = 0; k < i && k < src.length; k++) if (src.charCodeAt(k) === 10) n++;
  return n;
}

// ① JS の 字の 塊
function jsWoMiru(src, opt) {
  opt = opt || {};
  const base = opt.base || 0; // 元の ファイルでの 位置（html の script の 時）
  const moto = opt.moto || src;
  const out = { hoshi: [], katamari: 0, yomenai: null, jsNoNamae: [] };
  const toku = (st) =>
    acorn.tokenizer(src, {
      ecmaVersion: 'latest',
      sourceType: st,
      allowHashBang: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowImportExportEverywhere: true,
    });
  let tokens = null;
  for (const st of ['script', 'module']) {
    try {
      tokens = [...toku(st)];
      break;
    } catch (e) {
      out.yomenai = e.message;
    }
  }
  if (!tokens) return out;
  out.yomenai = null;
  for (const t of tokens) {
    const label = t.type.label;
    if (label === 'string' || label === 'template' || label === 'regexp') {
      out.katamari++;
      const nama = src.slice(t.start, t.end);
      if (HOSHI.test(nama) || HOSHI.test(String(t.value))) {
        out.hoshi.push({ gyou: gyou(moto, base + t.start), ji: nama.slice(0, 80) });
      }
      const v = String(t.value);
      if (/^\.?\/?[\w\-./]+\.js(\?[^\s'"]*)?$/.test(v)) out.jsNoNamae.push(v);
    } else if (label === 'num' && Number(t.value) === 9733) {
      out.hoshi.push({ gyou: gyou(moto, base + t.start), ji: '数 9733（★を 数から 作る 形）' });
    }
  }
  return out;
}

// 属性は 全部 並べる（同じ 名前が 2つ 在っても 両方 見る＝ブラウザは 先の 方を 使う）
function zokusei(tagText) {
  const at = [];
  const re = /([^\s=/>"'<]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
  let m;
  const body = tagText.replace(/^<\/?[A-Za-z][^\s/>]*/, '');
  while ((m = re.exec(body))) {
    let v = m[2] == null ? '' : m[2];
    if (/^["']/.test(v)) v = v.slice(1, -1);
    at.push([m[1].toLowerCase(), v]);
  }
  return at;
}

// 属性の 実体参照を 1回 ほどく（ブラウザが 属性を 読む 時と 同じ・&amp;#9733; は &#9733; に なる）
function jitaiWoToku(s) {
  const NAMAE = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (all, x) => {
    if (x[0] === '#') {
      const n = x[1] === 'x' || x[1] === 'X' ? parseInt(x.slice(2), 16) : parseInt(x.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return NAMAE[x.toLowerCase()] != null ? NAMAE[x.toLowerCase()] : all;
  });
}

// タグの 終わり（引用符の 中の > は 飛ばす）
function tagNoOwari(s, i) {
  let q = null;
  for (let k = i + 1; k < s.length; k++) {
    const c = s[k];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '>') return k;
  }
  return -1;
}

// ② HTML を 頭から 順に 1回で 読む
function htmlWoMiru(src) {
  const out = { hoshi: [], katamari: 0, inlineScript: 0, src: [], yomenai: [], jsNoNamae: [] };
  const hit = (i, ji) => out.hoshi.push({ gyou: gyou(src, i), ji: String(ji).slice(0, 80) });
  const honbun = (a, b) => {
    const t = src.slice(a, b);
    if (HOSHI.test(t)) hit(a + t.search(HOSHI), t.slice(Math.max(0, t.search(HOSHI) - 20)));
  };
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      honbun(i, src.length);
      break;
    }
    honbun(i, lt);
    if (src.startsWith('<!--', lt)) {
      // HTML の 決まり：<!--> と <!---> は その場で 閉じる・--!> でも 閉じる
      if (src.startsWith('>', lt + 4)) i = lt + 5;
      else if (src.startsWith('->', lt + 4)) i = lt + 6;
      else {
        const e1 = src.indexOf('-->', lt + 4);
        const e2 = src.indexOf('--!>', lt + 4);
        i = Math.min(e1 < 0 ? Infinity : e1 + 3, e2 < 0 ? Infinity : e2 + 4);
        if (i === Infinity) i = src.length;
      }
      continue;
    }
    if (!/^<\/?[A-Za-z!]/.test(src.slice(lt, lt + 2))) {
      honbun(lt, lt + 1);
      i = lt + 1;
      continue;
    }
    const gt = tagNoOwari(src, lt);
    if (gt < 0) {
      out.yomenai.push('タグが 閉じない 行' + gyou(src, lt));
      break;
    }
    const tag = src.slice(lt, gt + 1);
    const name = (tag.match(/^<\/?([A-Za-z][^\s/>]*)/) || [])[1];
    const at = zokusei(tag);
    // 属性（style は CSS の 注記を 外す・on... は JS として も 読む＝数 9733 で ★ を 作る 形）
    for (const [k, v0] of at) {
      const v = k === 'style' ? cssNoChuukiWoKesu(v0) : v0;
      // on... と javascript: は JS（ブラウザは 実体参照を ほどいてから 走らせる）
      const toita = jitaiWoToku(v);
      // URL は ブラウザが タブ・改行を 取り、頭の 制御文字と 空白を 取ってから 読む（java&#9;script: も 走る）
      let url = toita.replace(/[\t\n\r]/g, '');
      let kashira = 0;
      while (kashira < url.length && url.charCodeAt(kashira) <= 0x20) kashira++;
      url = url.slice(kashira);
      const js = /^on/.test(k)
        ? toita
        : /^javascript:/i.test(url)
          ? url.replace(/^javascript:/i, '')
          : null;
      const fuku = k === 'srcdoc' ? htmlWoMiru(toita) : null; // srcdoc は ほどくと HTML
      if (fuku) {
        // 中の 読めない・src・JS の 名指しも 外へ 渡す（★だけ 見ると 黙る）
        for (const y of fuku.yomenai)
          out.yomenai.push('srcdoc の 中 行' + gyou(src, lt) + '：' + y);
        out.src.push(...fuku.src);
        out.jsNoNamae.push(...fuku.jsNoNamae);
      }
      if (HOSHI.test(v) || HOSHI.test(k)) hit(lt, k + '="' + v + '"');
      else if (fuku && fuku.hoshi.length) hit(lt, k + '="' + v + '"');
      else if (js != null) {
        const r = jsWoMiru(js);
        if (r.yomenai) out.yomenai.push(k + ' 属性が JS として 読めない 行' + gyou(src, lt));
        else if (r.hoshi.length) hit(lt, k + '="' + v + '"');
      }
    }
    const atSrc = (at.find(([k]) => k === 'src') || [])[1];
    const atType = (at.find(([k]) => k === 'type') || [])[1];
    const lname = (name || '').toLowerCase();
    // 中身を 字として そのまま 出す 箱（注記も タグも 効かない）＝閉じる タグまで 全部 本文として 見る
    if (
      !tag.startsWith('</') &&
      /^(textarea|title|xmp|noembed|noframes|iframe|noscript|plaintext)$/.test(lname)
    ) {
      // 閉じタグは </名前 の 後に 空白・/・> の どれか（ブラウザは </textarea foo> でも 閉じる）
      const re2 = new RegExp('</' + lname + '(?=[\\s/>])', 'ig');
      re2.lastIndex = gt + 1;
      const m2 = lname === 'plaintext' ? null : re2.exec(src);
      const gt2 = m2 ? tagNoOwari(src, m2.index) : -1;
      honbun(gt + 1, m2 ? m2.index : src.length);
      if (lname !== 'plaintext' && gt2 < 0) {
        out.yomenai.push(lname + ' が 閉じない 行' + gyou(src, lt)); // 後ろを 全部 飲み込む＝黙らない
      }
      i = gt2 < 0 ? src.length : gt2 + 1;
      continue;
    }
    if (!tag.startsWith('</') && (lname === 'script' || lname === 'style')) {
      // 閉じタグは 字の 箱と 同じ 探し方（</script/> でも 閉じる）・閉じなければ 読めない
      const re = new RegExp('</' + lname + '(?=[\\s/>])', 'ig');
      re.lastIndex = gt + 1;
      const m = re.exec(src);
      const gtm = m ? tagNoOwari(src, m.index) : -1;
      if (gtm < 0) out.yomenai.push(lname + ' が 閉じない 行' + gyou(src, lt));
      const end = m ? m.index : src.length;
      const naka = src.slice(gt + 1, end);
      if (lname === 'style') {
        const c = cssNoChuukiWoKesu(naka);
        if (HOSHI.test(c))
          hit(gt + 1 + naka.search(HOSHI), c.slice(c.search(HOSHI), c.search(HOSHI) + 60));
      } else if (atSrc !== undefined) {
        out.src.push(atSrc);
        if (naka.trim() && HOSHI.test(naka)) hit(gt + 1, naka);
      } else {
        const type = (atType || '').toLowerCase();
        out.inlineScript++;
        if (/json/.test(type)) {
          if (HOSHI.test(naka)) hit(gt + 1, naka.slice(naka.search(HOSHI)));
        } else if (!type || /javascript|module|ecmascript/.test(type)) {
          const r = jsWoMiru(naka, { base: gt + 1, moto: src });
          if (r.yomenai) out.yomenai.push('script 行' + gyou(src, gt + 1) + '：' + r.yomenai);
          out.hoshi.push(...r.hoshi);
          out.katamari += r.katamari;
          out.jsNoNamae.push(...r.jsNoNamae);
        } else if (HOSHI.test(naka)) {
          hit(gt + 1, naka.slice(naka.search(HOSHI))); // text/template 等＝HTML として 出る
        }
      }
      i = gtm < 0 ? src.length : gtm + 1;
      continue;
    }
    i = gt + 1;
  }
  return out;
}

function gitNoFile() {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
}

function yomu(f) {
  return fs.readFileSync(path.join(ROOT, f), 'utf8');
}

function srcWoRepoNoNamaeNi(s, karaFile) {
  if (/^(https?:)?\/\//i.test(s) || /^data:/i.test(s)) return null; // 外の URL＝別の 枠
  const p = s.split(/[?#]/)[0];
  const base = p.startsWith('/') ? '' : path.posix.dirname(karaFile);
  return path.posix.normalize(path.posix.join(base === '.' ? '' : base, p.replace(/^\//, '')));
}

// 範囲を 決めて 全部 数える
function zenbuKazoeru() {
  const all = gitNoFile();
  const aru = new Set(all);
  const kihon = all.filter(
    (f) => (/\.(js|html)$/.test(f) || /(^|\/)[\w-]*manifest\.json$/.test(f)) && !NOZOKU.test(f)
  );
  const hani = new Set(kihon);
  const kekka = {
    kotoni: {}, // ファイルごとの 字の 塊の 数（痩せを ファイル ごとに 見る）
    sotoSrc: [], // html が 読むのに 見ない 物（data/ vendor/ *.min.js）＝門で 名簿と 突き合わせる
    hoshi: [],
    katamari: 0,
    inlineScript: 0,
    yomenai: [],
    minaiSrc: [],
    nakuSrc: [],
    js: 0,
    html: 0,
    json: 0,
  };
  const jsNoNamae = [];
  // html から 指される 物を 範囲へ（data/ vendor/ *.min.js を 除く）
  // kyuu へは hani に 足した 時だけ 入れる＝同じ ファイルを 2回 読まない
  const kyuu = [...hani];
  while (kyuu.length) {
    const f = kyuu.shift();
    const src = yomu(f);
    let r;
    if (f.endsWith('.html')) {
      kekka.html++;
      r = htmlWoMiru(src);
      kekka.inlineScript += r.inlineScript;
      for (const y of r.yomenai) kekka.yomenai.push(f + '：' + y);
      for (const s of r.src) {
        const p = srcWoRepoNoNamaeNi(s, f); // 外の URL は 無し（別の 枠）
        if (p && !aru.has(p)) kekka.nakuSrc.push(f + ' → ' + s);
        else if (p && KARIMONO.test(p)) kekka.sotoSrc.push(p);
        else if (p && !hani.has(p)) {
          hani.add(p);
          kyuu.push(p);
        }
      }
    } else if (f.endsWith('.json')) {
      kekka.json++;
      r = { hoshi: [], katamari: 0 };
      src.split('\n').forEach((l, k) => {
        if (HOSHI.test(l)) r.hoshi.push({ gyou: k + 1, ji: l.trim().slice(0, 80) });
      });
    } else {
      kekka.js++;
      r = jsWoMiru(src);
      if (r.yomenai) kekka.yomenai.push(f + '：' + r.yomenai);
    }
    kekka.katamari += r.katamari || 0;
    kekka.kotoni[f] = r.katamari || 0;
    jsNoNamae.push(...(r.jsNoNamae || []).map((v) => [f, v]));
    for (const h of r.hoshi) kekka.hoshi.push(f + ':' + h.gyou + '  ' + h.ji.replace(/\s+/g, ' '));
  }
  // JS の 字で 名指しされた repo の .js が 範囲の 外なら 赤
  for (const [f, v] of jsNoNamae) {
    for (const p of [
      srcWoRepoNoNamaeNi(v, f),
      srcWoRepoNoNamaeNi('/' + v.replace(/^\.?\//, ''), f),
    ]) {
      if (p && aru.has(p) && !KARIMONO.test(p) && !hani.has(p)) kekka.minaiSrc.push(f + ' → ' + v);
      else if (p && aru.has(p) && KARIMONO.test(p)) kekka.sotoSrc.push(p); // JS が 読む 見ない 物も 名簿へ
    }
  }
  kekka.hani = [...hani].sort();
  kekka.sotoSrc = [...new Set(kekka.sotoSrc)].sort();
  return kekka;
}

module.exports = { HOSHI, jsWoMiru, htmlWoMiru, zenbuKazoeru, ROOT };

if (require.main === module) {
  const k = zenbuKazoeru();
  for (const h of k.hoshi) console.log(h);
  for (const y of k.yomenai) console.log('読めない ' + y);
  for (const y of k.nakuSrc) console.log('無い src ' + y);
  for (const y of k.minaiSrc) console.log('見ていない js ' + y);
  console.log(
    `範囲=${k.hani.length}（js ${k.js}・html ${k.html}・manifest ${k.json}）inline script=${k.inlineScript} 字の塊=${k.katamari} ★=${k.hoshi.length} 読めない=${k.yomenai.length} 無いsrc=${k.nakuSrc.length} 見ていないjs=${k.minaiSrc.length}`
  );
}
