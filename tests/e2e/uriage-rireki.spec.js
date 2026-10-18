// ============================================================
// ★★売上から 引く 物（高速・橋・その他）の「何日から」★★ 2026-10-18（docs/nannichi-kara-uriage.md）
//   司さん 10-17「その日より前は前の値」「1週間前の日付で設定したら遡って変わるようにしろよ」
//
//   ★物差し★（売上表の 画面）
//     ① 記録（1/6 から 高速代を 引かない）⇒ 1/5 の 高速代だけ 引いた 売上（紙の 字で 見る）
//     ② 記録が 読めない ⇒ 数字も 紙も 出さずに 止める
//     ③ 日付を 選んで チェックを 変える ⇒ dk_uriage_rireki に その 日から で 足す（設定は 書かない）
//     ④ 日付を 空（最初から）で 変える ⇒ 設定（dk_sales_settings）に 書く（記録は 書かない）
//     ⑤ チェックは 選んだ 日に 効く 引き方を 出す
//     ⑥ 記録の 一覧で 消す ⇒ その 記録を DELETE
//   ★物差し★（給料の 画面）
//     ⑦ 記録が 読めない ⇒ 明細を 止める ／ ⑧ 記録の 日から 実費が 変わる（前の 日は 前の 額）
//
//   ★わざと壊して 赤に なるのを 見た（2026-10-18 実測・chromium）★
//     uriage-agg.js byDevice の 業務ごとの 足しを 外す ⇒ ① 赤
//     uriage.html kakasenai の 設定が 読めない 止めを 外す ⇒ ⑨ 赤
//     shukei.html renderUri の 止めを 外す ⇒ ⑩ 赤（[data-uri="month"] で 売上が 出た）
//     saveSettings の modosu を 外す ⇒ ⑪ 赤／recalc の SS_DAME の 止めを 外す ⇒ ⑨-2 赤
//     戻すと 緑
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { openKyuryo } = require('./kyuryo-harness');

const CO = '11111111-2222-3333-4444-555555555555';
test.use({ timezoneId: 'Asia/Tokyo' });

const SHIFTS = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-01-05T20:00:00+09:00',
    fare_total_yen: 40000,
    trip_count: 12,
    actual_total_m: 80000,
    total_distance_m: 150000,
  },
  {
    shift_id: 's2',
    device_id: 'd2',
    started_at: '2026-01-06T20:00:00+09:00',
    fare_total_yen: 25000,
    trip_count: 8,
    actual_total_m: 50000,
    total_distance_m: 90000,
  },
];
// 高速代 3,000（1/5）と 1,000（1/6）。既定で どちらも 引く
const EDITS = [
  { shift_id: 's1', toll_yen: 3000, bridge_yen: 0, other_yen: 0 },
  { shift_id: 's2', toll_yen: 1000, bridge_yen: 0, other_yen: 200 },
];
const LABELS = [
  { device_id: 'd1', label: '4987', sort_order: 1 },
  { device_id: 'd2', label: '1466', sort_order: 2 },
];

