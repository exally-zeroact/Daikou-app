// 経由の前後の記録（js/keiyu-kiroku.js）を本物の画面で確かめる (2026-11-13)
//   ① 走る→止まる→経由を押す→30秒 で IndexedDB daikome-keiyu に1件・前後に GPS の点(g)と mmResult(m)
//   ② shindan.html の「経由の前後の記録」に1行出る
//   ③ 記録あり/なし（js/keiyu-kiroku.js を空にする）で 距離・料金が同じ
/* global showScreen, updateStartButtonsGate, onBusinessStart, onMainBtn, appState:writable, Business */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const TR = Object.values(
  JSON.parse(fs.readFileSync(path.join(HERE, '..', 'fixtures', 'realdevice-android.json'), 'utf8'))
);
const S0 = TR.findIndex((p, i) => TR.slice(i, i + 45).every((q) => q.spd > 5));

async function hashiru(browser, kirokuAri) {
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: TR[S0].lat, longitude: TR[S0].lng, accuracy: 5 },
  });
  const page = await context.newPage();
  if (!kirokuAri) {
    await page.route('**/js/keiyu-kiroku.js*', (r) =>
      r.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    );
  }
  await page.addInitScript(() => {
    sessionStorage.setItem('sensor_permission_active', '1');
    sessionStorage.setItem('sensorGranted', '1');
    sessionStorage.setItem('dl_just_completed', '1');
    localStorage.setItem('daikome_training_consent', 'dismissed');
    localStorage.setItem('pwa_banner_dismissed', '1');
    localStorage.setItem('apk_banner_dismissed', '1');
    localStorage.setItem('tutorial_done', '1');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10000);
  expect(await page.evaluate(() => typeof window.KeiyuKiroku)).toBe(
    kirokuAri ? 'object' : 'undefined'
  );
  await page.evaluate(() => {
    ['dlOverlay', 'trainingConsentBanner', 'pwaBanner', 'apkBanner', 'sensorRestoreBanner'].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      }
    );
    showScreen('businessStart');
    updateStartButtonsGate();
    onBusinessStart();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    if (appState !== 'idle') appState = 'idle';
    onMainBtn();
  });
  await page.waitForTimeout(1500);
  let k = S0;
  let lat, lng;
  const susumu = async () => {
    const p = TR[k++];
    lat = p.lat;
    lng = p.lng;
    await context.setGeolocation({ latitude: lat, longitude: lng, accuracy: p.acc || 5 });
    await page.waitForTimeout(1000);
  };
  const tomaru = async (n) => {
    for (let i = 0; i < n; i++) {
      await context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 5 });
      await page.waitForTimeout(1000);
    }
  };
  for (let i = 0; i < 20; i++) await susumu();
  await tomaru(6);
  await page.click('#waypointCard');
  await tomaru(4);
  for (let i = 0; i < 20; i++) await susumu();
  await tomaru(10); // 押してから 34 秒＝後ろ30秒の箱が閉じる
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => {
    const s = Meter.getState();
    return {
      d: Math.round(s.distance_m * 10) / 10,
      dd: Math.round(s.display_distance_m * 10) / 10,
      fare: s.fare_yen,
      wp: (Business.getCurrentTrip() || { waypoints: [] }).waypoints.length,
    };
  });
  let recs = null;
  if (kirokuAri) {
    recs = await page.evaluate(
      () =>
        new Promise((res) => {
          const rq = indexedDB.open('daikome-keiyu');
          rq.onsuccess = () => {
            const db = rq.result;
            if (!db.objectStoreNames.contains('kiroku')) return res([]);
            const g = db.transaction('kiroku').objectStore('kiroku').getAll();
            g.onsuccess = () => res(g.result);
            g.onerror = () => res(null);
          };
          rq.onerror = () => res(null);
        })
    );
  }
  return { context, page, st, recs };
}

test('経由の前後の記録：1件残る・shindan に出る・距離と料金は記録なしと同じ', async ({
  browser,
}) => {
  test.setTimeout(600000);
  const ari = await hashiru(browser, true);
  // ① 1件・前後に g と m
  expect(ari.recs).not.toBeNull();
  expect(ari.recs.length).toBe(1);
  const r = ari.recs[0];
  expect(r.pre.some((e) => e.k === 'g')).toBe(true);
  expect(r.pre.some((e) => e.k === 'g' && typeof e.ddist === 'number')).toBe(true);
  expect(r.pre.some((e) => e.k === 'm')).toBe(true);
  expect(r.post.some((e) => e.k === 'g')).toBe(true);
  expect(r.post.some((e) => e.k === 'm')).toBe(true);
  // 位置は入れない
  const txt = JSON.stringify(r);
  expect(txt).not.toMatch(/"(lat|lng|latitude|longitude)"/);
  // ② shindan.html に1行
  await ari.page.goto('/shindan.html', { waitUntil: 'domcontentloaded' });
  await expect(ari.page.locator('#rawKeiyu')).not.toBeEmpty({ timeout: 10000 });
  expect(await ari.page.locator('#tKeiyu tr').count()).toBeGreaterThan(1);
  await ari.page.screenshot({ path: test.info().outputPath('shindan-keiyu.png'), fullPage: true });
  await ari.context.close();

  // ③ 記録なしで同じ道
  const nashi = await hashiru(browser, false);
  await nashi.context.close();
  console.log('KEKKA ari=' + JSON.stringify(ari.st) + ' nashi=' + JSON.stringify(nashi.st));
  expect(ari.st.wp).toBe(1);
  expect(nashi.st.wp).toBe(1);
  expect(ari.st.d).toBeGreaterThan(100);
  expect(ari.st.d).toBe(nashi.st.d);
  expect(ari.st.dd).toBe(nashi.st.dd);
  expect(ari.st.fare).toBe(nashi.st.fare);
});
