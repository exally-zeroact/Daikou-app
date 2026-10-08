// tests/e2e/meter-ryokin-miru-dake.spec.js
// ★★メーターの 料金設定は「今の 料金表を 読むだけ」★★ 2026-09-01
//
//   ★司さん（2026-09-01）★
//     「事務所でやるならこの画面はメーターの方にいらんことないか？
//       追加や値引きとかは事務所でもメーターの方でも触れてええけど
//       ★料金表が見れたええやろ★」
//
//   ★はじめ 触れない 入力欄を そのまま 並べていました★（灰色で 押せないだけ）。
//   ⇒ ★意味が ありません★。入力欄は 出さず ★字で 読む★形に しました。
//
//   ★今の 形★
//     札は ★料金表／追加料金／値引き★ の 3つだけ
//     ・料金表 …… ★今 使っている 料金表を 字で 出す（読むだけ）★
//                  数字の 出どころは ★Meter.getFareConfig()★＝実際に 料金を 出している 物
//                  ⇒★画面の 数字と 使う 数字が ずれません★
//     ・追加料金／値引き … ★今まで通り 触れます★（料金表では なく 端末ごとの その場の ボタン）
//
//   ★★わざと壊して 実測（2026-09-01）★★
//     料金表の 札を 消す → ①が 赤／字を 出す 所を 消す → ②が 赤
//     入力欄を 戻す → ③が 赤／追加料金を 止める → ④が 赤／戻して 4本 緑

const { test, expect } = require('@playwright/test');

async function hiraku(page) {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.showOverlay('fare'));
  await page.waitForTimeout(500);
}

test('★① 札は 料金表／追加料金／値引き の 3つだけ★', async ({ page }) => {
  await hiraku(page);
  const t = await page.evaluate(() =>
    Array.prototype.slice
      .call(document.querySelectorAll('#overlayFare .tab-btn'))
      .map((b) => b.textContent.trim())
  );
  expect(t, '★料金表を 直す 札が 残っています（事務所からだけ の はず）★').toEqual([
    '料金表',
    '追加料金',
    '値引き',
  ]);
  const obi = await page.textContent('#overlayFare .miru-dake-obi');
  expect(obi, '★どこで 変えるか 書いていません★').toContain('事務所');
  expect(obi, '★追加料金が 触れる事を 書いていません★').toContain('追加料金');
});

test('★★② 今の 料金表が 字で 読める★★', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(() => {
    const g = Array.prototype.slice.call(document.querySelectorAll('#overlayFare .yomu-gyou'));
    return {
      kazu: g.length,
      moji: g.map((e) => e.textContent).join(' / '),
    };
  });
  expect(r.kazu, '★料金表が 1行も 出ていません★').toBeGreaterThan(3);
  expect(r.moji, '★最初の 料金が 出ていません★').toContain('最初の 料金');
  expect(r.moji, '★金額が 出ていません★').toMatch(/[0-9],?[0-9]*円/);
});

test('★★③ 料金表を 直す 入れる所が 1つも 無い★★', async ({ page }) => {
  await hiraku(page);
  const n = await page.evaluate(() => {
    const li = Array.prototype.slice.call(
      document.querySelectorAll(
        "#overlayFare .tab-pane:not([data-pane='extras']):not([data-pane='discounts']) input"
      )
    );
    return li.filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    }).length;
  });
  expect(n, '★料金表を 直す 入れる所が 出ています（メーターから 変えられます）★').toBe(0);
});

test('★★④ 追加料金・値引きは 今まで通り 触れる（止めすぎない）★★', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    document
      .querySelectorAll('#overlayFare .tab-pane')
      .forEach((p) => p.classList.remove('active'));
    const e = document.querySelector("#overlayFare .tab-pane[data-pane='extras']");
    if (e) {
      e.classList.add('active');
      e.style.display = '';
    }
  });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const b = document.querySelector("#overlayFare .tab-pane[data-pane='extras'] .btn-add");
    if (!b) return { aru: false };
    const box = b.getBoundingClientRect();
    return {
      aru: true,
      mieru: box.width > 0 && box.height > 0,
      oseru: getComputedStyle(b).pointerEvents !== 'none',
    };
  });
  expect(r.aru, '★追加料金の「足す」ボタンが 見つかりません★').toBe(true);
  expect(r.mieru, '★料金表では ない物まで 隠しています★').toBe(true);
  expect(r.oseru, '★料金表では ない物まで 止めています★').toBe(true);
});

