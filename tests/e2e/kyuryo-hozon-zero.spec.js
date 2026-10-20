// ============================================================
// ★★人の 欄の 保存（saveEmp）＝書けなかったら「保存しました」と 出さず、その 欄だけ 前の 値に 戻す★★ 2026-10-20
//   前は 返りの 行を 見ていなかった（Prefer: return=representation が 無い）＝
//   RLS や 会社の 食い違いで 0行でも 200/204 なら「保存しました」と 出し、画面の 値（RAW）だけ 変えていた。
//   書けなかった 時も 打った 字が 欄に 残り、保存済みに 見えた。
//   退職・復職（empTaishoku）と 記録（rirekiKaku）は 前から 行を 見ている＝同じ 形に 揃える。
//
//   ★物差し★（今いる 人の 欄を 打ち替える）
//     ①0行 ②別の 人の 行だけ ③403 ④500（訳は 遅れて 届く） ⑤通信が 切れた ⑥204 で 中身が 空
//       ⇒「保存しました」が 出ない・訳が 出る・その 欄が 前の 値・描き直しても 前の 値（RAW 不変）
//     ⑦その 人の 行が 返る ⇒「保存しました」・描き直すと 打った 値（RAW が 変わった）
//     ⑧名前が 書けず 並びが 書けた（続けて 打つ）⇒ 名前だけ 戻り、並びは 7 の まま・食い違わない
//     ⑨書けなかった 知らせが 来た 時に 別の 欄を 打ちかけ ⇒ 打ちかけの 字と フォーカスが 残る
//     ⑩明細に出す車の チェックが 書けない ⇒ チェックが 前に 戻る
//     ⑪「最初から」で 歩合を 送る 間に 日付を 今日へ 戻し、0行 ⇒ 欄は 今日の 値（記録の 0.9）に 戻る（対立役 3回目 指1）
//     ⑫役割・最低保証も「最初から」で 0行 ⇒ 戻る ⑬退職者ページの 欄も 0行 ⇒ 戻る
//   わざと壊す：返りの 行を 見ない ⇒ ①② 赤／RAW の 書き換えを 判じより 前へ ⇒ ①② 赤／
//              欄を 戻さない ⇒ ①〜⑥ ⑩ ⑫ ⑬ 赤／表 全体を 描き直す（renderEmp）⇒ ⑧⑨ 赤／
//              選んだ 日を 見ず 列の 値で 戻す ⇒ ⑪ 赤
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

// 欄ごとの 返し方を 決めて 開く（{ name: ['zero', 400], sort_order: ['jibun', 0] } 等＝[返し方, 遅れms]）
async function hiraku(page, kime, naosu) {
  const err = [];
  page.on('pageerror', (x) => err.push(x.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openKyuryo(page, naosu);
  await page.evaluate((km) => {
    window.__okutta = [];
    const S = window.DKSession;
    const moto = S.rest;
    S.rest = function (s, p, o) {
      // 記録（日付付き）の 送りを 返さない 形（km.__rireki＝'kotaenai'）
      // 記録の 送りを 書けた 形で 返す（km.__rireki＝'jibun'）＝読み直しの 遅れを 測る 為
      if (
        km.__rireki === 'jibun' &&
        o &&
        o.method === 'POST' &&
        String(p).indexOf('dk_hito_rireki') === 0
      ) {
        window.__okutta.push({ f: 'rireki', h: (o && o.headers) || {} });
        const b = o.body ? JSON.parse(o.body) : {};
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve([Object.assign({ rireki_id: 'rk-new' }, b)]),
        });
      }
      if (
        km.__rireki === 'kotaenai' &&
        o &&
        o.method &&
        o.method !== 'GET' &&
        String(p).indexOf('dk_hito_rireki') === 0
      ) {
        window.__okutta.push({ f: 'rireki', h: (o && o.headers) || {} });
        return new Promise(() => {});
      }
      if (o && o.method === 'PATCH' && String(p).indexOf('dk_employees') === 0) {
        const b = o.body ? JSON.parse(o.body) : {};
        const f = Object.keys(b).filter((k) => k !== 'updated_at')[0];
        window.__okutta.push({ f: f, h: (o && o.headers) || {} });
        const id = decodeURIComponent(String(p).split('employee_id=eq.')[1] || '');
        // 欄ごとに [返し方, 遅れms]。同じ 欄の 何回目かで 変える 時は [[..],[..]]
        window.__kai = window.__kai || {};
        const kai = (window.__kai[f] = (window.__kai[f] || 0) + 1);
        const c = km[f] || ['jibun', 0];
        const [k, osoi] = Array.isArray(c[0]) ? c[Math.min(kai, c.length) - 1] : c;
        const kotae = () => {
          if (k === 'kireta') return Promise.reject(new Error('net'));
          if (k === 'kotaenai') return new Promise(() => {}); // 返事が 来ない（電波が 悪い）
          if (k === 'kotowaru' || k === 'kowareta') {
            const st = k === 'kotowaru' ? 403 : 500;
            return Promise.resolve({
              ok: false,
              status: st,
              text: () => new Promise((ok) => setTimeout(() => ok('boom' + st), 50)),
              json: () => Promise.resolve({ message: 'boom' + st }),
            });
          }
          if (k === 'kara')
            return Promise.resolve({
              ok: true,
              status: 204,
              json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
            });
          const rows =
            k === 'zero'
              ? []
              : k === 'tanin'
                ? [{ employee_id: 'betsu-no-hito' }]
                : [{ employee_id: id }];
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(rows) });
        };
        return new Promise((ok) => setTimeout(ok, osoi || 0)).then(kotae);
      }
      return moto.apply(this, arguments);
    };
  }, kime);
  await page.click('.tab[data-tab="emp"]');
  await page.waitForSelector('#empBody [data-f="sort_order"]', { state: 'visible' });
  const id = await page.locator('#empBody [data-f="sort_order"]').first().getAttribute('data-emp');
  const ran = (f) => '#empBody [data-emp="' + id + '"][data-f="' + f + '"]';
  const yomu = () =>
    page.evaluate(() => ({
      okutta: window.__okutta,
      saved: (document.getElementById('empSaved') || {}).textContent || '',
      err: ((document.getElementById('err') || {}).textContent || '').trim(),
    }));
  // 描き直す（退職者 ⇒ 従業員）＝欄は RAW の 値で 描かれる
  const kakinaosu = async () => {
    await page.locator('[data-kiri="yame"]').click();
    await page.locator('[data-kiri="ima"]').click();
    await page.waitForSelector(ran('sort_order'), { state: 'visible' });
  };
  return { err, id, ran, yomu, kakinaosu };
}

