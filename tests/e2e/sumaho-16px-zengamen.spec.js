// ============================================================
// ★★全画面を 電話の 形で 開き、入れる欄・選ぶ欄が 16px 以上・横の はみ出し 0 を その場で 測る★★ 2026-11-04
//   司さん「なんで残したんど・きっちりやれや」＝料金表の 選ぶ欄を 直した 時に 見つけた 同じ 穴を 全画面で 0 に した。
//   ★iOS は 16px 未満の 入力/選択を 触ると 画面が 勝手に 寄ります★（kyuryo-sumaho.spec.js は 給料だけ・これは 全画面）
//   ★隠れて いる 欄も 数える★（窓・後から 開く 所＝メーターの 車の 設定・料金の 設定・事務所の 実費 など）
//     決まりが 何も 無い 欄は ブラウザの 既定 13.3px に なる＝字を 読むだけの tests/unit/nyuryoku-ran-16px.test.js では 見えない
//
//   ★直す 前の 数（2026-11-04 テスト線 62ca18b64・390px）★
//     dashboard 3（homeCity 15・kaishaShime 15・jippiNew 13.3）／index 21（隠れた 窓）／ryokinhyou 1（shashuSel 13.3）
//     sub 1（vehicleSel 13）／daikome-admin 1（newSeat 15）→ 0
//   ★わざと壊して 赤（2026-11-04 実測）★ 直す 前の 8画面（62ca18b64）に 戻す ⇒ 2本とも 赤（5画面・27欄）
//     ／ログインの 見せかけを 外す ⇒「別の 所へ 飛んだ」で 赤（測れていない 緑に しない）
// ============================================================
const { test, expect, devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);

// 開く 画面（?・# は 開き方で 出る 欄が 変わる 所）
const GAMEN = [
  'dashboard.html',
  'kyuryo.html?henshu=1',
  'kyuryo.html?henshu=1#kuruma',
  'kyuryo.html?henshu=1#emp',
  'ryokinhyou.html?henshu=1',
  'nyuryoku.html',
  'shukei.html',
  'uriage.html',
  'sub.html',
  'daikome-admin.html',
  'index.html',
  'login.html',
];

function sessJs() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(FIX) +
    ';var co={company_id:F.settings[0].company_id,name:"見張り用",url_token:"x",status:"active",seat_limit:3};' +
    'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({token:"d",access_token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

