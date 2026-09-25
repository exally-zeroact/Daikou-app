// ============================================================
// ★★「月」の 列の 余白★★ 2026-09-25（司さん）
//
//   ★司さんの言葉★「まず全部やけど月の列の余白を少なくして他に幅を与えろ」
//
//   ★何が 起きていたか（2026-09-25 実測・390px 幅・本物の 画面）★
//     `table.kami` は `table-layout: fixed` ＝ 幅を 書かない 列は ★全部 同じ 幅★。
//     だから「1月」だけの 列が 金額の 列と ★同じ 73px★ を 取っていた。
//       5列の 表 … 月 73px / 金額 73px
//       4列の 表 … 月 91px / 数字 91px
//
//   ★★1度 外した やり方★★
//     width:1% ⇒ 4px に なり ★「12月」が 切れた★（実測 kire:1）。
//     ⇒ 割合では なく ★px で 置く★（fixed は 最初の 行の 幅を 使う）。
//
//   ★当てる 先を 名指しに する★
//     先頭が ★時の 列（年／月／日）★の 表だけ。
//     車の 名前や 項目名の 表に 当てると ★字が 切れる★
//     （uriage の 日ごとは「12/31（水）」＝44px では 入らない）
//     ⇒ [[feedback_ateru_basho_wo_hitotsuzutsu_tamesu]]
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-25 実測・1つずつ 手で）★★
//     ①width:44px の 決まりを 消す …… ★赤★（月の 列が 金額と 同じ 幅に 戻る）
//     ②width:44px を width:1% に する … ★赤★（「12月」が 切れる）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = '11111111-2222-3333-4444-555555555555';
// ★2つの 月に またがる 見本★（月ごと・年・日ごと の どれでも 行が 出る）
const SHIFTS = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-01-02T10:00:00+09:00',
    ended_at: '2026-01-02T18:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 1298210,
    trip_count: 18,
    actual_total_m: 8712700,
    total_distance_m: 15881800,
  },
  {
    shift_id: 's2',
    device_id: 'd1',
    started_at: '2026-12-03T10:00:00+09:00',
    ended_at: '2026-12-03T18:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 1080110,
    trip_count: 14,
    actual_total_m: 12770000,
    total_distance_m: 25760000,
  },
];

