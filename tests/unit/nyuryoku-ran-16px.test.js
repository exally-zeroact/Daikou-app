'use strict';
// ============================================================
// ★★全画面の 入れる欄・選ぶ欄は 16px 以上（iOS で 押すと 画面が 勝手に 寄らない）★★ 2026-11-04
//   司さん「なんで残したんど・きっちりやれや」＝料金表の 選ぶ欄を 直した 時に 見つけた 同じ 穴を 全画面で 0 に した。
//   ★iOS は 16px 未満の 入力/選択を 触ると 画面が 勝手に 寄ります★（この repo の 決まり・kyuryo-sumaho.spec.js と 同じ）
//
//   ★何を 見るか★（字を 読むだけ・画面は 開かない）
//     ① 画面の 字（html と js）に 書かれた <input/select/textarea …> の 中に 16px 未満の font-size が 無い
//     ② 各 html の <style> の 決まりの うち、欄に 当たる（最後の 部分が input/select/textarea か、
//        欄に 付く class/id を 指す）物に 16px 未満の font-size が 無い
//        ＝JS で 後から 作る 欄（実費の 表・辞めた日・料金の 段 など）は 画面を 開いただけでは 測れないので ここで 見る
//     ★決まりが 何も 無い 欄（ブラウザの 既定 13.3px）は ここでは 見えない★＝tests/e2e/sumaho-16px-zengamen.spec.js が その場で 測る
//
//     ③ JS で createElement して style に 書いた 字の 大きさ（20行の 内）
//   ★直す 前の 数（2026-11-04 テスト線 62ca18b64）★ ①13か所 ②10個 ③1個（dashboard 車の名前 14px）（index 4・dashboard 1・uriage 2・shukei 1・sub 1・daikome-admin 1）→ 0
//   ★わざと壊して 赤（2026-11-04 実測）★ uriage の .yen を 13px に 戻す ⇒ ② 赤／index の vehName を 13px に 戻す ⇒ ① 赤
//   ★0本で 緑に しない★＝下の 下限（ファイル・欄・決まりの 数）を 割ったら 赤
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const files = execFileSync('git', ['ls-files', '*.html', 'js/*.js'], { cwd: ROOT })
  .toString()
  .trim()
  .split(/\r?\n/)
  .filter(
    (f) =>
      f &&
      !/^(tests|outputs|vendor|docs|data)\//.test(f) &&
      !/^js\/vendor\//.test(f) &&
      !/(^|\/)mock-/.test(f)
  );