test('★★⑤ 箱は 1つ・「最後に 変えた人」は 出さない★★', async ({ page }) => {
  // ★司さん 2026-09-01「この赤丸いらんことない？」★
  //   ・「最後に 変えた人」… ★メーターからは もう 変えられない★ので 運転手には 要らない
  //   ・「いつ 取ったか」… ★残す★（古い 料金表で 走っていないかは 大事）
  //   ⇒ ★箱を 2つ 出さず、料金表の 札の 中に 1行★
  await hiraku(page);
  const r = await page.evaluate(() => {
    const e = document.getElementById('_fare_itsuno');
    const kado = e ? e.closest('.card') : null;
    return {
      aru: !!e,
      naka: !!kado, // ★料金表の 札の 中に 居るか★
      moji: e ? e.textContent : '',
    };
  });
  expect(r.aru, '★「いつ 取ったか」が 消えています（古い 料金表に 気づけません）★').toBe(true);
  expect(r.naka, '★箱が 札の 外に 出ています（箱が 2つに なります）★').toBe(true);
  expect(r.moji, '★「最後に 変えた人」を まだ 出しています★').not.toContain('最後に変えた人');
  expect(r.moji, '★いつの 料金表か 言っていません★').toContain('料金表');
});

// ★★⑥⑦ は 司さん 2026-09-01「前にあった何キロ走ったら何円の料金一覧表は？」で 戻した★★
//   ★前は「確認」の 札に 在りました★。札を 3つに 減らした時に 一緒に 隠していました。
//   ⇒ ★料金表の 札に 戻しました★。★計算は js/fare-calc.js（メーターの 料金と 同じ 1か所）★。
//   （前の 表は index.html の 中に ★もう1つ 計算を 持っていました★＝2か所に なると ずれる）
test('★★⑥ 距離別の 料金の 表が 出る（何km で いくら）★★', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(() => {
    const rows = Array.prototype.slice.call(document.querySelectorAll('#_fare_kmhyou tr'));
    return {
      kazu: rows.length,
      atama: rows[0] ? rows[0].textContent : '',
      owari: rows.length ? rows[rows.length - 1].textContent : '',
    };
  });
  expect(r.kazu, '★距離別の 料金の 表が 出ていません★').toBeGreaterThan(10);
  expect(r.atama, '★1行目に 距離が ありません★').toMatch(/km|m/);
  expect(r.atama, '★1行目に 金額が ありません★').toMatch(/円/);
  expect(r.owari, '★最後の 行に 金額が ありません★').toMatch(/円/);
});

test('★★⑦ 表の 金額が 料金の 部品と 1円も 違わない★★', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(() => {
    const rows = Array.prototype.slice.call(document.querySelectorAll('#_fare_kmhyou tr'));
    const c = Meter.getFareConfig();
    const now = new Date();
    const gamen = [];
    const buhin = [];
    const base = typeof c.base_distance_m === 'number' ? c.base_distance_m : 1000;
    const add = c.add_distance_m > 0 ? c.add_distance_m : 420;
    rows.forEach((tr, i) => {
      const d = base + add * i;
      if (d > 22000) return;
      gamen.push(tr.children[1].textContent.replace(/[^0-9]/g, ''));
      /* global FareCalc */
      buhin.push(String(FareCalc.keisan(d, c, null, new Set(), 0, now)));
    });
    return { gamen, buhin };
  });
  expect(r.gamen.length, '★比べる 行が ありません★').toBeGreaterThan(10);
  expect(r.gamen, '★表の 金額が 料金の 部品と 違います★').toEqual(r.buhin);
});

