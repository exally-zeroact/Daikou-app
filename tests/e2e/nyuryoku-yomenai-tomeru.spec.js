// ============================================================
// ★★見張り：入力の 画面＝実費などの 記録が 読めなかった 時は 打たせない（前の 額を 0 で 上書きしない）★★ 2026-10-21
//   ★前★ 実費（dk_shift_edits）の 読みが 失敗しても 欄は 全部 押せた。電子決済に 500 と 打つと
//         {"toll_yen":0,"bridge_yen":0,"other_yen":0,"denshi_yen":500,...} が 送られ、倉庫の 高速代 1000 が 0 で 上書き＝売上が 1000 増える
//         （分からない 時に 通す 側に 倒れた・対立役が 測った）
//         日を 変えた 先で 業務の 読みが 失敗した 時・読みが 返る 前も、前の 日の 欄が 押せ、前の 日の 額を 今の 日へ 送った（対立役 止1・止2）
//   ★今★ 保存が 頼る 読み（実費・手で 入れた 日）の どちらかが 失敗したら 欄を 全部 押せなく し、訳を 車の 上に 出す。保存の 口も 断る
//         読んでいる 間と、業務の 読みが 失敗した 時も 押せない。古い 返事は 捨てる
//         実費の 名前・電子決済の 日は 送る 中身に 効かない＝読めなくても 打てる（前の 額は そのまま 送る）
//   ★★わざと壊して 赤に なるのを 見た（2026-10-21 実測）★★ 13本
//     直す 前の nyuryoku.html 6本 赤／前の 直し（21547ea）7本 赤
//     保存の 口の 門を 1つずつ 外す … saveJippi 1本・saveTebiki 3本・saveUriage 1本 赤
//     古い 読みの 返事を 捨てる 所を 外す 1本・手で 入れた 日の 保存の 返事を 別の 日に 入れない 所を 外す 1本 赤
//     読み込みが #err（保存の 失敗）を 消す 形に 戻す 1本（止A）・保存の 返事を 捨てる 形に 戻す 1本（止B）赤
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const LABELS = [{ company_id: 'c1', device_id: 'd1', label: '1466', sort_order: 1 }];
// 9/02＝走った 日（実費 高速 1000）／9/03・9/04＝走っていない 日（手で 入れた 1日ぶん）
const SH = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-09-02T10:00:00+09:00',
    ended_at: '2026-09-02T18:00:00Z',
    fare_total_yen: 28700,
    trip_count: 9,
  },
];
const ED = [{ shift_id: 's1', company_id: 'c1', toll_yen: 1000, bridge_yen: 0, other_yen: 0 }];
const MD = [
  { company_id: 'c1', work_date: '2026-09-03', device_id: 'd1', sales_yen: 5000, toll_yen: 1000 },
  { company_id: 'c1', work_date: '2026-09-04', device_id: 'd1', sales_yen: 9000, toll_yen: 7000 },
];

// 偽の 倉庫（窓の 中で 動く 字）。日付は 頼みの 字から 拾う
function stub(yomenai) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: 'c1', name: 'ZERO代行' };
  const nakami = function (co, L, SH, ED, MD, yomenai) {
    window.__calls = [];
    window.__yomenai = yomenai;
    window.__shiftsDame = false;
    window.__osoi = 0;
    window.__osoiHi = {}; // 日ごとの 読みの 遅れ（古い 読みが 後から 返る 形）
    window.__osoiHozon = 0; // 保存の 返事の 遅れ
    window.__hozonDame = false; // 保存を 断る
    const S = window.DKSession;
    // 車の 台数を 増やす（車の 多い 日＝下の 車で 打つ 形・対立役 8回目）
    if (window.__manyCars) {
      L = [];
      for (let n = 1; n <= window.__manyCars; n++)
        L.push({ company_id: 'c1', device_id: 'd' + n, label: 'C' + n, sort_order: n });
    }
    // 頼みの 字から「k.値」の 値を 拾う（& まで・URL の 字を 戻す）
    const atai = (p, k) => {
      const s = String(p);
      const i = s.indexOf(k + '.');
      if (i < 0) return '';
      const j = s.indexOf('&', i);
      return decodeURIComponent(s.slice(i + k.length + 1, j < 0 ? s.length : j));
    };
    const hiOf = (p, k) => atai(p, k).slice(0, 10);
    const rows = (p) => {
      if (p.indexOf('dk_shifts') === 0) {
        const kara = Date.parse(atai(p, 'started_at=gte'));
        const made = Date.parse(atai(p, 'started_at=lt'));
        return SH.filter((x) => {
          const t = Date.parse(x.started_at);
          return (isNaN(kara) || t >= kara) && (isNaN(made) || t < made);
        });
      }
      if (p.indexOf('dk_device_labels') === 0) return L;
      if (p.indexOf('dk_shift_edits') === 0) return ED;
      if (p.indexOf('dk_manual_days') === 0) {
        const w = hiOf(p, 'work_date=eq');
        return MD.filter((x) => x.work_date === w);
      }
      return [];
    };
    const hiNo = (p) => {
      const w = hiOf(p, 'work_date=eq');
      if (w) return w;
      const g = atai(p, 'started_at=gte');
      if (!g) return '';
      // 日本の 日（始めの 時刻 ＋9時間 の 日付）
      return new Date(Date.parse(g) + 9 * 3600000).toISOString().slice(0, 10);
    };
    const osoku = (v, p) => {
      const ms = (window.__osoiHi && window.__osoiHi[hiNo(p || '')]) || window.__osoi;
      return ms ? new Promise((ok) => setTimeout(() => ok(v), ms)) : Promise.resolve(v);
    };
    const kotae = (ok, st, v) => ({
      ok: ok,
      status: st,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve(v),
    });
    S.ensure = () => Promise.resolve({ access_token: 't' });
    S.goLogin = () => {};
    S.logout = () => {};
    S.rememberedCompanyId = () => co.company_id;
    S.pickCompany = () => ({ mode: 'one', company: co });
    S.myCompanies = () => Promise.resolve(kotae(true, 200, [co]));
    S.rest = (s, p, o) => {
      const m = (o && o.method) || 'GET';
      if (m !== 'GET') {
        const b = o && o.body ? JSON.parse(o.body) : null;
        window.__calls.push({ p: p, m: m, b: b });
        // 断らない 時は 偽の 倉庫に しまう（読み直すと しまった 額が 返る＝本物の 倉庫と 同じ）
        //   しまうのは 返事を 返す 時（本物も 着くまで 倉庫に 無い＝その 前に 始めた 読みは 前の 額を 返す）
        const dame = window.__hozonDame;
        const shimau = () => {
          if (dame || !b) return;
          if (String(p).indexOf('dk_shift_edits') === 0) {
            const i = ED.findIndex((x) => x.shift_id === b.shift_id);
            if (i < 0) ED.push(b);
            else ED[i] = Object.assign({}, ED[i], b);
          }
          if (String(p).indexOf('dk_manual_days') === 0) {
            const i = MD.findIndex(
              (x) => x.work_date === b.work_date && x.device_id === b.device_id
            );
            if (i < 0) MD.push(b);
            else MD[i] = Object.assign({}, MD[i], b);
          }
        };
        const k = dame ? kotae(false, window.__hozonDameNo || 503, []) : kotae(true, 200, [b]);
        return window.__osoiHozon
          ? new Promise((ok) =>
              setTimeout(() => {
                shimau();
                ok(k);
              }, window.__osoiHozon)
            )
          : (shimau(), Promise.resolve(k));
      }
      if (String(p).indexOf('dk_shifts') === 0 && window.__shiftsDame)
        return osoku(kotae(false, 503, []), p);
      return osoku(kotae(true, 200, JSON.parse(JSON.stringify(rows(p)))), p); // 頼んだ 時の 写し
    };
    S.softList = (s, p, st) => {
      if (st) st.tried++;
      if (window.__yomenai.some((n) => String(p).indexOf(n) === 0)) {
        if (st) st.failed++;
        return Promise.resolve([]);
      }
      return osoku(JSON.parse(JSON.stringify(rows(p))), p); // 頼んだ 時の 写し
    };
  };
  return (
    moto +
    ';(' +
    nakami.toString() +
    ')(' +
    [co, LABELS, SH, ED, MD, yomenai].map((x) => JSON.stringify(x)).join(',') +
    ');'
  );
}

