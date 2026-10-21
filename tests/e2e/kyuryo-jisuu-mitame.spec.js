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
//     ④乗った人の 札で 保存する・保存中は 札を 押せない（選ぶ箱は 2026-10-19 に やめた＝kyuryo-nori-fuda）
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
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[];' +
    ' if(p.indexOf("dk_uriage_rireki")===0)return F.uriageRireki||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){var m=(o&&o.method)||"GET";if(m!=="GET")window.__calls.push({p:p,m:m,b:o&&o.body?JSON.parse(o.body):null});' +
    'return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;' +
    // 売上から 引く 物の 記録が 読めない 形（F.uriageRirekiDame）
    ' if(F.uriageRirekiDame&&p.indexOf("dk_uriage_rireki")===0){if(st)st.failed++;return Promise.resolve([]);}' +
    // 読めない 表を 名指し（F.dame＝["dk_shift_edits"] 等）
    ' if((F.dame||[]).some(function(t){return p.indexOf(t)===0;})){if(st)st.failed++;return Promise.resolve([]);}' +
    // 読みを 遅らせる（window.__osoi ミリ秒・期を 変えた 直後の 読み込み中を 作る）
    'if(!window.__osoi)return Promise.resolve(rows(p));' +
    'return new Promise(function(ok){setTimeout(function(){ok(rows(p));},window.__osoi);});};})();'
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