const tagRe = /<(input|select|textarea)\b([^>]*)>/gi;
const skipType =
  /type\s*=\s*\\?["']?(checkbox|radio|hidden|button|submit|reset|range|color|file|image)/i;
const ran = [];
const jiNoNaka = [];
for (const f of files) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  // 打たない 欄（チェック欄 など）は 外して 数える
  for (const m of [...s.matchAll(tagRe)].filter((x) => !skipType.test(x[2]))) {
    const at = m[2];
    const line = s.slice(0, m.index).split('\n').length;
    const cls = /class\s*=\s*\\?["']([^"'\\]*)/i.exec(at);
    const id = /id\s*=\s*\\?["']([^"'\\]*)/i.exec(at);
    ran.push({ f, line, cls: cls ? cls[1] : '', id: id ? id[1] : '' });
    const fz = /font-size\s*:\s*([\d.]+)px/i.exec(at);
    if (fz && +fz[1] < 16)
      jiNoNaka.push(f + ':' + line + ' ' + m[1] + (id ? '#' + id[1] : '') + ' ' + fz[1] + 'px');
  }
}
// ③ createElement で 作る 欄の 直後（20行）に style で 書いた 字の 大きさ（cssText / style.fontSize）
//   ★taiketsu 2026-11-04★ dashboard の「車の名前」欄（nameBox.style.cssText …font-size:14px）を ①② が 見逃した
const tsukuru = [];
const styleNoAna = [];
for (const f of files) {
  const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
  lines.forEach((l, i) => {
    const m = /(\w+)\s*=\s*document\.createElement\(\s*['"](input|select|textarea)['"]\s*\)/.exec(
      l
    );
    const blk = m ? lines.slice(i, i + 20).join('\n') : '';
    const ty = m ? new RegExp(m[1] + '\\.type\\s*=\\s*[\'"](\\w+)').exec(blk) : null;
    const utanai =
      !!ty && /^(checkbox|radio|hidden|button|submit|reset|range|color|file|image)$/.test(ty[1]);
    if (m && !utanai) {
      tsukuru.push(f + ':' + (i + 1));
      const re = new RegExp(
        m[1] +
          '\\.style\\.(?:cssText\\s*=[\\s\\S]{0,300}?font-size\\s*:\\s*([\\d.]+)px|fontSize\\s*=\\s*[\'"]([\\d.]+)px)'
      );
      const z = re.exec(blk);
      const px = z ? +(z[1] || z[2]) : null;
      if (px !== null && px < 16) styleNoAna.push(f + ':' + (i + 1) + ' ' + m[1] + ' ' + px + 'px');
    }
  });
}
const kimari = [];
for (const f of files.filter((x) => x.endsWith('.html'))) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const st of s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const clean = st[1].replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    const base = s.slice(0, st.index + st[0].indexOf(st[1])).split('\n').length - 1;
    const FZ = /(?:^|;|\s)font-size\s*:\s*([\d.]+)(px|em|rem)/i;
    // 字の 大きさを 書いた 決まり だけ
    for (const r of [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((x) => FZ.test(x[2]))) {
      const fz = FZ.exec(r[2]);
      const px = fz[2] === 'px' ? +fz[1] : +fz[1] * 16;
      const lead = r[1].length - r[1].trimStart().length;
      kimari.push({
        f,
        line: base + clean.slice(0, r.index + lead).split('\n').length,
        sel: r[1].trim().replace(/\s+/g, ' '),
        px,
      });
    }
  }
}
const esc = (k) => k.replace(/-/g, '\\-');
const clsSet = new Set();
const idSet = new Set();
for (const c of ran) {
  for (const k of c.cls.split(/\s+/)) if (/^[-\w]+$/.test(k)) clsSet.add(k);
  if (/^[-\w]+$/.test(c.id)) idSet.add(c.id);
}
const kimariNoAna = [];
for (const r of kimari.filter((x) => x.px < 16)) {
  for (const sel of r.sel.split(',')) {
    const last = sel
      .trim()
      .split(/[\s>+~]+/)
      .pop();
    const tagHit = /(^|[^-\w])(input|select|textarea)(\[|:|\.|#|$)/i.test(last);
    const clsHit = [...clsSet].some((k) => new RegExp('\\.' + esc(k) + '(?![-\\w])').test(last));
    const idHit = [...idSet].some((k) => new RegExp('#' + esc(k) + '(?![-\\w])').test(last));
    if (tagHit || clsHit || idHit)
      kimariNoAna.push(r.f + ':' + r.line + ' ' + sel.trim() + ' ' + r.px + 'px');
  }
}
console.log(
  `[nyuryoku-ran-16px] ファイル=${files.length} 欄の字=${ran.length} 字の大きさの決まり=${kimari.length} ①=${jiNoNaka.length} ②=${kimariNoAna.length} JSで作る欄=${tsukuru.length} ③=${styleNoAna.length}`
);

describe('全画面の 入れる欄・選ぶ欄は 16px 以上', () => {
  it('① 欄の 字の 中に 16px 未満が 無い', () => {
    expect(jiNoNaka).toEqual([]);
  });
  it('② 欄に 当たる CSS の 決まりに 16px 未満が 無い', () => {
    expect(kimariNoAna).toEqual([]);
  });
  it('③ JS で 作る 欄の style に 16px 未満が 無い', () => {
    expect(styleNoAna).toEqual([]);
  });
  it('数えた 物が 下限より 多い（0本で 緑に しない）', () => {
    expect(tsukuru.length).toBeGreaterThanOrEqual(2);
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(ran.length).toBeGreaterThanOrEqual(120);
    expect(kimari.length).toBeGreaterThanOrEqual(400);
    expect(clsSet.size).toBeGreaterThanOrEqual(15);
  });
});