async function hiraku(page, yomenai, hi) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: stub(yomenai),
    })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/nyuryoku.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await hiErabu(page, hi);
}
async function hiErabu(page, hi) {
  await page.fill('#hiSel', hi);
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(1200);
}
const oseruKazu = (page) =>
  page.evaluate(
    () => Array.from(document.querySelectorAll('#shaList input')).filter((i) => !i.disabled).length
  );
// 欄を 押せなくても 字を 入れて change を 起こす（押せない 欄の 保存の 口が 断るかも 見る）
async function utsuMuri(page, sel, v) {
  await page.evaluate(
    (a) => {
      const i = document.querySelector(a.sel);
      i.value = a.v;
      i.dispatchEvent(new Event('change'));
    },
    { sel, v }
  );
  await page.waitForTimeout(500);
}
const okuttaKazu = (page) => page.evaluate(() => window.__calls.length);

// ★保存が 頼る 読みが 読めない★＝押せない・送らない・訳が 見える
for (const [na, yomenai, hi, sel] of [
  ['実費（走った 日の 実費の 欄）', ['dk_shift_edits'], '2026-09-02', '#shaList [data-sid]'],
  ['実費（走った 日の 売上の 直し）', ['dk_shift_edits'], '2026-09-02', '#shaList [data-uri-sid]'],
  [
    '手で 入れた 日（走っていない 日の 欄）',
    ['dk_manual_days'],
    '2026-09-03',
    '#shaList [data-dev]',
  ],
]) {
  test(`★${na}が 読めない 時は 欄を 押せない・送らない・訳を 出す★`, async ({ page }) => {
    await hiraku(page, yomenai, hi);
    expect(await page.locator(sel).count(), '★欄が 無い＝この 形を 測っていない★').toBeGreaterThan(
      0
    );
    expect(await oseruKazu(page), '★読めないのに 押せる 欄が 在る★').toBe(0);
    await expect(page.locator('#tomeJi'), '★打てない 訳が 車の 上に 見えない★').toBeVisible();
    await expect(page.locator('#tomeJi')).toContainText('読めません');
    await utsuMuri(page, sel, '500');
    expect(await okuttaKazu(page), '★読めないのに 倉庫へ 送った（前の 額を 上書きする）★').toBe(0);
  });
}

// ★送る 中身に 効かない 読み（実費の 名前・電子決済の 日）は 読めなくても 打てる・前の 額は そのまま 送る★（対立役 直2）
for (const [na, yomenai] of [
  ['実費の 名前', ['dk_expense_kinds']],
  ['電子決済の 日', ['dk_day_extras']],
]) {
  test(`★${na}が 読めなくても 打てて、高速代は 前の 額の まま 送る★`, async ({ page }) => {
    await hiraku(page, yomenai, '2026-09-02');
    const den = '#shaList [data-sid][data-f="denshi_yen"]';
    expect(await page.locator(den).count(), '★電子決済の 欄が 無い＝この 形を 測っていない★').toBe(
      1
    );
    await utsuMuri(page, den, '500');
    const c = await page.evaluate(() => window.__calls);
    expect(c.length, '★打てるのに 送らない★').toBeGreaterThan(0);
    expect(c[c.length - 1].b.toll_yen, '★前の 高速代 1000 を 0 で 上書きした★').toBe(1000);
  });
}

// ★日を 変えた 先で 業務の 読みが 失敗＝前の 日の 欄を 押せる まま 残さない★（対立役 止1）
test('★日を 変えて 業務が 読めない 時は 前の 日の 欄を 押せない・送らない★', async ({ page }) => {
  await hiraku(page, [], '2026-09-03');
  expect(
    await oseruKazu(page),
    '★前の 日（9/03）に 押せる 欄が 無い＝この 形を 測っていない★'
  ).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.__shiftsDame = true;
  });
  await hiErabu(page, '2026-09-04');
  expect(await oseruKazu(page), '★業務が 読めないのに 前の 日の 欄が 押せる★').toBe(0);
  await utsuMuri(page, '#shaList [data-dev]', '500');
  expect(await okuttaKazu(page), '★前の 日の 額を 9/04 に 送った★').toBe(0);
});

// ★日を 変えた 直後（読みが 返る 前）も 押せない★（対立役 止2）
test('★日を 変えた 直後の 読み込み中は 前の 日の 欄を 押せない・送らない★', async ({ page }) => {
  await hiraku(page, [], '2026-09-03');
  expect(await oseruKazu(page)).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.__osoi = 3000;
  });
  await page.fill('#hiSel', '2026-09-04');
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(300);
  expect(await oseruKazu(page), '★読み込み中に 前の 日の 欄が 押せる★').toBe(0);
  await utsuMuri(page, '#shaList [data-dev]', '500');
  expect(await okuttaKazu(page), '★読み込み中に 前の 日の 額を 9/04 に 送った★').toBe(0);
  // 読み終わったら 9/04 の 欄で 打てる
  await page.waitForTimeout(4000);
  expect(await oseruKazu(page), '★読み終わったのに 押せない★').toBeGreaterThan(0);
});

test('★読めない 時の 後で もう一度 読んで 読めたら 打てる（いつまでも 止めない）★', async ({
  page,
}) => {
  await hiraku(page, ['dk_shift_edits'], '2026-09-02');
  expect(await oseruKazu(page)).toBe(0);
  await page.evaluate(() => {
    window.__yomenai = [];
  });
  await hiErabu(page, '2026-09-02');
  expect(await oseruKazu(page), '★読めたのに 欄が 押せない まま★').toBeGreaterThan(0);
  await expect(page.locator('#tomeJi')).toHaveCount(0);
});

test('★読めた 時は 今まで 通り 打てて、高速代は 前の 額の まま 送る★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  const den = '#shaList [data-sid][data-f="denshi_yen"]';
  expect(await page.locator(den).count()).toBe(1);
  await utsuMuri(page, den, '500');
  const c = await page.evaluate(() => window.__calls);
  expect(c.length, '★読めたのに 送らない★').toBeGreaterThan(0);
  expect(c[c.length - 1].b.toll_yen, '★前の 高速代 1000 を 0 で 上書きした★').toBe(1000);
});

// ★保存の 失敗は 日を 送って 読み直しても 消えない★（読み込みが #err を 消して 保存の 失敗を 黙らせた・対立役 止A）
test('★保存に 失敗した 後で 日を 送っても「保存できませんでした」が 残る★', async ({ page }) => {
  await hiraku(page, [], '2026-09-03');
  const toll = '#shaList [data-dev][data-f="toll"]';
  expect(await page.locator(toll).count(), '★高速代の 欄が 無い＝この 形を 測っていない★').toBe(1);
  await page.evaluate(() => {
    window.__hozonDame = true;
  });
  await utsuMuri(page, toll, '2500');
  await expect(page.locator('#err')).toContainText('保存できませんでした');
  await hiErabu(page, '2026-09-04');
  await expect(page.locator('#err'), '★保存の 失敗が 読み込みで 消えた★').toContainText(
    '保存できませんでした'
  );
});

