// ============================================================
// ★★見張り：締めの 形の「何日から」★★ 2026-10-19（docs/nannichi-kara-shime.md）
//   司さん 10-17「その日より前は前の値」・10-19「短い期は元の期の月に揃える」
//   ★時計は 2026-10-07（日本時間）★・勤務は 9/25 と 10/5
//   列＝20日締め（締めた 日の 月の 分）・記録＝10/1 から 末日締め
//     ⇒ 10月分は 9/21〜9/30（短い・元の 期 9/21〜10/20 の 10月分）と 10/1〜10/31
//
//   ★物差し★（わざと 壊して 赤に なるのを 見た 物は 各 試験の 頭に 書く）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

const KYOU = new Date('2026-10-07T12:00:00+09:00');
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
const RETSU = { kind: 'tsuki', hi: [20], nazuke: 'shime' };
function settei(kiroku, hoka) {
  return (f) => {
    const g = hiOkikae(f);
    g.settings[0].period_shime = RETSU;
    g.settings[0].period_end_mode = 'shime';
    g.shimeRireki = (kiroku || []).map((x, i) =>
      Object.assign({ rireki_id: 'r' + (i + 1), company_id: g.settings[0].company_id }, x)
    );
    return Object.assign(g, hoka || {});
  };
}
const MATSU = [{ from_date: '2026-10-01', value: { kind: 'tsuki', hi: [0] } }];

// 書く 物を 控え、締めの 記録の 書きには 1行 返す（偽の 倉庫は 書いた 物を 返さない）
async function kakuWoHikaeru(page) {
  await page.evaluate(() => {
    window.__okutta = [];
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      if (o && o.method) {
        window.__okutta.push({ p: String(p), m: o.method, b: o.body ? JSON.parse(o.body) : null });
        // ★window.__shimeOchiru 回 だけ 倉庫が 落ちる（500）★
        if (String(p).indexOf('dk_shime_rireki') === 0 && window.__shimeOchiru > 0) {
          window.__shimeOchiru--;
          return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('') });
        }
        if (String(p).indexOf('dk_shime_rireki') === 0)
          return Promise.resolve({
            ok: true,
            status: 201,
            json: () => Promise.resolve([{ rireki_id: 'n1' }]),
          });
      }
      const last = window.__okutta
        .filter((x) => x.p.indexOf('dk_payroll_settings') === 0)
        .slice(-1)[0];
      if (
        (!o || !o.method) &&
        String(p).indexOf('dk_payroll_settings?select=updated_at') === 0 &&
        last
      )
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ updated_at: last.b.updated_at }]),
        });
      return moto.apply(this, arguments);
    };
  });
}
const hiNo = (page) =>
  page.evaluate(() => {
    const e = window.__paper.emp(0);
    return {
      a: e.cells[0].date,
      b: e.cells[e.cells.length - 1].date,
      ari: e.cells.filter((c) => c.pay > 0).map((c) => c.date),
      bar: Array.prototype.map.call(document.querySelectorAll('#periodBar [data-pidx]'), (b) =>
        b.textContent.trim()
      ),
    };
  });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(KYOU);
});

// わざと壊す：normSettings に 記録を 渡さない（kyuryo の normSettings(SET, RAW.shimeRireki) を normSettings(SET)）⇒ 赤（9/21〜10/20 が 出た）
test('① 10/1 から 末日締め ⇒ 10月分は 9/21〜9/30 と 10/1〜10/31・勤務は それぞれの 期に', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page, settei(MATSU));
  const a = await hiNo(page);
  // eslint-disable-next-line no-console
  console.log('★①★ ' + JSON.stringify(a));
  expect(a.bar).toEqual(['9/21 〜 9/30', '1日〜末日']);
  expect([a.a, a.b], '★切った 期が 9/30 で 終わらない★').toEqual(['2026-09-21', '2026-09-30']);
  expect(a.ari).toEqual(['2026-09-25']);
  await page.click('#periodBar [data-pidx="1"]');
  await page.waitForFunction(
    () =>
      window.__paper &&
      window.__paper.emp(0) &&
      window.__paper.emp(0).cells[0].date === '2026-10-01'
  );
  const b = await hiNo(page);
  expect([b.a, b.b]).toEqual(['2026-10-01', '2026-10-31']);
  expect(b.ari).toEqual(['2026-10-05']);
  expect(err).toEqual([]);
});

