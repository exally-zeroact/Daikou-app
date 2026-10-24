// ============================================================
// ★★会社設定の「地元の市」は 書けた 時だけ「保存しました」★★ 2026-10-24
//   ★今までの 穴★ 窓（dk_companies）へ PATCH・return=minimal・r.ok だけで「保存しました」。
//     dk_companies には 持ち主の update の policy が 無い（止めた 会社が 自分で 戻せない様に わざと）ので
//     運営で ない 持ち主は 0行・204＝★出るのに 何も 変わらない★（テストの 倉庫で 測った）。
//   ★今★ 関数 dk_set_home_city（home_city だけ 書く・書けた 行の 数を 返す）を 呼び、
//     1 の 時だけ「保存しました」＋倉庫から 読み直して 欄を 合わせる。0・誤りは「保存できませんでした」。
//   ★直す 前の 画面で 赤を 見た（2026-10-24）★ ①②③ とも 赤
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const KAISHA = {
  company_id: 'c1',
  name: '仮の代行',
  status: 'on',
  url_token: 'tok1',
  home_city: '今治市',
  owner_id: 'u1',
};

// mode：'ok'＝1行 書ける／'zero'＝0行（持ち主で ない・RLS）／'err'＝倉庫が 断る（400）
async function hiraku(page, mode) {
  const kura = { home_city: KAISHA.home_city, rpc: [], patch: 0 };
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const stub =
    moto +
    ';(function(){var co=' +
    JSON.stringify(KAISHA) +
    ';var S=window.DKSession;' +
    'S.ensure=function(){return Promise.resolve({access_token:"t",user:{id:"u1"}});};' +
    'S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};' +
    'S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve([]);}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve([]);};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: stub })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'u1', email: 'x@example.com' }),
    })
  );
  await page.route('**/rest/v1/**', (r) => {
    const u = r.request().url();
    const m = r.request().method();
    if (m === 'POST' && u.indexOf('/rpc/dk_set_home_city') >= 0) {
      const b = JSON.parse(r.request().postData() || '{}');
      kura.rpc.push(b);
      if (mode === 'err')
        return r.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'PGRST202', message: 'not found' }),
        });
      if (mode === 'ok') {
        kura.home_city = String(b.p_city || '').trim() || null;
        return r.fulfill({ status: 200, contentType: 'application/json', body: '1' });
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: '0' });
    }
    // 窓への PATCH は 今の 倉庫と 同じ＝持ち主は 0行・204（何も 変わらない）
    if (m === 'PATCH') {
      kura.patch++;
      return r.fulfill({ status: 204, body: '' });
    }
    if (u.indexOf('dk_companies') >= 0)
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([Object.assign({}, KAISHA, { home_city: kura.home_city })]),
      });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  return kura;
}

async function hozon(page, ji) {
  await page.locator('#homeCity').fill(ji);
  await page.locator('#saveHomeCity').click();
  await expect(page.locator('#homeCityMsg')).not.toHaveText(/保存中/, { timeout: 8000 });
  await page.waitForTimeout(300);
  return page.evaluate(() => ({
    msg: document.getElementById('homeCityMsg').textContent,
    ran: document.getElementById('homeCity').value,
  }));
}

test('★① 書けた 行が 0（持ち主で 書けない）なら「保存できませんでした」★', async ({ page }) => {
  const kura = await hiraku(page, 'zero');
  const r = await hozon(page, '松山市');
  // eslint-disable-next-line no-console
  console.log('★0行★ ' + JSON.stringify(r) + ' rpc=' + kura.rpc.length + ' patch=' + kura.patch);
  expect(r.msg, '★書けていないのに 保存しました と 出た★').not.toContain('保存しました');
  expect(r.msg).toContain('保存できませんでした');
  expect(kura.rpc.length, '★関数を 呼んでいない★').toBe(1);
  expect(kura.patch, '★書けない 窓へ PATCH している★').toBe(0);
});

test('★② 関数が 断った（誤り）なら「保存できませんでした」★', async ({ page }) => {
  const kura = await hiraku(page, 'err');
  const r = await hozon(page, '松山市');
  // eslint-disable-next-line no-console
  console.log('★誤り★ ' + JSON.stringify(r) + ' rpc=' + kura.rpc.length);
  expect(r.msg).not.toContain('保存しました');
  expect(r.msg).toContain('保存できませんでした');
  expect(kura.rpc.length).toBe(1);
});

test('★③ 1行 書けたら「保存しました」＋倉庫から 読み直した 値に 欄を 合わせる★', async ({
  page,
}) => {
  const kura = await hiraku(page, 'ok');
  const r = await hozon(page, '  松山市 ');
  // eslint-disable-next-line no-console
  console.log('★書けた★ ' + JSON.stringify(r) + ' rpc=' + JSON.stringify(kura.rpc));
  expect(kura.rpc).toEqual([{ p_company: 'c1', p_city: '松山市' }]);
  expect(r.msg).toContain('保存しました');
  expect(r.msg).toContain('松山市');
  expect(r.ran, '★読み直した 値に 合っていない★').toBe('松山市');
  // 空で 保存＝今治市あつかい
  const r2 = await hozon(page, '');
  expect(kura.rpc[1]).toEqual({ p_company: 'c1', p_city: null });
  expect(r2.msg).toContain('保存しました');
  expect(r2.msg).toContain('今治市');
  expect(r2.ran).toBe('');
});