test('乗った人の 札で 保存・保存中は 札を 押せない', async ({ page }) => {
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
  // 済んだら 戻る（2026-10-20 から 期間の 最初の 日でも「前の日」で 前の 期間へ 行ける＝押せる）
  expect(ato).toEqual({ next: false, prev: false, sel: false });
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

// ★役割の 決まりが 無くて 計算できない 人が 居れば 明細・PDF を 止める★ 2026-10-17
//   今の 穴：役割の 名前を 直す・消すと 人の 役割は 古い 名前の まま 残り、歩合0・保証0で 黙って 出ていた
test('役割の 決まりに 無い 人（歩合・保証が 空）が 居れば 明細の 画面・PDF を 止め、名前と 役割を 出す', async ({
  page,
}) => {
  await hiraku(page, {
    tweak: (F) => {
      F.emps.forEach((e) => {
        if (e.employee_id === TARO) e.role = '丙';
      });
    },
  });
  await page.click('.tab[data-tab="slip"]');
  await page.waitForTimeout(600);
  await expect(page.locator('#slips')).toContainText('役割の 決まりが 無くて');
  await expect(page.locator('#slips')).toContainText('テスト太郎（丙）');
  await expect(page.locator('#slips .slip')).toHaveCount(0);
  await page.evaluate(() => {
    document.getElementById('err').textContent = '';
  });
  await page.click('#btnPrint');
  await page.waitForTimeout(500);
  await expect(page.locator('#err')).toContainText('役割の 決まりが 無くて');
});

test('役割の 決まりに 無くても 歩合と 保証を 両方 打った 人は 止めない（司さん 08-25）', async ({
  page,
}) => {
  await hiraku(page, {
    tweak: (F) => {
      F.emps.forEach((e) => {
        if (e.employee_id === TARO) {
          e.role = '丙';
          e.pay_rate = '0.3000';
          e.pay_floor = 1000;
        }
      });
    },
  });
  await page.click('.tab[data-tab="slip"]');
  await page.waitForTimeout(600);
  await expect(page.locator('#slips')).not.toContainText('役割の 決まりが 無くて');
  await expect(page.locator('#slips')).toContainText('テスト太郎');
  await expect(page.locator('#slips .slip').first()).toBeVisible();
});

// ★空の 人の 欄にも 車の 時数★ 2026-10-19（司さん「車の時数入れてから乗った人選んだら自動で反映されるようにしとけよ」）
test('乗った人の 欄が 空なら 欄の 中に 車の 時数・打った 人と 車が 0h の 人は 出さない', async ({
  page,
}) => {
  await hiraku(page);
  const ran = (d, emp) =>
    hi(page, d).locator('[data-wh-emp="' + emp + '"][data-wh-date="' + d + '"]');
  // 8/1 太郎＝空・1号車は 9 + 1 = 10h
  await expect(ran('2026-08-01', TARO)).toHaveValue('');
  await expect(ran('2026-08-01', TARO)).toHaveAttribute('placeholder', '10');
  // 8/1 次郎＝自分で 7h を 打っている＝その 値・placeholder は 空
  await expect(ran('2026-08-01', JIRO)).toHaveValue('7');
  await expect(ran('2026-08-01', JIRO)).toHaveAttribute('placeholder', '');
  // 8/2 次郎＝空・2号車は 0h＝出さない（「給料は出ません」の 警告の 方を 出す）
  await expect(ran('2026-08-02', JIRO)).toHaveAttribute('placeholder', '');
  // 触っただけでは 保存しない
  await ran('2026-08-01', TARO).focus();
  await ran('2026-08-01', TARO).blur();
  await page.waitForTimeout(300);
  const wh = await page.evaluate(() =>
    window.__calls.filter((c) => c.p.indexOf('dk_work_hours') === 0)
  );
  expect(wh).toHaveLength(0);
});

// ★実費が 在る 業務の 売上の 欄は「引いた 後」で 見せ、しまう 額は「引く 前」★ 2026-10-19
//   司さん「入力で経費いれてメーター実費って出すなら自動反映で26,180にしろや」
test('実費が 在る 業務の 売上の 欄＝引いた 後・打った 値に 実費を 足して しまう', async ({
  page,
}) => {
  const SID2 = '00000000-0000-4000-a000-000000000002'; // 8/1 2号車 メーター 7,400
  await hiraku(page, {
    tweak: (F) => {
      F.edits = [{ shift_id: SID2, company_id: CO, toll_yen: 1520, uriage_yen: null }];
    },
  });
  const ran = hi(page, '2026-08-01').locator('[data-uri-sid="' + SID2 + '"]');
  // 自動の 数＝7,400 − 1,520 ＝ 5,880
  await expect(ran).toHaveAttribute('placeholder', '5,880');
  await expect(ran).toHaveAttribute('aria-label', '売上（実費を 引いた 後）');
  // 目に 見える 字でも「引いた 後」（aria は スマホで 見えない・4回目の 叩き 直す3/4）
  await expect(
    hi(page, '2026-08-01').locator('.carrow:has([data-uri-sid="' + SID2 + '"]) .unote')
  ).toContainText('売上の 欄は 実費を 引いた 後');

  // ★幅 390 で 名前の 列が 潰れない・横に はみ出さない★（5回目の 叩き 止1：1px に 潰れた）
  const haba = await page.evaluate((sid) => {
    const r = document.querySelector('.carrow:has([data-uri-sid="' + sid + '"])');
    return {
      name: r.querySelector('.cname').getBoundingClientRect().width,
      doc: document.documentElement.scrollWidth,
    };
  }, SID2);
  expect(haba.name).toBeGreaterThan(60);
  expect(haba.doc).toBeLessThanOrEqual(390);
  // 実費の 無い 業務は 今まで 通り（引く 前＝メーター）
  const ran1 = hi(page, '2026-08-01').locator(
    '[data-uri-sid="00000000-0000-4000-a000-000000000001"]'
  );
  await expect(ran1).toHaveAttribute('placeholder', '9,800');
  // 6,000 と 打つ（引いた 後）⇒ しまう 額は 6,000 ＋ 1,520 ＝ 7,520（引く 前）
  const utsu = (v) =>
    page.evaluate(
      (a) => {
        const i = document.querySelector('[data-uri-sid="' + a.sid + '"]');
        i.value = a.v;
        i.dispatchEvent(new Event('change'));
      },
      { sid: SID2, v: v }
    );
  await utsu('6000');
  await page.waitForTimeout(600);
  const ed = await page.evaluate(() =>
    window.__calls.filter((c) => c.p.indexOf('dk_shift_edits') === 0)
  );
  expect(ed).toHaveLength(1);
  expect(ed[0].b.uriage_yen).toBe(7520);
  // 描き直した 後も 欄は 引いた 後の 6000
  await expect(hi(page, '2026-08-01').locator('[data-uri-sid="' + SID2 + '"]')).toHaveValue('6000');
  // 空に すると メーターに 戻す（null を しまう）
  await utsu('');
  await page.waitForTimeout(600);
  const ed2 = await page.evaluate(() =>
    window.__calls.filter((c) => c.p.indexOf('dk_shift_edits') === 0)
  );
  expect(ed2[1].b.uriage_yen).toBe(null);
});

// ★その 日の 引き方（何日から）で 引く★ 2026-10-19（対立役 止2：記録が 在る 形を 守る）
test('売上から 引く 物の 記録が 在る 日は その 日の 引き方で 引く（7/1 から 高速代を 引かない）', async ({
  page,
}) => {
  const SID2 = '00000000-0000-4000-a000-000000000002';
  await hiraku(page, {
    tweak: (F) => {
      F.edits = [{ shift_id: SID2, company_id: CO, toll_yen: 1520, uriage_yen: null }];
      F.uriageRireki = [{ company_id: CO, key: 'toll', from_date: '2026-07-01', value: false }];
    },
  });
  const ran = hi(page, '2026-08-01').locator('[data-uri-sid="' + SID2 + '"]');
  // 高速代は 引かない 日＝メーターの まま 7,400・字も「引く 前」
  await expect(ran).toHaveAttribute('placeholder', '7,400');
  await expect(ran).toHaveAttribute('aria-label', '売上（実費を 引く 前）');
  await page.evaluate((sid) => {
    const i = document.querySelector('[data-uri-sid="' + sid + '"]');
    i.value = '6000';
    i.dispatchEvent(new Event('change'));
  }, SID2);
  await page.waitForTimeout(600);
  const ed = await page.evaluate(() =>
    window.__calls.filter((c) => c.p.indexOf('dk_shift_edits') === 0)
  );
  expect(ed).toHaveLength(1);
  expect(ed[0].b.uriage_yen).toBe(6000);
});

// ★引き方が 読めない 時は 売上を 直せない★ 2026-10-19（対立役 止1：違う 引き方で 引く 前を しまわない）
test('売上から 引く 物の 記録が 読めない 時は 売上の 欄を 押せず 保存も しない', async ({
  page,
}) => {
  const SID2 = '00000000-0000-4000-a000-000000000002';
  await hiraku(page, {
    tweak: (F) => {
      F.edits = [{ shift_id: SID2, company_id: CO, toll_yen: 1520, uriage_yen: null }];
      F.uriageRirekiDame = true;
    },
  });
  const ran = hi(page, '2026-08-01').locator('[data-uri-sid="' + SID2 + '"]');
  await expect(ran).toBeDisabled();
  // 押せない 欄に 無理に 打っても しまわない
  await page.evaluate((sid) => {
    const i = document.querySelector('[data-uri-sid="' + sid + '"]');
    i.disabled = false;
    i.value = '6000';
    i.dispatchEvent(new Event('change'));
  }, SID2);
  await page.waitForTimeout(600);
  const ed = await page.evaluate(() =>
    window.__calls.filter((c) => c.p.indexOf('dk_shift_edits') === 0)
  );
  expect(ed).toHaveLength(0);
  await expect(page.locator('#err')).toContainText('売上は 直せません');
  // 訳は 目に 見える 字で 日の 並びの 頭に 1回 だけ（車の 行に 付けない＝実費の 無い 車に 付いた）
  await expect(page.locator('#days .keikoku', { hasText: '開き直して' })).toHaveCount(1);
  await expect(page.locator('#days > .uri-dame:first-child')).toContainText('開き直して');
  await expect(page.locator('#days .carrow .keikoku', { hasText: '開き直して' })).toHaveCount(0);
  // 警告の 赤（ほかの 警告と 同じ 色・太さ）で 出る（8回目の 叩き：本文の 字に 見えた）
  const iro = await page.evaluate(() => {
    const a = getComputedStyle(document.querySelector('#days > .uri-dame .keikoku'));
    const r = document.createElement('div');
    r.className = 'carrow';
    r.innerHTML = '<span class="keikoku">x</span>';
    document.body.appendChild(r);
    const b = getComputedStyle(r.querySelector('.keikoku'));
    const out = { a: a.color, b: b.color, w: a.fontWeight };
    r.remove();
    return out;
  });
  expect(iro.a).toBe(iro.b);
  expect(Number(iro.w)).toBeGreaterThanOrEqual(700);
  // 読めない 時は 引く 前の 額（7,400）を 欄に 見せない
  await expect(ran).toHaveValue('');
  await expect(ran).toHaveAttribute('placeholder', '—');

  // ★幅 390 で 名前の 列が 潰れない・横に はみ出さない★（5回目の 叩き 止1：1px に 潰れた）
  const haba = await page.evaluate((sid) => {
    const r = document.querySelector('.carrow:has([data-uri-sid="' + sid + '"])');
    return {
      name: r.querySelector('.cname').getBoundingClientRect().width,
      doc: document.documentElement.scrollWidth,
    };
  }, SID2);
  expect(haba.name).toBeGreaterThan(60);
  expect(haba.doc).toBeLessThanOrEqual(390);
});

// ★実費が メーターより 多い 時は 負の 数を 打てる・引く 前が 0 未満には ならない★ 2026-10-19（対立役 直3）
test('実費が メーターより 多い 業務は 負の 数で 打てる', async ({ page }) => {
  const SID2 = '00000000-0000-4000-a000-000000000002';
  await hiraku(page, {
    tweak: (F) => {
      F.edits = [{ shift_id: SID2, company_id: CO, toll_yen: 9000, uriage_yen: null }];
    },
  });
  const ran = hi(page, '2026-08-01').locator('[data-uri-sid="' + SID2 + '"]');
  await expect(ran).toHaveAttribute('placeholder', '-1,600');
  const utsu = (v) =>
    page.evaluate(
      (a) => {
        const i = document.querySelector('[data-uri-sid="' + a.sid + '"]');
        i.value = a.v;
        i.dispatchEvent(new Event('change'));
      },
      { sid: SID2, v: v }
    );
  await utsu('-1000');
  await page.waitForTimeout(600);
  let ed = await page.evaluate(() =>
    window.__calls.filter((c) => c.p.indexOf('dk_shift_edits') === 0)
  );
  expect(ed.map((x) => x.b.uriage_yen)).toEqual([8000]);
  // 実費より 少なく（引く 前が 0 未満）は 断る
  await utsu('-9001');
  await page.waitForTimeout(600);
  ed = await page.evaluate(() => window.__calls.filter((c) => c.p.indexOf('dk_shift_edits') === 0));
  expect(ed).toHaveLength(1);
  await expect(page.locator('#err')).toContainText('実費');
});

// ★実費（業務の 直し）や 売上の 設定が 読めない 時も 売上を 直せない★ 2026-10-19（2回目の 叩き 止A・直D）
for (const t of ['dk_shift_edits', 'dk_sales_settings']) {
  test(
    '読めない 物（' + t + '）が ある 時は 売上の 欄を 押せず 保存も しない',
    async ({ page }) => {
      const SID2 = '00000000-0000-4000-a000-000000000002';
      await hiraku(page, {
        tweak: (F) => {
          F.edits = [{ shift_id: SID2, company_id: CO, toll_yen: 1520, uriage_yen: null }];
          F.dame = [t];
        },
      });
      const ran = hi(page, '2026-08-01').locator('[data-uri-sid="' + SID2 + '"]');
      await expect(ran).toBeDisabled();
      await page.evaluate((sid) => {
        const i = document.querySelector('[data-uri-sid="' + sid + '"]');
        i.disabled = false;
        i.value = '6000';
        i.dispatchEvent(new Event('change'));
      }, SID2);
      await page.waitForTimeout(600);
      const ed = await page.evaluate(() =>
        window.__calls.filter((c) => c.p.indexOf('dk_shift_edits') === 0)
      );
      expect(ed).toHaveLength(0);
    }
  );
}

// ★「-」だけは 読めない 字＝直した 売上を 消さない★ 2026-10-19（2回目の 叩き 直B）
test('実費が 在る 業務で「-」だけを 打っても メーターに 戻さない', async ({ page }) => {
  const SID2 = '00000000-0000-4000-a000-000000000002';
  await hiraku(page, {
    tweak: (F) => {
      F.edits = [{ shift_id: SID2, company_id: CO, toll_yen: 9000, uriage_yen: 8000 }];
    },
  });
  await page.evaluate((sid) => {
    const i = document.querySelector('[data-uri-sid="' + sid + '"]');
    i.value = '-';
    i.dispatchEvent(new Event('change'));
  }, SID2);
  await page.waitForTimeout(600);
  const ed = await page.evaluate(() =>
    window.__calls.filter((c) => c.p.indexOf('dk_shift_edits') === 0)
  );
  expect(ed).toHaveLength(0);
  await expect(page.locator('#err')).toContainText('数で 入れて');
});

// ★記録の 形が 壊れて 計算が 止めた 時も 売上を 直せない★ 2026-10-19（3回目の 叩き 直す1）
test('売上から 引く 物の 記録の 形が 壊れている 時は 売上の 欄を 押せない', async ({ page }) => {
  const SID2 = '00000000-0000-4000-a000-000000000002';
  await hiraku(page, {
    tweak: (F) => {
      F.edits = [{ shift_id: SID2, company_id: CO, toll_yen: 1520, uriage_yen: null }];
      F.uriageRireki = [{ company_id: CO, key: 'toll', from_date: '2026-07-01', value: 'x' }];
    },
  });
  await expect(hi(page, '2026-08-01').locator('[data-uri-sid="' + SID2 + '"]')).toBeDisabled();
});

// ★業務の 日より 後から 効く 記録は その 日に 効かせない★ 2026-10-20（4回目の 叩き 直す1・M1＝日付を 変えても 緑だった）
test('売上から 引く 物を 8/2 から 引かない 記録でも 8/1 は 引いた 後（5,880）のまま', async ({
  page,
}) => {
  const SID2 = '00000000-0000-4000-a000-000000000002';
  await hiraku(page, {
    tweak: (F) => {
      F.edits = [{ shift_id: SID2, company_id: CO, toll_yen: 1520, uriage_yen: null }];
      F.uriageRireki = [{ company_id: CO, key: 'toll', from_date: '2026-08-02', value: false }];
    },
  });
  await expect(hi(page, '2026-08-01').locator('[data-uri-sid="' + SID2 + '"]')).toHaveAttribute(
    'placeholder',
    '5,880'
  );
});

// ★「直した（メーター ¥…）」も 引いた 後★ 2026-10-20（4回目の 叩き 直す1・M3＝戻しても 緑だった）
test('直した 売上の 横の「メーター」の 額も 実費を 引いた 後', async ({ page }) => {
  const SID2 = '00000000-0000-4000-a000-000000000002';
  await hiraku(page, {
    tweak: (F) => {
      F.edits = [{ shift_id: SID2, company_id: CO, toll_yen: 1520, uriage_yen: 8000 }];
    },
  });
  await expect(hi(page, '2026-08-01')).toContainText('直した（メーター ¥5,880）');
});

// ★2回 走った 車でも「引いた 後」の 字は 横 いっぱいの 1行★ 2026-10-20（6回目の 叩き 止1'：名前の 列に 置くと 行が 705px に）
//   名前の 列 その物が 狭い（幅 390 で 19px）のは E の 前から＝別の 1件
for (const w of [390, 375, 360]) {
  test(
    '2回 走った 車の 片方に 実費＝「引いた 後」の 字は .unote で 横 いっぱい（幅 ' + w + '）',
    async ({ page }) => {
      const SID9 = '00000000-0000-4000-a000-000000000009';
      await hiraku(page, {
        tweak: (F) => {
          F.edits = [{ shift_id: SID9, company_id: CO, toll_yen: 1520, uriage_yen: null }];
        },
      });
      await page.setViewportSize({ width: w, height: 900 });
      const note = hi(page, '2026-08-01').locator(
        '.carrow:has([data-uri-sid="' + SID9 + '"]) .unote'
      );
      await expect(note).toHaveText('売上の 欄は 実費を 引いた 後');
      const m = await note.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, doc: document.documentElement.scrollWidth };
      });
      expect(m.w).toBeGreaterThan(w - 80);
      expect(m.h).toBeLessThan(40);
      expect(m.doc).toBeLessThanOrEqual(w);
    }
  );
}

