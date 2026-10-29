// ============================================================
// ★★入力の 請求書の 欄＝メーターで 請求書を 押した 額が 自動で 入る★★ 2026-10-30
//
//   司さん 10-29「入力の自動反映されてる項目でメーターの方で請求書押してるんやから請求書も自動で反映されるようにしろ」
//             「代行請求書アプリの方を修正しても事務所の方に反映されるようにしろ」
//   元＝窓 dk_meisai_gyoumu_goukei（請求書アプリの 明細を 業務ごとに 足した 額＝直し・消しが 入る）
//
//   ★ここで 守る 物★
//     ① 空の 欄の 見本の 字＝メーターの 額（車の 欄＝その 日の 回の 合計・明細の 日が 違う 行は 入れない）
//     ② 0 を 打った 欄は「0」と 描く（0＝請求書 なし）／打った 額は その まま
//     ③ 空に すると null を 送る（0 を 送ると 黙って「請求書 なし」に なる）・0 は 0
//     ④ 窓が 読めない 時は 赤い 字（黙って 0円と 出さない）
//     ⑤ 別の 回に 打った 車＝空の 回の 見本は 0（打った 額だけ 使う）
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-30 実測）★★
//     js/jippi-hozon.js yomuSeikyu で 空を null で なく 0 に する ⇒ ★赤 2本★（③ 空で 0 を 送った・⑤ 戻した 後の 見本が 0 の まま）
//     nyuryoku.html saveJippi の 読めない 字の 門（yomuSeikyu(value) === null）を 外す ⇒ ★赤 1本★（③-2 -5 を 送った）
//     nyuryoku.html bindYen の badInput の 門を 外す（v = i.value のみ）⇒ ★赤★（③-2 3-000 を null で 送った）
//     nyuryoku.html bindYen の onblur を 外す ⇒ ★赤★（③-3 空の 欄の 3-000 で 赤い 字が 出ない）
// ============================================================
const { test, expect } = require('@playwright/test');
const { zenbuAkeru } = require('./nyuryoku-akeru.js');
const fs = require('fs');
const path = require('path');

const CO = { company_id: 'c1', name: 'ZERO代行' };
const HI = '2026-09-02';
const LABELS = [
  { company_id: 'c1', device_id: 'd1', label: '4987', sort_order: 1 },
  { company_id: 'c1', device_id: 'd2', label: '1466', sort_order: 2 },
];
// d1 は 1日 2回（s1・s1b）・d2 は 1回（s2）
const SH = [
  { shift_id: 's1', device_id: 'd1', started_at: HI + 'T10:00:00Z', fare_total_yen: 10000 },
  { shift_id: 's1b', device_id: 'd1', started_at: HI + 'T13:00:00Z', fare_total_yen: 5200 },
  { shift_id: 's2', device_id: 'd2', started_at: HI + 'T11:00:00Z', fare_total_yen: 8000 },
];
// 窓の 返り（業務×明細の 日）。s2 の 9/3 の 行は 請求書アプリで 日を 動かした 明細＝この 日には 入れない
const G = [
  { shift_id: 's1', date: HI, goukei: 3000 },
  { shift_id: 's1b', date: HI, goukei: 2000 },
  { shift_id: 's2', date: HI, goukei: 4500 },
  { shift_id: 's2', date: '2026-09-03', goukei: 999 },
];

