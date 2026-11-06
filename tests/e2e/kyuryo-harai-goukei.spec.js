// ============================================================
// ★★見張り：給料の 画面の 上に「その 期に 渡す 給料の 合計」★★ 2026-11-06
//
//   司さん「赤丸のところがいらないから ここに 1〜10や 11〜20など 切り替える度に
//           その時に 渡す 給料の 合計を 出して欲しい」
//   ★赤丸★ #printCard（明細を PDFで 見る・給料表（まとめた表）を 出す）＝消した
//   ★今★ #haraiCard＝REP.harai（明細の 差引支給を 人ごとに 丸めて 全員 足した 額）
//
//   ★押す物の一覧（先に書く）★ 期の 札 3つ（data-pidx 0/1/2）・名前の 選ぶ欄
//
//   ① 期を 替える たびに 額と 期の 字が 替わる（額は 手で 測った 固い 数・下の「みんなの給料」とも 同じ）
//   ② 手当・控除が 読めない ⇒ 出さない（控除の 抜けた 額を 出さない・設計前 対立役 止1）
//   ③ 期を 替えた 読み込み中（名前を 選び直しても）⇒ 出さない（前の 期の 額を 新しい 期の 字で 出さない・止2）
//   （計算 できない 人＝kyuryo-meisai-tomeru／保存中＝kyuryo-hozon-zero ㉕／本人の 画面＝kyuryo-honnin ③⑥）
//
//   ★わざと壊して 赤に なるのを 見た★（下の 各 test の 頭に 書く）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

test.use({ timezoneId: 'Asia/Tokyo' });

// ★11〜20日にも 働いた 日を 足す★（材料は 1日・2日 だけ＝2つ目・3つ目の 期が ¥0 で 替わっても 見分けにくい）
//   1日の 勤務・時数だけを 12日へ 写す（2日は 写さない＝1つ目の 期と 違う 額に なる）
function juniNichiMo(f) {
  const hi12 = (v) =>
    typeof v === 'string' && v.slice(8, 10) === '01' ? v.slice(0, 8) + '12' + v.slice(10) : null;
  (f.shifts || []).slice().forEach((x, i) => {
    const a = hi12(x.started_at);
    if (a)
      f.shifts.push({
        ...x,
        shift_id: '00000000-0000-4000-a000-9999000000' + String(10 + i),
        started_at: a,
        ended_at: hi12(x.ended_at) || x.ended_at,
      });
  });
  (f.workHours || []).slice().forEach((x) => {
    const a = hi12(x.work_date);
    if (a) f.workHours.push({ ...x, work_date: a });
  });
  return f;
}

function minnaNo(t) {
  const m = /みんなの給料 ¥([0-9,]+)/.exec(t || '');
  return m ? '¥' + m[1] : null;
}

// ①
//   わざと壊す：haraiNuru の yen(REP.harai) を yen(REP.staffTotalAll) に ⇒ 赤（固い 数と 違う）
//   わざと壊す：renderSlips の 頭の haraiNuru() を 外す ⇒ 赤（期を 替えても 出ない）
test('① 期を 替える たびに その 期に 渡す 給料の 合計が 出る', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await openKyuryo(page, juniNichiMo);
  await page.waitForTimeout(800);
  const card = page.locator('#haraiCard');
  await expect(card).toHaveCount(1);
  const mita = [];
  for (const pidx of [0, 1, 2]) {
    await page.click('[data-pidx="' + pidx + '"]');
    await page.waitForFunction(() => !document.getElementById('haraiCard').hidden, null, {
      timeout: 15000,
    });
    const r = await page.evaluate(() => ({
      ki: document.getElementById('haraiKi').textContent,
      gaku: document.getElementById('haraiGaku').textContent,
      note: document.getElementById('haraiNote').textContent,
      range: (document.querySelector('#monthLabel .mb-2') || {}).textContent || '',
      shita: (document.querySelector('#slips') || {}).innerText || '',
      ninzu: document.querySelectorAll('#slips .slip').length,
    }));
    mita.push({ pidx, ki: r.ki, gaku: r.gaku, note: r.note, ninzu: r.ninzu });
    expect(r.range, '★期の 字が 読めない＝この 見張りは 何も 見ていない★').not.toBe('');
    expect(r.ki, '★期を 替えても 合計の 期の 字が 替わらない★').toBe(
      r.range + ' の 分　全員に 渡す 給料'
    );
    expect(r.gaku, '★下の「みんなの給料」と 違う★').toBe(minnaNo(r.shita));
    expect(r.note).toBe(r.ninzu + '人ぶん（明細の 差引支給の 合計）');
  }
  // eslint-disable-next-line no-console
  console.log('★合計★ ' + JSON.stringify(mita));
  // ★固い 数★（試験の 材料 tests/fixtures/kyuryo-real.json から 出る 額・2026-11-06 に 測った）
  expect(mita.map((x) => x.gaku)).toEqual(KITAI);
  await expect(card).toBeVisible();
  expect(err, '★画面が 落ちた★').toEqual([]);
});