for (const [na, k, ji] of [
  ['① 返りが 0行', 'zero', '書けた 行が ありません'],
  ['② 返りに 別の 人の 行しか 無い', 'tanin', '書けた 行が ありません'],
  ['③ 倉庫が 断った（403）', 'kotowaru', '保存できませんでした'],
  // 訳は その場で 作る（後から 読みに 行かない・対立役 6回目 中1）＝[500]
  ['④ 倉庫が 落ちた（500）', 'kowareta', '[500]'],
  ['⑤ 通信が 切れた', 'kireta', '保存できませんでした'],
  ['⑥ 204 で 中身が 空', 'kara', '保存できませんでした'],
]) {
  test(
    na + ' ⇒「保存しました」と 出さず、訳を 出し、その 欄を 前の 値に 戻す',
    async ({ page }) => {
      const h = await hiraku(page, { sort_order: [k, 0] });
      const moto = await page.locator(h.ran('sort_order')).inputValue();
      await page.locator(h.ran('sort_order')).fill('7');
      await page.locator(h.ran('sort_order')).press('Tab');
      await page.waitForTimeout(400);
      const r = await h.yomu();
      r.moto = moto;
      r.ran = await page.locator(h.ran('sort_order')).inputValue();
      await h.kakinaosu();
      r.raw = await page.locator(h.ran('sort_order')).inputValue();
      // eslint-disable-next-line no-console
      console.log('★' + k + '★ ' + JSON.stringify(r));
      expect(r.okutta.length, '★人の 列に 書きに 行っていない★').toBe(1);
      expect(r.okutta[0].h.Prefer, '★返りの 行を 頼んでいない★').toContain('return=representation');
      expect(r.saved, '★書けなかったのに「保存しました」と 出した★').not.toContain('保存しました');
      expect(r.err, '★書けなかった 事を 黙っている★').toContain(ji);
      expect(r.moto, '★材料の 並びが 7 だった（試験が 空振り）★').not.toBe('7');
      expect(r.ran, '★書けなかったのに 欄に 打った 字が 残っている★').toBe(r.moto);
      expect(r.raw, '★書けなかったのに 画面の 値（RAW）が 変わった★').toBe(r.moto);
      expect(h.err).toEqual([]);
    }
  );
}

test('⑦ 返りに その 人の 行が 在る ⇒「保存しました」・描き直すと 打った 値', async ({ page }) => {
  const h = await hiraku(page, {});
  await page.locator(h.ran('sort_order')).fill('7');
  await page.locator(h.ran('sort_order')).press('Tab');
  await page.waitForTimeout(400);
  const r = await h.yomu();
  await h.kakinaosu();
  r.raw = await page.locator(h.ran('sort_order')).inputValue();
  // eslint-disable-next-line no-console
  console.log('★jibun★ ' + JSON.stringify(r));
  expect(r.saved, '★書けたのに「保存しました」が 出ない★').toContain('保存しました');
  expect(r.err, '★書けたのに 赤い 字が 出た★').toBe('');
  expect(r.raw, '★書けたのに 画面の 値（RAW）が 変わっていない★').toBe('7');
  expect(h.err).toEqual([]);
});

test('⑧ 名前が 書けず（遅れて）並びが 書けた ⇒ 名前だけ 戻り、並びは 7 の まま', async ({
  page,
}) => {
  const h = await hiraku(page, { name: ['zero', 400], sort_order: ['jibun', 900] });
  const motoNa = await page.locator(h.ran('name')).inputValue();
  await page.locator(h.ran('name')).fill('かえた名前');
  await page.locator(h.ran('name')).press('Tab');
  await page.locator(h.ran('sort_order')).fill('7');
  await page.locator(h.ran('sort_order')).press('Tab');
  await page.waitForTimeout(1300);
  const r = {
    na: await page.locator(h.ran('name')).inputValue(),
    narabi: await page.locator(h.ran('sort_order')).inputValue(),
  };
  await h.kakinaosu();
  r.rawNa = await page.locator(h.ran('name')).inputValue();
  r.rawNarabi = await page.locator(h.ran('sort_order')).inputValue();
  // eslint-disable-next-line no-console
  console.log('★⑧★ ' + JSON.stringify(r));
  expect(r.na, '★書けなかった 名前が 欄に 残っている★').toBe(motoNa);
  expect(r.narabi, '★書けた 並びが 欄から 消えた（画面と 倉庫が 食い違う）★').toBe('7');
  // ★名前の 失敗の 訳は 並びの 成功で 消さない★（黙って 戻した 事に しない・対立役 4回目 指2）
  expect(
    ((await page.locator('#err').textContent()) || '').trim(),
    '★名前の 失敗の 訳が 並びの 成功で 消えた★'
  ).toContain('書けた 行が ありません');
  expect(r.rawNa).toBe(motoNa);
  expect(r.rawNarabi).toBe('7');
  expect(h.err).toEqual([]);
});

