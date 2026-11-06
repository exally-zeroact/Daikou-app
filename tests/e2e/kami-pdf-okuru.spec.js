// ============================================================
// ★★事務所の 紙（売上表・月次集計・給料表）を iPhone・iPad では 共有の 画面に PDF と 字だけ 渡す★★ 2026-11-06
//
//   ★司さんの 答え B★（11-04「LINE で PDF と 一緒に 開けない blob:https://… の URL も 届く・どの アプリでも ならない 様に」）
//     代行請求書 本番 bdecd29 と 同じ 作り（js/pdf-okuru.js）。
//     紙を 作る 数秒の 間に「押した」扱いが 切れる＝共有は 断られる（NotAllowedError）⇒ 帯「送る・印刷する」を 押すと 共有。
//
//   ★ここで 見張る 事★
//     ①断られたら 帯を 出し、新しい タブ（blob の URL）は 開かない・押すと files と text だけで 共有
//     ②押した 後に 選び直した（kesu）＝共有も 帯も 出さない
//     ③帯が 出た 後に 年を 読み直す（#prevY）＝帯を 消す
//     ④PC の 字（userAgent）＝今まで 通り 新しい タブ（共有を 呼ばない）
//     ⑤共有の 画面を 開いた まま 30秒 過ぎても「出せませんでした」に しない（時間切れは 作る 所だけ・対立役 止1）
// ============================================================
const { test, expect, devices } = require('@playwright/test');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

async function nise(page, mode) {
  await page.addInitScript((mode) => {
    window.__kyouyu = [];
    window.__mado = [];
    window.open = function (u) {
      window.__mado.push(String(u));
      return { closed: false };
    };
    window.__kotowaru = mode === 'kotowaru' ? 1 : 0;
    Object.defineProperty(navigator, 'canShare', {
      value: (d) => !!(d && d.files && d.files.length),
      configurable: true,
    });
    Object.defineProperty(navigator, 'share', {
      value: (d) => {
        if (window.__kotowaru > 0) {
          window.__kotowaru--;
          return Promise.reject(new DOMException('need tap', 'NotAllowedError'));
        }
        window.__kyouyu.push({
          keys: Object.keys(d).sort(),
          text: d.text,
          files: (d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })),
        });
        // 'osoi'＝共有の 画面を 開いた まま（31秒 後に 返る）
        if (mode === 'osoi') return new Promise((ok) => setTimeout(ok, 31000));
        return Promise.resolve();
      },
      configurable: true,
    });
  }, mode);
}

// ★頁を 開いた 形に する★（ログインと 倉庫の まね・shukei-kami-miseru.spec.js と 同じ 形・中身は 空）
async function loginMane(page) {
  const fs = require('fs');
  const moto = fs.readFileSync(path.join(ROOT, 'js', 'dk-session.js'), 'utf8');
  const body =
    moto +
    ';(function(){var S=window.DKSession;var co={company_id:"00000000-0000-0000-0000-000000000001",name:"見張り用"};' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve([]);}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve([]);};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body })
  );
}

async function shikomu(page) {
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  for (const f of [
    'js/pdf-okuru.js',
    'js/kami-kumu.js',
    'js/kami-hyou.js',
    'js/kami-shukei.js',
    'js/kami-pdf.js',
  ]) {
    await page.addScriptTag({ path: path.join(ROOT, f) });
  }
}

// 月次集計の 紙 1枚（kami-pdf-dasu.spec.js と 同じ 中身）
const DASU = async (opt) => {
  const K = window.KamiShukei.kaisha(
    'ZERO代行',
    2026,
    9,
    { period_start_day: 1, period_days: 10, reserve_pool_rate: 0.05 },
    { deduct_toll: true, deduct_bridge: true, deduct_other: false },
    null,
    true
  );
  const tsuki = {
    salesTotal: 644000,
    expense: 0,
    invoice: 133500,
    denshi: 0,
    cash: 510500,
    payTotal: 0,
    periods: [{ rangeLabel: '1〜10日', pay: 0 }],
    reserve: 32200,
    ownerShare: 611800,
  };
  const mai = window.KamiHyou.getsuji(
    K,
    window.KamiShukei.getsujiData(tsuki, [{ name: '4987', uriage: 644000, jippi: 0 }])
  );
  const kai = window.PdfOkuru.kesu();
  if (opt && opt.erabinaosu) window.PdfOkuru.kesu();
  const r = await window.KamiPdf.dasu(mai, 'ZERO代行_月次集計_2026-09', { kai: kai });
  return { how: r.how, mai: r.mai };
};