// ★★2回 走った 車も 名前の 列が 潰れない★★ 2026-10-20（E の 前から 在った 細さ）
// ★★車の 行＝300〜430px を 1px ずつ：名前が 潰れない・行の 子が 全部 行から 出ない・時間の 欄の 右端が 揃う★★ 2026-10-20
//   ★前★ 2回 走った 車は 名前の 列が 390px で 19px・360px 以下で 0px（欄に「1回目」が 付いて 広がる）
//         1回の 車も 300〜325px で「1号車」が 名前の 列から はみ出した
//   ★今★ 2回 以上＝名前は 1行目に 横 いっぱい・400px 以下は 全部の 車で 名前を 1行目に（2回 以上は 欄を 3行に）
//   ★対立役★ 欄（input）だけ 見ると ✕ の 列が はみ出しを 吸って 隠れた（361〜368px）／境を「1号車」の 3字で 決めると 長い 名前で 割れる
//     ⇒ 行の 子の 全部・時間の 欄の 揃い・名前の 列の 幅（60px 以上）を 見る。名前 3字と 10字の 2形
//   ★わざと壊して 赤に なるのを 見た（2026-10-20 実測）★ 直す 前の kyuryo.html … 走査 3形とも 赤
//     2回 走った 車の 時間の 欄を 20px ずらす … 赤（欄の 右端で 見る）／PC でも 名前を 1行目に 回す … PC の 3本 赤
//     境を 360px に した 形（前の 案）… 361〜368px 等で 赤
// 名前の 長い 車（10字）でも 見る＝境を「1号車」の 3字で 決めない（対立役）
const nagaiNa = (F) => {
  (F.labels || []).forEach((l) => {
    if (l.device_id === CAR1) l.label = '第一営業所ワゴン車X';
    if (l.device_id === CAR2) l.label = 'アルファード大阪の車';
  });
};
// いろいろ 入った 形＝3回 走った 車・実費の 注（.unote）・直した 売上の csub・長い 名前（対立役：extra の 形が 1つも 無かった）
const iroiro = (F) => {
  nagaiNa(F);
  F.shifts.push({
    shift_id: '00000000-0000-4000-a000-00000000000a',
    device_id: CAR1,
    started_at: '2026-08-01 07:00:00+00',
    ended_at: '2026-08-01 08:00:00+00',
    elapsed_sec: 3600,
    fare_total_yen: 1234567,
    trip_count: 1,
  });
  F.edits = [
    {
      shift_id: '00000000-0000-4000-a000-000000000002',
      company_id: CO,
      toll_yen: 1520,
      uriage_yen: null,
    },
    {
      shift_id: '00000000-0000-4000-a000-000000000009',
      company_id: CO,
      toll_yen: 300,
      uriage_yen: 5000,
    },
  ];
};
for (const [na, tweak] of [
  ['名前 3字', undefined],
  ['名前 10字', nagaiNa],
  ['3回・実費・直した 売上', iroiro],
]) {
  test(`車の 行＝300〜430px を 1px ずつ・${na}・名前が 潰れない・行から 出ない・時間の 欄が 揃う`, async ({
    page,
  }) => {
    test.setTimeout(200000);
    await hiraku(page, { tweak });
    const SIDb = '00000000-0000-4000-a000-000000000009'; // 8/1 1号車 の 2回目
    await expect(hi(page, '2026-08-01').locator('[data-uri-sid="' + SIDb + '"]')).toHaveCount(1);
    const dame = [];
    let mita = 0;
    for (let w = 300; w <= 430; w++) {
      await page.setViewportSize({ width: w, height: 844 });
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      );
      const m = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.carrow'));
        return {
          haba: document.documentElement.clientWidth,
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          nikai: document.querySelectorAll('.carrow.nikai').length,
          // 時間の 欄（input）の 右端＝車の 行と 乗った人の 行の 全部で 揃うか（箱の 右端だと 中で ずれても 緑・対立役）
          jikan: Array.from(document.querySelectorAll('.carrow input.hrs, .crewrow input.hrs')).map(
            (h) => Math.round(h.getBoundingClientRect().right)
          ),
          rows: rows.map((r) => {
            const n = r.querySelector('.cname');
            const rb = r.getBoundingClientRect();
            const rr = rb.right;
            const kids = Array.from(r.querySelectorAll('*')).filter((c) => {
              const b = c.getBoundingClientRect();
              return b.width > 0 && b.height > 0;
            });
            return {
              na: n.firstChild ? n.firstChild.textContent : '',
              // 名前の 列の 幅（字ごとに 折れて 縦に 積まれると 細く なる＝はみ出しでは 見えない）
              nw: Math.round(n.getBoundingClientRect().width),
              // 行の 子の 全部（名前・欄・✕ の 列・注）が 行の 右から 出ないか（欄だけ 見ると ✕ の 列が 吸って 隠れた・対立役）
              migi: Math.max(...kids.map((c) => Math.round(c.getBoundingClientRect().right - rr))),
              hidari: Math.max(
                ...kids.map((c) => Math.round(rb.left - c.getBoundingClientRect().left))
              ),
            };
          }),
        };
      });
      if (m.haba === w) mita++;
      else dame.push(`${w}px のはずが ${m.haba}px`);
      if (!m.nikai) dame.push(`${w}px 2回 走った 車の 行が 無い`);
      if (m.page > 0) dame.push(`${w}px ページが 横に ${m.page}px`);
      if (m.jikan.length && Math.max(...m.jikan) - Math.min(...m.jikan) > 1)
        dame.push(
          `${w}px 時間の 欄の 右端が 揃わない ${Math.min(...m.jikan)}〜${Math.max(...m.jikan)}`
        );
      m.rows.forEach((r) => {
        if (r.nw < 60) dame.push(`${w}px ${r.na} 名前の 列が ${r.nw}px（細い）`);
        if (r.migi > 0) dame.push(`${w}px ${r.na} 行の 右から ${r.migi}px 出る`);
        if (r.hidari > 0) dame.push(`${w}px ${r.na} 行の 左から ${r.hidari}px 出る`);
      });
    }
    expect(mita, '★その 幅で 見た 数が 違う★').toBe(131);
    expect(dame, '★この 幅で 車の 行が 崩れる★').toEqual([]);
  });
}

