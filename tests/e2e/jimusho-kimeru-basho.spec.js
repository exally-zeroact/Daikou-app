// ============================================================
// ★★決める所は 会社設定に 集める★★ 2026-09-05（司さん）
//   「会社の設定で 料金 触るようにしろや」
//   「設定画面の 中に チップで 車、料金、従業員マスタ つくったら 各ページ 見やすくなるやろ」
//
//   ★やり方★ ★出し方だけ 分ける★（中身は 動かさない＝壊さない）
//     ・料金表 …… 見るだけ／?henshu=1 で 決める
//     ・給料 …… 明細・時数だけ／?henshu=1 で「従業員」「給料の設定（車）」も 出る
//     ・会社設定 … チップ 4つ（会社／車／料金／従業員）＋それぞれの 入口
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-05 実測）★★
//     ①（10-06 中身を 変えた）給料で 決める タブを 隠す ……… ★赤★（①の 段）
//     ②会社設定の 入口の 行き先を 変える ……… ★赤★（③の 段）
//     ③チップを 1つ 消す ………………………… ★赤★（③の 段）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = FIX.settings[0].company_id;
const KAISHA = {
  company_id: 'c1',
  name: 'ZERO代行',
  status: 'on',
  url_token: 'tok1',
  home_city: '今治市',
  owner_id: 'u1',
};

function kyuryoSess() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: '見張り用' };
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(FIX) +
    ';var co=' +
    JSON.stringify(co) +
    ';' +
    'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){var x={ok:true,status:200,json:function(){return Promise.resolve(rows(p));}};' +
    // ⑮ の 為：__HITORI_OK__ が 立つ 時だけ 1人ぶんの 配るが 通る（立たない 時は 何も 返さない＝配れない）
    'if(o&&o.method==="POST"&&String(p).indexOf("rpc/dk_kyuryo_haifu_hitori")===0&&window.__HITORI_OK__){var bb=JSON.parse(o.body||"{}");return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve({ok:true,hito:{employee_id:bb.p_employee_id,name:"仮",token:"zz-tok",init_code:"ZZ",pw_ari:false,active:false}});}});}' +
    // ⑬ の 為：__EMP_NG__ が "0gyou" なら 0行、"400" なら 倉庫が 断った 形（列が 無い）で 返す
    'if(o&&o.method==="PATCH"&&String(p).indexOf("dk_employees?employee_id=eq.")===0&&window.__EMP_NG__){window.__EMP_PATCH__=(window.__EMP_PATCH__||[]).concat([JSON.parse(o.body)]);' +
    'if(window.__EMP_NG__==="0gyou")return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve([]);}});' +
    'return Promise.resolve({ok:false,status:400,text:function(){return Promise.resolve(JSON.stringify({code:"PGRST204",message:"Could not find the retired_on column of dk_employees"}));},json:function(){return Promise.resolve({});}});}' +
    // ⑪ の 為：dk_employees の PATCH は 書いた 1行を 返す（return=representation と 同じ 形）
    'if(o&&o.method==="PATCH"&&String(p).indexOf("dk_employees?employee_id=eq.")===0){var id=decodeURIComponent(String(p).split("eq.")[1]);var e0=(F.emps||[]).filter(function(e){return e.employee_id===id;})[0];var b=JSON.parse(o.body);var row=Object.assign({},e0,b);window.__EMP_PATCH__=(window.__EMP_PATCH__||[]).concat([b]);return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(e0?[row]:[]);}});}' +
    // ⑧ の 為：__PATCH_OSOKU__ が 立つ 時だけ PATCH を 遅らせ、書けた 時刻を 残す
    // ⑨ の 為：__PATCH_NG__ が 立つ 時は PATCH を 書けなかった 形で 返す
    'if(o&&o.method==="PATCH"&&window.__PATCH_NG__)return new Promise(function(ok){setTimeout(function(){ok({ok:false,status:500,json:function(){return Promise.resolve({});}});},300);});' +
    'if(o&&o.method==="PATCH"&&window.__PATCH_OSOKU__)return new Promise(function(ok){setTimeout(function(){localStorage.setItem("__kaketa__",String(Date.now()));ok(x);},window.__PATCH_OSOKU__);});' +
    'return Promise.resolve(x);};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function kyuryoHiraku(page, ura) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: kyuryoSess(),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  // ★★同じ 画面で # だけ 変えても 読み直しません★★（実際に 踏んだ）
  //   ⇒ ★毎回 about:blank を 通してから 開く★＝新しく 読み直される
  await page.goto('about:blank');
  await page.goto('/kyuryo.html' + (ura || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2400);
}

function tabYomu(page) {
  return page.evaluate(() => ({
    tab: [...document.querySelectorAll('.tab')]
      .filter((b) => b.offsetWidth > 0)
      .map((b) => b.textContent.trim() + (b.classList.contains('on') ? '★' : '')),
  }));
}

