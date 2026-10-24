// ============================================================
// ★★会社設定の「会社の締め日」★★ 2026-10-24（司さん「会社の締め日も決めれるようにしとかないかんな」）
//
//   ★合格★
//   ① 会社設定で 20日を 選んで 保存 ⇒ 送る 先は dk_sales_settings（持ち主の 更新の 決まりが 在る 表・叩き役 K-1）・
//      返った 行を 数える（return=representation）⇒ 月次集計を 開くと 題と 期間が 変わる（10月＝9/21〜10/20）
//   ② 保存で 返った 行が 0行 ⇒「保存できませんでした」（黙って 保存しました と 言わない）
//   ③ 読めない（列が 無い・通信）⇒ 選べない・保存させない（末日で 上書き しない）
//   ★わざと壊して 赤を 見た（2026-10-24）★ 直す 前の dashboard.html・shukei.html（origin/main）⇒ ①②③ 全部 赤
//   偽の 倉庫は この 試験の 中の 箱（dashboard の fetch と 月次集計の DKSession が 同じ 箱を 見る）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = 'c1';
const KAISHA = { company_id: CO, name: 'ZERO代行', url_token: 'tok', seat_limit: 3, status: 'on' };

function stub(T) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  return (
    moto +
    ';(function(){var co=' +
    JSON.stringify(KAISHA) +
    ';var T=' +
    JSON.stringify(T) +
    ';var S=window.DKSession;if(!S)return;' +
    'function rows(p){var na=String(p).split("?")[0].replace(/^\\//,"");return T[na]||[];}' +
    'S.ensure=function(){return Promise.resolve({access_token:"t",user:{id:"u1"}});};' +
    'S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};' +
    'S.pickCompany=function(){return {mode:"one",company:co,list:[co]};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

// ★箱★（倉庫の 代わり）
function hako(sales) {
  return {
    dk_sales_settings: sales,
    dk_shifts: [
      {
        shift_id: 's1',
        device_id: 'd1',
        started_at: '2026-09-25T20:00:00+09:00',
        ended_at: '2026-09-25T23:00:00+09:00',
        elapsed_sec: 10800,
        fare_total_yen: 10000,
        trip_count: 1,
      },
    ],
  };
}

async function junbi(page, T, o) {
  o = o || {};
  const okutta = [];
  await page.clock.setFixedTime(new Date('2026-10-24T12:00:00+09:00'));
  // 月次集計・会社設定の DKSession は 開く 度に 今の 箱で 作る
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: stub(T) })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  // 会社設定（dashboard.html）は fetch を 直に 使う＝ここで 受ける
  await page.route('**/rest/v1/**', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const na = u.pathname.split('/').pop();
    if (na !== 'dk_sales_settings')
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (req.method() === 'GET') {
      if (o.yomenai) return r.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
      // select の 列だけ 返す（列が 無い 箱＝本物の 倉庫の 400 と 同じに する）
      const sel = (u.searchParams.get('select') || '*').split(',');
      const nai = sel.some(
        (c) => c !== '*' && T.dk_sales_settings.length && !(c in T.dk_sales_settings[0])
      );
      if (nai)
        return r.fulfill({
          status: 400,
          contentType: 'application/json',
          body: '{"code":"42703"}',
        });
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(T.dk_sales_settings),
      });
    }
    const body = JSON.parse(req.postData() || '{}');
    okutta.push({ url: req.url(), method: req.method(), body, prefer: req.headers()['prefer'] });
    if (o.zero) return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    let row = T.dk_sales_settings.find((x) => x.company_id === body.company_id);
    if (!row) {
      row = {
        company_id: body.company_id,
        deduct_toll: true,
        deduct_bridge: true,
        deduct_other: false,
        other_label: 'その他',
        kaisha_shime_hi: null,
      };
      T.dk_sales_settings.push(row);
    }
    Object.assign(row, body);
    return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([row]) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.getElementById('coName').textContent === 'ZERO代行',
    null,
    {
      timeout: 15000,
    }
  );
  await page.waitForTimeout(800);
  return okutta;
}

