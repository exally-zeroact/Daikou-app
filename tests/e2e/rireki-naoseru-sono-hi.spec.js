// ============================================================
// ★★運転手が 履歴で 直せるのは「その日の 営業」だけ★★ 2026-10-22
//
//   ★司さんの言葉★
//     「やっぱり運転手の修正はその日の営業だけにしろ キャンセルや履歴での金額の編集や後から請求書など全て」
//     「その日の営業」＝「業務終了を押すまで」／「再開してもその日の分しか修正さすな」／切れ目＝「正午」
//
//   ★ここで 見張る 事（画面の 絵で 見る＝押せる 行の 数・直す 画面が 開いたか・字）★
//     ① 業務中の 同じ 夜：その 夜の 代行だけ 押せる・押すと 直す 画面が 開く・但し書きが 見える
//     ② 業務終了の 後（limbo）：1つも 押せない・直に 開こうと しても 開かず 知らせが 出る
//     ③ 次の 日の 正午を 越えて「続ける」で 再開：再開した 後の 代行だけ 押せる
//   判じは js/trip-edit.js の naoseru（単体の 表は tests/unit/trip-edit.test.js）
// ============================================================
const { test, expect } = require('@playwright/test');

// ★時計を 止める なら 時間帯も 止める★（tests/unit/tokei-tomeru-nara-jikantai-mo.test.js・客は 日本に 居る）
test.use({ timezoneId: 'Asia/Tokyo' });

const KAISHI = Date.parse('2026-10-21T20:00:00+09:00');
const T_MAE = Date.parse('2026-10-20T21:00:00+09:00'); // 前の 日の 業務の 代行
const T1 = Date.parse('2026-10-21T21:00:00+09:00'); // その 夜の 代行
const T2 = Date.parse('2026-10-22T20:10:00+09:00'); // 次の 日に 再開した 後の 代行

function ride(t, fare) {
  return {
    trip_key: t,
    start_time: t,
    end_time: t + 20 * 60000,
    time: '',
    distance_m: 4000,
    fare: fare,
    meter_fare: fare,
    extras: [],
    discounts: [],
  };
}
function trip(t, fare) {
  return {
    start_time: t,
    end_time: t + 20 * 60000,
    distance_m: 4000,
    fare_yen: fare,
    payment_type: 'cash',
    customer_id: null,
  };
}

async function hiraku(page, o) {
  // ★外の 読み込み（字体の CSS・見張りの 道具 2つ）は 止める★（外の 通信が 弱い 日に goto が 30秒 切れに なった・
  //   memory reference_goto_jikangire_wa_soto_no_cdn。どれも 無くても 履歴の 画面は 動く）
  await page.route(
    /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|browser\.sentry-cdn\.com|static\.openreplay\.com)\//,
    (r) => r.abort()
  );
  await page.clock.setFixedTime(new Date(o.ima));
  await page.addInitScript((x) => {
    localStorage.setItem('tutorial_done', '1');
    localStorage.setItem('daikome_training_consent', 'declined');
    const day = (t) => 'daikou_history_' + new Date(t).toDateString();
    const rides = {};
    x.rides.forEach((r) => {
      const k = day(r.start_time);
      rides[k] = rides[k] || [];
      rides[k].push(r);
    });
    Object.keys(rides).forEach((k) => localStorage.setItem(k, JSON.stringify(rides[k])));
    localStorage.setItem('daikou_business_state', JSON.stringify(x.state));
    localStorage.setItem('daikou_business_history', JSON.stringify(x.hist));
  }, o);
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    if (typeof window.showOverlay === 'function') window.showOverlay('history');
    if (typeof window._hist_render === 'function') window._hist_render();
  });
}

const MAE_GYOUMU = {
  start_time: Date.parse('2026-10-20T20:00:00+09:00'),
  end_time: Date.parse('2026-10-21T01:00:00+09:00'),
  trips: [trip(T_MAE, 3000)],
  fare_total_yen: 3000,
  trip_count: 1,
};

// わざと壊す：.tappable を 付ける 所の _te_naoseru を 外す ⇒ 赤（前の 日の 代行まで 押せる＝2本）
test('① 業務中の 同じ 夜は その 夜の 代行だけ 押せて 直す 画面が 開く・但し書きが 見える', async ({
  page,
}) => {
  await hiraku(page, {
    ima: Date.parse('2026-10-22T01:30:00+09:00'), // 日付を またいだ 夜中
    rides: [ride(T_MAE, 3000), ride(T1, 2500)],
    state: {
      active: true,
      ended: false,
      start_time: KAISHI,
      trips: [trip(T1, 2500)],
      fare_total_yen: 2500,
      trip_count: 1,
    },
    hist: [MAE_GYOUMU],
  });
  const ov = page.locator('#overlayHistory');
  await expect(ov.locator('.ride-item')).toHaveCount(2);
  await expect(ov.locator('.ride-item.tappable')).toHaveCount(1);
  await expect(ov.locator('#_hist_naoseruNote')).toBeVisible();
  await expect(ov.locator('#_hist_naoseruNote')).toContainText('業務中の その日の 代行だけ');
  await ov.locator('.ride-item.tappable').first().click();
  await expect(page.locator('#tripEditOverlay')).toHaveClass(/show/);
});

