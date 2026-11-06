// @vitest-environment node
// ============================================================
// ★js/pdf-okuru.js★（写し元＝代行請求書 tests/pdf-okuru.test.js）2026-11-06 司さんの 答え「B」
//   iPhone・iPad は navigator.share に ★files と text だけ★（url・title を 付けない＝LINE に blob の URL が 届かない）
//   files だけ（A）には しない（10-30「LINE ないやないか」）。PC・Android は 'none'＝呼ぶ 側の 今の 道
// ============================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('../../js/pdf-okuru.js');

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipados:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
};

// 小さな 偽の DOM（帯を 数える 為だけ）
function fakeDoc() {
  const all = [];
  function el(tag) {
    const e = {
      tag,
      id: '',
      style: {},
      children: [],
      parentNode: null,
      textContent: '',
      attrs: {},
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      appendChild(c) {
        c.parentNode = this;
        this.children.push(c);
        all.push(c);
        return c;
      },
      insertBefore(c, ref) {
        c.parentNode = this;
        const i = this.children.indexOf(ref);
        this.children.splice(i < 0 ? this.children.length : i, 0, c);
        all.push(c);
        return c;
      },
      removeChild(c) {
        this.children = this.children.filter((x) => x !== c);
        c.parentNode = null;
      },
    };
    return e;
  }
  const body = el('body');
  return {
    body,
    createElement: el,
    getElementById(id) {
      const f = (n) => {
        for (const c of n.children) {
          if (c.id === id) return c;
          const r = f(c);
          if (r) return r;
        }
        return null;
      };
      return f(body);
    },
  };
}

function env(ua, opt = {}) {
  const calls = [];
  const nav = {
    userAgent: ua,
    platform: opt.platform || '',
    maxTouchPoints: opt.touch || 0,
    share(d) {
      calls.push(d);
      const e = opt.errs && opt.errs.shift();
      if (e) {
        const x = new Error(e);
        x.name = e;
        return Promise.reject(x);
      }
      return Promise.resolve();
    },
    canShare: opt.canShare === undefined ? () => true : opt.canShare,
  };
  if (opt.noShare) delete nav.share;
  return {
    calls,
    e: { navigator: nav, Blob, File, document: opt.doc || fakeDoc() },
  };
}

const BYTES = new Uint8Array([37, 80, 68, 70]);

describe('iPhone・iPad＝files と text だけ', () => {
  it('iPhone：share 1回・キーは files と text だけ（url・title 無し）', async () => {
    const { calls, e } = env(UA.iphone);
    const r = await P.okuru(BYTES, '請求書_2026-10_甲.pdf', '請求書 10月分 甲 御中', e);
    expect(r.how).toBe('share');
    expect(calls.length).toBe(1);
    expect(Object.keys(calls[0]).sort()).toEqual(['files', 'text']);
    expect(calls[0].text).toBe('請求書 10月分 甲 御中');
    expect(calls[0].files.length).toBe(1);
    expect(calls[0].files[0].name).toBe('請求書_2026-10_甲.pdf');
    expect(calls[0].files[0].type).toBe('application/pdf');
  });
  it('iPadOS（Mac の 名乗り＋触れる 点 5）も 同じ', async () => {
    const { calls, e } = env(UA.ipados, { platform: 'MacIntel', touch: 5 });
    expect((await P.okuru(BYTES, 'a.pdf', 'x', e)).how).toBe('share');
    expect(calls.length).toBe(1);
  });
});

describe("PC・Android＝今の 道（'none'・share 0回）", () => {
  for (const [nm, ua, o] of [
    ['Mac（触れる 点 0）', UA.mac, { platform: 'MacIntel', touch: 0 }],
    ['Windows', UA.win, { platform: 'Win32', touch: 10 }],
    ['Android', UA.android, { platform: 'Linux armv8l', touch: 5 }],
  ]) {
    it(nm, async () => {
      const { calls, e } = env(ua, o);
      expect((await P.okuru(BYTES, 'a.pdf', 'x', e)).how).toBe('none');
      expect(calls.length).toBe(0);
    });
  }
});

