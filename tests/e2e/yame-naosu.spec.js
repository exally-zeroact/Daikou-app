// ============================================================
// ★★辞めた 人の 歩合・役割・最低保証を 退職者ページで 直す★★ 2026-10-20
//   司さん 10-17「辞めた人の歩合等を復職させずに直せる様に」「何日から」は 今いる人と 同じ（既定は 今日）
//
//   ★物差し★
//     ① 退職者ページ：「歩合・役割を直す」⇒ 日付を 選んで 最低保証 ⇒ その 日から の 記録に 足す
//        （人の 列も 復職も 書かない）・書いた 後も 欄と 配る 箱は 開いた まま
//     ② 退職者ページの 欄から 書いた 記録で 辞めた 人の 明細が その 日から 後だけ 変わる（前の 日は 前の 額）
//     ③ パソコンの 幅でも 欄に 名前が 付く・役割の 候補が 在る
//   わざと壊す：renderYame の empOshiguchi() を 外す ⇒ ① 赤（書かない）／
//              YAME_NAOSU の 控えを 見ない ⇒ ① 赤（書いた 後に 閉じる）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

function yameNi(f) {
  f.emps = f.emps.map((e, i) =>
    i === 0 ? Object.assign({}, e, { active: false, retired_on: '2026-09-30' }) : e
  );
  return f;
}

async function yameWoHiraku(page, f0) {
  await openKyuryo(page, (f) => (f0 ? f0(yameNi(f)) : yameNi(f)));
  // 書いた 記録は 読み直しで 返す（書いた 値が 欄と 明細に 戻るかを 見る・対立役 2回目 B）
  await page.evaluate(() => {
    window.__okutta = [];
    window.__rk = [];
    const S = window.DKSession;
    const moto = S.rest;
    const motoSoft = S.softList;
    S.rest = function (s, p, o) {
      if (o && o.method && o.method !== 'GET') {
        window.__okutta.push({ p: String(p), m: o.method, b: o.body ? JSON.parse(o.body) : null });
        if (String(p).indexOf('dk_hito_rireki') === 0) {
          const b = o.body ? JSON.parse(o.body) : {};
          const gyou = Object.assign({ rireki_id: 'neo' + window.__rk.length }, b);
          if (o.method === 'POST') window.__rk.push(gyou);
          return Promise.resolve({
            ok: true,
            status: 201,
            json: () => Promise.resolve([gyou]),
          });
        }
      }
      return moto.apply(this, arguments);
    };
    S.softList = function (s, p, st) {
      if (String(p).indexOf('dk_hito_rireki') === 0) {
        if (st) st.tried++;
        return Promise.resolve(window.__rk.slice());
      }
      return motoSoft.apply(this, arguments);
    };
  });
  await page.click('.tab[data-tab="emp"]');
  await page.locator('[data-kiri="yame"]').click();
  await page.waitForSelector('#empBody [data-yame-naosu]', { state: 'visible' });
}

async function yameNoKazu(page, id) {
  return page.evaluate((x) => {
    let e = null;
    for (let i = 0; i < window.__paper.ninzu(); i++)
      if (window.__paper.emp(i).employee_id === x) e = window.__paper.emp(i);
    return e ? e.cells.filter((c) => c.pay > 0).map((c) => ({ d: c.date, pay: c.pay })) : null;
  }, id);
}

