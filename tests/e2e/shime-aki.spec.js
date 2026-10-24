// ============================================================
// ★★見張り：締めの 変え方で 月の 給料が 無くなる 件★★ 2026-10-19（docs/nannichi-kara-shime.md「月が 空く 件」）
//   給料は 毎月 払う 決まり（労基法24条）。空く 変え方は 保存・日付の 直し・消す を 止める。空いた 月は 訳を 出して 止める
//   ★時計は 2026-10-07（日本時間）★・列＝20日締め（始まった 日の 月の 分）
//
//   ★物差し★（わざと 壊して 赤に なるのを 見た 物は 各 試験の 頭に 書く）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

const KYOU = new Date('2026-10-07T12:00:00+09:00');
const RETSU = { kind: 'tsuki', hi: [20], nazuke: 'hajime' };
const MATSU = { kind: 'tsuki', hi: [0] };
const TSUITACHI = { kind: 'tsuki', hi: [1], nazuke: 'shime' };
function settei(kiroku, retsu) {
  return (f) => {
    const g = JSON.parse(JSON.stringify(f));
    g.settings[0].period_shime = retsu || RETSU;
    g.settings[0].period_end_mode = 'shime';
    g.shimeRireki = (kiroku || []).map((x, i) =>
      Object.assign({ rireki_id: 'r' + (i + 1), company_id: g.settings[0].company_id }, x)
    );
    return g;
  };
}
// 書く 物を 控える（倉庫へは 送らない）
async function kakuWoHikaeru(page) {
  await page.evaluate(() => {
    window.__okutta = [];
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      if (o && o.method) {
        window.__okutta.push({ p: String(p), m: o.method, b: o.body ? JSON.parse(o.body) : null });
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve([{ rireki_id: 'n1', updated_at: new Date().toISOString() }]),
        });
      }
      return moto.apply(this, arguments);
    };
  });
}
async function settaiAke(page, kiroku, retsu) {
  await openKyuryo(page, settei(kiroku, retsu), { ura: '?henshu=1#set' });
  await page.waitForSelector('#pMode', { state: 'visible' });
  await kakuWoHikaeru(page);
}
const kaki = (page) => page.evaluate(() => window.__okutta.map((x) => [x.m, x.p.split('?')[0]]));

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(KYOU);
});

// わざと壊す：btnSaveSet の shimeAkiMon の 門を 外す ⇒ 赤（設定と 記録を 書いた）
test('① 20日締め(始) を 9/10 から 1日締め(締) ⇒ 9月分が 無くなる＝保存しない・近い 日を 出す', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await settaiAke(page, []);
  await page.fill('#pHi', '2026-09-10');
  await page.dispatchEvent('#pHi', 'change');
  await page.selectOption('#pMode', 'tsuki1');
  await page.fill('#pShimeHi', '1');
  await page.dispatchEvent('#pShimeHi', 'input');
  await page.selectOption('#pNazuke', 'shime');
  // 見込みの 字にも 出る（2026-10-24 区切りの 一覧は やめた＝保存 できない 訳と 切り替わりの 字で 見る）
  await expect(page.locator('#pMsg')).toContainText('2026年9月分の 給料が 無くなります');
  await expect(page.locator('#pSetsumei')).toContainText('9月分は 給料が 無くなります');
  await page.click('#btnSaveSet');
  await expect(page.locator('#err')).toContainText(
    'この 変え方だと 2026年9月分の 給料が 無くなります（給料は 毎月 払う 決まり）。変える 日を'
  );
  // わざと壊す：訳から「設定も 保存していません」を 外す ⇒ 赤（他の 欄は 保存できたと 思い込む・対立役 本番前 直2）
  await expect(page.locator('#err')).toContainText('設定も 保存していません。');
  await page.waitForTimeout(300);
  expect(await kaki(page), '★空く 変え方を 書いた★').toEqual([]);
  expect(err).toEqual([]);
});

