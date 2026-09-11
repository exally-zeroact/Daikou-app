// ============================================================
// ★★実費が「足せるけど 消せない」★★ 2026-09-11（司さん・写真つき）
//
//   ★実物で 出ていた 字★
//     保存できませんでした。[400]
//     {"code":"23502", … "null value in column \"label\" of relation
//      \"dk_expense_kinds\" violates not-null constraint"}
//
//   ★病気の 元（実測）★
//     `jippiSave(kindId, field, value)` は ★1つの 欄だけ★ を 入れて
//     `on_conflict=company_id,kind_id` で ★upsert★ していた。
//     upsert は ★行を 丸ごと 置き換える★ので、入れていない `label` が 空に なる。
//     ⇒ 名前を 打ち直す 時は label が 入るので 通る
//       ＝★消す／▲▼／使う だけ 落ちていた★
//
//   ★ここで 守る 事★
//     ★何を 押しても 送る 中身に label・sort_order・active が そろっている★
//
//   ★測り方★ 倉庫へは 出しません。
//     ★送ろうとした 中身を 横から 捕まえて 数えます★（本物の 道を 通す）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-11 実測 ＝ 下に 書く）★★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const HTML = fs
  .readFileSync(path.join(__dirname, '..', '..', 'dashboard.html'), 'utf8')
  .replace(/\r\n/g, '\n');

const KAISHA = { company_id: 'c1', name: 'ZERO代行' };
const KINDS = [
  { company_id: 'c1', kind_id: 'toll', label: '高速代', sort_order: 10, active: true },
  { company_id: 'c1', kind_id: 'bridge', label: '橋代', sort_order: 20, active: true },
  { company_id: 'c1', kind_id: 'other', label: 'その他', sort_order: 30, active: true },
  { company_id: 'c1', kind_id: 'kmx1', label: 'その他2', sort_order: 40, active: true },
];

async function hiraku(page) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const stub =
    moto +
    ';(function(){var co=' +
    JSON.stringify(KAISHA) +
    ';var KINDS=' +
    JSON.stringify(KINDS) +
    ';var S=window.DKSession;if(!S)return;window.__okutta=[];' +
    'S.ensure=function(){return Promise.resolve({access_token:"t",user:{id:"u1"}});};' +
    'S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};' +
    'S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'function rows(p){ if(String(p).indexOf("dk_expense_kinds")>=0) return KINDS;' +
    ' if(String(p).indexOf("dk_companies")>=0) return [co]; return [];}' +
    'S.rest=function(s,p,o){ if(o&&o.method)window.__okutta.push({saki:p,method:o.method,body:o.body});' +
    ' return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},' +
    ' json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: stub })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(KINDS) })
  );
  // ★★送ろうとした 中身を 横から 捕まえる★★
  //   dashboard.html は ★fetch を 直に★ 使う（DKSession.rest では ない）＝実測
  await page.addInitScript(() => {
    window.__okutta = [];
    const moto = window.fetch;
    window.fetch = function (u, o) {
      try {
        if (o && o.method && o.method !== 'GET') {
          window.__okutta.push({ saki: String(u), method: o.method, body: o.body });
        }
      } catch (_) {
        /* ignore */
      }
      return moto.apply(this, arguments);
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  await page.locator('[data-chip="jippi"]').click();
  await page.waitForTimeout(900);
}

test('★★① 設定した 実費が 全部 並ぶ★★', async ({ page }) => {
  await hiraku(page);
  const na = await page.evaluate(() =>
    [...document.querySelectorAll('[data-f="label"]')].map((i) => i.value)
  );
  // eslint-disable-next-line no-console
  console.log('★実費の 名前★ ' + JSON.stringify(na));
  expect(na, '★設定した 名前が 全部 出ていません★').toEqual([
    '高速代',
    '橋代',
    'その他',
    'その他2',
  ]);
});

test('★★② 消す を 押したら label も 一緒に 送る★★', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    window.__okutta = [];
  });
  await page.locator('[data-keshi="kmx1"]').click();
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => window.__okutta || []);
  // eslint-disable-next-line no-console
  console.log('★送った 中身★ ' + JSON.stringify(r));
  // ★★「何も 送っていません」で 終わらせない★★
  //   label が 落ちると 画面が 先に 止める ので 送りが 0本に なる。
  //   ⇒ ★画面に 出た 字も 一緒に 見る★＝本当の 訳が 分かる
  const shirase = await page.evaluate(() => {
    const m = document.getElementById('jippiMsg');
    return m ? (m.textContent || '').trim() : '';
  });
  // eslint-disable-next-line no-console
  console.log('★画面の 字★ ' + JSON.stringify(shirase));
  expect(
    r.length,
    '★何も 送っていません★（画面の 字＝' +
      shirase +
      '）' +
      '／label が 落ちると 送る 前に 止まります'
  ).toBeGreaterThan(0);
  const body = JSON.parse(r[0].body);
  expect(body.label, '★label を 送っていません★（倉庫が 断ります）').toBe('その他2');
  expect(body.active, '★使わない 印に していません★').toBe(false);
  expect(body.sort_order, '★順番を 送っていません★').toBe(40);
});

test('★★③ ▲▼でも label が 落ちない★★', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    window.__okutta = [];
  });
  await page.locator('[data-shita="toll"]').click();
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => window.__okutta || []);
  expect(r.length, '★何も 送っていません★').toBeGreaterThan(0);
  const nai = r
    .map((x) => JSON.parse(x.body))
    .filter((b) => !b.label || String(b.label).trim() === '');
  // eslint-disable-next-line no-console
  console.log('★▲▼で 送った 本数★ ' + r.length + ' ／ label 無し ' + nai.length);
  expect(nai.length, '★label の 無い 送りが あります★（倉庫が 断ります）').toBe(0);
});

test('★★④ 1つの 欄だけ 送る 書き方に 戻っていない★★', () => {
  const i = HTML.indexOf('function jippiSave(');
  expect(i, '★保存の 所が ありません★').toBeGreaterThan(0);
  // ★関数の 終わりまで 読む★（字数で 切らない）
  const naka = (function () {
    let d = 0;
    for (let k = i; k < HTML.length; k++) {
      if (HTML[k] === '{') d++;
      else if (HTML[k] === '}') {
        d--;
        if (d === 0) return HTML.slice(i, k + 1);
      }
    }
    return HTML.slice(i);
  })();
  expect(naka.indexOf('label:'), '★label を 入れていません★').toBeGreaterThan(0);
  expect(naka.indexOf('sort_order:'), '★sort_order を 入れていません★').toBeGreaterThan(0);
  expect(naka.indexOf('active:'), '★active を 入れていません★').toBeGreaterThan(0);
  expect(
    naka.indexOf('JIPPI.forEach'),
    '★今の 行を 探していません★（空の label で 上書きします）'
  ).toBeGreaterThan(0);
});
