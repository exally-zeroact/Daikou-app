// ============================================================
// ★★見張り：売上表＝実費の 記録が 読めなかった 時は 実費の 欄を 打たせない（前の 額を 0 で 上書きしない）★★ 2026-10-21
//   ★前★ 実費（dk_shift_edits）の 読みが 失敗すると 手元の 記録が 空に なり、欄は 押せた。
//         橋代に 500 と 打つと {"toll_yen":0,"bridge_yen":500,"other_yen":0,"denshi_yen":0,...} を 送り、
//         倉庫の 高速代・電子決済 などを 0 で 上書きした（入力の 画面と 同じ 形・対立役が 測った）
//   ★今★ 実費の 読みが 失敗した 月は 表の 数字・紙・実費の 欄を 出さず、訳を 出す。保存の 口（saveEdit）も 断る
//         （対立役 U-1：欄だけ 止めた 版は 紙と 合計が 引く 前の ¥40,000＝13,220円 多く 出た）
//   ★★わざと壊して 赤に なるのを 見た（2026-10-21 実測）★★
//     直す 前の uriage.html（5c90474 系）… 読めない 形 1本 赤（欄が 押せた・紙が 出た）
//     欄だけ 止めた 版（7d6c420）……………… 読めない 形 1本 赤（紙と 合計が 出た）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = '11111111-2222-3333-4444-555555555555';
test.use({ timezoneId: 'Asia/Tokyo' });

const SHIFTS = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-01-05T20:00:00+09:00',
    ended_at: '2026-01-06T04:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 40000,
    trip_count: 12,
  },
];
// 倉庫の 高速代 1000・橋代 2220・電子決済 300
const EDITS = [
  { shift_id: 's1', toll_yen: 1000, bridge_yen: 2220, other_yen: 0, denshi_yen: 300, hours: 8 },
];
const LABELS = [{ device_id: 'd1', label: '4987', sort_order: 1 }];

function tsukuru(yomenai) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  const nakami = function (co, T, yomenai) {
    window.__okutta = [];
    const S = window.DKSession;
    const rows = (p) => T[String(p).split('?')[0]] || [];
    const kotae = (v) => ({ ok: true, status: 200, json: () => Promise.resolve(v) });
    S.ensure = () => Promise.resolve({ token: 'd' });
    S.goLogin = () => {};
    S.logout = () => {};
    S.rememberedCompanyId = () => co.company_id;
    S.pickCompany = () => ({ mode: 'one', company: co });
    S.myCompanies = () => Promise.resolve(kotae([co]));
    S.rest = (s, p, o) => {
      const m = (o && o.method) || 'GET';
      if (m !== 'GET') {
        let b = null;
        try {
          b = JSON.parse(o.body);
        } catch (_) {
          b = null;
        }
        window.__okutta.push({ p: String(p), m: m, b: b });
        return Promise.resolve(kotae([b]));
      }
      // 業務の 読みを 落とす（読みが 失敗した 後の 形を 作る）
      if (window.__shiftsFail && String(p).indexOf('dk_shifts') === 0)
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve([]) });
      return Promise.resolve(kotae(rows(p)));
    };
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
      // 開いた 後で 読めない 表を 変える（もう一度 読む の 試験）
      const dameNo = window.__yomenai || yomenai;
      if (dameNo.some((n) => String(p).indexOf(n) === 0)) {
        if (st) st.failed++;
        return Promise.resolve([]);
      }
      return Promise.resolve(rows(p));
    };
  };
  const T = {
    dk_shifts: SHIFTS,
    dk_shift_edits: EDITS,
    dk_device_labels: LABELS,
    dk_sales_settings: [],
    dk_expense_kinds: [],
    dk_uriage_rireki: [],
  };
  return (
    moto +
    ';(' +
    nakami.toString() +
    ')(' +
    [co, T, yomenai].map((x) => JSON.stringify(x)).join(',') +
    ');'
  );
}

