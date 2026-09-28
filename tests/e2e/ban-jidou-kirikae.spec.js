// tests/e2e/ban-jidou-kirikae.spec.js
// ============================================================
// ★タスクキルしなくても 新しい版に 入れ替わるか（2026-09-28）★
//
//   司さん「まえに直したと思うが タスクキルせな バージョンが 更新されないのを どうにかしろ」
//
// ★正体★
//   新しい 服（sw.js）が 着いた 時に 画面を 読み直す 仕掛けは 前から 在った。
//   だが 止める 判定が `!!(s && s.start_time)`＝★start_time が 在るか★ だけ だった。
//   `start_time` は [業務終了] を 押しても 消えない（business.js:end は ended=true にするだけ・
//   消えるのは [終了]=abandon か 次の 業務開始）。
//   ⇒ ★仕事と 仕事の 間 ずっと「業務中」扱い★＝読み直しが 永久に 止まる
//   ⇒ 服は 新しいのに 画面の js が 古いまま＝★タスクキルしか 効かない★。
//
// ★直した 後の 決まり★（画面の 関数 window.__swYominaoshiteYoiKa をそのまま 呼ぶ）
//   業務なし        → 読み直してよい
//   ★limbo★（[業務終了]を 押した後・active=false）→ ★読み直してよい★（ここが 直った所）
//   業務中 active   → 読み直さない（2026-09-06 の 決まり＝走行中に OBD を 切らない）
//
// ★★「服を すり替えて 本当に 読み直すか」は 別の 紙に 在る★★
//   tests/e2e/ban-jidou-kirikae-toushi.spec.js（通し）。
//   ★一度 「機械では 無理」と 書きかけたが それは 見立て違いだった★。
//   Playwright の context.route は 登録の 1回目の sw.js しか 横取りしないが、
//   ★試験が 自分で 網（http サーバ）を 立てれば できる★。
//   ★「出来ない」と 書く 前に もう 1通り 種類を 探す★。

// ★わざと壊して 赤に なる事を 見た (2026-09-28)★
//   判定を 前の形 `return { ok: !s || !s.start_time }` に 戻す
//     ⇒ 「limbo は 読み直してよい」が ★赤★。戻すと 緑。
// ============================================================
const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 390, height: 844 } });

async function hiraku(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('sensor_permission_active', '1');
    sessionStorage.setItem('sensorGranted', '1');
    localStorage.setItem('tutorial_done', '1');
    localStorage.setItem('daikome_training_consent', 'dismissed');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__swYominaoshiteYoiKa === 'function', {
    timeout: 10000,
  });
}

const kiku = (page) => page.evaluate(() => window.__swYominaoshiteYoiKa());

test('業務が 無い時は 読み直してよい', async ({ page }) => {
  await hiraku(page);
  const h = await kiku(page);
  expect(h.ok, '★業務が 無いのに 止めている★').toBe(true);
  expect(h.wake).toBe('business_nashi');
});

test('★[業務終了]の 後（limbo）は 読み直してよい★＝ここが タスクキルの 元', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    window.Business.start();
    window.Business.onTripEnd(1000, 2000, Date.now());
    window.Business.end(); // ★[業務終了]★ … start_time は 残る・active は false
  });
  const st = await page.evaluate(() => window.Business.getState());
  expect(st.start_time, '前提: [業務終了]の 後も start_time は 残る').not.toBeNull();
  expect(st.active, '前提: [業務終了]の 後は active=false').toBe(false);

  const h = await kiku(page);
  expect(h.ok, '★limbo で 止めている＝タスクキルしないと 版が 変わらない★').toBe(true);
  expect(h.wake).toBe('limbo');
});

test('業務が 動いている間は 読み直さない（2026-09-06 の 決まりを 壊していないか）', async ({
  page,
}) => {
  await hiraku(page);
  await page.evaluate(() => window.Business.start());
  const st = await page.evaluate(() => window.Business.getState());
  expect(st.active, '前提: 業務が 動いている').toBe(true);

  const h = await kiku(page);
  expect(h.ok, '★走行中に 読み直すと OBD が 切れて 距離が 短く 出る★').toBe(false);
  expect(h.wake).toBe('gyoumu_chuu');
});

test('[続ける]で 業務に 戻したら また 止める（行き来しても 正しいか）', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    window.Business.start();
    window.Business.onTripEnd(1000, 2000, Date.now());
    window.Business.end();
  });
  expect((await kiku(page)).ok).toBe(true); // limbo
  await page.evaluate(() => window.Business.resume()); // [続ける]
  const h = await kiku(page);
  expect(h.ok, '★[続ける]で 動き出したのに 止めていない★').toBe(false);
  expect(h.wake).toBe('gyoumu_chuu');
});

