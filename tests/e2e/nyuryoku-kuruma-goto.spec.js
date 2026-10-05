// ============================================================
// ★★入力画面は 車ごと★★ 2026-09-11（司さん・写真つき）
//
//   ★司さん★
//     「入力画面での 電子決済は 今 まとめとるの 消して ★車毎に 出す★」
//     「★売上も★ 間違えてたら いかんから 車ごとに
//       ★データ 読み取ってるのは 出して★
//       ★読み取れてないのは 0でいいから 出して 修正できるようにする★」
//     「高速代、橋代など ★設定してるやつを 出せ★」
//     「入力画面で ★どこで 編集できるか 説明書きが いる★／会社設定の 実費で」
//
//   ★★ここで 守る 5つ★★
//     ①日ごとの「電子決済」の 欄は ★1つも 残っていない★
//     ②車ごとに ★売上・電子決済・設定した 実費★ が 並ぶ
//     ③読めている 車 … 売上は ★出すだけ★（打ち直せない）
//     ④読めていない 車 … 売上は ★0 で 打ち直せる★
//     ⑤説明に ★会社設定 → 実費★ と 書いてある
//
//   ★お金の 計算は 1つも 触っていません★
//     メーターが 出した 売上を ★書き換えません★。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-11 実測 ＝ 下に 書く）★★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CO = { company_id: 'c1', name: 'ZERO代行' };
const HI = '2026-09-02';
const LABELS = [
  { company_id: 'c1', device_id: 'd1', label: '4987', sort_order: 1 },
  { company_id: 'c1', device_id: 'd2', label: '1466', sort_order: 2 },
  { company_id: 'c1', device_id: 'd3', label: '1173', sort_order: 3 },
];
// ★d1 だけ 走った★（d2/d3 は 読めていない）
// ★★10-05★★ d1 は ★1日 2回★ 走った（10,000 + 5,200 ＝ 15,200）
//   前は ★最後の 1回だけ★（5,200）出して いた
//   ★使わない 印（excluded）★は 給料・売上表・月次集計が 今 数えているので ここも 数える（外すかは 司さんの 決め）
const SH = [
  { shift_id: 's1', device_id: 'd1', started_at: HI + 'T10:00:00Z', fare_total_yen: 10000 },
  { shift_id: 's1b', device_id: 'd1', started_at: HI + 'T13:00:00Z', fare_total_yen: 5200 },
];
const KINDS = [
  { kind_id: 'toll', label: '高速代', sort_order: 10, active: true },
  { kind_id: 'bridge', label: '橋代', sort_order: 20, active: true },
  { kind_id: 'other', label: 'その他', sort_order: 30, active: true },
  { kind_id: 'kmx1', label: 'その他2', sort_order: 40, active: true },
];

async function hiraku(page, edits, kyoriNai) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const stub =
    moto +
    ';(function(){var D=' +
    JSON.stringify({
      co: CO,
      L: LABELS,
      SH: SH,
      K: KINDS,
      HI: HI,
      E: edits || [],
      KN: !!kyoriNai,
    }) +
    ';var S=window.DKSession;' +
    // ★★材料が 無い時に 黙って 緑に しない★★ 2026-09-11
    //   ★前★ if(!S)return; ＝作り物が 効いていなくても ★そのまま 緑★
    //   ★今★ 印を 立てて ★試験の 側で 赤に する★
    'if(!S){window.__dameSession=1;return;}window.__okutta=[];' +
    'function rows(p){p=String(p);' +
    ' if(p.indexOf("dk_expense_kinds")===0)return D.K;' +
    ' if(p.indexOf("dk_shift_edits")===0)return D.E;' +
    // ★★10-05★★ 作り物は ★頼まれた 列だけ★ 返す（本物の 倉庫と 同じ）
    //   前は 全部の 列を 返したので ★画面が 売上の 列を 頼んでいなくても 緑★ だった
    //   （本物では 走った 車の 売上が いつも 0円）
    ' if(p.indexOf("dk_shifts")===0){var m=/select=([^&]*)/.exec(p);if(!m)return D.SH;' +
    ' var c=decodeURIComponent(m[1]).split(",");return D.SH.map(function(r){var o={};' +
    ' c.forEach(function(k){if(k in r)o[k]=r[k];});return o;});}' +
    ' if(p.indexOf("dk_device_labels")===0)return D.L; return [];}' +
    'S.ensure=function(){return Promise.resolve({access_token:"t"});};' +
    'S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return D.co.company_id;};' +
    'S.pickCompany=function(){return {mode:"one",company:D.co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){' +
    ' return Promise.resolve([D.co]);}});};' +
    'S.rest=function(s,p,o){ if(o&&o.method)window.__okutta.push({saki:p,body:o.body});' +
    // ★距離の 列が まだ 無い 倉庫★＝本物は 400 を 返す
    ' if(D.KN&&(String(p).indexOf("select=actual_total_m")>=0||String(p).indexOf("select=seikyu_yen")>=0))return Promise.resolve({ok:false,status:400,' +
    ' text:function(){return Promise.resolve("");},json:function(){return Promise.resolve({});}});' +
    ' return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},' +
    ' json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: stub })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/nyuryoku.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.fill('#hiSel', HI);
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(1500);
  // ★作り物が 効いているか 確かめる★（効いていないのに 緑に しない）
  const dame = await page.evaluate(() => !!window.__dameSession);
  expect(dame, '★作り物（DKSession）が 効いていません★＝この 試験は 何も 見ていません').toBe(false);
}

