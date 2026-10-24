// ============================================================
// ★★見張り：給料の「テンプレ」＝払い方ごとの 明細の 紙を 見て 選ぶ★★ 2026-10-23
//
//   ★司さんの言葉★「明細と時数を入れるの間にテンプレのボタンを作成して 全パターンをPDFで見て選べるようにして
//                    選ばせ方や見せ方は代行請求書アプリの見せ方を真似て」
//   ★2026-10-24 直し★ 司さん「月1回のテンプレは給料設定があるんやから1個でええやろ。月2回、3回、週一も一緒や。
//     同じものを並べてどうするんのど」「変えたい時は給料設定から変更して下さい」
//     ⇒ 12通り → 払い方の 種類ごとに 1つ（5枚）・札を 押しても 設定は 変えない（見るだけ）
//     ⇒ 前の ③⑤⑥（押すと 給料の 設定の 欄に 入る・保存で 記録を 書く・何日からで 戻らない）は 道ごと 外した
//        ③ は「押しても 設定を 変えない」に 書き換えた（数と 上の 字は kyuryo-settei-setsumei ④⑤）
//   ★2026-10-24 夜★ 司さん「テンプレに実名を勝手に使うな」⇒ 見本の 紙の 名前は 作り物・手当／控除の 名目も「手当」「控除」（⑭）
//   ★物差し★
//     ① 「明細」の 右に「テンプレ」の タブ・押すと 5枚の 札（2列）・今の 払い方に ✓（この 見本は 月3回）
//     ② 札の 見本は 本物の 紙（data-paper）・縦の 紙の 形（月1回）は 縦（data-muki=tate）
//     ③ 札を 押しても 給料の 設定は 変わらない（タブも 移らない・倉庫へ 送らない）
//     ④「PDFで 見る」は 見本の 紙を PDF の 道具へ 渡す
//   ★★わざと壊して 赤（2026-10-23 手元 chromium 実測）★★ タブの ボタンを 消す ⇒ 4本 赤／見本を 組まない ⇒ ②④ 赤／
//     押しても 払い方の 欄に 入れない ⇒ ③ 赤／PDF の ボタンで 札の 選びを 止めない ⇒ ④ 赤／
//     欄を 触った 印（SHIME_SAWATTA）を 立てない ⇒ ⑤⑥ 赤（対立役 止1）／見本を 明細の CTX（今の 区切り だけ）で 組む ⇒ ⑦ 赤（対立役 止2）／
//     読む 範囲を 前の 月の 頭の 7日前に 戻す ⇒ ⑧ 赤（2026-08-25 ＞ 08-21・対立役 止A）／止める 門を 外す ⇒ ⑨ 赤／
//     見本の 材料が 読めなくても 出す ⇒ ⑩ 赤／見本の 字を 消す ⇒ ⑪ 赤（対立役 止C）／
//     札に 写しで なく 元の 紙を 置く ⇒ ⑫ 赤（3回目 止1）／見本の 材料の 止め（tomeZ）を 外す ⇒ ⑬ 赤（3回目 止2）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

async function tplWoHiraku(page) {
  await openKyuryo(page);
  await page.waitForTimeout(800);
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('#tabs .tab')].map((b) => b.textContent.trim())
  );
  expect(tabs.slice(0, 2), '★「明細」の 右に「テンプレ」が 無い★').toEqual(['明細', 'テンプレ']);
  await page.click('.tab[data-tab="tpl"]');
  await expect(page.locator('#paneTpl')).toBeVisible();
  await page.waitForTimeout(500);
}

test('① テンプレの タブ・種類ごとの 5枚の 札・今の 払い方に ✓', async ({ page }) => {
  await tplWoHiraku(page);
  const r = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#tplGrid .tpl-card')];
    return {
      n: cards.length,
      on: cards
        .filter((c) => c.classList.contains('on'))
        .map((c) => c.querySelector('.tpl-name').textContent),
      retsu: getComputedStyle(document.getElementById('tplGrid')).gridTemplateColumns.split(' ')
        .length,
    };
  });
  expect(r.n, '★札の 数★').toBe(5);
  expect(r.retsu, '★2列で ない★').toBe(2);
  expect(r.on, '★今の 払い方（月3回）に ✓ が 無い★').toEqual(['月3回（10日・20日・末日締め）']);
});

