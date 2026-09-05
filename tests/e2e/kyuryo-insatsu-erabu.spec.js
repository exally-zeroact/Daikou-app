// ============================================================
// ★★印刷は「全員」と「選んだ人」で 刷り分けられる★★ 2026-09-05
//
//   ★司さん★「印刷も チェックボタン 作って 全体と 選んだ人とか に したら？」
//   ★前★ 押したら ★必ず 全員ぶん★ が 1つの PDF に なっていた
//        ⇒ 1人だけ 刷り直したい 時も 全員ぶん 出る（紙も 時間も 無駄）
//
//   ★この 見張りが 見る 事★
//     ①明細 1人ずつに ★チェックが 出ている★
//     ②1つも 選んでいない時 ★「選んだ人を 印刷」は 押せない★
//     ③選ぶと ★何人 選んだか ボタンに 出る★（押す前に 分かる）
//     ④★選んだ人だけが 紙に 回る★（何人ぶん 作るかを 実際に 数える）
//     ⑤★本人の 画面（?t=）には チェックを 出さない★（配るのは 事務所の 仕事）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-05 実測）★★
//     ①printAll から 絞り込みを 外す（いつも 全員）… ★赤（④の 段）★
//     ②選んだ数を ボタンに 出さない ………………… ★赤（③の 段）★
//     ③本人モードでも チェックを 出す ……………… ★赤（⑤の 段）★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = FIX.settings[0].company_id;

function tsukuru() {
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
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page, ura) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/kyuryo.html' + (ura || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
}

test('★①〜④ 選んだ人だけ 印刷できる★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page);

  // ★①チェックが 人数ぶん 出ている（0個で 緑に しない）★
  const kazu = await page.locator('.slip-pick').count();
  // eslint-disable-next-line no-console
  console.log('★チェック★ ' + kazu + '個');
  expect(kazu, '★明細に チェックが 出ていません★').toBeGreaterThan(1);

  // ★②1つも 選んでいない時は 押せない★
  const sel = page.locator('#btnPrintSel');
  expect(await sel.isDisabled(), '★選んでいないのに 押せます★').toBe(true);

  // ★③選ぶと 何人か ボタンに 出る★
  await page.locator('.slip-pick').first().check();
  await page.waitForTimeout(200);
  expect(await sel.isDisabled(), '★選んだのに 押せません★').toBe(false);
  expect(await sel.textContent(), '★何人 選んだか 出ていません★').toContain('1人');

  // ★★④紙に 回るのが「選んだ人だけ」か を 実際に 数える★★
  //   ★画面に 出る 知らせを 読む★＝printAll が 何人ぶん 作ろうと しているか
  //   （PDF そのものは 作らせない＝重いので、知らせが 出た 所で 見る）
  // ★本当に PDF を 作らせない★（部品の 取り寄せを 止める＝知らせが 出た 所で 見る）
  await page.route(/jspdf|html2canvas/, () => {});
  await page.locator('#btnPrintSel').click();
  await page.waitForTimeout(500);
  const shirase = (await page.locator('#msg').textContent()) || '';
  // eslint-disable-next-line no-console
  console.log('★選んだ人を 印刷 → 知らせ★ 「' + shirase.trim() + '」');
  expect(shirase, '★何人ぶん 作るのか 出ていません★').toContain('1人ぶん');

  // ★全員を 押すと 全員ぶん★（前と 同じ 動きが 残っている事）
  await page.locator('#btnPrint').click();
  await page.waitForTimeout(400);
  const zenin = (await page.locator('#msg').textContent()) || '';
  // eslint-disable-next-line no-console
  console.log('★全員を 印刷 → 知らせ★ 「' + zenin.trim() + '」／人数 ' + kazu);
  expect(zenin, '★全員ぶんに なっていません★').toContain(kazu + '人ぶん');
  expect(err, '★画面が 落ちました★').toEqual([]);
});

test('★⑤本人の 画面（?t=）には チェックを 出さない★', async ({ page }) => {
  await hiraku(page, '?t=dummytoken');
  const n = await page.locator('.slip-pick').count();
  // eslint-disable-next-line no-console
  console.log('★本人の 画面の チェック★ ' + n + '個（0が 正しい）');
  expect(n, '★本人の 画面に 印刷の チェックが 出ています★').toBe(0);
});