// わざと壊す：保存で shKaku を 見ずに 列へ 欄の 形を 書く ⇒ 赤（列が 15日・末日に なった）
test('② 何日から（既定 今日）で 保存 ⇒ 記録を 書き 列の 締めは 変えない', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page, settei(MATSU), { ura: '?henshu=1#set' });
  await kakuWoHikaeru(page);
  await page.waitForSelector('#pMode', { state: 'visible' });
  expect(await page.inputValue('#pHi')).toBe('2026-10-07');
  expect(await page.inputValue('#pMode'), '★選んだ 日に 効く 形（末日）で ない★').toBe('matsu');
  await page.selectOption('#pMode', 'tsuki2');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  const o = await page.evaluate(() => window.__okutta);
  // eslint-disable-next-line no-console
  console.log('★②★ ' + JSON.stringify(o.map((x) => [x.m, x.p.slice(0, 50)])));
  const set = o.filter((x) => x.p.indexOf('dk_payroll_settings') === 0);
  const ki = o.filter((x) => x.p.indexOf('dk_shime_rireki') === 0);
  expect(set.length).toBe(1);
  expect(set[0].b.period_shime, '★列の 締めを 変えた★').toEqual(RETSU);
  expect(set[0].b.period_end_mode).toBe('shime');
  expect(ki.length).toBe(1);
  expect(ki[0].p).toBe('dk_shime_rireki?on_conflict=company_id,from_date');
  expect(ki[0].b.from_date).toBe('2026-10-07');
  expect(ki[0].b.value).toEqual({ kind: 'tsuki', hi: [15, 0] });
  expect(err).toEqual([]);
});

// わざと壊す：保存の 日付の 道を 外し いつも 列を 運ぶ ⇒ 赤（列が 変わらない）
test('③ 何日からを 空（最初から）で 保存 ⇒ 列を 直し 記録は 書かない', async ({ page }) => {
  await openKyuryo(page, settei(MATSU), { ura: '?henshu=1#set' });
  await kakuWoHikaeru(page);
  await page.waitForSelector('#pMode', { state: 'visible' });
  await page.fill('#pHi', '');
  await page.dispatchEvent('#pHi', 'change');
  expect(await page.inputValue('#pMode'), '★空なのに 列の 形（20日締め）で ない★').toBe('tsuki1');
  expect(await page.inputValue('#pShimeHi')).toBe('20');
  await expect(page.locator('#pHiChui')).toContainText('2026-10-01 より 前の 日だけ');
  await page.selectOption('#pMode', 'matsu');
  // ★空で 払い方が 変わる＝1回目は 止めて「○日より 前の 日の 払い方が 変わります」・もう 一度で 保存★（2026-10-24）
  await page.click('#btnSaveSet');
  await page.waitForTimeout(500);
  expect(
    (await page.evaluate(() => window.__okutta)).filter(
      (x) => x.p.indexOf('dk_payroll_settings') === 0
    ).length,
    '★空で 1回目に 保存した★'
  ).toBe(0);
  await expect(page.locator('#err')).toContainText('2026-10-01 より 前の 日の 払い方が 変わります');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  const o = await page.evaluate(() => window.__okutta);
  const set = o.filter((x) => x.p.indexOf('dk_payroll_settings') === 0);
  expect(set.length).toBe(1);
  expect(set[0].b.period_shime).toEqual({ kind: 'tsuki', hi: [0] });
  expect(o.filter((x) => x.p.indexOf('dk_shime_rireki') === 0).length).toBe(0);
});

// ★空（最初から）でも 払い方が 今と 同じ なら 止めない（過去の 月は 変わらない）★ 2026-10-24
//   わざと壊す：karaOnaji を 常に false ⇒ 赤（変わらないのに 2回 押させた）
test('③b 何日からが 空でも 払い方が 今と 同じ なら 1回で 保存', async ({ page }) => {
  await openKyuryo(page, settei(MATSU), { ura: '?henshu=1#set' });
  await kakuWoHikaeru(page);
  await page.waitForSelector('#pMode', { state: 'visible' });
  await page.fill('#pHi', '');
  await page.dispatchEvent('#pHi', 'change');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  const o = await page.evaluate(() => window.__okutta);
  expect(
    o.filter((x) => x.p.indexOf('dk_payroll_settings') === 0).length,
    '★同じ 形 なのに 止めた★'
  ).toBe(1);
});