// ============================================================
// ★★2026-09-28 その2＝対立役に 叩かれて 足した★★
//   はじめ 「Business.active だけ」で 止めていた。★それでは 足りない★と 叩かれ、
//   ★全部 自分で コードを 読んで 裏を 取った★:
//     ①OBD は [業務終了] で 切れない（index.html:8725 が 唯一の 接続点・grep 済）
//       ＝limbo で 読み直すと 落ちるのに [続ける] は 繋ぎ直さない
//       ⇒ OBD 無しで 走り出し ★道より 短い 距離★＝2026-09-06 の 実害 そのもの
//     ②課金距離の 門は js/meter.js:383 の running だけ（business_active を 見ていない）。
//       index.html:10590 の _askCarryOver は Business.end() を 呼ぶが Meter.businessEnd() を 呼ばない
//       ⇒ ★active=false なのに 実車の 課金が 回っている★ 状態が 実在する
//     ③起動の 画面分岐は limbo を businessStart に 送る（index.html:10772 の 注記）
//       ⇒ 読み直すと ★その勤務の 日報に 二度と 戻れない★／送信の 知らせも 消える
//
// ★わざと壊して 赤に なる事を 見た (2026-09-28)★
//   _swYominaoshiteYoiKa から obd / meter / 日報 の 段を 1つずつ 消す
//     ⇒ それぞれ 対応する 1本が ★赤★。戻すと 緑。
// ============================================================
test('①OBD が 繋がっている間は 読み直さない（★距離が 短く なる 道★）', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    // 業務は limbo（前は ここで 読み直していた）
    window.Business.start();
    window.Business.onTripEnd(1000, 2000, Date.now());
    window.Business.end();
    // ★OBD が 繋がっている★（[業務終了] は OBD を 切らない）
    window.OBDClient = window.OBDClient || {};
    window.OBDClient.isConnected = () => true;
  });
  const h = await kiku(page);
  expect(h.ok, '★OBD を 落として [続ける]→道より 短い 距離に なる★').toBe(false);
  expect(h.wake).toBe('obd_tsunagatteru');
});

test('①OBD が 切れたら limbo は また 読み直す（永久に 古いままに しない）', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    window.Business.start();
    window.Business.onTripEnd(1000, 2000, Date.now());
    window.Business.end();
    window.OBDClient = window.OBDClient || {};
    window.OBDClient.isConnected = () => false;
  });
  const h = await kiku(page);
  expect(h.ok, '★OBD が 切れているのに 止めている＝タスクキルが 戻る★').toBe(true);
  expect(h.wake).toBe('limbo');
});

test('②メーターが 回っている間は 読み直さない（active=false でも）', async ({ page }) => {
  await hiraku(page);
  // ★_askCarryOver の 穴を 本物の 関数で 作る★
  //   index.html:10590 は Business.end() を 呼ぶが Meter.businessEnd() を 呼ばない。
  //   ＝★active=false なのに メーター（課金）は 回ったまま★
  //   Meter は window に 載らない const なので 抜け道を 作らず
  //   ★本物の Meter.start() で 回してから 測る★（真似た 写しを 測らない）。
  const jotai = await page.evaluate(() => {
    window.Business.start();
    // eslint-disable-next-line no-undef
    Meter.start();
    window.Business.end(); // Meter.businessEnd() は 呼ばない（_askCarryOver と 同じ）
    // eslint-disable-next-line no-undef
    return { active: window.Business.getState().active, running: !!Meter.getState().running };
  });
  expect(jotai.active, '前提: active は false').toBe(false);
  expect(jotai.running, '前提: メーターは 回っている').toBe(true);

  const h = await kiku(page);
  expect(h.ok, '★実車の 課金が 回っているのに 読み直す＝その場で 距離が 飛ぶ★').toBe(false);
  expect(h.wake).toBe('meter_mawatteru');
});

test('③日報（業務報告）を 見ている間は 読み直さない', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    window.Business.start();
    window.Business.onTripEnd(1000, 2000, Date.now());
    window.Business.end();
    if (typeof window.showScreen === 'function') window.showScreen('businessReport');
  });
  await page.waitForTimeout(200);
  const mieteru = await page.evaluate(() => {
    const el = document.getElementById('screenBusinessReport');
    return !!el && getComputedStyle(el).display !== 'none';
  });
  expect(mieteru, '前提: 日報の 画面が 出ていない').toBe(true);
  const h = await kiku(page);
  expect(h.ok, '★日報を 見ている 最中に 読み直す＝その勤務の 日報に 二度と 戻れない★').toBe(false);
  expect(h.wake).toBe('nippou_miteru');
});
