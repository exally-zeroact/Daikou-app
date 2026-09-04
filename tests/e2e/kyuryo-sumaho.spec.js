// ============================================================
// ★★スマホで 打つ欄が 16px 以上か（iOSで 画面が 勝手に 寄らないか）★★ 2026-09-04
//
//   ★なぜ★ ★iOS は 16px 未満の 入力/選択を 触ると 画面が 勝手に 寄ります★（この repo の 決まり）
//   ★実測（直す前）★ iPhone13(390px) / Pixel5(393px)
//     「時数を入れる」… 13px の select ★10個★
//     「給料の設定」… 13px の 打つ欄/選ぶ箱 ★3個★（poolMode / ownerDev / pMode）
//     ＋ .yen/.hrs/.txt が 13px（resPool / resOwner / pStart / pDays）
//   ⇒ ★打つ欄(.yen/.hrs/.txt)と select を 16px に した★
//     （★チェック箱は 字を 打たないので そのまま★）
//
//   ★横に はみ出していないか も 見る★（スマホで 横スクロールが 出るのは 事故）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-04 実測）★★
//     ①打つ欄を 13px に 戻す … ★2本 赤★（iPhone / Android）
//     戻した後 … ★2本とも 緑★
// ============================================================
// ★事務所の 画面も スマホ幅で 見る（打つ欄が 16px 以上か）★ 使い捨て
const { test, expect, devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const OUT = 'C:/Users/zeroa/dk-tokei-2026-09-02/tokei/';
for (const [na, d] of [
  ['iPhone', devices['iPhone 13']],
  ['Android', devices['Pixel 5']],
]) {
  test('jimusho-' + na, async ({ browser }) => {
    const ctx = await browser.newContext({ ...d });
    const page = await ctx.newPage();
    const err = [];
    page.on('pageerror', (e) => err.push(String(e.message)));
    const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
    const t =
      moto +
      ';(function(){var F=' +
      JSON.stringify(FIX) +
      ';var co={company_id:F.settings[0].company_id,name:"見張り用"};' +
      'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
      ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
      ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
      ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
      'var S=window.DKSession;S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
      'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
      'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
      'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
      'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();';
    await page.route('**/js/dk-session.js*', (r) =>
      r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: t })
    );
    await page.goto('/kyuryo.html');
    await page.waitForTimeout(1600);
    const de = [];
    const warui = [];
    const hamideru = [];
    for (const tab of ['slip', 'hours', 'emp', 'set']) {
      await page.locator('.tab[data-tab="' + tab + '"]').click();
      await page.waitForTimeout(600);
      const r = await page.evaluate(() => {
        const b = document.body;
        const chi = [...document.querySelectorAll('input,select,textarea')]
          .filter((e) => e.offsetParent !== null && e.type !== 'checkbox' && e.type !== 'radio')
          .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16)
          .map((e) => (e.id || e.className || e.tagName) + ':' + getComputedStyle(e).fontSize);
        return { yoko: b.scrollWidth > window.innerWidth + 1, w: b.scrollWidth, chi: chi };
      });
      de.push(
        tab +
          ' 横はみ出し=' +
          r.yoko +
          '(' +
          r.w +
          'px) 16px未満=' +
          r.chi.length +
          (r.chi.length ? ' … ' + r.chi.slice(0, 4).join(' / ') : '')
      );
      if (r.chi.length) warui.push(tab + ':' + r.chi.slice(0, 4).join(','));
      if (r.yoko) hamideru.push(tab + ':' + r.w + 'px');
    }
    console.log('★' + na + '★ 落ち ' + err.length);
    de.forEach((x) => console.log('   ' + x));
    expect(err.length, '★画面が 落ちた★ ' + err.join(' / ')).toBe(0);
    expect(warui.length, '★16px未満の 打つ欄/選ぶ箱が 在ります★ ' + warui.join(' / ')).toBe(0);
    expect(hamideru.length, '★横に はみ出しています★ ' + hamideru.join(' / ')).toBe(0);
    await page.locator('.tab[data-tab="set"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: OUT + 'jimusho-' + na + '.png', fullPage: true });
    await ctx.close();
  });
}