test('★★① 日ごとの 電子決済の 欄は 残っていない★★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page);
  const r = await page.evaluate(() => ({
    furui: !!document.getElementById('denshiYen'),
    sha: document.querySelectorAll('.sha').length,
  }));
  // eslint-disable-next-line no-console
  console.log('★古い 欄★ ' + JSON.stringify(r));
  expect(err, '★画面が 落ちました★').toEqual([]);
  expect(r.furui, '★日ごとの 電子決済の 欄が 残っています★').toBe(false);
  expect(r.sha, '★車が 1台も 出ていません★').toBeGreaterThan(0);
});

test('★★② 車ごとに 売上・電子決済・設定した 実費が 並ぶ★★', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(() =>
    [...document.querySelectorAll('.sha')].map((d) => ({
      na: ((d.querySelector('.sha-na') || {}).textContent || '').trim(),
      ran: [...d.querySelectorAll('.frow')].map((f) =>
        ((f.querySelector('.flabel') || {}).textContent || '').trim()
      ),
    }))
  );
  // eslint-disable-next-line no-console
  console.log('★車ごと★ ' + JSON.stringify(r));
  expect(
    r.map((x) => x.na),
    '★会社の 車が 全部 出ていません★'
  ).toEqual(['4987', '1466', '1173']);
  // ★★10-05★★ 読めていない 車（1466・1173）だけ ★回数・実車距離・総走行距離★ が 増える
  //   読めた 車（4987）は メーターの 数を 使うので 出さない
  r.forEach((x) => {
    const kyori = x.na === '4987' ? [] : ['回数', '実車距離', '総走行距離'];
    expect(x.ran, '★' + x.na + ' の 欄が 違います★').toEqual([
      '売上',
      ...kyori,
      '電子決済',
      '請求書', // ★10-06 司さん「両方に 対応しろ」＝車ごとに 請求書を 打てる★
      '高速代',
      '橋代',
      'その他',
      'その他2',
    ]);
  });
});

test('★★③ 読めている 車は 売上を 出すだけ／読めていない 車は 打ち直せる★★', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(() =>
    [...document.querySelectorAll('.sha')].map((d) => {
      const f = d.querySelectorAll('.frow')[0];
      const i = f.querySelector('input');
      return {
        na: ((d.querySelector('.sha-na') || {}).textContent || '').trim(),
        atai: i.value,
        utenai: i.disabled,
        hint: ((f.querySelector('.hint') || {}).textContent || '').trim(),
      };
    })
  );
  // eslint-disable-next-line no-console
  console.log('★売上の 欄★ ' + JSON.stringify(r));
  const yonda = r.filter((x) => x.na === '4987')[0];
  expect(yonda.atai, '★読めた 売上が 出ていません★').toBe('15200');
  expect(yonda.utenai, '★読めた 売上が 打ち直せます★（メーターの 数字は 変えません）').toBe(true);
  expect(yonda.hint, '★読めている 事を 書いていません★').toContain('読めています');

  r.filter((x) => x.na !== '4987').forEach((x) => {
    expect(x.utenai, '★' + x.na + ' の 売上が 打ち直せません★').toBe(false);
    expect(x.hint, '★' + x.na + ' に 読み取れていない 事を 書いていません★').toContain(
      '読み取れていません'
    );
  });
});

