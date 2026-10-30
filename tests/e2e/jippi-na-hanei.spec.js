// ============================================================
// ★★会社設定の「実費」の 名前を 売上表と 月次集計に 出す★★ 2026-10-20
//   司さん「会社の設定で経費に設定しとんのになんで売上表のページでいつまでも高速代、橋代、その他になっとんど」
//         「会社で設定したものがここや月次などに反映されるんやろが」
//
//   ★前★ 売上表の「売上から引くもの」は 字で「高速代・橋代・その他」固定（uriage.html）。
//         月次集計の 紙は 実費の 一覧を 読まず null を 渡して いた＝古い 3つの 名前で 刷った（shukei.html）。
//   ★今★ どちらも 会社設定の 一覧（dk_expense_kinds）の 名前。消した 物は 出さない。
//         会社が 足した 物は いつも 引く（js/uriage-agg.js deductOf）。
//   ★2026-10-24 件J★ 入れた 実費は 全部 引く＝「引く／引かない」の チェックは 消した。
//         売上表の「売上から引くもの」は 名前を 並べる 字（#dHiku）だけ。⑤（記録の 一覧）は 記録ごと 外した。
//         ★お金は 1円も 変えない★（引く 額・引く 物は 前と 同じ）
//
//   材料＝本番の ZERO代行 と 同じ 形（2026-10-20 SELECT で 見た）：
//     toll「高速代」消した／bridge「経費」生きている／other「その他」消した（使う 外し）
//
//   ★物差し★
//     ① 売上表：出る 名前は「経費」だけ・押せる 欄は 無い
//     ② 売上表：会社が 足した 物も 名前が 並ぶ（いつも 引く）
//     ③ 売上表：一覧が 読めない（空）⇒ 今までの 3つ
//     ④ 売上表：紙の 数字は 一覧が 有っても 無くても 同じ（お金を 変えない）
//     ⑥ 月次集計の 紙：引いた 実費の 名前が「経費」・数字は 一覧が 無い 時と 同じ
//     ⑦ 売上表「日ごと ▾（実費を 入れる）」の 欄も「経費」だけ・打つと bridge_yen に 入る
//     ⑧ 消した 物でも その 月に 額が 在れば 隠さない（隠れたまま 引かれる 事を 作らない）
//     ⑨ 月次集計の 画面の 内わけ：「経費（高速・橋など）」で なく 会社の 名前
//     ⑩ 月次集計の 紙：全部 消した 会社は 古い 3つの 名前を 刷らない
//     ⑪ 一覧に 古い 3つの 行が 無く 額が 在る ⇒ 引く 物の 名前・日ごとの 欄・道順の 字が 揃って 出る
//     ⑫ 全部 消した 会社に 額が 在る ⇒ 月次の 紙は その 名前を 刷る（引いた 額と 名前を 揃える）
//     ⑬ 消した 物の 欄に 0 を 打っても その 場では 欄が 消えない（打ち直せる）
//     ⑭「使う」を 外した 物（消していない）は 日ごとの 欄に 出さない（入力の 画面と 同じ）
//   わざと壊す：hikiNaNuru を 呼ばない ⇒ ①② 赤／shukei の 紙に null を 渡す ⇒ ⑥ 赤／
//              shiftLine を 前の 固定に 戻す ⇒ ⑦ 赤／消した 物は 額が 在っても 隠す ⇒ ⑧ 赤
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = '11111111-2222-3333-4444-555555555555';
test.use({ timezoneId: 'Asia/Tokyo' });

