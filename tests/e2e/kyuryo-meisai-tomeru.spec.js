// ============================================================
// ★★給料の 明細（確認）を 止める 道★★（2026-10-23 に kyuryo-jisuu-mitame.spec.js から 移した）
//
//   2026-10-23 司さん「給料の時数を入れるを入力の各車ごとに経費の下に時数、乗った人…して
//                       給料タブは確認と従業員の設定だけにして」
//   ⇒ 給料の「時数を入れる」の 画面を 消した。時数・乗った人・売上の 直しの 試験は 入力の 画面
//     （tests/e2e/nyuryoku-jisuu.spec.js・nyuryoku-tatamu.spec.js）へ 移した。
//   ここに 残すのは 明細（確認）の 側の 守り：
//     ①売上の 直しが 読めない 業務・役割の 決まりが 無い 人が 居れば 明細・PDF を 止める
//     ②期の 計算が 転んだ 後に 前の 期の 額で 明細・PDF を 出さない
//     ③計算が 転んだ 間は 別の 成功で 字を 消しても 計算の 訳が 残る
//   わざと壊す（2026-10-23 実測）：renderSlips の ubDame を '' に ⇒ ①（売上の 直しが 読めない）★赤★
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
const SHIFT1 = '00000000-0000-4000-a000-000000000001';

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
  await page.goto('/kyuryo.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  // 8月（材料の 月）へ
  for (let i = 0; i < 12; i++) {
    const t = await page.locator('#monthLabel').textContent();
    if (/8月/.test(t || '')) break;
    await page.click('#prevM');
    await page.waitForTimeout(500);
  }
  await expect(page.locator('#monthLabel')).toContainText('8月');
  await page.waitForTimeout(500);
}

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

const errJi = (page) =>
  page.evaluate(() => {
    const e = document.getElementById('err');
    return getComputedStyle(e).display === 'none' ? '' : e.textContent;
  });

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
