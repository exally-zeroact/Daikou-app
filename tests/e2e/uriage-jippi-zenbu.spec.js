// ============================================================
// ★★実費は 入れた 物を 全部 売上から 引く★★ 2026-10-24（件J）
//   司さん「実費は足したもの全て引く形やないと経費の意味ないやないか」
//   ＝08-01 の「引く 物を 選べる」形（dk_sales_settings の deduct_*）と 10-18 の「何日から」（dk_uriage_rireki）を やめた。
//   （前の 見張り tests/e2e/uriage-rireki.spec.js は 選ぶ 形が 無くなったので 外した）
//
//   ★物差し★
//     ① 売上表：前の 設定（その他を 引かない）・記録（1/6 から 高速を 引かない）が 倉庫に 在っても
//        紙は 入れた 実費 全部（5,000）を 引いた 売上（60,000）。選ぶ 欄（チェック・何日から・記録）は 無い。
//        設定・記録の 表は 読まない（読む 口が 0）。
//     ② 売上表：設定・記録の 表が 読めなくても 止めない（もう 読まない＝止める 訳が 無い）
//     ③ 給料：記録（何日から）が 在っても 実費は 全部 引く（記録 無しと 同じ 額）・読めなくても 止めない
//     ④ 月次：記録が 読めなくても 売上を 出す
//
//   ★わざと壊して 赤に なるのを 見た（2026-10-24 手元 chromium 実測）★
//     直す 前の js・uriage.html・kyuryo.html・shukei.html（ced1bc49e）に 戻す ⇒ ★赤 4 / 4★
//     （① 紙が 62,000＝その他と 1/6 の 高速を 引かない 額／② 紙が 出ない／③ 記録で 給料が 変わる／④ 止めの 字）
//     直した 後 ⇒ 緑 4 / 4
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { openKyuryo } = require('./kyuryo-harness');

const CO = '11111111-2222-3333-4444-555555555555';
test.use({ timezoneId: 'Asia/Tokyo' });

const SHIFTS = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-01-05T20:00:00+09:00',
    fare_total_yen: 40000,
    trip_count: 12,
    actual_total_m: 80000,
    total_distance_m: 150000,
  },
  {
    shift_id: 's2',
    device_id: 'd2',
    started_at: '2026-01-06T20:00:00+09:00',
    fare_total_yen: 25000,
    trip_count: 8,
    actual_total_m: 50000,
    total_distance_m: 90000,
  },
];
// 高速代 3,000（1/5）と 1,000（1/6）・その他 1,000（1/6）＝入れた 実費は 全部で 5,000
const EDITS = [
  { shift_id: 's1', toll_yen: 3000, bridge_yen: 0, other_yen: 0 },
  { shift_id: 's2', toll_yen: 1000, bridge_yen: 0, other_yen: 1000 },
];
const LABELS = [
  { device_id: 'd1', label: '4987', sort_order: 1 },
  { device_id: 'd2', label: '1466', sort_order: 2 },
];