// ★★★見張りの 中身を 変えました★★★ 2026-10-06
//   ★前（09-05）★「給料は ふだん『明細』『時数を入れる』だけ」
//   ★司さん（10-06）★「給料の所に給料設定と従業員設定のボタンも作れや どこで設定するか分からんやろが」
//   ⇒ ★給料の 画面にも「従業員」「給料の設定」の タブを 出す★（会社設定の チップも 同じ 画面を 開く）
//   わざと壊す（10-06）：kyuryo.html で 前の 隠す 処理を 戻す ⇒ ★赤★
test('★★① 給料の 画面に「従業員」「給料の設定」の タブも 出る★★', async ({ page }) => {
  await kyuryoHiraku(page);
  const r = await tabYomu(page);
  // eslint-disable-next-line no-console
  console.log('★給料の タブ★ ' + JSON.stringify(r));
  // 2026-10-23「時数を入れる」は 入力の 画面へ 移した＝明細（確認）・従業員・給料の設定 の 3つ
  expect(r.tab.length, '★タブの 数が 違います★').toBe(3);
  expect(r.tab.join(','), '★時数を入れる が 残っている★').not.toContain('時数を入れる');
  expect(r.tab.join(','), '★従業員の タブが 無い★').toContain('従業員');
  expect(r.tab.join(','), '★給料の設定の タブが 無い★').toContain('給料の設定');
});

// ★★★見張りの 中身を 変えました（黙って 数だけ 動かさない）★★★ 2026-09-06
//   ★前★「?henshu=1 なら タブが 4つ 出る」＝★私が 昨日 作った 形★
//   ★司さん★「従業員と給料の設定がなんで2個もある」「全ページで戻るボタンすらない」
//   ⇒ 会社設定の チップと 給料の タブで ★同じ物への 入口が 2つ★に なっていた。
//   ★今★「会社設定から 来たら ★タブの行は 出さない★／★戻る所が 在る★」
test('★★② 会社設定から 来たら 入口は 1つ＋戻るが 在る★★', async ({ page }) => {
  await kyuryoHiraku(page, '?henshu=1#emp');
  const r = await page.evaluate(() => {
    const t = document.getElementById('tabs');
    const m = document.getElementById('modoruSet');
    const a = m ? m.querySelector('a') : null;
    const emp = document.querySelector('[data-pane="emp"], #paneEmp, #empWrap');
    return {
      tabMieru: !!(t && t.offsetHeight > 0),
      modoruMieru: !!(m && m.offsetHeight > 0),
      iki: a ? a.getAttribute('href') : null,
      // 2026-10-16 見出しの 字は「従業員／退職者」の 切り替えの ボタンに 替えた（司さん）＝見出しの 帯の 中の 字で 見る
      midashi: (m || {}).textContent || '',
      empAru: !!emp,
    };
  });
  // eslint-disable-next-line no-console
  console.log('★会社設定から 来た時（従業員）★ ' + JSON.stringify(r));
  expect(r.tabMieru, '★タブの 行が 出ています＝入口が 2つ★').toBe(false);
  expect(r.modoruMieru, '★戻る所が ありません★').toBe(true);
  expect(r.iki, '★戻り先が 会社設定では ありません★').toBe('dashboard.html');
  expect(r.midashi, '★今 何を 決めているか 出ていません★').toContain('従業員');

  await kyuryoHiraku(page, '?henshu=1#set');
  const r2 = await page.evaluate(() => ({
    tabMieru: !!(document.getElementById('tabs') || {}).offsetHeight,
    midashi: (document.getElementById('modoruMidashi') || {}).textContent || '',
  }));
  // eslint-disable-next-line no-console
  console.log('★会社設定から 来た時（給料の設定）★ ' + JSON.stringify(r2));
  expect(r2.tabMieru, '★タブの 行が 出ています＝入口が 2つ★').toBe(false);
  expect(r2.midashi, '★今 何を 決めているか 出ていません★').toContain('給料の設定');
});