function tsukuru(o) {
  const x = o || {};
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  const hyou = {
    dk_shifts: SHIFTS,
    dk_shift_edits: EDITS,
    dk_device_labels: LABELS,
    dk_uriage_rireki: x.rireki || [],
  };
  return (
    moto +
    ';(function(){var S=window.DKSession;var co=' +
    JSON.stringify(co) +
    ';var T=' +
    JSON.stringify(hyou) +
    ';var YOMENAI=' +
    JSON.stringify(x.yomenai || []) +
    ';var KAKENAI=' +
    JSON.stringify(x.kakenai || []) +
    ';window.__okutta=[];' +
    'function rows(p){var na=String(p).split("?")[0];return T[na]||[];}' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    // 書いた 物は 覚えて、返った 行は 1件（POST・PATCH・DELETE）
    'S.rest=function(s,p,o){var m=(o&&o.method)||"GET";if(m!=="GET"){var b=null;try{b=JSON.parse(o.body);}catch(_){}window.__okutta.push({p:String(p),m:m,b:b});if(KAKENAI.some(function(k){return String(p).indexOf(k)===0;}))return Promise.resolve({ok:false,status:500,json:function(){return Promise.resolve({});}});return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve([Object.assign({rireki_id:"n1"},b||{})]);}});}return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;if(YOMENAI.some(function(n){return String(p).indexOf(n)===0;})){if(st)st.failed++;return Promise.resolve([]);}return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page, o) {
  await page.clock.setFixedTime(new Date('2026-01-20T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(o),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/uriage.html', { waitUntil: 'domcontentloaded' });
}
const kamiJi = async (page) => {
  const kami = page.locator('#kamiMado .kami-mise-waku');
  await expect(kami.first(), '★紙が 出ない★').toBeVisible({ timeout: 15000 });
  return ((await kami.first().textContent()) || '').replace(/\s+/g, ' ');
};
const yen = (v) => v.toLocaleString('ja-JP');
const okutta = (page) => page.evaluate(() => window.__okutta);

test('① 記録の 日から 後だけ 引き方が 変わる（前の 日は 前の まま）', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page, {});
  const moto = await kamiJi(page);
  // 記録 無し＝(40000−3000)+(25000−1000)＝61,000／実費 4,000
  expect(moto).toContain(yen(61000));
  expect(moto).toContain(yen(4000));
  const page2 = await page.context().newPage();
  page2.on('pageerror', (e) => err.push(e.message));
  await hiraku(page2, {
    rireki: [{ rireki_id: 'u1', key: 'toll', from_date: '2026-01-06', value: false }],
  });
  const ato = await kamiJi(page2);
  // eslint-disable-next-line no-console
  console.log('★①★ ' + ato.slice(0, 200));
  // 1/6 から 高速代を 引かない＝(40000−3000)+25000＝62,000／実費 3,000
  expect(ato, '★記録の 日から 引き方が 変わっていない★').toContain(yen(62000));
  expect(ato).toContain(yen(3000));
  expect(ato).not.toContain(yen(61000));
  expect(err).toEqual([]);
});

test('② 記録が 読めない ⇒ 数字も 紙も 出さずに 止める', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page, { yomenai: ['dk_uriage_rireki'] });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({
    err: document.getElementById('err').textContent,
    kami: document.querySelectorAll('#kamiMado .kami-mise-waku').length,
    list: document.getElementById('list').textContent,
    msg: document.getElementById('kamiMsg').textContent,
  }));
  // eslint-disable-next-line no-console
  console.log('★②★ ' + JSON.stringify(r));
  expect(r.err, '★止めた 訳が 出ていない★').toContain(
    '売上から 引く 物の 変えた 記録を 読めませんでした'
  );
  expect(r.kami, '★紙が 出た★').toBe(0);
  expect(r.list, '★数字が 出た★').not.toContain('¥');
  expect(err).toEqual([]);
});

test('③ 日付を 選んで チェックを 変える ⇒ 記録に 足す（設定は 書かない）', async ({ page }) => {
  await hiraku(page, {});
  await kamiJi(page);
  expect(await page.$eval('#dHi', (i) => i.value), '★既定の 日が 今日で ない★').toBe('2026-01-20');
  await page.fill('#dHi', '2026-01-06');
  await page.dispatchEvent('#dHi', 'change');
  // ★押した 後は 記録を 読み直して チェックを 描き直す（この 試験の 倉庫は 書いても 読み返しに 出ない）＝click で 押すだけ
  await page.click('#dOther');
  await page.waitForTimeout(600);
  const o = await okutta(page);
  // eslint-disable-next-line no-console
  console.log('★③★ ' + JSON.stringify(o));
  expect(
    o.filter((x) => x.p.indexOf('dk_sales_settings') === 0),
    '★設定を 書いた★'
  ).toEqual([]);
  const k = o.filter((x) => x.p.indexOf('dk_uriage_rireki') === 0);
  expect(k.length).toBe(1);
  expect(k[0].m).toBe('POST');
  expect(k[0].b).toMatchObject({
    company_id: CO,
    key: 'other',
    from_date: '2026-01-06',
    value: true,
  });
});

test('④ 日付を 空（最初から）で 変える ⇒ 設定に 書く（記録は 書かない）', async ({ page }) => {
  await hiraku(page, {});
  await kamiJi(page);
  await page.fill('#dHi', '');
  await page.dispatchEvent('#dHi', 'change');
  await page.click('#dToll');
  await page.waitForTimeout(600);
  const o = await okutta(page);
  // eslint-disable-next-line no-console
  console.log('★④★ ' + JSON.stringify(o));
  expect(
    o.filter((x) => x.p.indexOf('dk_uriage_rireki') === 0),
    '★記録を 書いた★'
  ).toEqual([]);
  const s = o.filter((x) => x.p.indexOf('dk_sales_settings') === 0);
  expect(s.length).toBe(1);
  // ★変えた 鍵だけ 送る★（読めていない 他の 鍵を 既定の 値で 上書き しない・対立役 止3）
  expect(s[0].b).toMatchObject({ company_id: CO, deduct_toll: false });
  expect(Object.keys(s[0].b).sort()).toEqual(['company_id', 'deduct_toll', 'updated_at']);
});