test('⑨ 書けなかった 知らせが 来た 時に 別の 欄を 打ちかけ ⇒ 打ちかけと フォーカスが 残る', async ({
  page,
}) => {
  const h = await hiraku(page, { name: ['zero', 400] });
  await page.locator(h.ran('name')).fill('かえた名前');
  await page.locator(h.ran('name')).press('Tab');
  await page.locator(h.ran('sort_order')).focus();
  await page.locator(h.ran('sort_order')).fill('99');
  await page.waitForTimeout(800);
  const r = await page.evaluate(
    (s) => ({
      uchikake: document.querySelector(s).value,
      focus: document.activeElement === document.querySelector(s),
      okutta: window.__okutta.map((x) => x.f),
    }),
    h.ran('sort_order')
  );
  // eslint-disable-next-line no-console
  console.log('★⑨★ ' + JSON.stringify(r));
  expect(r.uchikake, '★打ちかけの 字が 消えた★').toBe('99');
  expect(r.focus, '★打っている 欄から フォーカスが 飛んだ★').toBe(true);
  expect(r.okutta, '★打ちかけが 勝手に 保存に 行った★').toEqual(['name']);
  expect(h.err).toEqual([]);
});

test('⑩ 明細に出す車の チェックが 書けない ⇒ チェックが 前に 戻る', async ({ page }) => {
  const h = await hiraku(page, { slip_cars: ['zero', 0] });
  const cb = h.ran('slip_cars');
  const kazu = await page.locator(cb).count();
  expect(kazu, '★材料に 車が 無い（試験が 空振り）★').toBeGreaterThan(0);
  const moto = await page.locator(cb).first().isChecked();
  await page.locator(cb).first().click();
  await page.waitForTimeout(400);
  const r = await h.yomu();
  r.moto = moto;
  r.ima = await page.locator(cb).first().isChecked();
  // eslint-disable-next-line no-console
  console.log('★⑩★ ' + JSON.stringify(r));
  expect(r.okutta.map((x) => x.f)).toEqual(['slip_cars']);
  expect(r.saved).not.toContain('保存しました');
  expect(r.ima, '★書けなかった チェックが 残っている★').toBe(moto);
  expect(h.err).toEqual([]);
});

// 日付の 欄を 空（最初から）か 決めた 日に する
async function hiWoKaeru(page, id, v) {
  const hi = '#empBody [data-hi="' + id + '"]';
  await page.locator(hi).fill(v);
  await page.locator(hi).dispatchEvent('change');
  await page.waitForTimeout(100);
}

test('⑪「最初から」で 歩合を 送る 間に 日付を 今日へ 戻し 0行 ⇒ 欄は 今日の 値に 戻る', async ({
  page,
}) => {
  const h = await hiraku(page, { pay_rate: ['zero', 800] }, (f) => {
    // 一番 上の 人（並び 1）に 2000-01-01 から 歩合 0.9 の 記録
    const e = f.emps.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))[0];
    f.rireki = [
      {
        rireki_id: 'x',
        company_id: e.company_id,
        employee_id: e.employee_id,
        key: 'pay_rate',
        from_date: '2000-01-01',
        value: 0.9,
      },
    ];
    return f;
  });
  const kyou = await page.locator('#empBody [data-hi="' + h.id + '"]').inputValue();
  const kyouNo = await page.locator(h.ran('pay_rate')).inputValue();
  await hiWoKaeru(page, h.id, '');
  const saisho = await page.locator(h.ran('pay_rate')).inputValue();
  await page.locator(h.ran('pay_rate')).fill('0.5');
  await page.locator(h.ran('pay_rate')).press('Tab');
  await hiWoKaeru(page, h.id, kyou);
  await page.waitForTimeout(1200);
  const r = await h.yomu();
  r.kyou = kyou;
  r.kyouNo = kyouNo;
  r.saisho = saisho;
  r.ato = await page.locator(h.ran('pay_rate')).inputValue();
  r.hi = await page.locator('#empBody [data-hi="' + h.id + '"]').inputValue();
  // eslint-disable-next-line no-console
  console.log('★⑪★ ' + JSON.stringify(r));
  expect(
    r.okutta.map((x) => x.f),
    '★「最初から」の 歩合を 列に 送っていない★'
  ).toEqual(['pay_rate']);
  expect(r.kyouNo, '★材料の 今日の 歩合が 0.9 で ない（試験が 空振り）★').toBe('0.9');
  expect(r.saisho, '★最初からの 歩合が 0.9（試験が 空振り）★').not.toBe('0.9');
  expect(r.hi).toBe(kyou);
  expect(r.err).toContain('書けた 行が ありません');
  expect(r.ato, '★今日の 欄に 別の 日の 値が 出た★').toBe('0.9');
  expect(h.err).toEqual([]);
});

