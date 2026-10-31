// ============================================================
// ★★見張り：給料明細の 紙＝1回の 払いは 1枚（横 1列に 入らない 期間は 縦の 紙）★★ 2026-10-23
//
//   ★司さんの言葉★
//     「なんで明細を全部10日で区切っとんど 月1回やったら1枚やろが 週一でも7日区切りとか」
//     「紙を縦に使うのは項目と日付を入れ替えて日付を左端の縦にして項目を上の横にして作成しろ」
//     「日払いも上行に項目で左端に日付にして」「項目や日付が中央揃えなら他の数字も中央揃えにしろ」
//     「見せる売上の数ごとに幅を自動調整」「手当や控除がある時は合計金額の右に空いてるスペースに」
//   ★物差し★（本物の _buildPaperSheet／_maisu を 呼んで 組んだ 紙を 数える＝__paper）
//     ① 31日の 期間 … 縦の 紙（1123 高さ）1枚・日付が 左の 縦（31行）・項目が 上の 横
//     ② 10日の 期間 … 今まで 通り 横の 紙 1枚
//     ③ 1日（日払い） … 縦の 紙
//     ④ 数字（td）は 全部 中央揃え
//     ⑤ 横の 紙は 車 13台まで 1枚・14台で 車の 行を 次の 紙へ
//     ⑥ 手当・控除は 入る 数なら 合計の 右の 空き（data-migi=1）・越えたら 見出しの 下（0）
//   ★★わざと壊して 赤（2026-10-23 手元 chromium 実測）★★
//     tate を 常に false（横の 紙だけ）⇒ 8本中 8本 赤／td を text-align:right に 戻す ⇒ 3本 赤（④ と 縦・横の 揃え）／
//     行の 高さを 50 固定に 戻す ⇒ 1本 赤（⑤ 13台）／右の 空きを 使わない（入る 数を 0 に）⇒ 1本 赤（⑥ 4件）／
//     画面の 紙を 横の 1123×794 決め打ちに 戻す ⇒ ⑦ 赤／見出しの 左を いつも 半分に 戻す ⇒ ⑧ 赤
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

// 0人目の 日を n日に する（日付は 続けて 増やす）
async function hiWoSoroeru(page, n) {
  await page.evaluate((n) => {
    const emp = window.__paper.emp(0);
    const src = emp.cells.slice();
    const d0 = new Date(src[0].date + 'T00:00:00');
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = JSON.parse(JSON.stringify(src[i % src.length]));
      const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i);
      c.date =
        d.getFullYear() +
        '-' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getDate()).padStart(2, '0');
      out.push(c);
    }
    emp.cells.length = 0;
    out.forEach((c) => emp.cells.push(c));
  }, n);
}
function kuruma(f, dai) {
  for (let i = f.labels.length; i < dai; i++) {
    f.labels.push({
      company_id: f.labels[0].company_id,
      device_id: '00000000-0000-4000-9000-0000000001' + String(i).padStart(2, '0'),
      label: '車' + (i + 1),
      sort_order: i + 1,
      show_in_slip: true,
    });
  }
}
// 0人目の 紙を 全部 組んで 数える
function kami(page) {
  return page.evaluate(() => {
    const P = window.__paper;
    const els = P.sheets(0);
    return els.map((el) => {
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.top = '0';
      document.body.appendChild(el);
      const trs = [...el.querySelectorAll('tbody tr')];
      const r = {
        muki: el.getAttribute('data-muki'),
        sheetH: +el.getAttribute('data-sheet-h'),
        h: el.scrollHeight,
        gyou: trs.length,
        ue: trs[0] ? [...trs[0].children].map((c) => c.textContent.trim()) : [],
        hidari: trs.slice(1).map((tr) => (tr.firstElementChild || {}).textContent.trim()),
        migi: el.getAttribute('data-migi'),
        tdSoroe: [
          ...new Set([...el.querySelectorAll('td')].map((td) => getComputedStyle(td).textAlign)),
        ],
        uri: [...el.querySelectorAll('th')].filter((th) =>
          /^売上\d+/.test(((th.querySelector('div') || {}).textContent || '').trim())
        ).length,
      };
      el.remove();
      return r;
    });
  });
}

