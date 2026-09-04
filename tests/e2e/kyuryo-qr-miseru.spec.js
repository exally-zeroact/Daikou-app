// ============================================================
// ★★QRは「見せるだけ」で 渡せる★★ 2026-09-04（司さん）
//   ★司さんの言葉★「なんで 印刷せないかんのど」「QRコードは 見せるだけで ええやろが」
//   ★実測（直す前）★ QR は パソコン(1280px)も スマホ(390px)も ★152px★
//     ⇒ パソコンの 画面を 離れて 読ませるには 小さい
//   ★直した後★ 窓の 短い方の 72%（240〜560px）まで 大きくする
//     パソコン(1280x800) … 152px → ★560px★
//     スマホ(390x844) …… 152px → ★281px★
//     ★どちらも 窓から はみ出していない★
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-04 実測）★★
//     ①大きくしない（元の 152px の まま）… ★2本とも 赤★
//       「★大きく なっていません★」
//     ②別人の QR を 出す（一覧の 最後の人を 返す）… ★2本とも 赤★
//       「★誰の QR か 分かりません★」
//     戻した後 … ★緑★
//
//   ★中身も 見ています★＝★同じ URL から その場で 作り直して 一致するか★
//     （読み取りの 道具が 無いので。絵が 大きいだけで 中身が 空／別人 を 防ぐ）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const LIST = [
  {
    employee_id: 'e1',
    name: 'テスト太郎',
    token: '7c4383b6aaaa1111bbbb2222cccc3333',
    init_code: '07041B0C',
    pw_ari: false,
    sort_order: 1,
  },
  {
    employee_id: 'e2',
    name: 'テスト次郎',
    token: '3b7433a6dddd4444eeee5555ffff6666',
    init_code: null,
    pw_ari: true,
    sort_order: 2,
  },
];
function tsukuru(dir) {
  const moto = fs.readFileSync(path.join(dir, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: FIX.settings[0].company_id, name: '見張り用' };
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(FIX) +
    ';var co=' +
    JSON.stringify(co) +
    ';var L=' +
    JSON.stringify(LIST) +
    ';' +
    'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){if(String(p).indexOf("rpc/dk_kyuryo_haifu")===0)return Promise.resolve({ok:true,json:function(){return Promise.resolve({ok:true,list:L});}});' +
    'return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}
for (const d of [
  { na: 'パソコン', w: 1280, h: 800 },
  { na: 'スマホ', w: 390, h: 844 },
]) {
  test('★' + d.na + '：QRを 大きく 見せる★', async ({ page }) => {
    const err = [];
    page.on('pageerror', (e) => err.push(e.message));
    await page.route('**/js/dk-session.js*', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: tsukuru(__dirname),
      })
    );
    await page.setViewportSize({ width: d.w, height: d.h });
    await page.goto('/kyuryo.html');
    await page.waitForTimeout(1600);
    await page.locator('.tab[data-tab="set"]').click();
    await page.waitForTimeout(400);
    await page.locator('#btnHaifu').click();
    await page.waitForTimeout(900);
    // ★札の 中の QR（小さい方）★
    // ★★ボタンが 引っ付いていないか（縦も 横も）★★ 2026-09-04（司さん）
    //   「前から 色んな アプリで いよるけど なんで ボタンが 引っ付くんど」
    //   ★裸で 並べると 折り返した時に 縦の 隙間が 0 に なる★
    //   ⇒ ★描かれた 場所で 数える★（CSS の 字では 見ない）
    const suki = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#haifuList button')].map((x) => {
        const r = x.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom, ji: x.textContent.trim() };
      });
      let yoko = 999,
        tate = 999;
      for (let i = 0; i < b.length; i++) {
        for (let j = 0; j < b.length; j++) {
          if (i === j) continue;
          // ★同じ 段（縦が 重なる）で 隣★
          if (b[j].t < b[i].b - 1 && b[j].b > b[i].t + 1 && b[j].l >= b[i].r) {
            yoko = Math.min(yoko, Math.round(b[j].l - b[i].r));
          }
          // ★上下の 段（横が 重なる）★
          if (b[j].l < b[i].r - 1 && b[j].r > b[i].l + 1 && b[j].t >= b[i].b) {
            tate = Math.min(tate, Math.round(b[j].t - b[i].b));
          }
        }
      }
      return { kazu: b.length, yoko: yoko, tate: tate, ji: b.map((x) => x.ji) };
    });
    console.log('★ボタンの すきま★ ' + JSON.stringify(suki));
    expect(suki.kazu, '★ボタンを 数えられていません★').toBeGreaterThan(3);
    expect(suki.yoko, '★横が 引っ付いています★').toBeGreaterThanOrEqual(6);
    expect(suki.tate, '★縦が 引っ付いています★').toBeGreaterThanOrEqual(6);
    expect(suki.ji.join(','), '★「コピー」に なっていません★').toContain('コピー');

    const chiisai = await page.evaluate(() =>
      Math.round(document.querySelector('#haifuList svg').getBoundingClientRect().width)
    );
    await page.locator('[data-hmise]').first().click();
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const o = document.getElementById('haifuMise');
      if (!o) return null;
      const sv = o.querySelector('svg');
      const b = sv.getBoundingClientRect();
      return {
        qr: Math.round(b.width),
        takasa: Math.round(b.height),
        mado: Math.min(window.innerWidth, window.innerHeight),
        hamidashi: b.right > window.innerWidth + 1 || b.bottom > window.innerHeight + 1,
        namae: (o.textContent || '').indexOf('テスト太郎') >= 0,
      };
    });
    console.log('★' + d.na + '★ 札の中 ' + chiisai + 'px → 大きく ' + JSON.stringify(r));
    expect(r, '★大きい QR が 出ません★').toBeTruthy();
    expect(r.qr, '★大きく なっていません★').toBeGreaterThan(chiisai + 60);
    expect(r.hamidashi, '★窓から はみ出しています★').toBe(false);
    expect(r.namae, '★誰の QR か 分かりません★').toBe(true);
    // ★★大きい QR の 中身が 本当に その人の URL か★★
    //   ★読み取りの 道具が 無いので、同じ URL から その場で 作り直して 比べます★
    //   ＝★絵が 大きいだけで 中身が 空／別人★という 事故を 防ぐ
    const onaji = await page.evaluate(() => {
      const o = document.getElementById('haifuMise');
      const dete = o.querySelector('svg').innerHTML;
      const url = location.origin + '/kyuryo.html?t=7c4383b6aaaa1111bbbb2222cccc3333&c=07041B0C';
      const q = window.qrcode(0, 'M');
      q.addData(url);
      q.make();
      const d = document.createElement('div');
      d.innerHTML = q.createSvgTag({ cellSize: 8, margin: 2 });
      return { onaji: d.querySelector('svg').innerHTML === dete, url: url };
    });
    console.log('★中身が その人の URL と 同じか★ ' + onaji.onaji);
    expect(onaji.onaji, '★大きい QR の 中身が 違います★').toBe(true);
    await page.screenshot({
      path:
        'C:/Users/zeroa/dk-tokei-2026-09-02/tokei/shot-qr-' + (d.w > 800 ? 'pc' : 'sp') + '.png',
    });
    // ★どこかを 押すと 閉じる★
    await page.locator('#haifuMise').click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(300);
    const nokori = await page.evaluate(() => !!document.getElementById('haifuMise'));
    expect(nokori, '★閉じません★').toBe(false);
    expect(err, '★画面が 落ちました★').toEqual([]);
  });
}
