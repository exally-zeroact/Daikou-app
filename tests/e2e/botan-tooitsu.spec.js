// ============================================================
// ★★事務所の ボタンの 動きを 1つに そろえる★★ 2026-11-04（司さん）
//
//   ★司さんの言葉★
//     「ダイコメの事務所のアプリの赤丸の所のボタンやけど（どのページも）訳分からん仕組みになっとん直せ」
//     「こんな作りのアプリ見たことないが」「左上に意味わからん戻るボタンもあるし」
//     「ボタン押してからの動きに統一感ないし」
//
//   ★実測（直す前・テスト線 985f7ae72）★
//     ・会社設定の チップ 5つが 3通り＝会社・実費は その場／料金は 窓（iframe）／車・従業員は 別の 画面（列が 消え、帯は「給料」が 光る）
//     ・頭の「← 戻る」（history.back）と「← 会社設定へ 戻る」が 2つ 並ぶ 画面が 3つ
//     ・kyuryo?henshu=1 で 帯の「給料」を 押しても 動かない（名前だけで「今 居る 所」を 決めていた）
//
//   ★この 試験で 守る 事★
//     ①3画面（会社設定・車/従業員・料金）で チップの 列が 残り、押した 物だけ 光り、帯は 会社設定が 光る
//     ②会社↔実費は その場で 替わる＝打ちかけの 欄が 消えない／?p= が 覚えた 所に 勝つ
//     ③kyuryo?henshu=1 で 帯の「給料」を 押すと 給料の 明細へ 移る
//     ④料金の 画面：保存していない 変更が 在れば 移らず 知らせ、「捨てて 移る」で 移れる
//       （閉じ込めない：読めなかった 時・保存の 後に 読み直しが 転んだ 時は 移れる）
//     ⑤帯の 部品の HEAD（新しい 版を 見る）を 書きかけに 数えない
//
//   ★★わざと壊して 赤に なる事を 見た★★（数は 下の 各試験の 注）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.use({ timezoneId: 'Asia/Tokyo' });

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = { company_id: FIX.settings[0].company_id, name: '見張り用', url_token: 'x' };
const CFG = { base_fare: 1300, base_distance_m: 2000, add_fare: 100, add_distance_m: 500 };

function sess() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(FIX) +
    ';var co=' +
    JSON.stringify(CO) +
    ';' +
    'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({token:"d",access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

// jo＝倉庫の ふるまい（試験の 途中で 変える）
async function hairu(page, jo) {
  jo = jo || {};
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: sess() })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'u1', email: 'mihari@example.com' }),
    })
  );
  await page.route('**/rest/v1/**', (r) => {
    const u = r.request().url();
    const m = r.request().method();
    if (u.indexOf('dk_fare_config') >= 0) {
      if (m === 'GET') {
        if (jo.yomiNG || (jo.atoYomiNG && jo.kaita)) return r.fulfill({ status: 500, body: '{}' });
        return r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ config: CFG, updated_at: '2026-09-05T10:00:00Z' }]),
        });
      }
      jo.kaita = true;
      return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    }
    if (u.indexOf('dk_companies') >= 0)
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([CO]),
      });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  // 料金表の 書き込みの 前の 控え 等（関数）も 外へ 出さない
  await page.route('**/functions/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  );
  await page.setViewportSize({ width: 390, height: 844 });
}

async function miru(page) {
  return page.evaluate(() => ({
    url: location.pathname + location.search + location.hash,
    chips: [...document.querySelectorAll('[data-dkchip]')].map((b) => b.textContent.trim()),
    on: [...document.querySelectorAll('[data-dkchip].on')].map((b) => b.textContent.trim()),
    foot: (document.querySelector('#dkFooter .on') || { getAttribute: () => null }).getAttribute(
      'data-dkgo'
    ),
    msg: (document.getElementById('dkUtsuruMsg') || {}).textContent || '',
  }));
}

