// ============================================================
// ★★入力の 画面で 請求書アプリの 明細を 1行ずつ 直す★★ 2026-11-14 件⑧b
//
//   司さん 11-14「お互い修正したら反映されるようにしろ」（入力→請求書アプリ の 向き）
//   設計 4.1（C:/Users/zeroa/sekkei_nyuryoku_kara_meisai_2026-11-14.md）：
//     窓 dk_meisai_gyou で 車×日の 明細を 出し、直すのは 倉庫の 関数 rpc/dk_meisai_naosu（1つの 取引）
//
//   ★ここで 守る 物★
//     ① その 日・その 車の 明細だけ 1行ずつ 出す（別の 日の 行は 出さない・明細の 無い 車には 出さない）
//     ② 直すと rpc に { p_meisai_id, p_amount, p_hikae（読んだ 時の 額） } を 1回 送り、読み直す・外した 件数を 言う
//     ③ 空・同じ 額は 呼ばない（空は 元の 額に 戻す＝手打ちを 黙って 外さない）
//     ④ 読めない 字（-5・1.5・1e3・上を 越える）は 送らず 赤い 字
//     ⑤ chigau（別の 画面で 直された）＝打った 額は 入れず 読み直した 額を 出す・訳の 字
//     ⑥ 届いたか 分からない（5xx・通信）は 言い切らない／401・404 は 何も 変わっていないと 言う
//     ⑦ 返事を 待つ 間は その 車の 欄を 止める（後から 打った 額を 関数が 黙って 外さない）
//     ⑧ 窓が 無い 線（404）＝出さない・赤くしない／他の 失敗・1000行＝赤い 字（黙って 行を 欠かさない）
//
//   ★★この 試験で 見つけた 穴（2026-11-14 実測）★★
//     欄を 止める（disabled）と blur で もう一度 change が 出て、同じ 控えで rpc を 2回 送っていた
//     （本物の 倉庫は 2回目を chigau で 断る＝直ったのに「別の 画面で 直されていました」と 嘘の 字）
//     ⇒ MEISAI_MACHI（返事を 待つ 行）を 止める 前に 立てる。無いと ②⑤⑥⑦ が 赤（9本）
//   ★★わざと壊して 赤に なるのを 見た（2026-11-14 実測・戻して cmp 一致）★★
//     load で 明細の 日を 見ない ⇒ ① 赤／同じ 額の 門を 外す ⇒ ③ 赤／欄を 止めない ⇒ ⑦ 赤
//     5xx の 字を not_yours に する ⇒ ⑥ 5xx 赤／窓 404 を 読めない 扱い ⇒ ⑧ 窓が 無い 赤
// ============================================================
const { test, expect } = require('@playwright/test');
const { zenbuAkeru } = require('./nyuryoku-akeru.js');
const fs = require('fs');
const path = require('path');

const CO = { company_id: 'c1', name: 'ZERO代行' };
const HI = '2026-09-02';
const LABELS = [
  { company_id: 'c1', device_id: 'd1', label: '4987', sort_order: 1 },
  { company_id: 'c1', device_id: 'd2', label: '1466', sort_order: 2 },
];
const SH = [
  { shift_id: 's1', device_id: 'd1', started_at: HI + 'T10:00:00Z', fare_total_yen: 10000 },
  { shift_id: 's1b', device_id: 'd1', started_at: HI + 'T13:00:00Z', fare_total_yen: 5200 },
  { shift_id: 's2', device_id: 'd2', started_at: HI + 'T11:00:00Z', fare_total_yen: 8000 },
];
// 明細の 行。d2（s2）は 明細なし。m9 は 別の 日（請求書アプリで 日を 動かした 行）＝出さない
const M = [
  {
    id: 'm1',
    shift_id: 's1',
    date: HI,
    company: '山田商店',
    name: '山田',
    destination: '駅前',
    amount: 3000,
    seq: 1,
  },
  {
    id: 'm2',
    shift_id: 's1b',
    date: HI,
    company: '',
    name: '佐藤',
    destination: '',
    amount: 2000,
    seq: 1,
  },
  {
    id: 'm9',
    shift_id: 's1',
    date: '2026-09-03',
    company: '別の日',
    name: '',
    destination: '',
    amount: 999,
    seq: 2,
  },
];