function tsukuru(o) {
  const x = o || {};
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  const hyou = {
    dk_shifts: SHIFTS,
    dk_shift_edits: EDITS,
    dk_device_labels: LABELS,
    // ★前の 形の 設定・記録を わざと 置く★（その他を 引かない・1/6 から 高速代を 引かない）＝読まれたら 数が 変わる
    dk_sales_settings: [
      // kaisha_shime_hi＝会社の 締め日（件K 2026-10-24・null＝末日）＝売上表は この 列だけ 読む（deduct_* は 見ない）
      {
        company_id: CO,
        deduct_toll: true,
        deduct_bridge: true,
        deduct_other: false,
        kaisha_shime_hi: null,
      },
    ],
    dk_uriage_rireki: [{ rireki_id: 'u1', key: 'toll', from_date: '2026-01-06', value: false }],
  };
  return (
    moto +
    ';(function(){var S=window.DKSession;var co=' +
    JSON.stringify(co) +
    ';var T=' +
    JSON.stringify(hyou) +
    ';var YOMENAI=' +
    JSON.stringify(x.yomenai || []) +
    ';var KAKENAI=' +
    JSON.stringify(x.kakenai || []) +
    ';window.__okutta=[];window.__yonda=[];' +
    'function rows(p){var na=String(p).split("?")[0];return T[na]||[];}' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    // 書いた 物は 覚えて、返った 行は 1件（POST・PATCH・DELETE）
    'S.rest=function(s,p,o){var m=(o&&o.method)||"GET";if(m!=="GET"){var b=null;try{b=JSON.parse(o.body);}catch(_){}window.__okutta.push({p:String(p),m:m,b:b});if(KAKENAI.some(function(k){return String(p).indexOf(k)===0;}))return Promise.resolve({ok:false,status:500,json:function(){return Promise.resolve({});}});return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve([Object.assign({rireki_id:"n1"},b||{})]);}});}window.__yonda.push(String(p));return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){window.__yonda.push(String(p));if(st)st.tried++;if(YOMENAI.some(function(n){return String(p).indexOf(n)===0;})){if(st)st.failed++;return Promise.resolve([]);}return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page, o) {
  await page.clock.setFixedTime(new Date('2026-01-20T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(o),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/uriage.html', { waitUntil: 'domcontentloaded' });
}
const kamiJi = async (page) => {
  const kami = page.locator('#kamiMado .kami-mise-waku');
  await expect(kami.first(), '★紙が 出ない★').toBeVisible({ timeout: 15000 });
  return ((await kami.first().textContent()) || '').replace(/\s+/g, ' ');
};
const yen = (v) => v.toLocaleString('ja-JP');
const okutta = (page) => page.evaluate(() => window.__okutta);

test('① 売上表：前の 設定・記録が 在っても 入れた 実費は 全部 引く・選ぶ 欄は 無い', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page, {});
  const ji = await kamiJi(page);
  // eslint-disable-next-line no-console
  console.log('★①★ ' + ji.slice(0, 200));
  // (40000−3000)+(25000−1000−1000)＝60,000／実費 5,000
  expect(ji, '★入れた 実費が 全部 引かれていない★').toContain(yen(60000));
  expect(ji).toContain(yen(5000));
  // その他を 引かない 設定の 額（61,000）・記録で 高速を 引かない 額（61,000／62,000）は 出ない
  expect(ji).not.toContain(yen(61000));
  expect(ji).not.toContain(yen(62000));
  const r = await page.evaluate(() => ({
    eran: ['dToll', 'dBridge', 'dOther', 'dHi', 'dRireki', 'dRirekiWaku', 'dChui'].filter((id) =>
      document.getElementById(id)
    ),
    chk: document.querySelectorAll('.setrow input').length,
    na: document.getElementById('dHiku').textContent,
    yonda: window.__yonda.filter(
      // dk_sales_settings は 件K（会社の 締め日）で 読む＝もう 使わないのは 記録の 表だけ（引く 額は 上の 数で 縛る）
      (p) => p.indexOf('dk_uriage_rireki') === 0
    ),
  }));
  expect(r.eran, '★選ぶ 欄が 残っている★').toEqual([]);
  expect(r.chk, '★引く 物の 行に 押せる 欄が 在る★').toBe(0);
  expect(r.na).toContain('その他');
  expect(r.yonda, '★もう 使わない 表を 読んでいる★').toEqual([]);
  expect(await okutta(page)).toEqual([]);
  expect(err).toEqual([]);
});

test('② 売上表：記録の 表が 読めなくても 止めない（設定の 表が 読めない 時は 会社の 締め日で 止める＝引く 物の 訳では ない）', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page, { yomenai: ['dk_uriage_rireki'] });
  const ji = await kamiJi(page);
  expect(ji).toContain(yen(60000));
  expect(await page.textContent('#err')).not.toContain('売上から 引く 物');
  expect(err).toEqual([]);
});

// 件K（2026-10-24）：dk_sales_settings は 会社の 締め日（kaisha_shime_hi）の 為に 読む。読めない 時は 末日に 倒さず 止める
//   （止める 訳は 締め日＝「売上から 引く 物」の 字は 出さない・引く 額は 件J の まま 全部）
test('②b 売上表：設定の 表が 読めない ⇒ 会社の 締め日で 止める（引く 物の 訳は 出さない）', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.clock.setFixedTime(new Date('2026-01-20T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru({ yomenai: ['dk_sales_settings'] }),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/uriage.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => /出せません/.test(document.getElementById('kamiMsg').textContent),
    null,
    {
      timeout: 15000,
    }
  );
  const e = await page.textContent('#err');
  expect(e).toContain('締め日');
  expect(e).not.toContain('売上から 引く 物');
  expect(err).toEqual([]);
});

