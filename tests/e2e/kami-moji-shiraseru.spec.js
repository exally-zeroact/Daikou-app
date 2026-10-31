// ============================================================
// ★★字体に 無い 字は〓に して 知らせる★★ 2026-10-31（見本 代行請求書 invoice-pdf.js の _sanitize・lastMissing と 同じ）
//   見本＝fontkit の hasGlyphForCodePoint で 字体に 字が 在るかを 見て、無い字は〓・
//         作った 後に「PDFを作成（注意：この字は出せず〓表示→ 字）」を 出す
//   前の ダイコメ＝幅を 測って 投げたら〓＝pdf-lib は 無い字でも 投げない ⇒ 一度も〓に ならず 豆腐で 黙って 出ていた
//     （測り：髙・𠮷・🙂 で 〓 0）
//   わざと壊す：_sanitize を 前の 形（幅で 見る）に 戻す ⇒ ★赤★（missing 0）
//              本人の 明細で 知らせを 出さない ⇒ ★赤★／事務所の 全員分で 知らせを 出さない ⇒ ★赤★
//   ★設計前 対立役 10-31★ 止1＝スマホで 保存の 案内が 消えた（知らせと 案内の 両方を 見る）／
//     注1＝知らせる 7か所の うち 5か所は 見張り 無し（kamiDasu・printOne・見本・月次集計・売上表 を 足した）／
//     注2＝〓を 本当に 描いたかを 見ていない（PDF の 字を pdf.js で 読んで〓を 見る）
// ============================================================
const { test, expect, devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { hiraku } = require('./honnin-harness');

const ROOT = path.join(__dirname, '..', '..');
const BUN = 'PDFを作成（注意：この字は出せず〓表示→ ';

test.use({ timezoneId: 'Asia/Tokyo' });

test('★道具：字体に 無い 字だけ 集める（髙・﨑・邉は 字体に 在る）★', async ({ page }) => {
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ path: path.join(ROOT, 'js/kami-pdf.js') });
  await page.addScriptTag({ path: path.join(ROOT, 'vendor/pdf.min.js') });
  const r = await page.evaluate(async () => {
    window.open = () => ({});
    async function dasu(ji) {
      const d = document.createElement('div');
      d.style.cssText = 'width:600px;height:400px;position:relative';
      d.innerHTML = '<div>' + ji + '</div>';
      document.body.appendChild(d);
      const x = await window.KamiPdf.dasu([{ el: d, muki: 'tate' }], 't');
      // ★PDF の 中の 字を 読む★（〓を 本当に 描いたか・字体に 在る 字は そのまま か）
      const t = await window.KamiEgaku.tsukuru([{ el: d, muki: 'tate' }], {
        tate: { w: 595, h: 842, bw: 794, bh: 1123, muki: 'portrait' },
        yoko: { w: 842, h: 595, bw: 1123, bh: 794, muki: 'landscape' },
      });
      d.remove();
      const lib = window.pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      const doc = await lib.getDocument({ data: new Uint8Array(await t.blob.arrayBuffer()) })
        .promise;
      const tc = await (await doc.getPage(1)).getTextContent();
      const yometa = tc.items.map((i) => i.str).join('');
      return { missing: x.missing, bun: window.KamiEgaku.missingBun(x.missing), ji: yometa };
    }
    return {
      nai: await dasu('見本 髙橋 𠮷田 﨑 邉 🙂 太郎 𠮷'),
      aru: await dasu('見本 髙橋 﨑 邉 太郎 ¥12,345'),
    };
  });
  expect(r.nai.missing, '★字体に 無い 字を 拾えていない★').toEqual(['𠮷', '🙂']);
  expect(r.nai.bun).toBe(BUN + '𠮷 🙂）');
  expect(r.nai.ji, '★〓を 描いていない（豆腐の まま）★').toContain('〓');
  expect(r.nai.ji).not.toContain('𠮷');
  expect(r.nai.ji).toContain('髙橋');
  expect(r.aru.missing).toEqual([]);
  expect(r.aru.ji).not.toContain('〓');
  expect(r.aru.bun).toBe('');
});

async function nise(page) {
  await page.addInitScript(() => {
    window.__mado = [];
    window.__dl = [];
    HTMLAnchorElement.prototype.click = function () {
      window.__dl.push(this.download);
    };
    window.open = function (u) {
      window.__mado.push(String(u));
      return { closed: false };
    };
  });
}

test('★本人の 明細（PC）：名前に 字体に 無い 字 ⇒ 押すと 知らせる★', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await nise(page);
  await hiraku(page, undefined, undefined, false, { name: '𠮷田太郎' });
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__mado.length), { timeout: 30000 }).toBe(1);
  await expect(page.locator('#hnPdfAnnai')).toHaveText(BUN + '𠮷）');
});

