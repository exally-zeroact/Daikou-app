// ============================================================
// ★★時数を入れる＝日を 選んで その日だけ 見せる★★ 2026-09-06（司さん）
//
//   ★司さんの言葉★
//     「代行請求書アプリのようにカレンダーで日付選んでできるようにしろ
//       その日だけ見せてスッキリさせろ」
//
//   ★前★ 期間の 日を ★全部 縦に 並べていた★（1〜10日なら 10日ぶん）
//     ⇒ 実測 高さ ★1,493px★（390px の 画面で 4画面ぶん）
//   ★今★ ★日の 札を 押すと その日だけ★／「全部」で 今まで通り
//     ⇒ 実測 高さ ★140px★（10日 → 1日）
//   ★打ってある 日には ●★（開かなくても 分かる）
//
//   2026-10-14 司さん「この赤丸も前は代行請求書のように日付選べれよったろが 元にもどせや」
//     日の 札（ボタン 11個）を やめ、入力の 画面と 同じ ‹ 前の日［カレンダー］次の日 › に した。
//     既定は 1日だけ。「期間を全部見る」で 全部。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①絞りを 外す（全部 出す）……… ★赤★
//     ②日の 札を 出さない ………… ★赤★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = FIX.settings[0].company_id;

function sess() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: 'ZERO代行' };
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(FIX) +
    ';var co=' +
    JSON.stringify(co) +
    ';' +
    'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

test('★★日を 選ぶと その日だけ 出る（短く なる）★★', async ({ page }) => {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: sess(),
    })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/kyuryo.html#hours', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const b = document.querySelector('.tab[data-tab="hours"]');
    if (b && b.onclick) b.onclick();
  });
  await page.waitForTimeout(700);
  // 最初は 1日だけ（カレンダーの 欄に その日）
  const hajime = await page.evaluate(() => ({
    hi: document.querySelectorAll('#days [data-date]').length,
    sel: (document.getElementById('hiSel') || {}).value || '',
    kata: (document.getElementById('hiSel') || {}).type || '',
    takasa: document.getElementById('days').getBoundingClientRect().height,
  }));
  // eslint-disable-next-line no-console
  console.log('1日だけ ' + JSON.stringify(hajime));
  expect(hajime.kata, 'カレンダーの 欄が 出ていません').toBe('date');
  expect(hajime.hi, '1日だけに なっていません').toBe(1);
  expect(hajime.sel).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator('#days [data-date="' + hajime.sel + '"]')).toHaveCount(1);

  // 帯が 箱から はみ出さない・下の 行の 字が 縦に 割れない
  //   （2026-10-14 外の 箱と 中の 行を 同じ 横並びに して「時数が入っている日」が 1字ずつ 縦に 割れ、
  //    帯が 932px まで 伸びた。kyuryo-sumaho の 横はみ出しの 見張りは 通っていた）
  const obi = await page.evaluate(() => {
    const c = document.getElementById('hiCard');
    const z = document.querySelector('#hibar .hizen');
    return {
      haba: c.scrollWidth - c.clientWidth,
      takasa: c.getBoundingClientRect().height,
      zen: z ? z.getBoundingClientRect().height : -1,
      doc: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  // eslint-disable-next-line no-console
  console.log('帯 ' + JSON.stringify(obi));
  expect(obi.haba, '日を 選ぶ 帯が はみ出している').toBeLessThanOrEqual(0);
  expect(obi.doc, '画面が 横に はみ出している').toBeLessThanOrEqual(0);
  expect(obi.zen, '下の 行の 字が 縦に 割れている').toBeGreaterThan(0);
  expect(obi.zen, '下の 行の 字が 縦に 割れている').toBeLessThan(40);
  expect(obi.takasa, '帯の 箱が 高すぎる').toBeLessThan(160);

  // 期間を 全部
  await page.click('#hiZen');
  await page.waitForTimeout(300);
  const zenbu = await page.evaluate(() => ({
    hi: document.querySelectorAll('#days [data-date]').length,
    takasa: document.getElementById('days').getBoundingClientRect().height,
  }));
  // eslint-disable-next-line no-console
  console.log('全部 ' + JSON.stringify(zenbu));
  expect(zenbu.hi, '全部が 出ていません').toBeGreaterThan(1);
  expect(hajime.takasa, '1日の 方が 短く なっていません').toBeLessThan(zenbu.takasa);

  // 1日ずつに 戻して、カレンダーで 3日目を 選ぶ
  await page.click('#hiZen');
  await page.waitForTimeout(300);
  const sanbanme = await page.evaluate(() => {
    const i = document.getElementById('hiSel');
    const d = new Date(i.min + 'T00:00:00');
    d.setDate(d.getDate() + 2);
    const v =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');
    i.value = v;
    i.dispatchEvent(new Event('change'));
    return v;
  });
  await page.waitForTimeout(300);
  await expect(page.locator('#days [data-date]')).toHaveCount(1);
  await expect(page.locator('#days [data-date="' + sanbanme + '"]')).toHaveCount(1);

  // 次の日
  await page.click('#nextD');
  await page.waitForTimeout(300);
  const tsugi = await page.evaluate(() => document.getElementById('hiSel').value);
  expect(tsugi > sanbanme, '次の日へ 進んでいません').toBe(true);
  await expect(page.locator('#days [data-date="' + tsugi + '"]')).toHaveCount(1);
});
