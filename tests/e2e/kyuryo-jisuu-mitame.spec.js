// ============================================================
// 時数を入れる＝代行請求書の「明細一覧」と同じ形 2026-10-14（司さん）
//
//   司さんの言葉
//     「給料の入力するとこやけどごちゃごちゃしすぎやろが」
//     「代行請求書と統一感だせよ」
//
//   形を変えた時に 対立役が 挙げた 穴を 守る：
//     ①乗った人の 欄が 空の 時の「車と同じ ○h」は 計算が 使う 数（同じ 車で 2回 働いた 日は 足した 数）
//     ②車の 時間が 0 の 時は「給料は出ません」と出す（計算は その人の 行を 作らない）
//     ③同じ 車で 2回 働いた 日も 乗った人は 1回だけ 出る
//     ④乗った人の 札＝選ぶ箱と 同じ 中身で 保存する・保存中は 札を 押せない
//     ⑤手入力の 車を 消す 時は 確かめる（取り消したら 消さない）
//     ⑥日ごとの 箱に data-date（日を 選んだ 時に 1日だけ 出るかを 数える 目印）
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

test('乗った人が 空なら 計算と 同じ「車と同じ」・2回 働いた 日も 1回だけ・車が 0h なら 警告', async ({
  page,
}) => {
  await hiraku(page);

  // ⑥ 日ごとの 箱が 期間の 日の 数だけ（1〜10日）
  await expect(page.locator('#days .day[data-date]')).toHaveCount(10);

  const d1 = hi(page, '2026-08-01');
  // ③ 太郎は 8/1 に 1回だけ（1号車が 2回 働いても）
  await expect(d1.locator('.crewrow', { hasText: 'テスト太郎' })).toHaveCount(1);
  // 1号車の 時間の 欄は 勤務ごとに 2つ
  await expect(d1.locator('[data-dev="' + CAR1 + '"][data-sid]')).toHaveCount(2);
  // ① 計算が 使う 数＝9 + 1 = 10（勤務 1回 だけの 9 では ない）
  await expect(d1.locator('.crewrow', { hasText: 'テスト太郎' })).toContainText('車と同じ 10.00h');
  // 日の 時数 合計（車の 時間の 合計）にも 2回目が 入っている（1号車 9＋1 ＋ 2号車 7）
  await expect(d1.locator('.dhead .ds')).toContainText('17.00');

  // ② 8/2 2号車（手入力・時間 0）の 次郎＝給料が 出ない 事を 出す
  const d2 = hi(page, '2026-08-02');
  await expect(d2.locator('.crewrow', { hasText: 'テスト次郎' })).toContainText(
    '車の時間が0なので'
  );
  // 日の 時数 合計（車の 時間の 合計）＝1号車 9.5 ＋ 2号車 0
  await expect(d2.locator('.dhead .ds')).toContainText('9.50');

  // 何もない 日は 見出し 1行
  await expect(hi(page, '2026-08-05')).toHaveClass(/kara/);
});

test('乗った人の 札＝選ぶ箱と 同じ 中身で 保存・保存中は 札を 押せない', async ({ page }) => {
  await hiraku(page);
  const d1 = hi(page, '2026-08-01');
  const chip = d1.locator('[data-chip-dev="' + CAR2 + '"][data-chip-emp="' + SABURO + '"]');
  await expect(chip).toHaveCount(1);
  // 保存の 返事を 遅らせて 押せない 間を 見る
  await page.evaluate(() => {
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      const r = moto(s, p, o);
      return (o && o.method) === 'POST' ? new Promise((ok) => setTimeout(() => ok(r), 800)) : r;
    };
  });
  await chip.click();
  const dis = await page.evaluate(() =>
    [...document.querySelectorAll('[data-chip-emp]')].every((b) => b.disabled)
  );
  expect(dis, '保存中に 他の 札が 押せる').toBe(true);
  await page.waitForTimeout(1200);
  const calls = await page.evaluate(() => window.__calls);
  const wh = calls.filter((c) => c.p.indexOf('dk_work_hours') === 0 && c.m === 'POST');
  expect(wh).toHaveLength(1);
  expect(wh[0].b).toMatchObject({
    work_date: '2026-08-01',
    employee_id: SABURO,
    device_id: CAR2,
    hours: 0,
  });
  await expect(hi(page, '2026-08-01').locator('.crewrow', { hasText: 'テスト三郎' })).toHaveCount(
    1
  );
});

