// ============================================================
// ★★料金表の 一番 上に「今 いくらか」を 紙で 出す★★ 2026-09-05
//
//   ★司さん★「給料明細以外は 分かりやすいように 紙にして
//              スクロールせんでええようにしろ」
//   ★料金表は 打ち込む 画面★（基本料金・加算・割増を 入力する）ので
//   ★入力の 所は そのまま★＝紙に すると 打てなく なる。
//   ⇒ ★一番 上に「今 いくらか」だけ 紙の 表で 出す★（お客さんに 見せる／刷る 用）
//
//   ★横に すべらせない★＝4列（区分／いくら／どこまで／それ以降）
//
//   ★★私が 4回 外した 所（同じ穴を 踏まない為に 書く）★★
//     料金表は ★DKSession.rest を 通りません★。
//     部品（js/fare-config-store.js）が ★fetch で 直に 倉庫を 叩きます★。
//     ⇒ 見本は ★page.route('**\/rest/v1/**')★ で 返す。
//       DKSession だけ 差し替えても ★本文が 出ず 中身は 空★に なります。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-05 実測）★★
//     ①imaKami() を 呼ばない … ★赤★（行が 0本）
//     ②列を 6つに 増やす …… ★赤★（ますから 字が はみ出す）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// ★見本の 料金★（本番の データは 1件も 触りません）
const CFG = {
  base_fare: 1300,
  base_distance_m: 2000,
  add_fare: 100,
  add_distance_m: 500,
  rounding: 10,
  autoSurcharges: {
    night: { enabled: true, from: 22, to: 5, rate: 1.2 },
    weekend: { enabled: true, rate: 1.1 },
  },
};

function tsukuru() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: 'c1', name: '見張り用' };
  return (
    moto +
    ';(function(){var co=' +
    JSON.stringify(co) +
    ';var S=window.DKSession;' +
    'S.ensure=function(){return Promise.resolve({token:"d",access_token:"t"});};' +
    'S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};' +
    'S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve([]);}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve([]);};})();'
  );
}