test('③ 給料：記録（何日から）が 在っても・読めなくても 実費は 全部 引く', async ({ page }) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  const TAKAI = (f) => {
    // 全部の 業務に 高速代 1,000・最低保証 0（歩合だけで 額が 決まる）
    f.edits = (f.shifts || []).map((s) => ({ shift_id: s.shift_id, toll_yen: 1000 }));
    Object.keys(f.settings[0].roles).forEach((r) => (f.settings[0].roles[r].floor = 0));
    f.emps = f.emps.map((e) => Object.assign({}, e, { pay_floor: null }));
    return f;
  };
  const kyu = (p) =>
    p.evaluate(() =>
      window.__paper
        .emp(0)
        .cells.filter((c) => c.pay > 0)
        .map((c) => ({ d: c.date, pay: c.pay }))
    );
  await openKyuryo(page, TAKAI);
  const moto = await kyu(page);
  expect(moto.length, '★働いた 日が 2日 要る★').toBeGreaterThanOrEqual(2);
  // 実費が 引かれている（高速代を 入れない 時より 少ない）
  const p0 = await page.context().newPage();
  p0.on('pageerror', (x) => err.push(x.message));
  await openKyuryo(p0, (f) => {
    TAKAI(f);
    f.edits = [];
    return f;
  });
  const nashi = await kyu(p0);
  expect(moto[0].pay, '★高速代が 引かれていない★').toBeLessThan(nashi[0].pay);
  // 記録（2日目から 高速を 引かない）が 在っても 同じ 額
  const p2 = await page.context().newPage();
  p2.on('pageerror', (x) => err.push(x.message));
  await openKyuryo(p2, (f) => {
    TAKAI(f);
    f.uriageRireki = [{ rireki_id: 'u1', key: 'toll', from_date: moto[1].d, value: false }];
    return f;
  });
  expect(await kyu(p2), '★記録で 実費が 変わった★').toEqual(moto);
  // 記録・設定の 表が 読めなくても 止めない
  const p3 = await page.context().newPage();
  p3.on('pageerror', (x) => err.push(x.message));
  await openKyuryo(p3, (f) => {
    TAKAI(f);
    f.__yomenai = ['dk_uriage_rireki', 'dk_sales_settings'];
    return f;
  });
  expect(await kyu(p3)).toEqual(moto);
  const ji = await p3.evaluate(() => document.body.innerText);
  expect(ji).not.toContain('売上から 引く 物の 変えた 記録を 読めませんでした');
  expect(err).toEqual([]);
});

// 件K（2026-10-24）：設定の 表（dk_sales_settings）は 会社の 締め日で 読む＝読めない 時は 末日に 倒さず 止める（④b）
//   ④ は 記録の 表だけ 読めない 形（売上は 出す）
for (const [na, yomenai, deru] of [
  ['④ 月次：記録の 表が 読めなくても 売上を 出す', ['dk_uriage_rireki'], true],
  [
    '④b 月次：設定の 表が 読めない ⇒ 会社の 締め日で 止める（引く 物の 訳は 出さない）',
    ['dk_sales_settings'],
    false,
  ],
])
  test(na, async ({ page }) => {
    const err = [];
    page.on('pageerror', (e) => err.push(e.message));
    const FIX = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
    );
    const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
    const co = { company_id: FIX.settings[0].company_id, name: '見張り用' };
    const body =
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
      'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
      'var YOMENAI=' +
      JSON.stringify(yomenai) +
      ';S.softList=function(s,p,st){if(st)st.tried++;if(YOMENAI.some(function(n){return String(p).indexOf(n)===0;})){if(st)st.failed++;return Promise.resolve([]);}return Promise.resolve(rows(p));};})();';
    await page.route('**/js/dk-session.js*', (r) =>
      r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: body })
    );
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#motoHyou > summary').click({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.locator('[data-uri="month"]').click();
    await page.waitForTimeout(200);
    const ji = await page.evaluate(() => document.getElementById('uriBody').textContent);
    if (deru) expect(ji, '★売上が 出ていない★').toMatch(/\d{1,3},\d{3}/);
    else {
      expect(ji, '★締め日が 読めないのに 暦の 月で 売上を 出した★').not.toMatch(/\d{1,3},\d{3}/);
      expect(ji).toContain('締め日');
    }
    expect(ji).not.toContain('売上から 引く 物');
    expect(err).toEqual([]);
  });
