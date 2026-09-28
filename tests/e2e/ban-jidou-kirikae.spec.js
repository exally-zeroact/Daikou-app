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
// ★★なぜ 「服を すり替えて 本当に 読み直すか」を 機械で 試さないか★★
//   1回 書いて 測った（2026-09-28）。Playwright の context.route は
//   ★登録の 1回目の sw.js しか 横取りできない★。
//   `reg.update()` の 取りに行きは 服自身が 出すので 通らない
//   （実測：横取り 回数が 1 のまま・installing/waiting とも false）。
//   ★そのままだと 「アプリが 悪い」と 誤読する 偽の赤に なる★ので 置かない。
//   repo の sw.js を 試験の 途中で 書き換える 手も あるが、
//   ★落ちた時に repo が 汚れる★ので やらない。
//   ⇒ 通しは ★実配信で 1回 実際に 回す★（開けたまま 2回目を 配って 読み直すか 見る）。

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