// ★同じ 日の 読み直しと 保存の 返事が 重なっても、打った 額が 前の 額に 戻らない★（対立役 止B）
test('★同じ 日を 読み直した 後に 保存が 返っても、次の 1打で 打った 額を 送る★', async ({
  page,
}) => {
  await hiraku(page, [], '2026-09-02');
  const toll = '#shaList [data-sid][data-f="toll"]';
  expect(await page.locator(toll).count(), '★高速代の 欄が 無い＝この 形を 測っていない★').toBe(1);
  await page.evaluate(() => {
    window.__osoiHozon = 1500;
  });
  await utsuMuri(page, toll, '2000');
  // 保存が 返る 前に 同じ 日を 読み直す（読みは すぐ 返る＝倉庫は まだ 前の 1000）
  await hiErabu(page, '2026-09-02');
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.__osoiHozon = 0;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="denshi_yen"]', '500');
  const c = await page.evaluate(() => window.__calls);
  expect(c[c.length - 1].b.toll_yen, '★打った 高速代 2000 が 前の 1000 に 戻った★').toBe(2000);
});

// ★古い 日の 読みが 後から 返っても、今の 日の 画面・送る 額に 入れない★（対立役 直す-1）
test('★前の 日の 読みが 遅れて 返っても 今の 日の 額で 送る★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__osoiHi = { '2026-09-03': 2500 };
  });
  await page.fill('#hiSel', '2026-09-03');
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(200);
  await hiErabu(page, '2026-09-04');
  await page.waitForTimeout(2500); // 9/03 の 読みが 後から 返る
  await utsuMuri(page, '#shaList [data-dev][data-f="denshi_yen"]', '300');
  const c = await page.evaluate(() => window.__calls);
  expect(c.length, '★9/04 で 打てない★').toBeGreaterThan(0);
  const b = c[c.length - 1].b;
  expect([b.work_date, b.sales_yen, b.toll_yen], '★前の 日（9/03）の 額を 9/04 に 送った★').toEqual(
    ['2026-09-04', 9000, 7000]
  );
});

// ★前の 日の 保存の 返事が 日を 送った 後に 返っても、今の 日の 表に 入れない★（対立役 直す-1）
test('★前の 日の 保存が 遅れて 返っても 今の 日の 額で 送る★', async ({ page }) => {
  await hiraku(page, [], '2026-09-03');
  await page.evaluate(() => {
    window.__osoiHozon = 1500;
  });
  await utsuMuri(page, '#shaList [data-dev][data-f="toll"]', '2500');
  await hiErabu(page, '2026-09-04');
  await page.waitForTimeout(1500); // 9/03 の 保存の 返事が 9/04 を 開いた 後に 返る
  await page.evaluate(() => {
    window.__osoiHozon = 0;
  });
  await utsuMuri(page, '#shaList [data-dev][data-f="denshi_yen"]', '300');
  const c = await page.evaluate(() => window.__calls);
  const b = c[c.length - 1].b;
  expect([b.work_date, b.sales_yen, b.toll_yen], '★前の 日（9/03）の 額を 9/04 に 送った★').toEqual(
    ['2026-09-04', 9000, 7000]
  );
});

// ★★同じ 行の 保存は 1本ずつ 順に（対立役 3回目 直す-1・直す-2・直す-3・直す-4）★★ 2026-10-21

// 直す-2：続けて 2つの 欄を 打つと 2つ目が 1つ目の 返事 前の 記録で 作られ、1つ目の 額を 前に 戻した
test('★続けて 2つの 欄を 打っても、2つ目は 1つ目の 額を 前に 戻さない★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__osoiHozon = 1000;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  await utsuMuri(page, '#shaList [data-sid][data-f="denshi_yen"]', '300');
  await page.waitForTimeout(2500);
  const c = await page.evaluate(() => window.__calls);
  expect(c.length, '★2回 送っていない★').toBe(2);
  expect([c[1].b.toll_yen, c[1].b.denshi_yen], '★2つ目が 高速代を 前の 1000 に 戻した★').toEqual([
    2000, 300,
  ]);
});

// 直す-1：保存の 返事待ちの 間に 同じ 日を 読み直すと、保存 前の 写しで 読んだ 返事が 打った 額を 消した
test('★保存の 返事待ちの 間に 読み直しても、打った 額が 消えない★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__osoiHozon = 1500; // 保存の 返事は 読み直しを 始めた 後に 返る（utsuMuri が 0.5秒 待つ）
    window.__osoi = 2500; // 読みは 保存より 遅く 返る＝保存 前の 写しが 後から 返る
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  await page.fill('#hiSel', '2026-09-02');
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(5500);
  await page.evaluate(() => {
    window.__osoi = 0;
    window.__osoiHozon = 0;
  });
  await expect(
    page.locator('#shaList [data-sid][data-f="toll"]'),
    '★画面の 高速代が 前の 1000 に 戻った★'
  ).toHaveValue('2000');
  await utsuMuri(page, '#shaList [data-sid][data-f="denshi_yen"]', '500');
  const c = await page.evaluate(() => window.__calls);
  expect(c[c.length - 1].b.toll_yen, '★打った 高速代 2000 が 前の 1000 に 戻った★').toBe(2000);
});

// 直す-3：保存の 失敗の 字が 別の 欄の 保存の 成功で 消えた（欄には 打った 額・倉庫は 前の 額＝客に 黙る）
test('★保存の 失敗の 字は 別の 欄の 成功で 消えない★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__hozonDame = true;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  await expect(page.locator('#err')).toContainText('保存できませんでした');
  await page.evaluate(() => {
    window.__hozonDame = false;
  });
  // 別の 業務（車）の 欄は 無い＝同じ 業務の 別の 鍵（売上の 直し は 同じ 業務）でなく、同じ 業務の 別の 欄で 見る
  await utsuMuri(page, '#shaList [data-uri-sid]', '30000');
  await expect(page.locator('#err'), '★別の 欄の 成功で 保存の 失敗が 消えた★').toContainText(
    '保存できませんでした'
  );
});

// 直す-4：前の 月の「走った 日へ」を 探す 返事が 遅れて 返り、別の 月の 画面に 出た
test('★前の 月の「走った 日へ」の 返事が 遅れて 返っても 別の 月に 出さない★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__osoiHi = { '2026-09-01': 2500 }; // 9月の 月の 探しだけ 遅らせる
  });
  await page.fill('#hiSel', '2026-09-03');
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(300);
  await hiErabu(page, '2026-10-05');
  await page.waitForTimeout(2500);
  await expect(
    page.locator('#hashittaHi'),
    '★10月の 画面に 9月の「走った 日へ」が 出た★'
  ).toBeHidden();
});

// ★★返事が 来ない 保存・2つの 失敗・打ち方の 間違い・読み込み待ちの 売上の 欄・手で 入れた 日の 順番★★ 2026-10-21（対立役 4回目）
const errJi = (page) =>
  page.evaluate(() => {
    const e = document.getElementById('err');
    return e.style.display === 'none' ? '' : e.textContent;
  });
const tomeJi = (page) =>
  page.evaluate(() => {
    const e = document.getElementById('tomeJi');
    return e ? e.textContent : '';
  });

// 直す-B（4回目）：返事の 来ない 保存 1本で 何も 言わずに「読み込み中」の まま 固まった
// 止め-1・止め-2（5回目）：時間切れで 順番と 読み直しを 開けると、遅れて 返事が 来た 時に 打った 額が 戻る・消えた
//   ⇒ 時間切れは 字を 出すだけ。順番と 読み直しは 本物の 返事まで 待つ。字は その 送りが 返った 時に 消える
test('★返事が 来ない 保存は 時間切れで 字を 出し、返事が 来るまで 読み直さない・来たら 戻る★', async ({
  page,
}) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__DK_HOZON_MATSU_MS = 1000; // 本物は 20秒
    window.__osoiHozon = 4000;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  await page.evaluate(() => {
    window.__osoiHozon = 0;
  });
  await hiErabu(page, '2026-09-03');
  await page.waitForTimeout(1000); // 時間切れ 済み・返事は まだ
  // 読み込み中は 上の 止めの 字が 時間切れの 訳を 出す（貼り付いた 箱には 重ねない・9回目 直す-1）
  expect(await tomeJi(page), '★倉庫に 入ったか 分からない 事を 客に 黙った★').toContain(
    '返事が 来ません'
  );
  expect(await errJi(page), '★同じ 訳が 2か所に 出た★').not.toContain('返事が 来ません');
  expect(await oseruKazu(page), '★返事の 前に 読み直して 打たせた★').toBe(0);
  await page.waitForTimeout(3500); // 返事が 来て 読み直す
  expect(await oseruKazu(page), '★返事が 来ても 打てない まま★').toBeGreaterThan(0);
  expect(await errJi(page), '★返事が 来たのに 時間切れの 字が 残る★').toBe('');
});

