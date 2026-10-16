// ============================================================
// ★給料の 時数の 画面で「＋新しい車…」を 選ぶと 車が 足される★ 2026-10-14
//
//   前は この 画面に 無い 関数（saveLabel）を 呼んで 落ち、名前も その日の 行も 保存されなかった
//   （ReferenceError・画面には 何も 出ない）。
//   見る 事：名前の 棚（dk_device_labels）と その日の 行（dk_manual_days）に 1回ずつ 書き、画面に その 名前が 出る
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = FIX.settings[0].company_id;

function sess(kakenai) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: 'ZERO代行' };
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(FIX) +
    ';var co=' +
    JSON.stringify(co) +
    ';var KAKENAI=' +
    JSON.stringify(kakenai || '') +
    ';window.__kaita=[];' +
    'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){var m=(o&&o.method)||"GET";' +
    ' if(m!=="GET"){window.__kaita.push({p:p,m:m,b:o&&o.body?JSON.parse(o.body):null});' +
    '  if(KAKENAI&&p.indexOf(KAKENAI)===0)return Promise.resolve({ok:false,status:500,text:function(){return Promise.resolve("x");},json:function(){return Promise.resolve({});}});}' +
    ' return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page, kakenai) {
  const ochita = [];
  page.on('pageerror', (e) => ochita.push(String(e && e.message)));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: sess(kakenai),
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
  return ochita;
}

test('「＋新しい車…」＝名前と その日の 行を 保存し 画面に 出る（落ちない）', async ({ page }) => {
  const ochita = await hiraku(page);
  const sel = page.locator('#days select[data-man-add]').first();
  await expect(sel).toHaveCount(1);
  const hi = await sel.getAttribute('data-man-add');
  page.once('dialog', (d) => d.accept('9号車'));
  await sel.selectOption('__new__');
  await page.waitForTimeout(800);
  const kaita = await page.evaluate(() => window.__kaita);
  const na = kaita.filter((k) => k.p.indexOf('dk_device_labels') === 0);
  const gyou = kaita.filter((k) => k.p.indexOf('dk_manual_days') === 0);
  expect(ochita, '画面で 落ちた').toEqual([]);
  expect(na.length, '名前の 書き込み').toBe(1);
  expect(na[0].b.device_id).toMatch(/^manual-[0-9a-z]+$/); // 印は 名前から 作らない
  expect(na[0].b.label).toBe('9号車');
  expect(gyou.length, 'その日の 行の 書き込み').toBe(1);
  expect(gyou[0].b.device_id).toBe(na[0].b.device_id);
  expect(gyou[0].b.work_date).toBe(hi);
  // 選ぶ 欄（option）の 字では なく、その日の 行に 名前が 出る
  const deta = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('#days *')).filter(
        (e) =>
          e.tagName !== 'OPTION' &&
          e.tagName !== 'SELECT' &&
          !e.closest('select') &&
          Array.from(e.childNodes).some(
            (n) => n.nodeType === 3 && n.textContent.indexOf('9号車') >= 0
          )
      ).length
  );
  expect(deta, 'その日の 行に 名前が 出ない').toBeGreaterThan(0);
});

test('名前を 保存できない＝その日の 行は 足さず 知らせる', async ({ page }) => {
  const ochita = await hiraku(page, 'dk_device_labels');
  const sel = page.locator('#days select[data-man-add]').first();
  page.once('dialog', (d) => d.accept('8号車'));
  await sel.selectOption('__new__');
  await page.waitForTimeout(800);
  const kaita = await page.evaluate(() => window.__kaita);
  expect(ochita, '画面で 落ちた').toEqual([]);
  expect(kaita.filter((k) => k.p.indexOf('dk_manual_days') === 0).length).toBe(0);
  await expect(page.locator('body')).toContainText('車の名前を保存できませんでした');
});