// ★PC（601px 以上）は 2回 走った 車も 前の 1行の まま（名前と 欄が 同じ 行）＝事務所の PC の 見え方を 変えない★
for (const w of [601, 800, 1280]) {
  test(`2回 走った 車＝PC ${w}px は 名前と 欄が 同じ 行`, async ({ page }) => {
    await hiraku(page);
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(300);
    const SIDb = '00000000-0000-4000-a000-000000000009';
    const m = await page.evaluate((sid) => {
      const r = document.querySelector('.carrow:has([data-uri-sid="' + sid + '"])');
      return {
        nikai: r.classList.contains('nikai'),
        na: Math.round(r.querySelector('.cname').getBoundingClientRect().top),
        ran: Math.round(r.querySelector('.camt').getBoundingClientRect().top),
      };
    }, SIDb);
    expect(m.nikai, '★2回 走った 車の 行に 印が 無い＝この 形を 測っていない★').toBe(true);
    expect(m.ran, '★PC で 欄が 名前の 下の 行に 落ちた★').toBeLessThanOrEqual(m.na + 10);
  });
}

for (const w of [390, 375, 360, 320]) {
  test(`2回 走った 車の 名前の 列＝${w}px でも 潰れない・横に はみ出さない`, async ({ page }) => {
    await hiraku(page);
    await page.setViewportSize({ width: w, height: 844 });
    await page.waitForTimeout(300);
    const SIDb = '00000000-0000-4000-a000-000000000009'; // 8/1 1号車 の 2回目
    await expect(hi(page, '2026-08-01').locator('[data-uri-sid="' + SIDb + '"]')).toHaveCount(1);
    const m = await page.evaluate((sid) => {
      const r = document.querySelector('.carrow:has([data-uri-sid="' + sid + '"])');
      const n = r.querySelector('.cname');
      return {
        name: Math.round(n.getBoundingClientRect().width),
        hami: n.scrollWidth - n.clientWidth,
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        migi: Math.max(
          ...Array.from(r.querySelectorAll('input')).map((i) =>
            Math.round(i.getBoundingClientRect().right - r.getBoundingClientRect().right)
          )
        ),
      };
    }, SIDb);
    expect(m.name, '★2回 走った 車の 名前の 列が 細い★').toBeGreaterThan(60);
    expect(m.hami, '★名前が 列から はみ出している★').toBeLessThanOrEqual(0);
    expect(m.migi, '★欄が 行の 右から はみ出している★').toBeLessThanOrEqual(0);
    expect(m.doc, '★ページが 横に はみ出している★').toBeLessThanOrEqual(0);
  });
}