test('★★④ 打った 値が 車の 鍵で 送られる★★', async ({ page }) => {
  await hiraku(page);
  await page.evaluate(() => {
    window.__okutta = [];
  });
  // ★読めていない 車（1173）の 売上を 打つ★
  const ran = page.locator('.sha', { hasText: '1173' }).locator('input').first();
  await ran.fill('3000');
  await ran.dispatchEvent('change');
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => window.__okutta || []);
  // eslint-disable-next-line no-console
  console.log('★送った 中身★ ' + JSON.stringify(r));
  expect(r.length, '★何も 送っていません★').toBeGreaterThan(0);
  const b = JSON.parse(r[r.length - 1].body);
  expect(r[r.length - 1].saki, '★送り先が 車ごとの 棚では ありません★').toContain('dk_manual_days');
  expect(b.device_id, '★どの 車か 付いていません★').toBe('d3');
  expect(b.sales_yen, '★打った 売上が 入っていません★').toBe(3000);
});

test('★★⑤ どこで 名前を 変えるか 書いてある★★', async ({ page }) => {
  await hiraku(page);
  const ji = await page.evaluate(() => {
    const n = document.querySelector('.note');
    return n ? (n.innerText || '').replace(/\s+/g, ' ') : '';
  });
  // eslint-disable-next-line no-console
  console.log('★説明★ ' + JSON.stringify(ji));
  expect(ji, '★会社設定で 変えられる 事を 書いていません★').toContain('会社設定');
  expect(ji, '★実費 と 書いていません★').toContain('実費');
  expect(ji, '★読み取れていない 車の 事を 書いていません★').toContain('0');
  expect(ji, '★距離を 打てる 事を 書いていません★').toContain('実車距離');
  expect(ji, '★距離は 変わらないと 書いたまま（もう 打てる）★').not.toContain(
    '距離の 数字は 変わりません'
  );
});

// ★★⑥ 10-05 司さん「車ごとに回数や実車距離や総走行距離を入れる欄」★★
//   km で 打つ ⇒ ★メートル★で 送る（メーターと 同じ 単位）・回数は 整数
test('★★⑥ 回数・実車距離・総走行距離は 車の 鍵で メートルで 送られる★★', async ({ page }) => {
  await hiraku(page);
  const sha = page.locator('.sha', { hasText: '1466' });
  const utsu = async (f, v) => {
    await page.evaluate(() => {
      window.__okutta = [];
    });
    const i = sha.locator('input[data-f="' + f + '"]');
    await i.fill(v);
    await i.dispatchEvent('change');
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => window.__okutta || []);
    expect(r.length, '★' + f + ' を 打っても 何も 送っていません★').toBeGreaterThan(0);
    expect(r[r.length - 1].saki, '★送り先が 違います★').toContain('dk_manual_days');
    return JSON.parse(r[r.length - 1].body);
  };
  const a = await utsu('trip_count', '7');
  expect(a.device_id, '★どの 車か 違います★').toBe('d2');
  expect(a.trip_count, '★回数が 入っていません★').toBe(7);
  const b = await utsu('actual_total_km', '12.3');
  expect(b.actual_total_m, '★実車距離が メートルに なっていません★').toBe(12300);
  expect(b.trip_count, '★前に 打った 回数が 消えました★').toBe(7);
  const c = await utsu('total_distance_km', '45.6');
  expect(c.total_distance_m, '★総走行距離が メートルに なっていません★').toBe(45600);
  expect(c.actual_total_m, '★前に 打った 実車距離が 消えました★').toBe(12300);
  // ★読めた 車には 距離の 欄が 無い★
  const n = await page
    .locator('.sha', { hasText: '4987' })
    .locator('input[data-f="actual_total_km"]')
    .count();
  expect(n, '★読めた 車に 距離の 欄が 出ています★').toBe(0);
});