async function akeru(page, yomenai) {
  await page.clock.setFixedTime(new Date('2026-01-20T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(yomenai),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/uriage.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#monthLabel')).toContainText('1月', { timeout: 15000 });
  // 読み終えた 印＝紙が 出た か「紙は 出せません」の 訳が 出た（描く 前に 数えて 偽の 緑に しない）
  await page.waitForFunction(
    () =>
      document.querySelector('#kamiMado .kami-mise-waku') ||
      /出せません/.test((document.getElementById('kamiMsg') || {}).textContent || ''),
    null,
    { timeout: 15000 }
  );
}
async function hiraku(page, yomenai) {
  await page.clock.setFixedTime(new Date('2026-01-20T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(yomenai),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/uriage.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#kamiMado .kami-mise-waku').first()).toBeVisible({ timeout: 15000 });
  await page.locator('summary', { hasText: '一覧で 見る' }).click();
  await page.locator('button.rmore', { hasText: '実費を 入れる' }).first().click();
  await expect(page.locator('.dedit input.yen').first()).toBeVisible();
}
const oseru = (page) =>
  page.evaluate(
    () => [...document.querySelectorAll('input.yen')].filter((i) => !i.disabled).length
  );
// 押せない 欄にも 字を 入れて change を 起こす（保存の 口が 断るかも 見る）
async function utsuMuri(page, f, v) {
  await page.evaluate(
    (a) => {
      const i = document.querySelector('.dedit input.yen[data-f="' + a.f + '"]');
      i.value = a.v;
      i.dispatchEvent(new Event('change'));
    },
    { f, v }
  );
  await page.waitForTimeout(600);
}
const okutta = (page) =>
  page.evaluate(() => window.__okutta.filter((x) => x.p.indexOf('dk_shift_edits') === 0));

test('★実費の 記録が 読めない 時は 表の 数字・紙・実費の 欄を 出さない・送らない・訳を 出す★', async ({
  page,
}) => {
  await akeru(page, ['dk_shift_edits']);
  expect(
    await page.locator('#kamiMado .kami-mise-waku').count(),
    '★読めないのに 紙（引く 前の 額）が 出た★'
  ).toBe(0);
  expect(await oseru(page), '★読めないのに 押せる 実費の 欄が 在る★').toBe(0);
  expect(
    await page.locator('#list .row').count(),
    '★読めないのに 表の 数字（引く 前の 額）が 出た★'
  ).toBe(0);
  await expect(page.locator('#err'), '★止めた 訳が 出ていない★').toContainText('読めません');
  await expect(page.locator('#kamiMsg'), '★紙を 出さない 訳が 出ていない★').toContainText(
    '実費の 記録が 読めない'
  );
  expect(
    await okutta(page),
    '★読めないのに 倉庫へ 送った（高速代 などを 0 で 上書きする）★'
  ).toEqual([]);
});
test('★読めた 時は 今まで 通り 打てて、高速代・電子決済は 前の 額の まま 送る★', async ({
  page,
}) => {
  await hiraku(page, []);
  expect(await oseru(page), '★読めたのに 押せない★').toBeGreaterThan(0);
  await utsuMuri(page, 'bridge', '500');
  const o = await okutta(page);
  expect(o.length, '★読めたのに 送らない★').toBe(1);
  expect(o[0].b, '★前の 額を 0 で 上書きした★').toMatchObject({
    toll_yen: 1000,
    bridge_yen: 500,
    denshi_yen: 300,
  });
});

// ★★読みが 重なっても・手で 入れた 日が 読めなくても 引く 前の 額を 出さない★★ 2026-10-21（対立役 2回目 S-1・D-2・D-4・D-5）
const kami = (page) => page.locator('#kamiMado .kami-mise-waku').count();
const gyou = (page) => page.locator('#list .row').count();

