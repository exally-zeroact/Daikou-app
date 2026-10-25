// ============================================================
// ★★見張り：月次集計＝実費・手で 入れた 日 の 記録が 読めない 年は 売上・給料・紙を 出さない★★ 2026-10-22
//
//   ★前★ 実費（dk_shift_edits）・手で 入れた 日（dk_manual_days）を 共通の 読みの 箱で 数えて いた ので、
//         読めない 時は 上の 帯が 出る だけで、実費を 引かない 額（1月 62,000 → 65,000 円）が
//         表と 紙 3種類（月次・月の 売上表・年の 売上表）に そのまま 出た（対立役が 測った）
//   ★今★ 別に 数え、読めない 年は 売上・給料・紙・売上／距離／電子決済の 表を 止め、訳と もう一度読む を 出す。
//         読みに 番号を 付け、古い 返事は 捨てる（年を 素早く 変えて 読みが 重なっても 止めが 外れない）
//   ★押す物の一覧（先に書く）★ 1. 月次集計を 開く 2. 紙の 種類 3. 年の 送り 4. もう一度読む
//   ★★わざと壊して 赤（2026-10-22 実測）★★ 直す 前の shukei.html … 読めない 形 2本 赤・重なり 1本 赤
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
//   ★2026-10-25 から 倉庫の 窓 dk_meisai_hi_goukei が 日ごとに 足した 額を 返す★（消した 明細は 窓の 中で 除く＝
//   supabase/apply-dk-meisai-hi-goukei.sql・当てた 後の 確かめ ATO_NO_KAKUNIN）＝まねは 窓の 返りの 形（1日 1行）
const MEISAI = [{ date: '2026-01-05', goukei: 6000 }];
// 運転手の アプリの 請求書払い（1/5 に 6,000円）＝もう 足さない
const TRIPS = [
  { fare_yen: 6000, started_at: '2026-01-05T21:00:00+09:00', payment_type: 'invoice' },
];
// ★電子決済（日ごと）★（1/5 に 4,000円）
const DAY_EXTRAS = [{ pay_date: '2026-01-05', denshi_yen: 4000 }];

function tsukuru(yomenai) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: 'mihari' };
  const hyou = {
    dk_shifts: SHIFTS,
    dk_shift_edits: EDITS,
    dk_device_labels: LABELS,
    dk_trips: TRIPS,
    dk_meisai_hi_goukei: MEISAI,
    dk_day_extras: DAY_EXTRAS,
  };
  const nakami = function (co, T, Y) {
    const S = window.DKSession;
    window.__yomenai = Y;
    const rows = (p) => T[String(p).split('?')[0]] || [];
    const kotae = (v) => ({ ok: true, status: 200, json: () => Promise.resolve(v) });
    S.ensure = () => Promise.resolve({ token: 'd' });
    S.goLogin = () => {};
    S.logout = () => {};
    S.rememberedCompanyId = () => co.company_id;
    S.pickCompany = () => ({ mode: 'one', company: co });
    S.myCompanies = () => Promise.resolve(kotae([co]));
    S.rest = (s, p) => Promise.resolve(kotae(rows(p)));
    S.softList = (s, p, st) => {
      if (st) st.tried++;
      // 読みの 筋書き（表ごとに 順に：{ dame: 読めない, ms: 遅れ }）＝読みが 重なる 形を 作る
      const plan = window.__yomiPlan && window.__yomiPlan[String(p).split('?')[0]];
      if (plan && plan.length) {
        const x = plan.shift();
        return new Promise((r) =>
          setTimeout(() => {
            if (x.dame && st) st.failed++;
            r(x.dame ? [] : rows(p));
          }, x.ms || 0)
        );
      }
      if (window.__yomenai.some((n) => String(p).indexOf(n) === 0)) {
        if (st) st.failed++;
        return Promise.resolve([]);
      }
      return Promise.resolve(rows(p));
    };
  };
  return (
    moto +
    ';(' +
    nakami.toString() +
    ')(' +
    [co, hyou, yomenai].map((x) => JSON.stringify(x)).join(',') +
    ');'
  );
}