// ★★乗った人・手で 入れた 日 の 記録が 読めない 期は その 保存を 断る★★ 2026-10-21（対立役が 測った）
//   前：手で 入れた 日が 読めないと 手入力の 車が「＋ 手で車を足す」に 戻り、選ぶと 倉庫の 行へ 売上・高速代 0 を 送って 上書きした
//   ★わざと壊して 赤に なるのを 見た（2026-10-21 実測）★ 直す 前の kyuryo.html … 読めない 2本 赤（送った）
test('手で 入れた 日が 読めない 期は「＋ 手で車を足す」を 選んでも 送らない・訳を 出す', async ({
  page,
}) => {
  await hiraku(page, {
    tweak: (F) => {
      F.dame = ['dk_manual_days'];
    },
  });
  const sel = page.locator('[data-man-add]').first();
  expect(await sel.count(), '★「＋ 手で車を足す」が 無い＝この 形を 測っていない★').toBe(1);
  const opt = await sel.evaluate((s) =>
    Array.from(s.options)
      .map((o) => o.value)
      .find((v) => v && v !== '__new__')
  );
  expect(opt, '★足せる 車が 無い＝この 形を 測っていない★').toBeTruthy();
  await sel.selectOption(opt);
  await page.waitForTimeout(600);
  const c = await page.evaluate(() =>
    window.__calls.filter((x) => x.p.indexOf('dk_manual_days') === 0)
  );
  expect(c, '★読めないのに 手で 入れた 日を 送った（前の 額を 0 で 上書きする）★').toEqual([]);
  await expect(page.locator('#err')).toContainText('読めません');
});