// ★月3回の 列（今の 本番の 既定）でも 空で 変えなければ 1回で 保存★（対立役 止1：列の thirds を seiki に 通して 必ず 止めた）
//   わざと壊す：karaOnaji の thirds の 扱いを 外す ⇒ 赤
test('③c 月3回の 列・記録 無し・何日から 空で 何も 変えずに 保存 ⇒ 1回で 保存', async ({
  page,
}) => {
  await openKyuryo(
    page,
    (f) => {
      const g = hiOkikae(f);
      g.settings[0].period_shime = null;
      g.settings[0].period_end_mode = 'thirds';
      g.shimeRireki = [];
      return g;
    },
    { ura: '?henshu=1#set' }
  );
  await kakuWoHikaeru(page);
  await page.waitForSelector('#pMode', { state: 'visible' });
  await page.fill('#pHi', '');
  await page.dispatchEvent('#pHi', 'change');
  expect(await page.inputValue('#pMode')).toBe('thirds');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  const o = await page.evaluate(() => window.__okutta);
  expect(
    o.filter((x) => x.p.indexOf('dk_payroll_settings') === 0).length,
    '★変えて いないのに 止めた★'
  ).toBe(1);
});

// ★設定の 行が 無い 会社（計算は 月3回）でも 空で 変えなければ 1回で 保存★（対立役 2回目 止A）
//   わざと壊す：karaOnaji の 今の 形を shimeRetsuKata（行が 無いと null）に 戻す ⇒ 赤
test('③e 設定の 行が 無い 会社・何日から 空で 月3回の まま 保存 ⇒ 1回で 保存', async ({ page }) => {
  await openKyuryo(
    page,
    (f) => {
      const g = hiOkikae(f);
      g.settings = [];
      g.shimeRireki = [];
      return g;
    },
    { ura: '?henshu=1#set' }
  );
  await kakuWoHikaeru(page);
  await page.waitForSelector('#pMode', { state: 'visible' });
  await page.fill('#pHi', '');
  await page.dispatchEvent('#pHi', 'change');
  expect(await page.inputValue('#pMode')).toBe('thirds');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  const o = await page.evaluate(() => window.__okutta);
  expect(
    o.filter((x) => x.p.indexOf('dk_payroll_settings') === 0).length,
    '★変えて いないのに 止めた★'
  ).toBe(1);
});

// ★設定の 行が 無い 会社が 既定の「今日から」で 払い方を 選んで 保存 ⇒ 止めずに 列は 月3回・記録は 今日から★ 2026-10-25
//   わざと壊す：shimeRetsuKata の 頭を「!SET || SET.yomenai」に 戻す ⇒ 赤（「最初からの 払い方が 読めない」で 止まった）
test('③f 設定の 行が 無い 会社・何日から 今日で 末日締めを 選んで 保存 ⇒ 列は 月3回・記録は 今日から', async ({
  page,
}) => {
  await openKyuryo(
    page,
    (f) => {
      const g = hiOkikae(f);
      g.settings = [];
      g.shimeRireki = [];
      return g;
    },
    { ura: '?henshu=1#set' }
  );
  await kakuWoHikaeru(page);
  await page.waitForSelector('#pMode', { state: 'visible' });
  expect(await page.inputValue('#pHi')).toBe('2026-10-07');
  expect(await page.inputValue('#pMode')).toBe('thirds');
  await page.selectOption('#pMode', 'matsu');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  await expect(page.locator('#err')).not.toContainText('読めない');
  const o = await page.evaluate(() => window.__okutta);
  const set = o.filter((x) => x.p.indexOf('dk_payroll_settings') === 0);
  const ki = o.filter((x) => x.p.indexOf('dk_shime_rireki') === 0);
  expect(set.length, '★行が 無い だけで 止めた★').toBe(1);
  expect(set[0].b.period_shime, '★今日より 前の 月を 変えた★').toBe(null);
  expect(set[0].b.period_end_mode).toBe('thirds');
  expect(ki.length).toBe(1);
  expect(ki[0].b.from_date).toBe('2026-10-07');
  expect(ki[0].b.value).toEqual({ kind: 'tsuki', hi: [0] });
});

// ★1回 知らせた 後に 払い方を 変えたら また 止める★（対立役 任1）
//   わざと壊す：KARA_KAKUNIN の 比べを「一度 確かめれば 通す」に ⇒ 赤
test('③d 空で 知らせた 後に 払い方を 変えて 押す ⇒ また 止める・同じ 形で もう 一度 ⇒ 保存', async ({
  page,
}) => {
  await openKyuryo(page, settei(MATSU), { ura: '?henshu=1#set' });
  await kakuWoHikaeru(page);
  await page.waitForSelector('#pMode', { state: 'visible' });
  await page.fill('#pHi', '');
  await page.dispatchEvent('#pHi', 'change');
  const kazu = () =>
    page.evaluate(
      () => window.__okutta.filter((x) => x.p.indexOf('dk_payroll_settings') === 0).length
    );
  await page.selectOption('#pMode', 'matsu');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(400);
  expect(await kazu()).toBe(0);
  await page.selectOption('#pMode', 'tsuki2');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(400);
  expect(await kazu(), '★形を 変えたのに 確かめずに 保存した★').toBe(0);
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  const o = await page.evaluate(() => window.__okutta);
  const set = o.filter((x) => x.p.indexOf('dk_payroll_settings') === 0);
  expect(set.length).toBe(1);
  expect(set[0].b.period_shime).toEqual({ kind: 'tsuki', hi: [15, 0] });
});