test('★★③ 会社設定に チップ 4つと 入口が 在る★★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const stub =
    moto +
    ';(function(){var co=' +
    JSON.stringify(KAISHA) +
    ';var S=window.DKSession;if(!S)return;' +
    'S.ensure=function(){return Promise.resolve({access_token:"t",user:{id:"u1"}});};' +
    'S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};' +
    'S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(String(p||"").indexOf("dk_companies")===0?[co]:[]);}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(String(p||"").indexOf("dk_companies")===0?[co]:[]);};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: stub })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'u1', email: 'x@example.com' }),
    })
  );
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(r.request().url().indexOf('dk_companies') >= 0 ? [KAISHA] : []),
    })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);

  const r = await page.evaluate(() => ({
    chip: [...document.querySelectorAll('[data-chip]')].map((b) => b.textContent.trim()),
    // ★押した 1つだけ 出る★
    mieru: [...document.querySelectorAll('[data-pane]')]
      .filter((d) => d.offsetHeight > 0)
      .map((d) => d.getAttribute('data-pane')),
  }));
  // eslint-disable-next-line no-console
  console.log('★会社設定★ ' + JSON.stringify(r));
  // ★★中身を 変えました（黙って 数だけ 動かさない）★★ 2026-09-06
  //   ★前★ 4つ（会社／車／料金／従業員）
  //   ★今★ ★実費★を 足して 5つ（司さん「この項目…自由に決めれるん？」→「ウ」）
  expect(r.chip, '★チップの 中身が 違います★').toEqual(['会社', '車', '料金', '従業員', '実費']);
  expect(r.mieru.length, '★出ているのが 1つでは ありません★').toBe(1);

  // ★入口の 行き先★（ここが 崩れると 決められなく なる）
  //   ★2026-10-16★ 車・従業員は 間の 札を 消し、★チップ そのものが 入口★（司さん「決めるボタン押さないかんのは めんどくさい」）
  const iki = await page.evaluate(() => [
    ...[...document.querySelectorAll('[data-pane] a.btn')].map((a) => a.getAttribute('href')),
    ...[...document.querySelectorAll('[data-chip][data-href]')].map((b) =>
      b.getAttribute('data-href')
    ),
  ]);
  // eslint-disable-next-line no-console
  console.log('★入口★ ' + JSON.stringify(iki));
  expect(iki, '★車の 入口が ありません★').toContain('kyuryo.html?henshu=1#kuruma');
  // ★★料金の 入口は 窓の 中へ 移しました★★ 2026-09-09
  //   ★司さん★「料金を決めるは 被るから いらん」「紙に出すも」
  //   ⇒ 窓の 外の 札は 消し、★窓の 中の 見出しの 右横★ 1つに まとめた。
  //   ★ここで 守る 事★ 入口が ★本当に 押せる形で 存えているか★
  //     （札を 消すだけで 緑に するのは 見張りを 殺すのと 同じ）
  // ★窓は 押すまで 読み込まない（loading="lazy"）★ ⇒ 先に 料金を 開く
  await page.locator('[data-chip="ryokin"]').click();
  await page.waitForTimeout(800);
  const mado = page.frameLocator('#ryokinMado');
  const kimeru = mado.locator('#kimeruBtn');
  await kimeru.waitFor({ state: 'visible', timeout: 8000 });
  const ryokinIri = await kimeru.evaluate((a) => ({
    href: a.getAttribute('href'),
    target: a.getAttribute('target'),
    ji: a.textContent.trim(),
  }));
  // eslint-disable-next-line no-console
  console.log('★料金の 入口（窓の 中）★ ' + JSON.stringify(ryokinIri));
  expect(ryokinIri.href, '★料金の 入口の 行き先が 違います★').toBe('ryokinhyou.html?henshu=1');
  // ★窓の 中で 開くと 小さい 箱に 閉じ込められる★
  expect(ryokinIri.target, '★窓の 中で 開いてしまいます★').toBe('_top');

  // ★窓の 外に 同じ 札を 戻さない★
  expect(iki.join(','), '★「料金を 決める」が 外に 戻っています★').not.toContain('ryokinhyou.html');
  expect(iki, '★従業員の 入口が ありません★').toContain('kyuryo.html?henshu=1#emp');

  expect(err, '★画面が 落ちました★').toEqual([]);

  // ★車の チップを 押すと 間の 札を 通らず そのまま 車を 決める 画面へ★ 2026-10-16（司さん）
  await page.locator('[data-chip="kuruma"]').click();
  await page.waitForURL(/kyuryo\.html\?henshu=1#kuruma$/, { timeout: 8000 });
});

// ★★会社設定の「車」から 来たら 車の 箱だけ★★ 2026-10-16（司さん「車の決めるとこに なんで 関係ないものが あるんど」）
//   前は 給料の 設定を まるごと 開き、役割ごとの決まり・売上の分け方・明細の期間・従業員へ配る が 並んでいた。
//   ★守る 事★ 車の 箱と 保存（車ごとの売上を載せる の 印を 保存する）は 見え、他の 箱は 見えない。見出しは「車」。
//   ★#set（給料の 設定 ぜんぶ）は 今までどおり★
test('★★④ 会社設定の「車」から 来たら 車の 箱だけ★★', async ({ page }) => {
  await kyuryoHiraku(page, '?henshu=1#kuruma');
  const r = await page.evaluate(() => {
    const ps = document.getElementById('paneSet');
    const cards = [...ps.querySelectorAll(':scope > .card')];
    return {
      tabMieru: !!(document.getElementById('tabs') || {}).offsetHeight,
      paneMieru: !!ps.offsetHeight,
      carMieru: cards
        .filter((c) => c.classList.contains('car-pane'))
        .every((c) => c.offsetHeight > 0),
      hokaMieru: cards.filter((c) => !c.classList.contains('car-pane') && c.offsetHeight > 0)
        .length,
      hokaKazu: cards.filter((c) => !c.classList.contains('car-pane')).length,
      hozonObi: !!(document.getElementById('saveBar') || {}).offsetHeight,
      midashi: (document.getElementById('modoruMidashi') || {}).textContent || '',
    };
  });
  // eslint-disable-next-line no-console
  console.log('★車だけ★ ' + JSON.stringify(r));
  expect(r.tabMieru, '★タブの 行が 出ています★').toBe(false);
  expect(r.paneMieru && r.carMieru, '★車の 箱が 見えません★').toBe(true);
  expect(r.hokaKazu, '★他の 箱を 数えていない（0本を 見て 緑に しない）★').toBeGreaterThanOrEqual(
    3
  );
  expect(r.hokaMieru, '★車と 関係ない 箱が 出ています★').toBe(0);
  // 車だけの 時は 下の 保存の 帯を 出さない（下の 帯に 覆われて 押せなかった）＝「載せる」の 印は その場で 保存（⑤）
  expect(r.hozonObi, '★押せない 保存の 帯が 出ています★').toBe(false);
  expect(r.midashi).toBe('車');

  // #set（給料の 設定 ぜんぶ）は 今までどおり 他の 箱も 出る
  await kyuryoHiraku(page, '?henshu=1#set');
  const z = await page.evaluate(
    () =>
      [...document.getElementById('paneSet').querySelectorAll(':scope > .card')].filter(
        (c) => c.offsetHeight > 0
      ).length
  );
  expect(z, '★給料の 設定 ぜんぶ の 方まで 隠しています★').toBeGreaterThanOrEqual(4);
});

