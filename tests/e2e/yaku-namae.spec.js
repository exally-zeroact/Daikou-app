// ============================================================
// 役割の 名前を 直す・消す＝人の 役割と 日給・段階歩合を 取り残さない 2026-10-17
//
//   今の 穴（直す 前）：
//     ・名前を 直すと 決まりの 鍵だけ 変わり、人の 役割は 古い 名前の まま＝歩合0・保証0で 計算された
//     ・在る 名前に 直すと その 役割の 決まりが 上書きされた
//     ・日給・段階歩合は 古い 名前の まま 残り、保存で 消えた
//     ・人の 居る 役割も 消せた
//   守る 事：
//     ①保存で 先に 倉庫の 関数 dk_yaku_namae_naoshi へ { 読み込んだ 名前: 今の 名前 } を 送り、その 後で 設定を 保存する
//     ②在る 名前には 直させない（欄は 元に 戻る）
//     ③人（辞めた 人も）の 居る 役割は 消させない・最後の 1つも 消させない
//     ④倉庫が 断ったら 設定も 保存しない（訳を 出す）
//     ⑤日給・段階歩合も 新しい 名前へ 移る
//     ⑥入れ替え（甲→X→乙・乙→甲）も 読み込んだ 名前から 1回で 送る
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const F0 = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = F0.settings[0].company_id;

function sess(F, rpcKotae) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: 'ZERO代行' };
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(F) +
    ';var co=' +
    JSON.stringify(co) +
    ';var RPC=' +
    JSON.stringify(rpcKotae || { ok: true, hito: 1 }) +
    ';window.__calls=[];' +
    // window.__KAWARU＝別の 画面が 設定を 保存した（倉庫の 更新の 時刻が 変わった）
    'function rows(p){ if(window.__KAWARU&&p.indexOf("dk_payroll_settings?select=updated_at")===0)return [{updated_at:"2099-01-01T00:00:00+00:00"}];' +
    ' if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){var m=(o&&o.method)||"GET";if(m!=="GET")window.__calls.push({p:p,m:m,b:o&&o.body?JSON.parse(o.body):null});' +
    // window.__UPSERT_NG＝設定の 保存を その 回数だけ 落とす（倉庫に 残さない）
    'if(m==="POST"&&p.indexOf("dk_payroll_settings")===0&&window.__UPSERT_NG>0){window.__UPSERT_NG--;' +
    'return Promise.resolve({ok:false,status:500,text:function(){return Promise.resolve("{}");},json:function(){return Promise.resolve({});}});}' +
    // 設定の 保存は 偽の 倉庫に 残す（本物の 倉庫と 同じく 次の 読みで 保存した 時刻が 返る）
    'if(m==="POST"&&p.indexOf("dk_payroll_settings")===0){F.settings=[Object.assign({},F.settings[0]||{},JSON.parse(o.body))];}' +
    // 名前を 直す 関数は 本物と 同じく 倉庫の updated_at を 書き換え、その 時刻を 返す
    'if(p.indexOf("rpc/dk_yaku_namae_naoshi")===0&&RPC.ok&&RPC.updated_at&&F.settings[0])F.settings[0].updated_at=RPC.updated_at;' +
    // 本物の 倉庫と 同じく 毎回 写しを 返す（画面の 手元と 倉庫の 中が 同じ 物を 指さない）
    'var j=JSON.parse(JSON.stringify(p.indexOf("rpc/dk_yaku_namae_naoshi")===0?RPC:rows(p)));' +
    'return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve(JSON.stringify(j));},json:function(){return Promise.resolve(j);}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(JSON.parse(JSON.stringify(rows(p))));};})();'
  );
}

async function hiraku(page, opt) {
  const o = opt || {};
  const F = JSON.parse(JSON.stringify(F0));
  if (o.tweak) o.tweak(F);
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: sess(F, o.rpc),
    })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.clock.setFixedTime(new Date('2026-08-05T03:00:00Z'));
  await page.goto('/kyuryo.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  await page.click('.tab[data-tab="set"]');
  await page.waitForTimeout(400);
}

async function namae(page, moto, ima) {
  const i = page.locator('[data-role="' + moto + '"][data-f="name"]');
  await i.fill(ima);
  await i.press('Tab'); // 客の 道（欄を 離れると change）
  await page.waitForTimeout(300);
}
async function hozon(page) {
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
}
const calls = (page) => page.evaluate(() => window.__calls);
const setteiPost = (c) => c.filter((x) => x.p.indexOf('dk_payroll_settings') === 0);
const rpcPost = (c) => c.filter((x) => x.p.indexOf('rpc/dk_yaku_namae_naoshi') === 0);