async function akeru(page, yomenai) {
  await page.clock.setFixedTime(new Date('2026-02-15T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(yomenai),
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
  // 月の 選択肢は 読めた 年だけ 作られる（無い 時は 選ばない）
  if (await page.locator('#kamiTsuki option[value="1"]').count())
    await page.selectOption('#kamiTsuki', '1');
  await page.waitForTimeout(300);
}

// 画面に 見えて いる 字だけ（script の 中の 字を 数えない＝innerText）。
//   ★閉じた「細かい 表で 見る」も 開いて から 数える★（閉じた 中の 字は innerText に 出ない＝空振り・対立役 直す-2）
const mieru = (page) =>
  page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => {
      d.open = true;
    });
    return document.body.innerText;
  });
// 細かい 表の 切り替えを 全部 押す（売上・距離・電子決済の 表を 直に 描く 道＝表の 守りを 通す）
async function hyouOsu(page) {
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => {
      d.open = true;
    });
    const osu = (sel) => document.querySelectorAll(sel).forEach((b) => b.click());
    osu('[data-uri="year"]');
    osu('[data-uri="day"]');
    osu('[data-uri="month"]');
    osu('[data-uriwake="kuruma"]');
    osu('[data-kyori="year"]');
    osu('[data-kyori="month"]');
    const d = document.getElementById('dkSegD');
    if (d) d.click();
    const m = document.getElementById('dkSegM');
    if (m) m.click();
  });
  await page.waitForTimeout(300);
}
const kazu = (t, re) => (t.match(re) || []).length;
const kami = (page) => page.locator('#kamiMado .kami-mise-waku').count();

for (const [na, y, ji] of [
  ['実費', ['dk_shift_edits'], '実費の 記録が 読めない'],
  ['手で 入れた 日', ['dk_manual_days'], '手で 入れた 日の 記録が 読めない'],
]) {
  test(`★${na}の 記録が 読めない 年は 売上・給料・紙を 出さない・訳を 出す★`, async ({ page }) => {
    await akeru(page, y);
    for (const id of ['#kamiMonth', '#kamiUriM', '#kamiYear', '#kamiSoukouN']) {
      if (await page.locator(id).count()) {
        await page.click(id);
        await page.waitForTimeout(300);
      }
      expect(await kami(page), `★${na}が 読めないのに 紙（${id}）が 出た★`).toBe(0);
    }
    const t = await mieru(page);
    expect((t.match(/65,000/g) || []).length, '★実費を 引かない 額（65,000）が 出た★').toBe(0);
    expect((t.match(/62,000/g) || []).length, '★読めない 年に 売上（62,000）が 出た★').toBe(0);
    await expect(page.locator('#kamiMsg')).toContainText(ji);
    await expect(page.locator('#err')).toContainText(ji.replace('読めない', '読めません'));
  });
}

test('★読めた 年は 今まで 通り 紙と 売上（62,000）を 出す★', async ({ page }) => {
  await akeru(page, []);
  expect(await kami(page)).toBeGreaterThan(0);
  expect((await mieru(page)).match(/62,000/g) || []).not.toHaveLength(0);
});

test('★もう一度 読んで 読めたら 紙と 売上が 戻る★', async ({ page }) => {
  await akeru(page, ['dk_shift_edits']);
  expect(await kami(page)).toBe(0);
  await page.evaluate(() => {
    window.__yomenai = [];
  });
  await page.locator('#dkUnknownBarBtn').click();
  await expect(page.locator('#kamiMado .kami-mise-waku').first()).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#err')).toBeHidden();
});

// 年を 素早く 行き来して 読みが 2本 重なると、前の 読みの 返事が 後の 読みの 箱を 読んで 止めが 外れた（売上表で 踏んだ 形）
test('★年を 素早く 行き来して 読みが 重なっても 実費が 読めない 間は 紙・売上を 出さない★', async ({
  page,
}) => {
  await akeru(page, []);
  await page.evaluate(() => {
    window.__yomiPlan = { dk_shift_edits: [{ dame: true, ms: 800 }, { ms: 4000 }] };
  });
  await page.click('#nextY');
  await page.click('#prevY');
  await page.waitForTimeout(1500);
  expect(await kami(page), '★読み終える 前に 紙が 出た★').toBe(0);
  expect(
    (await mieru(page)).match(/65,000/g) || [],
    '★読み終える 前に 引かない 額が 出た★'
  ).toHaveLength(0);
  await expect(page.locator('#kamiMado .kami-mise-waku').first()).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#yearLabel')).toContainText('2026');
});