test.describe('iPhone', () => {
  test.use({
    userAgent: devices['iPhone 13'].userAgent,
    viewport: devices['iPhone 13'].viewport,
    isMobile: true,
    hasTouch: true,
  });
  test('★本人の 明細（スマホ）：保存でも 知らせる★', async ({ page }) => {
    await nise(page);
    await hiraku(page, undefined, undefined, false, { name: '𠮷田太郎' });
    await page.click('#hnPdf');
    await expect.poll(() => page.evaluate(() => window.__dl.length), { timeout: 30000 }).toBe(1);
    // ★知らせと 保存の 案内の 両方★（案内が 消えると LINE の 中で 出ない 時の 道が 無くなる・止1）
    const a = page.locator('#hnPdfAnnai');
    await expect(a).toContainText(BUN + '𠮷）');
    await expect(a, '★保存の 案内が 消えた★').toContainText('LINE');
    await expect(a).toContainText('ダウンロード');
  });
  // ★字体を 調べる 道具が 作れない ⇒ 黙って 豆腐で 出さない（保存 0・知らせ）★（見本 invoice-pdf.js も fontkit.create を 包まない）
  //   わざと壊す：_covFont を try/catch で 包む（前の 形）⇒ ★赤★（豆腐の PDF が 保存される）・直した後の 対立役 注B 10-31
  test('★本人の 明細（スマホ）：字体を 調べられない ⇒ 出さずに 知らせる★', async ({ page }) => {
    await nise(page);
    const fkm =
      fs.readFileSync(path.join(ROOT, 'vendor/fontkit.umd.min.js'), 'utf8') +
      ';(function(){var f=window.fontkit;var c=f.create.bind(f);var g=Object.create(f);' +
      'g.create=function(b){if(String(new Error().stack).indexOf("_covFont")>=0){' +
      'window.__fk=(window.__fk||0)+1;throw new Error("fk壊れ");}return c(b);};window.fontkit=g;})();';
    await page.route('**/vendor/fontkit.umd.min.js*', (r) =>
      r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: fkm })
    );
    // 絵も 作れない（同じ 道具）＝描き終わりは 待たない
    await hiraku(page, undefined, undefined, true, { name: '𠮷田太郎' });
    await expect(page.locator('#hnKami')).toContainText('プレビュー作成に失敗', { timeout: 30000 });
    await page.click('#hnPdf');
    await expect(page.locator('#hnPdfErr')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#hnPdfErr')).toContainText('もう一度 押してください');
    expect(
      await page.evaluate(() => window.__fk),
      '★字体を 調べる 所を 通っていない★'
    ).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    expect(
      await page.evaluate(() => window.__dl.length),
      '★調べられないのに 豆腐の PDF を 出した★'
    ).toBe(0);
  });
});

test('★本人の 明細：字体に 在る 名前なら 知らせない（いつもの 案内）★', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await nise(page);
  await hiraku(page, undefined, undefined, false, { name: '髙橋太郎' });
  await page.click('#hnPdf');
  await expect.poll(() => page.evaluate(() => window.__mado.length), { timeout: 30000 }).toBe(1);
  await expect(page.locator('#hnPdfAnnai')).toHaveText(
    'PDFを開きました（印刷・保存は その画面から）'
  );
});

// ★事務所の 給料の 画面「全員を 印刷」★（偽の 倉庫＝kyuryo-insatsu-erabu と 同じ 作り・1人の 名前に 字体に 無い 字）
const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
function jimusho() {
  const F = JSON.parse(JSON.stringify(FIX));
  F.emps[0].name = '𠮷' + F.emps[0].name;
  const CO = F.settings[0].company_id;
  const moto = fs.readFileSync(path.join(ROOT, 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: 'ZERO代行' };
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(F) +
    ';var co=' +
    JSON.stringify(co) +
    ';' +
    'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

test('★事務所の 給料「全員を 印刷」：字体に 無い 字 ⇒ 知らせる★', async ({ page }) => {
  await nise(page);
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: jimusho(),
    })
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/kyuryo.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#btnPrint')).toBeEnabled({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.locator('#btnPrint').click();
  await expect(page.locator('#msg')).toContainText(BUN, { timeout: 30000 });
  await expect(page.locator('#msg')).toContainText('𠮷）');
});