// opt.mado＝'ok'|'nai'(404)|'dame'(500)|'ooi'(1000行)
// opt.kotae＝rpc の 返事 { status, json, ato（直した 後の 明細の 額）, matsu（true＝試験が 解くまで 返さない） }
async function hiraku(page, opt) {
  opt = opt || {};
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const stub =
    moto +
    ';(function(){var D=' +
    JSON.stringify({
      co: CO,
      L: LABELS,
      SH: SH,
      HI: HI,
      M: M,
      MADO: opt.mado || 'ok',
      K: opt.kotae || null,
    }) +
    ';var S=window.DKSession;' +
    'if(!S){window.__dameSession=1;return;}window.__okutta=[];window.__mYonda=0;' +
    'function rows(p){p=String(p);' +
    ' if(p.indexOf("dk_meisai_gyou")===0){window.__mYonda++;' +
    '  if(D.MADO==="ooi"){var a=[];for(var i=0;i<1000;i++)a.push({id:"x"+i,shift_id:"s1",date:D.HI,amount:1,seq:i});return a;}' +
    '  var m=/date=eq\\.([^&]*)/.exec(p);var hi=m?decodeURIComponent(m[1]):null;' +
    // 日で 絞らない 返事も 混ぜる（画面の 側でも 日を 見る 事を 縛る）
    '  return D.M.map(function(r){return Object.assign({},r);});}' +
    ' if(p.indexOf("dk_shifts")===0){var m=/select=([^&]*)/.exec(p);if(!m)return D.SH;' +
    ' var c=decodeURIComponent(m[1]).split(",");return D.SH.map(function(r){var o={};' +
    ' c.forEach(function(k){if(k in r)o[k]=r[k];});return o;});}' +
    ' if(p.indexOf("dk_device_labels")===0)return D.L; return [];}' +
    'function res(st,j){return {ok:st>=200&&st<300,status:st,text:function(){return Promise.resolve(JSON.stringify(j));},' +
    ' json:function(){return j===undefined?Promise.reject(new Error("no json")):Promise.resolve(j);}};}' +
    'S.ensure=function(){return Promise.resolve({access_token:"t"});};' +
    'S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return D.co.company_id;};' +
    'S.pickCompany=function(){return {mode:"one",company:D.co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){' +
    ' return Promise.resolve([D.co]);}});};' +
    'S.rest=function(s,p,o){p=String(p); if(o&&o.method)window.__okutta.push({saki:p,body:o.body});' +
    ' if(p.indexOf("rpc/dk_meisai_naosu")===0){var K=D.K||{status:200,json:{ok:true,uriage_hazushita:0,seikyu_hazushita:0}};' +
    '  var b=JSON.parse(o.body);' +
    '  var kaesu=function(){if(K.ato!==undefined)D.M.forEach(function(r){if(r.id===b.p_meisai_id)r.amount=K.ato;});' +
    '   return K.tsuushin?Promise.reject(new TypeError("Failed to fetch")):res(K.status,K.json);};' +
    '  if(K.matsu)return new Promise(function(ok){window.__tokeru=function(){ok(kaesu());};});' +
    '  return Promise.resolve(kaesu());}' +
    ' if(p.indexOf("dk_meisai_gyou")===0&&D.MADO==="nai")return Promise.resolve(res(404,{}));' +
    ' if(p.indexOf("dk_meisai_gyou")===0&&D.MADO==="dame")return Promise.resolve(res(500,{}));' +
    ' return Promise.resolve(res(200,rows(p)));};' +
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
  await zenbuAkeru(page);
  const dame = await page.evaluate(() => !!window.__dameSession);
  expect(dame, '★作り物（DKSession）が 効いていません★＝この 試験は 何も 見ていません').toBe(false);
}

const errJi = (page) =>
  page.evaluate(() => (document.getElementById('err') || {}).textContent || '');