test('★★⑧ 1行目が 見出しに かぶっていない★★', async ({ page }) => {
  // ★実際に 踏みました★… テスト用の 帯が「貼り付く物」を 下げるので、
  //   ★箱の 中で 貼り付いている 見出しまで 下がり 1行目に かぶっていました★。
  await hiraku(page);
  const kabu = await page.evaluate(() => {
    const th = document.querySelector('#overlayFare .preview-table th');
    const r1 = document.querySelector('#_fare_kmhyou tr');
    if (!th || !r1) return null;
    return Math.round(th.getBoundingClientRect().bottom - r1.getBoundingClientRect().top);
  });
  expect(kabu, '★見出しと 1行目が 見つかりません★').not.toBeNull();
  expect(kabu, '★見出しが 1行目に かぶっています（1行目が 読めません）★').toBeLessThanOrEqual(1);
});

// ★★⑨⑩ 追加料金・値引きは 残る／料金表は 書かない（2026-10-09）★★
//   ★実測（直す前）★ 追加料金に「迎車料金 1000円」を 足して 開き直すと ★0件★
//     （09-01 に 保存ボタンを 隠してから、ここで 直した 物は どこにも 書かれていなかった）。
//   ★もう1つの 穴（対立役）★ saveAll は 隠れた 入力欄から 料金表を 組み直し ★倉庫へ 丸ごと 書いていた★
//     ＝端末の 写しが 古いと 事務所で 後から 入れた 期間の割増・重なり・下限などを 上書き。
//   ★司さん 2026-09-01★「追加や値引きとかは事務所でもメーターの方でも触れてええけど」
//                      「事務所からだけにしたんやないんか」（料金表）
test('★★⑨ 追加料金・値引きは 直した その場で 残る（開き直しても 在る）★★', async ({ page }) => {
  await hiraku(page);
  await page.click("#overlayFare .tab-btn[data-tab='extras']");
  await page.click("#overlayFare .tab-pane[data-pane='extras'] .btn-add");
  await page.fill('#_fare_extraItems .extra-name', '迎車料金');
  await page.fill('#_fare_extraItems .extra-amount', '1000');
  await page.click("#overlayFare .tab-btn[data-tab='discounts']");
  await page.click("#overlayFare .tab-pane[data-pane='discounts'] .btn-add");
  await page.fill('#_fare_discountItems .extra-name', '常連');
  await page.fill('#_fare_discountItems .extra-amount', '500');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    ex: JSON.parse(localStorage.getItem('daikou_extras') || '[]'),
    di: JSON.parse(localStorage.getItem('daikou_discounts') || '[]'),
  }));
  expect(r.ex, '★足した 追加料金が 開き直すと 消えています★').toEqual([
    { name: '迎車料金', amount: 1000 },
  ]);
  expect(r.di, '★足した 値引きが 開き直すと 消えています★').toEqual([
    { name: '常連', amount: 500 },
  ]);
  // ★業務画面の「追加料金を選ぶ」が 読む 所と 同じ 鍵か★も 開いて 見る
  await page.evaluate(() => window.showOverlay('fare'));
  await page.waitForTimeout(500);
  const n = await page.evaluate(
    () => document.querySelectorAll('#_fare_extraItems .extra-item').length
  );
  expect(n, '★開き直した 画面に 追加料金が 出ていません★').toBe(1);
});