// S-1：読みごとの 箱が 外の 変数で、前の 読みの 返事が 後の 読みの 箱を 読んだ
//   ⇒ 実費が 読めない 月に 紙「40,000」・表「¥40,000」・押せる 欄が 出て、橋代を 打つと 高速代・電子決済を 0 で 送った
test('★読みが 2本 重なっても 実費が 読めない 間は 紙・表・欄を 出さない★', async ({ page }) => {
  await akeru(page, []);
  expect(await kami(page), '★読めた 時の 紙が 出ない＝この 形を 測っていない★').toBeGreaterThan(0);
  await page.evaluate(() => {
    window.__yomiPlan = { dk_shift_edits: [{ dame: true, ms: 800 }, { ms: 4000 }] };
  });
  await page.locator('#nextM').click();
  await page.locator('#prevM').click();
  await page.waitForTimeout(1500);
  expect(await kami(page), '★読み終える 前に 紙（引く 前の 額）が 出た★').toBe(0);
  expect(await gyou(page), '★読み終える 前に 表の 数字が 出た★').toBe(0);
  expect(await oseru(page), '★読み終える 前に 押せる 実費の 欄が 在る★').toBe(0);
  expect(await okutta(page), '★読み終える 前に 送った★').toEqual([]);
  // 後の 読みが 着けば 戻る
  await expect(page.locator('#kamiMado .kami-mise-waku').first()).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#monthLabel')).toContainText('1月');
});

// D-2：手で 入れた 日が 読めない 月も 紙が 出た（その 車の 売上が 抜けた 額）
test('★手で 入れた 日の 記録が 読めない 月は 紙・表を 出さず 訳を 出す★', async ({ page }) => {
  await akeru(page, ['dk_manual_days']);
  expect(await kami(page), '★手で 入れた 日が 読めないのに 紙が 出た★').toBe(0);
  expect(await gyou(page), '★手で 入れた 日が 読めないのに 表の 数字が 出た★').toBe(0);
  await expect(page.locator('#kamiMsg')).toContainText('手で 入れた 日の 記録が 読めない');
  await expect(page.locator('#err')).toContainText('手で 入れた 日の 記録が 読めません');
});

// D-4：「もう一度読む」で 読めても 黄色い 帯が 残った（読みの 数を 1回 作った 箱の まま 足していた）
test('★もう一度 読んで 読めたら 紙・表が 戻り 黄色い 帯も 消える★', async ({ page }) => {
  await akeru(page, ['dk_shift_edits']);
  await expect(page.locator('#dkUnknownBar')).toBeVisible();
  await page.evaluate(() => {
    window.__yomenai = [];
  });
  await page.locator('#dkUnknownBarBtn').click();
  await expect(page.locator('#kamiMado .kami-mise-waku').first()).toBeVisible({ timeout: 8000 });
  expect(await gyou(page)).toBeGreaterThan(0);
  await expect(page.locator('#dkUnknownBar'), '★読めたのに 帯が 残った★').toBeHidden();
  await expect(page.locator('#err')).toBeHidden();
});