test('② 見本は 本物の 紙・月1回は 縦の 紙・10日ごとは 横の 紙', async ({ page }) => {
  await tplWoHiraku(page);
  const r = await page.evaluate(() =>
    [...document.querySelectorAll('#tplGrid .tpl-card')].map((c) => {
      const p = c.querySelector('[data-paper]');
      return {
        na: c.querySelector('.tpl-name').textContent,
        paper: !!p,
        muki: p ? p.getAttribute('data-muki') : null,
      };
    })
  );
  const by = (na) => r.find((x) => x.na === na);
  expect(r.filter((x) => x.paper).length, '★本物の 紙が 出て いない 札が 在る★').toBe(5);
  expect(by('月3回（10日・20日・末日締め）').muki).toBe('yoko');
  expect(by('月1回（末日締め）').muki, '★月1回の 見本が 縦の 紙で ない★').toBe('tate');
  expect(by('毎日').muki).toBe('tate');
});

// わざと壊す：札に 前の tplErabu（欄に 入れて 給料の 設定を 開く）を 戻す ⇒ 赤
test('③ 札を 押しても 給料の 設定は 変わらない（見るだけ）', async ({ page }) => {
  await tplWoHiraku(page);
  await page.evaluate(() => {
    window.__okutta = 0;
    const S = window.DKSession;
    const o = S.rest;
    S.rest = function (s, p, opt) {
      if (opt && opt.method && opt.method !== 'GET') window.__okutta++;
      return o.apply(this, arguments);
    };
  });
  const mae = await page.evaluate(() => document.getElementById('pMode').value);
  await page.locator('#tplGrid .tpl-card[data-shurui="tsuki1"] .tpl-name').click();
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    tab: document.querySelector('.tab.on').getAttribute('data-tab'),
    mode: document.getElementById('pMode').value,
    okutta: window.__okutta,
  }));
  expect(r.tab, '★押しただけで タブが 移った★').toBe('tpl');
  expect(r.mode, '★押しただけで 給料の 設定の 欄が 変わった★').toBe(mae);
  expect(r.okutta, '★押しただけで 倉庫へ 書いた★').toBe(0);
});

test('④ PDFで 見る は 見本の 紙を PDF の 道具へ 渡す（札は 選ばない）', async ({ page }) => {
  await tplWoHiraku(page);
  await page.evaluate(() => {
    window.__dasu = [];
    window.KamiEgaku = {
      yomu: () => Promise.resolve(),
      dasu: (mai, title) => {
        window.__dasu.push({ n: mai.length, title: title, muki: mai.map((m) => m.muki) });
        return Promise.resolve();
      },
    };
  });
  await page.locator('#tplGrid .tpl-card[data-shurui="tsuki1"]').locator('.tpl-pdf').click();
  await expect.poll(() => page.evaluate(() => window.__dasu.length), { timeout: 15000 }).toBe(1);
  const r = await page.evaluate(() => ({
    d: window.__dasu[0],
    tab: document.querySelector('.tab.on').getAttribute('data-tab'),
  }));
  expect(r.d.title).toContain('見本');
  expect(r.d.muki[0], '★月1回の PDF が 縦で ない★').toBe('tate');
  expect(r.tab, '★PDF を 押しただけで 選んで しまった★').toBe('tpl');
});