// ============================================================
// ★残りの 5か所も 知らせる★（設計前 対立役 注1 10-31：知らせを 消しても 緑だった）
//   紙を 作る 所は まねて「𠮷 が 出せなかった」を 返す＝★出し口が 知らせを 出すか だけ★を 見る
//   （字を 拾う 所は 上の「道具」の 1本が 見る）
//   わざと壊す：各所の missingBun を 外す ⇒ ★その 1本が 赤★
// ============================================================
const { openKyuryo } = require('./kyuryo-harness');
const MISS = ['𠮷'];

// 事務所の 給料の 画面で 使う 紙の 道具（KamiEgaku）を 読んでから、作る 所だけ まねる
async function egakuMane(page) {
  await page.addScriptTag({ path: path.join(ROOT, 'js/kami-egaku.js') });
  await page.evaluate((miss) => {
    window.KamiEgaku.yomu = () => Promise.resolve();
    window.KamiEgaku.dasu = () => Promise.resolve({ mai: 1, size: 1, missing: miss });
  }, MISS);
}

test('★事務所の 給料「明細を 1人 PDF」（printOne）：知らせる★', async ({ page }) => {
  await openKyuryo(page);
  await egakuMane(page);
  await page.evaluate(() => window.printOne(0));
  await expect(page.locator('#msg')).toHaveText(BUN + '𠮷）', { timeout: 15000 });
});

test('★事務所の 給料「テンプレの 見本 PDF」：知らせる★', async ({ page }) => {
  await openKyuryo(page);
  await page.waitForTimeout(800);
  await page.click('.tab[data-tab="tpl"]');
  await expect(page.locator('#paneTpl')).toBeVisible();
  await page.waitForTimeout(500);
  await egakuMane(page);
  await page.locator('#tplGrid .tpl-card[data-shurui="tsuki1"]').locator('.tpl-pdf').click();
  await expect(page.locator('#msg')).toHaveText(BUN + '𠮷）', { timeout: 15000 });
});

test('★事務所の 給料「給料表（まとめた表）」：知らせる★', async ({ page }) => {
  await openKyuryo(page);
  await page.waitForTimeout(800);
  // 本物の KamiPdf.dasu は 先に 紙の 道具（KamiEgaku）を 読む＝まねる 時も 読んで おく
  await page.addScriptTag({ path: path.join(ROOT, 'js/kami-egaku.js') });
  await page.evaluate((miss) => {
    window.KamiPdf.dasu = () => Promise.resolve({ mai: 1, size: 1, missing: miss });
  }, MISS);
  await page.locator('#kamiCard > summary').click();
  await page.locator('#kamiTsuki').click();
  await expect(page.locator('#kamiNote')).toContainText('出しました（1枚）', { timeout: 15000 });
  await expect(page.locator('#kamiNote')).toContainText(BUN + '𠮷）');
});

// ★月次集計・売上表★（偽の 倉庫＝shukei-kami-miseru・uriage-kami-miseru と 同じ 作り）
const KCO = '11111111-2222-3333-4444-555555555555';
function kuraMane() {
  const moto = fs.readFileSync(path.join(ROOT, 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: KCO, name: '見張り用' };
  const hyou = {
    dk_shifts: [
      {
        shift_id: 's1',
        device_id: 'd1',
        started_at: '2026-01-05T20:00:00+09:00',
        ended_at: '2026-01-06T04:00:00+09:00',
        elapsed_sec: 28800,
        fare_total_yen: 40000,
        trip_count: 12,
        actual_total_m: 80000,
        total_distance_m: 150000,
      },
    ],
    dk_shift_edits: [],
    dk_device_labels: [{ device_id: 'd1', label: '4987', sort_order: 1 }],
  };
  return (
    moto +
    ';(function(){var S=window.DKSession;var co=' +
    JSON.stringify(co) +
    ';var T=' +
    JSON.stringify(hyou) +
    ';' +
    'function rows(p){var na=String(p).split("?")[0];return T[na]||[];}' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}
for (const [na, url] of [
  ['月次集計', '/shukei.html'],
  ['売上表', '/uriage.html'],
]) {
  test(`★${na}の 紙：知らせる★`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-01-20T12:00:00+09:00'));
    await page.route('**/js/dk-session.js*', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: kuraMane(),
      })
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const kami = page.locator('#kamiMado .kami-mise-waku');
    await expect(kami.first()).toBeVisible({ timeout: 15000 });
    await page.addScriptTag({ path: path.join(ROOT, 'js/kami-egaku.js') });
    await page.evaluate((miss) => {
      window.KamiPdf.dasu = () => Promise.resolve({ mai: 1, size: 1, missing: miss });
    }, MISS);
    await kami.first().click();
    await expect(page.locator('#kamiMsg')).toContainText('出しました（1枚）', { timeout: 15000 });
    await expect(page.locator('#kamiMsg')).toContainText(BUN + '𠮷）');
  });
}