describe('使えない・断られた', () => {
  it("canShare が false＝'none'・share 0回", async () => {
    const { calls, e } = env(UA.iphone, { canShare: () => false });
    expect((await P.okuru(BYTES, 'a.pdf', 'x', e)).how).toBe('none');
    expect(calls.length).toBe(0);
  });
  it("share が 無い＝'none'", async () => {
    const { e } = env(UA.iphone, { noShare: true });
    expect((await P.okuru(BYTES, 'a.pdf', 'x', e)).how).toBe('none');
  });
  it("やめた（AbortError）＝'cancel'（今の 道に 落ちない）", async () => {
    const { e } = env(UA.iphone, { errs: ['AbortError'] });
    expect((await P.okuru(BYTES, 'a.pdf', 'x', e)).how).toBe('cancel');
  });
  it("ほかの エラー＝'none'（今の 道）", async () => {
    const { e } = env(UA.iphone, { errs: ['TypeError'] });
    expect((await P.okuru(BYTES, 'a.pdf', 'x', e)).how).toBe('none');
  });
  it('NotAllowedError＝帯が 出る・釦で 同じ 中身で もう1回・送れたら 帯が 消える', async () => {
    const doc = fakeDoc();
    const { calls, e } = env(UA.iphone, { errs: ['NotAllowedError'], doc });
    const r = await P.okuru(BYTES, '請求書_2026-10_甲.pdf', '請求書 10月分 甲 御中', e);
    expect(r.how).toBe('need-tap');
    const bar = doc.getElementById('pdfOkuruObi');
    expect(bar).toBeTruthy();
    expect(bar.children[0].textContent).toContain('請求書_2026-10_甲.pdf');
    await doc.getElementById('pdfOkuruGo').onclick();
    expect(calls.length).toBe(2);
    expect(Object.keys(calls[1]).sort()).toEqual(['files', 'text']);
    expect(calls[1].text).toBe('請求書 10月分 甲 御中');
    expect(doc.getElementById('pdfOkuruObi')).toBe(null);
  });
  it('帯で 2回目も 断られた＝字で 知らせる・「PDF を 開く」で 今の 道（行き止まりに しない）', async () => {
    const doc = fakeDoc();
    const { e } = env(UA.iphone, { errs: ['NotAllowedError', 'NotAllowedError'], doc });
    let hiraita = 0;
    await P.okuru(BYTES, 'a.pdf', 'x', e, { hiraku: () => hiraita++ });
    expect(doc.getElementById('pdfOkuruHiraku')).toBe(null); // 1回目は まだ 出さない
    await doc.getElementById('pdfOkuruGo').onclick();
    const bar = doc.getElementById('pdfOkuruObi');
    expect(bar).toBeTruthy();
    expect(doc.getElementById('pdfOkuruMsg').textContent).toContain('送れませんでした');
    doc.getElementById('pdfOkuruHiraku').onclick();
    expect(hiraita).toBe(1);
    expect(doc.getElementById('pdfOkuruObi')).toBe(null);
  });
  it('出せない 字の 知らせは 帯の 字に 入る', async () => {
    const doc = fakeDoc();
    const { e } = env(UA.iphone, { errs: ['NotAllowedError'], doc });
    await P.okuru(BYTES, 'a.pdf', 'x', e, { chui: '注意：この字は出せず〓表示→ 髙' });
    expect(doc.getElementById('pdfOkuruMsg').textContent).toContain('〓表示→ 髙');
  });
  it('kesu で 帯が 消える（古い 紙を 送らない）', async () => {
    const doc = fakeDoc();
    const { e } = env(UA.iphone, { errs: ['NotAllowedError'], doc });
    await P.okuru(BYTES, 'a.pdf', 'x', e);
    expect(doc.getElementById('pdfOkuruObi')).toBeTruthy();
    P.kesu(e);
    expect(doc.getElementById('pdfOkuruObi')).toBe(null);
  });
  it("canShare が 無い＝'none'・share 0回", async () => {
    const { calls, e } = env(UA.iphone, { canShare: null });
    e.navigator.canShare = undefined;
    expect((await P.okuru(BYTES, 'a.pdf', 'x', e)).how).toBe('none');
    expect(calls.length).toBe(0);
  });
});