// ★★⑦ 10-05 対立役「1日 2回 走った 車の 実費が 消えて見え、打ち直すと 二重に 引かれる」★★
//   入れ先は ★最後の 回★（前の 版と 同じ）。★別の 回にも 額が 在る★ 時は 合計を 出して 打たせない
const ED = (id, toll) => ({
  shift_id: id,
  company_id: 'c1',
  toll_yen: toll,
  bridge_yen: 0,
  other_yen: 0,
  denshi_yen: 0,
  expenses: {},
});
async function d1Kouso(page) {
  return page.evaluate(() => {
    const d = [...document.querySelectorAll('.sha')].find((x) => x.textContent.includes('4987'));
    const i = d.querySelector('input[data-f="toll"]');
    return {
      atai: i.value,
      utenai: i.disabled,
      sid: i.getAttribute('data-sid'),
      hint: (d.querySelector('.fuku') || {}).textContent || '',
    };
  });
}
test('★★⑦-1 前の 版で 最後の 回に 打った 実費は そのまま 見えて 打てる★★', async ({ page }) => {
  await hiraku(page, [ED('s1b', 1000)]);
  const r = await d1Kouso(page);
  // eslint-disable-next-line no-console
  console.log('★⑦-1★ ' + JSON.stringify(r));
  expect(r.atai, '★前に 打った 高速代が 消えて 見えます★').toBe('1000');
  expect(r.sid, '★入れ先が 最後の 回では ありません★').toBe('s1b');
  expect(r.utenai, '★打てません★').toBe(false);
});
test('★★⑦-2 別の 回にも 額が 在る 時は 合計を 出して 打たせない★★', async ({ page }) => {
  await hiraku(page, [ED('s1', 700), ED('s1b', 1000)]);
  const r = await d1Kouso(page);
  // eslint-disable-next-line no-console
  console.log('★⑦-2★ ' + JSON.stringify(r));
  expect(r.atai, '★2回ぶんの 合計が 出ていません★').toBe('1700');
  expect(r.utenai, '★打てます（打つと 二重に 引かれる）★').toBe(true);
  expect(r.hint, '★なぜ 打てないか 書いていません★').toContain('売上表で');
});

// ★★⑧ 10-05 倉庫に 距離の 列が まだ 無い 線（本番に SQL を 当てる 前）★★
//   打っても 400 で 保存できない 欄は 出さない。回数（前から 在る 列）は 出す
test('★★⑧ 距離の 列が 無い 倉庫では 距離の 欄を 出さない★★', async ({ page }) => {
  await hiraku(page, [], true);
  const r = await page.evaluate(() =>
    [...document.querySelectorAll('.sha')].map((d) => ({
      na: ((d.querySelector('.sha-na') || {}).textContent || '').trim(),
      ran: [...d.querySelectorAll('.frow .flabel')].map((x) => x.textContent.trim()),
    }))
  );
  // eslint-disable-next-line no-console
  console.log('★列が 無い 倉庫★ ' + JSON.stringify(r));
  const x = r.find((v) => v.na === '1466');
  expect(x.ran, '★回数が 消えました（前から 在る 列）★').toContain('回数');
  expect(x.ran, '★保存できない 実車距離の 欄が 出ています★').not.toContain('実車距離');
  expect(x.ran, '★保存できない 総走行距離の 欄が 出ています★').not.toContain('総走行距離');
  expect(x.ran, '★売上が 消えました★').toContain('売上');
  expect(x.ran, '★列が 無いのに 請求書の 欄が 出ています★（打っても 保存できない）').not.toContain(
    '請求書'
  );
});

// ★★⑨ 10-06 請求書は 車の 鍵で seikyu_yen に 送る（実費＝expenses には 入れない）★★
test('★★⑨ 請求書は 車ごとに 打てて seikyu_yen で 送られる★★', async ({ page }) => {
  await hiraku(page);
  for (const [na, saki] of [
    ['4987', 'dk_shift_edits'],
    ['1466', 'dk_manual_days'],
  ]) {
    await page.evaluate(() => {
      window.__okutta = [];
    });
    const i = page.locator('.sha', { hasText: na }).locator('input[data-f="seikyu_yen"]');
    await i.fill('8600');
    await i.dispatchEvent('change');
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => window.__okutta || []);
    expect(r.length, '★' + na + ' の 請求書を 打っても 送っていません★').toBeGreaterThan(0);
    const b = JSON.parse(r[r.length - 1].body);
    expect(r[r.length - 1].saki, '★送り先が 違います★').toContain(saki);
    expect(b.seikyu_yen, '★請求書が 入っていません★').toBe(8600);
    expect(b.expenses || {}, '★請求書を 実費に 入れています（売上から 引かれる）★').toEqual({});
  }
});
