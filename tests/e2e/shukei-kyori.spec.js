// ============================================================
// ★★月次集計の「距離」（年間／月ごと／日ごと）★★ 2026-09-05（司さん）
//
//   ★司さんの言葉★
//     「★Excelの 代行計算表2026の 距離の シートのように
//        回数、総走行距離、実車距離は どこに いれてる？★」
//     「★年間と 月ごと 日ごと 同じように 集計の 距離の 中でも
//        ボタンで 切り替えて 見れるようにして★」「★回数もど★」
//
//   ★実物の Excel「距離」シート（2026-09-05 実測）★
//     上 … 回数 4,254 ／ 実車距離 28,780.1 ／ 総距離 64,181.7（年の 合計）
//     下 … 日付・回数・実車距離・総距離 を 月ごとに 横へ 12か月ぶん
//   ⇒ ★同じ 3つ★を 年間／月ごと／日ごと で 出す
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-05 実測）★★
//     ①回数の 列を 出さない ……………… ★赤★
//     ②実車距離に 総走行距離を 入れる … ★赤★（年と 月と 日の 合計が 食い違う）
//     ③切り替えボタンを 消す …………… ★赤★
//     戻した後 … ★緑★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// ★本物と 同じ 形の 見本★（2つの 月に またがる／除外が 1本 混ざる）
const CO = '11111111-2222-3333-4444-555555555555';
const SHIFTS = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-01-02T10:00:00+09:00',
    ended_at: '2026-01-02T18:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 20000,
    trip_count: 18,
    actual_total_m: 106700,
    total_distance_m: 218000,
  },
  {
    shift_id: 's2',
    device_id: 'd1',
    started_at: '2026-01-03T10:00:00+09:00',
    ended_at: '2026-01-03T18:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 21000,
    trip_count: 14,
    actual_total_m: 127700,
    total_distance_m: 257600,
  },
  {
    shift_id: 's3',
    device_id: 'd2',
    started_at: '2026-02-02T10:00:00+09:00',
    ended_at: '2026-02-02T18:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 9000,
    trip_count: 9,
    actual_total_m: 104400,
    total_distance_m: 204000,
  },
];
// ★答え（手で 足した）★
const KOTAE = {
  kaisuu: 18 + 14 + 9,
  jissha: (106700 + 127700 + 104400) / 1000,
  sou: (218000 + 257600 + 204000) / 1000,
};

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

function yomu(page) {
  return page.evaluate(() => {
    const head = [...document.querySelectorAll('#kyoriHead th')].map((x) => x.textContent.trim());
    const rows = [...document.querySelectorAll('#kyoriBody tr')].map((tr) =>
      [...tr.children].map((td) => td.textContent.trim())
    );
    return { head: head, rows: rows };
  });
}