async function hiraku(page) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(),
    })
  );
  // ★★ここが 肝★★ 料金表は fetch で 直に 倉庫を 叩く
  await page.route('**/rest/v1/**', (r) => {
    const u = r.request().url();
    const body =
      u.indexOf('dk_fare_config') >= 0
        ? [{ config: CFG, updated_at: '2026-09-05T10:00:00Z', updated_by: null }]
        : [];
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/ryokinhyou.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#imaTbl tbody tr').first().waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForTimeout(300);
}

test('★今の 料金が 紙で 出る／横に すべらない★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page);

  const r = await page.evaluate(() => {
    const t = document.getElementById('imaTbl');
    const kire = [];
    t.querySelectorAll('td,th').forEach((c) => {
      if (c.scrollWidth > c.clientWidth + 1) kire.push(c.textContent.trim());
    });
    const yoko = [...document.querySelectorAll('*')].filter((e) => {
      const cs = getComputedStyle(e);
      return (
        (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1
      );
    }).length;
    return {
      head: [...t.querySelectorAll('thead th')].map((x) => x.textContent.trim()),
      gyou: [...t.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.children].map((c) => c.textContent.trim())
      ),
      kire,
      yoko,
      hamidashi: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  // eslint-disable-next-line no-console
  console.log('★料金表★ ' + JSON.stringify(r));

  // ★0を 見て 緑に しない★
  expect(r.gyou.length, '★今の 料金が 1行も 出ていません★').toBeGreaterThan(1);
  expect(r.head, '★見出しが 違います★').toEqual(['区分', 'いくら', 'どこまで', 'それ以降']);

  // ★中身が 入力欄と 食い違っていないか★（基本料金 1,300円／2km）
  const kihon = r.gyou[0];
  expect(kihon[0], '★1行目が 基本料金では ありません★').toBe('基本料金');
  expect(kihon[1], '★基本料金が 違います★').toContain('1,300');
  expect(kihon[2], '★どこまでが 違います★').toContain('2');

  // ★割増も 出す★
  expect(r.gyou.map((g) => g[0]).join(','), '★深夜割増が 出ていません★').toContain('深夜割増');
  expect(r.gyou.map((g) => g[0]).join(','), '★土日割増が 出ていません★').toContain('土日割増');

  // ★★横に すべらない／字が 切れない★★
  expect(r.kire, '★ますから 字が はみ出しています★').toEqual([]);
  expect(r.yoko, '★横に すべる 箱が あります★').toBe(0);
  expect(r.hamidashi, '★画面から はみ出しています★').toBe(0);

  expect(err, '★画面が 落ちました★').toEqual([]);
});

// ============================================================
// ★★料金表は「見るだけ」／決めるのは 会社設定★★ 2026-09-05（司さん）
//   「会社の設定で 料金 触るようにしろや」
//   「設定画面の 中に チップで 車、料金、従業員マスタ つくったら 各ページ 見やすくなるやろ」
//
//   ★入力 220行＋script 約700行を 動かすのは 危ない★ので
//   ★出し方だけ 分けました★（コードは 1本のまま＝二度書かない）
//     ・料金表（下の 帯から）… ★今 いくらかを 見るだけ★
//     ・?henshu=1 …………… ★決める（今までの 入力）★
//     ・会社設定 →「料金」…… ★?henshu=1 へ 行く ボタン★
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-05 実測）★★
//     ①分け方を やめる（いつも 入力を 出す）… ★赤★（見るだけの 段）
//     ②会社設定の ボタンの 行き先を 変える … ★赤★（入口の 段）
// ============================================================
test('★見るだけ＝入力が 出ない／決める＝出る★', async ({ page }) => {
  await hiraku(page);
  const miru = await page.evaluate(() => ({
    card: [...document.querySelectorAll('#honbun > .card')].filter((c) => c.offsetHeight > 0)
      .length,
    nyuryoku: [...document.querySelectorAll('#honbun input')].filter((i) => i.offsetHeight > 0)
      .length,
    kimeruBtn: !!(document.getElementById('miruDake') || {}).offsetHeight,
    hozon: !!(document.getElementById('btnSave') || {}).offsetHeight,
  }));
  // eslint-disable-next-line no-console
  console.log('★見るだけ★ ' + JSON.stringify(miru));
  expect(miru.card, '★紙が 出ていません★').toBe(1);
  expect(miru.nyuryoku, '★見るだけなのに 入力が 出ています★').toBe(0);
  expect(miru.kimeruBtn, '★「料金を 変える」が 出ていません★').toBe(true);
  expect(miru.hozon, '★見るだけなのに 保存が 出ています★').toBe(false);
});

test('★決める（?henshu=1）＝入力が 出る★', async ({ page }) => {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(),
    })
  );
  await page.route('**/rest/v1/**', (r) => {
    const u = r.request().url();
    const body =
      u.indexOf('dk_fare_config') >= 0
        ? [{ config: CFG, updated_at: '2026-09-05T10:00:00Z', updated_by: null }]
        : [];
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/ryokinhyou.html?henshu=1', { waitUntil: 'domcontentloaded' });
  await page.locator('#imaTbl tbody tr').first().waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForTimeout(300);
  const r2 = await page.evaluate(() => ({
    nyuryoku: [...document.querySelectorAll('#honbun input')].filter((i) => i.offsetHeight > 0)
      .length,
    hozon: !!(document.getElementById('btnSave') || {}).offsetHeight,
  }));
  // eslint-disable-next-line no-console
  console.log('★決める★ ' + JSON.stringify(r2));
  expect(r2.nyuryoku, '★入力が 出ていません★').toBeGreaterThan(5);
  expect(r2.hozon, '★保存が 出ていません★').toBe(true);
});