const SHIFTS = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-01-05T20:00:00+09:00',
    ended_at: '2026-01-06T04:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 40000,
    trip_count: 12,
    actual_total_m: 80000,
    total_distance_m: 150000,
  },
  {
    shift_id: 's2',
    device_id: 'd2',
    started_at: '2026-01-06T20:00:00+09:00',
    ended_at: '2026-01-07T04:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 25000,
    trip_count: 8,
    actual_total_m: 50000,
    total_distance_m: 90000,
  },
];
// 経費（bridge の 列）2,220 と 1,520
const EDITS = [
  { shift_id: 's1', toll_yen: 0, bridge_yen: 2220, other_yen: 0, hours: 8 },
  { shift_id: 's2', toll_yen: 0, bridge_yen: 1520, other_yen: 0, hours: 8 },
];
const LABELS = [
  { device_id: 'd1', label: '4987', sort_order: 1 },
  { device_id: 'd2', label: '1466', sort_order: 2 },
];
const ZERO_KINDS = [
  {
    kind_id: 'toll',
    label: '高速代',
    sort_order: 10,
    active: true,
    deleted_at: '2026-10-05T06:43:00Z',
  },
  { kind_id: 'bridge', label: '経費', sort_order: 20, active: true, deleted_at: null },
  {
    kind_id: 'other',
    label: 'その他',
    sort_order: 30,
    active: false,
    deleted_at: '2026-09-18T15:05:24Z',
  },
];
// kaisha_shime_hi＝会社の 締め日（倉庫の 列・null＝末日）2026-10-24＝列が 無い 行は 月次集計が 止める（読めない 締め日を 末日に 倒さない）
const SETTINGS = [
  {
    company_id: CO,
    deduct_toll: true,
    deduct_bridge: true,
    deduct_other: false,
    kaisha_shime_hi: null,
  },
];

