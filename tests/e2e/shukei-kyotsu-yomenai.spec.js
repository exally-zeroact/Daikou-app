// ============================================================
// ★★見張り：月次集計＝売上・給料の もとの 記録（勤務・人・乗った人・明細・電子決済・手当 等）が 読めない 年は 止める★★ 2026-10-22
//
//   ★前★ 共通の 読み（9本）は 読めないと [] を 返し、上の 帯（数字は「—」）を 出す だけ。
//         shukei.html に 止める 所が 0か所＝売上 0円・現金が 多い 額の 表と 紙が そのまま 出た。
//         箱も 1つを 使い回し 0 に 戻さなかった＝一度 読めないと 読み直しても 数が 残った
//   ★今★ 読みごとの 箱で 数え、1本でも 読めない 年は 実費と 同じ 止めの 枝（表・紙を 出さない・訳と もう一度読む）
//   ★本物の 数え方（DKSession.softList の hitoTsu・1000行 ずつ 読む zenbuYomu）を 通す★＝倉庫の 返事（rest）だけ 差し替える（対立役 指摘3）
//   ★押す物の一覧（先に書く）★ 1. 月次集計を 開く 2. 紙の 種類 3. 年の 送り 4. もう一度読む
//   ★★わざと壊して 赤（2026-10-22 手元 chromium 実測・14本の時）★★ 直す 前の shukei.html＝13赤／soft を 古い 箱 LOAD へ＝11赤／
//     recalc から KYOTSU_YOMI を 外す＝13赤／meisaiZenbu(LOAD)＝2赤／LOAD = ky を 外す＝12赤／
//     （15本に して）帯の 数を 二重に 足す＝12赤／古い 返事を 捨てる 行を 外す＝1赤
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
test.use({ timezoneId: 'Asia/Tokyo' });

const CO = '11111111-2222-3333-4444-555555555555';

// ★2台 × 2日（1月）＋ 別の月（3月）★
const SHIFTS = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-01-05T20:00:00+09:00',
    ended_at: '2026-01-06T04:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 40000,
    trip_count: 12,
    actual_total_m: 80000,
    total_distance_m: 150000,
  },
  {
    shift_id: 's2',
    device_id: 'd2',
    started_at: '2026-01-05T20:00:00+09:00',
    ended_at: '2026-01-06T04:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 25000,
    trip_count: 8,
    actual_total_m: 50000,
    total_distance_m: 90000,
  },
  {
    shift_id: 's3',
    device_id: 'd1',
    started_at: '2026-03-10T20:00:00+09:00',
    ended_at: '2026-03-11T04:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 31000,
    trip_count: 9,
    actual_total_m: 61000,
    total_distance_m: 110000,
  },
];
// ★高速代（実費）★＝売上から 引かれる
// 請求書の 額を 入力で 5,000 と 打った（請求書アプリは 6,000）＝食い違いの 知らせの 帯が 出る 形
const EDITS = [
  { shift_id: 's1', toll_yen: 3000, bridge_yen: 0, other_yen: 0, hours: 8, seikyu_yen: 5000 },
];
const LABELS = [
  { device_id: 'd1', label: '4987', sort_order: 1 },
  { device_id: 'd2', label: '1466', sort_order: 2 },
];
// ★★請求書の もと＝請求書アプリの 明細（meisai）★★ 2026-10-06（1/5 に 6,000円）
//   ★消した 明細（9,999円）は 数えない★／★運転手の アプリの 請求書払い（TRIPS）は もう 数えない★
//   （TRIPS を 6,000 の まま 残す＝二重に 数えたら 現金が 46,000 に なって 赤）
const MEISAI = [
  { date: '2026-01-05', amount: 6000, deleted_at: null },
  { date: '2026-01-05', amount: 9999, deleted_at: '2026-01-06T00:00:00Z' },
];
// 運転手の アプリの 請求書払い（1/5 に 6,000円）＝もう 足さない
const TRIPS = [
  { fare_yen: 6000, started_at: '2026-01-05T21:00:00+09:00', payment_type: 'invoice' },
];
// ★電子決済（日ごと）★（1/5 に 4,000円）
const DAY_EXTRAS = [{ pay_date: '2026-01-05', denshi_yen: 4000 }];

// 1000行 ずつ 読む 表の「2枚目で 切れる」形を 作る 為の 埋め草（1枚目を 満杯に する・額は 0円）
function umekusa(na, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (na === 'meisai') out.push({ date: '2026-02-01', amount: 0, deleted_at: null });
    else
      out.push({
        shift_id: 'u' + i,
        device_id: 'd9',
        started_at: '2026-02-01T10:00:00+09:00',
        ended_at: '2026-02-01T10:01:00+09:00',
        elapsed_sec: 60,
        fare_total_yen: 0,
        trip_count: 0,
        actual_total_m: 0,
        total_distance_m: 0,
      });
  }
  return out;
}