for (const [f, ate] of [
  ['role', '書けない役割'],
  ['pay_floor', '4321'],
]) {
  test('⑫「最初から」の ' + f + ' が 0行 ⇒ 欄が 前の 値に 戻る', async ({ page }) => {
    const h = await hiraku(page, { [f]: ['zero', 0] });
    await hiWoKaeru(page, h.id, '');
    const moto = await page.locator(h.ran(f)).inputValue();
    await page.locator(h.ran(f)).fill(ate);
    await page.locator(h.ran(f)).press('Tab');
    await page.waitForTimeout(400);
    const r = await h.yomu();
    r.moto = moto;
    r.ato = await page.locator(h.ran(f)).inputValue();
    // eslint-disable-next-line no-console
    console.log('★⑫' + f + '★ ' + JSON.stringify(r));
    expect(r.okutta.map((x) => x.f)).toEqual([f]);
    expect(r.moto).not.toBe(ate);
    expect(r.err).toContain('書けた 行が ありません');
    expect(r.ato, '★書けなかった 字が 欄に 残っている★').toBe(r.moto);
    expect(h.err).toEqual([]);
  });
}

test('⑬ 退職者ページの 最低保証が 0行 ⇒ 欄が 前の 値に 戻る', async ({ page }) => {
  let yameId = '';
  const h = await hiraku(page, { pay_floor: ['zero', 0] }, (f) => {
    f.emps = f.emps.map((e, i) => {
      if (i !== 0) return e;
      yameId = e.employee_id;
      return Object.assign({}, e, { active: false, retired_on: '2026-09-30' });
    });
    return f;
  });
  await page.locator('[data-kiri="yame"]').click();
  await page.click('#empBody [data-yame-naosu]');
  const yid = await page.$eval('#empBody [data-yame-naosu]', (b) =>
    b.getAttribute('data-yame-naosu')
  );
  await hiWoKaeru(page, yid, '');
  const ran = '#empBody .yame-naosu [data-emp="' + yid + '"][data-f="pay_floor"]';
  const moto = await page.locator(ran).inputValue();
  await page.locator(ran).fill('4321');
  await page.locator(ran).press('Tab');
  await page.waitForTimeout(400);
  const r = await h.yomu();
  r.moto = moto;
  r.ato = await page.locator(ran).inputValue();
  r.hiraita = await page.locator('#empBody .yame-naosu').count();
  // eslint-disable-next-line no-console
  console.log('★⑬★ ' + JSON.stringify(r));
  expect(yameId.length).toBeGreaterThan(0);
  expect(r.okutta.map((x) => x.f)).toEqual(['pay_floor']);
  expect(r.err).toContain('書けた 行が ありません');
  expect(r.ato, '★書けなかった 字が 欄に 残っている★').toBe(r.moto);
  expect(r.hiraita, '★直す 欄が 閉じた★').toBe(1);
  expect(h.err).toEqual([]);
});

// ★★同じ 欄を 続けて 2回 打つ（返りの 順が 入れ替わる）★★ 2026-10-20（対立役 4回目 指1）
//   欄と 描き直した 値（RAW＝計算）が 揃う 事・「保存しました」と 訳が 嘘を つかない 事
for (const [na, kime, kotae] of [
  [
    'C 1回目が 速く 失敗・2回目が 遅く 成功',
    [
      ['kotowaru', 300],
      ['jibun', 900],
    ],
    '0.6',
  ],
  [
    'B 1回目が 遅く 成功・2回目が 速く 失敗',
    [
      ['jibun', 900],
      ['kotowaru', 50],
    ],
    '0.5',
  ],
  // 2回とも 書けて 1回目が 遅い＝送りを 並べないと 倉庫も 計算も 古い 0.5 に なった（対立役 5回目 止1）
  [
    'A 2回とも 成功・1回目が 遅い',
    [
      ['jibun', 900],
      ['jibun', 50],
    ],
    '0.6',
  ],
]) {
  test('⑭ 歩合を 0.5→0.6 と 続けて 打つ（' + na + '）⇒ 欄と 計算が 揃う', async ({ page }) => {
    const h = await hiraku(page, { pay_rate: kime });
    await hiWoKaeru(page, h.id, '');
    const ran = page.locator(h.ran('pay_rate'));
    await ran.fill('0.5');
    await ran.press('Tab');
    await ran.fill('0.6');
    await ran.press('Tab');
    // 途中（1回目の 返りが 来て 2回目は まだ）＝古い 返りが 欄を 戻したり 訳を 出したり しない
    await page.waitForTimeout(550);
    const naka = {
      ran: await ran.inputValue(),
      err: ((await page.locator('#err').textContent()) || '').trim(),
    };
    if (kotae === '0.6') {
      expect(naka.ran, '★古い 失敗が 打った 欄を 戻した★').toBe('0.6');
      // 途中は「保存中＝明細・紙を 止めて います」が 出る（2回目が 列で 待つ）。古い 失敗の 訳は 出さない
      expect(naka.err, '★古い 失敗の 訳が 出た★').not.toContain('保存できませんでした');
    }
    await page.waitForTimeout(850);
    const r = await h.yomu();
    r.ran = await ran.inputValue();
    await h.kakinaosu();
    await hiWoKaeru(page, h.id, '');
    r.raw = await page.locator(h.ran('pay_rate')).inputValue();
    // eslint-disable-next-line no-console
    console.log(
      '★⑭' +
        na.slice(0, 1) +
        '★ ' +
        JSON.stringify({ ran: r.ran, raw: r.raw, err: r.err, saved: r.saved })
    );
    expect(r.raw, '★計算の 値が 違う★').toBe(kotae);
    expect(r.ran, '★欄と 計算の 値が 食い違う★').toBe(r.raw);
    if (kotae === '0.6') {
      expect(r.err, '★最後に 書けたのに 赤い 字が 残る★').toBe('');
    } else {
      expect(r.err, '★最後の 送りが 失敗したのに 黙っている★').toContain('保存できませんでした');
    }
    expect(h.err).toEqual([]);
  });
}