// 直す-A：失敗した 欄を 1つしか 覚えず、2つ 失敗して 後の 1つが 直ると 前の 失敗の 字が 消えた
test('★2つの 欄が 失敗し 後の 1つだけ 直っても 前の 失敗の 字は 消えない★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__hozonDame = true;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  await utsuMuri(page, '#shaList [data-sid][data-f="denshi_yen"]', '300');
  await page.evaluate(() => {
    window.__hozonDame = false;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="denshi_yen"]', '300');
  expect(await errJi(page), '★高速代 2000 は 倉庫に 無い のに 字が 消えた★').toContain(
    '保存できませんでした'
  );
  // 高速代も 直れば 消える（いつまでも 残さない）
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  expect(await errJi(page), '★全部 直ったのに 字が 残る★').toBe('');
});

// 直す-C：売上の 打ち方の 間違いの 字が、正しく 打ち直して 保存できても 残った
test('★売上の 打ち方の 間違いの 字は 正しく 打ち直して 保存できたら 消える★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  await utsuMuri(page, '#shaList [data-uri-sid]', '-5');
  expect(await errJi(page)).toContain('0以上の 整数');
  await utsuMuri(page, '#shaList [data-uri-sid]', '30000');
  expect(await errJi(page), '★保存できたのに 間違いの 字が 残る★').toBe('');
});

// 直す-C：2台の 日に 読み込み待ちの 間、売上の 返事で 売上の 欄だけ 押せる に 戻り「読めません」と 違う 字が 出た
test('★読み込み待ちの 間は 売上の 返事が 来ても 売上の 欄を 押せない・字は「読み込み中」★', async ({
  page,
}) => {
  SH.push({
    shift_id: 's2',
    device_id: 'd2',
    started_at: '2026-09-02T11:00:00+09:00',
    ended_at: '2026-09-02T18:00:00Z',
    fare_total_yen: 10000,
    trip_count: 3,
  });
  LABELS.push({ company_id: 'c1', device_id: 'd2', label: '2000', sort_order: 2 });
  try {
    await hiraku(page, [], '2026-09-02');
    await page.evaluate(() => {
      window.__osoiHozon = 4000;
    });
    await utsuMuri(page, '#shaList [data-sid="s2"][data-f="toll"]', '700');
    await page.evaluate(() => {
      window.__osoiHozon = 600;
    });
    await utsuMuri(page, '#shaList [data-uri-sid="s1"]', '30000');
    await page.fill('#hiSel', '2026-09-02');
    await page.dispatchEvent('#hiSel', 'change');
    await page.waitForTimeout(600);
    expect(await oseruKazu(page), '★読み込み中なのに 押せる 欄が 在る★').toBe(0);
    expect(await tomeJi(page)).toContain('読み込み中です');
    expect(await tomeJi(page), '★読み込み中に「読めません」と 違う 字★').not.toContain(
      '読めません'
    );
  } finally {
    SH.pop();
    LABELS.pop();
  }
});

// 見立て（4回目）：手で 入れた 日の「順に 送る」に 効く 試験が 0本だった（22ff487 では 2つ目が 高速代を 2500→1000 に 戻した）
test('★手で 入れた 日：続けて 2つ 打っても 2つ目は 1つ目の 額を 戻さない・日を 送っても 混ざらない★', async ({
  page,
}) => {
  await hiraku(page, [], '2026-09-03');
  await page.evaluate(() => {
    window.__osoiHozon = 1000;
  });
  await utsuMuri(page, '#shaList [data-dev][data-f="toll"]', '2500');
  await utsuMuri(page, '#shaList [data-dev][data-f="denshi_yen"]', '300');
  await page.fill('#hiSel', '2026-09-04');
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(2500);
  expect(await page.inputValue('#shaList [data-dev][data-f="toll"]'), '★9/04 に 9/03 の 額★').toBe(
    '7000'
  );
  const c = await page.evaluate(() =>
    window.__calls.map((x) => [x.b.work_date, x.b.sales_yen, x.b.toll_yen, x.b.denshi_yen])
  );
  expect(c[1], '★2つ目が 高速代を 前の 額に 戻した★').toEqual(['2026-09-03', 5000, 2500, 300]);
});

// ★★時間切れの 後に 遅れて 返事が 来ても 打った 額を 戻さない・消さない★★ 2026-10-21（対立役 5回目 止め-1・止め-2）
const tollVal = (page) => page.inputValue('#shaList [data-sid][data-f="toll"]');
const denVal = (page) => page.inputValue('#shaList [data-sid][data-f="denshi_yen"]');

test('★時間切れの 後に 同じ 業務の 次を 打っても 1つ目の 額を 戻さない（返事を 待って 作る）★', async ({
  page,
}) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__DK_HOZON_MATSU_MS = 1000;
    window.__osoiHozon = 4000;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  await page.waitForTimeout(1000);
  expect(await errJi(page)).toContain('返事が 来ません');
  await page.evaluate(() => {
    window.__osoiHozon = 0;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="denshi_yen"]', '300');
  await page.waitForTimeout(4000);
  const c = await page.evaluate(() => window.__calls.map((x) => [x.b.toll_yen, x.b.denshi_yen]));
  expect(c[1], '★2つ目が 高速代を 1000 に 戻して 送った★').toEqual([2000, 300]);
  await hiErabu(page, '2026-09-03');
  await hiErabu(page, '2026-09-02');
  expect(
    { toll: await tollVal(page), den: await denVal(page) },
    '★倉庫の 額が 打った 額と 違う★'
  ).toEqual({
    toll: '2000',
    den: '300',
  });
});

test('★時間切れの 後も 返事の 前に 読み直さない（保存 前の 写しで 打った 額を 消さない）★', async ({
  page,
}) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__DK_HOZON_MATSU_MS = 1000;
    window.__osoiHozon = 2500;
    window.__osoi = 3000;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  await page.fill('#hiSel', '2026-09-02');
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(6500);
  await page.evaluate(() => {
    window.__osoi = 0;
    window.__osoiHozon = 0;
  });
  expect(await tollVal(page), '★画面の 高速代が 前の 1000 に 戻った★').toBe('2000');
  await utsuMuri(page, '#shaList [data-sid][data-f="denshi_yen"]', '500');
  const c = await page.evaluate(() => window.__calls.map((x) => [x.b.toll_yen, x.b.denshi_yen]));
  expect(c[c.length - 1][0], '★次の 1打で 高速代 2000 を 1000 に 戻した★').toBe(2000);
});

test('★手で 入れた 日：時間切れの 後 次の 保存も 1つ目の 額を 戻さない・日を 変えて 書けたら 字が 消える★', async ({
  page,
}) => {
  await hiraku(page, [], '2026-09-03');
  await page.evaluate(() => {
    window.__DK_HOZON_MATSU_MS = 1000;
    window.__osoiHozon = 4000;
  });
  await utsuMuri(page, '#shaList [data-dev][data-f="toll"]', '2500');
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.__osoiHozon = 0;
  });
  await utsuMuri(page, '#shaList [data-dev][data-f="denshi_yen"]', '300');
  await page.waitForTimeout(4000);
  await hiErabu(page, '2026-09-04');
  await hiErabu(page, '2026-09-03');
  expect(
    (await page.inputValue('#shaList [data-dev][data-f="toll"]')) +
      '/' +
      (await page.inputValue('#shaList [data-dev][data-f="denshi_yen"]')),
    '★倉庫が 打った 額と 違う★'
  ).toBe('2500/300');
  expect(await errJi(page), '★書けたのに 字が 残る★').toBe('');
});