function tsukuru(o) {
  const x = o || {};
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  const hyou = {
    dk_shifts: SHIFTS,
    dk_shift_edits: EDITS,
    dk_device_labels: LABELS,
    dk_sales_settings: SETTINGS,
    dk_expense_kinds: x.kinds || [],
  };
  if (x.edits) hyou.dk_shift_edits = x.edits;
  return (
    moto +
    ';(function(){var S=window.DKSession;var co=' +
    JSON.stringify(co) +
    ';var T=' +
    JSON.stringify(hyou) +
    ';window.__okutta=[];' +
    // 業務は 問い合わせの 月で 絞る（⑰＝月を 替えた 時を 見る 為）
    'function rows(p){var na=String(p).split("?")[0];var l=T[na]||[];if(na==="dk_shifts"){var g=/started_at=gte\\.([^&]+)/.exec(p);var t=/started_at=lt\\.([^&]+)/.exec(p);if(g&&t){var a=new Date(decodeURIComponent(g[1])).getTime(),z=new Date(decodeURIComponent(t[1])).getTime();l=l.filter(function(x){var v=new Date(x.started_at).getTime();return v>=a&&v<z;});}}return l;}' +
    'S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){var m=(o&&o.method)||"GET";if(m!=="GET"){var b=null;try{b=JSON.parse(o.body);}catch(_){}window.__okutta.push({p:String(p),m:m,b:b});return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve([{}]);}});}return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function uriage(page, o) {
  await page.clock.setFixedTime(new Date('2026-01-20T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(o),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/uriage.html', { waitUntil: 'domcontentloaded' });
  const kami = page.locator('#kamiMado .kami-mise-waku');
  await expect(kami.first(), '★紙が 出ない★').toBeVisible({ timeout: 15000 });
  return page.evaluate(() => {
    const mieru = (el) => !!el && el.offsetParent !== null;
    const row = document.getElementById('dHiku');
    return {
      na: mieru(row) ? row.textContent.split('・').map((t) => t.trim()) : [],
      // 引く／引かないを 選ぶ 欄は 無い（2026-10-24 件J）
      oseru: document.querySelectorAll('.setrow input').length,
      kami: (document.querySelector('#kamiMado .kami-mise-waku').textContent || '').replace(
        /\s+/g,
        ' '
      ),
    };
  });
}

test('① 売上表：出る 名前は 会社設定の「経費」だけ・押せる 欄は 無い', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  const r = await uriage(page, { kinds: ZERO_KINDS });
  // eslint-disable-next-line no-console
  console.log('★①★ ' + JSON.stringify({ na: r.na, oseru: r.oseru }));
  expect(r.na, '★会社設定の 名前で ない★').toEqual(['経費']);
  expect(r.oseru, '★引く／引かないを 選ぶ 欄が 在る★').toBe(0);
  expect(err).toEqual([]);
});

test('② 売上表：会社が 足した 物も 名前が 並ぶ（いつも 引く）', async ({ page }) => {
  const r = await uriage(page, {
    kinds: ZERO_KINDS.concat([
      { kind_id: 'p1', label: '駐車場代', sort_order: 40, active: true, deleted_at: null },
      {
        kind_id: 'p2',
        label: '消した物',
        sort_order: 50,
        active: true,
        deleted_at: '2026-10-01T00:00:00Z',
      },
    ]),
  });
  // eslint-disable-next-line no-console
  console.log('★②★ ' + JSON.stringify({ na: r.na }));
  expect(r.na).toEqual(['経費', '駐車場代']);
  expect(r.oseru).toBe(0);
});

test('③ 売上表：一覧が 読めない（空）⇒ 今までの 3つ', async ({ page }) => {
  const r = await uriage(page, { kinds: [] });
  // eslint-disable-next-line no-console
  console.log('★③★ ' + JSON.stringify({ na: r.na }));
  expect(r.na).toEqual(['高速代', '橋代', 'その他']);
});

test('④ 売上表：紙の 数字は 一覧が 有っても 無くても 同じ（お金を 変えない）', async ({ page }) => {
  const ari = await uriage(page, { kinds: ZERO_KINDS });
  const page2 = await page.context().newPage();
  const nashi = await uriage(page2, { kinds: [] });
  const kazu = (t) => (t.match(/\d{1,3}(,\d{3})+/g) || []).join(' ');
  // eslint-disable-next-line no-console
  console.log('★④★ ' + kazu(ari.kami));
  // (40000−2220)+(25000−1520)＝61,260／実費 3,740
  expect(ari.kami).toContain('61,260');
  expect(ari.kami).toContain('3,740');
  expect(kazu(ari.kami), '★一覧で 数字が 変わった★').toBe(kazu(nashi.kami));
});

async function getsujiKami(page, o) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(o),
    })
  );
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#kamiCard').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.__kami = [];
    window.KamiPdf.dasu = function (itas) {
      window.__kami = [].concat(itas || []).map((x) => x.el.textContent.replace(/\s+/g, ' '));
      return Promise.resolve({ mai: window.__kami.length, size: 1 });
    };
  });
  await page.selectOption('#kamiTsuki', '1');
  await page.locator('#kamiMonth').click();
  await page.locator('#kamiMado .kami-mise-waku').first().click();
  await page.waitForTimeout(600);
  return page.evaluate(() => window.__kami[0] || '');
}

test('⑥ 月次集計の 紙：引いた 実費の 名前が「経費」・数字は 一覧が 無い 時と 同じ', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  const ari = await getsujiKami(page, { kinds: ZERO_KINDS });
  const page2 = await page.context().newPage();
  const nashi = await getsujiKami(page2, { kinds: [] });
  const kazu = (t) => (t.match(/\d{1,3}(,\d{3})+/g) || []).join(' ');
  // eslint-disable-next-line no-console
  console.log('★⑥★ ' + ari.slice(0, 400));
  expect(ari.length, '★紙が 出ない★').toBeGreaterThan(0);
  expect(ari, '★会社設定の 名前が 紙に 無い★').toContain('経費');
  expect(ari, '★古い 名前が 紙に 出た★').not.toMatch(/高速代|橋代/);
  expect(nashi, '★一覧が 無い 時は 今までの 名前★').toContain('橋代');
  expect(kazu(ari), '★一覧で 数字が 変わった★').toBe(kazu(nashi));
  expect(err).toEqual([]);
});