async function hiraku(page, edits, gDame) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const stub =
    moto +
    ';(function(){var D=' +
    JSON.stringify({ co: CO, L: LABELS, SH: SH, HI: HI, E: edits || [], G: G, GD: !!gDame }) +
    ';var S=window.DKSession;' +
    'if(!S){window.__dameSession=1;return;}window.__okutta=[];window.__gYonda=0;' +
    'function rows(p){p=String(p);' +
    ' if(p.indexOf("dk_shift_edits")===0)return D.E;' +
    ' if(p.indexOf("dk_meisai_gyoumu_goukei")===0){window.__gYonda++;' +
    '  var m=/date=eq\\.([^&]*)/.exec(p);var hi=m?decodeURIComponent(m[1]):null;' +
    '  return D.G.filter(function(r){return !hi||r.date===hi;}).concat(D.G.filter(function(r){return hi&&r.date!==hi;}));}' +
    ' if(p.indexOf("dk_shifts")===0){var m=/select=([^&]*)/.exec(p);if(!m)return D.SH;' +
    ' var c=decodeURIComponent(m[1]).split(",");return D.SH.map(function(r){var o={};' +
    ' c.forEach(function(k){if(k in r)o[k]=r[k];});return o;});}' +
    ' if(p.indexOf("dk_device_labels")===0)return D.L; return [];}' +
    'S.ensure=function(){return Promise.resolve({access_token:"t"});};' +
    'S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return D.co.company_id;};' +
    'S.pickCompany=function(){return {mode:"one",company:D.co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){' +
    ' return Promise.resolve([D.co]);}});};' +
    'S.rest=function(s,p,o){ if(o&&o.method)window.__okutta.push({saki:p,body:o.body});' +
    ' return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},' +
    ' json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;' +
    ' if(D.GD&&String(p).indexOf("dk_meisai_gyoumu_goukei")===0){if(st)st.failed++;return Promise.resolve([]);}' +
    ' return Promise.resolve(rows(p));};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: stub })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/nyuryoku.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.fill('#hiSel', HI);
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(1500);
  await zenbuAkeru(page);
  const dame = await page.evaluate(() => !!window.__dameSession);
  expect(dame, '★作り物（DKSession）が 効いていません★＝この 試験は 何も 見ていません').toBe(false);
}

// 車の 上の 欄（.ran-ue）の 請求書の 欄と 下の 字
async function ueNoRan(page, na) {
  const i = page.locator('.sha', { hasText: na }).locator('.ran-ue input[data-f="seikyu_yen"]');
  await expect(i, '★' + na + ' の 請求書の 欄が 無い★').toHaveCount(1);
  return {
    i,
    value: await i.inputValue(),
    ph: await i.getAttribute('placeholder'),
    hint: await i.evaluate((el) => {
      const h = el.closest('.frow').querySelector('[data-seikyu-hint]');
      return h ? h.textContent : '';
    }),
  };
}

test('★★① 空の 欄の 見本＝メーターで 請求書を 押した 額（車の 日の 合計・日を 動かした 明細は 入れない）★★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page);
  const d1 = await ueNoRan(page, '4987');
  const d2 = await ueNoRan(page, '1466');
  // eslint-disable-next-line no-console
  console.log(
    '★①★ ' + JSON.stringify({ d1: [d1.value, d1.ph, d1.hint], d2: [d2.value, d2.ph, d2.hint] })
  );
  expect(err, '★画面が 落ちました★').toEqual([]);
  expect(await page.evaluate(() => window.__gYonda), '★窓を 読んでいません★').toBeGreaterThan(0);
  expect(d1.value, '★打っていないのに 字が 入っている★').toBe('');
  expect(d1.ph, '★2回 走った 車の 見本が 回の 合計（3,000＋2,000）で ない★').toBe('5000');
  expect(d1.hint).toContain('5,000円');
  expect(d1.hint).toContain('空＝メーター');
  expect(d2.ph, '★日を 動かした 明細（999）を 混ぜた か、額が 違う★').toBe('4500');
});

test('★★② 0 は「0」・打った 額は その まま（見本の 字では ない）★★', async ({ page }) => {
  await hiraku(page, [
    { shift_id: 's1b', seikyu_yen: 7000 },
    { shift_id: 's2', seikyu_yen: 0 },
  ]);
  const d1 = await ueNoRan(page, '4987');
  const d2 = await ueNoRan(page, '1466');
  // eslint-disable-next-line no-console
  console.log('★②★ ' + JSON.stringify({ d1: [d1.value, d1.hint], d2: [d2.value, d2.hint] }));
  expect(d1.value, '★打った 額が 出ない★').toBe('7000');
  expect(d1.hint).toContain('打った 額');
  expect(d1.hint, '★打った 時の メーターの 額が 出ない★').toContain('5,000円');
  expect(d2.value, '★0 を 空に 描いた（メーターの 額と 読まれる）★').toBe('0');
});