// ①（壊し：チップを 会社設定に しか 作らない ⇒ 赤）
test('① 3画面で チップの 列が 残り 押した 物だけ 光る・帯は 会社設定', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hairu(page);
  await page.goto('/dashboard.html?p=kaisha', { waitUntil: 'domcontentloaded' });
  await page.locator('#dkChipRow').waitFor({ state: 'visible', timeout: 15000 });
  const KAZU = [
    ['kuruma', '車', /kyuryo\.html\?henshu=1#kuruma$/],
    ['ryokin', '料金', /ryokinhyou\.html\?henshu=1$/],
    ['hito', '従業員', /kyuryo\.html\?henshu=1#emp$/],
    ['jippi', '実費', /dashboard\.html\?p=jippi$/],
    ['kaisha', '会社', /dashboard\.html\?p=kaisha$/],
  ];
  for (const [k, na, iki] of KAZU) {
    await page.locator('[data-dkchip="' + k + '"]').click();
    await page.waitForURL(iki, { timeout: 15000 });
    await page.locator('#dkChipRow').waitFor({ state: 'visible', timeout: 15000 });
    const r = await miru(page);
    // eslint-disable-next-line no-console
    console.log('★' + na + '★ ' + JSON.stringify(r));
    expect(r.chips, '★' + na + 'の 画面で チップの 列が 違う★').toEqual([
      '会社',
      '車',
      '料金',
      '従業員',
      '実費',
    ]);
    expect(r.on, '★' + na + 'が 光っていない★').toEqual([na]);
    expect(r.foot, '★' + na + 'の 画面で 帯の 会社設定が 光っていない★').toBe('dashboard.html');
  }
  expect(err, '★画面が 落ちた★').toEqual([]);
});

// ②（壊し：会社↔実費も location.href で 移す ⇒ 打ちかけが 消えて 赤）
test('② 会社↔実費は その場で 替わり 打ちかけが 残る・?p= が 覚えた 所に 勝つ', async ({ page }) => {
  await hairu(page);
  await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('dk_dash_chip', 'jippi'));
  await page.goto('/dashboard.html?p=kaisha', { waitUntil: 'domcontentloaded' });
  await page.locator('#homeCity').waitFor({ state: 'visible', timeout: 15000 });
  expect((await miru(page)).on, '★?p=kaisha なのに 覚えた 実費が 勝った★').toEqual(['会社']);
  await page.locator('#homeCity').fill('打ちかけ市');
  await page.locator('[data-dkchip="jippi"]').click();
  await page.waitForTimeout(400);
  expect(await page.locator('[data-pane="jippi"]').isVisible()).toBe(true);
  await page.locator('[data-dkchip="kaisha"]').click();
  await page.waitForTimeout(400);
  expect(await page.locator('#homeCity').inputValue(), '★打ちかけが 消えた★').toBe('打ちかけ市');
  const r = await miru(page);
  expect(r.url).toBe('/dashboard.html?p=kaisha');
  expect(r.on).toEqual(['会社']);
});

// ③（壊し：basho() を 名前だけに ⇒ 動かず 赤）
test('③ 車の 画面で 帯の「給料」を 押すと 給料の 明細へ 移る', async ({ page }) => {
  await hairu(page);
  await page.goto('/kyuryo.html?henshu=1#kuruma', { waitUntil: 'domcontentloaded' });
  await page.locator('#dkChipRow').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(800);
  await page.locator('[data-dkgo="kyuryo.html"]').click();
  await page.waitForURL(/kyuryo\.html$/, { timeout: 15000 });
  await page.locator('#dkFooter').waitFor({ state: 'visible', timeout: 15000 });
  const r = await miru(page);
  expect(r.foot).toBe('kyuryo.html');
  expect(r.chips, '★給料の 明細に 会社設定の チップが 出た★').toEqual([]);
});

// ④（壊し：料金の 門を 外す ⇒ 移って 赤／捨てて 移るを 付けない ⇒ 赤）
test('④a 料金：保存していない 変更が 在れば チップでも 帯でも 移らない・捨てて 移れる', async ({
  page,
}) => {
  await hairu(page);
  await page.goto('/ryokinhyou.html?henshu=1', { waitUntil: 'domcontentloaded' });
  await page.locator('#imaTbl tbody tr').first().waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForTimeout(500);
  const ran = page.locator('#honbun input[type="number"]').first();
  await ran.fill(String(Number((await ran.inputValue()) || 0) + 7));
  for (const sel of ['[data-dkchip="kaisha"]', '[data-dkgo="shukei.html"]']) {
    await page.locator(sel).click();
    await page.waitForTimeout(1200);
    const r = await miru(page);
    // eslint-disable-next-line no-console
    console.log('★未保存で ' + sel + '★ ' + JSON.stringify(r));
    expect(r.url, '★保存していないのに 移った（黙って 元の 料金）★').toBe(
      '/ryokinhyou.html?henshu=1'
    );
    expect(r.msg).toContain('保存していない');
  }
  await page.locator('#dkUtsuruMsg .dk-suteru').click();
  await page.waitForURL(/shukei\.html$/, { timeout: 15000 });
});

