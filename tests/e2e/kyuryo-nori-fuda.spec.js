// ============================================================
// 乗った人は いつも 札・2人で 札を 消す 2026-10-19（司さん）
//
//   司さんの言葉
//     「最初だけ選ぶで人選ぶけど2人からこの選び方になってるのはなぜ？
//      これなら最初から見せて2人選んだら消えるようにしろや、
//      間違えて選んだら右の✖️押したらまた人が選べるようにしろ」
//
//   前は 残っている 人が 9人 以上だと「選ぶ」の 箱、8人 以下で 札だった
//   （9人の 会社で 1人 選ぶと 形が 変わった）。
//   守る 事：
//     ①残りが 9人 以上でも 札だけ（選ぶ 箱は 0）
//     ②その 車の 乗った人が 2人に なったら 札を 出さない
//     ③1人の 車には 札が 出る・2人の 車で ✕ を 押して 1人に すると 札が 戻る
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const F0 = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = F0.settings[0].company_id;
const CAR1 = '00000000-0000-4000-9000-000000000001';
const CAR2 = '00000000-0000-4000-9000-000000000002';
const TARO = 'ec8d275b-38c0-4d9f-b471-eeb10226a6a9';
const JIRO = '46a60d53-02b7-47ef-829e-6fd03cee1a31';
const SABURO = 'd5d0c7da-4b13-455a-92e4-462137f4424c';

function fixture(tweak) {
  const F = JSON.parse(JSON.stringify(F0));
  // 8/1 1号車：2回目の 勤務（1時間）を 足す＝車の 時間は 9 + 1 = 10
  F.shifts.push({
    shift_id: '00000000-0000-4000-a000-000000000009',
    device_id: CAR1,
    started_at: '2026-08-01 05:00:00+00', // 日本の 14時＝8/1
    ended_at: '2026-08-01 06:00:00+00',
    elapsed_sec: 3600,
    fare_total_yen: 1000,
    trip_count: 1,
  });
  // 8/1 太郎＝自分の 時間を 空に（車と同じ）
  F.workHours.forEach((w) => {
    if (w.work_date === '2026-08-01' && w.employee_id === TARO) w.hours = 0;
  });
  // 8/2 2号車（手入力・時間 0）に 次郎を 乗せる（時間 空）
  F.workHours.push({
    company_id: CO,
    work_date: '2026-08-02',
    employee_id: JIRO,
    device_id: CAR2,
    hours: 0,
  });
  if (tweak) tweak(F);
  return F;
}

function sess(F) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: 'ZERO代行' };
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(F) +
    ';var co=' +
    JSON.stringify(co) +
    ';window.__calls=[];' +
    'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){var m=(o&&o.method)||"GET";if(m!=="GET")window.__calls.push({p:p,m:m,b:o&&o.body?JSON.parse(o.body):null});' +
    'return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page, opt) {
  const o = opt || {};
  const F = fixture(o.tweak);
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: sess(F),
    })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 900 });
  // 時計を 止める（今日の 日付に 頼らない）＝日本の 2026-08-05 12時
  await page.clock.setFixedTime(new Date('2026-08-05T03:00:00Z'));
  await page.goto('/kyuryo.html#hours', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const b = document.querySelector('.tab[data-tab="hours"]');
    if (b && b.onclick) b.onclick();
  });
  // 8月（材料の 月）へ
  for (let i = 0; i < 12; i++) {
    const t = await page.locator('#monthLabel').textContent();
    if (/8月/.test(t || '')) break;
    await page.click('#prevM');
    await page.waitForTimeout(500);
  }
  await expect(page.locator('#monthLabel')).toContainText('8月');
  await page.waitForTimeout(500);
  if (o.ichinichi) return;
  // 期間を 全部 見る（既定は 1日ずつ）
  await page.click('#hiZen');
  await page.waitForTimeout(300);
}

function hi(page, d) {
  return page.locator('#days .day[data-date="' + d + '"]');
}

// 今 いる 人を 8人 足す（3人 ＋ 8人 ＝ 11人）
function ooi(F) {
  for (let i = 0; i < 8; i++) {
    F.emps.push({
      employee_id: '00000000-0000-4000-b000-00000000000' + i,
      company_id: CO,
      name: 'テスト足し' + (i + 1),
      role: F.emps[0].role,
      active: true,
      sort_order: 100 + i,
    });
  }
}

test('残りが 9人 以上でも 札だけ・2人 乗った 車には 札を 出さない', async ({ page }) => {
  await hiraku(page, { tweak: ooi });
  // ① 選ぶ 箱は どの 日にも 無い
  await expect(page.locator('#days select[data-add-date]')).toHaveCount(0);

  // ③ 8/1 2号車は 次郎 1人＝札が 出る。8/1 に まだ 乗っていない 人＝11 − 2（太郎・次郎）＝9人
  const d1 = hi(page, '2026-08-01');
  await expect(d1.locator('[data-chip-dev="' + CAR2 + '"][data-chip-emp]')).toHaveCount(9);

  // ② 8/2 1号車は 太郎・三郎の 2人＝札を 出さない
  const d2 = hi(page, '2026-08-02');
  await expect(d2.locator('[data-wh-dev="' + CAR1 + '"]')).toHaveCount(2);
  await expect(d2.locator('[data-chip-dev="' + CAR1 + '"]')).toHaveCount(0);
});

test('2人の 車で ✕ を 押して 1人に すると 札が 戻る', async ({ page }) => {
  await hiraku(page, { tweak: ooi });
  const d2 = hi(page, '2026-08-02');
  await expect(d2.locator('[data-chip-dev="' + CAR1 + '"]')).toHaveCount(0);
  await d2.locator('[data-del-emp="' + SABURO + '"]').click();
  // 外した 人の 消す 要求が 出て、1人に なった 車に 札が 戻る（8/2 に まだ 乗っていない 人＝11 − 2（太郎・次郎）＝9人）
  await expect(d2.locator('[data-wh-dev="' + CAR1 + '"]')).toHaveCount(1);
  await expect(d2.locator('[data-chip-dev="' + CAR1 + '"][data-chip-emp]')).toHaveCount(9);
  const del = await page.evaluate(() =>
    window.__calls.filter((c) => c.p.indexOf('dk_work_hours') === 0 && c.m === 'DELETE')
  );
  expect(del.length).toBeGreaterThan(0);
});