test('⑦ 売上表「日ごと」の 欄も「経費」だけ・打つと bridge_yen に 入る', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await uriage(page, { kinds: ZERO_KINDS });
  await page.locator('summary', { hasText: '一覧で 見る' }).click();
  await page.locator('button.rmore', { hasText: '実費を 入れる' }).first().click();
  const ran = page.locator('.dedit input.yen');
  await expect(ran.first()).toBeVisible();
  const r = await page.evaluate(() => ({
    ji: [...document.querySelectorAll('.dedit')].map((d) => d.textContent.trim()),
    f: [...document.querySelectorAll('.dedit input.yen')].map(
      (i) => i.getAttribute('data-f') + '=' + i.value
    ),
  }));
  // eslint-disable-next-line no-console
  console.log('★⑦★ ' + JSON.stringify(r));
  expect(r.ji.join(' '), '★固定の 名前が 残っている★').not.toMatch(/高速|橋|その他/);
  expect(r.ji.every((t) => t === '経費')).toBe(true);
  expect(r.f).toContain('bridge=2220');
  await ran.first().fill('2500');
  await ran.first().press('Tab');
  await page.waitForTimeout(600);
  const o = await page.evaluate(() => window.__okutta);
  // eslint-disable-next-line no-console
  console.log('★⑦送り★ ' + JSON.stringify(o));
  const k = o.filter((x) => x.p.indexOf('dk_shift_edits') === 0);
  expect(k.length, '★1回 打って 2回 以上 送った★').toBe(1);
  expect(k[0].b, '★経費（bridge の 列）に 入っていない★').toMatchObject({
    shift_id: 's1',
    bridge_yen: 2500,
    toll_yen: 0,
  });
  expect(err).toEqual([]);
});

test('⑧ 消した 高速代でも その 月に 額が 在れば 隠さない', async ({ page }) => {
  const r = await uriage(page, {
    kinds: ZERO_KINDS,
    edits: [
      { shift_id: 's1', toll_yen: 800, bridge_yen: 2220, other_yen: 0, hours: 8 },
      { shift_id: 's2', toll_yen: 0, bridge_yen: 1520, other_yen: 0, hours: 8 },
    ],
  });
  // eslint-disable-next-line no-console
  console.log('★⑧★ ' + JSON.stringify({ na: r.na }));
  expect(r.na, '★額が 在るのに 隠した（隠れたまま 引かれる）★').toEqual(['高速代', '経費']);
});

test('⑨ 月次集計の 画面の 内わけ：会社の 名前で 出す', async ({ page }) => {
  await getsujiKami(page, {
    kinds: ZERO_KINDS.concat([
      { kind_id: 'p1', label: '駐車場代', sort_order: 40, active: true, deleted_at: null },
    ]),
  });
  const t = ((await page.locator('#kpis').textContent()) || '').replace(/\s+/g, ' ');
  // eslint-disable-next-line no-console
  console.log('★⑨★ ' + t.slice(0, 300));
  expect(t).toContain('経費（駐車場代）');
  expect(t, '★固定の 名前が 残っている★').not.toMatch(/高速|橋/);
});

test('⑩ 月次集計の 紙：全部 消した 会社は 古い 3つの 名前を 刷らない', async ({ page }) => {
  const ari = await getsujiKami(page, {
    kinds: ZERO_KINDS.map((k) => Object.assign({}, k, { deleted_at: '2026-10-05T00:00:00Z' })),
  });
  // eslint-disable-next-line no-console
  console.log('★⑩★ ' + ari.slice(0, 300));
  expect(ari.length).toBeGreaterThan(0);
  expect(ari, '★消した 名前を 刷った★').not.toMatch(/高速代|橋代|その他/);
});

const SOTO_DAKE = [
  { kind_id: 'kabc', label: '駐車場代', sort_order: 40, active: true, deleted_at: null },
];
const GAKU_ARI = [
  { shift_id: 's1', toll_yen: 800, bridge_yen: 2220, other_yen: 0, hours: 8 },
  { shift_id: 's2', toll_yen: 0, bridge_yen: 1520, other_yen: 0, hours: 8 },
];
async function hiraku2(page) {
  await page.locator('summary', { hasText: '一覧で 見る' }).click();
  await page.locator('button.rmore', { hasText: '実費を 入れる' }).first().click();
  await expect(page.locator('.dedit input.yen').first()).toBeVisible();
  return page.evaluate(() => ({
    f: [...document.querySelectorAll('.dedit input.yen')].map((i) => i.getAttribute('data-f')),
    note: (document.getElementById('jippiNa') || {}).textContent || '',
  }));
}