test('⑮ 成功の 返りを 待つ 間に 日付を 変えても 欄は 今の 日の 値', async ({ page }) => {
  const h = await hiraku(page, { pay_rate: ['jibun', 800] });
  const kyou = await page.locator('#empBody [data-hi="' + h.id + '"]').inputValue();
  await hiWoKaeru(page, h.id, '');
  const ran = page.locator(h.ran('pay_rate'));
  await ran.fill('0.5');
  await ran.press('Tab');
  await hiWoKaeru(page, h.id, kyou);
  await page.waitForTimeout(1200);
  const r = { ran: await page.locator(h.ran('pay_rate')).inputValue() };
  await h.kakinaosu();
  r.raw = await page.locator(h.ran('pay_rate')).inputValue();
  // eslint-disable-next-line no-console
  console.log('★⑮★ ' + JSON.stringify(r));
  expect(r.ran, '★欄が 描き直した 時の 値と 違う★').toBe(r.raw);
});

// ★⑯ 明細・紙を 止めている 警告は 保存の 成功で 消さない★（対立役 5回目 止2）
//   売上の 直しが 読めない 業務を 1件 置く ⇒ recalc が 止めの 警告を 出す。名前を 失敗 → 打ち直して 成功
test('⑯ 止めの 警告は 同じ 欄を 打ち直して 成功しても 残る', async ({ page }) => {
  const h = await hiraku(
    page,
    {
      name: [
        ['kotowaru', 0],
        ['jibun', 0],
      ],
    },
    (f) => {
      f.edits = (f.edits || []).concat([
        { shift_id: f.shifts[0].shift_id, uriage_yen: 'よめない' },
      ]);
      return f;
    }
  );
  const err0 = ((await page.locator('#err').textContent()) || '').trim();
  const ran = page.locator(h.ran('name'));
  await ran.fill('かえた1');
  await ran.press('Tab');
  await page.waitForTimeout(400);
  const err1 = ((await page.locator('#err').textContent()) || '').trim();
  await ran.fill('かえた2');
  await ran.press('Tab');
  await page.waitForTimeout(400);
  const err2 = ((await page.locator('#err').textContent()) || '').trim();
  // eslint-disable-next-line no-console
  console.log('★⑯★ ' + JSON.stringify({ err0, err1, err2 }));
  expect(err0, '★材料で 止めの 警告が 出ない（試験が 空振り）★').toContain('読めない');
  expect(err1).toContain('保存できませんでした');
  expect(err2, '★止めの 警告が 保存の 成功で 消えた★').toContain('読めない');
  expect(h.err).toEqual([]);
});

// ★⑰ 前の 送りが 返らない ⇒ 時間切れで 知らせる（黙らない・対立役 6回目 止A）。打ち直しは 前の 返りを 待つ＝
//   送らずに 知らせを 残す（列を 進めると 前と 次が 同時に 飛び 倉庫だけ 古い 値に なった・7回目 止1〜3）
//   試験では 待つ 長さを 0.8秒に（window.__EMP_MATSU_MS）
test('⑰ 返事が 来ない 送りは 時間切れで 知らせ、打ち直しは 待って 知らせを 残す', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__EMP_MATSU_MS = 800;
  });
  const h = await hiraku(page, {
    name: [
      ['kotaenai', 0],
      ['jibun', 0],
    ],
  });
  const ran = page.locator(h.ran('name'));
  await ran.fill('A1');
  await ran.press('Tab');
  await page.waitForTimeout(1200);
  const r1 = await h.yomu();
  await ran.fill('A2');
  await ran.press('Tab');
  await page.waitForTimeout(600);
  const r2 = await h.yomu();
  // eslint-disable-next-line no-console
  console.log(
    '★⑰★ ' +
      JSON.stringify({
        e1: r1.err,
        n1: r1.okutta.length,
        e2: r2.err,
        n2: r2.okutta.length,
        s2: r2.saved,
      })
  );
  expect(r1.err, '★返事が 来ないのに 黙っている★').toContain('返事が 来ません');
  expect(r2.okutta.length, '★前の 返りを 待たずに 次を 送った（倉庫の 順が 入れ替わる）★').toBe(1);
  expect(r2.err, '★返事が 来ない まま 知らせが 消えた★').toContain('返事が 来ません');
  expect(r2.saved).not.toContain('保存しました');
  expect(h.err).toEqual([]);
});

