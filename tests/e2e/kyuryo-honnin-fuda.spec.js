// ============================================================
// ★★本人の 明細を 24時間 パスワード 無しで 見る 札★★ 2026-10-21
//
//   ★司さんの言葉★
//     「パスワードなしで入れる時間を設けてそれこしたら再度パスワード入れ直しは分かるけど
//       決めるところからはじまるのはイライラする」
//     決め＝24時間・会社の 倉庫が 札を 出す（携帯には 期限つきの 札だけ・4桁は 置かない）
//
//   ★ここで 見張る 事★（倉庫は 偽の 物＝本物の 倉庫の 守りは tests/db-tameshi/kyuryo-fuda-kurabe.mjs）
//     F1 パスワードが 合ったら 札を 置く（置くのは {fuda, kigen} だけ・4桁は 置かない）
//     F2 期限内の 札が 在れば 入れる 画面を 出さずに 明細（パスワードの 呼び 0）
//     F3 端末の 期限が 切れた 札は 消して 入れる 画面
//     F4 倉庫が fuda_kire を 返したら 札を 消して 入れる 画面（24時間の 訳）
//     F5 倉庫に 札の 関数が まだ 無い（PGRST202）時は 今の verify に 落とす
//     F6 札の 関数が つながらない 時は verify に 落とさない（間違いを 2回 数えない）
//     F7 札で 取る 時に つながらない だけ なら 札を 消さない
//     F8 c= 付きの リンクでも 札が 在れば 探りより 先に 明細
// ============================================================
const { test, expect } = require('@playwright/test');
const { EMP, getKotae, kamiDekita } = require('./honnin-harness');

const FUDA = 'ab'.repeat(24); // 48桁の 16進（数字 4桁の 字が 入らない 物）
const KEY = 'dkKyuFuda:TOK';

// fudaKotae: 札の 関数の 答え（'ok'／'pgrst202'／'kireta'（つながらない））
// getKotaeFuda: 札で 取った 時の 答え（'ok'／'kire'／'tsunagaranai'）
async function nise(page, o) {
  const kazu = { fuda: 0, verify: 0, get: 0, pw_set: 0, getFuda: 0 };
  await page.route('**/rest/v1/rpc/dk_kyuryo_fuda', (r) => {
    kazu.fuda++;
    if (o.fudaKotae === 'pgrst202')
      return r.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function' }),
      });
    if (o.fudaKotae === 'kireta') return r.abort('failed');
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, name: EMP.name, fuda: FUDA, kigen: Date.now() + 864e5 }),
    });
  });
  await page.route('**/rest/v1/rpc/dk_kyuryo_verify', (r) => {
    kazu.verify++;
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, name: EMP.name }),
    });
  });
  await page.route('**/rest/v1/rpc/dk_kyuryo_pw_set', (r) => {
    kazu.pw_set++;
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, reason: 'already_set' }),
    });
  });
  await page.route('**/rest/v1/rpc/dk_kyuryo_get', (r) => {
    kazu.get++;
    const b = JSON.parse(r.request().postData() || '{}');
    if (String(b.p_pw).indexOf('fuda:') === 0) {
      kazu.getFuda++;
      if (o.getKotaeFuda === 'tsunagaranai') return r.abort('failed');
      if (o.getKotaeFuda === 'kire' || b.p_pw !== 'fuda:' + FUDA)
        return r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, reason: 'fuda_kire' }),
        });
    } else if (b.p_pw !== '1234')
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, reason: 'bad_pw', nokori: 2 }),
      });
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(getKotae()),
    });
  });
  await page.route('**/rest/v1/dk_**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  return kazu;
}
async function okuFuda(page, kigen) {
  await page.addInitScript(
    ([k, f, g]) => {
      if (sessionStorage.getItem('__oita')) return; // 開き直しで 置き直さない
      sessionStorage.setItem('__oita', '1');
      localStorage.setItem(k, JSON.stringify({ fuda: f, kigen: g }));
    },
    [KEY, FUDA, kigen]
  );
}
const yomuFuda = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const meisai = (page) => kamiDekita(page);

// わざと壊す：入れた 後に hnFudaOku を 呼ばない ⇒ 赤（札が 無い）
test('F1 パスワードが 合ったら 札を 置く（{fuda, kigen} だけ・4桁は 置かない）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const kazu = await nise(page, {});
  await page.goto('/kyuryo.html?t=TOK');
  await page.fill('#hnPw', '1234');
  await page.click('#hnGo');
  await meisai(page);
  const v = JSON.parse(await yomuFuda(page));
  expect(Object.keys(v).sort()).toEqual(['fuda', 'kigen']);
  expect(v.fuda).toBe(FUDA);
  expect(v.kigen).toBeGreaterThan(Date.now() + 23 * 3600e3);
  const zenbu = await page.evaluate(() => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++)
      o[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    return o;
  });
  expect(JSON.stringify(zenbu), '4桁や パスワードの 鍵を 端末に 置いた').not.toMatch(/"pw"|1234/);
  expect(kazu.fuda, '札の 関数で 照らす').toBe(1);
  expect(kazu.verify, 'verify で 2回 照らさない').toBe(0);
});