test('★★③ 空に すると null・0 は 0 を 送る★★', async ({ page }) => {
  await hiraku(page, [{ shift_id: 's2', seikyu_yen: 6000 }]);
  const d2 = await ueNoRan(page, '1466');
  for (const [ji, kitai] of [
    ['', null],
    ['0', 0],
    ['4800', 4800],
  ]) {
    await page.evaluate(() => {
      window.__okutta = [];
    });
    await d2.i.fill(ji);
    await d2.i.dispatchEvent('change');
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => window.__okutta || []);
    expect(r.length, '★「' + ji + '」を 打っても 送っていません★').toBeGreaterThan(0);
    const b = JSON.parse(r[r.length - 1].body);
    expect(r[r.length - 1].saki).toContain('dk_shift_edits');
    expect(b.seikyu_yen, '★「' + ji + '」で 送った 額が 違う★').toBe(kitai);
  }
  // 空に した 後は 見本が メーターの 額に 戻る
  await d2.i.fill('');
  await d2.i.dispatchEvent('change');
  await page.waitForTimeout(600);
  const ato = await ueNoRan(page, '1466');
  expect(ato.ph, '★空に した 後の 見本が メーターの 額で ない★').toBe('4500');
  expect(ato.hint).toContain('空＝メーター');
});

test('★★③-2 読めない 字（-5・1.5・1e3）は 送らず 赤い 字（黙って メーターの 額に しない）★★', async ({
  page,
}) => {
  await hiraku(page, [{ shift_id: 's2', seikyu_yen: 6000 }]);
  const d2 = await ueNoRan(page, '1466');
  const errJi = () => page.evaluate(() => (document.getElementById('err') || {}).textContent || '');
  for (const ji of ['-5', '1.5', '1e3']) {
    await page.evaluate(() => {
      window.__okutta = [];
    });
    await d2.i.fill(ji);
    await d2.i.dispatchEvent('change');
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => window.__okutta || []);
    const err = await errJi();
    // eslint-disable-next-line no-console
    console.log('★③-2★ ' + ji + ' 送った=' + r.length + ' 字=' + JSON.stringify(err));
    expect(r.length, '★読めない「' + ji + '」を 送った（null＝メーターの 額で 保存される）★').toBe(
      0
    );
    expect(err, '★読めない「' + ji + '」で 赤い 字が 出ない★').toContain('0以上の 整数');
  }
  // 形の 崩れた 字（3-000）＝欄の value は 空・badInput（Android の Chrome 等）＝空と 読んで メーターの 額を 送らない（対立役 止1）
  await page.evaluate(() => {
    window.__okutta = [];
  });
  await d2.i.click();
  await d2.i.press('Control+A');
  await page.keyboard.type('3-000');
  await d2.i.press('Tab');
  await page.waitForTimeout(600);
  const bad = await d2.i.evaluate((el) => ({ v: el.value, bad: el.validity.badInput }));
  const rBad = await page.evaluate(() => window.__okutta || []);
  // eslint-disable-next-line no-console
  console.log('★③-2★ 3-000 ' + JSON.stringify(bad) + ' 送った=' + rBad.length);
  expect(rBad.length, '★形の 崩れた「3-000」を 空（null）で 送った★').toBe(0);
  expect(await errJi(), '★形の 崩れた「3-000」で 赤い 字が 出ない★').toContain('0以上の 整数');
  // 直して 打てば 送り、赤い 字は 消える
  await d2.i.fill('4800');
  await d2.i.dispatchEvent('change');
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => window.__okutta || []);
  expect(r.length, '★直した 額を 送っていない★').toBeGreaterThan(0);
  expect(JSON.parse(r[r.length - 1].body).seikyu_yen).toBe(4800);
  expect(await errJi(), '★直した 後も 赤い 字が 残る★').not.toContain('0以上の 整数');
});

