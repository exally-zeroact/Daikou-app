// ============================================================
// ★★見張り：明細の 紙は 車が 多くても 下が 切れない★★ 2026-10-07
//
//   司さん「前からある2つもやれ」（対立役：車 9台＋内わけ 1行 で 紙の 下が 切れた）
//   ★直し★ 字も 行の 高さも 変えず、車の 行が 入らない 時は 次の 紙へ（売上n の 番号は 続き）
//           入るかは ★組んだ 紙の 高さを 測って★ 決める（見積もりは 内わけが 折り返すと 外れた）
//   ★物差し★
//     PDF の 紙（__paper.sheets）も 事務所の 画面の 紙（.kami-mado）も 高さ ≦ 794px（A4横の 板）
//     画面の 紙の 枚数 ＝ PDF の 枚数（10-07 対立役：画面は 日だけで 分けて いて 下が 切れた）
//     売上1〜N が 日の 分け（maisu.n）と 同じ 回数ずつ 出る（重なり・抜けを 数える）
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-07 実測）★★
//     _maisu の 車の 分け方を 外す（carN を 1 に する）⇒ ★赤★（高さが 794 を 越える）
//     測るのを やめて 前の 見積もり（内わけ×26px）に 戻す ⇒ ★赤★（手当・控除 6件 で 越える）
//     事務所の 画面を 日だけで 分ける 前の 形に 戻す ⇒ ★赤★（枚数と 高さ）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

function kuruma(f, dai) {
  for (let i = f.labels.length; i < dai; i++) {
    f.labels.push({
      company_id: f.labels[0].company_id,
      device_id: '00000000-0000-4000-9000-0000000001' + String(i).padStart(2, '0'),
      label: '車' + (i + 1),
      sort_order: i + 1,
    });
  }
}

const BAAI = [
  {
    na: '車 12台 ＋ 手当 1件',
    dai: 12,
    adj: [['teate', 'ガソリン代', 500]],
  },
  {
    // ★対立役 10-07 の 形★（内わけが 折り返して 見積もりより 高く なった）
    na: '車 9台 ＋ 1回・1km の 行 ＋ 手当・控除 6件',
    dai: 9,
    adj: [
      ['teate', 'ガソリン代', 500],
      ['teate', '携帯電話代', 3000],
      ['teate', '深夜手当', 2000],
      ['koujo', '前借り', 10000],
      ['koujo', '制服代', 4500],
      ['koujo', '事故の 弁償', 20000],
    ],
  },
];