// ★★⑤ 車だけの 画面の「載せる」は その場で、この 印 だけを 書く★★ 2026-10-16（対立役）
//   前：設定 ぜんぶを 送り、隠れた 積立 0.0525 が 画面の 丸めで 0.053 に 書き換わった／自分の 車が 空に なった
function okuttaMiru(page) {
  return page.evaluate(() => {
    window.__okutta__ = [];
    const r0 = window.DKSession.rest;
    window.DKSession.rest = function (s, p, o) {
      if (o && o.method && o.method !== 'GET' && String(p).indexOf('dk_payroll_settings') === 0)
        window.__okutta__.push({ m: o.method, p: String(p), b: JSON.parse(o.body) });
      return r0.apply(this, arguments);
    };
  });
}
test('★★⑤ 車だけの 画面の「載せる」は この 印 だけを その場で 書く★★', async ({ page }) => {
  const moto = { ...FIX.settings[0] };
  Object.assign(FIX.settings[0], {
    owner_device_id: 'zz-meibo-ni-nai-kuruma',
    reserve_pool_rate: 0.0525,
    reserve_owner_rate: 0.0515,
  });
  try {
    await kyuryoHiraku(page, '?henshu=1#kuruma');
    await okuttaMiru(page);
    await page.locator('#showCarSales').click();
    await page.waitForTimeout(600);
    const okutta = await page.evaluate(() => window.__okutta__);
    expect(okutta.length, '★「載せる」を 変えても 保存して いない／2本 以上 送った★').toBe(1);
    expect(okutta[0].m).toBe('PATCH');
    expect(
      Object.keys(okutta[0].b).sort(),
      '★「載せる」 以外も 送っています（隠れた 率が 丸まる）★'
    ).toEqual(['show_car_sales', 'updated_at']);
    const saved = await page.evaluate(
      () => (document.getElementById('carSaved') || {}).textContent || ''
    );
    expect(saved, '★車の 箱の 中に 保存の 合図が 出ていません★').toContain('保存しました');
  } finally {
    Object.keys(FIX.settings[0]).forEach((k) => delete FIX.settings[0][k]);
    Object.assign(FIX.settings[0], moto);
  }
});

test('★★⑥ 給料の 設定 ぜんぶの 保存でも 名簿に 無い 自分の 車を 空に しない★★', async ({
  page,
}) => {
  const moto = FIX.settings[0].owner_device_id;
  FIX.settings[0].owner_device_id = 'zz-meibo-ni-nai-kuruma';
  try {
    await kyuryoHiraku(page, '?henshu=1#set');
    await okuttaMiru(page);
    await page.evaluate(() => document.getElementById('btnSaveSet').onclick());
    await page.waitForTimeout(600);
    const okutta = await page.evaluate(() => window.__okutta__);
    expect(okutta.length).toBe(1);
    const b = Array.isArray(okutta[0].b) ? okutta[0].b[0] : okutta[0].b;
    expect(b.owner_device_id, '★見えない 自分の 車を 空に しました★').toBe(
      'zz-meibo-ni-nai-kuruma'
    );
  } finally {
    FIX.settings[0].owner_device_id = moto;
  }
});

// ★★⑦ 「載せる」の 書き込みは keepalive（押して すぐ 戻っても 切らない）・書けなければ 印を 戻す・行が 無ければ 作る★★
test('★★⑦ 「載せる」の 枝（keepalive・書けない・行が 無い）★★', async ({ page }) => {
  await kyuryoHiraku(page, '?henshu=1#kuruma');
  const kekka = await page.evaluate(async () => {
    const S = window.DKSession;
    const r0 = S.rest;
    const sc = document.getElementById('showCarSales');
    const matsu = () => new Promise((ok) => setTimeout(ok, 400));
    const out = {};
    // ① keepalive が 付く
    let opt = null;
    S.rest = function (s, p, o) {
      if (o && o.method === 'PATCH') opt = o;
      return r0.apply(this, arguments);
    };
    sc.click();
    await matsu();
    out.keepalive = !!(opt && opt.keepalive);
    // ② 書けない＝印を 戻し、合図を 出す
    const mae = sc.checked;
    S.rest = function (s, p, o) {
      if (o && o.method === 'PATCH')
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      return r0.apply(this, arguments);
    };
    sc.click();
    await matsu();
    out.modotta = sc.checked === mae;
    out.ngAizu = (document.getElementById('carSaved') || {}).textContent || '';
    // ③ 行が 無い（0行）＝全部の 保存へ 倒さない（隠れた 率が 丸まる）＝送らず 印を 戻して 知らせる
    const mae3 = sc.checked;
    let post = 0;
    S.rest = function (s, p, o) {
      if (o && o.method === 'PATCH')
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      if (o && o.method === 'POST' && String(p).indexOf('dk_payroll_settings') === 0) post++;
      return r0.apply(this, arguments);
    };
    sc.click();
    await matsu();
    out.post = post;
    out.modotta3 = sc.checked === mae3;
    out.zeroAizu = (document.getElementById('carSaved') || {}).textContent || '';
    S.rest = r0;
    return out;
  });
  expect(kekka.keepalive, '★「載せる」の 書き込みに keepalive が 無い＝戻ると 切られる★').toBe(
    true
  );
  expect(kekka.modotta, '★書けなかったのに 印が 変わった まま★').toBe(true);
  expect(kekka.ngAizu).toContain('保存できませんでした');
  expect(kekka.post, '★行が 無い 時に 全部の 保存へ 倒した（隠れた 率が 丸まる）★').toBe(0);
  expect(kekka.modotta3, '★行が 無いのに 印が 変わった まま★').toBe(true);
  expect(kekka.zeroAizu).toContain('保存できませんでした');
});