const okutta = (page) =>
  page.evaluate(() =>
    (window.__okutta || []).filter((x) => x.saki.indexOf('rpc/dk_meisai_naosu') === 0)
  );
const gyou = (page, id) => page.locator('#shaList input[data-meisai-id="' + id + '"]');

async function utsu(page, id, ji) {
  await gyou(page, id).fill(ji);
  await gyou(page, id).dispatchEvent('change');
  await page.waitForTimeout(700);
}

test('★★① その 日・その 車の 明細だけ 1行ずつ（別の 日の 行・明細の 無い 車には 出さない）★★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page);
  expect(err, '★画面が 落ちました★').toEqual([]);
  const d1 = page
    .locator('.sha', { hasText: '4987' })
    .locator('.meisai-gyou input[data-meisai-id]');
  await expect(d1, '★4987 の 明細が 2行 で ない★').toHaveCount(2);
  expect(await gyou(page, 'm1').inputValue()).toBe('3000');
  expect(await gyou(page, 'm2').inputValue()).toBe('2000');
  await expect(gyou(page, 'm9'), '★別の 日の 明細（999）を 出した★').toHaveCount(0);
  await expect(
    page.locator('.sha', { hasText: '1466' }).locator('.meisai-gyou'),
    '★明細の 無い 車に 明細の 欄を 出した★'
  ).toHaveCount(0);
  const ji = await page.locator('.sha', { hasText: '4987' }).locator('.meisai-gyou').textContent();
  expect(ji).toContain('山田商店 山田（駅前）');
  expect(ji).toContain('09/02');
  expect(ji).toContain('請求書アプリの 明細（2行）');
  await expect(
    page.locator('.sha', { hasText: '4987' }).locator('.meisai-gyou .kai-ttl'),
    '★明細の 見出しが 無い（上の 欄の 説明と 見分けられない）★'
  ).toHaveText('請求書アプリの 明細（2行）');
});

test('★★② 直す＝rpc に 額と 控えを 1回・読み直す・外した 件数を 言う★★', async ({ page }) => {
  await hiraku(page, {
    kotae: { status: 200, json: { ok: true, uriage_hazushita: 1, seikyu_hazushita: 2 }, ato: 3500 },
  });
  const mae = await page.evaluate(() => window.__mYonda);
  await utsu(page, 'm1', '3,500');
  const r = await okutta(page);
  expect(r.length, '★rpc を 1回 呼んでいない★').toBe(1);
  expect(JSON.parse(r[0].body)).toEqual({ p_meisai_id: 'm1', p_amount: 3500, p_hikae: 3000 });
  expect(
    await page.evaluate(() => window.__mYonda),
    '★直した 後に 読み直していない★'
  ).toBeGreaterThan(mae);
  expect(await gyou(page, 'm1').inputValue()).toBe('3500');
  const kekka = await page.locator('[data-meisai-kekka]').textContent();
  expect(kekka).toContain('直しました');
  expect(kekka).toContain('売上（1件）');
  expect(kekka).toContain('請求書の 額（2件）');
  expect(await errJi(page)).toBe('');
});

test('★★③ 空・同じ 額は 呼ばない（空は 元の 額に 戻す）★★', async ({ page }) => {
  await hiraku(page);
  await utsu(page, 'm1', '');
  expect(await gyou(page, 'm1').inputValue(), '★空を 元の 額に 戻していない★').toBe('3000');
  await utsu(page, 'm1', '3000');
  await utsu(page, 'm2', '2,000');
  expect((await okutta(page)).length, '★空・同じ 額で 呼んだ（手打ちを 黙って 外す）★').toBe(0);
});

test('★★④ 読めない 字は 送らず 赤い 字★★', async ({ page }) => {
  await hiraku(page);
  for (const ji of ['-5', '1.5', '1e3', '9999999999']) {
    await utsu(page, 'm1', ji);
    expect((await okutta(page)).length, '★読めない「' + ji + '」を 送った★').toBe(0);
    expect(await errJi(page), '★「' + ji + '」で 赤い 字が 出ない★').toContain('0以上の 整数');
  }
  // 正しい 額を 打てば 字は 消える
  await utsu(page, 'm1', '3100');
  expect(await errJi(page)).not.toContain('0以上の 整数');
});