test('① 退職者ページで 日付を 選んで 最低保証を 直す ⇒ その 日から の 記録（復職しない）・欄に 戻る・開いた まま', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await yameWoHiraku(page);
  const id = await page.$eval('#empBody [data-yame-naosu]', (b) =>
    b.getAttribute('data-yame-naosu')
  );
  await page.click('#empBody [data-yame-haifu]');
  await page.click('#empBody [data-yame-naosu]');
  const hiIn = '#empBody .yame-naosu [data-hi]';
  await page.waitForSelector(hiIn, { state: 'visible' });
  expect(await page.$eval(hiIn, (i) => i.value), '★既定の 日（今日）が 入っていない★').toMatch(
    /^\d{4}-\d{2}-\d{2}$/
  );
  await page.fill(hiIn, '2026-08-01');
  await page.dispatchEvent(hiIn, 'change');
  const yuka = '#empBody .yame-naosu [data-f="pay_floor"]';
  await page.fill(yuka, '1300');
  await page.press(yuka, 'Tab');
  await page.waitForTimeout(1000);
  const o = await page.evaluate(() => window.__okutta);
  // eslint-disable-next-line no-console
  console.log('★①★ ' + JSON.stringify(o));
  const rk = o.filter((x) => x.p.indexOf('dk_hito_rireki') === 0);
  expect(rk.length, '★記録に 書いていない★').toBe(1);
  expect(rk[0].m).toBe('POST');
  expect(rk[0].b).toMatchObject({
    employee_id: id,
    key: 'pay_floor',
    from_date: '2026-08-01',
    value: 1300,
  });
  expect(
    o.filter((x) => x.p.indexOf('dk_employees') === 0).length,
    '★人の 列（復職 等）まで 書いた★'
  ).toBe(0);
  const ato = await page.evaluate(() => ({
    atai: (document.querySelector('#empBody .yame-naosu [data-f="pay_floor"]') || {}).value,
    kiroku: (
      (document.querySelector('#empBody .yame-naosu [data-rireki]') || {}).textContent || ''
    ).trim(),
    hi: (document.querySelector('#empBody .yame-naosu [data-hi]') || {}).value || '',
    box: [...document.querySelectorAll('#empBody [data-yame-box]')].some(
      (b) => b.style.display !== 'none'
    ),
    chui: ((document.querySelector('#empBody .yame-naosu-chui') || {}).textContent || '').trim(),
    yame: document.querySelectorAll('#empBody [data-fukushoku]').length,
  }));
  // eslint-disable-next-line no-console
  console.log('★①後★ ' + JSON.stringify(ato));
  expect(ato.atai, '★書いた 値が 欄に 戻っていない★').toBe('1300');
  expect(ato.kiroku, '★記録の 数が 増えていない★').toBe('記録 1');
  expect(ato.hi, '★選んだ 日が 今日に 戻った★').toBe('2026-08-01');
  expect(ato.box, '★書いた 後に 配る 箱が 閉じた★').toBe(true);
  expect(ato.chui, '★選んだ 日から 後だけに 効く 字が 無い★').toContain(
    '8/1 から 後の 分だけに 効きます'
  );
  expect(ato.yame, '★退職者ページで なくなった★').toBeGreaterThan(0);
  expect(err).toEqual([]);
});

test('② 退職者ページの 欄から 書いた 記録で、辞めた 人の 明細が その 日から 後だけ 変わる', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await yameWoHiraku(page);
  const yameId = require('../fixtures/kyuryo-real.json').emps[0].employee_id;
  const moto = await yameNoKazu(page, yameId);
  expect(moto, '★辞めた 人が 明細に 居ない（材料が 違う）★').not.toBeNull();
  expect(moto.length, '★働いた 日が 2日 要る★').toBeGreaterThanOrEqual(2);
  const hi2 = moto[1].d;
  await page.click('#empBody [data-yame-naosu="' + yameId + '"]');
  const hiIn = '#empBody .yame-naosu [data-hi="' + yameId + '"]';
  await page.waitForSelector(hiIn, { state: 'visible' });
  await page.fill(hiIn, hi2);
  await page.dispatchEvent(hiIn, 'change');
  const yuka = '#empBody .yame-naosu [data-emp="' + yameId + '"][data-f="pay_floor"]';
  await page.fill(yuka, '99999');
  await page.press(yuka, 'Tab');
  await page.waitForTimeout(1200);
  const ato = await yameNoKazu(page, yameId);
  // eslint-disable-next-line no-console
  console.log('★②★ ' + JSON.stringify({ moto: moto.slice(0, 2), ato: (ato || []).slice(0, 2) }));
  expect(ato, '★辞めた 人が 明細から 消えた★').not.toBeNull();
  expect(ato[0].pay, '★記録の 日より 前の 額が 変わった★').toBe(moto[0].pay);
  expect(ato[1].pay, '★欄から 書いた 最低保証が 明細に 効いていない★').toBeGreaterThanOrEqual(
    99999
  );
  expect(err).toEqual([]);
});