function tsukuru(dame, nimaime) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: 'mihari' };
  const hyou = {
    dk_shifts: SHIFTS,
    dk_shift_edits: EDITS,
    dk_device_labels: LABELS,
    dk_trips: TRIPS,
    meisai: MEISAI,
    dk_day_extras: DAY_EXTRAS,
  };
  const ume = { dk_shifts: umekusa('dk_shifts', 1000), meisai: umekusa('meisai', 1000) };
  const nakami = function (co, T, D, N, U) {
    const S = window.DKSession;
    window.__dame = D; // 読めない 表（全部の 読み）
    window.__nimaime = N; // 2枚目（offset=1000）だけ 読めない 表
    const na = (p) => String(p).split('?')[0];
    const kotae = (v) => ({ ok: true, status: 200, json: () => Promise.resolve(v) });
    const dameKotae = () => ({ ok: false, status: 500, json: () => Promise.resolve({}) });
    S.ensure = () => Promise.resolve({ token: 'd' });
    S.goLogin = () => {};
    S.logout = () => {};
    S.rememberedCompanyId = () => co.company_id;
    S.pickCompany = () => ({ mode: 'one', company: co });
    S.myCompanies = () => Promise.resolve(kotae([co]));
    // ★softList は 差し替えない★＝本物の 数え方（!r.ok で 数える・1000行 ずつ 読む）を 通る。
    //   中の rest は 閉じた 関数で window.fetch を 呼ぶ＝S.rest を 替えても 届かない ので 倉庫への fetch を ここで 答える
    const hen = (s, p) => {
      const n = na(p);
      const off = Number((/[?&]offset=(\d+)/.exec(String(p)) || [])[1] || 0);
      // 読みの 筋書き（表ごとに 順に：{ dame: 読めない, ms: 遅れ }）＝読みが 重なる 形を 作る
      const plan = window.__yomiPlan && window.__yomiPlan[n];
      if (plan && plan.length) {
        const x = plan.shift();
        return new Promise((r) =>
          setTimeout(() => {
            window.__planTsuita = (window.__planTsuita || 0) + 1; // 返事が 着いた 数（決め打ちの 待ちに しない・対立役 B）
            r(x.dame ? dameKotae() : kotae(T[n] || []));
          }, x.ms || 0)
        );
      }
      if (window.__dame.indexOf(n) >= 0) return Promise.resolve(dameKotae());
      if (window.__nimaime.indexOf(n) >= 0 && U[n]) {
        if (off >= 1000) return Promise.resolve(dameKotae());
        return Promise.resolve(kotae(U[n]));
      }
      if (off > 0) return Promise.resolve(kotae([]));
      return Promise.resolve(kotae(T[n] || []));
    };
    S.rest = hen;
    const motoFetch = window.fetch;
    window.fetch = (u, o) => {
      const k = String(u).split('/rest/v1/');
      if (k.length === 2) return hen(null, k[1]);
      return motoFetch(u, o);
    };
  };
  return (
    moto +
    ';(' +
    nakami.toString() +
    ')(' +
    [co, hyou, dame, nimaime, ume].map((x) => JSON.stringify(x)).join(',') +
    ');'
  );
}

async function akeru(page, dame, nimaime) {
  await page.clock.setFixedTime(new Date('2026-02-15T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(dame, nimaime || []),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#yearLabel')).toContainText('2026', { timeout: 15000 });
  // 読み終えた 印＝紙が 出た か「紙は 出せません」の 訳が 出た
  await page.waitForFunction(
    () =>
      document.querySelector('#kamiMado .kami-mise-waku') ||
      /出せません/.test((document.getElementById('kamiMsg') || {}).textContent || ''),
    null,
    { timeout: 15000 }
  );
  if (await page.locator('#kamiTsuki option[value="1"]').count())
    await page.selectOption('#kamiTsuki', '1');
  await page.waitForTimeout(300);
}

const mieru = (page) =>
  page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => {
      d.open = true;
    });
    return document.body.innerText;
  });
const kazu = (t, re) => (t.match(re) || []).length;
const kami = (page) => page.locator('#kamiMado .kami-mise-waku').count();
const JI = '勤務・売上・給料の もとの 記録が 読めない';

