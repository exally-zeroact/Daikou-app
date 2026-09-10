// @vitest-environment node
// ============================================================
// ★知らせの 箱を 濃い色で 塗らない★ 2026-09-10
//
//   ★司さんの言葉（電話の 絵つき）★
//     「全アプリで こんな 濃い色 使うなって 言うてなかったか？」
//     「色が 濃いすぎるし ★背景ボックスの 使い方★が 悪くないか？」
//     直した 形を 見て →「★絶対 これが ええ★」
//     ⇒「Exally や 他の アプリで ★前みたいな 重たい感じに なってる所★ あったら ★先に 直せ★」
//
//   ★ここで 守る 事★
//     ★お客さんの 画面に かぶせる 知らせは ★白地★★（濃い色は ★左の 帯★だけ）
//     ⇒★色を 禁じて いません＝★大きく 塗る のを 禁じて います★★
//
//   ★実測（Exally の 同じ 箱で ★絵を 撮って 点を 数えた★）★
//     箱の 中 330×148 の うち 暗い 点 … ★88% → 6%★（★14.8分の1★）
//     手本＝exally book.html の #toast（PR #64）
//
//   ★★見て いない 範囲（★書かない 見張りは「全部 守った」と 読まれる★）★★
//     ・★ボタン・選ばれている タブは 見て いません★（小さい）
//     ・★この repo で 知らせが 在るのは index.html と daikome-admin.html★（★数えて 書いた★）
//     ・★運転中の 画面の 数字・地図の 色は 見て いません★（別の 話）
//
// ============================================================
// ★★わざと壊した 記録（この repo の 決まり）★★ 2026-09-10
//   ★「見張りを 書いた」は「見張っている」では ない★ので、
//   ★本当に 赤に なるか を 押して 確かめた 記録★を ここに 残します。
//
//   ①★前の 塗りに 戻した★（写しを 壊す＝ファイルは 1バイトも 触らない）
//       index.html         … background: #ffffff → ★rgba(0, 0, 0, 0.75)★
//       daikome-admin.html … background: #ffffff → ★#1c1c1e★
//     ⇒★2本とも 赤に なりました★（下の「前の 塗りに 戻すと 赤に なる（2つとも）」）
//
//   ②★薄い 覆い（alpha 0.4）を 食わせた★
//     ⇒★赤に なりません★＝★狼少年に なって いない★事も 確かめました
//        （これを 確かめないと「何でも 赤」の 見張りに なり 誰も 見なく なる）
//
//   ③★色の 書き方を 4通り 食わせた★
//       #1c1c1e ／ #1C1C1E ／ rgb(28,28,30) ／ rgba(0, 0, 0, 0.75)
//     ⇒★4通り とも 捕まえました★（★色は 文字で 探さず 値に 直して いる★証拠）
//
//   ④★写しを 壊せて いない 時も 赤に する★ようにして あります
//     （`.not.toBe(FILES[i].text)`）＝★壊したつもりで 壊せて いない★を 見つける為
//
//   ★★他の repo でも この 見張りが 実際に 仕事を しました★★
//     代行請求（daikou-seikyu）で ★私が 手で 探して 見落とした `.toast-undo` を
//     この 見張りが 捕まえました★（人の 目より 先に 機械が 数えた）
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ★この repo で 知らせの 規則を 持つ ファイル（★数えて 書いた★）★ */
const MIRU = ['index.html', 'daikome-admin.html'];

/* ══ ★免除（★理由つきで 名指し★／黙って 見逃さない）★ ══
   ★見張りは 知らせの ★箱★ を 見ます。箱の 中の ★押す物★ は 別の 話です。 */
const MENJO = [
  {
    ha: (name) => /btn|button/i.test(name),
    wake:
      '★箱の 中の 押す物（ボタン）★＝知らせの 箱では ない。' +
      '実Excel も ボタンは 塗る／小さい／字は その 上に 載る',
  },
];
const menjoKa = (name) => MENJO.find((m) => m.ha(name)) || null;

/* ★色は 文字で 探さず 値に 直す★（2026-08-10 の 決まり） */
function iroNi(v) {
  const h = /#([0-9a-fA-F]{6})\b/.exec(v);
  if (h) {
    const x = h[1];
    return {
      c: [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)],
      a: 1,
    };
  }
  const r = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?/.exec(v);
  if (r) return { c: [+r[1], +r[2], +r[3]], a: r[4] === undefined ? 1 : parseFloat(r[4]) };
  return null;
}
const akarusa = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

function toastRules(text) {
  const out = [];
  const re = /(^|[\s}])((?:#toast|\.toast)[^{}]{0,60})\{([^{}]{0,900})\}/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ name: m[2].trim(), body: m[3] });
  return out;
}

function nuri(body) {
  const m = /background(?:-color)?\s*:\s*([^;}]+)/.exec(body);
  if (!m) return null;
  const v = iroNi(m[1]);
  /* ★薄い 覆い（alpha 0.5 未満）は 別の 話＝狼少年に しない★ */
  if (!v || v.a < 0.5) return null;
  return v.c;
}

const FILES = MIRU.map((f) => {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) throw new Error('★見る はずの ' + f + ' が 無い★');
  return { name: f, text: fs.readFileSync(p, 'utf-8') };
});

