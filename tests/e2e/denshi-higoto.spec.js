// ============================================================
// ★★電子決済 を「日ごと」に 入れられる（二重に 数えない）★★ 2026-09-06
//
//   ★司さんの言葉★「毎日 入れれるようにしろよ 前から いよろが 入力タブ作れって」
//
//   ★今まで★ `dk_month_extras`＝★月に 1マス★
//     ⇒ いつ 受け取ったか 分からない／日ごとの 突き合わせが 出来ない
//   ★これから★ `dk_day_extras`＝★日ごと★（月ごとの 棚は ★消していません★）
//
//   ★★一番 こわい 事＝二重に 数える★★
//     同じ 月に「月ごと 50,000」と「日ごと 1,000＋2,000」が 両方 在ると
//     何もしなければ ★53,000★ に なる（＝★お金が 嘘に なる★）
//   ⇒ 決まり … ★その月に 日ごとが 1件でも 在れば 月ごとは 使わない★
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①二重防ぎ（日ごとが 在る 月は 足さない）を 外す … ★赤 60,000★
//     ②日ごとを 読まない ……………………………… ★赤 57,000★（月ごとだけに 戻る）
//     戻した後 … ★緑 10,000★
//
//   ★★打つ 所は 1か所★★ 2026-09-06（司さん「入力タブは」）
//   ★★画面の 字は「電子決済」★★ 2026-09-08（司さん「PayPayやなくて電子決済にして」）
//     ⇒ ★倉庫の 列は denshi_yen の まま★（名前を 変えると 前の 分が 読めなくなる）
//     打つ … ★売上表の「入力」★（tests/e2e/uriage-denshi.spec.js で 見張る）
//     見る … 月次集計（★ここには 打つ 欄を 置かない★）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = FIX.settings[0].company_id;

// ★今日の 日付に よらない★（2026-09-06 の 決まり）
//   ⇒ 年は ★画面から 読んだ 物★を 使う（先に 1回 開いて 聞く）
function tsukuru(nen) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  // ★3月★… 月ごと 50,000 ＋ 日ごと 1,000/2,000 ⇒ ★日ごとだけ 3,000★
  // ★5月★… 月ごと 7,000 のみ            ⇒ ★7,000★
  const tsuki = nen
    ? [
        { company_id: CO, ym: nen + '-03', denshi_yen: 50000 },
        { company_id: CO, ym: nen + '-05', denshi_yen: 7000 },
      ]
    : [];
  const hi = nen
    ? [
        { company_id: CO, pay_date: nen + '-03-01', denshi_yen: 1000 },
        { company_id: CO, pay_date: nen + '-03-02', denshi_yen: 2000 },
      ]
    : [];
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(FIX) +
    ';var co=' +
    JSON.stringify(co) +
    ';var TS=' +
    JSON.stringify(tsuki) +
    ';var HI=' +
    JSON.stringify(hi) +
    ';' +
    'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[];' +
    ' if(p.indexOf("dk_month_extras")===0)return TS; if(p.indexOf("dk_day_extras")===0)return HI; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page, nen) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(nen),
    })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#dkBody').waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForTimeout(1500);
}

// ★画面の「年」を 聞く★（今日の 日付を テストに 書かない 為）
//   ★画面に 出ている 字から 読む★（中の 変数は 外から 見えない）
async function nenWoKiku(page) {
  await hiraku(page, null);
  const ji = await page.evaluate(() => (document.getElementById('oneTtl') || {}).textContent || '');
  const m = ji.match(/(\d{4})年/);
  if (!m) throw new Error('★年が 読めません★ 見出し=「' + ji + '」');
  return m[1];
}

// ★内訳の 電子決済 の 行を 読む★
function denshiWoYomu(page) {
  return page.evaluate(() => {
    const tr = [...document.querySelectorAll('#kpis tr')].find(
      (x) => (x.children[0] || {}).textContent && x.children[0].textContent.indexOf('電子決済') >= 0
    );
    return tr ? Number((tr.children[1].textContent || '').replace(/[^\d-]/g, '')) : null;
  });
}