// D-5：読めない 月に 設定の チェックを 押すと その 保存の 成功で 訳が 消えた（表は 空の まま 黙った）
test('★実費が 読めない 月に 設定を 変えても 止めた 訳は 消えない★', async ({ page }) => {
  await akeru(page, ['dk_shift_edits']);
  await page.evaluate(() => {
    const i = document.getElementById('dHi');
    i.value = '';
    i.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const i = document.getElementById('dToll');
    i.checked = !i.checked;
    i.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(800);
  await expect(page.locator('#err'), '★止めた 訳が 消えた★').toContainText('読めません');
});

// ★★読みが 失敗した 後・何日からの 保存の 後★★ 2026-10-21（対立役 3回目 止め-1・止め-2・直す-1）
// 止め-2：読み始めに 止めの 印を 下ろした ので、次の 月の 業務の 読みが 失敗した 後に 車ごと／日ごとを 押すと
//   前の 月の 記録で 表（引く 前の ¥40,000）と 押せる 欄が 出て、橋代を 打つと 高速代・電子決済を 0 で 送った
test('★次の 月の 読みが 失敗した 後に 表を 切り替えても 前の 月の 額・欄を 出さない・送らない★', async ({
  page,
}) => {
  await akeru(page, ['dk_shift_edits']);
  await page.evaluate(() => {
    window.__yomenai = [];
    window.__shiftsFail = true;
  });
  await page.locator('#nextM').click();
  await expect(page.locator('#err')).toContainText('読み込みに失敗しました');
  await page.locator('summary', { hasText: '一覧で 見る' }).click();
  await page.locator('#segCar').click();
  await page.locator('#segDay').click();
  await page.locator('#segCar').click();
  await page.waitForTimeout(300);
  expect(await gyou(page), '★読みが 失敗した 月に 前の 月の 表（引く 前の 額）が 出た★').toBe(0);
  expect(await oseru(page), '★読みが 失敗した 月に 押せる 実費の 欄が 在る★').toBe(0);
  expect(await okutta(page), '★読みが 失敗した 月に 送った★').toEqual([]);
  // 出口：紙の 所は「読み込み中…」の まま に しない・もう一度読む が 出る（対立役 3回目 直す-1）
  await expect(page.locator('#kamiMsg')).toContainText('読み込みに 失敗した');
  await expect(page.locator('#dkUnknownBarBtn')).toBeVisible();
});

// 止め-1：「何日から」の 保存の 後の 読み直しに 箱を 渡して おらず、書けたのに 画面が 転び「保存できませんでした」・チェックが 押せない まま
test('★何日からの 保存の 後も 画面が 転ばず「保存しました」・続けて 押せる★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(String(e)));
  await akeru(page, []);
  await page.fill('#dHi', '2026-01-06');
  await page.dispatchEvent('#dHi', 'change');
  await page.click('#dOther');
  await page.waitForTimeout(600);
  expect(err, '★何日からの 保存の 後に 画面が 転んだ★').toEqual([]);
  await expect(page.locator('#err')).toBeHidden();
  await expect(page.locator('#setSaved')).toContainText('保存しました');
  await expect(page.locator('#dOther'), '★保存の 後に チェックが 押せない★').toBeEnabled();
  await page.click('#dOther');
  await page.waitForTimeout(600);
  expect(err).toEqual([]);
});

// 止め-2 の 兄弟（N2〜N4）：読み込み中に 日ごと／車ごとを 押すと 新しい 月の 名前の 下に 前の 月の 額が 出た
test('★読み込み中に 表を 切り替えても 前の 月の 額を 出さない★', async ({ page }) => {
  await akeru(page, []);
  await page.locator('summary', { hasText: '一覧で 見る' }).click();
  await page.evaluate(() => {
    window.__yomiPlan = { dk_shift_edits: [{ ms: 4000 }] };
  });
  await page.locator('#nextM').click();
  await page.waitForTimeout(300);
  await page.locator('#segDay').click();
  await page.locator('#segCar').click();
  await page.waitForTimeout(300);
  expect(await gyou(page), '★読み込み中に 前の 月の 表が 出た★').toBe(0);
  await expect(page.locator('#monthLabel')).toContainText('2月');
});

// ★★読みが 失敗した 時の 出口・後半で 計算が 転んだ 時★★ 2026-10-21（対立役 4回目 直す-1・直す-2）
// 直す-2：上の 試験は 1月から 帯が 出ていて、紙の 字も 切り替えで 作られる＝読み失敗の 出口を 外しても 緑だった
test('★読めた 月から 次の 月の 読みが 失敗すると すぐ 紙の 訳と もう一度読む が 出る★', async ({
  page,
}) => {
  await akeru(page, []);
  await expect(page.locator('#dkUnknownBar')).toBeHidden();
  await page.evaluate(() => {
    window.__shiftsFail = true;
  });
  await page.locator('#nextM').click();
  await expect(page.locator('#err')).toContainText('読み込みに失敗しました');
  await expect(page.locator('#kamiMsg'), '★紙の 所が「読み込み中…」の まま★').toContainText(
    '読み込みに 失敗した'
  );
  await expect(page.locator('#dkUnknownBarBtn'), '★もう一度読む が 出ない★').toBeVisible();
  // もう一度 読んで 読めたら 戻る
  await page.evaluate(() => {
    window.__shiftsFail = false;
  });
  await page.locator('#dkUnknownBarBtn').click();
  await expect(page.locator('#dkUnknownBar')).toBeHidden({ timeout: 8000 });
  await expect(page.locator('#err')).toBeHidden();
});

// 直す-1：読みの 後半（計算・描き）で 転ぶと、失敗した 月が「この 月の 読みは 通った」の まま 0円の 紙を 出した
test('★読みの 後半で 計算が 転んだ 月は 表を 切り替えても 0円の 紙・表を 出さない★', async ({
  page,
}) => {
  await akeru(page, []);
  await page.evaluate(() => {
    const A = window.UriageAgg;
    const o = A.byDevice;
    window.__nage = 1;
    A.byDevice = function () {
      if (window.__nage-- > 0) throw new Error('見張り');
      return o.apply(this, arguments);
    };
  });
  await page.locator('#nextM').click();
  await expect(page.locator('#err')).toContainText('読み込みに失敗しました');
  await page.locator('summary', { hasText: '一覧で 見る' }).click();
  await page.locator('#segDay').click();
  await page.locator('#segCar').click();
  await page.waitForTimeout(300);
  expect(await kami(page), '★計算が 転んだ 月に 紙（0円）が 出た★').toBe(0);
  // 「記録が ありません」は #msg に 出る（#list で 見ると 空振り・対立役 5回目 見立て-3）
  await expect(
    page.locator('#msg'),
    '★計算が 転んだ 月に「記録が ありません」と 出した★'
  ).not.toContainText('まだ記録がありません');
});

// P3：失敗の 後に 前の 月の「記録が 読めない（開き直して）」の 訳が 出た（対立役 4回目）＝試験で 縛って いなかった（5回目 直す-A）
test('★前の 月で 記録が 読めず 次の 月の 読みが 失敗したら 訳は「読み込みに失敗」★', async ({
  page,
}) => {
  await akeru(page, ['dk_uriage_rireki']);
  await expect(page.locator('#err')).toContainText('売上から 引く 物の 変えた 記録');
  await page.evaluate(() => {
    window.__shiftsFail = true;
  });
  await page.locator('#nextM').click();
  await expect(page.locator('#err')).toContainText('読み込みに失敗しました');
  await page.locator('summary', { hasText: '一覧で 見る' }).click();
  await page.locator('#segDay').click();
  await page.locator('#segCar').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#err'), '★前の 月の「開き直して」の 訳に 替わった★').toContainText(
    '読み込みに失敗しました'
  );
  await expect(page.locator('#kamiMsg')).toContainText('読み込みに 失敗した');
});

