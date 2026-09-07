// ============================================================
// ★★事務所の 下の 帯（各ページへ 飛ぶ）★★ 2026-09-04（司さん）
//
//   ★司さんの言葉★
//     「★この事務所だけ 他の アプリと 違う 型式なんを 同じに しろや★」
//     「★フッター 作って 各ページに 飛ぶようにしろ★」「★分かりにくいって 前から いやろが★」
//
//   ★実測（直す前）★
//     ・下の 帯 … ★5枚とも 0個★（飲み屋 Castally には 在る）
//     ・行き先が ★画面ごとに バラバラ★
//         dashboard … ★どこへも 行けない（行き止まり）★
//         kyuryo/uriage/shukei … それぞれ 3か所（中身が 違う）
//     ・料金表へ 入る 口 … ★1枚からも 無い★
//     ・今 どこに 居るかの 印 … ★無い★
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-04 実測）★★
//     ①下の 帯の 読み込みを 1枚から 外す … ★赤★
//     ②今の 画面の 印（on）を 付けない … ★赤★
//     ③行き先を 1つ 減らす ………………… ★赤★
//     戻した後 … ★緑★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);

// ★ログイン済みに する★（他の 試験と 同じ 形）
function tsukuru() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: FIX.settings[0].company_id, name: '見張り用' };
  return (
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
    'S.rest=function(s,p,o){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hairu(page) {
  // ★★外（本番の 倉庫）へ 出さない★★ 2026-09-06
  //   ★これは「赤を 緑に する 直し」では ありません★
  //   ★試験が 本番の 倉庫を 叩いていたのを 止めます★
  //   ★実測（2026-09-06）★
  //     dashboard.html:808 が SB_URL + '/auth/v1/user' を 直に 叩きます。
  //     ★手元（外へ 出られる）★ … 本番の supabase が ★403★
  //        ⇒ dashboard.html:1344 `if (!u || !u.id) return goLogin();`
  //        ⇒ ★login.html へ 飛ぶ★ ⇒ 帯を 見る前に 終わる（15秒 時間切れ）
  //     ★CI（外へ 出られない）★ … fetch が 落ちる ⇒ catch の 側 ⇒ 飛ばない ⇒ 緑
  //   ⇒★★手元の 赤も CI の 緑も、どちらも 中身を 見ていませんでした★★
  //   ⇒★手元でも CI でも ★同じ 道★ を 通す★
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'u1', email: 'mihari@example.com' }),
    })
  );

  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(),
    })
  );
}

const GAMEN = [
  { f: 'dashboard.html', na: '会社設定' },
  { f: 'kyuryo.html', na: '給料' },
  { f: 'uriage.html', na: '売上表' },
  { f: 'shukei.html', na: '月次集計' },
  { f: 'ryokinhyou.html', na: '料金表' },
];
// ★並びは 司さんの 決め★ 2026-09-05「月と給料 入れ替えて」
const SAKI = ['月次集計', '売上表', '給料', '料金表', '会社設定'];

