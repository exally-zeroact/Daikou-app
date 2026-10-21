// ============================================================
// ★★見張り：売上表・月次集計の 紙（KamiPdf.mise）＝PC（巻き棒が 幅を 取る）でも 右が 切れない★★ 2026-10-21
//   事務所の 給料画面（kyuryo-jimusho-makibou）で 直した 穴と 同じ 形が js/kami-pdf.js の mise にも 在った
//   紙を 入れる 前に 幅を 測る＝紙を 入れた 後に 縦の 巻き棒が 出て 幅が 縮む（resize は 起きない）
//   試験の chromium は 既定で 巻き棒を 隠す＝この ファイルだけ 隠さずに 開く
//   ★高さに 頼らない★（テスト線だけ 上に「テスト用」の 帯 約25px が 出る＝本番の CI で 前提が 崩れた・10-21）
//     ①800×700＝紙を 入れて 巻き棒が 出る 形 ②巻き棒の 無い 高さで 開き、自分で ページを 伸ばして 巻き棒を 出す 形
//   ★★わざと壊して 赤に なるのを 見た（2026-10-21 実測）★★
//     直す 前の js/kami-pdf.js … 4本 赤（800px で 紙の 右が 14px 切れる）
//       測った 数：800×600〜1000 で 売上表 5形・月次集計 11形 切れた（1000・1100・1280px は 切れ 0）
//     ResizeObserver を 外す … ②の 2本 赤
//     縮めを 0.5倍に する（縮めすぎ）・毎回 0.98倍ずつ 縮め 続ける（回り続け）… 前は 4本 緑の まま（対立役）＝右の 空き ≤3px と 落ち着いた 後 0.5秒 描き直し 0 を 足した
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.use({
  timezoneId: 'Asia/Tokyo',
  launchOptions: {
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--host-resolver-rules=MAP *.supabase.co ~NOTFOUND'],
  },
});

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
  dk_shift_edits: [],
  dk_device_labels: [{ device_id: 'd1', label: '4987', sort_order: 1 }],
  dk_trips: [],
  meisai: [],
  dk_day_extras: [],
};
function sess() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  return (
    moto +
    ';(function(){var S=window.DKSession;var co=' +
    JSON.stringify(co) +
    ';var T=' +
    JSON.stringify(T) +
    ';' +
    'function rows(p){var na=String(p).split("?")[0];return T[na]||[];}' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page, na, w, h) {
  await page.addInitScript(() => {
    window.__errs = [];
    window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
  });
  await page.clock.setFixedTime(new Date('2026-01-20T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: sess() })
  );
  await page.setViewportSize({ width: w, height: h });
  await page.goto('/' + na + '.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#kamiMado .kami-mise-waku').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);
}
async function hakaru(page) {
  await page.evaluate(
    () =>
      new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))
      )
  );
  // ★落ち着いた 後 0.5秒 紙が 描き直され 続けないか★（縮め 続ける 壊れ方は error も 切れも 出ない・対立役）
  const kawari = await page.evaluate(
    () =>
      new Promise((r) => {
        let n = 0;
        const mo = new MutationObserver((l) => {
          n += l.length;
        });
        document.querySelectorAll('#kamiMado .kami-mise-waku').forEach((w) => {
          mo.observe(w, { attributes: true, attributeFilter: ['style', 'data-sc'] });
          if (w.firstElementChild)
            mo.observe(w.firstElementChild, { attributes: true, attributeFilter: ['style'] });
        });
        setTimeout(() => {
          mo.disconnect();
          r(n);
        }, 500);
      })
  );
  const m = await page.evaluate(() => {
    const d = document.documentElement;
    const waku = Array.from(document.querySelectorAll('#kamiMado .kami-mise-waku'));
    return {
      errs: window.__errs,
      bou: window.innerWidth - d.clientWidth,
      maisu: waku.length,
      migi: Math.max(
        0,
        ...waku.map((x) =>
          Math.round(
            x.firstElementChild.getBoundingClientRect().right - x.getBoundingClientRect().right
          )
        )
      ),
      // ★縮めすぎ★＝箱の 中の 幅 − 紙の 幅（右の 空き）。0.5倍に 縮めすぎる 壊れ方は 切れないので 別に 見る（対立役）
      aki: Math.max(
        0,
        ...waku.map((x) =>
          Math.round(x.clientWidth - x.firstElementChild.getBoundingClientRect().width)
        )
      ),
    };
  });
  m.kawari = kawari;
  return m;
}

for (const na of ['uriage', 'shukei']) {
  test(`★${na}：PC 800×700 で 紙を 入れて 巻き棒が 出ても 右が 切れない★`, async ({ page }) => {
    await hiraku(page, na, 800, 700);
    const m = await hakaru(page);
    expect(m.errs, '★window の error が 出ている★').toEqual([]);
    expect(m.bou, '★巻き棒が 幅を 取っていない＝この 形を 測っていない★').toBeGreaterThan(0);
    expect(m.maisu, '★紙が 1枚も 無い＝何も 測っていない★').toBeGreaterThan(0);
    expect(m.migi, '★紙が 右で 切れている（見切れ）★').toBeLessThanOrEqual(1);
    expect(m.aki, '★紙を 縮めすぎ（右に 空き）★').toBeLessThanOrEqual(3);
    expect(m.kawari, '★落ち着いた 後も 紙が 描き直され 続ける★').toBe(0);
  });

  test(`★${na}：PC 800・紙の 後で ページが 伸びて 巻き棒が 出ても 右が 切れない★`, async ({
    page,
  }) => {
    await hiraku(page, na, 800, 3000);
    const mae = await hakaru(page);
    expect(mae.bou, '★伸ばす 前から 巻き棒が 在る＝後から 出る 形を 測っていない★').toBe(0);
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.style.height = '4000px';
      document.body.appendChild(d);
    });
    await page.waitForTimeout(300);
    const m = await hakaru(page);
    expect(m.errs, '★window の error が 出ている★').toEqual([]);
    expect(m.bou, '★伸ばしても 巻き棒が 出ない＝この 形を 測っていない★').toBeGreaterThan(0);
    expect(m.maisu, '★紙が 1枚も 無い＝何も 測っていない★').toBeGreaterThan(0);
    expect(m.migi, '★紙が 右で 切れている（見切れ）★').toBeLessThanOrEqual(1);
    expect(m.aki, '★紙を 縮めすぎ（右に 空き）★').toBeLessThanOrEqual(3);
    expect(m.kawari, '★落ち着いた 後も 紙が 描き直され 続ける★').toBe(0);
  });
}