// 4回目 直す-C の 字の 直し（読み込み中の 一打は「読み込み中です」）を 守る 試験が 0本だった（対立役 5回目 直す-4）
test('★読み込み中に 欄へ 字が 入っても 送らず 字は「読み込み中です」★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__osoi = 3000;
  });
  await page.fill('#hiSel', '2026-09-03');
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const i = document.querySelector('#shaList [data-sid][data-f="toll"]');
    if (i) {
      i.value = '777';
      i.dispatchEvent(new Event('change'));
    }
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__calls.length), '★読み込み中に 送った★').toBe(0);
  expect(await tomeJi(page)).toContain('読み込み中です');
  expect(await tomeJi(page)).not.toContain('読めません');
});

// ★★断りの 字・上の 字・字の 消え方★★ 2026-10-21（対立役 6回目 直す-1・直す-2・直す-3）
// 直す-1：403 の「◯◯ には書き込めません」が、日を 変えると 会社名の 無い 字に 置き換わった（95d3f3e で 入った 後退）
test('★403 で 断られた 会社名つきの 字は 日を 変えても 残る★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__hozonDame = true;
    window.__hozonDameNo = 403;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  expect(await errJi(page)).toContain('には書き込めません');
  await page.evaluate(() => {
    window.__hozonDame = false;
  });
  await hiErabu(page, '2026-09-03');
  expect(await errJi(page), '★日を 変えたら 会社名の 手がかりが 消えた★').toContain(
    'には書き込めません'
  );
});

// 直す-2：返事待ちで 読み直しが 止まって いる 間、上の 字は「読み込み中です」だけで 訳も 出口も 無かった（#err は 一覧の 下＝画面の 外）
test('★返事待ちで 止まって いる 間は 車の 上の 字に 時間切れの 訳と 出口が 出る★', async ({
  page,
}) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__DK_HOZON_MATSU_MS = 1000;
    window.__osoiHozon = 5000;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  await page.evaluate(() => {
    window.__osoiHozon = 0;
  });
  await hiErabu(page, '2026-09-03');
  await page.waitForTimeout(1200);
  expect(await tomeJi(page), '★上の 字に 時間切れの 訳が 無い★').toContain('返事が 来ません');
  expect(await tomeJi(page)).toContain('読み込み直して');
  const r = await page.evaluate(() => {
    const e = document.getElementById('tomeJi');
    const b = e.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, vh: innerHeight };
  });
  expect(r.top, '★上の 字が 画面の 外★').toBeGreaterThanOrEqual(0);
  expect(r.bottom, '★上の 字が 画面の 外★').toBeLessThanOrEqual(r.vh);
});

// 直す-3（n2）：売上の 打ち方の 間違いの 字は 描き直す 時に 消す（日を 往復すると 欄の -5 は 消えるのに 字が 残った）
test('★売上の 打ち方の 間違いの 字は 日を 往復したら 消える★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  await utsuMuri(page, '#shaList [data-uri-sid]', '-5');
  expect(await errJi(page)).toContain('0以上の 整数');
  await hiErabu(page, '2026-09-03');
  await hiErabu(page, '2026-09-02');
  expect(await errJi(page), '★欄の 字は 消えたのに 間違いの 字が 残る★').not.toContain(
    '0以上の 整数'
  );
});

// 直す-3（n3）：手で 入れた 日の 失敗の 字は、日を 変えた 後に 書けても 消える
//   ※ hozonDekita の 順を 入れ替えても 緑＝今の 作りでは 返事が 日の 表の 替わる 前に 返る（通らない 道・動きの 確かめ として 残す）
test('★手で 入れた 日：失敗の 後 打ち直して 日を 変えた 後に 書けたら 失敗の 字が 消える★', async ({
  page,
}) => {
  await hiraku(page, [], '2026-09-03');
  await page.evaluate(() => {
    window.__hozonDame = true;
  });
  await utsuMuri(page, '#shaList [data-dev][data-f="toll"]', '2500');
  expect(await errJi(page)).toContain('保存できませんでした');
  await page.evaluate(() => {
    window.__hozonDame = false;
    window.__osoiHozon = 1500;
  });
  await utsuMuri(page, '#shaList [data-dev][data-f="toll"]', '2500');
  await page.fill('#hiSel', '2026-09-04');
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.__osoiHozon = 0;
  });
  expect(await errJi(page), '★書けたのに 失敗の 字が 残る★').not.toContain('保存できませんでした');
});

// 直す-3（n5）：字が 2つ 残る 時は 最後の 欄の 字を 出す
test('★保存の 失敗の 後に 打ち方の 間違いが 来たら 間違いの 字を 出す★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__hozonDame = true;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  await page.evaluate(() => {
    window.__hozonDame = false;
  });
  expect(await errJi(page)).toContain('保存できませんでした');
  await utsuMuri(page, '#shaList [data-uri-sid]', '-5');
  expect(await errJi(page), '★後から 来た 間違いの 字が 出ない★').toContain('0以上の 整数');
});

// ★★同じ 日に 留まる 間の 時間切れ★★ 2026-10-21（対立役 7回目 直す-A・直す-B・直す-C）
// 訳の 箱は 1つ（#err）＝時間切れの 字が その 箱に 在る 時だけ 返す（9回目 直す-1 で #kireJi は やめた）
const kireUe = (page) =>
  page.evaluate(() => {
    const e = document.getElementById('err');
    if (!e || getComputedStyle(e).display === 'none' || !/返事が 来ません/.test(e.textContent))
      return null;
    const b = e.getBoundingClientRect();
    // 箱の 真ん中に 本当に 箱が 見えるか（隠れても「四角が 画面の 中」で 緑に しない・9回目 直す-2）
    const el = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
    return {
      ji: e.textContent,
      top: b.top,
      bottom: b.bottom,
      vh: innerHeight,
      mannaka: !!el && e.contains(el),
    };
  });
// 直す-A・直す-C：同じ 日の 時間切れでは 欄を 止めず、訳は 一覧の 上（画面の 中）に 出す。返事が 来たら 消える
test('★同じ 日の 時間切れ：欄は 押せる まま・訳は 上に 見える・返事で 消える★', async ({
  page,
}) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__DK_HOZON_MATSU_MS = 1000;
    window.__osoiHozon = 3500;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  await page.waitForTimeout(1000);
  expect(await oseruKazu(page), '★同じ 日の 時間切れで 欄が 止まった（固まる）★').toBeGreaterThan(
    0
  );
  const u = await kireUe(page);
  expect(u, '★時間切れの 訳が 上に 出ない★').not.toBeNull();
  expect(u.ji).toContain('返事が 来ません');
  expect(u.top, '★訳が 画面の 外★').toBeGreaterThanOrEqual(0);
  expect(u.bottom, '★訳が 画面の 外★').toBeLessThanOrEqual(u.vh);
  expect(u.mannaka, '★訳の 箱が 何かの 裏に 隠れて いる★').toBe(true);
  await page.waitForTimeout(2500);
  expect(await kireUe(page), '★返事が 来たのに 上の 訳が 残る★').toBeNull();
  expect(await oseruKazu(page)).toBeGreaterThan(0);
});

// 直す-B：時間切れの 後に 日を 変える（20秒 待ってから 日を 変える 普通の 順）でも 上の 字に 訳と 出口
test('★時間切れの 後に 日を 変えても 上の 字に 時間切れの 訳★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__DK_HOZON_MATSU_MS = 1000;
    window.__osoiHozon = 5000;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  await page.waitForTimeout(1200); // 時間切れ 済み
  await page.evaluate(() => {
    window.__osoiHozon = 0;
  });
  await hiErabu(page, '2026-09-03');
  await page.waitForTimeout(300);
  expect(await tomeJi(page), '★日を 変えた 後の 上の 字に 時間切れの 訳が 無い★').toContain(
    '返事が 来ません'
  );
});

