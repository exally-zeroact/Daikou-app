// ============================================================
// 給料・月次・売上の 画面は ダイコメの 表を この 会社だけに 絞って 読む 2026-10-17
//
//   前は 会社で 絞らず 読んでいた（設定は limit=1）＝会社を 2つ 持つ 人は 別の 会社の 歩合・人・売上が 混ざる
//   （今は テスト・本番とも 0人）。各画面の 読みの 入口（soft・kSoft・設定・勤務の 分け読み）で kaishaDake を 通す。
//   守る 事：画面が 倉庫へ 出した dk_ の 表の 読みが ★全部★ company_id=eq.<この 会社> を 持つ
//            （読みの 数も 数える＝0件で 緑に しない）。請求の 表（meisai）には 足さない
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const F0 = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = F0.settings[0].company_id;

function sess(F) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: 'ZERO代行' };
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(F) +
    ';var co=' +
    JSON.stringify(co) +
    ';window.__yomi=[];' +
    'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){var m=(o&&o.method)||"GET";if(m==="GET")window.__yomi.push(p);' +
    'return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("[]");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){window.__yomi.push(p);if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page, ura) {
  const F = JSON.parse(JSON.stringify(F0));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: sess(F),
    })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.clock.setFixedTime(new Date('2026-08-05T03:00:00Z'));
  await page.goto(ura, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
}

// ★請求の 窓（頭は dk_ だが 中身は 請求書アプリの 明細＝company_id の 列が 無い）★ 2026-10-25
//   会社で 絞ると 倉庫が 400 を 返し 月次集計が 全部 止まる＝名指しで 外し、絞って いない 事を 別に 見る
// 2026-10-30 業務ごとの 窓（dk_meisai_gyoumu_goukei）も 同じ＝company_id の 列が 無い（窓の 中で 持ち主と 会社で 結ぶ）
const SEIKYU_MADO = ['dk_meisai_hi_goukei', 'dk_meisai_gyoumu_goukei'];
const seikyuMado = (p) => SEIKYU_MADO.indexOf(String(p).split('?')[0]) >= 0;
function mite(yomi, saitei) {
  const dk = yomi.filter((p) => /^dk_/.test(p) && !seikyuMado(p));
  const nuke = dk.filter((p) => p.indexOf('company_id=eq.' + encodeURIComponent(CO)) < 0);
  expect(dk.length, 'ダイコメの 表の 読みが 少な過ぎる（数えて いない）').toBeGreaterThanOrEqual(
    saitei
  );
  expect(nuke, '会社で 絞って いない 読み').toEqual([]);
  // 絞りは 1回だけ（2重に 足さない）
  expect(dk.filter((p) => p.split('company_id=').length > 2)).toEqual([]);
  return dk;
}

test('給料の 画面（明細・紙）は ダイコメの 表を 全部 この 会社だけに 絞って 読む', async ({
  page,
}) => {
  await hiraku(page, '/kyuryo.html');
  // 紙（給料表）を 作る 読み（kSoft）も 通す
  await page.evaluate(() => {
    document.getElementById('kamiCard').open = true;
    document.getElementById('kamiTsuki').click();
  });
  await page.waitForTimeout(2500);
  const yomi = await page.evaluate(() => window.__yomi);
  const dk = mite(yomi, 10);
  // 紙の 読み（勤務を 2回目に 読む）も 入っている
  expect(dk.filter((p) => p.indexOf('dk_shifts') === 0).length).toBeGreaterThanOrEqual(2);
  expect(dk.some((p) => p.indexOf('dk_payroll_settings') === 0)).toBe(true);
});

test('月次の 画面は ダイコメの 表を 全部 この 会社だけに 絞って 読む（請求の 表には 足さない）', async ({
  page,
}) => {
  await hiraku(page, '/shukei.html');
  const yomi = await page.evaluate(() => window.__yomi);
  mite(yomi, 8);
  expect(yomi.filter((p) => /^meisai/.test(p) && p.indexOf('company_id=') >= 0)).toEqual([]);
  // 請求の 窓は 読む・会社で 絞らない（わざと壊す：meisaiZenbu を kaishaDake に 通す ⇒ ★赤★）
  const mado = yomi.filter(seikyuMado);
  expect(mado.length, '★請求の 窓を 読んで いない★').toBeGreaterThan(0);
  expect(
    mado.filter((p) => p.indexOf('company_id=') >= 0),
    '★請求の 窓を 会社で 絞った（400 で 止まる）★'
  ).toEqual([]);
});

test('売上の 画面は ダイコメの 表を 全部 この 会社だけに 絞って 読む', async ({ page }) => {
  await hiraku(page, '/uriage.html');
  const yomi = await page.evaluate(() => window.__yomi);
  const dk = mite(yomi, 5);
  expect(dk.some((p) => p.indexOf('dk_shifts') === 0)).toBe(true);
});