// ★⑲ 返りが 遅れて 着く（時間切れの 後に 書けた）⇒ 着いてから 次を 送る・倉庫の 順は 打った 順・知らせは 片付く★（7回目 止1・止2）
test('⑲ 遅れて 着いた 返りの 後に 打ち直しを 送る（倉庫も 画面も 最後に 打った 値）', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__EMP_MATSU_MS = 800;
  });
  const h = await hiraku(page, {
    name: [
      ['jibun', 1600],
      ['jibun', 0],
    ],
  });
  const ran = page.locator(h.ran('name'));
  await ran.fill('A');
  await ran.press('Tab');
  await page.waitForTimeout(1000);
  const e1 = ((await page.locator('#err').textContent()) || '').trim();
  await ran.fill('B');
  await ran.press('Tab');
  await page.waitForTimeout(1500);
  const r = await h.yomu();
  r.ran = await ran.inputValue();
  r.okuri = await page.evaluate(() => window.__okutta.map((x) => x.f));
  await h.kakinaosu();
  r.raw = await page.locator(h.ran('name')).inputValue();
  // eslint-disable-next-line no-console
  console.log('★⑲★ ' + JSON.stringify({ e1, err: r.err, ran: r.ran, raw: r.raw, okuri: r.okuri }));
  expect(e1, '★返事が 遅いのに 黙っている★').toContain('返事が 来ません');
  expect(r.okuri).toEqual(['name', 'name']);
  expect(r.ran).toBe('B');
  expect(r.raw, '★計算の 値が 最後に 打った 値で ない★').toBe('B');
  expect(r.err, '★着いて 書けたのに 返事が 来ない 知らせが 残る★').toBe('');
  expect(h.err).toEqual([]);
});

// ★⑳ お金の 欄：遅れて 書けた 歩合は 計算にも 入る★（欄・計算・倉庫が 揃う・7回目 止3）
test('⑳ 遅れて 書けた 歩合は 計算（描き直し）にも 入る', async ({ page }) => {
  await page.addInitScript(() => {
    window.__EMP_MATSU_MS = 800;
  });
  const h = await hiraku(page, { pay_rate: ['jibun', 1600] });
  await hiWoKaeru(page, h.id, '');
  const ran = page.locator(h.ran('pay_rate'));
  await ran.fill('0.61');
  await ran.press('Tab');
  await page.waitForTimeout(2200);
  const r = { ran: await ran.inputValue() };
  await h.kakinaosu();
  await hiWoKaeru(page, h.id, '');
  r.raw = await page.locator(h.ran('pay_rate')).inputValue();
  // eslint-disable-next-line no-console
  console.log('★⑳★ ' + JSON.stringify(r));
  expect(r.ran).toBe('0.61');
  expect(r.raw, '★遅れて 書けた 歩合が 計算に 入って いない★').toBe('0.61');
});

// ★⑱ 他の 操作（歩合の 記録）の 失敗の 訳は 名前の 成功で 消さない★（対立役 6回目 止B）
test('⑱ 記録の 失敗の 訳は 別の 欄（名前）の 成功で 消えない', async ({ page }) => {
  const h = await hiraku(page, {
    name: [
      ['kotowaru', 0],
      ['jibun', 0],
    ],
  });
  const na = page.locator(h.ran('name'));
  await na.fill('B1');
  await na.press('Tab');
  await page.waitForTimeout(400);
  // 今日の 日付の まま 歩合を 打つ ⇒ 記録（dk_hito_rireki）に 書く・作り物は 0行を 返す
  const bu = page.locator(h.ran('pay_rate'));
  await bu.fill('0.77');
  await bu.press('Tab');
  await page.waitForTimeout(600);
  const e2 = ((await page.locator('#err').textContent()) || '').trim();
  await na.fill('B2');
  await na.press('Tab');
  await page.waitForTimeout(600);
  const e3 = ((await page.locator('#err').textContent()) || '').trim();
  // eslint-disable-next-line no-console
  console.log('★⑱★ ' + JSON.stringify({ e2, e3 }));
  expect(e2, '★記録の 失敗が 出ない（試験が 空振り）★').toContain('書けた 行が ありません');
  expect(e3, '★記録の 失敗の 訳が 名前の 成功で 消えた★').toBe(e2);
  expect(h.err).toEqual([]);
});

// ★㉑ 歩合の 送りが 返らない 間は、別の 欄（名前）の 成功でも 止めの 警告は 消えず、明細も 止まる★（対立役 8回目 止1）
test('㉑ 歩合の 返事が 来ない 間は 名前が 書けても 明細を 止めた まま', async ({ page }) => {
  await page.addInitScript(() => {
    window.__EMP_MATSU_MS = 800;
  });
  const h = await hiraku(page, { pay_rate: ['kotaenai', 0], name: ['jibun', 1600] });
  await hiWoKaeru(page, h.id, '');
  const bu = page.locator(h.ran('pay_rate'));
  await bu.fill('0.61');
  await bu.press('Tab');
  const na = page.locator(h.ran('name'));
  await na.fill('かえた');
  await na.press('Tab');
  await page.waitForTimeout(2200);
  const r = await h.yomu();
  await page.click('.tab[data-tab="slip"]');
  await page.waitForTimeout(500);
  const meisai = ((await page.locator('#slips').textContent()) || '').replace(/\s+/g, ' ');
  // eslint-disable-next-line no-console
  console.log(
    '★㉑★ ' + JSON.stringify({ err: r.err, saved: r.saved, meisai: meisai.slice(0, 120) })
  );
  expect(r.err, '★返らない 歩合の 止めが 名前の 成功で 消えた★').toContain('返事が 来ません');
  expect(meisai, '★返事待ちなのに 明細が 出た★').toContain('返事が 来ません');
  expect(h.err).toEqual([]);
});