// わざと壊す：naoseru の ended の 判じを 外す ⇒ 赤（押せる・開く）
test('② 業務終了の 後は 1つも 押せず、直に 開こうと しても 開かない（知らせが 出る）', async ({
  page,
}) => {
  await hiraku(page, {
    ima: Date.parse('2026-10-22T01:30:00+09:00'),
    rides: [ride(T1, 2500)],
    state: {
      active: false,
      ended: true,
      ended_at: Date.parse('2026-10-22T01:00:00+09:00'),
      start_time: KAISHI,
      trips: [trip(T1, 2500)],
      fare_total_yen: 2500,
      trip_count: 1,
    },
    hist: [{ start_time: KAISHI, trips: [trip(T1, 2500)], fare_total_yen: 2500, trip_count: 1 }],
  });
  const ov = page.locator('#overlayHistory');
  await expect(ov.locator('.ride-item')).toHaveCount(1);
  await expect(ov.locator('.ride-item.tappable')).toHaveCount(0);
  await page.evaluate(
    (t) => window._te_open('daikou_history_' + new Date(t).toDateString(), t),
    T1
  );
  await expect(page.locator('#tripEditOverlay')).not.toHaveClass(/show/);
  await expect(page.getByText('業務終了の 後は 直せません')).toBeVisible();
});

// わざと壊す：naoseru の 正午の 営業日の 判じを 外す ⇒ 赤（前の 夜の 代行も 押せる＝2本）
test('③ 次の 日の 正午を 越えて「続ける」で 再開しても、前の 夜の 代行は 直せない', async ({
  page,
}) => {
  await hiraku(page, {
    ima: Date.parse('2026-10-22T20:30:00+09:00'),
    rides: [ride(T1, 2500), ride(T2, 1800)],
    state: {
      active: true,
      ended: false,
      start_time: KAISHI,
      trips: [trip(T1, 2500), trip(T2, 1800)],
      fare_total_yen: 4300,
      trip_count: 2,
    },
    hist: [],
  });
  const ov = page.locator('#overlayHistory');
  await expect(ov.locator('.ride-item')).toHaveCount(2);
  await expect(ov.locator('.ride-item.tappable')).toHaveCount(1);
  await expect(ov.locator('.ride-item.tappable').first()).toHaveAttribute(
    'data-trip-key',
    String(T2)
  );
  await page.evaluate(
    (t) => window._te_open('daikou_history_' + new Date(t).toDateString(), t),
    T1
  );
  await expect(page.locator('#tripEditOverlay')).not.toHaveClass(/show/);
  await expect(page.getByText('前の 日の 分は 直せません')).toBeVisible();
});

// ★直す 画面から 保存まで（鍵が 2ms ずれた 代行）★ 2026-10-22（対立役 直3）
//   画面の 鍵（ride.trip_key）は 業務の 代行の 時刻より 1〜2ms 後に なる（別々の Date.now）。
//   値引き 700円 を 入れて 保存 ⇒ 業務の 控え（Business）と 倉庫の 両方が 2500→1800・知らせが 出る。
//   わざと壊す：tripIndexOf の 近さの 探しを 外す（=== だけ）⇒ 赤（「この 画面だけ」で 業務が 2500 の まま）
test('④ 鍵が 2ms ずれた 代行でも、値引きを 入れて 保存すると 業務の 額まで 直る', async ({
  page,
}) => {
  await hiraku(page, {
    ima: Date.parse('2026-10-21T23:00:00+09:00'),
    rides: [ride(T1 + 2, 2500)],
    state: {
      active: true,
      ended: false,
      start_time: KAISHI,
      trips: [trip(T1, 2500)],
      fare_total_yen: 2500,
      trip_count: 1,
    },
    hist: [],
  });
  const ov = page.locator('#overlayHistory');
  await expect(ov.locator('.ride-item.tappable')).toHaveCount(1);
  await ov.locator('.ride-item.tappable').first().click();
  await expect(page.locator('#tripEditOverlay')).toHaveClass(/show/);
  await page.locator('#tripEditOverlay [onclick="_te_pick(\'discount\')"]').click();
  await page.locator('#tePickAmount').fill('700');
  await page.locator('[onclick="_te_pickCustom()"]').click();
  await expect(page.locator('#teTotal')).toContainText('1,800');
  await page.locator('#tripEditOverlay [onclick="_te_save()"]').click();
  await expect(page.getByText('直しました')).toBeVisible();
  await expect(page.getByText('この画面だけ')).toHaveCount(0);
  const kazu = await page.evaluate(() => ({
    kura: JSON.parse(localStorage.getItem('daikou_business_state')).trips[0].fare_yen,
    hikae: window.Business.getState().trips[0].fare_yen,
  }));
  expect(kazu.kura, '倉庫の 業務の 額').toBe(1800);
  expect(kazu.hikae, 'Business の 控えの 額').toBe(1800);
});