test('⑪ 一覧に 古い 3つの 行が 無く 額が 在る ⇒ 名前・欄・道順が 揃って 出る', async ({ page }) => {
  const r = await uriage(page, { kinds: SOTO_DAKE, edits: GAKU_ARI });
  const d = await hiraku2(page);
  // eslint-disable-next-line no-console
  console.log('★⑪★ ' + JSON.stringify({ na: r.na, d }));
  // 並びは 欄・道順と 同じ 1か所（JippiHozon.mieruKinds）2026-10-24 件J
  expect(r.na).toEqual(['駐車場代', '高速代', '橋代']);
  expect(d.f, '★額が 在るのに 直す 欄が 無い★').toEqual(['kabc', 'toll', 'bridge']);
  expect(d.note).toBe('駐車場代・高速代・橋代');
});

test('⑫ 全部 消した 会社に 額が 在る ⇒ 月次の 紙は その 名前を 刷る', async ({ page }) => {
  const ari = await getsujiKami(page, {
    kinds: ZERO_KINDS.map((k) => Object.assign({}, k, { deleted_at: '2026-10-05T00:00:00Z' })),
  });
  // eslint-disable-next-line no-console
  console.log('★⑫★ ' + ari.replace(/\{[^}]*\}/g, '').slice(0, 300));
  expect(ari, '★引いた 額が 在るのに 名前が 無い★').toContain('経費');
  expect(ari, '★引いて いるのに「引く物なし」★').not.toContain('引く物なし');
});

test('⑬ 消した 物の 欄に 0 を 打っても その 場では 欄が 消えない', async ({ page }) => {
  await uriage(page, { kinds: ZERO_KINDS, edits: GAKU_ARI });
  const d = await hiraku2(page);
  expect(d.f).toEqual(['toll', 'bridge']);
  const kou = page.locator('.dedit input.yen[data-f="toll"]').first();
  await kou.fill('0');
  await kou.press('Tab');
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({
    f: [...document.querySelectorAll('.dedit input.yen')].map((i) => i.getAttribute('data-f')),
    na: document
      .getElementById('dHiku')
      .textContent.split('・')
      .map((t) => t.trim()),
  }));
  // eslint-disable-next-line no-console
  console.log('★⑬★ ' + JSON.stringify(r));
  expect(r.f, '★0 を 打ったら 欄が 消えた（打ち直せない）★').toContain('toll');
  expect(r.na).toContain('高速代');
});

test('⑭「使う」を 外した 物（消していない）は 日ごとの 欄に 出さない', async ({ page }) => {
  await uriage(page, {
    kinds: ZERO_KINDS.map((k) =>
      k.kind_id === 'other' ? Object.assign({}, k, { deleted_at: null, active: false }) : k
    ),
  });
  const d = await hiraku2(page);
  // eslint-disable-next-line no-console
  console.log('★⑭★ ' + JSON.stringify(d));
  expect(d.f, '★使わない 物の 欄が 出た★').toEqual(['bridge']);
});

// ★⑮ 月次集計の 画面の 内わけは 紙と 同じ「引く 物」★（対立役 3回目 指1）
//   2026-10-24 件J：入れた 実費は 全部 引く＝前の 設定で 引かなかった その他も 並ぶ
test('⑮ 月次集計の 画面：その他も 引く 物＝経費の 名前に 並ぶ', async ({ page }) => {
  await getsujiKami(page, {
    kinds: [
      { kind_id: 'toll', label: '高速代', sort_order: 10, active: true, deleted_at: null },
      { kind_id: 'bridge', label: '橋代', sort_order: 20, active: true, deleted_at: null },
      { kind_id: 'other', label: 'その他', sort_order: 30, active: true, deleted_at: null },
    ],
  });
  const t = ((await page.locator('#kpis').textContent()) || '').replace(/\s+/g, ' ');
  // eslint-disable-next-line no-console
  console.log('★⑮★ ' + t.slice(0, 300));
  expect(t, '★引いた その他が 経費の 名前に 無い★').toContain('経費（高速代・橋代・その他）');
});

