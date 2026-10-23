// ============================================================
// ★★見張り：月次集計の 上の 切り替え（紙の 種類）は 390px でも 1行・内わけの 字は 読める 濃さ★★ 2026-10-23
//
//   司さん（iPhone の 写真に 赤丸）月次集計・売上表・回数・距離（年）・売上表（年）の 4つが 2段に 折れていた。
//   ★物差し★
//     ①4つの 札が 同じ 高さの 1行（上の 位置が 揃う）・札の 中で 字が 折れない
//     ②390px では 横に 巻かずに 全部 見える（入らない 狭い 画面だけ 横に 巻ける）
//     ③紙の「内わけ」の 列の 字は 背景に 対して 4.5:1 以上（WCAG AA）＝紙（PDF）も 同じ 部品
//   ★わざと壊して 赤に なるのを 見た★ 直す 前の 版で 赤（2段・内わけ 1.8:1 前後）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = '11111111-2222-3333-4444-555555555555';
const T = {
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
  dk_shift_edits: [{ shift_id: 's1', toll_yen: 3000, bridge_yen: 0, other_yen: 0 }],
  dk_device_labels: [{ device_id: 'd1', label: '4987', sort_order: 1 }],
};
function tsukuru() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  return (
    moto +
    ';(function(){var S=window.DKSession;var co=' +
    JSON.stringify(co) +
    ';var T=' +
    JSON.stringify(T) +
    ';function rows(p){var na=String(p).split("?")[0];return T[na]||[];}' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page, haba) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(),
    })
  );
  await page.setViewportSize({ width: haba, height: 844 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#kamiMado .kami-mise-waku').first()).toBeVisible({ timeout: 15000 });
}

function fudaHakaru() {
  const seg = document.getElementById('kamiSeg');
  const bs = Array.from(seg.querySelectorAll('.segb'));
  return {
    kazu: bs.length,
    ue: bs.map((b) => Math.round(b.getBoundingClientRect().top)),
    // 札の 中で 字が 折れたか＝字の 行の 数
    gyou: bs.map((b) => {
      const r = document.createRange();
      r.selectNodeContents(b);
      const tops = new Set(Array.from(r.getClientRects()).map((x) => Math.round(x.top)));
      return tops.size;
    }),
    makiNokori: seg.scrollWidth - seg.clientWidth,
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}

test('★390px：紙の 種類の 札 4つが 1行・札の 中で 折れない・横に 巻かずに 全部 見える★', async ({
  page,
}) => {
  await hiraku(page, 390);
  const m = await page.evaluate(fudaHakaru);
  expect(m.kazu).toBe(4);
  expect(new Set(m.ue).size, '★札が 2段に 折れている★ ' + JSON.stringify(m.ue)).toBe(1);
  expect(Math.max(...m.gyou), '★札の 中で 字が 折れている★').toBe(1);
  expect(
    m.makiNokori,
    '★390px で 札が 入りきらない（横に 巻かないと 見えない）★'
  ).toBeLessThanOrEqual(0);
  expect(m.page, '★ページが 横に はみ出している★').toBeLessThanOrEqual(0);
});

test('★320px：入らない 時は 札の 中で 折らず 1行の まま 横に 巻ける（ページは はみ出さない）★', async ({
  page,
}) => {
  await hiraku(page, 320);
  const m = await page.evaluate(fudaHakaru);
  expect(new Set(m.ue).size, '★札が 2段に 折れている★').toBe(1);
  expect(Math.max(...m.gyou), '★札の 中で 字が 折れている★').toBe(1);
  expect(m.page, '★ページが 横に はみ出している★').toBeLessThanOrEqual(0);
  const ov = await page.evaluate(
    () => getComputedStyle(document.getElementById('kamiSeg')).overflowX
  );
  if (m.makiNokori > 0) expect(['auto', 'scroll'], '★入らないのに 横に 巻けない★').toContain(ov);
});

test('★紙の「内わけ」の 字は 背景に 対して 4.5:1 以上（画面の 紙＝PDF の 紙）★', async ({
  page,
}) => {
  await hiraku(page, 390);
  await page.selectOption('#kamiTsuki', '1');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    function rgb(s) {
      const m = s.match(/[\d.]+/g).map(Number);
      return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
    }
    function lum(c) {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    }
    function haikei(el) {
      for (let e = el; e; e = e.parentElement) {
        const c = rgb(getComputedStyle(e).backgroundColor);
        if (c.a > 0) return c;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    }
    const kami = document.querySelector('#kamiMado .dk-kami');
    const th = Array.from(kami.querySelectorAll('th')).find(
      (x) => x.textContent.trim() === '内わけ'
    );
    if (!th) return { kazu: 0, min: 0 };
    const tbl = th.closest('table');
    const i = Array.from(th.parentElement.children).indexOf(th);
    const tds = Array.from(tbl.querySelectorAll('tr'))
      .map((tr) => tr.children[i])
      .filter((td) => td && td.tagName === 'TD' && td.textContent.trim());
    const hi = tds.map((td) => {
      const a = lum(rgb(getComputedStyle(td).color));
      const b = lum(haikei(td));
      return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
    });
    return { kazu: tds.length, min: Math.min(...hi), hi };
  });
  expect(r.kazu, '★内わけの 列が 見つからない（測れていない）★').toBeGreaterThanOrEqual(5);
  expect(r.min, '★内わけの 字が 薄すぎる★ ' + JSON.stringify(r.hi)).toBeGreaterThanOrEqual(4.5);
});