test('乗った人が 読めない 期は 札を 押しても 送らない・訳を 出す', async ({ page }) => {
  await hiraku(page, {
    tweak: (F) => {
      F.dame = ['dk_work_hours'];
    },
  });
  const chip = page.locator('[data-chip-emp]').first();
  expect(await chip.count(), '★乗った人の 札が 無い＝この 形を 測っていない★').toBe(1);
  await chip.evaluate((b) => b.click());
  await page.waitForTimeout(600);
  const c = await page.evaluate(() =>
    window.__calls.filter((x) => x.p.indexOf('dk_work_hours') === 0)
  );
  expect(c, '★読めないのに 乗った人を 送った（前の 車・時間を 上書きする）★').toEqual([]);
  await expect(page.locator('#err')).toContainText('読めません');
});

test('読めた 期は 今まで 通り 札を 押すと 乗った人を 送る', async ({ page }) => {
  await hiraku(page);
  const chip = page.locator('[data-chip-emp]').first();
  expect(await chip.count()).toBe(1);
  await chip.evaluate((b) => b.click());
  await page.waitForTimeout(600);
  const c = await page.evaluate(() =>
    window.__calls.filter((x) => x.p.indexOf('dk_work_hours') === 0)
  );
  expect(c.length, '★読めたのに 送らない★').toBeGreaterThan(0);
});

// ★★期を 読み込み中は 手で 入れた 日・乗った人 を 送らない★★ 2026-10-21（対立役 K-1 が 測った）
//   前：読みを 遅らせて「次の月」を 押し、タブを 切り替えると 9月の 日が 8月の 記録で 描かれ、
//   「＋ 手で車を足す」・乗った人の 札から 9/1 へ 売上 0・時間 0 を 送った（倉庫に 行が 在れば 0 で 上書き）
//   ★わざと壊して 赤に なるのを 見た（2026-10-21 実測）★ dameNara の 読み込み中の 断りを 外す … この 1本 赤
test('期を 変えた 読み込み中に 描き直しても 手で 入れた 日・乗った人 を 送らない', async ({
  page,
}) => {
  await hiraku(page);
  await page.evaluate(() => {
    window.__osoi = 4000;
  });
  await page.click('#nextM');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    for (const t of ['slip', 'hours']) {
      const b = document.querySelector('.tab[data-tab="' + t + '"]');
      if (b && b.onclick) b.onclick();
    }
  });
  await page.waitForTimeout(300);
  const sel = page.locator('[data-man-add]').first();
  const chip = page.locator('[data-chip-emp]').first();
  expect(
    (await sel.count()) + (await chip.count()),
    '★読み込み中に 押せる 物が 無い＝この 形を 測っていない★'
  ).toBeGreaterThan(0);
  if (await sel.count()) {
    const opt = await sel.evaluate((s) =>
      Array.from(s.options)
        .map((o) => o.value)
        .find((v) => v && v !== '__new__')
    );
    if (opt) await sel.selectOption(opt);
  }
  if (await chip.count()) await chip.evaluate((b) => b.click());
  await page.waitForTimeout(600);
  const c = await page.evaluate(() =>
    window.__calls.filter(
      (x) => x.p.indexOf('dk_manual_days') === 0 || x.p.indexOf('dk_work_hours') === 0
    )
  );
  expect(c, '★読み込み中に 前の 期の 記録で 描いた 欄から 送った（0 で 上書きする）★').toEqual([]);
  await expect(page.locator('#err')).toContainText('読み込み中');
});

// ★読めない 期に「＋ 新しい車」を 選んでも 車の 名前を 倉庫に 書かない★（対立役 K-2：名前だけ 残って 次に「もう あります」で 弾かれた）
test('手で 入れた 日が 読めない 期は「＋ 新しい車」でも 車の 名前を 書かない', async ({ page }) => {
  page.on('dialog', (d) => d.accept('9号車'));
  await hiraku(page, {
    tweak: (F) => {
      F.dame = ['dk_manual_days'];
    },
  });
  const sel = page.locator('[data-man-add]').first();
  expect(await sel.count(), '★「＋ 手で車を足す」が 無い＝この 形を 測っていない★').toBe(1);
  await sel.selectOption('__new__');
  await page.waitForTimeout(600);
  const c = await page.evaluate(() =>
    window.__calls.filter(
      (x) => x.p.indexOf('dk_device_labels') === 0 || x.p.indexOf('dk_manual_days') === 0
    )
  );
  expect(c, '★読めないのに 車の 名前か 手で 入れた 日を 送った★').toEqual([]);
  await expect(page.locator('#err')).toContainText('読めません');
});