function tsukuru(dir) {
  const moto = fs.readFileSync(path.join(dir, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  return (
    moto +
    ';(function(){var S=window.DKSession;var co=' +
    JSON.stringify(co) +
    ';var SH=' +
    JSON.stringify(SHIFTS) +
    ';' +
    'function rows(p){ if(p.indexOf("dk_shifts")===0)return SH; return [];}' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(__dirname),
    })
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#kyoriTbl').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1200);
}

// ★表 1つ分を 測る★＝列の 幅（見出しの 行）と ★先頭の 升目で 字が 切れていないか★
function hakaru(page, thead, tbody) {
  return page.evaluate(
    ([th, tb]) => {
      const h = document.getElementById(th);
      const b = document.getElementById(tb);
      if (!h || !b) return null;
      const haba = [...h.querySelectorAll('th')].map((e) =>
        Math.round(e.getBoundingClientRect().width)
      );
      // ★先頭の 升目（月・年・日）が 切れていないか★
      let kire = 0;
      const kireta = [];
      b.querySelectorAll('tr').forEach((tr) => {
        const td = tr.children[0];
        if (!td) return;
        // ★「記録が ありません」の 知らせは 1マスを 横に 伸ばした 行＝列の 幅では ない
        if (tr.children.length < 2) return;
        if (td.scrollWidth > td.clientWidth + 1) {
          kire++;
          if (kireta.length < 3) kireta.push(td.textContent.trim());
        }
      });
      return { haba, kire, kireta, gyou: b.querySelectorAll('tr').length };
    },
    [thead, tbody]
  );
}

// ★見る 表★＝先頭が 時の 列（年／月／日）の 物だけ
//   ★月ごとの 3つは タブで 切り替わる★＝選ばないと display:none で 幅が 0に なる
//   （[[feedback_hakaru_dougu_ga_kaeshita_0_wo_shinjiruna]] ★「0」を 緑に しない★）
const HYOU = [
  ['thead', 'tbody', '月ごと・売上', '#segUri'],
  ['thead3', 'tbody3', '月ごと・給料', '#segKyu'],
  ['thead2', 'tbody2', '月ごと・会社に残る分', '#segNokori'],
  ['uriHead', 'uriBody', '売上（年/月/日）', null],
  ['kyoriHead', 'kyoriBody', '距離（年/月/日）', null],
  ['dkHead', 'dkBody', '電子決済', null],
];

const SEMAI = 50; // ★月の 列は ここより 細い★（44px + 枠/余白）

test('★「月」の 列が 金額の 列より ★細い★（余白を 他に 渡している）★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page);

  const mita = [];
  for (const [th, tb, na, seg] of HYOU) {
    if (seg) {
      await page.locator(seg).click();
      await page.waitForTimeout(250);
    }
    const r = await hakaru(page, th, tb);
    // eslint-disable-next-line no-console
    console.log('★' + na + '★ ' + JSON.stringify(r));
    expect(r, '★' + na + ' の 表が 見つかりません（id が 変わった）★').not.toBeNull();
    expect(r.haba.length, '★' + na + ' の 列が 数えられていません★').toBeGreaterThan(1);
    mita.push([na, r]);

    expect(
      r.haba[0],
      '★' + na + '：月の 列が ' + r.haba[0] + 'px＝まだ 余白が あります★'
    ).toBeLessThanOrEqual(SEMAI);
    // ★他の 列に 幅が 渡っているか★（司さんの「他に幅を与えろ」）
    const hoka = Math.min(...r.haba.slice(1));
    expect(
      hoka,
      '★' + na + '：月の 列(' + r.haba[0] + ') より 細い 列(' + hoka + ') が あります★'
    ).toBeGreaterThan(r.haba[0]);
    // ★詰めた せいで 字が 切れていない★
    expect(
      r.kire,
      '★' + na + '：先頭の 升目で 字が 切れています ' + JSON.stringify(r.kireta) + '★'
    ).toBe(0);
  }

  // ★0個の 表を 見て 緑に していない★（[[feedback_hakaru_dougu_ga_kaeshita_0_wo_shinjiruna]]）
  expect(mita.length, '★1つも 測れていません★').toBe(HYOU.length);
  expect(err, '★画面が 落ちています★').toEqual([]);
});

test('★年ごと／日ごと に 切り替えても 字が 切れない（2026年・31日）★', async ({ page }) => {
  await hiraku(page);

  // ★距離：年 ⇒ 先頭は「2026年」（一番 長い）★
  await page.locator('[data-kyori="year"]').click();
  await page.waitForTimeout(400);
  let r = await hakaru(page, 'kyoriHead', 'kyoriBody');
  // eslint-disable-next-line no-console
  console.log('★距離・年★ ' + JSON.stringify(r));
  expect(r.kire, '★「2026年」が 切れています★').toBe(0);
  expect(r.haba[0], '★年の 列が 太すぎます★').toBeLessThanOrEqual(SEMAI);

  // ★距離：日ごと（1月を 押してから）★
  await page.locator('[data-kyori="month"]').click();
  await page.waitForTimeout(300);
  // ★日ごとの 月は 「月ごと」の 表の 行を 押して 決める★（shukei-kyori.spec.js と 同じ 道）
  await page.locator('#segUri').click();
  await page.waitForTimeout(200);
  await page.locator('#tbody [data-m="1"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-kyori="day"]').click();
  await page.waitForTimeout(400);
  r = await hakaru(page, 'kyoriHead', 'kyoriBody');
  // eslint-disable-next-line no-console
  console.log('★距離・日ごと★ ' + JSON.stringify(r));
  expect(r.gyou, '★日ごとの 行が 1つも 出ていません★').toBeGreaterThan(1);
  expect(r.kire, '★日の 升目が 切れています★').toBe(0);

  // ★売上：年★
  await page.locator('[data-uri="year"]').click();
  await page.waitForTimeout(400);
  r = await hakaru(page, 'uriHead', 'uriBody');
  // eslint-disable-next-line no-console
  console.log('★売上・年★ ' + JSON.stringify(r));
  expect(r.kire, '★売上の「2026年」が 切れています★').toBe(0);
});