test('⑤ チェックは 選んだ 日に 効く 引き方を 出す', async ({ page }) => {
  await hiraku(page, {
    rireki: [{ rireki_id: 'u1', key: 'toll', from_date: '2026-01-10', value: false }],
  });
  await kamiJi(page);
  expect(await page.isChecked('#dToll'), '★今日（1/20）は 引かない 筈★').toBe(false);
  await page.fill('#dHi', '2026-01-05');
  await page.dispatchEvent('#dHi', 'change');
  expect(await page.isChecked('#dToll'), '★1/5 は 引く 筈★').toBe(true);
  await page.fill('#dHi', '');
  await page.dispatchEvent('#dHi', 'change');
  expect(await page.isChecked('#dToll'), '★空＝最初から＝列（既定は 引く）★').toBe(true);
  expect(await page.textContent('#dChui')).toContain('2026-01-10 より 前の 日だけ');
});

test('⑥ 記録の 一覧で 消す ⇒ その 記録を DELETE', async ({ page }) => {
  await hiraku(page, {
    rireki: [{ rireki_id: 'u9', key: 'bridge', from_date: '2026-01-10', value: false }],
  });
  await kamiJi(page);
  await expect(page.locator('#dRireki')).toHaveText('記録 1');
  await page.click('#dRireki');
  await expect(page.locator('#dRirekiWaku')).toContainText('橋代');
  await page.click('[data-uk-del="u9"]');
  await page.waitForTimeout(600);
  const o = await okutta(page);
  expect(o).toEqual([{ p: 'dk_uriage_rireki?rireki_id=eq.u9', m: 'DELETE', b: null }]);
});

// ─── 給料の 画面 ───────────────────────────────────────────
test('⑦ 給料：記録が 読めない ⇒ 明細を 出さずに 止める', async ({ page }) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await openKyuryo(
    page,
    (f) => {
      f.__yomenai = ['dk_uriage_rireki'];
      return f;
    },
    { matanai: true }
  );
  await page.waitForTimeout(2500);
  const ji = await page.evaluate(() => document.body.innerText);
  expect(ji, '★止めた 訳が 出ていない★').toContain(
    '売上から 引く 物の 変えた 記録を 読めませんでした'
  );
  expect(err).toEqual([]);
});

test('⑧ 給料：記録の 日から 実費が 変わる（前の 日は 前の 額）', async ({ page }) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  const TAKAI = (f) => {
    // 全部の 業務に 高速代 1,000（既定で 引く）・最低保証 0（歩合だけで 額が 決まる）
    f.edits = (f.shifts || []).map((s) => ({ shift_id: s.shift_id, toll_yen: 1000 }));
    Object.keys(f.settings[0].roles).forEach((r) => (f.settings[0].roles[r].floor = 0));
    f.emps = f.emps.map((e) => Object.assign({}, e, { pay_floor: null }));
    return f;
  };
  await openKyuryo(page, TAKAI);
  const hi = await page.evaluate(() =>
    window.__paper
      .emp(0)
      .cells.filter((c) => c.pay > 0)
      .map((c) => ({ d: c.date, pay: c.pay }))
  );
  expect(hi.length, '★働いた 日が 2日 要る★').toBeGreaterThanOrEqual(2);
  const page2 = await page.context().newPage();
  page2.on('pageerror', (x) => err.push(x.message));
  await openKyuryo(page2, (f) => {
    TAKAI(f);
    f.uriageRireki = [{ rireki_id: 'u1', key: 'toll', from_date: hi[1].d, value: false }];
    return f;
  });
  const ato = await page2.evaluate(() =>
    window.__paper
      .emp(0)
      .cells.filter((c) => c.pay > 0)
      .map((c) => ({ d: c.date, pay: c.pay }))
  );
  // eslint-disable-next-line no-console
  console.log('★⑧★ ' + JSON.stringify({ moto: hi.slice(0, 2), ato: ato.slice(0, 2) }));
  expect(ato[0].pay, '★記録の 日より 前の 額が 変わった★').toBe(hi[0].pay);
  expect(ato[1].pay, '★記録の 日から 実費が 変わっていない★').not.toBe(hi[1].pay);
  expect(err).toEqual([]);
});