// ★★⑧「← 会社設定へ 戻る」は 書いている 最中の 保存が 済んでから 移る★★ 2026-10-16（対立役 S-B）
//   keepalive では、別の 住所への 問い合わせの 最中に 画面を 移ると 書き込みが 届かなかった
test('★★⑧ 戻るは 書き終わってから 移る★★', async ({ page }) => {
  await kyuryoHiraku(page, '?henshu=1#kuruma');
  await page.evaluate(() => {
    localStorage.removeItem('__kaketa__');
    window.__PATCH_OSOKU__ = 900;
  });
  await page.locator('#showCarSales').click();
  const oshita = await page.evaluate(() => Date.now());
  await page.locator('#modoruSet a').click();
  await page.waitForURL(/dashboard\.html/, { timeout: 15000 });
  const kaketa = Number(await page.evaluate(() => localStorage.getItem('__kaketa__') || '0'));
  expect(kaketa, '★書き終わる 前に 画面を 移った（書き込みが 消える）★').toBeGreaterThan(0);
  expect(kaketa - oshita, '★待たずに 移った★').toBeGreaterThanOrEqual(800);
});

// ★★⑨ 書けなかったら「戻る」は 移らずに 赤字を 残す★★ 2026-10-16（指示役・対立役：移ると 赤字が 消え「保存できた」に 見えた）
test('★★⑨ 書けなかったら 戻るは 移らない★★', async ({ page }) => {
  await kyuryoHiraku(page, '?henshu=1#kuruma');
  await page.evaluate(() => {
    window.__PATCH_NG__ = 1;
  });
  await page.locator('#showCarSales').click();
  await page.locator('#modoruSet a').click();
  await page.waitForTimeout(2000);
  const r = await page.evaluate(() => ({
    url: location.pathname,
    ji: (document.querySelector('#modoruSet a') || {}).textContent || '',
    aka: document.body.innerText.includes('画面を 移りませんでした'),
  }));
  expect(r.url, '★書けなかったのに 画面を 移った（赤字が 消える）★').toContain('kyuryo.html');
  expect(r.ji).toContain('会社設定へ');
  expect(r.aka, '★移らなかった 訳を 出していない★').toBe(true);
});

// ★★⑩ 会社設定の チップも 書き終わってから 移り、書けなければ 移らない★★ 2026-10-16（対立役：試験が 無かった）
async function dashHiraku(page, kakiKaesu) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const stub =
    moto +
    ';(function(){var co=' +
    JSON.stringify(KAISHA) +
    ';var S=window.DKSession;if(!S)return;' +
    'S.ensure=function(){return Promise.resolve({access_token:"t",user:{id:"u1"}});};' +
    'S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};' +
    'S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(String(p||"").indexOf("dk_companies")===0?[co]:[]);}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(String(p||"").indexOf("dk_companies")===0?[co]:[]);};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: stub })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'u1', email: 'x@example.com' }),
    })
  );
  const kaki = { owatta: 0 };
  await page.route('**/rest/v1/**', async (r) => {
    const m = r.request().method();
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
      await new Promise((ok) => setTimeout(ok, 900));
      kaki.owatta = Date.now();
      return r.fulfill({ status: kakiKaesu, contentType: 'application/json', body: '[]' });
    }
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(r.request().url().indexOf('dk_companies') >= 0 ? [KAISHA] : []),
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  return kaki;
}
test('★★⑩a 会社設定の チップは 書き終わってから 移る★★', async ({ page }) => {
  const kaki = await dashHiraku(page, 204);
  await page.locator('#homeCity').fill('松山市');
  await page.locator('#saveHomeCity').click();
  await page.locator('[data-chip="kuruma"]').click();
  await page.waitForURL(/kyuryo\.html\?henshu=1#kuruma$/, { timeout: 15000 });
  const utsutta = Date.now();
  expect(kaki.owatta, '★書き込みが 届いていない★').toBeGreaterThan(0);
  expect(utsutta, '★書き終わる 前に 移った★').toBeGreaterThanOrEqual(kaki.owatta);
});
test('★★⑩b 会社設定の チップは 書けなければ 移らずに 知らせる★★', async ({ page }) => {
  await dashHiraku(page, 500);
  await page.locator('#homeCity').fill('松山市');
  await page.locator('#saveHomeCity').click();
  await page.locator('[data-chip="kuruma"]').click();
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({
    url: location.pathname,
    msg: (document.getElementById('chipMsg') || {}).textContent || '',
  }));
  expect(r.url, '★書けなかったのに 移った★').toContain('dashboard');
  expect(r.msg).toContain('画面を 移りませんでした');
});