test('① 31日の 期間は 縦の 紙 1枚・日付が 左の 縦・項目が 上の 横', async ({ page }) => {
  await openKyuryo(page);
  await hiWoSoroeru(page, 31);
  const k = await kami(page);
  expect(k.length, '★31日が 1枚に ならない★').toBe(1);
  expect(k[0].muki, '★縦の 紙で ない★').toBe('tate');
  expect(k[0].h, '★縦の 紙の 下が 切れた★').toBeLessThanOrEqual(k[0].sheetH);
  expect(k[0].gyou, '★1日 1行（項目の 行＋31行）で ない★').toBe(32);
  expect(k[0].ue[0], '★左上が「日付」で ない★').toBe('日付');
  expect(k[0].ue[1], '★上の 横に 項目（金額）が 無い★').toBe('金額');
});

test('② 10日の 期間は 今まで 通り 横の 紙 1枚', async ({ page }) => {
  await openKyuryo(page);
  await hiWoSoroeru(page, 10);
  const k = await kami(page);
  expect(k.length).toBe(1);
  expect(k[0].muki, '★10日が 横の 紙で ない★').toBe('yoko');
  expect(k[0].h).toBeLessThanOrEqual(794);
});

test('③ 1日（日払い）は 縦の 紙・日付が 左', async ({ page }) => {
  await openKyuryo(page);
  await hiWoSoroeru(page, 1);
  const k = await kami(page);
  expect(k.length).toBe(1);
  expect(k[0].muki, '★日払いが 縦の 紙で ない★').toBe('tate');
  expect(k[0].ue[0]).toBe('日付');
});

test('④ 数字は 全部 中央揃え（横の 紙も 縦の 紙も）', async ({ page }) => {
  await openKyuryo(page);
  for (const n of [10, 31]) {
    await hiWoSoroeru(page, n);
    const k = await kami(page);
    k.forEach((s) =>
      expect(s.tdSoroe, '★' + n + '日：中央揃えで ない 数字が 在る★').toEqual(['center'])
    );
  }
});

for (const [dai, mai] of [
  [13, 1],
  [14, 2],
]) {
  test(`⑤ 横の 紙は 車 ${dai}台 で ${mai}枚（13台まで 1枚）`, async ({ page }) => {
    await openKyuryo(page, (f) => {
      kuruma(f, dai);
      return f;
    });
    await hiWoSoroeru(page, 10);
    const k = await kami(page);
    expect(k.length, '★車 ' + dai + '台の 枚数★').toBe(mai);
    k.forEach((s) => expect(s.h, '★紙の 下が 切れた★').toBeLessThanOrEqual(794));
    const zen = k.reduce((a, s) => a + s.uri, 0);
    expect(zen, '★売上の 行が 抜けた・重なった★').toBe(dai);
  });
}

for (const [n, migi] of [
  [4, '1'],
  [11, '0'],
]) {
  test(`⑥ 手当・控除 ${n}件 … 合計の 右の 空き＝${migi}（横の 紙は 10件まで）`, async ({
    page,
  }) => {
    await openKyuryo(page, (f) => {
      const w = f.workHours[0];
      f.adjustments = Array.from({ length: n }, (_, i) => ({
        adj_id: 'a' + i,
        employee_id: w.employee_id,
        work_date: w.work_date,
        kind: i % 2 ? 'koujo' : 'teate',
        label: i % 2 ? '前借り' : 'ガソリン代',
        yen: i % 2 ? 10000 : 3000,
      }));
      return f;
    });
    const k = await page.evaluate(() => {
      const P = window.__paper;
      for (let ei = 0; ei < P.ninzu(); ei++) {
        const e = P.emp(ei);
        if (e.teate || e.koujo) return P.sheets(ei).map((el) => el.getAttribute('data-migi'));
      }
      return null;
    });
    expect(k, '★手当・控除の 在る 人が 居ない★').not.toBeNull();
    expect(k[0], '★右の 空きに 入る／入らないが 違う★').toBe(migi);
  });
}

