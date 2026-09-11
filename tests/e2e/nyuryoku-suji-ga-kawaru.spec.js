// ============================================================
// ★★入力で 打った 数字が 月次集計まで 届くか★★ 2026-09-08
//
//   ★司さん★「ちゃんと数字が変わるようになってるか？」
//
//   ★言葉では 答えない★＝★前 → 後 ＋ 増減★で 数えます。
//
//   ★測り方（作り物を 挟まない）★
//     ①入力の 画面（nyuryoku.html）を 実際に 開いて ★打つ★
//     ②画面が 倉庫へ 送った ★中身（body）を そのまま 受け取る★
//     ③その 中身を ★倉庫の 中身として★ 月次集計（shukei.html）に 読ませる
//     ④打つ 前と 打った 後で ★内訳の 数字の 差★を 数える
//     ⇒ 途中に 私が 書いた 写しは 1つも 挟んでいません。
//       （打った 物が そのまま 集計に 入るか を 見ている）
//
//   ★見る 数字★
//     ・電子決済 ………… ＋打った額
//     ・未収（請求書＋電子決済）… ＋打った額
//     ・売上（実費を引いた後）… ★高速代を 打つと 減る★
//     ・会社に残る分 ……… 実費を 打つと 減る
//
//   ★★実測（2026-09-08・この 見張りが 出した 数字）★★
//     ★電子決済 5,000 を 打つ★
//       電子決済 …………… 0 → 5,000（＋5,000）
//       未収（請求書＋電子決済）0 → 5,000（＋5,000）
//       現金 ……………… 50,000 → 45,000（★−5,000★）
//         ＝司さん「PayPayいれたら現金が減るようにしろよ」の 通り
//       売上 ……………… 50,000 のまま（動かない＝正しい）
//     ★高速代 1,200 を 打つ★
//       売上（実費を引いた後）50,000 → 48,800（★−1,200★）
//       経費 ……………… 0 → 1,200（＋1,200）
//       会社に残る分 …… 47,500 → 46,360
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-08 実測）★★
//     ①打った 日ごとの 分を 集計に 入れない … ★赤★（増減が 全部 0）
//     ②高速代を 売上から 引かない ………… ★赤★（売上=0・経費=0）
//     戻した後 … ★緑 3本★
//   ★1回 目の 壊し方は 効いていませんでした★
//     normSettings の 分岐を 変えたが、設定が 無い 時は 既定を 返すので 素通り。
//     ⇒ ★DEFAULT_DEDUCT を 変えて やり直した★（緑のままで 済ませていない）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CO = 'c1';
const HI = '2026-09-02';
const YM = HI.slice(0, 7);

// ★1回の 業務（メーターの 記録）★＝この 売上に 実費が 効く
const SHIFTS = [
  {
    shift_id: 's1',
    company_id: CO,
    device_id: 'd1',
    started_at: HI + 'T10:00:00+09:00',
    ended_at: HI + 'T18:00:00+09:00',
    fare_total_yen: 50000,
    cash_total_yen: 50000,
    invoice_total_yen: 0,
    trip_count: 10,
    actual_total_m: 60000,
    total_distance_m: 120000,
  },
];
const LABELS = [{ company_id: CO, device_id: 'd1', label: '4987', sort_order: 1 }];
const KINDS = [
  { kind_id: 'toll', label: '高速代', sort_order: 10, active: true },
  { kind_id: 'bridge', label: '橋代', sort_order: 20, active: true },
];

// ★倉庫の 代わり★（中身は 呼ぶ側が 決める）
function stub(souko) {
  const moto = fs.readFileSync(path.join(ROOT, 'js', 'dk-session.js'), 'utf8');
  const D = {
    co: { company_id: CO, name: 'ZERO代行' },
    S: souko,
  };
  return (
    moto +
    ';(function(){var D=' +
    JSON.stringify(D) +
    ';var S=window.DKSession;window.__okutta=[];' +
    'function rows(p){ var n=p.split("?")[0]; return D.S[n] || [];}' +
    'S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return D.co.company_id;};S.pickCompany=function(){return {mode:"one",company:D.co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([D.co]);}});};' +
    'S.rest=function(s,p,o){ if(o&&o.method)window.__okutta.push({saki:p,method:o.method,body:o.body});' +
    ' return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function noseru(page, souko) {
  await page.unrouteAll();
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: stub(souko),
    })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
}

// ★はじめの 倉庫（まだ 何も 打っていない）★
function karaSouko() {
  return {
    dk_shifts: SHIFTS,
    dk_device_labels: LABELS,
    dk_expense_kinds: KINDS,
    dk_shift_edits: [],
    dk_day_extras: [],
    dk_month_extras: [],
    dk_manual_days: [],
    dk_employees: [],
    dk_payroll_settings: [],
    dk_work_hours: [],
    dk_sales_settings: [],
    dk_trips: [],
  };
}

// ★月次集計の 内訳を 読む★（画面に 出ている 字から）
async function uchiwake(page, souko) {
  await noseru(page, souko);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  // ★その月だけ 見る★（年まるごとでも 同じだが、月で 見た方が 分かりやすい）
  await page.selectOption('#tsukiSel', String(Number(YM.slice(5, 7))));
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#kpis tr').forEach((tr) => {
      if (tr.children.length < 2) return;
      // ★内訳の 字は 頭に 全角の 空白が 付く 事が ある（全角の空白＋電子決済）★
      //   ⇒ ★trim して 覚える★（2026-09-08 に ここで 一度 外しました）
      const k = (tr.children[0].textContent || '').replace(/[\s\u3000]/g, '');
      const v = Number((tr.children[1].textContent || '').replace(/[^\d-]/g, ''));
      if (k) out[k] = v;
    });
    return out;
  });
}