// ★★⑪ 従業員／退職者の 切り替え・退職・復職★★ 2026-10-16（司さん）
test('★★⑪ 退職で 従業員から 消えて 退職者に 移り、復職で 戻る★★', async ({ page }) => {
  await kyuryoHiraku(page, '?henshu=1#emp');
  const mae = await page.evaluate(() => ({
    kiriMieru: !!(document.querySelector('#modoruSet #empKiri') || {}).offsetHeight,
    nin: document.querySelectorAll('#empBody [data-taishoku]').length,
  }));
  expect(mae.kiriMieru, '★見出しの 横に 従業員／退職者の 切り替えが 無い★').toBe(true);
  expect(mae.nin, '従業員が 居ない').toBeGreaterThan(0);
  const na = await page.evaluate(() => {
    const b = document.querySelector('#empBody [data-taishoku]');
    return b.closest('tr').querySelector('input[data-f="name"]').value;
  });
  await page.locator('#empBody [data-taishoku]').first().click();
  await page.locator('#empBody .taishoku-hi').fill('2026-09-30');
  await page.locator('#empBody [data-kakutei]').click();
  await page.waitForTimeout(500);
  const ato = await page.evaluate(() => ({
    nin: document.querySelectorAll('#empBody [data-taishoku]').length,
    okutta: window.__EMP_PATCH__ || [],
  }));
  expect(ato.nin, '★退職しても 従業員に 残っている★').toBe(mae.nin - 1);
  expect(ato.okutta[0]).toMatchObject({ active: false, retired_on: '2026-09-30' });
  // 配る 一覧には 残り、その 場で（退職）の 印が 付く 2026-10-17 司さん「退職者のページからでもURLの配付ができないかん」
  //   （10-16 は「消える」だった。わざと壊す：一覧の 描き直しを 外す・印を 外す ⇒ 赤）
  const haifu = await page.evaluate((na) => {
    const fuda = [...document.querySelectorAll('#haifuList .card')].find((c) =>
      c.textContent.includes(na)
    );
    return fuda ? fuda.textContent.includes('（退職）') : null;
  }, na);
  expect(haifu, '★退職した 人が 配る 一覧に 居ない／（退職）の 印が 付いていない★').toBe(true);
  // 退職者：1行目に 辞めた日、2行目に 名前と 復職
  await page.locator('[data-kiri="yame"]').click();
  const yame = await page.evaluate(() =>
    [...document.querySelectorAll('#empBody tr')].map((tr) => ({
      hi: (tr.querySelector('.yame-hi') || {}).textContent || '',
      na: (tr.querySelector('.yame-na span') || {}).textContent || '',
      fuku: !!tr.querySelector('[data-fukushoku]'),
    }))
  );
  const r = yame.find((x) => x.na === na);
  expect(r, '★退職者に 出ていない★').toBeTruthy();
  expect(r.hi).toBe('2026/09/30');
  expect(r.fuku).toBe(true);
  await page.locator('#empBody [data-fukushoku]').first().click();
  await page.waitForTimeout(500);
  const fuku = await page.evaluate(() => window.__EMP_PATCH__);
  expect(fuku[fuku.length - 1]).toMatchObject({ active: true, retired_on: null });
  await page.locator('[data-kiri="ima"]').click();
  const modori = await page.evaluate(
    () => document.querySelectorAll('#empBody [data-taishoku]').length
  );
  expect(modori, '★復職しても 従業員に 戻らない★').toBe(mae.nin);
});

// ★★⑫ 辞めた 人の 明細にも QR・送るが 出る★★ 2026-10-17 司さん「向こうが URL 消すまで 見れないかん・退職者のページからでもURLの配付ができないかん」
//   （10-16 は「出さない」だった＝逆に した。倉庫の 1人ぶん・作り直しも 辞めた 人を 通す。わざと壊す：yameBtnKesu を 戻す ⇒ 赤）
test('★★⑫ 辞めた 人の 明細にも QR・送るが 出る★★', async ({ page }) => {
  const hataraita = [...new Set((FIX.workHours || []).map((w) => w.employee_id))][0];
  const e0 = FIX.emps.find((e) => e.employee_id === hataraita);
  const moto = e0.active;
  e0.active = false;
  try {
    // 試験の 材料は 2026-08 の 働いた 日＝その 月を 開く（今日の 日付に 頼らない・日本と UTC で 同じ 日に なる 時刻）
    await page.clock.setFixedTime(new Date('2026-08-05T03:00:00Z'));
    await kyuryoHiraku(page, '');
    await page.waitForTimeout(800);
    const deteiru = await page.evaluate(
      (id) => !!document.querySelector('.slip-pick[data-emp="' + id + '"]'),
      hataraita
    );
    expect(deteiru, '★働いた 月なのに 辞めた 人の 明細が 出ていない★').toBe(true);
    const r = await page.evaluate((id) => {
      const qr = document.querySelectorAll(
        '[data-meisai-qr="' + id + '"], [data-meisai-okuru="' + id + '"]'
      ).length;
      const hoka = document.querySelectorAll('[data-meisai-qr]').length;
      return {
        qr,
        hoka,
        wake: document.body.innerText.includes('辞めた人には 新しく リンクを 作れません'),
      };
    }, hataraita);
    expect(r.qr, '★辞めた 人に QR・送るが 出ていない★').toBe(2);
    expect(r.wake, '★前の「作れません」の 訳が 残っている★').toBe(false);
    expect(r.hoka, '★今いる人の QR・送るまで 消えた★').toBeGreaterThan(0);
  } finally {
    e0.active = moto;
  }
});