// P7：表を 描いた 後に 転ぶと、数字と 紙の 絵が「読み込みに失敗」と 並んで 残った
test('★表を 描いた 後に 転んでも 数字と 紙の 絵を 残さない★', async ({ page }) => {
  await akeru(page, []);
  await page.locator('summary', { hasText: '一覧で 見る' }).click();
  await page.evaluate(() => {
    const D = window.DKSession;
    const o = D.showUnknownBar;
    window.__nage = 1;
    D.showUnknownBar = function () {
      if (window.__nage-- > 0) throw new Error('見張り');
      return o.apply(this, arguments);
    };
  });
  await page.locator('#nextM').click();
  await expect(page.locator('#err')).toContainText('読み込みに失敗しました');
  expect(await kami(page), '★失敗の 訳と 紙の 絵が 並んだ★').toBe(0);
  expect(await gyou(page), '★失敗の 訳と 表の 数字が 並んだ★').toBe(0);
});

// ★★開いた 最初の 読みが 失敗した 時★★ 2026-10-22（対立役 P9）
//   ★前★ 記録の 一覧（RIREKI）が 始めの 空の 箱 [] の まま 残り「読めた」と 見なされ、
//         読んでいない 設定・記録の まま「何日から」の 記録と 設定の 列を 書けた
//   ★今★ 一度も 読めていない 間は 設定も 記録も 書かず、訳を 出す
for (const hi of ['2026-01-10', '']) {
  test(`★最初の 読みが 失敗したら 設定を 変えても 送らない（何日から＝${hi || '空'}）★`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__shiftsFail = true;
    });
    await akeru(page, []);
    await expect(page.locator('#err')).toContainText('読み込みに失敗しました');
    await page.evaluate((hi) => {
      const d = document.getElementById('dHi');
      d.value = hi;
      d.dispatchEvent(new Event('change'));
      const i = document.getElementById('dToll');
      i.checked = !i.checked;
      i.dispatchEvent(new Event('change'));
    }, hi);
    await page.waitForTimeout(800);
    const okutta = await page.evaluate(() => window.__okutta);
    expect(okutta, '★読めていない 設定・記録の まま 書いた★').toEqual([]);
    await expect(page.locator('#err')).toContainText('保存しません');
  });
}