describe('★知らせの 箱を 濃い色で 塗らない★', () => {
  it('★知らせの 箱を 見つけて いる（★空振りして いない★）★', () => {
    const n = FILES.reduce((s, f) => s + toastRules(f.text).length, 0);
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it('★★知らせの 箱を 濃い色で 塗って いない（★これが 本体★）★★', () => {
    const warui = [];
    const menjoshita = [];
    for (const f of FILES) {
      for (const r of toastRules(f.text)) {
        if (menjoKa(r.name)) {
          menjoshita.push(f.name + ' ' + r.name);
          continue;
        }
        const c = nuri(r.body);
        if (!c) continue;
        if (akarusa(c) < 170) warui.push(f.name + ' ' + r.name + ' → rgb(' + c.join(',') + ')');
      }
    }
    if (menjoshita.length) console.log('      ★免除（理由つき）★ ' + menjoshita.join(' / '));
    expect(warui, '★濃い色で 塗って いる★ ⇒ 白地に して 濃い色は 左の 帯だけに').toEqual([]);
  });

  it('★★塗りを 持つ 知らせは 左の 帯も 持つ（★色を 消した わけでは ない★）★★', () => {
    /* ★数を 焼き込みません★＝「◯か所」では なく ★塗りと 帯が 対★かを 見る
       （2026-09-10 に Exally の 数を 焼き込んで 給与で 誤って 赤に した） */
    const warui = [];
    let obi = 0;
    for (const f of FILES) {
      for (const r of toastRules(f.text)) {
        if (menjoKa(r.name)) continue;
        if (!/background(?:-color)?\s*:/.test(r.body)) continue;
        const b = /border-left\s*:\s*(\d+)px\s+solid\s+([^;}]+)/.exec(r.body);
        if (!b) {
          warui.push(f.name + ' ' + r.name + ' ★帯が 無い★');
          continue;
        }
        if (Number(b[1]) > 8) {
          warui.push(f.name + ' ★帯が 太すぎる ' + b[1] + 'px★');
          continue;
        }
        if (!iroNi(b[2])) {
          warui.push(f.name + ' 帯の 色が 読めない');
          continue;
        }
        obi++;
      }
    }
    expect(warui).toEqual([]);
    expect(obi, '★帯が 1つも 無い＝色が 消えて しまって いる★').toBeGreaterThanOrEqual(1);
  });

  it('★白地に 薄い 字を 置いて いない（★読めなく なって いない★）★', () => {
    const warui = [];
    for (const f of FILES) {
      for (const r of toastRules(f.text)) {
        const bg = nuri(r.body);
        const cm = /(?:^|[;\s])color\s*:\s*([^;}]+)/.exec(r.body);
        if (!bg || !cm) continue;
        const fg = iroNi(cm[1]);
        if (!fg) continue;
        if (akarusa(bg) > 200 && akarusa(fg.c) > 200) warui.push(f.name + ' ' + r.name);
      }
    }
    expect(warui).toEqual([]);
  });

  it('★免除は 全部 理由つき／★免除に 逃げて いない★★', () => {
    for (const m of MENJO) expect(m.wake.trim().length, '★理由が 無い 免除★').toBeGreaterThan(20);
    expect(menjoKa('.toast'), '★箱そのものを 免除に して いる★').toBe(null);
    expect(menjoKa('.toast-btn'), '★ボタンが 免除に なって いない★').not.toBe(null);
  });

  /* ══ ★わざと 壊して 赤に なるか（★壊すのは 写し★＝ファイルは 1バイトも 触らない）★ ══ */
  const hantei = (text) =>
    toastRules(text).some((r) => {
      if (menjoKa(r.name)) return false;
      const c = nuri(r.body);
      return c !== null && akarusa(c) < 170;
    });

  it('★★前の 塗りに 戻すと 赤に なる（2つとも）★★', () => {
    /* ★★字そのものに 寄りかからない★★（2026-09-10 に 踏んだ）
       最初 `.replace('background: #ffffff;', …)` と 書きました。
       ⇒ commit の 時に ★prettier/stylelint が #ffffff を #fff に 縮めた★
       ⇒ 探す 字が 見つからず ★写しを 壊せて いないのに 緑★に なる 所でした
       ⇒★規則の 中の 塗りを ★形で★ 見つけて 差し替える★（字を 決め打ちしない） */
    const kumi = [
      [0, 'rgba(0, 0, 0, 0.75)'],
      [1, '#1c1c1e'],
    ];
    for (const [i, mae] of kumi) {
      const rules = toastRules(FILES[i].text).filter((r) => !menjoKa(r.name));
      expect(rules.length, '★' + FILES[i].name + ' に 知らせの 規則が 無い★').toBeGreaterThan(0);
      const r = rules[0];
      const kowashita = r.body.replace(/background(-color)?\s*:\s*[^;}]+/, 'background: ' + mae);
      expect(kowashita, '★写しを 壊せて いない＝この 試験は 何も 見て いない★').not.toBe(r.body);
      const utsushi = FILES[i].text.replace(r.body, kowashita);
      expect(hantei(utsushi), '★' + FILES[i].name + ' で 戻しても 赤に ならない★').toBe(true);
    }
  });

  it('★★薄い 覆い（alpha 0.4）は 赤に しない（★狼少年に しない★）★★', () => {
    expect(hantei('.toast{position:fixed;background:rgba(0,0,0,0.4);color:#fff;}')).toBe(false);
  });

  it('★★色を 文字で 探して いない（値に 直して いる）★★', () => {
    const kakikata = ['#1c1c1e', '#1C1C1E', 'rgb(28,28,30)', 'rgba(0, 0, 0, 0.75)'];
    for (const k of kakikata) {
      expect(
        hantei('.toast{position:fixed;background:' + k + ';color:#fff;}'),
        '★' + k + ' を 見落とした★'
      ).toBe(true);
    }
  });
});