// ★★訳は 打った 所から 見える／二重に 出ない／元の 字に 戻る★★ 2026-10-21（対立役 8回目 直す-1・直す-2・直す-3）
const yoso = (page) =>
  page.evaluate(() => {
    const e = document.getElementById('err');
    const t = document.getElementById('tomeJi');
    const eb = e.getBoundingClientRect();
    const naka = document.elementFromPoint((eb.left + eb.right) / 2, (eb.top + eb.bottom) / 2);
    const mieru = e.style.display !== 'none' && !!naka && e.contains(naka);
    const ji = e.style.display === 'none' ? '' : e.textContent;
    return {
      err: ji,
      errMieru: mieru,
      tome: t ? t.textContent : '',
      // 時間切れの 字（同じ 日は 貼り付いた 箱・読み込み中は 上の 止めの 字が 出す＝箱には 重ねない）
      ue: /返事が 来ません/.test(ji) ? ji : null,
      ueMieru: /返事が 来ません/.test(ji) && mieru,
      kireJi: document.querySelectorAll('#kireJi').length,
      oseru: Array.from(document.querySelectorAll('#shaList input')).filter((i) => !i.disabled)
        .length,
    };
  });

// 直す-1：車の 多い 日に 下の 車で 打つと 時間切れの 訳が 画面の はるか 上（一覧の 前）で 見えなかった
test('★10台の 日に 下の 車で 打っても 時間切れの 訳が 見える★', async ({ page }) => {
  await page.addInitScript(() => {
    window.__manyCars = 10;
  });
  await hiraku(page, [], '2026-09-03');
  await page.evaluate(() => {
    window.__DK_HOZON_MATSU_MS = 1000;
    window.__osoiHozon = 60000;
  });
  const sel = '#shaList [data-dev="d8"][data-f="toll"]';
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.locator(sel).fill('2500');
  await page.locator(sel).press('Tab');
  await page.waitForTimeout(1800);
  const o = await yoso(page);
  expect(o.ue).toContain('返事が 来ません');
  expect(o.ueMieru, '★時間切れの 訳が 打った 所から 見えない★').toBe(true);
});

// 直す-2：時間切れの 後に 失敗が 返ると、見えて いた 唯一の 注意が 消え、失敗の 字は 画面の 外だった
test('★時間切れの 後に 失敗が 返ったら 失敗の 字が 見える★', async ({ page }) => {
  await page.addInitScript(() => {
    window.__manyCars = 2;
  });
  await hiraku(page, [], '2026-09-03');
  await page.evaluate(() => {
    window.__DK_HOZON_MATSU_MS = 1000;
    window.__osoiHozon = 3000;
    window.__hozonDame = true;
  });
  await utsuMuri(page, '#shaList [data-dev="d1"][data-f="toll"]', '2500');
  await page.evaluate(() => {
    window.__hozonDame = false;
  });
  await page.waitForTimeout(3500);
  const o = await yoso(page);
  expect(o.err).toContain('保存できませんでした');
  expect(o.errMieru, '★失敗の 字が 画面の 外・上の 注意は 消えた★').toBe(true);
});

// 直す-3（m5）：日を 変える 間は 上の 別の 字（#kireJi）を 消す＝二重に 出さない・読み終えた 後に 古い 訳を 残さない
// 直す-3（m4）：時間切れが 無く なったら 読めない 日の 訳に 戻す（時間切れの 字に 置き換わった まま に しない）
test('★時間切れ→実費が 読めない 日へ→返事：二重に 出ず、上は 読めない 訳に 戻る★', async ({
  page,
}) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__DK_HOZON_MATSU_MS = 1000;
    window.__osoiHozon = 5000;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  await page.waitForTimeout(1000);
  expect((await yoso(page)).ue).toContain('返事が 来ません');
  await page.evaluate(() => {
    window.__osoiHozon = 0;
    window.__yomenai = ['dk_shift_edits'];
  });
  await hiErabu(page, '2026-09-03');
  const b = await yoso(page);
  expect(b.ue, '★日を 変えた 後も 上の 別の 字が 残り 二重に 出た★').toBeNull();
  expect(b.tome).toContain('返事が 来ません');
  await page.waitForTimeout(4500);
  const c = await yoso(page);
  expect(c.tome, '★読めない 訳が 時間切れの 字に 置き換わった まま★').toContain('実費');
  expect(c.ue).toBeNull();
  expect(c.oseru).toBe(0);
});

test('★時間切れ→別の 日→すぐ 元の 日→返事：上の 字は 消え 欄が 戻る★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__DK_HOZON_MATSU_MS = 1000;
    window.__osoiHozon = 5000;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  await page.waitForTimeout(800);
  await hiErabu(page, '2026-09-03');
  await hiErabu(page, '2026-09-02');
  await page.waitForTimeout(4500);
  const b = await yoso(page);
  expect(b.tome).toBe('');
  expect(b.ue, '★読み終えた 後も 古い 時間切れの 訳が 残る★').toBeNull();
  expect(b.oseru).toBeGreaterThan(0);
  expect(await page.inputValue('#shaList [data-sid][data-f="toll"]')).toBe('2000');
});

// 直す-3（m4）：時間切れの 車が 返った 後、別の 車の 返事待ちで まだ 読み直せない 間も
//   上の 字を「返事が 来ません・読み込み直して」の まま に しない（いらない 読み込み直しを 勧めない・対立役 7回目 TK7-1）
test('★時間切れの 車が 返ったら 他の 車の 返事待ちでも 上の 字は 時間切れで なくなる★', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__manyCars = 2;
  });
  await hiraku(page, [], '2026-09-03');
  await page.evaluate(() => {
    window.__DK_HOZON_MATSU_MS = 1000;
    window.__osoiHozon = 4000;
  });
  await utsuMuri(page, '#shaList [data-dev="d1"][data-f="toll"]', '2500');
  await page.waitForTimeout(800); // 1台目は 時間切れ
  await page.evaluate(() => {
    window.__DK_HOZON_MATSU_MS = 60000;
    window.__osoiHozon = 9000;
  });
  await utsuMuri(page, '#shaList [data-dev="d2"][data-f="toll"]', '800');
  await hiErabu(page, '2026-09-04'); // 読み直しは 返事を 待つ
  expect((await yoso(page)).tome).toContain('返事が 来ません');
  await page.waitForTimeout(2500); // 1台目が 返る・2台目は まだ
  expect(
    (await yoso(page)).tome,
    '★1台目は 返ったのに 上は「返事が 来ません」の まま★'
  ).not.toContain('返事が 来ません');
});

// ★★訳の 箱は 1つ・全部 見える・欄を 覆わない★★ 2026-10-21（対立役 9回目 直す-1・直す-2・直す-3）
// 直す-1：時間切れの 箱と 403 の 箱が 重なって 時間切れの 出口（読み込み直して）が 隠れた
test('★時間切れ＋別の 車の 403：1つの 箱に 両方の 訳が 全部 見える★', async ({ page }) => {
  await page.addInitScript(() => {
    window.__manyCars = 10;
  });
  for (const [w, h] of [
    [390, 844],
    [320, 568],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await hiraku(page, [], '2026-09-03');
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => {
      window.__DK_HOZON_MATSU_MS = 1000;
      window.__osoiHozon = 60000;
    });
    await utsuMuri(page, '#shaList [data-dev="d1"][data-f="toll"]', '2500');
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      window.__osoiHozon = 0;
      window.__hozonDame = true;
      window.__hozonDameNo = 403;
    });
    await utsuMuri(page, '#shaList [data-dev="d8"][data-f="toll"]', '800');
    const o = await yoso(page);
    expect(o.err).toContain('返事が 来ません');
    expect(o.err).toContain('読み込み直して');
    expect(o.err).toContain('には書き込めません');
    expect(o.errMieru, `★${w}×${h}：訳の 箱が 隠れて いる★`).toBe(true);
    // 箱の 下の 端（出口の 字が 在る 所）も 見える
    const shita = await page.evaluate(() => {
      const e = document.getElementById('err');
      const b = e.getBoundingClientRect();
      const el = document.elementFromPoint((b.left + b.right) / 2, b.bottom - 4);
      return !!el && e.contains(el) && b.bottom <= innerHeight;
    });
    expect(shita, `★${w}×${h}：訳の 箱の 下が 隠れて いる★`).toBe(true);
    await page.evaluate(() => {
      window.__hozonDame = false;
    });
  }
});