// わざと壊す：shKaku から SHIME_SAWATTA を 外す ⇒ 赤（触って いないのに 記録を 書いた）
test('④ 締めの 欄を 触らずに 保存 ⇒ 記録を 書かない／選んだ 日の 形を 欄に 出す', async ({
  page,
}) => {
  await openKyuryo(page, settei(MATSU), { ura: '?henshu=1#set' });
  await kakuWoHikaeru(page);
  await page.waitForSelector('#pMode', { state: 'visible' });
  await page.fill('#pHi', '2026-09-15');
  await page.dispatchEvent('#pHi', 'change');
  expect(await page.inputValue('#pMode')).toBe('tsuki1');
  expect(await page.inputValue('#pShimeHi')).toBe('20');
  await expect(page.locator('#pHiChui')).toContainText('2026-10-01 の 記録まで');
  // ★古い タブ★：別の 画面で 10/1 の 記録が 消された（倉庫は 空）。この 画面は 10/5 を 末日と 見た まま
  await page.fill('#pHi', '2026-10-05');
  await page.dispatchEvent('#pHi', 'change');
  expect(await page.inputValue('#pMode')).toBe('matsu');
  await page.evaluate(() => {
    const S = window.DKSession;
    const moto = S.softList;
    S.softList = function (s, p, st) {
      if (String(p).indexOf('dk_shime_rireki') === 0) {
        if (st) st.tried++;
        return Promise.resolve([]);
      }
      return moto.apply(this, arguments);
    };
  });
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  const o = await page.evaluate(() => window.__okutta);
  expect(o.filter((x) => x.p.indexOf('dk_payroll_settings') === 0).length).toBe(1);
  expect(
    o.filter((x) => x.p.indexOf('dk_shime_rireki') === 0).length,
    '★触って いないのに 書いた★'
  ).toBe(0);
});

// わざと壊す：RAW.shimeRireki の null（読めなかった）を [] に する ⇒ 赤（明細が 出た）
test('⑤ 記録を 読めない ⇒ 明細を 止め「開き直して」・保存しない', async ({ page }) => {
  await openKyuryo(page, settei(MATSU, { __yomenai: ['dk_shime_rireki'] }), { matanai: true });
  await page.waitForTimeout(1500);
  await expect(page.locator('#err')).toContainText(
    '締めの 変えた 記録を 読めなかったので 止めました（通信）。もう一度 開いてください。'
  );
  expect(await page.locator('#slips').innerText()).not.toMatch(/円/);
  // ★止めた 時は 設定の 欄も 組まれない＝保存の 押し口を 直に 押して 門を 見る★
  await kakuWoHikaeru(page);
  await page.evaluate(() => document.getElementById('btnSaveSet').click());
  await page.waitForTimeout(500);
  await expect(page.locator('#err')).toContainText(
    '締めの 変えた 記録を 読めていないので 保存しません'
  );
  expect(await page.evaluate(() => window.__okutta.length)).toBe(0);
});

// わざと壊す：rirekiKata の seiki の 確かめを 外す ⇒ 赤（壊れた 記録で 明細が 出た）
test('⑥ 壊れた 記録 ⇒ 止める・記録の 一覧から 消せる', async ({ page }) => {
  const KOWARE = [{ from_date: '2026-10-01', value: { kind: 'tsuki', hi: 'x' } }];
  await openKyuryo(page, settei(KOWARE), { ura: '?henshu=1#set', matanai: true });
  await page.waitForSelector('#pMode', { state: 'visible' });
  await page.waitForTimeout(1200);
  await expect(page.locator('#err')).toContainText('締めの 変えた 記録（2026-10-01）が 読めません');
  await kakuWoHikaeru(page);
  await page.click('#pRirekiBtn');
  await expect(page.locator('#pRireki')).toContainText('読めない 形');
  await page.click('#pRireki [data-sk-del="r1"]');
  await page.waitForTimeout(600);
  const o = await page.evaluate(() => window.__okutta);
  expect(o.map((x) => [x.m, x.p])).toEqual([['DELETE', 'dk_shime_rireki?rireki_id=eq.r1']]);
});