test('手入力の 車を 消す＝確かめる・取り消したら 消さない', async ({ page }) => {
  await hiraku(page);
  const kesu = hi(page, '2026-08-02').locator('[data-man-del-dev="' + CAR2 + '"]');
  await expect(kesu).toHaveText('この車を消す');
  let msg = '';
  page.once('dialog', (d) => {
    msg = d.message();
    d.dismiss();
  });
  await kesu.click();
  await page.waitForTimeout(300);
  expect(msg).toContain('乗った人 1人は 残ります');
  let del = await page.evaluate(() => window.__calls.filter((c) => c.m === 'DELETE').length);
  expect(del, '取り消したのに 消した').toBe(0);

  page.once('dialog', (d) => d.accept());
  await kesu.click();
  await page.waitForTimeout(500);
  del = await page.evaluate(() =>
    window.__calls.filter((c) => c.m === 'DELETE' && c.p.indexOf('dk_manual_days') === 0)
  );
  expect(del).toHaveLength(1);
});

test('既定は 今日（日本時間）・乗った人が 居ない 車の 日を 帯に 出し、押すと その日', async ({
  page,
}) => {
  await hiraku(page, {
    ichinichi: true,
    // 8/1 2号車の 次郎を 外す＝乗った人が 0人の 車（8/2 の 次郎も 外して 帯の 日を 1つに）
    tweak: (F) => {
      F.workHours = F.workHours.filter(
        (w) =>
          !(w.work_date === '2026-08-01' && w.employee_id === JIRO) &&
          !(w.work_date === '2026-08-02' && w.employee_id === JIRO)
      );
    },
  });
  await expect(page.locator('#hiSel')).toHaveValue('2026-08-05');
  await expect(page.locator('#days .day[data-date]')).toHaveCount(1);
  const obi = page.locator('#hibar .hizen');
  await expect(obi).toContainText('給料が出る人の居ない車');
  await expect(obi.locator('[data-nn-hi]')).toHaveCount(1);
  await obi.locator('[data-nn-hi="2026-08-01"]').click();
  await expect(page.locator('#hiSel')).toHaveValue('2026-08-01');
  const car2 = hi(page, '2026-08-01').locator('.carrow', { hasText: '2号車' });
  await expect(car2).toContainText('乗った人が 居ません');
});

test('入れ漏れの 無い 期間は「入れ漏れはありません」', async ({ page }) => {
  await hiraku(page, {
    ichinichi: true,
    // 8/2 2号車（売上0・時間0）の 次郎を 外す＝入れ漏れの 無い 期間
    tweak: (F) => {
      F.workHours = F.workHours.filter(
        (w) => !(w.work_date === '2026-08-02' && w.employee_id === JIRO)
      );
    },
  });
  await expect(page.locator('#hibar .hizen')).toContainText('乗った人の入れ漏れはありません');
});

test('車が 決まっていない 乗った人（車が 空）も 出る', async ({ page }) => {
  await hiraku(page, {
    tweak: (F) => {
      F.workHours.push({
        company_id: CO,
        work_date: '2026-08-03',
        employee_id: SABURO,
        device_id: '',
        hours: 3,
      });
    },
  });
  const d3 = hi(page, '2026-08-03');
  await expect(d3).not.toHaveClass(/kara/);
  await expect(d3.locator('.carrow', { hasText: '車が決まっていない人' })).toContainText(
    'どの車に 乗ったか 決まっていません'
  );
  await expect(d3.locator('.crewrow', { hasText: 'テスト三郎' })).toHaveCount(1);
});