test('⑯ 月次集計の 画面：会社が 付けた 名前の「（平日）」は 削らない', async ({ page }) => {
  await getsujiKami(page, {
    kinds: [
      { kind_id: 'toll', label: '高速（平日）', sort_order: 10, active: true, deleted_at: null },
      { kind_id: 'bridge', label: '経費', sort_order: 20, active: true, deleted_at: null },
    ],
  });
  const t = ((await page.locator('#kpis').textContent()) || '').replace(/\s+/g, ' ');
  // eslint-disable-next-line no-console
  console.log('★⑯★ ' + t.slice(0, 300));
  expect(t, '★会社の 名前を 削った★').toContain('経費（高速（平日））');
});

test('⑰ 売上表：月を 替えると 前の 月だけに 額が 在った 消した 物は 消える', async ({ page }) => {
  const r = await uriage(page, { kinds: ZERO_KINDS, edits: GAKU_ARI });
  expect(r.na).toEqual(['高速代', '経費']);
  await page.click('#nextM');
  await page.waitForTimeout(1500);
  const na = await page.evaluate(() =>
    document
      .getElementById('dHiku')
      .textContent.split('・')
      .map((t) => t.trim())
  );
  // eslint-disable-next-line no-console
  console.log(
    '★⑰★ ' + JSON.stringify(na) + ' ' + (await page.locator('#monthLabel').textContent())
  );
  expect(na, '★前の 月の 欄が 残った★').toEqual(['経費']);
});

// ★★⑱ 売上表の 実費の 欄：崩れた 字（1-2・1.5・7 5）は 送らず 知らせる・「1,500」は 1500★★ 2026-10-30
//   前は seisuu で 黙って「1-2」＝1円・「1.5」＝1円 で 保存した（入力の 画面と 同じ 読み方 JippiHozon.yomuEn に 揃えた）
//   わざと壊す：uriage.html saveEdit の yomuEn の 門を 外す ⇒ ★赤 1本★（2026-10-30 実測）
test('⑱ 売上表の 実費：崩れた 字は 送らない・「1,500」は 1500', async ({ page }) => {
  await uriage(page, { kinds: ZERO_KINDS });
  await page.locator('summary', { hasText: '一覧で 見る' }).click();
  await page.locator('button.rmore', { hasText: '実費を 入れる' }).first().click();
  const ran = page.locator('.dedit input.yen').first();
  await expect(ran).toBeVisible();
  for (const ji of ['1-2', '1.5', '7 5']) {
    await page.evaluate(() => {
      window.__okutta = [];
    });
    await ran.fill(ji);
    await ran.press('Tab');
    await page.waitForTimeout(500);
    const o = await page.evaluate(() =>
      window.__okutta.filter((x) => x.p.indexOf('dk_shift_edits') === 0)
    );
    // eslint-disable-next-line no-console
    console.log('★⑱★ ' + ji + ' 送った=' + o.length);
    expect(o.length, '★崩れた「' + ji + '」を 送った★').toBe(0);
    expect(await page.locator('body').textContent()).toContain('0以上の 整数');
  }
  await page.evaluate(() => {
    window.__okutta = [];
  });
  const ran2 = page.locator('.dedit input.yen').first();
  await ran2.fill('1,500');
  await ran2.press('Tab');
  await page.waitForTimeout(600);
  const o = await page.evaluate(() =>
    window.__okutta.filter((x) => x.p.indexOf('dk_shift_edits') === 0)
  );
  expect(o.length, '★「1,500」を 送っていない★').toBe(1);
  expect(o[0].b.bridge_yen, '★「1,500」を 1500 と 読まない★').toBe(1500);
});