describe('添える 字（紙の 名前）', () => {
  it('_ を 空白に・.pdf を 外す', () =>
    expect(P.namaeJi('給料明細_2026-10_1か月分_山田.pdf')).toBe('給料明細 2026-10 1か月分 山田'));
  it('空', () => expect(P.namaeJi('')).toBe(''));
});

describe('帯は 印刷に 載せない（Daikou-app だけの 足し）', () => {
  it('帯を 出すと 印刷よけの style が 1つだけ 入る（2回 出しても 1つ）', async () => {
    const { e } = env(UA.iphone, { errs: ['NotAllowedError', 'NotAllowedError'] });
    await P.okuru(BYTES, 'a.pdf', 'x', e);
    await P.okuru(BYTES, 'a.pdf', 'x', e);
    const st = e.document.getElementById('pdfOkuruInsatsu');
    expect(st && st.textContent).toBe('@media print{#pdfOkuruObi{display:none !important}}');
    expect(e.document.body.children.filter((c) => c.id === 'pdfOkuruInsatsu').length).toBe(1);
  });
});

// ★押した 後に 紙が 変わったら 送らない★（Daikou-app の 足し・見本 okuruKawatta の 代わり・設計前 対立役 止3）
//   わざと壊す：okuru の 2つの kawatta(opt) を 外す ⇒ 赤
describe('押した 後に 選び直したら 送らない（kai）', () => {
  it("押した 後に kesu が 呼ばれた＝共有を 呼ばない（'kawatta'）", async () => {
    const { calls, e } = env(UA.iphone);
    const kai = P.kesu(e);
    P.kesu(e); // 選び直し
    const r = await P.okuru(BYTES, 'a.pdf', 'x', e, { kai });
    expect(r.how).toBe('kawatta');
    expect(calls.length).toBe(0);
  });
  it('変わって いない＝共有する', async () => {
    const { calls, e } = env(UA.iphone);
    const kai = P.kesu(e);
    expect((await P.okuru(BYTES, 'a.pdf', 'x', e, { kai })).how).toBe('share');
    expect(calls.length).toBe(1);
  });
  it('断られる 間に 選び直した＝帯を 出さない', async () => {
    const { e } = env(UA.iphone, { errs: ['NotAllowedError'] });
    const kai = P.kesu(e);
    const p = P.okuru(BYTES, 'a.pdf', 'x', e, { kai });
    P.kesu(e); // 断りが 返る 前に 選び直し
    expect((await p).how).toBe('kawatta');
    expect(e.document.getElementById('pdfOkuruObi')).toBeNull();
  });
  it('帯の 出し直しは 数えない（帯を 出しても kai は 変わらない）', async () => {
    const { e } = env(UA.iphone, { errs: ['NotAllowedError'] });
    const kai = P.kesu(e);
    expect((await P.okuru(BYTES, 'a.pdf', 'x', e, { kai })).how).toBe('need-tap');
    expect(P.kai()).toBe(kai);
  });
});

describe('知らせの 字（how ごと）', () => {
  it('share は〓の 知らせを 落とさない', () => {
    expect(P.bun('share', '')).toBe('PDFを渡しました');
    expect(P.bun('share', '注意：X')).toBe('PDFを渡しました（注意：X）');
  });
  it('cancel・need-tap・kawatta は 字・hiraita と none は null（呼ぶ 側の 今の 字）', () => {
    expect(P.bun('cancel')).toBe('送るのを やめました');
    expect(P.bun('need-tap')).toMatch('送る・印刷する');
    expect(P.bun('kawatta')).toMatch('選び直した');
    expect(P.bun('hiraita')).toBeNull();
    expect(P.bun('none')).toBeNull();
  });
});