test('札の 保存に 失敗したら 札が 押せる形に 戻る', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      if ((o && o.method) === 'POST')
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve('x'),
          json: () => Promise.resolve({}),
        });
      return moto(s, p, o);
    };
  });
  const chip = hi(page, '2026-08-01')
    .locator('[data-chip-dev="' + CAR2 + '"][data-chip-emp="' + SABURO + '"]')
    .first();
  await chip.click();
  await page.waitForTimeout(500);
  const dis = await page.evaluate(() =>
    [...document.querySelectorAll('[data-chip-emp]')].some((b) => b.disabled)
  );
  expect(dis, '失敗の 後も 札が 押せないまま').toBe(false);
});

test('車の 時間を 保存しても 実費は 消えず、高速代などは 送らない', async ({ page }) => {
  await hiraku(page, {
    tweak: (F) => {
      F.edits = [
        {
          shift_id: '00000000-0000-4000-a000-000000000002',
          company_id: CO,
          toll_yen: 500,
          bridge_yen: 0,
          other_yen: 0,
          expenses: { 駐車場: 300 },
          hours: null,
        },
      ];
    },
  });
  const d1 = hi(page, '2026-08-01');
  const mae = await d1.locator('.dhead .ds').textContent();
  await page.evaluate(() => {
    const i = document.querySelector('[data-sid="00000000-0000-4000-a000-000000000002"]');
    i.value = '6';
    i.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(600);
  const calls = await page.evaluate(() =>
    window.__calls.filter((c) => c.p.indexOf('dk_shift_edits') === 0)
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].b.hours).toBe(6);
  expect(Object.keys(calls[0].b), '時間の 保存で 高速代などを 送った').not.toContain('toll_yen');
  const ato = await hi(page, '2026-08-01').locator('.dhead .ds').textContent();
  // 売上（実費を 引いた 後）は 変わらない
  expect(String(ato).split('時数')[0]).toBe(String(mae).split('時数')[0]);
});

// 帯の 数え方は 給料の 計算と 同じ（対立役 2回目の P1・P4）
for (const [na, tweak, hiD] of [
  [
    '手入力の 車に 売上が 在り 時間 0・乗った人の 時間も 空＝給料が 出ない',
    (F) => {
      F.manualDays = F.manualDays.map((m) =>
        m.work_date === '2026-08-02' ? Object.assign({}, m, { sales_yen: 20000 }) : m
      );
    },
    '2026-08-02',
  ],
  [
    '記録の 無い 車に 乗った人が 時間 5＝売上の 母数に 入らない 車で 払う',
    (F) => {
      F.workHours.push({
        company_id: CO,
        work_date: '2026-08-03',
        employee_id: SABURO,
        device_id: CAR2,
        hours: 5,
      });
    },
    '2026-08-03',
  ],
  [
    '車が 空の 人が 時間 3',
    (F) => {
      F.workHours.push({
        company_id: CO,
        work_date: '2026-08-04',
        employee_id: SABURO,
        device_id: '',
        hours: 3,
      });
    },
    '2026-08-04',
  ],
]) {
  test('帯に 出す：' + na, async ({ page }) => {
    await hiraku(page, { ichinichi: true, tweak });
    const obi = page.locator('#hibar .hizen');
    await expect(obi).not.toContainText('入れ漏れはありません');
    await expect(obi.locator('[data-nn-hi="' + hiD + '"]')).toHaveCount(1);
  });
}

test('帯に 出す：＋手で車を足す で 作った 売上0・時間0 の 車に 時間 空の 人', async ({ page }) => {
  // 材料の 8/2 2号車＝手入力・売上 0・時間 0・次郎（時間 空）
  await hiraku(page, { ichinichi: true });
  await expect(page.locator('#hibar .hizen [data-nn-hi="2026-08-02"]')).toHaveCount(1);
});

test('保存中は 日を 選ぶ 帯も 押せない（描き直しで 札が 押せる形に 戻らない）・済んだら 戻る', async ({
  page,
}) => {
  await hiraku(page, { ichinichi: true });
  await page.evaluate(() => {
    const i = document.getElementById('hiSel');
    i.value = '2026-08-01';
    i.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      const r = moto(s, p, o);
      return (o && o.method) === 'POST' ? new Promise((ok) => setTimeout(() => ok(r), 1500)) : r;
    };
  });
  await page
    .locator('[data-chip-dev="' + CAR2 + '"][data-chip-emp="' + SABURO + '"]')
    .first()
    .click();
  const mid = await page.evaluate(() => ({
    next: document.getElementById('nextD').disabled,
    sel: document.getElementById('hiSel').disabled,
    zen: document.getElementById('hiZen').disabled,
    chips: [...document.querySelectorAll('[data-chip-emp]')].every((b) => b.disabled),
  }));
  expect(mid, '保存中に 帯か 札が 押せる').toEqual({
    next: true,
    sel: true,
    zen: true,
    chips: true,
  });
  await page.waitForTimeout(2200);
  const ato = await page.evaluate(() => ({
    next: document.getElementById('nextD').disabled,
    prev: document.getElementById('prevD').disabled,
    sel: document.getElementById('hiSel').disabled,
  }));
  // 済んだら 戻る（8/1 は 期間の 最初の 日なので 前の日 は もとから 押せない）
  expect(ato).toEqual({ next: false, prev: true, sel: false });
  const wh = await page.evaluate(() =>
    window.__calls.filter((c) => c.p.indexOf('dk_work_hours') === 0)
  );
  expect(wh).toHaveLength(1);
});