// 直す-3：貼り付いた 箱が 出て いる 間に Tab で 欄を 進めると、入った 欄が 箱や 下の 帯の 裏に 潜った
test('★訳の 箱が 出て いる 間 Tab で 進めても 入った 欄は 箱にも 帯にも 覆われない★', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__manyCars = 10;
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await hiraku(page, [], '2026-09-03');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    window.__hozonDame = true;
    window.__hozonDameNo = 403;
  });
  await utsuMuri(page, '#shaList [data-dev="d1"][data-f="toll"]', '2500');
  await page.evaluate(() => {
    window.__hozonDame = false;
  });
  expect((await yoso(page)).err).toContain('には書き込めません');
  await page.locator('#shaList [data-dev="d1"][data-f="toll"]').focus();
  let ooware = 0;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(80);
    const ok = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || !a.closest || !a.closest('#shaList')) return true;
      const b = a.getBoundingClientRect();
      const el = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
      return !!el && (el === a || a.contains(el));
    });
    if (!ok) ooware++;
  }
  expect(ooware, '★Tab で 入った 欄が 箱か 帯の 裏に 潜った★').toBe(0);
});

// ★★箱が 出た 瞬間・欄に 入った 瞬間・同じ 字・改行★★ 2026-10-21（対立役 10回目 直す-1・直す-2）
const ooware = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || !a.closest || !a.closest('#shaList')) return 'nai';
    const b = a.getBoundingClientRect();
    const el = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
    return !!el && (el === a || a.contains(el)) ? 'mieru' : 'ooware';
  });

// 直す-1：遅れた 403 で 最初の 箱が 出た 瞬間、今 入って いる 下の 方の 欄を 覆った
test('★打って いる 間に 最初の 訳の 箱が 出ても 今の 欄は 覆われない★', async ({ page }) => {
  await page.addInitScript(() => {
    window.__manyCars = 10;
  });
  for (const [w, h] of [
    [320, 568],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await hiraku(page, [], '2026-09-03');
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => {
      window.__hozonDame = true;
      window.__hozonDameNo = 403;
      window.__osoiHozon = 700;
    });
    await utsuMuri(page, '#shaList [data-dev="d5"][data-f="toll"]', '2500');
    // 次の 欄を 画面の 下の 端（帯の すぐ 上）に 置いて 入る＝箱が 出る 前は 見えて いる
    await page.evaluate(() => {
      const i = document.querySelector('#shaList [data-dev="d6"][data-f="toll"]');
      const f = document.querySelector('.dk-foot');
      const soko = f ? f.getBoundingClientRect().top : innerHeight;
      window.scrollBy(0, i.getBoundingClientRect().bottom - (soko - 12));
      i.focus({ preventScroll: true });
    });
    expect(
      await ooware(page),
      `★${w}×${h}：箱が 出る 前から 覆われて いる＝この 形を 測って いない★`
    ).toBe('mieru');
    await page.waitForTimeout(1000); // 403 が 返って 箱が 出る
    expect((await yoso(page)).err).toContain('には書き込めません');
    expect(await ooware(page), `★${w}×${h}：箱が 出た 瞬間に 打って いる 欄を 覆った★`).toBe(
      'mieru'
    );
    await page.evaluate(() => {
      window.__hozonDame = false;
      window.__osoiHozon = 0;
    });
  }
});

// 直す-2：欄に 入った 時の 送り上げ（focusin）だけを 守る 1本（scroll-padding は 送らない 入り方＝preventScroll で 入る）
test('★箱が 出て いる 間 箱の 裏の 欄に 入ったら 送り上げる★', async ({ page }) => {
  await page.addInitScript(() => {
    window.__manyCars = 10;
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await hiraku(page, [], '2026-09-03');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    window.__hozonDame = true;
    window.__hozonDameNo = 403;
  });
  await utsuMuri(page, '#shaList [data-dev="d1"][data-f="toll"]', '2500');
  await page.evaluate(() => {
    window.__hozonDame = false;
  });
  // 欄を 箱の 真ん中の 裏へ 送って から 送らずに 入る（上の 余白の 数 px で 欄が 無く なる 形に 頼らない・11回目 直す-3）
  const ari = await page.evaluate(() => {
    const e = document.getElementById('err');
    const i = document.querySelector('#shaList [data-dev="d6"][data-f="toll"]');
    const eb = e.getBoundingClientRect();
    const ib = i.getBoundingClientRect();
    window.scrollBy(0, (ib.top + ib.bottom) / 2 - (eb.top + eb.bottom) / 2);
    const eb2 = e.getBoundingClientRect();
    const ib2 = i.getBoundingClientRect();
    const cy = (eb2.top + eb2.bottom) / 2;
    if (!(ib2.top < cy && ib2.bottom > cy)) return false;
    i.focus({ preventScroll: true });
    return true;
  });
  expect(ari, '★箱の 裏に 欄が 無い＝この 形を 測って いない★').toBe(true);
  await page.waitForTimeout(200);
  expect(await ooware(page), '★箱の 裏の 欄に 入っても 送り上げない★').toBe('mieru');
});

// 直す-2：同じ 字は 1回・違う 字は 改行して 並べる（見張りが 無かった）
test('★2台が 同じ 403：字は 1回／違う 訳は 行を 分けて 並ぶ★', async ({ page }) => {
  await page.addInitScript(() => {
    window.__manyCars = 2;
  });
  await hiraku(page, [], '2026-09-03');
  await page.evaluate(() => {
    window.__hozonDame = true;
    window.__hozonDameNo = 403;
  });
  await utsuMuri(page, '#shaList [data-dev="d1"][data-f="toll"]', '2500');
  await utsuMuri(page, '#shaList [data-dev="d2"][data-f="toll"]', '800');
  await page.evaluate(() => {
    window.__hozonDame = false;
  });
  const ji = (await yoso(page)).err;
  expect(ji.split('には書き込めません').length - 1, '★同じ 字が 2回 出た★').toBe(1);
});

test('★違う 訳（403 と 打ち方の 間違い）は 行を 分けて 並ぶ★', async ({ page }) => {
  await hiraku(page, [], '2026-09-02');
  await page.evaluate(() => {
    window.__hozonDame = true;
    window.__hozonDameNo = 403;
  });
  await utsuMuri(page, '#shaList [data-sid][data-f="toll"]', '2000');
  await page.evaluate(() => {
    window.__hozonDame = false;
  });
  await utsuMuri(page, '#shaList [data-uri-sid]', '-5');
  const o = await page.evaluate(() => {
    const e = document.getElementById('err');
    return {
      ji: e.textContent,
      gyou: e.innerText.split(String.fromCharCode(10)).filter((x) => x.trim()).length,
    };
  });
  expect(o.ji).toContain('には書き込めません');
  expect(o.ji).toContain('0以上の 整数');
  expect(o.gyou, '★違う 訳が 改行されずに つながった★').toBe(2);
});