test('③ パソコンの 幅でも 欄に 名前・役割の 候補が 在る', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await yameWoHiraku(page);
  await page.click('#empBody [data-yame-naosu]');
  await page.waitForSelector('#empBody .yame-naosu', { state: 'visible' });
  const r = await page.evaluate(() => ({
    mi: [...document.querySelectorAll('#empBody .yame-naosu .yn-mi')]
      .filter((x) => x.offsetParent !== null)
      .map((x) => x.textContent),
    kouho: document.querySelectorAll('#roleList option').length,
    list: (document.querySelector('#empBody .yame-naosu [data-f="role"]') || {}).getAttribute(
      'list'
    ),
  }));
  // eslint-disable-next-line no-console
  console.log('★③★ ' + JSON.stringify(r));
  expect(r.mi).toEqual(['役割', '歩合', '最低保証', '何日から']);
  expect(r.list).toBe('roleList');
  expect(r.kouho, '★役割の 候補が 無い★').toBeGreaterThan(0);
});

test('④ スマホの 幅：欄が 潰れない・辞めた 日より 後を 選ぶと その 事を 字で 出す', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await yameWoHiraku(page);
  await page.click('#empBody [data-yame-naosu]');
  const hiIn = '#empBody .yame-naosu [data-hi]';
  await page.waitForSelector(hiIn, { state: 'visible' });
  // 辞めた 日（材料は 9/30）より 後・今日より 前
  await page.fill(hiIn, '2026-10-05');
  await page.dispatchEvent(hiIn, 'change');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const haba = (s) => {
      const x = document.querySelector('#empBody .yame-naosu ' + s);
      return x ? Math.round(x.getBoundingClientRect().width) : -1;
    };
    return {
      role: haba('[data-f="role"]'),
      rate: haba('[data-f="pay_rate"]'),
      floor: haba('[data-f="pay_floor"]'),
      hi: haba('[data-hi]'),
      hami: document.documentElement.scrollWidth - window.innerWidth,
      // 名前と ボタンの 字が 縦に 割れていない（1行の 高さ）
      tate: [...document.querySelectorAll('#empBody .yame-na > span, #empBody .yame-na .btn')].map(
        (x) => {
          // 字の 並びの 行の 数（余白は 数えない）
          const rg = document.createRange();
          rg.selectNodeContents(x);
          return new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size;
        }
      ),
      chui: ((document.querySelector('#empBody .yame-naosu-chui') || {}).textContent || '').trim(),
    };
  });
  // eslint-disable-next-line no-console
  console.log('★④★ ' + JSON.stringify(r));
  await page.screenshot({ path: 'test-results/yame-naosu-390.png', fullPage: false });
  expect(r.role, '★役割の 欄が 潰れている★').toBeGreaterThanOrEqual(100);
  expect(r.rate, '★歩合の 欄が 潰れている★').toBeGreaterThanOrEqual(40);
  expect(r.floor, '★最低保証の 欄が 潰れている★').toBeGreaterThanOrEqual(60);
  expect(r.hi, '★日付の 欄が 潰れている★').toBeGreaterThanOrEqual(100);
  expect(r.hami, '★画面が 横に はみ出している★').toBeLessThanOrEqual(0);
  expect(Math.max(...r.tate), '★名前か ボタンの 字が 縦に 割れている★').toBeLessThanOrEqual(1);
  expect(r.chui, '★辞めた 日より 後を 選んだのに 黙っている★').toContain(
    '辞めた 日（9/30）より 後に'
  );
  expect(err).toEqual([]);
});