// ★㉒ 打って すぐ（返りの 前に）明細を 開いても 古い 値で 出さない★（対立役 9回目 止2＝送った 時から 止める）
test('㉒ 歩合を 打って 返りの 前に 明細を 開く ⇒ 止めて 保存中と 出す', async ({ page }) => {
  await page.addInitScript(() => {
    window.__EMP_MATSU_MS = 5000;
  });
  const h = await hiraku(page, { pay_rate: ['jibun', 1500] });
  await hiWoKaeru(page, h.id, '');
  const bu = page.locator(h.ran('pay_rate'));
  // 額が 変わる 大きさ（0.61 では 明細の 額が 動かず 試験が 空振り した）
  await bu.fill('0.99');
  await bu.press('Tab');
  await page.click('.tab[data-tab="slip"]');
  await page.waitForTimeout(300);
  const naka = ((await page.locator('#slips').textContent()) || '').replace(/\s+/g, ' ');
  // 札を 押し直さずに 読む（返りが 着いたら 明細は ひとりでに 描き直る・対立役 10回目 止1）
  await page.waitForTimeout(2100);
  const ato = ((await page.locator('#slips').textContent()) || '').replace(/\s+/g, ' ');
  // eslint-disable-next-line no-console
  console.log('★㉒★ ' + JSON.stringify({ naka: naka.slice(0, 80), ato: ato.slice(0, 80) }));
  expect(naka, '★返りの 前に 明細が 出た（古い 歩合）★').toContain('保存して います');
  expect(ato, '★返りの 後も 止めた まま★').not.toContain('保存して います');
  expect(ato, '★返りの 後も 止めた まま★').not.toContain('止めています');
  // ひとりでに 描き直った 明細は 新しい 歩合の 額（札を 押し直した 明細と 同じ・対立役 11回目 止1）
  await page.click('.tab[data-tab="emp"]');
  await page.click('.tab[data-tab="slip"]');
  await page.waitForTimeout(300);
  const oshinaoshi = ((await page.locator('#slips').textContent()) || '').replace(/\s+/g, ' ');
  expect(ato, '★ひとりでに 描き直った 明細が 古い 額★').toBe(oshinaoshi);
});

// ★㉓ 今日の 日付（記録の 道・既定）で 歩合を 直して 返らない ⇒ 明細を 止める★（対立役 9回目 止1）
test('㉓ 日付付きで 歩合を 直して 記録の 送りが 返らない ⇒ 明細を 止める', async ({ page }) => {
  await page.addInitScript(() => {
    window.__EMP_MATSU_MS = 800;
  });
  const h = await hiraku(page, { __rireki: 'kotaenai' });
  const bu = page.locator(h.ran('pay_rate'));
  await bu.fill('0.61');
  await bu.press('Tab');
  await page.waitForTimeout(1200);
  const r = await h.yomu();
  await page.click('.tab[data-tab="slip"]');
  await page.waitForTimeout(300);
  const meisai = ((await page.locator('#slips').textContent()) || '').replace(/\s+/g, ' ');
  // eslint-disable-next-line no-console
  console.log(
    '★㉓★ ' +
      JSON.stringify({ okuri: r.okutta.map((x) => x.f), err: r.err, meisai: meisai.slice(0, 80) })
  );
  expect(
    r.okutta.map((x) => x.f),
    '★記録の 道を 通って いない（試験が 空振り）★'
  ).toEqual(['rireki']);
  expect(r.err).toContain('返事が 来ません');
  expect(meisai, '★記録の 返事待ちなのに 明細が 出た★').toContain('返事が 来ません');
});

// ★㉔ 名前の 保存が 飛んで いる 間に 記録（今日の 日付の 歩合）が 0行 ⇒ 失敗の 訳は 名前の 成功の 後も 残る★（対立役 10回目 止2）
test('㉔ 名前の 保存中に 記録が 失敗 ⇒ 訳は 消えない', async ({ page }) => {
  const h = await hiraku(page, { name: ['jibun', 1500] });
  const na = page.locator(h.ran('name'));
  await na.fill('かえた');
  await na.press('Tab');
  const bu = page.locator(h.ran('pay_rate'));
  await bu.fill('0.77');
  await bu.press('Tab');
  await page.waitForTimeout(400);
  const e1 = ((await page.locator('#err').textContent()) || '').trim();
  await page.waitForTimeout(2400);
  const e2 = ((await page.locator('#err').textContent()) || '').trim();
  // eslint-disable-next-line no-console
  console.log('★㉔★ ' + JSON.stringify({ e1, e2 }));
  expect(e1, '★記録の 失敗の 訳が 保存中の 字に 隠れた★').toContain('書けた 行が ありません');
  expect(e2, '★記録の 失敗の 訳が 名前の 成功で 消えた★').toContain('書けた 行が ありません');
});