for (const [na, d] of [
  ['iPhone', devices['iPhone 13']],
  ['Android', devices['Pixel 5']],
]) {
  test(
    '★★全画面 ' + na + '：入れる欄・選ぶ欄 16px 以上・横の はみ出し 0★★',
    async ({ browser }) => {
      test.setTimeout(120000);
      // eslint-disable-next-line no-unused-vars
      const { defaultBrowserType, ...ops } = d;
      const ctx = await browser.newContext({
        ...ops,
        baseURL: test.info().project.use.baseURL,
        timezoneId: 'Asia/Tokyo',
      });
      // 外の 字体は 止める（読めた・読めないで 幅が 変わり 揺れる）
      await ctx.route(/fonts.(googleapis|gstatic)/, (r) => r.fulfill({ status: 200, body: '' }));
      await ctx.route('**/js/dk-session.js*', (r) =>
        r.fulfill({
          status: 200,
          contentType: 'application/javascript; charset=utf-8',
          body: sessJs(),
        })
      );
      // 倉庫へは 出さない（認証は 見張り用の 人・他は 空）
      await ctx.route(/supabase\.co/, (r) =>
        r.request().url().includes('/auth/v1/')
          ? r.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ id: 'u1', email: 'mihari@example.com' }),
            })
          : r.request().url().includes('/dk_company_devices')
            ? // ★車を 1台 見せる★＝事務所の 車の 一覧の「車の名前」欄（JS で 作る）を 出して 測る
              r.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([{ device_id: 'mihari-dev-1', vin: null, last_seen: null }]),
              })
            : r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      );
      const page = await ctx.newPage();
      const warui = [];
      const hamideru = [];
      const tonda = [];
      let nRan = 0;
      const tsukutta = {};
      const nGamen = {};
      for (const g of GAMEN) {
        await page.goto('/' + g);
        await page.waitForTimeout(1500);
        // ★JS で 後から 作る 欄を 出してから 測る★（taiketsu 2026-11-04：開いただけでは 0個で 見逃した）
        if (g.startsWith('ryokinhyou')) {
          await page.evaluate(() => {
            for (const id of ['fTiersOn', 'fVehOn']) {
              const e = document.getElementById(id);
              if (e && !e.checked) e.click();
            }
            [...document.querySelectorAll('button')]
              .filter((b) => /足す/.test(b.textContent) && b.offsetParent)
              .forEach((b) => b.click());
          });
          // 並びごとに 欄が 出るまで 待って 数える（決まった 時間だけ 待つと CI が 遅い 時に 揺れる）
          for (const na2 of ['tiersList', 'surList', 'kikanList', 'vehList']) {
            const loc = page.locator('#' + na2 + ' .kumi input:not([type=checkbox])');
            await loc
              .first()
              .waitFor({ timeout: 10000 })
              .catch(() => {});
            tsukutta[na2] = await loc.count();
          }
        }
        if (g === 'dashboard.html') {
          const loc = page.locator('input[aria-label="車の名前"]');
          await loc
            .first()
            .waitFor({ timeout: 10000 })
            .catch(() => {});
          tsukutta.kuruma = await loc.count();
        }
        const r = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const ran = [...document.querySelectorAll('input,select,textarea')].filter(
            (e) =>
              !/^(checkbox|radio|hidden|button|submit|reset|range|color|file|image)$/.test(e.type)
          );
          const chi = ran
            .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16)
            .map((e) => (e.id || e.className || e.tagName) + ':' + getComputedStyle(e).fontSize);
          return {
            path: location.pathname,
            vw,
            sw: document.documentElement.scrollWidth,
            n: ran.length,
            chi,
          };
        });
        nRan += r.n;
        nGamen[g] = r.n;
        if (r.path !== '/' + g.split(/[?#]/)[0]) tonda.push(g + '→' + r.path);
        if (r.chi.length) warui.push(g + ' ' + r.chi.join(','));
        if (r.sw > r.vw) hamideru.push(g + ' ' + r.sw + '>' + r.vw);
      }
      console.log(
        '[' +
          na +
          '] 画面 ' +
          GAMEN.length +
          '・欄 ' +
          nRan +
          '・16px未満 ' +
          warui.length +
          '・はみ出し ' +
          hamideru.length
      );
      expect(tonda, '★画面が 別の 所へ 飛んだ（ログイン等）＝測れていない★').toEqual([]);
      expect(warui, '★16px 未満の 入れる欄・選ぶ欄が 在ります★').toEqual([]);
      expect(hamideru, '★横に はみ出して います★').toEqual([]);
      expect(nRan, '★欄を 数えられて いない★').toBeGreaterThanOrEqual(200);
      // ★画面ごとの 下限★（1画面が 丸ごと 測れなく なっても 合計では 気づけない＝taiketsu 2026-11-04）
      //   2026-11-04 の 数（390px）：dashboard 7／kyuryo 11・66・29／ryokinhyou 32／nyuryoku 67／shukei 2／sub 1／admin 9／index 26／login 5
      //   uriage は 見せかけの 売上が 無く 0＝.yen/.carname は tests/unit/nyuryoku-ran-16px.test.js ② が 守る
      const KAGEN = {
        'dashboard.html': 5,
        'kyuryo.html?henshu=1': 5,
        'kyuryo.html?henshu=1#kuruma': 40,
        'kyuryo.html?henshu=1#emp': 15,
        'ryokinhyou.html?henshu=1': 25,
        'nyuryoku.html': 40,
        'shukei.html': 1,
        'sub.html': 1,
        'daikome-admin.html': 5,
        'index.html': 20,
        'login.html': 3,
      };
      const tarinai = Object.entries(KAGEN)
        .filter(([g, n]) => !(nGamen[g] >= n))
        .map(([g, n]) => g + ' ' + nGamen[g] + '<' + n);
      expect(tarinai, '★画面の 欄を 数えられて いない★').toEqual([]);
      // ★JS で 作る 欄は 並びごとに 1つ 以上（どれか 1つの 並びが 作られなくても 気づく）★
      for (const na2 of ['tiersList', 'surList', 'kikanList', 'vehList']) {
        expect(
          tsukutta[na2],
          '★料金表の ' + na2 + ' の 欄を 作れて いない★'
        ).toBeGreaterThanOrEqual(1);
      }
      expect(tsukutta.kuruma, '★事務所の「車の名前」欄を 作れて いない★').toBeGreaterThanOrEqual(1);
      await ctx.close();
    }
  );
}