test('★★日ごとが 在る 月は 月ごとを 足さない（二重に 数えない）★★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));

  const nen = await nenWoKiku(page);
  await hiraku(page, nen);

  const v = await denshiWoYomu(page);
  // eslint-disable-next-line no-console
  console.log('★年まるごとの 電子決済★ ' + v + '（年 ' + nen + '）');
  expect(
    v,
    '★電子決済 が 合いません★\n' +
      '  3月 … 月ごと 50,000 ＋ 日ごと 1,000/2,000 ⇒ ★日ごとだけ 3,000★\n' +
      '  5月 … 月ごと 7,000 ⇒ 7,000\n' +
      '  ⇒ 正しくは 10,000。53,000+7,000=57,000 に なっていたら ★二重に 数えています★'
  ).toBe(10000);
  expect(err, '★画面が 落ちています★').toEqual([]);
});

test('★★月次集計の 日ごとは 見るだけ（打つ 欄が 無い）★★', async ({ page }) => {
  const nen = await nenWoKiku(page);
  await hiraku(page, nen);

  await page.selectOption('#tsukiSel', '3');
  await page.waitForTimeout(400);
  await page.click('#dkSegD');
  await page.waitForTimeout(300);

  const r = await page.evaluate(() => ({
    ran: document.querySelectorAll('#dkBody input').length,
    gyou: document.querySelectorAll('#dkBody tr').length,
    ji: (document.getElementById('dkBody') || {}).textContent || '',
    michi: (document.getElementById('dkMichi') || {}).textContent || '',
  }));
  // eslint-disable-next-line no-console
  console.log(
    '★月次集計の 日ごと★ ' + JSON.stringify({ ran: r.ran, gyou: r.gyou, michi: r.michi })
  );
  expect(r.ran, '★打つ 欄が 2か所に なっています★（打つ 所は 売上表の「入力」だけ）').toBe(0);
  expect(r.gyou, '★3月は 31日ぶん 出るはず★').toBe(31);
  expect(r.ji, '★3/1 の 1,000 が 出ていません★').toContain('1,000');
  // ★★道順も 直した★★ 2026-09-08（入力は ★下の 帯★／売上表では ない）
  expect(r.michi, '★打つ 所への 道順が 書いてありません★').toContain('下の 帯');
});

// ★★2026-09-08 … 月ごとも 見るだけ に した★★
//   ★司さん★「なぜ月次の電子決済は入力タブ作ったのにここで入力できるようになっとんど
//             しかも月ごとの日ごととで違うし」
//   ⇒ 月ごとの 欄が 無くなった ので「日ごとを 使っています」の 断りも 要らない。
//     ★代わりに 月ごとの 数が 日ごとの 合計に なっている事★を 見る。
test('★★月ごとの 表は 日ごとを 足した 数（打つ 欄は 無い）★★', async ({ page }) => {
  const nen = await nenWoKiku(page);
  await hiraku(page, nen);

  await page.click('#dkSegM');
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    ran: document.querySelectorAll('#dkBody input').length,
    gyou: [...document.querySelectorAll('#dkBody tr')].map((tr) =>
      [...tr.children].map((td) => td.textContent.trim())
    ),
  }));
  // eslint-disable-next-line no-console
  console.log('★月ごと★ ' + JSON.stringify(r.gyou.filter((x) => x[1])));
  expect(r.ran, '★月ごとに 打つ 欄が 在ります★').toBe(0);
  // ★3月＝日ごと 1,000＋2,000＝3,000（月ごとの 50,000 は 使わない）★
  const san = r.gyou[2];
  expect(san[0], '★3月の 行では ありません★').toContain('3月');
  expect(san[1], '★3月が 日ごとの 合計に なっていません★').toContain('3,000');
  // ★5月＝日ごとが 無いので 前に 月で 入れた 7,000★
  const go = r.gyou[4];
  expect(go[1], '★5月が 出ていません★').toContain('7,000');
});