// ★★読めた 年 → 止めの 年へ 送った 時・古い 読みが 遅く 成功した 時★★（対立役 直す-1・直す-2）
test('★読めた 年から 実費が 読めない 年へ 送ると 細かい 表にも 前の 年の 額を 残さない★', async ({
  page,
}) => {
  await akeru(page, []);
  expect(
    kazu(await mieru(page), /62,000/g),
    '★読めた 年の 売上が 出て いない＝この 形を 測って いない★'
  ).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.__yomenai = ['dk_shift_edits'];
  });
  await page.click('#nextY');
  await expect(page.locator('#err')).toContainText('実費の 記録が 読めません');
  await hyouOsu(page);
  const t = await mieru(page);
  expect(kazu(t, /62,000/g), '★止めた 年に 前の 年の 売上（62,000）が 残った★').toBe(0);
  expect(kazu(t, /93,000/g), '★止めた 年に 前の 年の 売上（93,000）が 残った★').toBe(0);
  expect(kazu(t, /4,000/g), '★止めた 年に 前の 年の 電子決済が 残った★').toBe(0);
  expect(await kami(page)).toBe(0);
});

test('★古い 読みが 遅く 成功し 新しい 読みが 先に 失敗しても 紙・額を 出さない★', async ({
  page,
}) => {
  await akeru(page, []);
  await page.evaluate(() => {
    // 1本目（次の 年）は 遅く 成功・2本目（元の 年）は すぐ 失敗
    window.__yomiPlan = { dk_shift_edits: [{ ms: 2500 }, { dame: true, ms: 100 }] };
  });
  await page.click('#nextY');
  await page.click('#prevY');
  await page.waitForTimeout(3500); // 古い 読みの 返事も 着いた 後
  await expect(page.locator('#yearLabel')).toContainText('2026');
  await hyouOsu(page);
  expect(await kami(page), '★古い 読みの 返事で 紙が 出た★').toBe(0);
  const t = await mieru(page);
  expect(kazu(t, /62,000/g), '★古い 読みの 返事で 売上が 出た★').toBe(0);
  await expect(page.locator('#err')).toContainText('実費の 記録が 読めません');
});

// ★★上の 帯（請求書の 食い違い）・読み込み中に 押した 表★★（対立役 2回目 直す-1・直す-2）
test('★読めた 年から 止めの 年へ 送ると 請求書の 食い違いの 帯にも 前の 年の 額を 残さない★', async ({
  page,
}) => {
  await akeru(page, []);
  await expect(
    page.locator('#seikyuShirase'),
    '★読めた 年の 帯が 出て いない＝この 形を 測って いない★'
  ).toContainText('5,000');
  await page.evaluate(() => {
    window.__yomenai = ['dk_shift_edits'];
  });
  await page.click('#nextY');
  await expect(page.locator('#err')).toContainText('実費の 記録が 読めません');
  const t = await mieru(page);
  expect(kazu(t, /5,000円/g), '★止めた 年に 前の 年の 請求書の 額が 残った★').toBe(0);
  expect(kazu(t, /6,000円/g), '★止めた 年に 前の 年の 請求書の 額が 残った★').toBe(0);
});

test('★読み込み中に 表を 切り替えてから 止めで 返っても 前の 年の 額を 残さない★', async ({
  page,
}) => {
  await akeru(page, []);
  await page.evaluate(() => {
    window.__yomiPlan = { dk_shift_edits: [{ dame: true, ms: 2000 }] };
  });
  await page.click('#nextY');
  await hyouOsu(page); // 読み込み中＝前の 計算で 表が 描き直される
  await page.waitForTimeout(2500); // 止めで 返る（押し直さない）
  await expect(page.locator('#err')).toContainText('実費の 記録が 読めません');
  const t = await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => {
      d.open = true;
    });
    return document.body.innerText;
  });
  expect(kazu(t, /62,000/g), '★止めで 返った 後に 前の 年の 売上が 残った★').toBe(0);
  expect(kazu(t, /93,000/g), '★止めで 返った 後に 前の 年の 内訳が 残った★').toBe(0);
});
