// ============================================================
// ★★見張り：給料の 締め（20日締め・何月分・止める）★★ 2026-10-07
//
//   司さん「この払い方がまだ対応できてないやろが」
//   司さんの 決め（10-07）: 何月分と 呼ぶかは ★会社が 選ぶ★／月次の 給料は 締めた 分
//   ★時計は 2026-10-07（日本時間）に 止める★（今日が 何月かを 持ち込まない）
//   ★勤務は 9/25 と 10/5★（20日締めなら 同じ 期 9/21〜10/20 に 入る＝月を またぐ 期を 見る）
//
//   ★物差し★
//     ① 20日締め・締めた月の分 ⇒ 開くと 10月分（9/21 ~ 10/20）・明細に 9/25 と 10/5 の 両方
//     ② 20日締め・始まった月の分 ⇒ 開くと 9月分（今日 10/7 を 含む 期の 月）
//     ③ 昔の month_end ⇒ 止める（明細を 出さない・文を 出す）
//     ④ 設定：何月分を 選ばないと 保存しない／選ぶと period_shime を 保存
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-07 実測）★★ 下の 試験の 頭に 書く
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

const KYOU = new Date('2026-10-07T12:00:00+09:00');
// ★日付を 決まった 日へ★（1日 → 9/25・2日 → 10/5）
const HI = { '01': '2026-09-25', '02': '2026-10-05' };
function hiOkikae(o) {
  if (Array.isArray(o)) return o.map(hiOkikae);
  if (o && typeof o === 'object') {
    const out = {};
    Object.keys(o).forEach((k) => (out[k] = hiOkikae(o[k])));
    return out;
  }
  if (typeof o === 'string') return o.replace(/\d{4}-\d{2}-(01|02)(?=$|[ T])/g, (_m, d) => HI[d]);
  return o;
}
function settei(shime, mode) {
  return (f) => {
    const g = hiOkikae(f);
    g.settings[0].period_shime = shime;
    g.settings[0].period_end_mode = mode || (shime ? 'shime' : 'thirds');
    return g;
  };
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(KYOU);
});

// わざと壊す：loadPeriod を kata で なく 昔の endMode で 呼ぶ ⇒ 赤（月3回の 1〜10日 が 出る）
test('★① 20日締め・締めた月の分 ⇒ 10月分 9/21 ~ 10/20・9/25 と 10/5 が 同じ 明細に★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page, settei({ kind: 'tsuki', hi: [20], nazuke: 'shime' }));
  const r = await page.evaluate(() => {
    const e = window.__paper.emp(0);
    return {
      label: document.getElementById('monthLabel').textContent,
      hi: e.cells.map((c) => c.date),
      ari: e.cells.filter((c) => c.pay > 0).map((c) => c.date),
    };
  });
  // eslint-disable-next-line no-console
  console.log('★①★ ' + JSON.stringify({ label: r.label, n: r.hi.length, ari: r.ari }));
  expect(r.hi[0], '★期の 始まりが 9/21 で ない★').toBe('2026-09-21');
  expect(r.hi[r.hi.length - 1], '★期の 終わりが 10/20 で ない★').toBe('2026-10-20');
  expect(r.ari, '★月を またいだ 勤務が 片方 落ちた★').toEqual(['2026-09-25', '2026-10-05']);
  expect(r.label).toContain('10');
  expect(err).toEqual([]);
});

// わざと壊す：kyouNoTsuki を 今の 月 固定に ⇒ 赤（10月を 開いて 期が 10/21〜）
test('★② 20日締め・始まった月の分 ⇒ 今日 10/7 を 含む 9月分を 開く★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page, settei({ kind: 'tsuki', hi: [20], nazuke: 'hajime' }));
  const r = await page.evaluate(() => {
    const e = window.__paper.emp(0);
    return { a: e.cells[0].date, b: e.cells[e.cells.length - 1].date };
  });
  expect([r.a, r.b], '★今日を 含む 期（9月分）を 開いていない★').toEqual([
    '2026-09-21',
    '2026-10-20',
  ]);
  expect(err).toEqual([]);
});

// わざと壊す：yomu で month_end を 月3回に 倒す ⇒ 赤（明細が 出る）
test('★③ 昔の month_end ⇒ 明細を 出さずに 止める★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page, settei(null, 'month_end'), { matanai: true });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({
    err: (document.getElementById('err') || {}).textContent || '',
    kami: document.querySelectorAll('#slips .kami-mado .hn-kami-waku, #slips .slip').length,
  }));
  // eslint-disable-next-line no-console
  console.log('★③★ ' + JSON.stringify(r));
  expect(r.err, '★止めた 理由が 出ていない★').toContain('払い方の 設定が 読めない');
  expect(r.kami, '★止めるべきなのに 明細が 出た★').toBe(0);
  expect(err).toEqual([]);
});

// わざと壊す：保存の 前の seiki を 外す ⇒ 赤（何月分 無しで 保存された）
test('★④ 設定：何月分を 選ばないと 保存しない・選ぶと period_shime を 保存★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page, settei(null, 'thirds'), { ura: '?henshu=1#set' });
  await page.evaluate(() => {
    window.__okutta = [];
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      if (o && o.method === 'POST' && String(p).indexOf('dk_payroll_settings') === 0)
        window.__okutta.push(JSON.parse(o.body));
      return moto.apply(this, arguments);
    };
  });
  // ★#set で 給料の 設定が もう 開いている★
  await page.waitForSelector('#pMode', { state: 'visible' });
  await page.selectOption('#pMode', 'tsuki1');
  await page.fill('#pShimeHi', '20');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(400);
  const a = await page.evaluate(() => ({
    n: window.__okutta.length,
    err: document.getElementById('err').textContent,
  }));
  expect(a.n, '★何月分が 無いのに 保存した★').toBe(0);
  expect(a.err).toContain('何月分');

  await page.selectOption('#pNazuke', 'shime');
  await page.waitForTimeout(200);
  const msg = await page.evaluate(() => document.getElementById('pMsg').textContent);
  expect(msg, '★区切りの 字が 本当の 区切りで ない★').toContain('10月分 … 9/21 ~ 10/20');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(400);
  const b = await page.evaluate(() => window.__okutta);
  // eslint-disable-next-line no-console
  console.log('★④★ ' + JSON.stringify(b.map((x) => [x.period_end_mode, x.period_shime])));
  expect(b.length).toBe(1);
  expect(b[0].period_shime).toEqual({ kind: 'tsuki', hi: [20], nazuke: 'shime' });
  expect(b[0].period_end_mode).toBe('shime');

  // ★月3回に 戻すと period_shime は null を はっきり 送る★
  await page.selectOption('#pMode', 'thirds');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(400);
  const c = await page.evaluate(() => window.__okutta[1]);
  expect(c.period_shime).toBeNull();
  expect(c.period_end_mode).toBe('thirds');
  expect(err).toEqual([]);
});
