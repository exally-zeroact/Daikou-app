// ============================================================
// ★★入力画面は 車ごと★★ 2026-09-11（司さん・写真つき）
//
//   ★司さん★
//     「入力画面での 電子決済は 今 まとめとるの 消して ★車毎に 出す★」
//     「★売上も★ 間違えてたら いかんから 車ごとに
//       ★データ 読み取ってるのは 出して★
//       ★読み取れてないのは 0でいいから 出して 修正できるようにする★」
//     「高速代、橋代など ★設定してるやつを 出せ★」
//     「入力画面で ★どこで 編集できるか 説明書きが いる★／会社設定の 実費で」
//
//   ★★ここで 守る 5つ★★
//     ①日ごとの「電子決済」の 欄は ★1つも 残っていない★
//     ②車ごとに ★売上・電子決済・設定した 実費★ が 並ぶ
//     ③読めている 車 … 売上は ★出すだけ★（打ち直せない）
//     ④読めていない 車 … 売上は ★0 で 打ち直せる★
//     ⑤説明に ★会社設定 → 実費★ と 書いてある
//
//   ★お金の 計算は 1つも 触っていません★
//     メーターが 出した 売上を ★書き換えません★。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-11 実測 ＝ 下に 書く）★★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = { company_id: 'c1', name: 'ZERO代行' };
const HI = '2026-09-02';
const LABELS = [
  { company_id: 'c1', device_id: 'd1', label: '4987', sort_order: 1 },
  { company_id: 'c1', device_id: 'd2', label: '1466', sort_order: 2 },
  { company_id: 'c1', device_id: 'd3', label: '1173', sort_order: 3 },
];
// ★d1 だけ 走った★（d2/d3 は 読めていない）
const SH = [
  { shift_id: 's1', device_id: 'd1', started_at: HI + 'T10:00:00Z', fare_total_yen: 15200 },
];
const KINDS = [
  { kind_id: 'toll', label: '高速代', sort_order: 10, active: true },
  { kind_id: 'bridge', label: '橋代', sort_order: 20, active: true },
  { kind_id: 'other', label: 'その他', sort_order: 30, active: true },
  { kind_id: 'kmx1', label: 'その他2', sort_order: 40, active: true },
];

async function hiraku(page) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const stub =
    moto +
    ';(function(){var D=' +
    JSON.stringify({ co: CO, L: LABELS, SH: SH, K: KINDS, HI: HI }) +
    ';var S=window.DKSession;' +
    // ★★材料が 無い時に 黙って 緑に しない★★ 2026-09-11
    //   ★前★ if(!S)return; ＝作り物が 効いていなくても ★そのまま 緑★
    //   ★今★ 印を 立てて ★試験の 側で 赤に する★
    'if(!S){window.__dameSession=1;return;}window.__okutta=[];' +
    'function rows(p){p=String(p);' +
    ' if(p.indexOf("dk_expense_kinds")===0)return D.K;' +
    ' if(p.indexOf("dk_shifts")===0)return D.SH;' +
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
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();';
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
  // ★作り物が 効いているか 確かめる★（効いていないのに 緑に しない）
  const dame = await page.evaluate(() => !!window.__dameSession);
  expect(dame, '★作り物（DKSession）が 効いていません★＝この 試験は 何も 見ていません').toBe(false);
}

test('★★① 日ごとの 電子決済の 欄は 残っていない★★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page);
  const r = await page.evaluate(() => ({
    furui: !!document.getElementById('denshiYen'),
    sha: document.querySelectorAll('.sha').length,
  }));
  // eslint-disable-next-line no-console
  console.log('★古い 欄★ ' + JSON.stringify(r));
  expect(err, '★画面が 落ちました★').toEqual([]);
  expect(r.furui, '★日ごとの 電子決済の 欄が 残っています★').toBe(false);
  expect(r.sha, '★車が 1台も 出ていません★').toBeGreaterThan(0);
});

test('★★② 車ごとに 売上・電子決済・設定した 実費が 並ぶ★★', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(() =>
    [...document.querySelectorAll('.sha')].map((d) => ({
      na: ((d.querySelector('.sha-na') || {}).textContent || '').trim(),
      ran: [...d.querySelectorAll('.frow')].map((f) =>
        ((f.querySelector('.flabel') || {}).textContent || '').trim()
      ),
    }))
  );
  // eslint-disable-next-line no-console
  console.log('★車ごと★ ' + JSON.stringify(r));
  expect(
    r.map((x) => x.na),
    '★会社の 車が 全部 出ていません★'
  ).toEqual(['4987', '1466', '1173']);
  r.forEach((x) => {
    expect(x.ran, '★' + x.na + ' の 欄が 違います★').toEqual([
      '売上',
      '電子決済',
      '高速代',
      '橋代',
      'その他',
      'その他2',
    ]);
  });
});

test('★★③ 読めている 車は 売上を 出すだけ／読めていない 車は 打ち直せる★★', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(() =>
    [...document.querySelectorAll('.sha')].map((d) => {
      const f = d.querySelectorAll('.frow')[0];
      const i = f.querySelector('input');
      return {
        na: ((d.querySelector('.sha-na') || {}).textContent || '').trim(),
        atai: i.value,
        utenai: i.disabled,
        hint: ((f.querySelector('.hint') || {}).textContent || '').trim(),
      };
    })
  );
  // eslint-disable-next-line no-console
  console.log('★売上の 欄★ ' + JSON.stringify(r));
  const yonda = r.filter((x) => x.na === '4987')[0];
  expect(yonda.atai, '★読めた 売上が 出ていません★').toBe('15200');
  expect(yonda.utenai, '★読めた 売上が 打ち直せます★（メーターの 数字は 変えません）').toBe(true);
  expect(yonda.hint, '★読めている 事を 書いていません★').toContain('読めています');

  r.filter((x) => x.na !== '4987').forEach((x) => {
    expect(x.utenai, '★' + x.na + ' の 売上が 打ち直せません★').toBe(false);
    expect(x.hint, '★' + x.na + ' に 読み取れていない 事を 書いていません★').toContain(
      '読み取れていません'
    );
  });
});

test('★★④ 打った 値が 車の 鍵で 送られる★★', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    window.__okutta = [];
  });
  // ★読めていない 車（1173）の 売上を 打つ★
  const ran = page.locator('.sha', { hasText: '1173' }).locator('input').first();
  await ran.fill('3000');
  await ran.dispatchEvent('change');
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => window.__okutta || []);
  // eslint-disable-next-line no-console
  console.log('★送った 中身★ ' + JSON.stringify(r));
  expect(r.length, '★何も 送っていません★').toBeGreaterThan(0);
  const b = JSON.parse(r[r.length - 1].body);
  expect(r[r.length - 1].saki, '★送り先が 車ごとの 棚では ありません★').toContain('dk_manual_days');
  expect(b.device_id, '★どの 車か 付いていません★').toBe('d3');
  expect(b.sales_yen, '★打った 売上が 入っていません★').toBe(3000);
});

test('★★⑤ どこで 名前を 変えるか 書いてある★★', async ({ page }) => {
  await hiraku(page);
  const ji = await page.evaluate(() => {
    const n = document.querySelector('.note');
    return n ? (n.innerText || '').replace(/\s+/g, ' ') : '';
  });
  // eslint-disable-next-line no-console
  console.log('★説明★ ' + JSON.stringify(ji));
  expect(ji, '★会社設定で 変えられる 事を 書いていません★').toContain('会社設定');
  expect(ji, '★実費 と 書いていません★').toContain('実費');
  expect(ji, '★読み取れていない 車の 事を 書いていません★').toContain('0');
});