// ★入力の 画面で 実際に 打って、送られた 中身を 受け取る★
async function utsu(page, souko, tsukau) {
  await noseru(page, souko);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/nyuryoku.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.fill('#hiSel', HI);
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(1200);
  await tsukau(page);
  await page.waitForTimeout(600);
  return page.evaluate(() => window.__okutta || []);
}

test('★★① 電子決済を 打つと 月次集計の 数字が その分 増える★★', async ({ page }) => {
  const souko = karaSouko();

  // ★前★
  const mae = await uchiwake(page, souko);
  // eslint-disable-next-line no-console
  console.log('★前★ ' + JSON.stringify(mae));

  // ★打つ★（5,000円）
  // ★★2026-09-11 電子決済は 車ごとに なりました★★（司さん「車毎に 出す」）
  //   ★前★ 日ごとの 棚（dk_day_extras）
  //   ★今★ ★走った 車は dk_shift_edits★
  //   ★測る 事は 同じ★＝打った 分が ★月次集計の 数字に そのまま 届く★
  const okutta = await utsu(page, souko, async (p) => {
    const den = p.locator('#shaList [data-f="denshi_yen"]').first();
    await den.fill('5000');
    await den.dispatchEvent('change');
  });
  const pp = okutta.filter((x) => x.saki.indexOf('dk_shift_edits') === 0);
  expect(pp.length, '★打っても 倉庫へ 行っていません★').toBe(1);
  const gyou = JSON.parse(pp[0].body);
  // eslint-disable-next-line no-console
  console.log('★送られた 中身★ ' + JSON.stringify(gyou));

  // ★★送られた 物を そのまま 倉庫に 入れる★★（写しを 作らない）
  const ato = await uchiwake(page, Object.assign({}, souko, { dk_shift_edits: [gyou] }));
  // eslint-disable-next-line no-console
  console.log('★後★ ' + JSON.stringify(ato));

  const sa = (k) => (ato[k] || 0) - (mae[k] || 0);
  // eslint-disable-next-line no-console
  console.log(
    '★増減★ 電子決済=' +
      sa('電子決済') +
      ' 未収=' +
      sa('未収（請求書＋電子決済）') +
      ' 現金=' +
      sa('現金')
  );
  expect(sa('電子決済'), '★電子決済が 5,000 増えていません★').toBe(5000);
  expect(sa('未収（請求書＋電子決済）'), '★未収が 5,000 増えていません★').toBe(5000);
  // ★売上や 現金は 動かない★（電子決済は メーターの 売上とは 別に 手で 入れる 分）
  expect(sa('売上（実費を引いた後）'), '★売上まで 動いています★').toBe(0);
  // ★★電子決済を 入れたら 現金が 減る★★
  //   ★司さん★「PayPayいれたら現金が減るようにしろよ」
  //   メーターは 電子決済を 知らないので ★現金として 数えている★。
  //   ⇒ 手で 入れた 分だけ 現金から 移す＝★合計は 増えない★（二重に 数えない）
  expect(sa('現金'), '★電子決済を 入れたのに 現金が 減っていません★').toBe(-5000);
});

test('★★② 高速代を 打つと 売上（実費を引いた後）が その分 減る★★', async ({ page }) => {
  const souko = karaSouko();

  const mae = await uchiwake(page, souko);
  // eslint-disable-next-line no-console
  console.log('★前★ ' + JSON.stringify(mae));

  // ★打つ★（高速代 1,200円）
  const okutta = await utsu(page, souko, async (p) => {
    const kou = p.locator('#shaList [data-sid="s1"][data-f="toll"]');
    await kou.fill('1200');
    await kou.dispatchEvent('change');
  });
  const ed = okutta.filter((x) => x.saki.indexOf('dk_shift_edits') === 0);
  expect(ed.length, '★打っても 倉庫へ 行っていません★').toBe(1);
  const gyou = JSON.parse(ed[0].body);
  // eslint-disable-next-line no-console
  console.log('★送られた 中身★ ' + JSON.stringify(gyou));
  expect(gyou.toll_yen, '★高速代が 入っていません★').toBe(1200);

  const ato = await uchiwake(page, Object.assign({}, souko, { dk_shift_edits: [gyou] }));
  // eslint-disable-next-line no-console
  console.log('★後★ ' + JSON.stringify(ato));

  const sa = (k) => (ato[k] || 0) - (mae[k] || 0);
  // eslint-disable-next-line no-console
  console.log(
    '★増減★ 売上=' + sa('売上（実費を引いた後）') + ' 経費=' + sa('経費（高速・橋など）')
  );
  expect(sa('売上（実費を引いた後）'), '★売上が 1,200 減っていません★').toBe(-1200);
  expect(sa('経費（高速・橋など）'), '★経費が 1,200 増えていません★').toBe(1200);
});

test('★★③ 打っていない 日の 分は 混ざらない★★', async ({ page }) => {
  const souko = karaSouko();
  const mae = await uchiwake(page, souko);

  // ★別の 月（8月）の 電子決済★＝9月の 内訳には 出ないはず
  const yoso = { company_id: CO, pay_date: '2026-08-15', denshi_yen: 99999 };
  const ato = await uchiwake(page, Object.assign({}, souko, { dk_day_extras: [yoso] }));

  const sa = (ato['電子決済'] || 0) - (mae['電子決済'] || 0);
  // eslint-disable-next-line no-console
  console.log('★別の月を 入れた時の 9月の 増減★ ' + sa);
  expect(sa, '★別の 月の 分が 9月に 混ざっています★').toBe(0);
});