test('★年間／月ごと／日ごと で 切り替わり、合計は どれも 同じ★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page);

  // ★出だしは 月ごと★
  let r = await yomu(page);
  console.log('★月ごと★ 見出し ' + JSON.stringify(r.head));
  expect(r.head, '★Excel と 同じ 3つが ありません★').toEqual([
    '月',
    '回数',
    '実車距離',
    '総走行距離',
  ]);
  expect(r.rows.length, '★12ヶ月ぶん 出ていません★').toBe(13); // 12ヶ月 + 合計
  const tsuki1 = r.rows.find((x) => x[0] === '1月');
  console.log('★1月★ ' + JSON.stringify(tsuki1));
  expect(tsuki1[1], '★1月の 回数が 違います★').toBe(String(18 + 14));
  expect(tsuki1[2], '★1月の 実車距離が 違います★').toBe('234.4 km');
  expect(tsuki1[3], '★1月の 総走行距離が 違います★').toBe('475.6 km');

  const gou = (x) => x[x.length - 1];
  const mGou = gou(r.rows);
  console.log('★月ごとの 合計★ ' + JSON.stringify(mGou));
  expect(mGou[1], '★合計の 回数が 違います★').toBe(String(KOTAE.kaisuu));
  expect(mGou[2], '★合計の 実車距離が 違います★').toBe(KOTAE.jissha.toFixed(1) + ' km');
  expect(mGou[3], '★合計の 総走行距離が 違います★').toBe(KOTAE.sou.toFixed(1) + ' km');

  // ★年間★
  await page.locator('[data-kyori="year"]').click();
  await page.waitForTimeout(400);
  r = await yomu(page);
  console.log('★年間★ ' + JSON.stringify(r.rows));
  expect(r.head[0], '★見出しが 年に なっていません★').toBe('年');
  expect(r.rows[0][1], '★年の 回数が 違います★').toBe(String(KOTAE.kaisuu));
  expect(r.rows[0][2], '★年の 実車距離が 違います★').toBe(KOTAE.jissha.toFixed(1) + ' km');
  expect(r.rows[0][3], '★年の 総走行距離が 違います★').toBe(KOTAE.sou.toFixed(1) + ' km');

  // ★★日ごとは 1ヶ月ぶんだけ★★ 2026-09-05（司さん「日毎は 1ヶ月分だけに しろや」）
  //   ★前は 1年ぶん 出していた★（実測 336日＝表 13,787px＝★画面 20枚ぶん★）
  //   ⇒ ★上の「月ごと」で 押した 月★の 日数だけ 出す
  //   ⇒ 押していない 時は ★今の 月★（この 見本には 記録が 無いので 0件と 言う）
  await page.locator('[data-kyori="day"]').click();
  await page.waitForTimeout(400);
  r = await yomu(page);
  console.log('★日ごと（月を 押す前）★ ' + JSON.stringify(r.rows));
  expect(r.rows[0][0], '★0件を 黙って 空に しています★').toContain('0件');

  // ★1月の 行を 押す ⇒ 日ごとも 1月に なる★
  await page.locator('#tbody tr[data-m="1"]').click();
  await page.waitForTimeout(500);
  r = await yomu(page);
  console.log('★日ごと（1月）★ ' + JSON.stringify(r));
  expect(r.head[0], '★見出しに 月が 出ていません★').toBe('1月の 日');
  expect(r.rows.length, '★1月に 走った 日の 数が 違います★').toBe(2 + 1); // 2日 + 合計
  expect(r.rows[0][0], '★日付の 出し方が 違います★').toBe('02日');
  expect(r.rows[0][1], '★1/2 の 回数が 違います★').toBe('18');
  expect(r.rows[0][2], '★1/2 の 実車距離が 違います★').toBe('106.7 km');
  expect(r.rows[0][3], '★1/2 の 総走行距離が 違います★').toBe('218.0 km');

  // ★★合計は「出している 分」と 同じ★★（年の 合計を 出すと 足し算が 合わない）
  const dGou = gou(r.rows);
  expect(dGou[1], '★1月の 合計の 回数が 違います★').toBe(String(18 + 14));
  expect(dGou[2], '★1月の 合計の 実車距離が 違います★').toBe('234.4 km');
  expect(dGou[3], '★1月の 合計の 総走行距離が 違います★').toBe('475.6 km');

  expect(err, '★画面が 落ちました★').toEqual([]);
  // ★★多い時は 箱の 中で スクロール★★ 2026-09-05（司さん）
  //   「それを 多いけん スクロールして 見せるようにしろ」
  //   ★ページを 伸ばさない★＝下の 帯や 他の 箱が 遠くへ 行かない
  const sc = await page.evaluate(() => {
    const box = document.querySelector('.kyori-sc');
    const t = document.getElementById('kyoriTbl');
    const cs = getComputedStyle(box);
    const th = box.querySelector('thead th');
    return {
      overflowY: cs.overflowY,
      hakoH: Math.round(box.getBoundingClientRect().height),
      hyouH: Math.round(t.getBoundingClientRect().height),
      mado: window.innerHeight,
      thKotei: th ? getComputedStyle(th).position : null,
    };
  });
  console.log('★スクロール★ ' + JSON.stringify(sc));
  expect(sc.overflowY, '★縦に スクロールしません★').toBe('auto');
  expect(sc.hakoH, '★箱が 窓より 大きい（ページが 伸びます）★').toBeLessThan(sc.mado);
  expect(sc.thKotei, '★見出しが 貼り付いていません★').toBe('sticky');

  await page.locator('#kyoriTbl').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: 'C:/Users/zeroa/dk-tokei-2026-09-02/tokei/shot-kyori.png',
  });
});