for (const b of BAAI) {
  test('★' + b.na + ' でも 明細の 紙は 切れない（PDF も 画面も）★', async ({ page }) => {
    const err = [];
    page.on('pageerror', (e) => err.push(e.message));
    await page.setViewportSize({ width: 1280, height: 900 });
    await openKyuryo(page, (f) => {
      kuruma(f, b.dai);
      const w = f.workHours[0];
      f.adjustments = b.adj.map((a, i) => ({
        adj_id: 'a' + i,
        employee_id: w.employee_id,
        work_date: w.work_date,
        kind: a[0],
        label: a[1],
        yen: a[2],
      }));
      f.settings[0].pay_extra = { kaisu: 100, kasanAto: true };
      return f;
    });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const P = window.__paper;
      const out = [];
      for (let ei = 0; ei < P.ninzu(); ei++) {
        const els = P.sheets(ei);
        const uri = {};
        const takasa = els.map((el) => {
          el.style.position = 'absolute';
          el.style.left = '0';
          el.style.top = '0';
          document.body.appendChild(el);
          const h = el.scrollHeight;
          el.querySelectorAll('th').forEach((th) => {
            // ★1行目（売上n）だけ 読む★（2行目の 車の 名前を 番号に くっつけない）
            const d = th.querySelector('div');
            const m = /^売上(\d+)$/.exec(((d && d.textContent) || '').trim());
            if (m) uri[m[1]] = (uri[m[1]] || 0) + 1;
          });
          el.remove();
          return h;
        });
        // ★事務所の 画面の 紙★
        const mado = document.querySelector('#slips .kami-mado[data-ei="' + ei + '"]');
        const gamen = mado
          ? Array.from(mado.querySelectorAll('.hn-kami-waku')).map(
              (w) => w.firstElementChild.scrollHeight
            )
          : null;
        out.push({
          ei: ei,
          mai: els.length,
          hiWake: P.maisu(ei).n,
          takasa: takasa,
          uri: uri,
          gamen: gamen,
        });
      }
      return out;
    });
    // eslint-disable-next-line no-console
    console.log('★紙★ ' + JSON.stringify(r));
    expect(r.length, '★人が 居ない★').toBeGreaterThan(0);
    let wakareta = 0;
    r.forEach((x) => {
      if (x.mai > x.hiWake) wakareta++;
      x.takasa.forEach((h, i) => {
        expect(
          h,
          '★' + x.ei + '人目 PDF ' + (i + 1) + '枚目 ' + h + 'px が 794 を 越える★'
        ).toBeLessThanOrEqual(794);
      });
      expect(x.gamen, '★' + x.ei + '人目 画面の 紙が 無い★').not.toBeNull();
      expect(x.gamen.length, '★' + x.ei + '人目 画面の 枚数 ≠ PDF の 枚数★').toBe(x.mai);
      x.gamen.forEach((h, i) => {
        expect(
          h,
          '★' + x.ei + '人目 画面 ' + (i + 1) + '枚目 ' + h + 'px が 794 を 越える★'
        ).toBeLessThanOrEqual(794);
      });
      // ★売上1〜N が ちょうど 日の 分けの 回数ずつ★
      const hazu = {};
      for (let n = 1; n <= b.dai; n++) hazu[n] = x.hiWake;
      expect(x.uri, '★売上n の 抜け・重なり★').toEqual(hazu);
    });
    // ★本当に 車で 分けた 場合を 見ている★（分けずに 済んだ なら この 見張りは 空回り）
    expect(wakareta, '★車で 分けた 人が 0＝空回り★').toBeGreaterThan(0);
    expect(err, '★画面が 落ちた★').toEqual([]);
  });
}

// ============================================================
// ★★車 1台でも 入らない ほど 手当・控除が 長い ⇒ 内わけを 自分の 紙へ（止めない・1件も 消さない）★★ 2026-10-07
//   対立役 10-07 D：長い 名前の 手当・控除 60件で 1台でも 794 を 越え、黙って 切れた 紙が 台数ぶん 出た
//   ★わざと壊して 赤（2026-10-07 実測）★ _maisu の 内わけを 別の 紙へ 送る 所を 外す ⇒ ★赤★（高さ）
// ============================================================
function nagaiAdj(f, kazu) {
  const w = f.workHours[0];
  f.adjustments = Array.from({ length: kazu }, (_, i) => ({
    adj_id: 'n' + i,
    employee_id: w.employee_id,
    work_date: w.work_date,
    kind: i % 2 ? 'koujo' : 'teate',
    label: '長い 名前の 手当 その' + (i + 1) + '（ガソリン・駐車場・携帯 等）',
    yen: 100 + i,
  }));
  f.settings[0].pay_extra = { kaisu: 100, kasanAto: true };
  return f;
}
test('★手当・控除 60件（長い 名前）＋ 車 6台 ⇒ どの 紙も 794 以下・内わけは 1回 全部 載る★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openKyuryo(page, (f) => {
    kuruma(f, 6);
    return nagaiAdj(f, 60);
  });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const P = window.__paper;
    const el0 = P.sheets(0);
    return el0.map((el) => {
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.top = '0';
      document.body.appendChild(el);
      const h = el.scrollHeight;
      const t = el.textContent;
      el.remove();
      return {
        h: h,
        sono60: (t.match(/その60（/g) || []).length,
        hyou: !!el.querySelector('table'),
      };
    });
  });
  // eslint-disable-next-line no-console
  console.log('★60件★ ' + JSON.stringify(r));
  r.forEach((x, i) => expect(x.h, '★' + (i + 1) + '枚目 ' + x.h + 'px★').toBeLessThanOrEqual(794));
  expect(
    r.reduce((a, x) => a + x.sono60, 0),
    '★内わけが 1回 全部 載っていない★'
  ).toBe(1);
  expect(
    r.some((x) => x.hyou),
    '★日の 表が 無い★'
  ).toBe(true);
  expect(err).toEqual([]);
});