// ─── 対立役 1回目の 止める件 ─────────────────────────────────
test('⑨ 売上表：設定が 読めない ⇒ チェックを 変えても 列も 記録も 書かない（止3）', async ({
  page,
}) => {
  await hiraku(page, { yomenai: ['dk_sales_settings'] });
  await page.waitForTimeout(2500); // 紙は 出ない（⑨-2）＝読み終わりを 時間で 待つ
  await page.click('#dOther');
  await page.fill('#dHi', '');
  await page.dispatchEvent('#dHi', 'change');
  await page.click('#dToll');
  await page.waitForTimeout(600);
  const o = await okutta(page);
  // eslint-disable-next-line no-console
  console.log('★⑨★ ' + JSON.stringify(o));
  expect(o, '★読めていないのに 書いた★').toEqual([]);
  expect(await page.textContent('#err')).toContain('設定を 読めていないので 保存しません');
});

test('⑨-2 売上表：設定が 読めない ⇒ 数字も 紙も 既定の 値で 出さない（2回目 直1）', async ({
  page,
}) => {
  await hiraku(page, { yomenai: ['dk_sales_settings'] });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({
    err: document.getElementById('err').textContent,
    kami: document.querySelectorAll('#kamiMado .kami-mise-waku').length,
    list: document.getElementById('list').textContent,
    msg: document.getElementById('kamiMsg').textContent,
  }));
  // eslint-disable-next-line no-console
  console.log('★⑨-2★ ' + JSON.stringify(r));
  expect(r.err).toContain('売上から 引く 物の 設定を 読めませんでした');
  expect(r.kami, '★紙が 出た★').toBe(0);
  expect(r.list, '★数字が 出た★').not.toContain('¥');
});

test('⑪ 売上表：列の 保存が 断られた ⇒ チェックと 数字を 元へ 戻す（2回目 直3）', async ({
  page,
}) => {
  await hiraku(page, { kakenai: ['dk_sales_settings'] });
  const moto = await kamiJi(page);
  await page.fill('#dHi', '');
  await page.dispatchEvent('#dHi', 'change');
  await page.click('#dToll');
  await page.waitForTimeout(800);
  expect(await page.isChecked('#dToll'), '★書けなかったのに チェックが 外れた まま★').toBe(true);
  expect(await page.isDisabled('#dToll'), '★書き終わったのに 押せない★').toBe(false);
  const ato = await kamiJi(page);
  expect(ato, '★書けなかったのに 数字が 変わった★').toContain(yen(61000));
  expect(ato).toBe(moto);
  expect(await page.textContent('#err')).toContain('設定を保存できませんでした');
});

test('⑫ 売上表：記録の 書きが 断られた ⇒ 読み直して チェックを 元へ 戻す（2回目 直3）', async ({
  page,
}) => {
  await hiraku(page, { kakenai: ['dk_uriage_rireki'] });
  await kamiJi(page);
  await page.click('#dOther');
  await page.waitForTimeout(800);
  expect(await page.isChecked('#dOther'), '★書けなかったのに チェックが 付いた まま★').toBe(false);
  expect(await page.textContent('#err')).toContain('保存できませんでした');
});

test('⑩ 月次：記録が 読めない ⇒ 売上の ボタンを 押しても 売上を 出さない・紙の 字が 本当の 訳（止2）', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  const FIX = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
  );
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: FIX.settings[0].company_id, name: '見張り用' };
  const body =
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
    'S.softList=function(s,p,st){if(st)st.tried++;if(String(p).indexOf("dk_uriage_rireki")===0){if(st)st.failed++;return Promise.resolve([]);}return Promise.resolve(rows(p));};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: body })
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#motoHyou > summary').click({ timeout: 15000 });
  await page.waitForTimeout(1500);
  for (const sel of ['[data-uri="month"]', '[data-uri="day"]', '[data-uriwake="kuruma"]']) {
    await page.locator(sel).click();
    await page.waitForTimeout(200);
    const ji = await page.evaluate(() => document.getElementById('uriBody').textContent);
    expect(ji, '★' + sel + ' で 売上が 出た★').not.toMatch(/\d{1,3},\d{3}/);
    expect(ji).toContain('売上から 引く 物の 変えた 記録を 読めませんでした');
  }
  const kami = await page.evaluate(() => document.getElementById('kamiMsg').textContent);
  // eslint-disable-next-line no-console
  console.log('★⑩★ ' + kami);
  expect(kami, '★紙の 字が 本当の 訳で ない★').toContain(
    '売上から 引く 物の 変えた 記録を 読めない'
  );
  expect(err).toEqual([]);
});