// わざと壊す：shimeAkiMon の「近い 日」を 探さない ⇒ 赤（9/1 が 出ない）
test('② 止めた 時の「近い 日」＝9/1 に すると 空かない・その 日なら 保存できる', async ({
  page,
}) => {
  await settaiAke(page, []);
  await page.fill('#pHi', '2026-09-10');
  await page.dispatchEvent('#pHi', 'change');
  await page.selectOption('#pMode', 'tsuki1');
  await page.fill('#pShimeHi', '1');
  await page.dispatchEvent('#pShimeHi', 'input');
  await page.selectOption('#pNazuke', 'shime');
  await page.click('#btnSaveSet');
  await expect(page.locator('#err')).toContainText('変える 日を 9/1 に すると 空きません');
  await page.waitForTimeout(300);
  expect(await kaki(page)).toEqual([]);
  // 言われた 日に すると 保存できる
  await page.fill('#pHi', '2026-09-01');
  await page.dispatchEvent('#pHi', 'change');
  await page.selectOption('#pMode', 'tsuki1');
  await page.fill('#pShimeHi', '1');
  await page.dispatchEvent('#pShimeHi', 'input');
  await page.selectOption('#pNazuke', 'shime');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  expect(await kaki(page)).toEqual([
    ['POST', 'dk_payroll_settings'],
    ['POST', 'dk_shime_rireki'],
  ]);
});

// ★28・29・30日締めは「締めた 日の 月の 分」だけ★（司さん 10-19「3/1〜3/30 が 2月分 おかしくないか」→「直せ」）
// わざと壊す：kikanDashiwake の 28 以上で 何月分の 欄を 隠す 所を 外す ⇒ 赤（欄が 見えた）
//            nijuhachiShime を 外す ⇒ 赤（記録に 'hajime' を 書いた）
test('②b 30日締めを 選ぶ ⇒ 何月分の 欄は 出ない・締めた 日の 月の 分で 書く', async ({ page }) => {
  await settaiAke(page, []);
  await page.fill('#pHi', '2026-10-01');
  await page.dispatchEvent('#pHi', 'change');
  await page.selectOption('#pMode', 'tsuki1');
  await page.fill('#pShimeHi', '20');
  await page.dispatchEvent('#pShimeHi', 'input');
  await expect(page.locator('#pNazukeRow')).toBeVisible();
  await page.selectOption('#pNazuke', 'hajime');
  await page.fill('#pShimeHi', '30');
  await page.dispatchEvent('#pShimeHi', 'input');
  await expect(page.locator('#pNazukeRow')).toBeHidden();
  // 締め日を 並べる 欄でも 28〜30 を 含めば 隠れる（[10,30]・2026-10-19 対立役 本番前6 直B）
  await page.selectOption('#pMode', 'narabe');
  await page.fill('#pNarabe', '10,30');
  await page.dispatchEvent('#pNarabe', 'input');
  await expect(page.locator('#pNazukeRow')).toBeHidden();
  await page.fill('#pNarabe', '10,27');
  await page.dispatchEvent('#pNarabe', 'input');
  await expect(page.locator('#pNazukeRow')).toBeVisible();
  await page.selectOption('#pMode', 'tsuki1');
  await page.fill('#pShimeHi', '30');
  await page.dispatchEvent('#pShimeHi', 'input');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  const o = await page.evaluate(() => window.__okutta);
  const ki = o.filter((x) => x.p.indexOf('dk_shime_rireki') === 0);
  expect(ki.length).toBe(1);
  expect(ki[0].b.value).toEqual({ kind: 'tsuki', hi: [30], nazuke: 'shime' });
});

// わざと壊す：shimeAkiFueta で 今 空いて いる 月を 引かない ⇒ 赤（もう 空いた 会社が 何も 保存 できない）
test('③ もう 空いた 会社が 別の 所を 保存 ⇒ 止めない', async ({ page }) => {
  await settaiAke(page, [{ from_date: '2026-09-10', value: TSUITACHI }]);
  await page.fill('#pHi', '');
  await page.dispatchEvent('#pHi', 'change');
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  expect(await kaki(page)).toEqual([['POST', 'dk_payroll_settings']]);
});

// わざと壊す：data-sk-del の 門を 外す ⇒ 赤（DELETE を 送った）
test('④ 消すと 10月分が 無くなる 記録 ⇒ 消さない', async ({ page }) => {
  await settaiAke(page, [
    { from_date: '2026-09-01', value: MATSU },
    { from_date: '2026-10-02', value: TSUITACHI },
  ]);
  await page.click('#pRirekiBtn');
  await page.click('#pRireki [data-sk-del="r1"]');
  await expect(page.locator('#err')).toContainText('2026年10月分の 給料が 無くなります');
  await page.waitForTimeout(300);
  expect(await kaki(page)).toEqual([]);
});