test('① 名前を 直して 保存＝先に 倉庫へ { 甲: 丙 } を 送り、その 後で 新しい 名前の 設定を 保存', async ({
  page,
}) => {
  await hiraku(page);
  await namae(page, '甲', '丙');
  await hozon(page);
  const c = await calls(page);
  const i = c.findIndex((x) => x.p.indexOf('rpc/dk_yaku_namae_naoshi') === 0);
  const j = c.findIndex((x) => x.p.indexOf('dk_payroll_settings') === 0);
  expect(i, '倉庫の 関数を 呼んでいない').toBeGreaterThanOrEqual(0);
  expect(j, '設定を 保存していない').toBeGreaterThan(i);
  expect(c[i].b).toEqual({ p_company_id: CO, p_map: { 甲: '丙' } });
  expect(Object.keys(c[j].b.roles).sort()).toEqual(['丙', '乙']);
  // 手元の 人の 役割も 揃う＝明細が 止まらない
  await page.click('.tab[data-tab="slip"]');
  await page.waitForTimeout(600);
  await expect(page.locator('#slips')).not.toContainText('役割の 決まりが 無くて');
});

test('② 在る 名前には 直させない（欄は 元に 戻り、保存しても 倉庫の 関数は 呼ばない）', async ({
  page,
}) => {
  await hiraku(page);
  await namae(page, '甲', '乙');
  await expect(page.locator('#err')).toContainText('もう 在る 役割');
  await expect(page.locator('[data-role="甲"][data-f="name"]')).toHaveValue('甲');
  await hozon(page);
  const c = await calls(page);
  expect(rpcPost(c)).toHaveLength(0);
  expect(Object.keys(setteiPost(c)[0].b.roles).sort()).toEqual(['乙', '甲']);
});

test('③ 人の 居る 役割は 消させない（名前を 出す）・人の 居ない 役割は 消せる・最後の 1つは 消させない', async ({
  page,
}) => {
  await hiraku(page, {
    tweak: (F) => {
      F.settings[0].roles['丁'] = { rate: 0.2, floor: 800 };
    },
  });
  await page.click('[data-role-del="甲"]');
  await expect(page.locator('#err')).toContainText('人が 居るので 消せません');
  await expect(page.locator('#err')).toContainText('テスト太郎');
  await expect(page.locator('[data-role-del="甲"]')).toHaveCount(1);
  // 辞めた 人（テスト四郎＝乙）も 数える
  await page.click('[data-role-del="乙"]');
  await expect(page.locator('#err')).toContainText('テスト四郎（退職）');
  // 人の 居ない 丁 は 消せる
  await page.click('[data-role-del="丁"]');
  await expect(page.locator('[data-role-del="丁"]')).toHaveCount(0);
});

test('③-2 最後の 1つは 消させない', async ({ page }) => {
  await hiraku(page, {
    tweak: (F) => {
      F.settings[0].roles = { 甲: { rate: 0.3, floor: 1000 } };
      F.emps = [];
    },
  });
  await page.click('[data-role-del="甲"]');
  await expect(page.locator('#err')).toContainText('1つは 残して');
  await expect(page.locator('[data-role-del="甲"]')).toHaveCount(1);
});

test('④ 倉庫が 断ったら 設定も 保存しない（訳を 出す）', async ({ page }) => {
  await hiraku(page, { rpc: { ok: false, reason: 'not_found' } });
  await namae(page, '甲', '丙');
  await hozon(page);
  const c = await calls(page);
  expect(rpcPost(c)).toHaveLength(1);
  expect(setteiPost(c), '断られたのに 設定を 保存した').toHaveLength(0);
  await expect(page.locator('#err')).toContainText('役割の 名前を 直せませんでした');
  await expect(page.locator('#err')).toContainText('見つかりません');
});

test('⑤ 日給・段階歩合も 新しい 名前へ 移る（保存で 消えない）', async ({ page }) => {
  await hiraku(page, {
    tweak: (F) => {
      F.settings[0].pay_extra = { roles: { 甲: { nikkyu: 5000, nikkyuMode: 'kawari' } } };
    },
  });
  await namae(page, '甲', '丙');
  await hozon(page);
  const b = setteiPost(await calls(page))[0].b;
  expect(b.pay_extra.roles['丙'] && b.pay_extra.roles['丙'].nikkyu).toBe(5000);
  expect(b.pay_extra.roles['甲']).toBeUndefined();
});