// ★★⑬ 退職が 書けない 時は 訳を 分けて 出し、ボタンを 戻す／先の 日は 送らない★★ 2026-10-17（対立役 N1・N2・N3・N4）
//   前は 倉庫が 断っても 0行でも「通信を 確かめて」と 出し、押した ボタンが 灰色の まま だった。
//   1行の 確かめを 外しても ⑪ は 緑だった（偽物が いつも 1行 返す）＝0行の 道を ここで 縛る。
async function taishokuOsu(page, hi) {
  await page.locator('#empBody [data-taishoku]').first().click();
  await page.locator('#empBody .taishoku-hi').fill(hi);
  await page.locator('#empBody [data-kakutei]').click();
  await page.waitForTimeout(500);
  return page.evaluate(() => ({
    err: (document.getElementById('err') || {}).textContent || '',
    nin: document.querySelectorAll('#empBody input[data-f="name"]').length,
    kakuteiOseru: !!document.querySelector('#empBody [data-kakutei]:not([disabled])'),
    okutta: (window.__EMP_PATCH__ || []).length,
  }));
}
test('★★⑬ 退職が 書けない 時は 訳を 分けて 出し、ボタンを 戻す★★', async ({ page }) => {
  await kyuryoHiraku(page, '?henshu=1#emp');
  const nin = await page.evaluate(
    () => document.querySelectorAll('#empBody input[data-f="name"]').length
  );
  // 0行
  await page.evaluate(() => {
    window.__EMP_NG__ = '0gyou';
  });
  const a = await taishokuOsu(page, '2026-09-30');
  expect(a.okutta, '★送っていない★').toBe(1);
  expect(a.err, '★0行の 訳が 出ていない★').toContain('書けた 行が ありません');
  expect(a.err).not.toContain('通信');
  expect(a.nin, '★書けていないのに 従業員から 消えた★').toBe(nin);
  expect(a.kakuteiOseru, '★失敗の 後も ボタンが 押せない★').toBe(true);
  // 倉庫が 断った（列が 無い）＝倉庫の 言い分を 出す
  await page.evaluate(() => {
    window.__EMP_NG__ = '400';
  });
  await page.locator('#empBody [data-kakutei]').click();
  await page.waitForTimeout(500);
  const b = await page.evaluate(() => ({
    err: (document.getElementById('err') || {}).textContent || '',
    kakuteiOseru: !!document.querySelector('#empBody [data-kakutei]:not([disabled])'),
  }));
  expect(b.err, '★倉庫の 言い分が 出ていない★').toContain('retired_on');
  expect(b.err).toContain('[400]');
  expect(b.kakuteiOseru, '★失敗の 後も ボタンが 押せない★').toBe(true);
});
test('★★⑬-2 先の 日は 辞めた日に できない（送らない）★★', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-17T03:00:00Z'));
  await kyuryoHiraku(page, '?henshu=1#emp');
  const nin = await page.evaluate(
    () => document.querySelectorAll('#empBody input[data-f="name"]').length
  );
  const max = await page.evaluate(() => {
    document.querySelector('#empBody [data-taishoku]').click();
    return document.querySelector('#empBody .taishoku-hi').getAttribute('max');
  });
  expect(max, '★日付の 欄に 上限が 無い★').toBe('2026-10-17');
  await page.locator('#empBody .taishoku-hi').fill('2026-10-18');
  await page.locator('#empBody [data-kakutei]').click();
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    err: (document.getElementById('err') || {}).textContent || '',
    okutta: (window.__EMP_PATCH__ || []).length,
    nin: document.querySelectorAll('#empBody input[data-f="name"]').length,
  }));
  expect(r.okutta, '★先の 日を 送った★').toBe(0);
  expect(r.err).toContain('今日より 先に できません');
  expect(r.nin).toBe(nin);
});

// ★★⑭ 退職者の 辞めた 日は 押すと 直せる★★ 2026-10-17（対立役 N5＝前は 復職して 退職し直すしか 無く、元の 日が 今日に 戻った）
test('★★⑭ 退職者の 辞めた 日を 押して 直す★★', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-17T03:00:00Z'));
  await kyuryoHiraku(page, '?henshu=1#emp');
  await page.locator('#empBody [data-taishoku]').first().click();
  await page.locator('#empBody .taishoku-hi').fill('2026-09-30');
  await page.locator('#empBody [data-kakutei]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-kiri="yame"]').click();
  await page.locator('#empBody [data-hi-naosu]').first().click();
  const mae = await page.locator('#empBody [data-hi-naosu] .taishoku-hi').inputValue();
  expect(mae, '★今の 辞めた 日が 入っていない★').toBe('2026-09-30');
  await page.locator('#empBody [data-hi-naosu] .taishoku-hi').fill('2026-09-01');
  await page.locator('#empBody [data-hi-kakutei]').click();
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    okutta: window.__EMP_PATCH__ || [],
    hi: [...document.querySelectorAll('#empBody .yame-hi')].map((d) => d.textContent),
    fuku: document.querySelectorAll('#empBody [data-fukushoku]').length,
  }));
  expect(r.okutta[r.okutta.length - 1]).toMatchObject({ active: false, retired_on: '2026-09-01' });
  expect(r.hi, '★直した 日が 出ていない★').toContain('2026/09/01');
  expect(r.fuku, '★退職者から 消えた★').toBeGreaterThan(0);
});

