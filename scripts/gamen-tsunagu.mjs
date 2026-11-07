// ============================================================
// ★配る 1枚（js/kyuryo.js・index.html）を 節ごとの 枚（kyuryo-src/・index-src/）に 割って 置く 共通の 道具★
//   2026-11-07 件2（kyuryo）→ 2026-11-08 件3 で 一般化（index.html・設計前 taiketsu 任1）
//
//   ★配る 物は 今の まま 1枚★。*-src/ は ★同じ 字を 行で 切っただけ★ の 写し（読む・直す・枚ごとの git log の ため）。
//   配る 物を 割ると 古い SW の 端末が 割った 物を 古い 控えへ 入れて 圏外で 真っ白に なる（件3 設計 v0/v1 の 止め）
//   ⇒ 配る 物・sw.js・試験の 読み方は 1字も 変えない。
//
//   ★いつも 成り立つ 2つ★（試験 tests/unit/kyuryo-tsunagu.test.js・index-tsunagu.test.js が 縛る）
//     ①*-src/ の 枚を 名の 順に 繋ぐ ＝ 配る 1枚（バイト 一致）
//     ②*-src/ ＝ wari(配る 1枚)（決まった 所で 割った 物・目次 MOKUJI.md も）
//
//   ★どちらを 直しても よい★（.husky/pre-commit が もう 一方を 作り直す）
//     ・枚を 直す         → --mae が 繋いで 配る 1枚を 書く
//     ・配る 1枚を 直す   → --ato が 割り直して 枚を 書く
//     ・両方 直して ずれる → 止める（片方の 直しが 黙って 消える）
//     ・stage していない 直しが 在る → 止める（別の 件の 書きかけを 混ぜない）
//
//   makeGamen(設定) が 画面 1つ分の 道具（wari・namae・mae・ato…）を 返す。
//   呼び口＝scripts/kyuryo-tsunagu.mjs・scripts/index-tsunagu.mjs（.husky と 試験は 呼び口の 名で 呼ぶ）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function makeGamen(cfg) {
  const ROOT = cfg.root;
  const JS = cfg.file; // 配る 1枚（名は 件2 の 名残で JS）
  const SRC = cfg.src;
  const MOKUJI = 'MOKUJI.md';
  const HABA = cfg.haba;
  const SHIRI = 10;
  const SAIDAI = 9999;
  const EXTS = cfg.exts; // 枚の 拡張子
  const NA = new RegExp(`^\\d{4}\\.(${EXTS.join('|')})$`);
  const isEda = (n) => EXTS.some((x) => n.endsWith('.' + x)); // 枚らしい 名（名の 形は zure が 見る）
  const kaku1 = (n, ext) => String(n).padStart(4, '0') + '.' + ext;
  const extOf = (n) => n.slice(n.lastIndexOf('.') + 1);

  // 割る：{parts, exts}（exts＝各枚の 拡張子）
  const wariX = (text) => {
    const r = cfg.wari(text);
    return Array.isArray(r) ? { parts: r, exts: r.map(() => EXTS[0]) } : r;
  };
  const wari = (text) => wariX(text).parts;
  const na = (k, ext = EXTS[0]) => kaku1(k * HABA, ext);
  // 見出しの 字（無ければ null）
  const midashiOf = (p, ext) => cfg.midashi(p, ext);
  const midashiKey = (p, ext) => {
    const m = midashiOf(p, ext);
    if (m) return m;
    return cfg.midashiNashiWaChikasa ? null : '（頭）';
  };

  // 2枚の 中身の 近さ＝同じ 行（空行を 除く）の 数
  function chikasa(a, b) {
    const s = new Set(a.split('\n').filter((l) => l.trim()));
    return b.split('\n').filter((l) => l.trim() && s.has(l)).length;
  }

  // ★枚の 名を 引き継ぐ★（件2 設計前 taiketsu 止2・注10・注11）
  //   名を 並び順で 付け直すと、間に 節を 足した 時に 後ろの 枚が みな「名は そのまま・中身は 隣の 節」に なり
  //   枚ごとの git log が 混ざる。⇒ ①見出しの 字で 前の 枚に 当てる ②当たらない 物は 同じ 間に 在った 前の 枚の うち
  //   ★中身が 一番 近い 物★（同じ 行が 半分 以上）の 名を 使う ③それでも 当たらない（新しい 節）時だけ 間の 番号を 付ける。
  //   見出しの 無い 枚は（設定 midashiNashiWaChikasa の 時）①を 飛ばして ②から 当てる（件3 設計前 taiketsu 注1）。
  //   番号の 間が 尽きたら 全部を 振り直す（その commit だけ 履歴が 名替えに なる・furinaoshi で 知らせる）。
  function namae(parts, oldNames = [], oldParts = [], exts = parts.map(() => EXTS[0])) {
    const zenbu = () =>
      // 印は 数えない 持ち物（配列の 中身の 比べに 混ざらない）
      Object.defineProperty(
        parts.map((_, k) => na(k, exts[k])),
        'furinaoshi',
        { value: oldNames.length > 0 }
      );
    if (!oldNames.length || !oldNames.every((n) => NA.test(n))) return zenbu();
    const num = (n) => Number(n.slice(0, 4));
    if (new Set(oldNames.map(num)).size !== oldNames.length) return zenbu();
    const oldP = new Map(oldNames.map((n, k) => [n, oldParts[k]]));
    const oldH = new Map();
    oldNames.forEach((n) => {
      const h = midashiKey(oldP.get(n), extOf(n));
      if (h === null) return;
      if (!oldH.has(h)) oldH.set(h, []);
      oldH.get(h).push(n);
    });
    const as = parts.map(() => null); // 当てた 番号（数）
    const tsukatta = new Set();
    let mae = -1;
    parts.forEach((p, k) => {
      const h = midashiKey(p, exts[k]);
      if (h === null) return;
      const c = (oldH.get(h) || []).find((n) => !tsukatta.has(n) && num(n) > mae);
      if (c) {
        as[k] = num(c);
        tsukatta.add(c);
        mae = num(c);
      }
    });
    // ①' 中身が 全く 同じ 枚を 並びを 守って 当てる（最長共通部分列・見出しの 無い 枚が 多い 画面だけ）
    //   近さ（②）は 左から 貪る ので、足した 塊の 枚（「</script>」1行 等）が 隣の 枚の 名を 先に 取る（件3 試験で 見た）
    if (cfg.midashiNashiWaChikasa) {
      let q = 0;
      while (q < parts.length) {
        if (as[q] !== null) {
          q++;
          continue;
        }
        let e = q;
        while (e < parts.length && as[e] === null) e++;
        const lo = q > 0 ? as[q - 1] : -1;
        const hi = e < parts.length ? as[e] : Infinity;
        const am = oldNames.filter((n) => !tsukatta.has(n) && num(n) > lo && num(n) < hi);
        const m = e - q,
          o = am.length;
        const dp = Array.from({ length: m + 1 }, () => new Int32Array(o + 1));
        for (let i = m - 1; i >= 0; i--)
          for (let j = o - 1; j >= 0; j--)
            dp[i][j] =
              parts[q + i] === oldP.get(am[j])
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        let i = 0,
          j = 0;
        while (i < m && j < o) {
          if (parts[q + i] === oldP.get(am[j]) && dp[i][j] === dp[i + 1][j + 1] + 1) {
            as[q + i] = num(am[j]);
            tsukatta.add(am[j]);
            i++;
            j++;
          } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
          else j++;
        }
        q = e;
      }
    }
    let k = 0;
    while (k < parts.length) {
      if (as[k] !== null) {
        k++;
        continue;
      }
      let e = k;
      while (e < parts.length && as[e] === null) e++;
      const lo = k > 0 ? as[k - 1] : -1;
      const hi = e < parts.length ? as[e] : null; // null＝尻
      const amari = oldNames.filter(
        (n) => !tsukatta.has(n) && num(n) > lo && (hi === null || num(n) < hi)
      );
      const m = e - k;
      // ② 中身の 近さで 当てる（並びは 守る＝後ろの 物ほど 大きい 名）
      const ireru = Array(m).fill(null);
      let j0 = 0;
      for (let i = 0; i < m; i++) {
        let best = -1,
          bestV = 0;
        const nagasa = parts[k + i].split('\n').filter((l) => l.trim()).length;
        for (let j = j0; j < amari.length; j++) {
          const v = chikasa(oldP.get(amari[j]), parts[k + i]);
          if (v > bestV && v * 2 >= nagasa) {
            best = j;
            bestV = v;
          }
        }
        if (best >= 0) {
          ireru[i] = num(amari[best]);
          tsukatta.add(amari[best]);
          j0 = best + 1;
        }
      }
      // ③ 新しい 番号（間は 等しく 割る・尻は 10 ずつ）
      for (let i = 0; i < m; i++) {
        if (ireru[i] !== null) continue;
        const a = i > 0 ? ireru[i - 1] : lo;
        let j = i;
        while (j < m && ireru[j] === null) j++;
        const cnt = j - i;
        if (j === m && hi === null) {
          for (let q = 0; q < cnt; q++) ireru[i + q] = a + SHIRI * (q + 1);
          if (ireru[m - 1] > SAIDAI) return zenbu();
        } else {
          const b = j < m ? ireru[j] : hi;
          if (b - a - 1 < cnt) return zenbu();
          for (let q = 0; q < cnt; q++)
            ireru[i + q] = a + Math.floor(((b - a) * (q + 1)) / (cnt + 1));
        }
        i = j - 1;
      }
      ireru.forEach((v, q) => {
        as[k + q] = v;
      });
      k = e;
    }
    return as.map((v, q) => kaku1(v, exts[q]));
  }

  function tsunagu(parts) {
    return parts.join('');
  }

  function mokuji(parts, names = parts.map((_, k) => na(k)), exts = names.map(extOf)) {
    let gyo = 1;
    const out = [...cfg.mokujiAtama];
    parts.forEach((p, k) => {
      const n = p.split('\n').length - 1;
      out.push(`| ${names[k]} | ${gyo}–${gyo + n - 1} | ${cfg.mokujiMidashi(p, exts[k])} |`);
      gyo += n;
    });
    return out.join('\n') + '\n';
  }

  // 作業木の 枚（名の 順）
  function yomuSrc(root) {
    const d = path.join(root, SRC);
    if (!fs.existsSync(d)) return { names: [], parts: [], moku: null };
    const names = fs.readdirSync(d).filter(isEda).sort();
    const mp = path.join(d, MOKUJI);
    return {
      names,
      parts: names.map((n) => fs.readFileSync(path.join(d, n), 'utf8')),
      moku: fs.existsSync(mp) ? fs.readFileSync(mp, 'utf8') : null,
    };
  }

  // ①② の ずれを 数える（空なら 正しい）
  function zure(js, names, parts, moku) {
    const z = [];
    const { parts: want, exts } = wariX(js);
    if (tsunagu(parts) !== js) z.push(`${SRC} を 繋いだ 物 ≠ ${JS}`);
    if (!names.every((n) => NA.test(n))) z.push(`枚の 名が 4桁の 数で ない`);
    else if (new Set(names.map((n) => n.slice(0, 4))).size !== names.length)
      z.push(`枚の 番号が 重なっている`);
    if (names.length !== want.length) z.push(`枚の 数 ${names.length} ≠ 割った 物 ${want.length}`);
    else {
      want.forEach((p, k) => p !== parts[k] && z.push(`${SRC}/${names[k]} ≠ 割った 物`));
      if (EXTS.length > 1)
        names.forEach(
          (n, k) => extOf(n) !== exts[k] && z.push(`${SRC}/${n} の 拡張子 ≠ 中身（${exts[k]}）`)
        );
      if (moku !== mokuji(want, names, exts)) z.push(`${SRC}/${MOKUJI} が ずれている`);
    }
    return z;
  }

  function kaku(root, parts, names) {
    const d = path.join(root, SRC);
    fs.mkdirSync(d, { recursive: true });
    const nokosu = new Set(names);
    for (const n of fs.readdirSync(d)) if (isEda(n) && !nokosu.has(n)) fs.rmSync(path.join(d, n));
    parts.forEach((p, k) => {
      const f = path.join(d, names[k]);
      if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== p) fs.writeFileSync(f, p);
    });
    const m = mokuji(parts, names);
    const mp = path.join(d, MOKUJI);
    if (!fs.existsSync(mp) || fs.readFileSync(mp, 'utf8') !== m) fs.writeFileSync(mp, m);
  }

  // ---- git の index と HEAD の 字（pre-commit 用・作業木は 信じない） ----
  // 試験の 一時 repo では 呼ぶ 側が GIT_* を 外した env を 渡す（tests/lib/kari-git.js・本物の repo を 書き換えない）。
  // 門（pre-commit）では 渡さない＝git が 渡す GIT_INDEX_FILE 等で 本物の index を 見る。
  let KANKYO;
  const git = (root, args, opt = {}) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      env: KANKYO,
      ...opt,
    });
  const aru = (root, rev) => {
    try {
      git(root, ['cat-file', '-e', rev], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  function srcAt(root, rev) {
    // rev＝'' は index、'HEAD' は HEAD
    const ls =
      rev === ''
        ? git(root, ['ls-files', '--', SRC])
        : aru(root, 'HEAD')
          ? git(root, ['ls-tree', '-r', '--name-only', 'HEAD', '--', SRC])
          : '';
    const names = ls
      .split('\n')
      .filter((p) => p && isEda(p))
      .map((p) => p.slice(SRC.length + 1))
      .sort();
    return { names, parts: names.map((n) => git(root, ['show', `${rev}:${SRC}/${n}`])) };
  }
  function jsAt(root, rev) {
    if (rev === 'HEAD' && !aru(root, 'HEAD')) return null;
    try {
      return git(root, ['show', `${rev}:${JS}`], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  }
  function stageNoMama(root) {
    try {
      git(root, ['diff', '--quiet', '--', JS, SRC]);
    } catch {
      return false;
    }
    // stage していない 新しい 枚（未追跡）も 書きかけ
    return git(root, ['ls-files', '--others', '--exclude-standard', '--', SRC]).trim() === '';
  }
  const onaji = (a, b) =>
    a.names.join(',') === b.names.join(',') && a.parts.every((p, k) => p === b.parts[k]);

  // 目次の 字（rev＝'' は index）。無ければ null（目次だけの 直しも 門で 見る）
  function mokuAt(root, rev) {
    if (rev === 'HEAD' && !aru(root, 'HEAD')) return null;
    try {
      return git(root, ['show', `${rev}:${SRC}/${MOKUJI}`], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return null;
    }
  }

  // 枚の 形（件3 設計前 taiketsu 止2・注3）＝繋ぐ 前に 見る。どれかが 崩れると 繋いだ 物の 行が ずれる
  function edaNoKatachi(s) {
    const z = [];
    s.names.forEach((n, k) => {
      const p = s.parts[k];
      if (p.length && !p.endsWith('\n')) z.push(`${SRC}/${n} の 最後に 改行が 無い`);
      if (p.includes('﻿')) z.push(`${SRC}/${n} に BOM（\\uFEFF）が 在る`);
      if (p.includes('\r')) z.push(`${SRC}/${n} に CR が 在る（LF で 書く）`);
    });
    return z;
  }

  function mae(root = ROOT, env = undefined) {
    KANKYO = env;
    const sI = srcAt(root, ''),
      sH = srcAt(root, 'HEAD');
    const jI = jsAt(root, ''),
      jH = jsAt(root, 'HEAD');
    const srcKawari = !onaji(sI, sH),
      jsKawari = jI !== jH;
    const mokuKawari = mokuAt(root, '') !== mokuAt(root, 'HEAD');
    if (!srcKawari && !jsKawari && !mokuKawari) return { kekka: 'sawaranai' };
    if (!stageNoMama(root)) {
      return {
        kekka: 'tomeru',
        riyuu: `${JS} か ${SRC}/ に stage していない 直しが 在る（作り直すと 一緒に commit に 入る）→ stage するか 戻す`,
      };
    }
    if (srcKawari) {
      const katachi = edaNoKatachi(sI);
      if (katachi.length) return { kekka: 'tomeru', riyuu: katachi.slice(0, 5).join('・') };
      const cat = tsunagu(sI.parts);
      if (jsKawari && jI !== cat) {
        return {
          kekka: 'tomeru',
          riyuu: `${SRC}/ と ${JS} を 両方 直していて 中身が ずれている（片方の 直しが 消える）→ どちらか 1つに して もう 一方は 戻す（${cfg.sei} を 正にするなら node ${cfg.dougu} --modosu）`,
        };
      }
      if (cat !== jI) {
        fs.writeFileSync(path.join(root, JS), cat);
        git(root, ['add', '--', JS]);
        return { kekka: 'js-wo-kaita' };
      }
    }
    return { kekka: 'tooru' };
  }

  function ato(root = ROOT, env = undefined) {
    KANKYO = env;
    const jI = jsAt(root, ''),
      jH = jsAt(root, 'HEAD');
    const sI = srcAt(root, ''),
      sH = srcAt(root, 'HEAD');
    const mokuI = mokuAt(root, '');
    if (jI === jH && onaji(sI, sH) && mokuI === mokuAt(root, 'HEAD')) return { kekka: 'sawaranai' };
    if (jI === null) return { kekka: 'tomeru', riyuu: `${JS} が index に 無い` };
    const { parts, exts } = wariX(jI);
    if (zure(jI, sI.names, sI.parts, mokuI).length === 0) return { kekka: 'tooru' };
    const names = namae(parts, sI.names, sI.parts, exts);
    kaku(root, parts, names);
    git(root, ['add', '-A', '--', SRC]);
    return { kekka: 'src-wo-kaita', furinaoshi: !!names.furinaoshi };
  }

  // 呼び口の 命令（--check / --modosu / --mae / --ato）
  function cli(argv) {
    const a = argv[2];
    if (a === '--check') {
      const js = fs.readFileSync(path.join(ROOT, JS), 'utf8');
      const s = yomuSrc(ROOT);
      const z = zure(js, s.names, s.parts, s.moku);
      if (z.length) {
        console.error(
          `★${SRC} と ${JS} が ずれています★\n  ${z.slice(0, 10).join('\n  ')}\n  → node ${cfg.dougu} --modosu（${cfg.sei} を 正に する 時）`
        );
        process.exit(1);
      }
    } else if (a === '--modosu') {
      const { parts, exts } = wariX(fs.readFileSync(path.join(ROOT, JS), 'utf8'));
      const s = yomuSrc(ROOT);
      const furi = argv.includes('--furinaosu');
      const names = furi ? parts.map((_, k) => na(k, exts[k])) : namae(parts, s.names, s.parts, exts);
      kaku(ROOT, parts, names);
      console.error(
        `${SRC}/ を ${JS} から 書いた${furi || names.furinaoshi ? '（全部 振り直した）' : ''}`
      );
    } else if (a === '--mae' || a === '--ato') {
      let r;
      try {
        r = a === '--mae' ? mae() : ato();
      } catch (e) {
        r = {
          kekka: 'tomeru',
          riyuu: `${e.message}（途中で 止まった＝git status で ${SRC}/ を 見る）`,
        };
      }
      if (r.kekka === 'tomeru') {
        console.error(`${cfg.mon} ${r.riyuu}`);
        process.exit(1);
      }
      if (r.kekka !== 'sawaranai' && r.kekka !== 'tooru')
        console.error(
          `${cfg.na} ${a}: ${r.kekka}${r.furinaoshi ? '（★枚の 番号が 尽きたので 全部 振り直した＝この commit は 名替え★）' : ''}`
        );
    } else {
      console.error('使い方: --check | --modosu [--furinaosu] | --mae | --ato');
      process.exit(2);
    }
  }

  return {
    JS,
    SRC,
    MOKUJI,
    wari,
    wariX,
    na,
    namae,
    tsunagu,
    mokuji,
    zure,
    mae,
    ato,
    cli,
  };
}