// ★★対立役 止2：見本は 今 開いて いる 区切り（10日）の 材料だけで 他の 区切りを 組んで いた＝額・時間が 足りない★★
//   倉庫を 本物と 同じく 日付で 絞る（試験の 倉庫は 絞らない＝空振り した）
test('⑦ 見本は 今の 区切りの 外の 日も 読んで 組む（月1回の 見本に 15日の 時数が 載る）', async ({
  page,
}) => {
  await openKyuryo(page, (f) => {
    const ym = f.workHours[0].work_date.slice(0, 8);
    const hito = [...new Set(f.workHours.map((w) => w.employee_id))];
    hito.forEach((id) =>
      f.workHours.push({
        work_date: ym + '15',
        employee_id: id,
        device_id: f.workHours[0].device_id,
        hours: 8,
      })
    );
    return f;
  });
  await page.evaluate(() => {
    const S = window.DKSession;
    const o = S.softList;
    // 日付の 条件（gte／lte／lt）を 本物の 倉庫と 同じく 守る
    S.softList = function (s, p, _st) {
      return o.apply(this, arguments).then((rows) => {
        const q = new URLSearchParams(String(p).split('?')[1] || '');
        const jo = [];
        q.forEach((v, k) => {
          const m = /^(gte|lte|lt)\.(.*)$/.exec(v);
          if (m && (k === 'work_date' || k === 'started_at'))
            jo.push([k, m[1], decodeURIComponent(m[2])]);
        });
        return (rows || []).filter((r) =>
          jo.every(([k, op, v]) => {
            const a = String(r[k] || '');
            if (!a) return true;
            const b = k === 'work_date' ? v : new Date(v).toISOString();
            const aa = k === 'work_date' ? a : new Date(a).toISOString();
            return op === 'gte' ? aa >= b : op === 'lte' ? aa <= b : aa < b;
          })
        );
      });
    };
  });
  // 明細の 材料を 日付で 絞った 倉庫から 読み直す（次の 月→前の 月）＝明細の CTX は 1〜10日 だけ に なる
  await page.click('#nextM');
  await page.waitForTimeout(800);
  await page.click('#prevM');
  await page.waitForTimeout(1200);
  await page.click('.tab[data-tab="tpl"]');
  await page.waitForFunction(
    () => {
      const c = [...document.querySelectorAll('#tplGrid .tpl-card')].find((x) =>
        x.textContent.includes('月1回（末日締め）')
      );
      return c && c.querySelector('[data-paper]');
    },
    null,
    { timeout: 10000 }
  );
  const r = await page.evaluate(() => {
    const c = [...document.querySelectorAll('#tplGrid .tpl-card')].find((x) =>
      x.textContent.includes('月1回（末日締め）')
    );
    const p = c.querySelector('[data-paper]');
    const tr = [...p.querySelectorAll('tbody tr')].find((x) =>
      /^15\(/.test((x.firstElementChild || {}).textContent.trim())
    );
    const ue = [...p.querySelectorAll('tbody tr')[0].children].map((x) => x.textContent.trim());
    const k = ue.findIndex((x) => x.startsWith('時間') && !x.includes('全台'));
    return tr ? tr.children[k].textContent.trim() : null;
  });
  expect(r, '★月1回の 見本に 今の 区切りの 外（15日）の 時数が 無い★').toBe('8.00');
});

// ★★対立役 止A：読む 範囲が 20日締め（締めた 日の 月の 分）の 前の 区切りを 覆わず 見本の 頭が 抜けた★★
test('⑧ 見本を 読む 範囲は 見本の どの 区切りも 覆う（2025〜2027 の 毎月）', async ({ page }) => {
  await openKyuryo(page);
  const r = await page.evaluate(() => {
    const P = window.__paper;
    let n = 0;
    const soto = [];
    for (let y = 2025; y <= 2027; y++) {
      for (let m = 1; m <= 12; m++) {
        const h = P.tplHani(y, m).hani;
        P.tplKiri(y, m).forEach((k) => {
          n++;
          if (k.start < h.kara || k.end > h.made)
            soto.push(y + '-' + m + ' ' + k.k + ' ' + k.start);
        });
      }
    }
    return { n, soto: soto.slice(0, 5), nSoto: soto.length };
  });
  expect(r.n, '★区切りを 数えて いない★').toBeGreaterThan(1000);
  expect(r.nSoto, '★範囲の 外の 区切り★ ' + r.soto.join(' / ')).toBe(0);
  // 本当に その 範囲で 読んで いるか（見本の 材料の 読みの 字を 見る）
  await page.evaluate(() => {
    window.__yomi = [];
    const S = window.DKSession;
    const o = S.softList;
    S.softList = function (s, p, _st) {
      window.__yomi.push(String(p));
      return o.apply(this, arguments);
    };
  });
  await page.click('.tab[data-tab="tpl"]');
  await page.waitForTimeout(800);
  const yomi = await page.evaluate(() => {
    const ji = document.getElementById('monthLabel').textContent;
    const m = /(\d{4})年\s*(\d+)月/.exec(ji);
    const y = +m[1];
    const mo = +m[2];
    const kiri = window.__paper.tplKiri(y, mo);
    const hayai = kiri.map((k) => k.start).sort()[0];
    const p = window.__yomi.find((x) => x.indexOf('dk_work_hours') === 0) || '';
    const g = /work_date=gte\.(\d{4}-\d{2}-\d{2})/.exec(p);
    return { hayai, gte: g ? g[1] : null };
  });
  expect(yomi.gte, '★見本の 材料を 読んで いない★').not.toBeNull();
  expect(
    yomi.gte <= yomi.hayai,
    '★読む 始まり ' + yomi.gte + ' が 一番 早い 区切り ' + yomi.hayai + ' より 後★'
  ).toBe(true);
});

// ★★対立役（空振り 2つ）：明細が 止まる 時・見本の 材料が 読めない 時は 見本を 出さない★★
test('⑨ 明細が 止まって いる（読めない 表が ある）時は 見本を 出さない', async ({ page }) => {
  await openKyuryo(page, (f) => {
    f.__yomenai = ['dk_pay_adjustments'];
    return f;
  });
  await page.click('.tab[data-tab="tpl"]');
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({
    paper: document.querySelectorAll('#tplGrid [data-paper]').length,
    ji: document.querySelector('#tplGrid .tpl-thumb').textContent,
  }));
  expect(r.paper, '★明細が 止まって いるのに 見本を 出した★').toBe(0);
  expect(r.ji).toContain('止まって');
});

