// ============================================================
// ★★入力の 画面（nyuryoku.html）の 中身★★ 2026-09-07
//
//   ★司さん★「フッターに作れってこやろがぼけ」
//   ⇒ 打つ 所は ★下の 帯の「入力」1枚★。
//     ここは 前に tests/e2e/uriage-jippi-hairo.spec.js の ④⑤ で 見ていた 事を
//     ★そのまま 引っ越した★物（★見る 中身は 同じ★）。
//
//   ★見張る 事★
//     ①開かずに その場で 打てる（札を 開く 手が 要らない）
//     ②欄は ★会社が 決めた 一覧（dk_expense_kinds）★から 作る
//       （司さん「この項目ってユーザーは自由に決めれるん？」→「ウ」）
//     ③使わない 印の 物は 出さない
//     ④保存の 決まりは ★js/jippi-hozon.js の 1か所★（画面の 中に 書かない）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-07 実測）★★
//     ①「使わない」印を 見ない ……… ★赤★（使わない物が 欄に 出る）
//     ②bindYen() を 呼ばない ………… ★赤 3本★（打っても どこへも 行かない）
//     戻した後 … ★緑★
//
//   ★★見張りが 弱かった（先に 直した）★★
//     はじめ ②で ★緑のまま★＝`function bindYen()` の 字を 数えていた。
//     ⇒ ★呼び出し（bindYen();）★を 見るように 直してから もう一度 壊した。
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'nyuryoku.html'), 'utf8');

const KINDS = [
  { kind_id: 'toll', label: '高速代', sort_order: 10, active: true },
  { kind_id: 'bridge', label: '橋代', sort_order: 20, active: true },
  { kind_id: 'other', label: 'その他', sort_order: 30, active: true },
  { kind_id: 'k1', label: '駐車場代', sort_order: 40, active: true },
  { kind_id: 'k2', label: '使わない物', sort_order: 50, active: false },
];
const SH = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-09-02T10:00:00+09:00',
    ended_at: '2026-09-02T18:00:00Z',
    fare_total_yen: 18800,
    trip_count: 9,
    actual_total_m: 54700,
    total_distance_m: 124700,
  },
];

function stub() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: 'c1', name: 'ZERO代行' };
  return (
    moto +
    ';(function(){var co=' +
    JSON.stringify(co) +
    ';var K=' +
    JSON.stringify(KINDS) +
    ';var SH=' +
    JSON.stringify(SH) +
    ';var S=window.DKSession;' +
    'function rows(p){ if(p.indexOf("dk_expense_kinds")===0)return K; if(p.indexOf("dk_shifts")===0)return SH;' +
    ' if(p.indexOf("dk_device_labels")===0)return [{company_id:"c1",device_id:"d1",label:"4987",sort_order:1}]; return [];}' +
    'S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

test('★★① 開かずに その場で 打てる★★', async () => {
  // ★打った物が 保存に 行くか★＝bindYen を ★呼んでいる★
  //   ★★字が 在るだけでは 駄目★★ 2026-09-07（実測）
  //     はじめ indexOf('bindYen()') で 見ていたが、
  //     ★function bindYen() { …★ の 字にも 当たる ので
  //     ★呼ぶのを やめても 緑のまま★だった（わざと壊して 気づいた）。
  //   ⇒ ★呼び出し（bindYen();）★を 見る。
  expect(/[^n]\s+bindYen\(\);/.test(SRC), '★打っても 保存に 行きません★').toBe(true);
  // ★一覧から 欄を 作っているか★（3つ 固定に 戻していない）
  expect(SRC.indexOf('RAW.kinds'), '★一覧から 欄を 作っていません★').toBeGreaterThan(0);
  expect(SRC.indexOf('k.kind_id'), '★名前ごとの 欄に なっていません★').toBeGreaterThan(0);
  // ★保存の 決まりは 画面の 中に 書かない★
  expect(
    SRC.indexOf('dk_shift_edits?on_conflict'),
    '★保存の 決まりを 画面が 自分で 書いています★'
  ).toBe(-1);
  expect(
    /<script[^>]+src=["']js\/jippi-hozon\.js["']/.test(SRC),
    '★共通の 部品を 読んでいません★'
  ).toBe(true);
});

test('★★② 会社が 足した 名前が 欄に 出る★★', async ({ page }) => {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: stub(),
    })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/nyuryoku.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  // ★見たい 日に 合わせる★（今日が 何日でも 同じ 答えに する）
  await page.fill('#hiSel', '2026-09-02');
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => ({
    // ★★2026-09-11 売上・電子決済が 増えました★★（司さん「車毎に 出す」）
    //   ⇒ ★実費だけ★を 数える（売上・電子決済は 別の 試験が 見る）
    na: [...document.querySelectorAll('#shaList .flabel')]
      .map((x) => x.textContent.trim())
      .filter((x) => x !== '売上' && x !== '電子決済'),
    ran: [...document.querySelectorAll('#shaList [data-sid]')].filter(
      (x) => ['sales_yen', 'denshi_yen'].indexOf(x.getAttribute('data-f')) < 0
    ).length,
    sha: [...document.querySelectorAll('#shaList .sha-na')].map((x) => x.textContent.trim()),
  }));
  // eslint-disable-next-line no-console
  console.log('★入力の 画面★ ' + JSON.stringify(r));
  expect(r.na.join(','), '★足した 名前が 出ていません★').toContain('駐車場代');
  expect(r.na.join(','), '★使わない 印の 物が 出ています★').not.toContain('使わない物');
  // ★車1台 × 使う 名前 4つ ＝ 4つの 欄★
  expect(r.ran, '★欄の 数が 合いません★').toBe(4);
  expect(r.na.length, '★ラベルの 数が 合いません★').toBe(4);
  // ★UUIDは 画面に 出さない★（車の名前は js/car-name.js が 決める）
  expect(r.sha.join(','), '★車の 名前が 出ていません★').toContain('4987');
  expect(/[0-9a-f]{8}-[0-9a-f]{4}/.test(r.sha.join(',')), '★端末IDが そのまま 出ています★').toBe(
    false
  );
});