test.describe('iPhone の 字', () => {
  test.use({ userAgent: devices['iPhone 13'].userAgent });

  // わざと壊す：kami-egaku.js watasu の PdfOkuru の 道を 外す ⇒ 赤（窓が 開く・帯 0）
  test('① 断られたら 帯を 出し 窓は 開かない・帯を 押すと PDF と 字だけで 共有', async ({
    page,
  }) => {
    await nise(page, 'kotowaru');
    await shikomu(page);
    const r = await page.evaluate(DASU);
    expect(r.how).toBe('need-tap');
    expect(await page.evaluate(() => window.__mado.length), '★blob の 窓を 開いた★').toBe(0);
    await expect(page.locator('#pdfOkuruObi')).toBeVisible();
    await expect(page.locator('#pdfOkuruMsg')).toContainText('ZERO代行_月次集計_2026-09.pdf');
    await page.click('#pdfOkuruGo');
    await expect.poll(() => page.evaluate(() => window.__kyouyu.length)).toBe(1);
    const d = await page.evaluate(() => window.__kyouyu[0]);
    expect(d.keys, '★鍵は files と text だけ★').toEqual(['files', 'text']);
    expect(d.text).toBe('ZERO代行 月次集計 2026-09');
    expect(d.files[0].name).toBe('ZERO代行_月次集計_2026-09.pdf');
    expect(d.files[0].type).toBe('application/pdf');
    expect(d.files[0].size).toBeGreaterThan(0);
    await expect(page.locator('#pdfOkuruObi')).toHaveCount(0);
    // ★帯は 印刷に 載らない★（もう1回 断らせて 帯を 出してから 印刷の 見え方へ・作った後の 対立役 注1）
    await page.evaluate(() => (window.__kotowaru = 1));
    expect((await page.evaluate(DASU)).how).toBe('need-tap');
    await expect(page.locator('#pdfOkuruObi')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#pdfOkuruObi')).toBeHidden();
  });

  // わざと壊す：js/pdf-okuru.js の 共有の 前の kawatta(opt) を 外す ⇒ 赤（共有 1）
  test('② 押した 後に 選び直したら 共有も 帯も 出さない', async ({ page }) => {
    await nise(page, 'share');
    await shikomu(page);
    const r = await page.evaluate(DASU, { erabinaosu: true });
    expect(r.how).toBe('kawatta');
    expect(await page.evaluate(() => window.__kyouyu.length + window.__mado.length)).toBe(0);
    await expect(page.locator('#pdfOkuruObi')).toHaveCount(0);
  });

  // わざと壊す：shukei.html load() の PdfOkuru.kesu を 外す ⇒ 赤（帯が 残る）
  test('③ 帯が 出た 後に 年を 読み直すと 帯を 消す', async ({ page }) => {
    await nise(page, 'kotowaru');
    await loginMane(page);
    await shikomu(page);
    await expect(page.locator('#prevY')).toBeVisible({ timeout: 15000 });
    await page.evaluate(DASU);
    await expect(page.locator('#pdfOkuruObi')).toBeVisible();
    await page.locator('#prevY').click();
    await expect(page.locator('#pdfOkuruObi')).toHaveCount(0);
  });

  // わざと壊す：kami-pdf.js dasu の _matsu で watasu まで 包む ⇒ 赤（30秒で 投げる）
  test('⑤ 共有の 画面を 開いた まま 30秒 過ぎても 失敗に しない', async ({ page }) => {
    test.setTimeout(90000);
    await nise(page, 'osoi');
    await shikomu(page);
    const r = await page.evaluate(DASU).catch((e) => ({ err: String((e && e.message) || e) }));
    expect(r.err, '★共有の 待ちで 時間切れに なった★').toBeUndefined();
    expect(r.how).toBe('share');
  });
});

test.describe('PC の 字', () => {
  // わざと壊す：watasu の appleTouch の 門を 外す ⇒ 赤（共有を 呼ぶ）
  test('④ PC は 今まで 通り 新しい タブ（共有を 呼ばない）', async ({ page }) => {
    await nise(page, 'share');
    await shikomu(page);
    const r = await page.evaluate(DASU);
    expect(r.how).toBe('hiraita');
    expect(await page.evaluate(() => window.__mado.length)).toBe(1);
    expect(await page.evaluate(() => window.__mado[0])).toMatch(/^blob:/);
    expect(await page.evaluate(() => window.__kyouyu.length)).toBe(0);
  });
});