test('★① 20日を 選んで 保存 ⇒ 月次集計の 題と 期間が 変わる★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  const T = hako([]); // まだ 売上の 設定を 1度も 保存していない 会社（＝末日）
  const okutta = await junbi(page, T);
  const mae = await page.evaluate(() => ({
    v: document.getElementById('kaishaShime').value,
    dis: document.getElementById('kaishaShime').disabled,
    n: document.querySelectorAll('#kaishaShime option').length,
  }));
  expect(mae, '既定は 末日・1〜28日＋末日＝29 個').toEqual({ v: '', dis: false, n: 29 });

  // 先に 月次集計（末日＝暦の 月）を 見る
  const tsuki = async () => {
    await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /年$/.test(document.getElementById('yearLabel').textContent));
    await page.waitForTimeout(900);
    return page.evaluate(() => ({
      note: document.getElementById('kikanNote').textContent,
      opt10: [...document.querySelectorAll('#kamiTsuki option')][9].textContent,
      sel: document.getElementById('kamiTsuki').value,
      sep: [...document.querySelectorAll('#tbody tr')]
        .map((t) => t.textContent)
        .find((x) => x.indexOf('9月') === 0),
      oct: [...document.querySelectorAll('#tbody tr')]
        .map((t) => t.textContent)
        .find((x) => x.indexOf('10月') === 0),
    }));
  };
  const a = await tsuki();
  expect(a.opt10).toBe('10月');
  expect(a.sel).toBe('10');
  expect(a.sep, '末日＝9/25 は 9月').toContain('10,000');

  await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('kaishaShime').disabled);
  await page.selectOption('#kaishaShime', '20');
  await page.click('#saveKaishaShime');
  await page.waitForFunction(
    () =>
      /保存/.test(document.getElementById('kaishaShimeMsg').textContent) &&
      !/中/.test(document.getElementById('kaishaShimeMsg').textContent)
  );
  const msg = await page.evaluate(() => document.getElementById('kaishaShimeMsg').textContent);
  // eslint-disable-next-line no-console
  console.log('★送った★ ' + JSON.stringify(okutta) + ' ★字★ ' + msg);
  expect(msg).toBe('保存しました（20日締め）');
  expect(okutta.length).toBe(1);
  expect(okutta[0].url).toContain('/dk_sales_settings?on_conflict=company_id');
  expect(okutta[0].body.kaisha_shime_hi).toBe(20);
  expect(okutta[0].prefer).toContain('return=representation');
  expect(Object.keys(okutta[0].body).sort(), '引く 物の 列を 送らない（上書き しない）').toEqual([
    'company_id',
    'kaisha_shime_hi',
    'updated_at',
  ]);

  const b = await tsuki();
  // eslint-disable-next-line no-console
  console.log('★保存の 後の 月次集計★ ' + JSON.stringify(b));
  expect(b.note).toContain('20日');
  expect(b.opt10).toBe('10月（9/21 〜 10/20）');
  expect(b.sel, '今日（10/24）の 月＝11月').toBe('11');
  expect(b.oct, '20日締め＝9/25 は 10月').toContain('10,000');

  // 会社設定を 開き直すと 20日が 選ばれている（読み直し）
  await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('kaishaShime').disabled);
  expect(await page.inputValue('#kaishaShime')).toBe('20');
  expect(err).toEqual([]);
});

test('★② 返った 行が 0行 ⇒ 保存できませんでした★', async ({ page }) => {
  const T = hako([{ company_id: CO, deduct_toll: true, kaisha_shime_hi: null }]);
  await junbi(page, T, { zero: true });
  await page.selectOption('#kaishaShime', '15');
  await page.click('#saveKaishaShime');
  await page.waitForFunction(() =>
    /できません|保存しました/.test(document.getElementById('kaishaShimeMsg').textContent)
  );
  const msg = await page.evaluate(() => document.getElementById('kaishaShimeMsg').textContent);
  expect(msg).toContain('保存できませんでした');
  expect(msg).toContain('0行');
});

test('★③ 読めない（列が 無い／通信）⇒ 選べない・保存させない★', async ({ page }) => {
  // 列が 無い（倉庫に まだ 当てていない）＝select=company_id,kaisha_shime_hi が 400
  const T = hako([{ company_id: CO, deduct_toll: true }]);
  const okutta = await junbi(page, T);
  const r = await page.evaluate(() => ({
    sel: document.getElementById('kaishaShime').disabled,
    btn: document.getElementById('saveKaishaShime').disabled,
    msg: document.getElementById('kaishaShimeMsg').textContent,
  }));
  expect(r.sel).toBe(true);
  expect(r.btn).toBe(true);
  expect(r.msg).toContain('読めませんでした');
  await page.evaluate(() => document.getElementById('saveKaishaShime').click());
  await page.waitForTimeout(300);
  expect(okutta.length, '送らない').toBe(0);
});