// わざと壊す：honninStart の 札の 先回りを 外す ⇒ 赤（入れる 画面が 出る）
test('F2 期限内の 札が 在れば 入れる 画面を 出さずに 明細', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const kazu = await nise(page, {});
  await okuFuda(page, Date.now() + 3600e3);
  await page.goto('/kyuryo.html?t=TOK');
  await meisai(page);
  await expect(page.locator('#hnPw')).toHaveCount(0);
  expect(kazu.getFuda).toBeGreaterThan(0);
  expect(kazu.fuda + kazu.verify, 'パスワードの 呼びは 0').toBe(0);
});

// わざと壊す：守りは 2つ（開いた 時の 掃除 hnFudaSouji・hnFudaYomu の 期限の 判じ）＝1つ 外しても 緑・2つ 外す ⇒ 赤（2026-10-21 測った）
test('F3 端末の 期限が 切れた 札は 消して 入れる 画面', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const kazu = await nise(page, {});
  await okuFuda(page, Date.now() - 1000);
  await page.goto('/kyuryo.html?t=TOK');
  await expect(page.locator('#hnPw')).toBeVisible();
  expect(await yomuFuda(page)).toBeNull();
  expect(kazu.getFuda).toBe(0);
});

// わざと壊す：fuda_kire の 枝を 外す ⇒ 赤（入れる 画面に 戻らない）
test('F4 倉庫が fuda_kire を 返したら 札を 消して 入れる 画面（24時間の 訳）', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, { getKotaeFuda: 'kire' });
  await okuFuda(page, Date.now() + 3600e3);
  await page.goto('/kyuryo.html?t=TOK');
  await expect(page.locator('#hnPw')).toBeVisible();
  await expect(page.locator('#hnErr')).toContainText('24時間');
  expect(await yomuFuda(page)).toBeNull();
  // 入れ直すと 新しい 札で 明細
  await page.fill('#hnPw', '1234');
  await page.click('#hnGo');
  await meisai(page);
});

// わざと壊す：hnIreru の PGRST202 の 落とし先を 外す ⇒ 赤（入れない）
test('F5 倉庫に 札の 関数が まだ 無い（PGRST202）時は 今の verify に 落とす', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const kazu = await nise(page, { fudaKotae: 'pgrst202' });
  await page.goto('/kyuryo.html?t=TOK');
  await page.fill('#hnPw', '1234');
  await page.click('#hnGo');
  await meisai(page);
  expect(kazu.verify).toBe(1);
  expect(await yomuFuda(page)).toBeNull();
});

// わざと壊す：PGRST202 だけでなく 失敗 全部で verify に 落とす ⇒ 赤（2回 照らす）
test('F6 札の 関数が つながらない 時は verify に 落とさない（間違いを 2回 数えない）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const kazu = await nise(page, { fudaKotae: 'kireta' });
  await page.goto('/kyuryo.html?t=TOK');
  await page.fill('#hnPw', '1234');
  await page.click('#hnGo');
  await expect(page.locator('#hnErr')).toBeVisible();
  await page.waitForTimeout(500);
  expect(kazu.fuda).toBe(1);
  expect(kazu.verify).toBe(0);
  await expect(page.locator('#hnKami')).toHaveCount(0);
});

// わざと壊す：fuda_kire 以外でも 札を 消す ⇒ 赤（電波が 弱い だけで 札が 消える）
test('F7 札で 取る 時に つながらない だけ なら 札を 消さない', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, { getKotaeFuda: 'tsunagaranai' });
  await okuFuda(page, Date.now() + 3600e3);
  await page.goto('/kyuryo.html?t=TOK');
  await expect(page.locator('#slips')).toContainText('出せませんでした');
  expect(JSON.parse(await yomuFuda(page)).fuda).toBe(FUDA);
});

// わざと壊す：札の 先回りを A の 探りの 後ろへ 置く ⇒ 赤（探りの 呼びが 走る）
test('F8 c= 付きの リンクでも 札が 在れば 探りより 先に 明細', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const kazu = await nise(page, {});
  await okuFuda(page, Date.now() + 3600e3);
  await page.goto('/kyuryo.html?t=TOK&c=INIT12345');
  await meisai(page);
  expect(kazu.pw_set, '探りは 走らない').toBe(0);
});