test('⑩ 見本の 材料が 読めない 時は 見本を 出さない', async ({ page }) => {
  await openKyuryo(page);
  await page.evaluate(() => {
    // 明細は 読み終えた 後＝ここからの 読み（見本の 材料）を 全部 読めない 事に する
    const S = window.DKSession;
    S.softList = function (s, p, st) {
      if (st) {
        st.tried++;
        st.failed++;
      }
      return Promise.resolve([]);
    };
  });
  await page.click('.tab[data-tab="tpl"]');
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({
    paper: document.querySelectorAll('#tplGrid [data-paper]').length,
    ji: document.querySelector('#tplGrid .tpl-thumb').textContent,
  }));
  expect(r.paper, '★材料が 読めないのに 見本を 出した★').toBe(0);
  expect(r.ji).toContain('読めなかった');
});

// ★★対立役 止C：見本の 紙と PDF に「見本」の 字が 無く 本物の 明細と 区別 できなかった★★
test('⑪ 見本の 紙と PDF には「見本」の 字が 載る', async ({ page }) => {
  await tplWoHiraku(page);
  await page.evaluate(() => {
    window.__dasu = [];
    window.KamiEgaku = {
      yomu: () => Promise.resolve(),
      dasu: (mai) => {
        window.__dasu.push(
          mai.map((m) => m.el.textContent.indexOf('本物の 明細では ありません') >= 0)
        );
        return Promise.resolve();
      },
    };
  });
  const gamen = await page.evaluate(() =>
    [...document.querySelectorAll('#tplGrid [data-paper]')].map(
      (p) => p.textContent.indexOf('本物の 明細では ありません') >= 0
    )
  );
  expect(gamen.length).toBe(5);
  expect(gamen.every(Boolean), '★見本の 紙に「見本」が 無い★').toBe(true);
  await page.locator('#tplGrid .tpl-card[data-shurui="tsuki2"]').locator('.tpl-pdf').click();
  await expect.poll(() => page.evaluate(() => window.__dasu.length), { timeout: 15000 }).toBe(1);
  const pdf = await page.evaluate(() => window.__dasu[0]);
  expect(pdf.every(Boolean), '★見本の PDF に「見本」が 無い★').toBe(true);
});