test('保存中に 月を 行き来して 描き直されても 札は 止まった まま', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      const r = moto(s, p, o);
      return (o && o.method) === 'POST' ? new Promise((ok) => setTimeout(() => ok(r), 2500)) : r;
    };
  });
  await page
    .locator('[data-chip-dev="' + CAR2 + '"][data-chip-emp="' + SABURO + '"]')
    .first()
    .click();
  await page.click('#nextM');
  await page.waitForTimeout(300);
  await page.click('#prevM');
  await page.waitForTimeout(300);
  const mid = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#days [data-chip-emp]')];
    return { n: b.length, dis: b.filter((x) => x.disabled).length };
  });
  expect(mid.n).toBeGreaterThan(0);
  expect(mid.dis, '描き直しで 札が 押せる形に 戻った').toBe(mid.n);
});

test('保存の 返事が 来ない 時は 15秒で 戻して 字で 知らせる', async ({ page }) => {
  test.setTimeout(60000);
  await hiraku(page);
  await page.evaluate(() => {
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      return (o && o.method) === 'POST' ? new Promise(() => {}) : moto(s, p, o);
    };
  });
  await page
    .locator('[data-chip-dev="' + CAR2 + '"][data-chip-emp="' + SABURO + '"]')
    .first()
    .click();
  const mae = await page.evaluate(() => document.getElementById('hiZen').disabled);
  expect(mae).toBe(true);
  await page.waitForTimeout(16000);
  const ato = await page.evaluate(() => ({
    zen: document.getElementById('hiZen').disabled,
    chip: [...document.querySelectorAll('[data-chip-emp]')].some((b) => b.disabled),
    err: (document.getElementById('err') || {}).textContent || '',
  }));
  expect(ato.zen, '返事が 来ないまま 固まった').toBe(false);
  expect(ato.chip).toBe(false);
  expect(ato.err).toContain('保存の 返事が 来ません');
});

test('時数の 車は 会社設定の 並びの 順（業務を 読んだ 順では ない）', async ({ page }) => {
  await hiraku(page, {
    // 2号車を 並び 1、1号車を 並び 2 に（業務は 1号車が 先）
    tweak: (F) => {
      F.labels = F.labels.map((l) =>
        l.device_id === CAR1
          ? Object.assign({}, l, { sort_order: 2 })
          : l.device_id === CAR2
            ? Object.assign({}, l, { sort_order: 1 })
            : l
      );
    },
  });
  const na = await hi(page, '2026-08-01')
    .locator('.carrow .cname')
    .evaluateAll((xs) => xs.map((x) => x.firstChild.textContent.trim()));
  expect(na).toEqual(['2号車', '1号車']);
});

// ── メーターの 車の 売上を 直す 欄 2026-10-14 ─────────────────────────
//   司さん「赤丸の売上の数も任意でユーザーが修正できるようにしとけよ」
//   ★わざと壊して 赤に なるのを 見た★：欄を 足す 前の kyuryo.html で 下の 3本とも 赤
const SHIFT1 = '00000000-0000-4000-a000-000000000001';