async function tomatta(page, na) {
  for (const id of ['#kamiMonth', '#kamiUriM', '#kamiYear', '#kamiSoukouN']) {
    if (await page.locator(id).count()) {
      await page.click(id);
      await page.waitForTimeout(300);
    }
    expect(await kami(page), `★${na}が 読めないのに 紙（${id}）が 出た★`).toBe(0);
  }
  const t = await mieru(page);
  expect(kazu(t, /62,000/g), `★${na}が 読めない 年に 売上（62,000）が 出た★`).toBe(0);
  await expect(page.locator('#kamiMsg')).toContainText(JI);
  await expect(page.locator('#err')).toContainText(JI.replace('読めない', '読めません'));
  await expect(page.locator('#dkUnknownBarBtn'), '★もう一度読む が 出て いない★').toBeVisible();
  // 帯の 件数は 今の 読みの 数だけ（足し算が 二重でも 見える 所は 同じ＝件数で 縛る・対立役 A）
  await expect(page.locator('#dkUnknownBarMsg')).toContainText('（1件）');
}

test('★読めた 年は 今まで 通り 紙と 売上（62,000）を 出す（この 形で 測れて いる 印）★', async ({
  page,
}) => {
  await akeru(page, []);
  expect(await kami(page)).toBeGreaterThan(0);
  expect(kazu(await mieru(page), /62,000/g)).toBeGreaterThan(0);
});

for (const na of [
  'dk_shifts',
  'dk_device_labels',
  'dk_employees',
  'dk_work_hours',
  'dk_sales_settings',
  'meisai',
  'dk_month_extras',
  'dk_day_extras',
  'dk_pay_adjustments',
]) {
  test(`★${na} が 読めない 年は 売上・給料・紙を 出さない・訳と もう一度読む を 出す★`, async ({
    page,
  }) => {
    await akeru(page, [na]);
    await tomatta(page, na);
  });
}

// 1000行 ずつ 読む 表は 1枚目が 読めて 2枚目で 切れる 形も 在る（対立役 指摘3）
for (const na of ['dk_shifts', 'meisai']) {
  test(`★${na} が 2枚目（1000行 目から）で 読めない 年も 止める★`, async ({ page }) => {
    await akeru(page, [], [na]);
    await tomatta(page, na + ' の 2枚目');
  });
}

test('★もう一度 読んで 読めたら 紙と 売上が 戻り、帯も 消える（読めなかった 数が 残らない）★', async ({
  page,
}) => {
  await akeru(page, ['dk_employees']);
  expect(await kami(page)).toBe(0);
  await page.evaluate(() => {
    window.__dame = [];
  });
  await page.locator('#dkUnknownBarBtn').click();
  await expect(page.locator('#kamiMado .kami-mise-waku').first()).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#err')).toBeHidden();
  await expect(
    page.locator('#dkUnknownBar'),
    '★読めたのに 帯が 残った（前の 数が 残った）★'
  ).toBeHidden();
  expect(kazu(await mieru(page), /62,000/g)).toBeGreaterThan(0);
});

test('★古い 読みが 遅く 成功し 新しい 読みが 先に 失敗しても 紙・額を 出さない★', async ({
  page,
}) => {
  await akeru(page, []);
  await page.evaluate(() => {
    // 1本目（次の 年）は 遅く 成功・2本目（元の 年）は すぐ 失敗
    window.__yomiPlan = { dk_employees: [{ ms: 2500 }, { dame: true, ms: 100 }] };
  });
  await page.click('#nextY');
  await page.click('#prevY');
  // 古い 読みの 返事も 着いた 後（2本 着いた 印を 待つ）
  await page.waitForFunction(() => window.__planTsuita >= 2, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  await expect(page.locator('#yearLabel')).toContainText('2026');
  expect(await kami(page), '★古い 読みの 返事で 紙が 出た★').toBe(0);
  expect(kazu(await mieru(page), /62,000/g), '★古い 読みの 返事で 売上が 出た★').toBe(0);
  await expect(page.locator('#err')).toContainText(JI.replace('読めない', '読めません'));
});

test('★2つ 読めない 時は 帯に 2件・同じ 失敗で もう一度 読んでも 件数が 積み上がらない★', async ({
  page,
}) => {
  await akeru(page, ['dk_shift_edits', 'dk_employees']);
  expect(await kami(page)).toBe(0);
  await expect(page.locator('#dkUnknownBarMsg')).toContainText('（2件）');
  await page.locator('#dkUnknownBarBtn').click();
  await page.waitForFunction(
    () => /出せません/.test((document.getElementById('kamiMsg') || {}).textContent || ''),
    null,
    { timeout: 8000 }
  );
  await page.waitForTimeout(500);
  await expect(page.locator('#dkUnknownBarMsg')).toContainText('（2件）');
  expect(await kami(page)).toBe(0);
});