// ★★対立役 止1（3回目）：札に 置いた 縮めた 紙を そのまま PDF へ 渡し 1枚目が 縮んで 崩れ、札の 見本も 消えた★★
test('⑫ PDFで 見る は 縮めて いない 紙を 渡し、押した 後も 札の 見本は 残る', async ({ page }) => {
  await tplWoHiraku(page);
  await page.evaluate(() => {
    window.__dasu = [];
    window.KamiEgaku = {
      yomu: () => Promise.resolve(),
      dasu: (mai) => {
        window.__dasu.push(
          mai.map((m) => ({ tf: m.el.style.transform || '', ue: !!m.el.closest('#tplGrid') }))
        );
        return Promise.resolve();
      },
    };
  });
  const card = page.locator('#tplGrid .tpl-card[data-shurui="tsuki2"]');
  await card.locator('.tpl-pdf').click();
  await expect.poll(() => page.evaluate(() => window.__dasu.length), { timeout: 15000 }).toBe(1);
  const d = await page.evaluate(() => window.__dasu[0]);
  d.forEach((x) => {
    expect(x.tf, '★PDF へ 縮めた 紙を 渡した★').toBe('');
    expect(x.ue, '★PDF へ 札の 中の 紙を 渡した★').toBe(false);
  });
  expect(await card.locator('[data-paper]').count(), '★PDF の 後に 札の 見本が 消えた★').toBe(1);
});

// ★★対立役 止2（3回目）：見本の 材料だけに 止めの 訳が 在る 時（今の 区切りの 外）に 見本を 出さない 門を 見張る★★
test('⑬ 見本の 材料に 計算 できない 所が ある 時は 見本を 出さない', async ({ page }) => {
  await openKyuryo(page);
  await page.evaluate(() => {
    // 明細は 計算 済み＝ここからの buildCtx（見本の 材料）だけ 役割の 決まりが 無い 事に する
    const P = window.PayrollDaily;
    const o = P.buildCtx;
    P.buildCtx = function () {
      const c = o.apply(this, arguments);
      c.yakuDameRiyuu = '見張り：役割の 決まりが 無い';
      return c;
    };
  });
  await page.click('.tab[data-tab="tpl"]');
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({
    paper: document.querySelectorAll('#tplGrid [data-paper]').length,
    ji: document.querySelector('#tplGrid .tpl-thumb').textContent,
  }));
  expect(r.paper, '★見本の 材料が 計算 できないのに 見本を 出した★').toBe(0);
  expect(r.ji).toContain('計算 できない');
});

// ★★見本に 本当の 名前を 載せない★★ 2026-10-24（司さん「テンプレに実名を勝手に使うな」）
//   わざと壊す：tplMihon で 名前を 替えない ⇒ 赤
test('⑭ 見本の 紙と PDF に 働く 人の 名前が 載らない（作り物の 名前だけ）', async ({ page }) => {
  await tplWoHiraku(page);
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll('#tplGrid [data-paper]').length), {
      timeout: 15000,
    })
    .toBe(5);
  const r = await page.evaluate(() => {
    const ji = [...document.querySelectorAll('#tplGrid [data-paper]')].map((p) => p.textContent);
    return { ji: ji };
  });
  // 見張りの 記録（tests/fixtures/kyuryo-real.json）の 働く 人の 名前
  const moto = ['テスト太郎', 'テスト次郎', 'テスト三郎', 'テスト四郎'];
  for (const t of r.ji) {
    for (const n of moto)
      expect(t.indexOf(n), '★見本に 働く 人の 名前「' + n + '」が 載った★').toBe(-1);
    expect(t, '★作り物の 名前が 無い★').toContain('見本 太郎');
  }
  await page.evaluate(() => {
    window.__dasu = [];
    window.KamiEgaku = {
      yomu: () => Promise.resolve(),
      dasu: (mai) => {
        window.__dasu.push(mai.map((m) => m.el.textContent).join('\n'));
        return Promise.resolve();
      },
    };
  });
  await page.locator('#tplGrid .tpl-card[data-shurui="tsuki1"] .tpl-pdf').click();
  await expect.poll(() => page.evaluate(() => window.__dasu.length), { timeout: 15000 }).toBe(1);
  const pdf = await page.evaluate(() => window.__dasu[0]);
  for (const n of moto) expect(pdf.indexOf(n), '★PDF に 名前「' + n + '」が 載った★').toBe(-1);
});