// ★断った 訳は 押した 所から 見える★（対立役 K-3：下の 日の 札を 押すと #err は 画面の 上の 外＝何も 起きない ように 見えた）
test('乗った人が 読めない 期に 下の 日の 札を 押すと 断った 訳が 画面に 見える', async ({
  page,
}) => {
  await hiraku(page, {
    tweak: (F) => {
      F.dame = ['dk_work_hours'];
    },
  });
  const last = page.locator('[data-chip-emp]').last();
  expect(await last.count(), '★乗った人の 札が 無い＝この 形を 測っていない★').toBe(1);
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const e = document.getElementById('err');
    const b = e.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, vh: innerHeight, ji: e.textContent };
  });
  expect(r.ji).toContain('読めません');
  expect(r.top, '★断った 訳が 画面の 上の 外★').toBeGreaterThanOrEqual(0);
  expect(r.bottom, '★断った 訳が 画面の 下の 外★').toBeLessThanOrEqual(r.vh);
});

// ★★読み込み中の 断りの 後始末★★ 2026-10-21（対立役 2回目 直す-1・直す-2・見立て）
const errJi = (page) =>
  page.evaluate(() => {
    const e = document.getElementById('err');
    return getComputedStyle(e).display === 'none' ? '' : e.textContent;
  });

// 直す-1：読み込み中に 入れて 断られた 後、読み終えても「読み込み中です」が 残った
test('読み込み中に 断った「読み込み中です」の 字は 読み終えたら 消える', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    window.__osoi = 2000;
  });
  await page.click('#nextM');
  await page.waitForTimeout(200);
  const f = page.locator('[data-man-f="sales_yen"]').first();
  expect(await f.count(), '★手で 入れた 日の 欄が 無い＝この 形を 測っていない★').toBeGreaterThan(
    0
  );
  await f.evaluate((i) => {
    i.value = '5000';
    i.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  expect(await errJi(page)).toContain('読み込み中');
  await page.waitForTimeout(2700);
  expect(await errJi(page), '★読み終えたのに「読み込み中です」が 残る★').not.toContain(
    '読み込み中'
  );
});

// 直す-2：期の 計算が 転ぶと 読み込み中の 印が 下りず、何も 出ないまま「読み込み中です」で 断り続けた
test('期の 計算が 転んだら 読み込み直しの 訳を 出し 保存は 断る・直れば 戻る', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    const P = window.PayrollDaily;
    const o = P.buildCtx;
    window.__nage = true;
    P.buildCtx = function () {
      if (window.__nage) throw new Error('見張り');
      return o.apply(this, arguments);
    };
  });
  await page.click('#nextM');
  await page.waitForTimeout(1500);
  expect(await errJi(page), '★計算が 転んだのに 何も 出ない★').toContain(
    '画面の計算で問題が出ました'
  );
  const f = page.locator('[data-man-f="sales_yen"]').first();
  if (await f.count())
    await f.evaluate((i) => {
      i.value = '5000';
      i.dispatchEvent(new Event('change'));
    });
  await page.waitForTimeout(500);
  expect(await errJi(page), '★「読み込み中です」と 違う 訳で 断った★').toContain(
    '画面の計算で問題が出ました'
  );
  expect(await page.evaluate(() => window.__calls.length), '★計算が 転んだ 画面から 送った★').toBe(
    0
  );
  await page.evaluate(() => {
    window.__nage = false;
  });
  await page.click('#prevM');
  await page.waitForTimeout(1500);
  expect(await errJi(page), '★直ったのに 訳が 残る★').not.toContain('画面の計算で問題が出ました');
});

// 見立て：前の 期の 画面に 残った 乗った人の 札・「外す」を 読み込み中に 押しても 送らない（札の 道の 試験が 0本だった）
test('期を 変えた 読み込み中に 前の 期の 札・外す を 押しても 乗った人を 送らない', async ({
  page,
}) => {
  await hiraku(page);
  await page.evaluate(() => {
    window.__osoi = 3000;
  });
  await page.click('#nextM');
  await page.waitForTimeout(300);
  const chip = page.locator('[data-chip-emp]').first();
  const del = page.locator('[data-del-emp]').first();
  expect(
    (await chip.count()) + (await del.count()),
    '★札も 外すも 無い＝この 形を 測っていない★'
  ).toBeGreaterThan(0);
  page.on('dialog', (d) => d.accept());
  if (await chip.count()) await chip.evaluate((b) => b.click());
  await page.waitForTimeout(200);
  if (await del.count()) await del.evaluate((b) => b.click());
  await page.waitForTimeout(200);
  const c = await page.evaluate(() =>
    window.__calls.filter((x) => x.p.indexOf('dk_work_hours') === 0)
  );
  expect(c, '★読み込み中に 前の 期の 札から 乗った人を 送った★').toEqual([]);
});