// ★★対立役 止1：画面に 並べる 紙も 紙ごとの 大きさ（縦の 紙を 横の 1123×794 で 決め打ちして 下 3割が 切れた）★★
//   月 1回（31日）の 会社で 事務所の 画面と 本人の 画面の 縦の 紙を 開き「最後の 日の 行の 下 ≦ 枠の 下」「紙の 幅 794」
test('⑦ 月1回の 縦の 紙は 事務所の 画面でも 本人の 画面でも 下が 切れない', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openKyuryo(page, (f) => {
    f.settings[0].period_shime = { kind: 'tsuki', hi: [0] };
    return f;
  });
  await page.waitForTimeout(1500);
  const jimu = await page.evaluate(() =>
    [...document.querySelectorAll('#slips .kami-mado .hn-kami-waku')].map((w) => {
      const el = w.firstElementChild;
      const trs = el.querySelectorAll('tbody tr');
      return {
        muki: el.getAttribute('data-muki'),
        haba: el.style.width,
        shita: trs.length ? trs[trs.length - 1].getBoundingClientRect().bottom : 0,
        waku: w.getBoundingClientRect().bottom,
      };
    })
  );
  expect(jimu.length, '★事務所の 画面に 紙が 無い★').toBeGreaterThan(0);
  jimu.forEach((x) => {
    expect(x.muki, '★月1回が 縦の 紙で ない★').toBe('tate');
    expect(x.haba, '★縦の 紙を 横の 幅で 並べた★').toBe('794px');
    expect(x.shita, '★事務所の 画面で 縦の 紙の 下が 切れた★').toBeLessThanOrEqual(x.waku + 1);
  });

  const p2 = await browser.newPage();
  await p2.setViewportSize({ width: 390, height: 844 });
  const { hiraku } = require('./honnin-harness');
  await hiraku(p2, { period_shime: { kind: 'tsuki', hi: [0] } });
  // ★本人の 画面は 本物の PDF の 絵★ 2026-10-31（見本 代行請求書と 同じ）＝絵の ページが 縦長・枠の 下で 切れない
  const hon = await p2.evaluate(() => {
    const mado = document.getElementById('hnKami').getBoundingClientRect();
    return [...document.querySelectorAll('#hnKami .sheet-pdf canvas')].map((c) => {
      const r = c.getBoundingClientRect();
      return { tate: c.height > c.width, shita: r.bottom, waku: mado.bottom };
    });
  });
  expect(hon.length, '★本人の 画面に 紙が 無い★').toBeGreaterThan(0);
  hon.forEach((x) => {
    expect(x.tate, '★月1回が 縦の 紙で ない★').toBe(true);
    expect(x.shita, '★本人の 画面で 縦の 紙の 下が 切れた★').toBeLessThanOrEqual(x.waku + 1);
  });
  await p2.close();
});

// ★★対立役 止2：縦の 紙で 名前が 長い・合計が 大きい 時に 見出しの 左の 字が 真ん中の 合計に 重なった★★
test('⑧ 縦の 紙で 名前が 長くても 見出しの 左の 字は 合計の 塊に 重ならない', async ({ page }) => {
  await openKyuryo(page, (f) => {
    f.emps.forEach((e) => {
      e.name = 'とても長い名前の運転手さん';
    });
    return f;
  });
  await hiWoSoroeru(page, 31);
  const r = await page.evaluate(() => {
    const el = window.__paper.sheets(0)[0];
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    document.body.appendChild(el);
    const head = el.firstElementChild;
    const hidari = head.children[0];
    const goukei = head.children[1];
    let migiHashi = 0;
    hidari.querySelectorAll('div').forEach((d) => {
      const rg = document.createRange();
      rg.selectNodeContents(d);
      for (const q of rg.getClientRects()) migiHashi = Math.max(migiHashi, q.right);
    });
    const out = {
      muki: el.getAttribute('data-muki'),
      migiHashi: migiHashi,
      goukeiHidari: goukei.getBoundingClientRect().left,
      goukeiMigi: goukei.getBoundingClientRect().right,
      kamiMigi: el.getBoundingClientRect().right,
    };
    el.remove();
    return out;
  });
  expect(r.muki).toBe('tate');
  expect(r.migiHashi, '★見出しの 左の 字が 合計の 塊に 重なった★').toBeLessThanOrEqual(
    r.goukeiHidari
  );
  expect(r.goukeiMigi, '★合計の 塊が 紙の 外へ 出た★').toBeLessThanOrEqual(r.kamiMigi);
});