test('★押した ボタンが どれか 分かる★', async ({ page }) => {
  await hiraku(page);
  const ima = () =>
    page.evaluate(() => {
      const b = document.querySelector('[data-kyori][aria-current]');
      return b ? b.getAttribute('data-kyori') : null;
    });
  expect(await ima(), '★出だしが 月ごとで ありません★').toBe('month');
  await page.locator('[data-kyori="year"]').click();
  await page.waitForTimeout(300);
  expect(await ima(), '★年間に なっていません★').toBe('year');
  await page.locator('[data-kyori="day"]').click();
  await page.waitForTimeout(300);
  expect(await ima(), '★日ごとに なっていません★').toBe('day');

  // ★★色でも 分かる事を 数える★★ 2026-09-05
  //   ★絵を 開いたら 3つとも 同じ 色だった★（この画面には 薄い 見た目が 無かった）
  //   ⇒ ★選ばれている 物と いない 物で 背景が 違う事★を 機械で 見る
  const iro = await page.evaluate(() =>
    [...document.querySelectorAll('[data-kyori]')].map((b) => ({
      m: b.getAttribute('data-kyori'),
      on: b.hasAttribute('aria-current'),
      bg: getComputedStyle(b).backgroundColor,
    }))
  );
  console.log('★ボタンの 色★ ' + JSON.stringify(iro));
  const erabareta = iro.filter((x) => x.on).map((x) => x.bg);
  const sonota = iro.filter((x) => !x.on).map((x) => x.bg);
  expect(erabareta.length, '★選ばれている 物が 1つでは ありません★').toBe(1);
  expect(
    sonota.filter((x) => x === erabareta[0]),
    '★選ばれている 物と 同じ 色の ボタンが あります（見分けが つきません）★'
  ).toEqual([]);
});

// ★★行が 多い時に 箱の 中で 止まるか★★ 2026-09-05（司さん）
//   「それを 多いけん スクロールして 見せるようにしろ」
//   ★上の 見本は 3日ぶんで 元から 窓に 収まる★ので 別に 1ヶ月ぶんで 見る
//   ★実測（直す前）★ 1ヶ月＝29行で 表 1,222px ⇒ ページ 5.4画面
//   ★★わざと壊して 赤に なる事を 見た★★ … max-height を none に する ⇒ ★赤★
test('★1ヶ月ぶんでも 箱の 中で 止まる★', async ({ page }) => {
  const HITOTSUKI = [];
  for (let d = 1; d <= 28; d++) {
    const dd = (d < 10 ? '0' : '') + d;
    HITOTSUKI.push({
      shift_id: 's' + dd,
      device_id: 'd1',
      started_at: '2026-01-' + dd + 'T10:00:00+09:00',
      ended_at: '2026-01-' + dd + 'T18:00:00+09:00',
      elapsed_sec: 28800,
      fare_total_yen: 20000,
      trip_count: 18,
      actual_total_m: 106700,
      total_distance_m: 218000,
    });
  }
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  const t =
    moto +
    ';(function(){var S=window.DKSession;var co=' +
    JSON.stringify(co) +
    ';var SH=' +
    JSON.stringify(HITOTSUKI) +
    ';' +
    'function rows(p){ if(p.indexOf("dk_shifts")===0)return SH; return [];}' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: t })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#kyoriTbl').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.locator('#tbody tr[data-m="1"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-kyori="day"]').click();
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const box = document.querySelector('.kyori-sc');
    const t2 = document.getElementById('kyoriTbl');
    box.scrollTop = 99999;
    return {
      gyou: document.querySelectorAll('#kyoriBody tr').length,
      hakoH: Math.round(box.getBoundingClientRect().height),
      hyouH: Math.round(t2.getBoundingClientRect().height),
      sukuroru: box.scrollTop > 0,
      page: Math.round(document.body.scrollHeight),
      mado: window.innerHeight,
    };
  });
  console.log('★1ヶ月ぶん★ ' + JSON.stringify(r) + ' ＝ ' + (r.page / r.mado).toFixed(1) + '画面');
  expect(r.gyou, '★1ヶ月ぶん 出ていません★').toBe(29);
  expect(r.hyouH, '★表が 短すぎます（見本が 効いていません）★').toBeGreaterThan(1000);
  expect(r.hakoH, '★箱が 窓より 大きい（ページが 伸びます）★').toBeLessThan(r.mado);
  expect(r.sukuroru, '★中で スクロールしません★').toBe(true);
});