// ★⑤ スマホの 幅：名前の 見出しの 太字が 名前の 欄の 外へ 移らない★ 2026-10-20
//   前は `.emp-pane td:first-child .txt`（名前の 見出し＝16px 太字・幅いっぱい）が、升が 1つしか 無い 行の 中の
//   欄にも 効いていた＝①退職者の 行の 役割の 欄 ②「記録」の 行の 値の 欄（今いる人・退職者の 両方）。
//   直した 後は どれも 今いる 人の 役割の 欄と 同じ（400・16px・同じ 幅）。名前だけ 700・16px。
//   わざと壊す：規則を `td:first-child .txt` に 戻す ⇒ ⑤ 赤／.rolein に 太字 ⇒ ⑤ 赤
test('⑤ スマホの 幅：名前の 見出しの 太字が 役割・記録の 欄に 移らない（今いる人・退職者）', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await page.setViewportSize({ width: 390, height: 844 });
  // 記録を 1本ずつ（辞めた 人＝emps[0]・今いる 人＝emps[1]）
  await yameWoHiraku(page, (f) => {
    f.rireki = [0, 1].map((i) => ({
      rireki_id: 'rk' + i,
      employee_id: f.emps[i].employee_id,
      key: 'pay_floor',
      value: 1300,
      from_date: '2026-08-01',
    }));
    return f;
  });
  const kata = (s) =>
    page.$eval(s, (x) => {
      const c = getComputedStyle(x);
      return { w: c.fontWeight, s: c.fontSize, haba: Math.round(x.getBoundingClientRect().width) };
    });
  await page.click('#empBody [data-yame-naosu]');
  await page.waitForSelector('#empBody .yame-naosu [data-f="role"]', { state: 'visible' });
  const yameRole = await kata('#empBody .yame-naosu [data-f="role"]');
  await page.click('#empBody .yame-naosu [data-rireki]');
  await page.waitForSelector('#empBody .rireki-r [data-rk-v]', { state: 'visible' });
  const yameRk = await kata('#empBody .rireki-r [data-rk-v]');
  await page.locator('[data-kiri="ima"]').click();
  await page.waitForSelector('#empBody td[data-l="役割"] [data-f="role"]', { state: 'visible' });
  const imaRole = await kata('#empBody td[data-l="役割"] [data-f="role"]');
  const na = await kata('#empBody td[data-l="名前"] > .txt');
  await page.click('#empBody td [data-rireki]');
  await page.waitForSelector('#empBody .rireki-r [data-rk-v]', { state: 'visible' });
  const imaRk = await kata('#empBody .rireki-r [data-rk-v]');
  // eslint-disable-next-line no-console
  console.log('★⑤★ ' + JSON.stringify({ yameRole, yameRk, imaRole, imaRk, na }));
  // 幅も 値で 決める（9em＝144px・PC と 同じ）＝全部が 幅いっぱいに 揃っても 緑に しない（対立役 2回目 穴A）
  const futsuu = { w: '400', s: '16px', haba: 144 };
  expect(imaRole.w, '★今いる 人の 役割が 太字★').toBe('400');
  expect(yameRole, '★辞めた 人の 役割の 欄が 今いる 人と 違う★').toEqual(futsuu);
  expect(yameRk, '★退職者の 記録の 値の 欄が 今いる 人の 役割と 違う★').toEqual(futsuu);
  expect(imaRk, '★今いる 人の 記録の 値の 欄が 役割と 違う★').toEqual(futsuu);
  // 名前の 見出しは 前の まま（直し過ぎて 名前まで 細くしない）
  expect({ w: na.w, s: na.s }, '★名前の 見出しが 太字・16px で なくなった★').toEqual({
    w: '700',
    s: '16px',
  });
  expect(na.haba, '★名前の 見出しが 幅いっぱいで なくなった★').toBeGreaterThan(250);
  expect(err).toEqual([]);
});