// ★★⑮ 退職者の ページから リンクを 配れる★★ 2026-10-17 司さん「退職者のページからでもURLの配付ができないかん」
//   2行（辞めた日／名前と 復職）は そのままに、名前の 横の「配る」で 配る 札を 下に 開く・もう一度 押すと 閉じる。
//   わざと壊して 赤に なった 記録（2026-10-17）：「配る」の ボタンを 消す ⇒ 赤／開く 箱を 描かない ⇒ 赤。戻すと 緑。
test('★★⑮ 退職者の ページの「配る」で 配る 札が 開き、2行の 形は そのまま★★', async ({ page }) => {
  await kyuryoHiraku(page, '?henshu=1#emp');
  await page.locator('[data-kiri="yame"]').click();
  const mae = await page.evaluate(() => ({
    gyo: document.querySelectorAll('#empBody .yame-hi').length,
    na: document.querySelectorAll('#empBody .yame-na span').length,
    fuku: document.querySelectorAll('#empBody [data-fukushoku]').length,
    haifu: document.querySelectorAll('#empBody [data-yame-haifu]').length,
  }));
  expect(mae.gyo, '★退職者が 居ない（見本に 辞めた 人が 1人 居る筈）★').toBeGreaterThan(0);
  expect(mae.na, '★2行目の 名前が 無い★').toBe(mae.gyo);
  expect(mae.fuku, '★復職の ボタンが 無い★').toBe(mae.gyo);
  expect(mae.haifu, '★配る ボタンが 無い★').toBe(mae.gyo);
  await page.locator('#empBody [data-yame-haifu]').first().click();
  const aki = await page.evaluate(() => {
    const b = document.querySelector('#empBody [data-yame-box]');
    return {
      mieru: !!b && b.style.display !== 'none' && b.offsetHeight > 0,
      botan: !!b && !!b.querySelector('[data-hhito], [data-hokuru], [data-hmise], [data-hsai]'),
    };
  });
  expect(aki.mieru, '★配る 札が 開かない★').toBe(true);
  expect(aki.botan, '★配る 札に 配る・送る・見せる・作り直すの どれも 無い★').toBe(true);
  // 配れなかった 時は 訳が 見える（前は 隠れた 設定の 枠の 箱にだけ 書いた・対立役 N1）。
  //   偽の 倉庫は 1人ぶんの 道に 何も 返さない＝配れない 形
  const hhito = page.locator('#empBody [data-yame-box] [data-hhito]');
  expect(
    await hhito.count(),
    '★配る 札に「配る」が 無い（見本の 辞めた 人は まだ 配っていない筈）★'
  ).toBe(1);
  await hhito.first().click();
  await page.waitForTimeout(500);
  const err = await page.evaluate(() => {
    const e = document.getElementById('err');
    return { mieru: !!e && e.offsetParent !== null, ji: (e && e.textContent) || '' };
  });
  expect(err.mieru, '★配れなかった 訳が 見えない★').toBe(true);
  expect(err.ji, '★配れなかった 訳の 字で ない★').toContain('配');
  // 押し直して 通ったら 赤字は 消える（前は 残り、客が 作り直すを 押して 渡した リンクを 殺す 恐れ・対立役 直す1）
  await page.evaluate(() => {
    window.__HITORI_OK__ = true;
  });
  await page.locator('#empBody [data-yame-box] [data-hhito]').first().click();
  await page.waitForTimeout(500);
  const ato = await page.evaluate(() => {
    const e = document.getElementById('err');
    return {
      ji: (e && e.offsetParent !== null && e.textContent) || '',
      fuda: !!document.querySelector(
        '#empBody [data-yame-box] [data-hokuru], #empBody [data-yame-box] [data-hmise]'
      ),
    };
  });
  expect(ato.ji, '★押し直して 通ったのに 赤字が 残っている★').toBe('');
  expect(ato.fuda, '★通った 後に 配る 札（見せる・送る）が 出ない★').toBe(true);
  await page.locator('#empBody [data-yame-haifu]').first().click();
  const toji = await page.evaluate(
    () => (document.querySelector('#empBody [data-yame-box]') || {}).style.display
  );
  expect(toji, '★もう一度 押しても 閉じない★').toBe('none');
});

// ★★⑮-2 配るの 訳を 消す 時に、保存の 失敗 等 他の 訳を 消さない★★ 2026-10-17（対立役：前の 直しは 他の 訳まで 消し、直った 様に 見えた）
//   わざと壊して 赤に なった 記録（2026-10-17）：消す 時に いつも showErr('') を 呼ぶ 形に 戻す ⇒ 赤。戻すと 緑。
test('★★⑮-2 配るの 訳を 消しても 他の 訳は 残る★★', async ({ page }) => {
  await kyuryoHiraku(page, '?henshu=1#emp');
  await page.locator('[data-kiri="yame"]').click();
  // 保存の 失敗 等 他の 所が 画面の 上に 出した 訳（showErr と 同じ 形で 置く）
  await page.evaluate(() => {
    window.__HITORI_OK__ = true;
    const e = document.getElementById('err');
    e.textContent = '保存できませんでした（試し）';
    e.style.display = 'block';
  });
  await page.locator('#empBody [data-yame-haifu]').first().click();
  await page.locator('#empBody [data-yame-box] [data-hhito]').first().click();
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const e = document.getElementById('err');
    return {
      ji: (e && e.textContent) || '',
      fuda: !!document.querySelector(
        '#empBody [data-yame-box] [data-hokuru], #empBody [data-yame-box] [data-hmise]'
      ),
    };
  });
  expect(r.fuda, '★配る 札が 出ない（配るが 通っていない）★').toBe(true);
  expect(r.ji, '★配るを 押したら 保存の 失敗の 訳が 消えた★').toContain(
    '保存できませんでした（試し）'
  );
});
