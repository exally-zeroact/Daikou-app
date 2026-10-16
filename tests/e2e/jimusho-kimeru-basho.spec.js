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
  expect(r.tab.length, '★タブの 数が 違います★').toBe(4);
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
      midashi: (document.getElementById('modoruMidashi') || {}).textContent || '',
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