test('④b 料金：変えていなければ 移れる・読めなかった 時も 閉じ込めない', async ({ page }) => {
  await hairu(page);
  await page.goto('/ryokinhyou.html?henshu=1', { waitUntil: 'domcontentloaded' });
  await page.locator('#imaTbl tbody tr').first().waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForTimeout(500);
  await page.locator('[data-dkchip="kuruma"]').click();
  await page.waitForURL(/kyuryo\.html\?henshu=1#kuruma$/, { timeout: 15000 });

  const p2 = await page.context().newPage();
  await hairu(p2, { yomiNG: true });
  await p2.goto('/ryokinhyou.html?henshu=1', { waitUntil: 'domcontentloaded' });
  await p2.locator('#dkChipRow').waitFor({ state: 'visible', timeout: 15000 });
  await p2.waitForTimeout(1500);
  await p2.locator('[data-dkchip="kaisha"]').click();
  await p2.waitForURL(/dashboard\.html\?p=kaisha$/, { timeout: 15000 });
});

test('④c 料金：保存が 通った 後は 読み直しが 転んでも 移れる', async ({ page }) => {
  const jo = { atoYomiNG: true };
  await hairu(page, jo);
  await page.goto('/ryokinhyou.html?henshu=1', { waitUntil: 'domcontentloaded' });
  await page.locator('#imaTbl tbody tr').first().waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForTimeout(500);
  const ran = page.locator('#honbun input[type="number"]').first();
  await ran.fill(String(Number((await ran.inputValue()) || 0) + 7));
  await ran.dispatchEvent('input');
  await page.locator('#btnSave').click();
  await expect.poll(() => jo.kaita === true, { timeout: 10000 }).toBe(true);
  await page.waitForTimeout(800);
  await page.locator('[data-dkchip="kaisha"]').click();
  await page.waitForURL(/dashboard\.html\?p=kaisha$/, { timeout: 15000 });
});

// ⑤（壊し：kyuryo の 包みで HEAD を 数える ⇒ 偽の「保存できなかった」で 赤）
test('⑤ 帯の HEAD が 転んでも 書きかけに 数えない', async ({ page }) => {
  await hairu(page);
  // HEAD は 1.5 秒 待たせてから 転ばせる＝押した 時に まだ 飛んでいる
  await page.route('**/kyuryo.html*', (r) =>
    r.request().method() === 'HEAD'
      ? new Promise((ok) => setTimeout(ok, 1500)).then(() => r.abort())
      : r.continue()
  );
  await page.goto('/kyuryo.html?henshu=1#kuruma', { waitUntil: 'domcontentloaded' });
  await page.locator('#dkChipRow').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(200);
  await page.locator('[data-dkchip="kaisha"]').click();
  await page.waitForURL(/dashboard\.html\?p=kaisha$/, { timeout: 15000 });
});

// ★★⑥ 車 ↔ 従業員（# の 後ろ だけ 違う）でも 移れて 固まらない★★ 2026-11-04（対立役 止1）
//   前：location.href に # だけ 違う 行き先を 入れると 読み直さず、止め（disabled 10）と「待っています」が 残り 画面が 固まった
//   （壊し：iku() の reload を 外す ⇒ 赤）
test('⑥ 車 ↔ 従業員 を 直に 行き来しても 固まらない（チップ・従業員 →）', async ({ page }) => {
  await hairu(page);
  await page.goto('/kyuryo.html?henshu=1#emp', { waitUntil: 'domcontentloaded' });
  await page.locator('#dkChipRow').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.locator('[data-dkchip="kuruma"]').click();
  await page.waitForURL(/kyuryo\.html\?henshu=1#kuruma$/, { timeout: 15000 });
  await expect(page.locator('[data-dkchip].on')).toHaveText(['車'], { timeout: 15000 });
  await page.waitForTimeout(1500);
  let r = await page.evaluate(() => ({
    tomari: [...document.querySelectorAll('[data-dkgo],[data-dkchip]')].filter((b) => b.disabled)
      .length,
    matsu: document.body.textContent.indexOf('保存を 待っています') >= 0,
  }));
  // eslint-disable-next-line no-console
  console.log('★従業員→車★ ' + JSON.stringify(r));
  expect(r.tomari, '★ボタンが 止まった ままです★').toBe(0);
  expect(r.matsu, '★「待っています」が 残っています★').toBe(false);

  // 車の 画面の「従業員 →」も 同じ 道
  await page.evaluate(() => window.DKChipNi('hito'));
  await page.waitForURL(/kyuryo\.html\?henshu=1#emp$/, { timeout: 15000 });
  await expect(page.locator('[data-dkchip].on')).toHaveText(['従業員'], { timeout: 15000 });
  await page.waitForTimeout(1500);
  r = await page.evaluate(() => ({
    tomari: [...document.querySelectorAll('[data-dkgo],[data-dkchip]')].filter((b) => b.disabled)
      .length,
  }));
  // eslint-disable-next-line no-console
  console.log('★車→従業員★ ' + JSON.stringify(r));
  expect(r.tomari, '★ボタンが 止まった ままです★').toBe(0);
});

// ★★⑦ 会社設定（?p=kaisha）で 光っている「会社設定」を 押しても 読み直さず 打ちかけが 残る★★ 2026-11-04（対立役 止2）
//   （壊し：帯の「dashboard に 居れば 動かない」を 外す ⇒ 赤）
test('⑦ ?p=kaisha で 帯の 会社設定を 押しても 打ちかけが 消えない', async ({ page }) => {
  await hairu(page);
  await page.goto('/dashboard.html?p=kaisha', { waitUntil: 'domcontentloaded' });
  await page.locator('#dkChipRow').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#homeCity').waitFor({ state: 'visible', timeout: 15000 });
  await page.evaluate(() => {
    window.__mark = 1;
  });
  await page.locator('#homeCity').fill('打ちかけ市');
  await page.locator('#dkFooter [data-dkgo="dashboard.html"]').click();
  await page.waitForTimeout(2000);
  const r = await page.evaluate(() => ({
    mark: window.__mark === 1,
    v: document.getElementById('homeCity').value,
  }));
  // eslint-disable-next-line no-console
  console.log('★会社設定を 押す★ ' + JSON.stringify(r));
  expect(r.mark, '★画面を 読み直しました★').toBe(true);
  expect(r.v).toBe('打ちかけ市');
});

// ★★⑧ 車 → 従業員 の 後に 端末の「戻る」を 押しても 画面と 光る 物が 食い違わず「車」で 移れる★★ 2026-11-04（対立役 止A）
//   （壊し：hashchange の 読み直しを 外す ⇒ 赤）
test('⑧ 車→従業員→戻る で 食い違わない', async ({ page }) => {
  await hairu(page);
  await page.goto('/dashboard.html?p=kaisha', { waitUntil: 'domcontentloaded' });
  await page.locator('#dkChipRow').waitFor({ state: 'visible', timeout: 15000 });
  await page.goto('/kyuryo.html?henshu=1#kuruma', { waitUntil: 'domcontentloaded' });
  await page.locator('#dkChipRow').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1500);
  const nagasaMae = await page.evaluate(() => history.length);
  await page.locator('[data-dkchip="hito"]').click();
  await page.waitForURL(/kyuryo\.html\?henshu=1#emp$/, { timeout: 15000 });
  await expect(page.locator('[data-dkchip].on')).toHaveText(['従業員'], { timeout: 15000 });
  await page.waitForTimeout(1000);
  // 車↔従業員 は 履歴を 増やさない（壊し：replaceState を 外す ⇒ 赤）
  expect(await page.evaluate(() => history.length), '★# だけの 段が 履歴に 増えた★').toBe(
    nagasaMae
  );
  // 端末の 戻る＝履歴は 増やしていないので 1つ 前（dashboard）へ／もし # だけ 戻っても 読み直して 合わせる
  await page.evaluate(() => {
    location.hash = '#kuruma';
  });
  await page.waitForTimeout(2500);
  await page.locator('#dkChipRow').waitFor({ state: 'visible', timeout: 15000 });
  const r = await page.evaluate(() => ({
    url: location.hash,
    on: [...document.querySelectorAll('[data-dkchip].on')].map((b) => b.textContent.trim()),
    emp: !!(document.getElementById('paneEmp') || {}).offsetHeight,
    set: !!(document.getElementById('paneSet') || {}).offsetHeight,
  }));
  // eslint-disable-next-line no-console
  console.log('★# だけ 戻る★ ' + JSON.stringify(r));
  expect(r.on, '★光る 物が URL と 違う★').toEqual(['車']);
  expect(r.set && !r.emp, '★中身が URL と 違う★').toBe(true);
  await page.goBack();
  await page.waitForTimeout(2000);
  // eslint-disable-next-line no-console
  console.log(
    '★戻る★ ' + (await page.evaluate(() => location.pathname + location.search + location.hash))
  );
});