test('⑥ 入れ替え（甲→X・乙→甲・X→乙）は 読み込んだ 名前から 1回で 送る', async ({ page }) => {
  await hiraku(page);
  await namae(page, '甲', 'X');
  await namae(page, '乙', '甲');
  await namae(page, 'X', '乙');
  await hozon(page);
  const c = await calls(page);
  expect(rpcPost(c)).toHaveLength(1);
  expect(rpcPost(c)[0].b.p_map).toEqual({ 甲: '乙', 乙: '甲' });
});

// ★本番前の 対立役（2026-10-17）の 止める 2件と 二度押し★
test('⑦ 設定の 行が まだ 無い 会社でも 既定の 役割の 名前を 直すと 倉庫で 人も 直す', async ({
  page,
}) => {
  await hiraku(page, {
    tweak: (F) => {
      F.settings = [];
    },
  });
  await namae(page, '1種', '丙');
  await hozon(page);
  const c = await calls(page);
  expect(rpcPost(c), '行の 無い 会社で 倉庫の 関数を 呼ばなかった').toHaveLength(1);
  expect(rpcPost(c)[0].b.p_map).toEqual({ '1種': '丙' });
  expect(Object.keys(setteiPost(c)[0].b.roles).sort()).toEqual(['2種', '丙']);
});

test('⑧ 開いた 後に 別の 画面が 設定を 保存して いたら 止める（名前の 直しも 設定の 保存も しない）', async ({
  page,
}) => {
  await hiraku(page);
  await namae(page, '甲', '丙');
  await page.evaluate(() => {
    window.__KAWARU = true;
  });
  await hozon(page);
  const c = await calls(page);
  expect(rpcPost(c), '変わったのに 名前を 直した').toHaveLength(0);
  expect(setteiPost(c), '変わったのに 上書きした').toHaveLength(0);
  await expect(page.locator('#err')).toContainText('他の 画面で 変わりました');
  // 保存の ボタンは 戻る（押せない まま に しない）
  await expect(page.locator('#btnSaveSet')).toBeEnabled();
});

test('⑧-2 変わって いなければ 保存する（自分の 前の 保存・車ごとの 売上の 保存の 後も 止めない）', async ({
  page,
}) => {
  await hiraku(page);
  await namae(page, '甲', '丙');
  await hozon(page);
  await namae(page, '乙', '丁');
  await hozon(page);
  const c = await calls(page);
  expect(setteiPost(c)).toHaveLength(2);
  await expect(page.locator('#err')).not.toContainText('他の 画面で');
});

test('⑨ 保存を 続けて 2回 押しても 倉庫の 関数は 1回だけ', async ({ page }) => {
  await hiraku(page);
  await namae(page, '甲', '丙');
  await page.evaluate(() => {
    const b = document.getElementById('btnSaveSet');
    b.onclick();
    b.onclick();
  });
  await page.waitForTimeout(800);
  const c = await calls(page);
  expect(rpcPost(c)).toHaveLength(1);
  expect(setteiPost(c)).toHaveLength(1);
});

// ★本番前 対立 2回目（2026-10-17）の 直す 件★
test('⑩ この 画面で 消した 名前には 保存の 前に 直させない（倉庫には まだ 在る）', async ({
  page,
}) => {
  await hiraku(page, {
    tweak: (F) => {
      F.settings[0].roles['丁'] = { rate: 0.2, floor: 800 };
    },
  });
  await page.click('[data-role-del="丁"]');
  await namae(page, '甲', '丁');
  await expect(page.locator('#err')).toContainText('この 画面で 消した 名前');
  await expect(page.locator('[data-role="甲"][data-f="name"]')).toHaveValue('甲');
});

test('⑪ 名前の 直しは 通り 設定の 保存だけ 落ちても、次の 保存で 自分を「他の 画面で 変わった」と 止めない', async ({
  page,
}) => {
  await hiraku(page, {
    rpc: { ok: true, hito: 1, updated_at: '2026-08-05T03:00:01.123456+00:00' },
  });
  await namae(page, '甲', '丙');
  await page.evaluate(() => {
    window.__UPSERT_NG = 1;
  });
  await hozon(page);
  await expect(page.locator('#err')).toContainText('保存できませんでした');
  await hozon(page);
  const c = await calls(page);
  await expect(page.locator('#err')).not.toContainText('他の 画面で');
  expect(rpcPost(c), '倉庫は もう 直った＝2回目は 名前の 直しを 送らない').toHaveLength(1);
  expect(setteiPost(c)).toHaveLength(2);
});