// ============================================================
// ★★PDF の 字体（DKKami）が 入った 後も 画面の 紙は PDF と 同じ 束・切れない★★ 2026-10-07（対立役 C）
//   ★わざと壊して 赤（2026-10-07 実測）★ dkkami-yonda の 組み直しを 外す ⇒ ★赤★（画面の 紙 803px）
// ============================================================
test('★字体が 入った 後も 事務所の 画面の 紙 ＝ PDF の 束・794 以下★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openKyuryo(page, (f) => {
    kuruma(f, 12);
    return nagaiAdj(f, 14);
  });
  await page.waitForTimeout(1200);
  const mae = await page.evaluate(() => window.__paper.sheets(0).length);
  // ★字体が 替わって 字が 大きく なる 場合を 作る★（この 機械では 控えの 字体と DKKami で 枚数が 変わらない＝
  //   10-07 実測 15通り 0件。iPhone 等で 控えの 字体の 方が 小さい 時を 写す 為、同じ 字体を 140% で 入れて
  //   PDF を 押した 時と 同じ 合図 dkkami-yonda を 出す）
  await page.evaluate(async () => {
    const ff = new FontFace('DKKami', 'url(vendor/fonts/BIZUDPGothic-Regular.ttf)', {
      sizeAdjust: '140%',
    });
    await ff.load();
    document.fonts.add(ff);
    window.dispatchEvent(new Event('dkkami-yonda'));
  });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const ari = document.fonts.check('15px DKKami');
    const P = window.__paper;
    const out = [];
    for (let ei = 0; ei < P.ninzu(); ei++) {
      const mado = document.querySelector('#slips .kami-mado[data-ei="' + ei + '"]');
      const gamen = Array.from(mado.querySelectorAll('.hn-kami-waku')).map(
        (w) => w.firstElementChild.scrollHeight
      );
      out.push({ pdf: P.sheets(ei).length, gamen: gamen });
    }
    return { ari: ari, out: out };
  });
  // eslint-disable-next-line no-console
  console.log('★字体★ ' + JSON.stringify({ mae: mae, r: r }));
  expect(r.ari, '★字体が 入っていない＝この 見張りは 何も 見ていない★').toBe(true);
  r.out.forEach((x, ei) => {
    expect(x.gamen.length, '★' + ei + '人目 画面の 枚数 ≠ PDF★').toBe(x.pdf);
    x.gamen.forEach((h) =>
      expect(h, '★' + ei + '人目 画面の 紙 ' + h + 'px★').toBeLessThanOrEqual(794)
    );
  });
  expect(err).toEqual([]);
});

// ============================================================
// ★★列の 幅は 紙と 同じ 字体で 測る（字体が 替わっても 字が 升から はみ出さない）★★ 2026-10-08（対立役）
//   前は canvas で 'Noto Sans JP' だけで 測り、描く 字（DKKami・端末の 控え）と 幅が 違った
//   ★わざと壊して 赤（2026-10-08 実測）★ _textW を 'Noto Sans JP' だけに 戻す ⇒ ★赤★（升から はみ出す）
// ============================================================
test('★字体が 大きく 替わっても 明細の 紙の 字は 升から はみ出さない・紙の 幅も 越えない★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openKyuryo(page);
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const ff = new FontFace('DKKami', 'url(vendor/fonts/BIZUDPGothic-Regular.ttf)', {
      sizeAdjust: '140%',
    });
    await ff.load();
    document.fonts.add(ff);
    window.dispatchEvent(new Event('dkkami-yonda'));
  });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const P = window.__paper;
    const out = [];
    for (let ei = 0; ei < P.ninzu(); ei++)
      P.sheets(ei).forEach((el) => {
        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.top = '0';
        document.body.appendChild(el);
        const cells = Array.from(el.querySelectorAll('td,th'));
        out.push({
          haba: el.scrollWidth,
          // ★字の 本当の 幅（Range）と 升の 中の 幅を 比べる★（升は overflow:visible の 物が 在り scrollWidth では はみ出しが 見えない）
          over: cells.filter((c) => {
            const cs = getComputedStyle(c);
            const naka = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            const rg = document.createRange();
            rg.selectNodeContents(c);
            return rg.getBoundingClientRect().width > naka + 0.5;
          }).length,
          cells: cells.length,
        });
        el.remove();
      });
    return { ari: document.fonts.check('15px DKKami'), out: out };
  });
  // eslint-disable-next-line no-console
  console.log('★字の 幅★ ' + JSON.stringify(r));
  expect(r.ari, '★字体が 入っていない＝空回り★').toBe(true);
  r.out.forEach((x, i) => {
    expect(x.cells, '★升が 無い＝空回り★').toBeGreaterThan(0);
    expect(x.over, '★' + (i + 1) + '枚目 升から はみ出した 字 ' + x.over + '個★').toBe(0);
    expect(x.haba, '★' + (i + 1) + '枚目 紙の 幅 ' + x.haba + 'px★').toBeLessThanOrEqual(1123);
  });
  expect(err).toEqual([]);
});