test('★★③-3 空の 欄に 崩れた 字（3-000）＝change が 来ない＝離れた 時に 赤い 字・空に 戻すと 送る・正しい 字は 1回だけ★★', async ({
  page,
}) => {
  await hiraku(page, []);
  const d2 = await ueNoRan(page, '1466');
  const errJi = () => page.evaluate(() => (document.getElementById('err') || {}).textContent || '');
  const okutta = () => page.evaluate(() => window.__okutta || []);
  const kara = () =>
    page.evaluate(() => {
      window.__okutta = [];
    });
  // 空の 欄から 3-000（本番で 一番 多い 形＝null 24行）
  await kara();
  await d2.i.click();
  await page.keyboard.type('3-000');
  await d2.i.press('Tab');
  await page.waitForTimeout(600);
  const st = await d2.i.evaluate((el) => ({ v: el.value, bad: el.validity.badInput }));
  // eslint-disable-next-line no-console
  console.log('★③-3★ 空から 3-000 ' + JSON.stringify(st) + ' 送った=' + (await okutta()).length);
  expect((await okutta()).length, '★崩れた 字を 送った★').toBe(0);
  expect(await errJi(), '★空の 欄に 崩れた 字を 打っても 赤い 字が 出ない★').toContain(
    '0以上の 整数'
  );
  // 赤い 字の 後に 欄を 空に して 離れる（change は 来ない）＝空（null）で 送り 赤い 字は 消える
  await kara();
  await d2.i.click();
  await d2.i.press('Control+A');
  await d2.i.press('Delete');
  await d2.i.press('Tab');
  await page.waitForTimeout(600);
  const r1 = await okutta();
  expect(r1.length, '★空に 戻しても 送らない（赤い 字が 残る）★').toBe(1);
  expect(JSON.parse(r1[0].body).seikyu_yen).toBe(null);
  expect(await errJi(), '★空に 戻した 後も 赤い 字が 残る★').not.toContain('0以上の 整数');
  // 正しい 字は change で 1回だけ（離れた 時に 二重に 送らない）
  await kara();
  await d2.i.click();
  await page.keyboard.type('4500');
  await d2.i.press('Tab');
  await page.waitForTimeout(600);
  const r2 = await okutta();
  expect(r2.length, '★正しい 字を 二重に 送った／送らない★').toBe(1);
  expect(JSON.parse(r2[0].body).seikyu_yen).toBe(4500);
});

test('★★④ 窓が 読めない 時は 赤い 字（黙って 0円に しない）★★', async ({ page }) => {
  await hiraku(page, [], true);
  const d2 = await ueNoRan(page, '1466');
  // eslint-disable-next-line no-console
  console.log('★④★ ' + JSON.stringify([d2.ph, d2.hint]));
  expect(d2.ph, '★読めないのに 見本に 額を 出した★').toBe('');
  expect(d2.hint).toContain('読めませんでした');
});

test('★★⑤ 別の 回に 打った 車＝空の 回の 見本は 0（打った 額だけ 使う）★★', async ({ page }) => {
  // 1回目（s1）に 打った＝別の 回にも 額が 在る＝回ごとの 欄が 出る
  await hiraku(page, [{ shift_id: 's1', seikyu_yen: 1000 }]);
  const kai = page
    .locator('.sha', { hasText: '4987' })
    .locator('.kai[data-kai-sid="s1b"] input[data-f="seikyu_yen"]');
  await expect(kai, '★2回目の 請求書の 欄が 無い★').toHaveCount(1);
  const ph = await kai.getAttribute('placeholder');
  const hint = await kai.evaluate(
    (el) => el.closest('.frow').querySelector('[data-seikyu-hint]').textContent
  );
  // eslint-disable-next-line no-console
  console.log('★⑤★ ' + JSON.stringify([ph, hint]));
  expect(ph, '★空の 回に メーターの 額を 見せた（月次では 0円）★').toBe('0');
  expect(hint).toContain('別の 回に 打った 額だけ');
  // 1回目を 空に 戻すと 2回目の 見本は メーターの 額（2,000）に 戻る
  const ichi = page
    .locator('.sha', { hasText: '4987' })
    .locator('.kai[data-kai-sid="s1"] input[data-f="seikyu_yen"]');
  await ichi.fill('');
  await ichi.dispatchEvent('change');
  await page.waitForTimeout(600);
  expect(await kai.getAttribute('placeholder'), '★戻した 後の 見本が メーターの 額で ない★').toBe(
    '2000'
  );
});