// ★★画面を 勝手に 跳ばさない・帯の 裏にも 潜らせない★★ 2026-10-21（対立役 11回目 直す-1・直す-2・直す-4）
// 直す-1：下の 車に 打って 上へ 戻って 見て いる 時に 箱が 出ると、打った 欄まで 6,700px 飛んだ
test('★上へ 戻って 見て いる 時に 箱が 出ても 画面は 跳ばない★', async ({ page }) => {
  await page.addInitScript(() => {
    window.__manyCars = 10;
  });
  for (const [w, h] of [
    [1280, 720],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await hiraku(page, [], '2026-09-03');
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => {
      window.__DK_HOZON_MATSU_MS = 1000;
      window.__osoiHozon = 60000;
    });
    const sel = '#shaList [data-dev="d9"][data-f="toll"]';
    await page.locator(sel).scrollIntoViewIfNeeded();
    await page.evaluate((sel) => {
      const i = document.querySelector(sel);
      i.focus();
      i.value = '2500';
      i.dispatchEvent(new Event('change'));
    }, sel);
    // 箱が 出る 前に 上へ 戻れて いる 事（遅い 機械で 箱が 先に 出ると scrollTo が 跳びを 消して 偽の 緑・12回目 見立て-1）
    expect(
      (await yoso(page)).err,
      '★上へ 戻る 前に 箱が 出た＝この 形を 測って いない★'
    ).not.toContain('返事が 来ません');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500); // 時間切れの 箱が 出る
    expect((await yoso(page)).err).toContain('返事が 来ません');
    const y = await page.evaluate(() => window.scrollY);
    expect(y, `★${w}×${h}：箱が 出た 時に 画面が ${y}px 跳んだ★`).toBeLessThan(5);
    await page.evaluate(() => {
      window.__osoiHozon = 0;
    });
  }
});

// 直す-2：箱が 出た 時の 位置で 下の 余白を 決め、見えて いて 覆われて いない 欄で Tab すると 240〜300px 跳ねた
test('★箱が 出て いる 間 見えて いる 欄で Tab しても 画面は 跳ねない★', async ({ page }) => {
  await page.addInitScript(() => {
    window.__manyCars = 10;
  });
  for (const [w, h] of [
    [1280, 720],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await hiraku(page, [], '2026-09-03');
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.evaluate(() => {
      window.__hozonDame = true;
      window.__hozonDameNo = 403;
    });
    await page.evaluate(() => {
      const i = document.querySelector('#shaList [data-dev="d10"][data-f="toll"]');
      i.value = '800';
      i.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      window.__hozonDame = false;
    });
    expect((await yoso(page)).err).toContain('には書き込めません');
    // 上へ 戻り、画面の 上の 方（箱にも 帯にも 遠い）欄から Tab で 進む
    await page.evaluate(() => {
      const i = document.querySelector('#shaList [data-dev="d2"][data-f="toll"]');
      window.scrollBy(0, i.getBoundingClientRect().top - 60);
      i.focus({ preventScroll: true });
    });
    let hane = 0;
    for (let k = 0; k < 6; k++) {
      const r = await page.evaluate(() => {
        const a = document.activeElement;
        const b = a.getBoundingClientRect();
        const e = document.getElementById('err');
        const sh = parseFloat(getComputedStyle(e).bottom) || 0;
        return {
          y: window.scrollY,
          nextBottom: b.bottom,
          sen: innerHeight - sh - e.offsetHeight - 8,
        };
      });
      await page.keyboard.press('Tab');
      await page.waitForTimeout(60);
      const r2 = await page.evaluate(() => {
        const a = document.activeElement;
        return {
          y: window.scrollY,
          bottom: a.getBoundingClientRect().bottom + (window.scrollY - 0),
        };
      });
      // 入った 欄が 動く 前に 箱の 線より 上で 見えて いたのに 画面が 動いたら 跳ね
      const maeBottom = r2.bottom - r.y; // 動く 前の 画面での 欄の 下の 端
      if (maeBottom < r.sen && Math.abs(r2.y - r.y) > 2) hane++;
    }
    expect(hane, `★${w}×${h}：見えて いる 欄で 画面が 跳ねた★`).toBe(0);
  }
});

// 直す-4：下の 帯の 裏に 欄を 潜らせない（帯を 測る 行に 見張りが 無かった）
test('★箱が 無い 時も Tab で 入った 欄は 下の 帯の 裏に 潜らない★', async ({ page }) => {
  await page.addInitScript(() => {
    window.__manyCars = 10;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await hiraku(page, [], '2026-09-03');
  await page.setViewportSize({ width: 390, height: 844 });
  // 帯の すぐ 上の 欄に 入り、Tab で 帯の 裏の 欄へ 進む
  let ura = 0;
  let mita = 0;
  for (const dev of ['d3', 'd5', 'd7', 'd9']) {
    await page.evaluate((dev) => {
      const i = document.querySelector('#shaList [data-dev="' + dev + '"][data-f="toll"]');
      const f = document.querySelector('.dk-foot');
      const soko = f ? f.getBoundingClientRect().top : innerHeight;
      window.scrollBy(0, i.getBoundingClientRect().bottom - (soko - 10));
      i.focus({ preventScroll: true });
    }, dev);
    const mae = await page.evaluate(() => {
      const a = document.activeElement;
      const all = Array.from(document.querySelectorAll('#shaList input:not([disabled])'));
      const n = all[all.indexOf(a) + 1];
      const f = document.querySelector('.dk-foot');
      return !!n && !!f && n.getBoundingClientRect().top > f.getBoundingClientRect().top - 4;
    });
    if (!mae) continue;
    mita++;
    await page.keyboard.press('Tab');
    await page.waitForTimeout(80);
    if ((await ooware(page)) !== 'mieru') ura++;
  }
  expect(mita, '★帯の 裏の 欄へ 進む 形を 作れて いない＝この 形を 測って いない★').toBeGreaterThan(
    0
  );
  expect(ura, '★Tab で 入った 欄が 下の 帯の 裏に 潜った★').toBe(0);
});

// ★★箱が 出て いる 間に 画面を 回しても 見えて いる 欄で 跳ねない★★ 2026-10-21（対立役 12回目 直す-1：
//   縦で 決めた 下の 余白が 横で 残り、Tab の たびに 見えて いた 欄で 79〜139px 跳ねた）
test('★箱が 出て いる 間に 縦から 横へ 回しても 下の 余白は 今の 箱で 測り直す★', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__manyCars = 10;
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await hiraku(page, [], '2026-09-03');
  await page.setViewportSize({ width: 320, height: 568 });
  // 違う 訳を 2つ（403・時間切れ）出して 箱を 高く する
  await page.evaluate(() => {
    window.__hozonDame = true;
    window.__hozonDameNo = 403;
  });
  await utsuMuri(page, '#shaList [data-dev="d1"][data-f="toll"]', '2500');
  await page.evaluate(() => {
    window.__hozonDame = false;
    window.__DK_HOZON_MATSU_MS = 1000;
    window.__osoiHozon = 60000;
  });
  await utsuMuri(page, '#shaList [data-dev="d2"][data-f="toll"]', '800');
  await page.waitForTimeout(1200);
  expect((await yoso(page)).err).toContain('返事が 来ません');
  await page.setViewportSize({ width: 568, height: 320 });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const e = document.getElementById('err');
    const f = document.querySelector('.dk-foot');
    const sh = parseFloat(getComputedStyle(e).bottom) || 0;
    const soko =
      Math.min(f ? f.getBoundingClientRect().top : innerHeight, innerHeight - sh - e.offsetHeight) -
      8;
    return {
      pad: parseFloat(document.documentElement.style.scrollPaddingBottom) || 0,
      tadashii: innerHeight - soko,
    };
  });
  expect(
    Math.abs(r.pad - r.tadashii),
    `★回した 後も 下の 余白が 古い（${r.pad} ／ 正しくは ${r.tadashii}）★`
  ).toBeLessThan(2);
});