test('★★⑤ chigau＝打った 額は 入れず 読み直した 額・訳の 字★★', async ({ page }) => {
  await hiraku(page, { kotae: { status: 200, json: { ok: false, reason: 'chigau' }, ato: 3200 } });
  await utsu(page, 'm1', '3500');
  expect((await okutta(page)).length).toBe(1);
  expect(await gyou(page, 'm1').inputValue(), '★読み直した 額（3200）で ない★').toBe('3200');
  expect(await errJi(page)).toContain('別の 画面で 直されていました');
  await expect(page.locator('[data-meisai-kekka]'), '★断られたのに「直しました」★').toHaveCount(0);
});

for (const [na, kotae, kitai] of [
  ['5xx', { status: 503, json: { message: 'x' } }, '届いたか 分かりません'],
  ['通信', { tsuushin: true }, '届いたか 分かりません'],
  ['返事が 読めない', { status: 200 }, '届いたか 分かりません'],
  ['401', { status: 401, json: {} }, 'ログインが 切れました'],
  ['404', { status: 404, json: {} }, '仕組みが まだ ありません'],
  ['not_yours', { status: 200, json: { ok: false, reason: 'not_yours' } }, '何も 変わっていません'],
]) {
  test('★★⑥ ' + na + ' の 字（届いたか 分からない 時は 言い切らない）★★', async ({ page }) => {
    await hiraku(page, { kotae });
    await utsu(page, 'm1', '3500');
    expect((await okutta(page)).length).toBe(1);
    const e = await errJi(page);
    // eslint-disable-next-line no-console
    console.log('★⑥ ' + na + '★ ' + JSON.stringify(e));
    expect(e).toContain(kitai);
    if (kitai === '届いたか 分かりません') expect(e).not.toContain('何も 変わっていません');
    await expect(page.locator('[data-meisai-kekka]')).toHaveCount(0);
  });
}

test('★★⑦ 返事を 待つ 間は その 車の 欄を 止める・返事の 後は 戻す★★', async ({ page }) => {
  await hiraku(page, {
    kotae: {
      status: 200,
      json: { ok: true, uriage_hazushita: 0, seikyu_hazushita: 0 },
      ato: 3500,
      matsu: true,
    },
  });
  await utsu(page, 'm1', '3500');
  const car = page.locator('.sha', { hasText: '4987' });
  expect(await gyou(page, 'm2').isDisabled(), '★待つ 間に 同じ 車の 明細を 打てる★').toBe(true);
  expect(
    await car.locator('.ran-ue input[data-f="seikyu_yen"]').isDisabled(),
    '★待つ 間に 同じ 車の 請求書の 欄を 打てる（関数が 黙って 外す）★'
  ).toBe(true);
  expect(
    await page.locator('.sha', { hasText: '1466' }).locator('.ran-ue input').first().isDisabled(),
    '★別の 車まで 止めた★'
  ).toBe(false);
  await page.evaluate(() => window.__tokeru());
  await page.waitForTimeout(900);
  expect(await gyou(page, 'm2').isDisabled(), '★返事の 後も 止まった まま★').toBe(false);
  expect(await gyou(page, 'm1').inputValue()).toBe('3500');
});

test('★★⑧ 窓が 無い 線（404）＝出さない・赤くしない★★', async ({ page }) => {
  await hiraku(page, { mado: 'nai' });
  await expect(page.locator('.meisai-gyou')).toHaveCount(0);
  await expect(page.locator('[data-meisai-ng]')).toHaveCount(0);
});

for (const mado of ['dame', 'ooi']) {
  test('★★⑧ 窓が 読めない（' + mado + '）＝赤い 字・行は 出さない★★', async ({ page }) => {
    await hiraku(page, { mado });
    await expect(page.locator('.meisai-gyou')).toHaveCount(0);
    await expect(page.locator('[data-meisai-ng]').first(), '★読めないのに 黙った★').toBeVisible();
  });
}