// わざと壊す：data-sk-hi の 門を 外す ⇒ 赤（PATCH を 送った）
test('⑤ 日付を 直すと 7月分が 無くなる ⇒ 直さない・欄は 倉庫の 日付に 戻る', async ({ page }) => {
  await settaiAke(page, [
    { from_date: '2026-09-01', value: MATSU },
    { from_date: '2026-10-02', value: TSUITACHI },
  ]);
  await page.click('#pRirekiBtn');
  await page.fill('#pRireki [data-sk-hi="r2"]', '2026-07-10');
  // fill が change も 出す（2回 出すと 戻った 欄で 同じ 日の PATCH が 出る）
  await expect(page.locator('#err')).toContainText('2026年7月分の 給料が 無くなります');
  await page.waitForTimeout(300);
  expect(await kaki(page)).toEqual([]);
  await expect(page.locator('#pRireki [data-sk-hi="r2"]')).toHaveValue('2026-10-02');
});

// わざと壊す：loadPeriod で kikanBun でなく KIKAN_KOWARE_BUN ⇒ 赤（訳が 違う）
test('⑥ 空いた 月を 開く ⇒ 明細を 出さずに 訳', async ({ page }) => {
  await openKyuryo(page, settei([{ from_date: '2026-09-10', value: TSUITACHI }]));
  // 今日（10/7）は 11月分（10/2〜11/1）。9月分まで 戻る
  await page.click('#prevM');
  await page.waitForTimeout(400);
  await page.click('#prevM');
  await expect(page.locator('#err')).toContainText(
    '締めの 変え方で この 月の 給料が 無くなっています'
  );
  expect(await page.locator('#slips').innerHTML()).toBe('');
});

// わざと壊す：shimeAkiMon の「触って いない＝通す」と「今 空いて いる 月を 引く」を 両方 外す ⇒ 赤（設定も 書かなかった）
test('⑦ 日付在りで 締めの 欄を 触らずに 保存 ⇒ 設定だけ 書く（門は 止めない）', async ({
  page,
}) => {
  await settaiAke(page, [{ from_date: '2026-09-10', value: TSUITACHI }]);
  await page.click('#btnSaveSet');
  await page.waitForTimeout(800);
  expect(await kaki(page)).toEqual([['POST', 'dk_payroll_settings']]);
});

// わざと壊す：shimeRowsYomu の 通信の 止めを 外す（failed でも 行を 返す）⇒ 赤（設定を 書いた）
test('⑧ 門の 読み直しが 通信で 落ちる ⇒ 何も 書かず「保存していません」', async ({ page }) => {
  await settaiAke(page, []);
  await page.evaluate(() => {
    const S = window.DKSession;
    const moto = S.softList;
    S.softList = function (s, p, y) {
      if (String(p).indexOf('dk_shime_rireki') >= 0) {
        if (y) {
          y.tried++;
          y.failed++;
        }
        return Promise.resolve([]);
      }
      return moto.apply(this, arguments);
    };
  });
  await page.fill('#pHi', '2026-10-01');
  await page.dispatchEvent('#pHi', 'change');
  await page.selectOption('#pMode', 'matsu');
  await page.click('#btnSaveSet');
  await expect(page.locator('#err')).toContainText(
    '締めの 変えた 記録を 読み直せませんでした（通信）。保存していません。'
  );
  await page.waitForTimeout(300);
  expect(await kaki(page)).toEqual([]);
});

// わざと壊す：shimeKirokuKaku の 書く 直前の 比べ直し（if (aki.length) return …）を 外す ⇒ 赤（空く 記録を 書いた）
test('⑨ 門の 後に 別の タブが 記録を 消して 空く ⇒ 締めの 記録は 書かない・訳', async ({
  page,
}) => {
  await settaiAke(page, [{ from_date: '2026-08-01', value: MATSU }]);
  // 1回目（門）は 今の 記録・2回目から（書く 直前・読み直し）は 別の タブが 消した 後＝[]
  await page.evaluate(() => {
    const S = window.DKSession;
    const moto = S.softList;
    let n = 0;
    S.softList = function (s, p) {
      if (String(p).indexOf('dk_shime_rireki') >= 0 && ++n >= 2) return Promise.resolve([]);
      return moto.apply(this, arguments);
    };
  });
  await page.fill('#pHi', '2026-09-10');
  await page.dispatchEvent('#pHi', 'change');
  await page.selectOption('#pMode', 'tsuki1');
  await page.fill('#pShimeHi', '1');
  await page.dispatchEvent('#pShimeHi', 'input');
  await page.selectOption('#pNazuke', 'shime');
  await page.click('#btnSaveSet');
  await expect(page.locator('#err')).toContainText(
    '2026年9月分の 給料が 無くなります（給料は 毎月 払う 決まり）。締めの 払い方は 保存していません（他は 保存しました）。'
  );
  expect(await kaki(page)).toEqual([['POST', 'dk_payroll_settings']]);
});