for (const g of GAMEN) {
  test('★下の 帯（' + g.f + '）★', async ({ page }) => {
    const err = [];
    page.on('pageerror', (e) => err.push(e.message));
    await hairu(page);
    await hairu(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/' + g.f, { waitUntil: 'domcontentloaded' });
    await page.locator('#dkFooter').waitFor({ state: 'visible', timeout: 15000 });
    const r = await page.evaluate(() => {
      const n = document.getElementById('dkFooter');
      const b = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      const items = [...n.querySelectorAll('[data-dkgo]')].map((x) => ({
        go: x.getAttribute('data-dkgo'),
        // ★字は 名前だけで 比べる★（絵文字は 端末で 出方が 変わる）
        ji: (x.querySelector('.dk-foot-lb') || {}).textContent || '',
        on: x.classList.contains('on'),
        w: Math.round(x.getBoundingClientRect().width),
      }));
      // ★下に 貼り付いているか★
      return {
        kotei: cs.position,
        shita: Math.round(window.innerHeight - b.bottom),
        hamidashi: b.right > window.innerWidth + 1,
        items: items,
        // ★本文が 帯に 隠れていないか★
        aki: parseInt(getComputedStyle(document.body).paddingBottom, 10) || 0,
        takasa: Math.round(b.height),
      };
    });
    console.log('★' + g.f + '★ ' + JSON.stringify(r));
    console.log('★落ち★ ' + err.length + '件');
    expect(r.kotei, '★下に 貼り付いていません★').toBe('fixed');
    expect(r.shita, '★下に ぴったり 付いていません★').toBeLessThanOrEqual(1);
    expect(r.hamidashi, '★横に はみ出しています★').toBe(false);
    // ★行き先は 5つ・どの画面でも 同じ★
    expect(
      r.items.map((x) => x.ji),
      '★行き先が 画面ごとに 違います★'
    ).toEqual(SAKI);
    // ★今 居る 画面に 印が 付いている★（1つだけ）
    const on = r.items.filter((x) => x.on);
    expect(on.length, '★今 どこに 居るかの 印が 1つでは ありません★').toBe(1);
    expect(on[0].go, '★印が 別の 画面に 付いています★').toBe(g.f);
    expect(on[0].ji, '★印の 字が 違います★').toBe(g.na);
    // ★本文が 帯に 隠れない★
    expect(r.aki, '★下の 空きが 足りません（帯に 隠れます）★').toBeGreaterThanOrEqual(r.takasa);
    expect(err, '★画面が 落ちました★').toEqual([]);
    await page.screenshot({
      path:
        'C:/Users/zeroa/dk-tokei-2026-09-02/tokei/shot-foot-' + g.f.replace('.html', '') + '.png',
    });
  });
}

test('★押すと その 画面へ 行く★', async ({ page }) => {
  await hairu(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/kyuryo.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#dkFooter').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('[data-dkgo="ryokinhyou.html"]').click();
  await page.waitForURL('**/ryokinhyou.html', { timeout: 15000 });
  console.log('★行った先★ ' + new URL(page.url()).pathname);
  expect(new URL(page.url()).pathname, '★料金表へ 行けません★').toContain('ryokinhyou.html');
  // ★料金表へ 入る 口は 前は 1枚も 無かった★
  await page.locator('#dkFooter').waitFor({ state: 'visible', timeout: 15000 });
  const on = await page.evaluate(() =>
    document.querySelector('#dkFooter .on').getAttribute('data-dkgo')
  );
  expect(on, '★行った先で 印が 付いていません★').toBe('ryokinhyou.html');
});

test('★本人の 画面（?t=）には 出さない★', async ({ page }) => {
  await hairu(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/kyuryo.html?t=dummy-token-1234', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const aru = await page.evaluate(() => !!document.getElementById('dkFooter'));
  console.log('★本人の 画面に 帯が 在るか★ ' + aru + '（false が 正しい）');
  expect(aru, '★従業員に 事務所の 帯が 見えています★').toBe(false);
});

// ★★ログイン画面には 出さない★★ 2026-09-04
//   ★dashboard は ログインしていないと login.html へ 飛ばす★
//   ⇒ ★飛ぶ 前の 一瞬に 帯が 出ていた★（絵を 開いて 気づいた）
//   ★★わざと壊して 赤に なる事を 見た★★ … 名簿の 見張りを 外す ⇒ ★赤★
test('★ログイン画面には 帯を 出さない★', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const aru = await page.evaluate(() => !!document.getElementById('dkFooter'));
  console.log('★ログイン画面に 帯が 在るか★ ' + aru + '（false が 正しい）');
  expect(aru, '★ログイン画面に 帯が 出ています★').toBe(false);
  await page.screenshot({
    path: 'C:/Users/zeroa/dk-tokei-2026-09-02/tokei/shot-foot-login.png',
  });
});

// ★ログインしていない dashboard でも 出さない★（飛ぶ 前の 一瞬）
test('★ログイン前の 事務所でも 帯を 出さない★', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({
    url: location.pathname,
    aru: !!document.getElementById('dkFooter'),
  }));
  console.log('★ログイン前★ ' + JSON.stringify(r));
  expect(r.aru, '★ログイン画面に 帯が 出ています★').toBe(false);
});