// わざと壊す：kikanDashiwake で shimeMitoshi を 使わず 欄の 形だけ ⇒ 赤（切り替わりが 字に 出ない）
test('⑦ 確かめの 字に 切り替わりの 短い 期が 出る', async ({ page }) => {
  await openKyuryo(page, settei([]), { ura: '?henshu=1#set' });
  await page.waitForSelector('#pMode', { state: 'visible' });
  await page.fill('#pHi', '2026-10-01');
  await page.dispatchEvent('#pHi', 'change');
  await page.selectOption('#pMode', 'matsu');
  // 2026-10-24 区切りの 一覧（#pMsg）は やめた＝保存の 下の 確かめの 字に 切り替わりの 月だけ 出す
  await expect(page.locator('#pSetsumei')).toContainText('10月分は 9/21 〜 9/30 ／ 10/1 〜 10/31');
  await expect(page.locator('#pSetsumei')).toContainText(
    '月1回（末日締め）：1日〜末日の1回で明細を出します'
  );
});

// わざと壊す：shimeKataIreru の「触った 欄は 戻さない」を 外す ⇒ 赤（選んだ 払い方が 黙って 捨てられた）
test('⑧ 払い方を 選んでから 日付を 変える・役割を 足す ⇒ 選んだ 払い方で 記録を 書く', async ({
  page,
}) => {
  await openKyuryo(page, settei(MATSU), { ura: '?henshu=1#set' });
  await kakuWoHikaeru(page);
  await page.waitForSelector('#pMode', { state: 'visible' });
  await page.selectOption('#pMode', 'tsuki2');
  await page.fill('#pHi', '2026-10-20');
  await page.dispatchEvent('#pHi', 'change');
  await page.click('#btnAddRole');
  expect(await page.inputValue('#pMode'), '★選んだ 払い方が 戻った★').toBe('tsuki2');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  const ki = await page.evaluate(() =>
    window.__okutta.filter((x) => x.p.indexOf('dk_shime_rireki') === 0)
  );
  expect(ki.length).toBe(1);
  expect(ki[0].b.from_date).toBe('2026-10-20');
  expect(ki[0].b.value).toEqual({ kind: 'tsuki', hi: [15, 0] });
});

// わざと壊す：保存の「最初からの 払い方が 読めない」の 門を 外す ⇒ 赤（直らない 記録を 書いた）
test('⑨ 最初からの 払い方（列）が 壊れた 会社は 日付在りで 保存させず 空での 直しへ 導く', async ({
  page,
}) => {
  await openKyuryo(
    page,
    (f) => {
      const g = settei([])(f);
      g.settings[0].period_shime = null;
      g.settings[0].period_end_mode = 'month_end';
      return g;
    },
    { ura: '?henshu=1#set', matanai: true }
  );
  await page.waitForTimeout(1500);
  await page.waitForSelector('#pMode', { state: 'visible' });
  await kakuWoHikaeru(page);
  await page.selectOption('#pMode', 'matsu');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(500);
  await expect(page.locator('#err')).toContainText('「何日から」を 空にして');
  expect(await page.evaluate(() => window.__okutta.length)).toBe(0);
});

// わざと壊す：書けなかった 時も 欄を 倉庫の 形へ 戻す（shimeRirekiYomiNaoshi(!!wake) を () に）⇒ 赤（もう一度 押しても 書かない）
test('⑩ 締めの 記録が 書けなかった ⇒ 選んだ 払い方を 残し、もう一度 押すと 書く', async ({
  page,
}) => {
  await openKyuryo(page, settei(MATSU), { ura: '?henshu=1#set' });
  await kakuWoHikaeru(page);
  await page.waitForSelector('#pMode', { state: 'visible' });
  await page.evaluate(() => (window.__shimeOchiru = 1));
  await page.selectOption('#pMode', 'tsuki2');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  await expect(page.locator('#err')).toContainText('締めの 払い方は 保存できませんでした');
  expect(await page.inputValue('#pMode'), '★選んだ 払い方が 消えた★').toBe('tsuki2');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  const ki = await page.evaluate(() =>
    window.__okutta.filter((x) => x.p.indexOf('dk_shime_rireki') === 0)
  );
  expect(ki.length, '★もう一度 押しても 書かなかった★').toBe(2);
  expect(ki[1].b.value).toEqual({ kind: 'tsuki', hi: [15, 0] });
});