async function uriUtsu(page, v) {
  await page.evaluate(
    (a) => {
      const i = document.querySelector('[data-uri-sid="' + a.sid + '"]');
      i.value = a.v;
      i.dispatchEvent(new Event('change'));
    },
    { sid: SHIFT1, v }
  );
  await page.waitForTimeout(500);
}
function edPosts(page) {
  return page.evaluate(() =>
    window.__calls.filter((c) => c.p.indexOf('dk_shift_edits') === 0 && c.m === 'POST')
  );
}

test('メーターの 車の 売上の 欄＝業務ごと・空なら メーターの 額・時間の 欄と 印が 別', async ({
  page,
}) => {
  await hiraku(page);
  const d1 = hi(page, '2026-08-01');
  // 1号車は 8/1 に 2回 働く＝欄も 2つ
  await expect(d1.locator('[data-uri-sid]')).toHaveCount(3);
  await expect(d1.locator('[data-uri-sid="' + SHIFT1 + '"]')).toHaveAttribute(
    'placeholder',
    '9,800'
  );
  await expect(d1.locator('[data-uri-sid="' + SHIFT1 + '"]')).toHaveValue('');
  // data-sid（時間の 保存に 結ばれている）を 持つ 欄は 時間の 欄だけ
  const bad = await page.evaluate(
    () =>
      [...document.querySelectorAll('input[data-sid]')].filter((i) => !i.classList.contains('hrs'))
        .length
  );
  expect(bad, '売上の 欄が 時間の 保存に 吸われる').toBe(0);
});

test('売上を 直す＝その 額が 送られ 日の 売上が 変わる・空で メーターに 戻る', async ({ page }) => {
  await hiraku(page);
  const ds = () => hi(page, '2026-08-01').locator('.dhead .ds').textContent();
  const mae = await ds();
  expect(mae).toContain('¥18,200'); // 9,800＋1,000＋7,400
  await uriUtsu(page, '7000');
  let p = await edPosts(page);
  expect(p).toHaveLength(1);
  expect(p[0].b).toMatchObject({ shift_id: SHIFT1, uriage_yen: 7000 });
  expect(Object.keys(p[0].b), '売上の 保存で 時間・高速代を 送った').not.toContain('hours');
  expect(Object.keys(p[0].b)).not.toContain('toll_yen');
  expect(await ds()).toContain('¥15,400'); // 7,000＋1,000＋7,400
  await expect(hi(page, '2026-08-01').locator('.carrow', { hasText: '1号車' })).toContainText(
    'メーター ¥9,800'
  );
  await uriUtsu(page, '');
  p = await edPosts(page);
  expect(p[1].b.uriage_yen).toBeNull();
  expect(await ds()).toContain('¥18,200');
});

test('売上の 欄の 字：「9,800」「９８００」は 9800・負や 字は 止めて 知らせ 送らない', async ({
  page,
}) => {
  await hiraku(page);
  await uriUtsu(page, '9,800');
  await uriUtsu(page, '９８００');
  let p = await edPosts(page);
  expect(p.map((x) => x.b.uriage_yen)).toEqual([9800, 9800]);
  for (const v of ['-5', 'abc', '12.5']) {
    await uriUtsu(page, v);
    await expect(page.locator('#err')).toContainText('0以上の 整数');
  }
  p = await edPosts(page);
  expect(p, '読めない 字で 送った').toHaveLength(2);
});

test('売上の 直しが 読めない 業務が 在れば 明細の 画面・PDF（全員・1人）を 止める', async ({
  page,
}) => {
  await hiraku(page, {
    tweak: (F) => {
      F.edits = [{ shift_id: SHIFT1, company_id: CO, uriage_yen: -5 }];
    },
  });
  await page.click('.tab[data-tab="slip"]');
  await page.waitForTimeout(600);
  await expect(page.locator('#slips')).toContainText('売上の 直しが 読めない');
  await page.evaluate(() => {
    const e = document.getElementById('err');
    e.textContent = '';
  });
  await page.click('#btnPrint');
  await page.waitForTimeout(500);
  await expect(page.locator('#err')).toContainText('売上の 直しが 読めない');
});