test('★★⑩ 料金設定から 料金表を 倉庫へ 書かない・写しも 変えない★★', async ({ page }) => {
  const UTSUSHI = {
    config: {
      version: 2,
      base_fare: 1300,
      base_distance_m: 1000,
      add_fare: 100,
      add_distance_m: 420,
      rounding: 10,
      autoSurcharges: {
        night: { enabled: false, from: 22, to: 5, rate: 1.2 },
        weekend: { enabled: false, rate: 1.1 },
        winter: { enabled: false, from: '12-15', to: '03-15', rate: 1.1 },
        kikan: [{ name: 'GW', from: '04-29', to: '05-05', rate: 1.2 }],
        kasanari: 'ookii',
      },
    },
    updated_at: '2026-10-01T00:00:00.000Z',
    totta_at: '2026-10-08T00:00:00.000Z',
    updated_by: 'office',
  };
  await page.addInitScript((u) => {
    localStorage.setItem('dk_license_company', 'tok-test');
    localStorage.setItem('DAIKOME_DEVICE_ID', 'dev-test');
    localStorage.setItem('dk_fare_config_cache', JSON.stringify(u));
  }, UTSUSHI);
  const kaita = [];
  await page.route('**/dk-fare-config**', async (route) => {
    let b = {};
    try {
      b = JSON.parse(route.request().postData() || '{}');
    } catch (_) {}
    if (Object.prototype.hasOwnProperty.call(b, 'config')) kaita.push(b);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        config: UTSUSHI.config,
        updated_at: UTSUSHI.updated_at,
        updated_by: 'office',
      }),
    });
  });
  await hiraku(page);
  // 客が 触れる 所を 全部 触る（追加料金・値引き）＋ 隠れた 保存も 呼ぶ（古い 道の 守り）
  await page.click("#overlayFare .tab-btn[data-tab='extras']");
  await page.click("#overlayFare .tab-pane[data-pane='extras'] .btn-add");
  await page.fill('#_fare_extraItems .extra-amount', '1000');
  await page.evaluate(() => window._fare_saveAll());
  await page.waitForTimeout(1500);
  const ato = await page.evaluate(() => JSON.parse(localStorage.getItem('dk_fare_config_cache')));
  expect(kaita.length, '★料金表を 倉庫へ 書きました（事務所からだけ の はず）★').toBe(0);
  expect(ato.updated_at, '★写しの 時刻が 消されました★').toBe(UTSUSHI.updated_at);
  expect(ato.config.autoSurcharges.kikan, '★期間の割増が 写しから 消えました★').toEqual(
    UTSUSHI.config.autoSurcharges.kikan
  );
});

// ★★⑪⑫ 保存を 足した 8か所を 1つずつ 守る（対立役 2026-10-09：⑨は 金額の 2か所しか 赤に ならなかった）★★
//   ⑪ 足す（＋ 項目を追加）・名前を 後から 直す … 足すだけで 残るか／名前だけの 変更が 残るか
//   ⑫ 消す … 消した物が 開き直すと 戻って「選ぶ」に 出続けないか（お金の 項目が 消えない 形）
for (const [fuda, hako, kagi] of [
  ['extras', '#_fare_extraItems', 'daikou_extras'],
  ['discounts', '#_fare_discountItems', 'daikou_discounts'],
]) {
  test(`★★⑪ ${fuda}：足すだけで 残る・名前を 後から 直しても 残る★★`, async ({ page }) => {
    await hiraku(page);
    await page.click(`#overlayFare .tab-btn[data-tab='${fuda}']`);
    await page.click(`#overlayFare .tab-pane[data-pane='${fuda}'] .btn-add`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const a = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), kagi);
    expect(a.length, '★「＋ 項目を追加」だけでは 残っていません★').toBe(1);
    await page.evaluate(() => window.showOverlay('fare'));
    await page.waitForTimeout(500);
    await page.click(`#overlayFare .tab-btn[data-tab='${fuda}']`);
    await page.fill(`${hako} .extra-amount`, '700');
    await page.fill(`${hako} .extra-name`, 'あとの名前');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const b = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), kagi);
    expect(b, '★金額の 後に 直した 名前が 残っていません★').toEqual([
      { name: 'あとの名前', amount: 700 },
    ]);
  });

  test(`★★⑫ ${fuda}：消した物は 開き直しても 戻らない★★`, async ({ page }) => {
    await page.addInitScript(
      ([k]) => {
        if (!sessionStorage.getItem('_seeded')) {
          localStorage.setItem(
            k,
            JSON.stringify([
              { name: 'のこす', amount: 100 },
              { name: 'けす', amount: 200 },
            ])
          );
          sessionStorage.setItem('_seeded', '1');
        }
      },
      [kagi]
    );
    await hiraku(page);
    await page.click(`#overlayFare .tab-btn[data-tab='${fuda}']`);
    await page.locator(`${hako} .extra-del`).nth(1).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const r = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), kagi);
    expect(r, '★消した 項目が 開き直すと 戻っています★').toEqual([{ name: 'のこす', amount: 100 }]);
  });
}