// ★★期の 計算が 転んだ 後に 前の 期の 額で 明細 PDF を 作らない・札は 新しい 期★★ 2026-10-21（対立役 3回目 止め-1・直す-1・直す-2）
//   2c7aa93：計算が 転んだ 時に 読み込み中の 印を 下ろした ので、PDF の 門が 通り「給料明細_2026-09」を 8月の 額（¥19,500）で 作った
for (const nageruNo of ['buildCtx', 'report']) {
  test(`期の 計算が 転んだ（${nageruNo}）後は 明細 PDF を 作らない・明細を 描かない・札は 新しい 期`, async ({
    page,
  }) => {
    await hiraku(page);
    await page.evaluate((w) => {
      window.__pdf = [];
      window.KamiEgaku = {
        yomu: () => Promise.resolve(),
        dasu: (mai, title) => {
          window.__pdf.push({ title: title, n: mai.length });
          return Promise.resolve();
        },
      };
      const P = window.PayrollDaily;
      const o = P[w];
      window.__nage = true;
      P[w] = function () {
        if (window.__nage) throw new Error('見張り');
        return o.apply(this, arguments);
      };
    }, nageruNo);
    await page.click('#nextM');
    await page.waitForTimeout(1500);
    await expect(
      page.locator('#monthLabel'),
      '★計算が 転んだのに 札が 前の 期の まま★'
    ).toContainText('9月');
    await page.click('.tab[data-tab="slip"]');
    await page.waitForTimeout(800);
    expect(
      (await page.locator('#slips').innerText()).trim(),
      '★計算が 転んだ 期の 札の 下に 前の 期の 明細が 出た★'
    ).toBe('');
    await page.click('#btnPrint');
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      try {
        window.printOne(0);
      } catch (_) {
        /* 断って 投げても 良い */
      }
    });
    await page.waitForTimeout(800);
    expect(
      await page.evaluate(() => window.__pdf),
      '★計算が 転んだ 期から 前の 期の 額で 明細 PDF を 作った★'
    ).toEqual([]);
    expect(await errJi(page)).toContain('画面の計算で問題が出ました');
  });
}

// ★★計算が 転んだ 後の 描き直しの 別の 道（名前で 選ぶ・日の 帯）からも 描かない・送らない★★ 2026-10-21（対立役 4回目 直す-A・直す-B・見立て）
async function korobu(page, w) {
  await page.evaluate((x) => {
    const P = window.PayrollDaily;
    const o = P[x];
    window.__nage = true;
    P[x] = function () {
      if (window.__nage) throw new Error('見張り');
      return o.apply(this, arguments);
    };
  }, w);
}
for (const w of ['buildCtx', 'report']) {
  // 直す-A：名前で 選ぶと renderSlips が 直に 走り、新しい 期の 札の 下に 前の 期の 明細・手当の 足す が 出た
  test(`計算が 転んだ（${w}）後に 名前で 選んでも 前の 期の 明細を 出さず 手当も 送らない`, async ({
    page,
  }) => {
    await hiraku(page);
    await korobu(page, w);
    await page.click('#nextM');
    await page.waitForTimeout(1500);
    await page.click('.tab[data-tab="slip"]');
    await page.waitForTimeout(600);
    const v = await page
      .locator('#hitoSel option')
      .evaluateAll((os) => os.map((o) => o.value).filter(Boolean)[0] || '');
    await page.selectOption('#hitoSel', v);
    await page.waitForTimeout(600);
    expect(
      (await page.locator('#slips').innerText()).trim(),
      '★名前で 選ぶと 前の 期の 明細が 出た★'
    ).toBe('');
    expect(await page.locator('[data-meisai-adj]').count(), '★手当を 足す 口が 出た★').toBe(0);
    expect(await errJi(page)).toContain('画面の計算で問題が出ました');
  });

  // 直す-B：日の 帯（#hibar）が 残り、押すと renderDays が 直に 走って 車の 時間・売上を 送れた
  test(`計算が 転んだ（${w}）後に 日の 帯から 描かせても 車の 時間・売上を 送らない`, async ({
    page,
  }) => {
    await hiraku(page);
    await page.locator('#periodBar [data-pidx="1"]').click();
    await page.waitForTimeout(1500);
    await korobu(page, w);
    await page.locator('#periodBar [data-pidx="0"]').click();
    await page.waitForTimeout(1500);
    expect(await page.locator('#hibar button').count(), '★転んだ 後も 日の 帯が 残る★').toBe(0);
    // 帯が 残って いても 直に 描かせる 道を 押す（前の 形）
    await page.evaluate(() => {
      const b = document.getElementById('hiZen');
      if (b) b.click();
    });
    await page.waitForTimeout(600);
    const u = page.locator('[data-uri-sid]');
    if (await u.count())
      await u.first().evaluate((i) => {
        i.value = '7000';
        i.dispatchEvent(new Event('change'));
      });
    const h = page.locator('[data-sid]');
    if (await h.count())
      await h.first().evaluate((i) => {
        i.value = '3';
        i.dispatchEvent(new Event('change'));
      });
    await page.waitForTimeout(600);
    expect(await page.locator('#days .day').count(), '★転んだ 後に 日の 欄が 描かれた★').toBe(0);
    expect(await page.evaluate(() => window.__calls), '★転んだ 画面から 送った★').toEqual([]);
  });
}

// 見立て：計算が 転んだ 間は 別の 成功の「字を 消す」でも 訳が 消えない（showErr の 出し直しを 守る 試験が 0本だった）
test('計算が 転んだ 間は 別の 成功で 字を 消しても 計算の 訳が 残る', async ({ page }) => {
  await hiraku(page);
  await korobu(page, 'buildCtx');
  await page.click('#nextM');
  await page.waitForTimeout(1500);
  expect(await errJi(page)).toContain('画面の計算で問題が出ました');
  // 計算と 関係 無い 保存（車の 名前）を 成功させる＝その 返事で 字を 消す 道を 通す
  await page.click('.tab[data-tab="set"]');
  await page.waitForTimeout(600);
  const na = page.locator('[data-car][data-f="label"]').first();
  expect(await na.count(), '★車の 名前の 欄が 無い＝この 形を 測っていない★').toBe(1);
  await na.evaluate((i) => {
    i.value = i.value + '号';
    i.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(600);
  expect(
    await page.evaluate(
      () => window.__calls.filter((x) => x.p.indexOf('dk_device_labels') === 0).length
    ),
    '★車の 名前を 送って いない＝字を 消す 道を 通って いない★'
  ).toBe(1);
  expect(await errJi(page), '★別の 成功で 計算の 訳が 消えた★').toContain(
    '画面の計算で問題が出ました'
  );
});