for (const [na, ire] of [
  ['同じ 名前の 車が 在る（1号車）', '1号車'],
  ['前後に 空白が 付いた 同じ 名前', ' 2号車 '],
  ['空白だけ', '   '],
]) {
  test('作らない：' + na + '＝名前も 行も 書かない', async ({ page }) => {
    const ochita = await hiraku(page);
    const sel = page.locator('#days select[data-man-add]').first();
    page.once('dialog', (d) => d.accept(ire));
    await sel.selectOption('__new__');
    await page.waitForTimeout(800);
    const kaita = await page.evaluate(() => window.__kaita);
    expect(ochita, '画面で 落ちた').toEqual([]);
    expect(kaita.length, '何か 書いた').toBe(0);
    if (ire.trim()) await expect(page.locator('#err')).toContainText('もう あります');
  });
}

test('名前は 書けて その日の 行だけ 書けない＝赤字を 出し、選ぶ 欄は 戻る（もう一度 選べる）', async ({
  page,
}) => {
  const ochita = await hiraku(page, 'dk_manual_days');
  const sel = page.locator('#days select[data-man-add]').first();
  page.once('dialog', (d) => d.accept('7号車'));
  await sel.selectOption('__new__');
  await page.waitForTimeout(800);
  expect(ochita, '画面で 落ちた').toEqual([]);
  await expect(page.locator('#err')).toContainText('手で入れた分を保存できませんでした');
  await expect(page.locator('#days select[data-man-add]').first()).toHaveValue('');
});

// ── 本番前の 対立役（42c560eb9）の 指摘：描き直しが 転んだ 時 ──
test('設定の 車の 名前欄：描き直しが 転ぶ＝「保存しましたが…読み込み直して」と 出る（黙らない）', async ({
  page,
}) => {
  const ochita = await hiraku(page);
  await page.evaluate(() => {
    const b = document.querySelector('.tab[data-tab="set"]');
    if (b && b.onclick) b.onclick();
  });
  await page.waitForTimeout(500);
  const ran = page.locator('#carBody input[data-f="label"]').first();
  await expect(ran).toHaveCount(1);
  await page.evaluate(() => document.getElementById('carSaved').remove()); // flash を 転ばせる
  await ran.fill('名前替え号');
  await ran.dispatchEvent('change');
  await page.waitForTimeout(800);
  expect(ochita).toEqual([]);
  await expect(page.locator('#err')).toContainText('車の名前は保存しましたが');
});

test('「＋新しい車…」で 描き直しが 転ぶ＝書けた 行を「保存できませんでした」と 言わず、赤字は 消えない', async ({
  page,
}) => {
  const ochita = await hiraku(page);
  await page.evaluate(() => {
    window.PayrollDaily.buildCtx = function () {
      throw new Error('わざと');
    };
  });
  const sel = page.locator('#days select[data-man-add]').first();
  page.once('dialog', (d) => d.accept('6号車'));
  await sel.selectOption('__new__');
  await page.waitForTimeout(1000);
  const kaita = await page.evaluate(() => window.__kaita);
  expect(ochita).toEqual([]);
  expect(kaita.filter((k) => k.p.indexOf('dk_manual_days') === 0).length).toBe(1);
  await expect(page.locator('#err')).toContainText('保存しましたが');
  await expect(page.locator('#err')).not.toContainText('保存できませんでした');
});

test('描き直しが 転んだ 後、次の 保存で 描けたら「読み込み直して」は 消える（直った 後まで 出さない）', async ({
  page,
}) => {
  await hiraku(page);
  const moto = await page.evaluate(() => {
    window.__motoCtx = window.PayrollDaily.buildCtx;
    window.PayrollDaily.buildCtx = function () {
      throw new Error('わざと');
    };
    return true;
  });
  expect(moto).toBe(true);
  const sel = page.locator('#days select[data-man-add]').first();
  page.once('dialog', (d) => d.accept('5号車'));
  await sel.selectOption('__new__');
  await page.waitForTimeout(1000);
  await expect(page.locator('#err')).toContainText('読み込み直して');
  // 直った（転ばない）状態で もう 1台 足す
  await page.evaluate(() => {
    window.PayrollDaily.buildCtx = window.__motoCtx;
  });
  const sel2 = page.locator('#days select[data-man-add]').first();
  page.once('dialog', (d) => d.accept('4号車'));
  await sel2.selectOption('__new__');
  await page.waitForTimeout(1000);
  await expect(page.locator('#err')).not.toContainText('読み込み直して');
});