// ★㉕ 保存中に「明細を PDFで 見る」を 押す ⇒ 止めて 知らせ、返りの 後は その 字を 残さない★（対立役 11回目 止2）
test('㉕ 保存中に PDF を 押しても 返りの 後に 保存中の 字が 残らない', async ({ page }) => {
  await page.addInitScript(() => {
    window.__EMP_MATSU_MS = 5000;
  });
  const h = await hiraku(page, { pay_rate: ['jibun', 1200] });
  await hiWoKaeru(page, h.id, '');
  const bu = page.locator(h.ran('pay_rate'));
  await bu.fill('0.61');
  await bu.press('Tab');
  await page.click('.tab[data-tab="slip"]');
  await page.click('#btnPrint');
  await page.waitForTimeout(200);
  const e1 = ((await page.locator('#err').textContent()) || '').trim();
  await page.waitForTimeout(1800);
  const e2 = ((await page.locator('#err').textContent()) || '').trim();
  // eslint-disable-next-line no-console
  console.log('★㉕★ ' + JSON.stringify({ e1, e2 }));
  expect(e1, '★保存中に PDF が 止まらない★').toContain('保存して います');
  expect(e2, '★保存が 終わった のに 保存中の 字が 残る★').not.toContain('保存して います');
  expect(h.err).toEqual([]);
});

// ★㉖ 返事待ちの 間に 別の 欄が 断られた 訳は、遅れた 返りの 後も 残る★（対立役 12回目 止1）
test('㉖ 返事待ちの 間に 名前が 断られた 訳は 遅れた 返りで 消えない', async ({ page }) => {
  await page.addInitScript(() => {
    window.__EMP_MATSU_MS = 300;
  });
  const h = await hiraku(page, { pay_rate: ['jibun', 1500], name: ['kotowaru', 0] });
  await hiWoKaeru(page, h.id, '');
  const bu = page.locator(h.ran('pay_rate'));
  await bu.fill('0.61');
  await bu.press('Tab');
  await page.waitForTimeout(500);
  const e0 = ((await page.locator('#err').textContent()) || '').trim();
  const na = page.locator(h.ran('name'));
  await na.fill('かえた');
  await na.press('Tab');
  await page.waitForTimeout(300);
  const e1 = ((await page.locator('#err').textContent()) || '').trim();
  await page.waitForTimeout(1200);
  const e2 = ((await page.locator('#err').textContent()) || '').trim();
  // eslint-disable-next-line no-console
  console.log('★㉖★ ' + JSON.stringify({ e0, e1, e2 }));
  expect(e0, '★返事待ちが 出ない（試験が 空振り）★').toContain('返事が 来ません');
  expect(e1).toContain('書き込めません');
  expect(e2, '★断られた 訳が 遅れた 返りで 消えた★').toContain('書き込めません');
  expect(h.err).toEqual([]);
});

// ★㉗ 売上の 直しが 読めない 時に 返事待ちが 挟まっても、返りの 後に 警告が 赤い 字に 戻る★（対立役 12回目 中1）
test('㉗ 返事待ちが 片付いた 後に 売上が 読めない 警告が 戻る', async ({ page }) => {
  await page.addInitScript(() => {
    window.__EMP_MATSU_MS = 300;
  });
  const h = await hiraku(page, { pay_rate: ['jibun', 1500] }, (f) => {
    f.edits = (f.edits || []).concat([{ shift_id: f.shifts[0].shift_id, uriage_yen: 'よめない' }]);
    return f;
  });
  await hiWoKaeru(page, h.id, '');
  const bu = page.locator(h.ran('pay_rate'));
  await bu.fill('0.61');
  await bu.press('Tab');
  // 他の 操作が 赤い 字を 消した 形（時間切れの 時に 赤い 字が 空＝返事待ちの 字が 出る）
  await page.evaluate(() => {
    const e = document.getElementById('err');
    e.textContent = '';
    e.style.display = 'none';
  });
  await page.waitForTimeout(500);
  const e1 = ((await page.locator('#err').textContent()) || '').trim();
  await page.waitForTimeout(1700);
  const e2 = ((await page.locator('#err').textContent()) || '').trim();
  // eslint-disable-next-line no-console
  console.log('★㉗★ ' + JSON.stringify({ e1, e2 }));
  expect(e1, '★返事待ちの 字が 出ない（試験が 空振り）★').toContain('返事が 来ません');
  expect(e2, '★売上が 読めない 警告が 赤い 字から 消えた★').toContain('読めない');
  expect(h.err).toEqual([]);
});

// ★㉘ 記録（日付付き）が 書けても、読み直して 計算に 入るまで 明細は 止めた まま★（対立役 13回目 中1・9回目 止1 を 守る 網）
//   読み直し（softList dk_hito_rireki）を harness の F.__osoi で 3秒 遅らせる
test('㉘ 記録が 書けた 後も 読み直しが 終わるまで 明細を 止める', async ({ page }) => {
  const h = await hiraku(page, { __rireki: 'jibun' }, (f) => {
    f.__osoi = ['dk_hito_rireki'];
    return f;
  });
  const bu = page.locator(h.ran('pay_rate'));
  await bu.fill('0.61');
  await bu.press('Tab');
  await page.click('.tab[data-tab="slip"]');
  await page.waitForTimeout(1000);
  const naka = ((await page.locator('#slips').textContent()) || '').replace(/\s+/g, ' ');
  await page.waitForTimeout(3000);
  const ato = ((await page.locator('#slips').textContent()) || '').replace(/\s+/g, ' ');
  // eslint-disable-next-line no-console
  console.log(
    '★㉘★ ' +
      JSON.stringify({
        okuri: h && (await page.evaluate(() => window.__okutta.map((x) => x.f))),
        naka: naka.slice(0, 60),
        ato: ato.slice(0, 60),
      })
  );
  expect(naka, '★記録の 読み直しの 前に 明細が 出た（古い 歩合）★').toContain('保存して います');
  expect(ato, '★読み直しの 後も 止めた まま★').not.toContain('止めています');
});