// ②
//   わざと壊す：haraiNuru の DKSession.loadFailed(LOAD) を 外す ⇒ 赤（控除の 抜けた 額が 出る）
test('② 手当・控除が 読めない ⇒ 合計を 出さない', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page, (f) => {
    f.__yomenai = ['dk_pay_adjustments'];
    return f;
  });
  await page.waitForTimeout(1200);
  // 明細は 描かれている（止めて いるのは 合計と PDF だけ）＝空回りで ない 事を 先に 見る
  expect(
    await page.locator('#slips .slip').count(),
    '★明細が 無い＝何も 見ていない★'
  ).toBeGreaterThan(0);
  expect(await page.locator('#dkUnknownBar').count(), '★読めなかった 帯が 無い★').toBeGreaterThan(
    0
  );
  await expect(page.locator('#haraiCard')).toHaveCount(1);
  await expect(page.locator('#haraiCard'), '★読めないのに 合計を 出した★').toBeHidden();
  expect(err).toEqual([]);
});

// ③
//   わざと壊す：haraiNuru の LP_YOMICHU を 外す ⇒ 赤（読み込み中に 名前を 選ぶと 前の 期の 額が 新しい 期の 字で 出る）
//   わざと壊す：loadPeriod の 頭の haraiKakusu() を 外す ⇒ 赤（前の 期の 額が 残る）
test('③ 期を 替えた 読み込み中は（名前を 選び直しても）合計を 出さない・読み終われば 出る', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page, (f) => {
    f.__osoi = ['dk_shifts'];
    return f;
  });
  await page.waitForFunction(() => !document.getElementById('haraiCard').hidden, null, {
    timeout: 20000,
  });
  const mae = await page.locator('#haraiGaku').textContent();
  await page.click('[data-pidx="1"]');
  await page.waitForTimeout(200);
  const yomichu1 = await page.locator('#haraiCard').isVisible();
  // 読み込み中に 名前を 選び直す（renderSlips が 前の REP で 走る 道）
  await page.evaluate(() => {
    const s = document.getElementById('hitoSel');
    if (s && s.options.length > 1) {
      s.selectedIndex = 1;
      s.dispatchEvent(new Event('change'));
    }
  });
  await page.waitForTimeout(200);
  const yomichu2 = await page.locator('#haraiCard').isVisible();
  // eslint-disable-next-line no-console
  console.log('★読み込み中★ ' + JSON.stringify({ mae, yomichu1, yomichu2 }));
  expect(yomichu1, '★期を 替えた 読み込み中に 前の 期の 額が 残った★').toBe(false);
  expect(yomichu2, '★読み込み中に 名前を 選ぶと 前の 期の 額が 出た★').toBe(false);
  // 読み終われば 出る（止めっぱなしに しない）
  await page.waitForFunction(() => !document.getElementById('haraiCard').hidden, null, {
    timeout: 20000,
  });
  const ki = await page.locator('#haraiKi').textContent();
  const range = await page.locator('#monthLabel .mb-2').textContent();
  expect(ki).toBe(range + ' の 分　全員に 渡す 給料');
  expect(err).toEqual([]);
});

// ★固い 数★（①）
const KITAI = ['¥36,900', '¥16,000', '¥0']; // 2026-11-06 測った（1〜10日＝1日・2日／11〜20日＝12日に 写した 1日分／21日〜＝無し）