// ============================================================
// ★★本物の 字体（DKKami）で 11日の 期（10/21〜10/31）も 升から はみ出さない★★ 2026-10-08（対立役 1-b）
//   前は 列の 幅を 'Noto Sans JP' で 測り、PDF の 字体では 日付の 升が 約 9px 足りなかった
//   （最初に 当たるのは 10/21〜10/31 の 明細）。直した 後は 1人 2枚に 分かれる（字は 小さく しない）
//   ★わざと壊して 赤（2026-10-08 実測）★ _textW を 'Noto Sans JP' だけに 戻す ⇒ ★赤★
// ============================================================
test('★本物の 字体で 10/21〜10/31（11日）の 明細の 字が 升から はみ出さない★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-25T12:00:00+09:00'));
  await page.setViewportSize({ width: 1280, height: 900 });
  // ★勤務を 10/22・10/31 に★（どの 月に 走らせても 同じ 月・期を 見る）
  await openKyuryo(
    page,
    (f) => {
      const okikae = (o) => {
        if (Array.isArray(o)) return o.map(okikae);
        if (o && typeof o === 'object') {
          const r = {};
          Object.keys(o).forEach((k) => (r[k] = okikae(o[k])));
          return r;
        }
        if (typeof o === 'string')
          return o.replace(/\d{4}-\d{2}-(01|02)(?=$|[ T])/g, (_m, d) =>
            d === '01' ? '2026-10-22' : '2026-10-31'
          );
        return o;
      };
      return okikae(f);
    },
    { matanai: true }
  );
  // ★21日〜末日 の 期へ★
  await page.waitForFunction(() => document.querySelectorAll('[data-pidx]').length === 3, null, {
    timeout: 15000,
  });
  await page.click('[data-pidx="2"]');
  await page.waitForFunction(() => window.__paper && window.__paper.ninzu() > 0, null, {
    timeout: 15000,
  });
  await page.evaluate(
    () =>
      new Promise((ok, ng) => {
        const s = document.createElement('script');
        s.src = 'js/kami-egaku.js';
        s.onload = () => window.KamiEgaku.yomu().then(ok, ng);
        s.onerror = ng;
        document.head.appendChild(s);
      })
  );
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const P = window.__paper;
    const out = [];
    for (let ei = 0; ei < P.ninzu(); ei++)
      P.sheets(ei).forEach((el) => {
        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.top = '0';
        document.body.appendChild(el);
        const cells = Array.from(el.querySelectorAll('td,th'));
        out.push({
          hi: P.hi(ei),
          haba: el.scrollWidth,
          // ★字の 本当の 幅（Range）と 升の 中の 幅を 比べる★（升は overflow:visible の 物が 在り scrollWidth では はみ出しが 見えない）
          over: cells.filter((c) => {
            const cs = getComputedStyle(c);
            const naka = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            const rg = document.createRange();
            rg.selectNodeContents(c);
            return rg.getBoundingClientRect().width > naka + 0.5;
          }).length,
        });
        el.remove();
      });
    return { ari: document.fonts.check('15px DKKami'), out: out };
  });
  // eslint-disable-next-line no-console
  console.log('★11日★ ' + JSON.stringify(r));
  expect(r.ari, '★字体が 入っていない＝空回り★').toBe(true);
  expect(r.out[0].hi, '★11日の 期で ない＝空回り★').toBe(11);
  r.out.forEach((x, i) => {
    expect(x.over, '★' + (i + 1) + '枚目 升から はみ出した 字 ' + x.over + '個★').toBe(0);
    expect(x.haba, '★' + (i + 1) + '枚目 紙の 幅 ' + x.haba + 'px★').toBeLessThanOrEqual(1123);
  });
  expect(err).toEqual([]);
});