// ④ 差引支給が マイナスの 人が 居る ⇒ 額は「みんなの給料」と 同じ（変えない）・字で 一言（作った後 対立役 注2）
//   わざと壊す：haraiNuru の minus の 一言を 外す ⇒ 赤
test('④ マイナスの 人が 居る ⇒ 額は 下と 同じ・「マイナスの 人 1人を 含みます」', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page, (f) => {
    const w = f.workHours[0];
    f.adjustments = [
      {
        adj_id: 'm1',
        employee_id: w.employee_id,
        work_date: w.work_date,
        kind: 'koujo',
        label: '前借り',
        yen: 25000, // その 人は マイナス・全員の 合計は プラス
      },
    ];
    return f;
  });
  await page.waitForFunction(() => !document.getElementById('haraiCard').hidden, null, {
    timeout: 20000,
  });
  const r = await page.evaluate(() => ({
    gaku: document.getElementById('haraiGaku').textContent,
    note: document.getElementById('haraiNote').textContent,
    shita: document.getElementById('slips').innerText,
  }));
  // eslint-disable-next-line no-console
  console.log('★マイナス★ ' + JSON.stringify({ gaku: r.gaku, note: r.note }));
  expect(r.shita, '★マイナスの 人の 知らせが 無い＝材料が 効いていない★').toContain(
    '差引 支給が マイナスの 人'
  );
  expect(r.gaku).toBe(minnaNo(r.shita));
  expect(r.note).toContain('差引支給が マイナスの 人 1人を 含みます');
  expect(err).toEqual([]);
});

// ⑤「もう一度読む」の 返り待ちの 間（読めなかった 時に 組んだ 明細の まま）は 名前を 選び直しても 出さない・PDF も 作らない
//   （作った後 対立役 注1：前は loadMasters の 頭で 読めなかった 数を 0 に して 門が 開いた）
//   わざと壊す：loadMasters の 頭で LOAD.tried = 0; LOAD.failed = 0; に 戻す ⇒ 赤
test('⑤ 読めなかった 後の 読み直し中は 名前を 選び直しても 合計も PDF も 出さない', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await openKyuryo(page, (f) => {
    f.__yomenai = ['dk_device_labels'];
    return f;
  });
  await page.waitForTimeout(1200);
  await expect(page.locator('#haraiCard'), '★読めないのに 出た（前提）★').toBeHidden();
  expect(
    await page.locator('#slips .slip').count(),
    '★明細が 無い＝何も 見ていない★'
  ).toBeGreaterThan(0);
  // 読み直しは 車の 名前を 3秒 遅れて 読めた 事に する
  await page.evaluate(() => {
    const S = window.DKSession;
    const moto = S.softList;
    S.softList = function (s, p, st) {
      if (String(p).indexOf('dk_device_labels') === 0) {
        if (st) st.tried++;
        return new Promise((ok) => setTimeout(() => ok([]), 3000));
      }
      return moto.apply(this, arguments);
    };
    window.__dasu = 0;
    if (window.KamiEgaku && window.KamiEgaku.dasu) {
      window.KamiEgaku.dasu = function () {
        window.__dasu++;
        return Promise.resolve({ mai: 1, size: 1 });
      };
    }
  });
  // 帯の「もう一度読む」を 押す（期間に 関係ない 物が 読めなかった＝loadMasters から 読み直す）
  await page.locator('#dkUnknownBar button', { hasText: 'もう一度読む' }).click();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const s = document.getElementById('hitoSel');
    s.selectedIndex = 1;
    s.dispatchEvent(new Event('change'));
    s.selectedIndex = 0;
    s.dispatchEvent(new Event('change'));
    window.printAll(null);
  });
  await page.waitForTimeout(300);
  const naka = await page.evaluate(() => ({
    mieru: !document.getElementById('haraiCard').hidden,
    msg: (document.getElementById('msg') || {}).textContent || '',
    dasu: window.__dasu,
  }));
  // eslint-disable-next-line no-console
  console.log('★読み直し中★ ' + JSON.stringify(naka));
  expect(naka.mieru, '★読み直し中に 読めなかった 時の 合計が 出た★').toBe(false);
  expect(naka.msg, '★読み直し中に PDF を 作り始めた★').not.toContain('PDFを作っています');
  expect(naka.dasu).toBe(0);
  // 読めたら 出る
  await page.waitForFunction(() => !document.getElementById('haraiCard').hidden, null, {
    timeout: 20000,
  });
  expect(err).toEqual([]);
});
