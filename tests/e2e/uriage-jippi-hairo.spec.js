// ============================================================
// ★★高速代・橋代を「入れる 所」が 見つかるか★★ 2026-09-06（司さん）
//
//   ★司さんの言葉★「橋代や高速代など入力するタブは？」
//
//   ★実測（言われて 調べた）★
//     ★入れる 所は 前から 在りました★（uriage.html の 車の札 →「日ごと ▾」の 中）。
//     ・売上表の 上には「売上から 引くもの ☑高速代 ☑橋代」の ★チェックだけ★ 在る
//     ・でも ★入れる 欄は 札を 開かないと 出て こない★
//     ⇒ ★在るのに 見つからない＝無いのと 同じ★。司さんは 2週間 気づけませんでした。
//
//   ★直し★（★中身は 1つも 変えていません★／★どこに 在るかを 書いただけ★）
//     ①札の 名前 …「日ごと ▾」→「★日ごと ▾（高速代・橋代を 入れる）★」
//     ②紙の 表の すぐ下に ★道順の 1行★ を 出す
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①札の 名前を「日ごと ▾」に 戻す … ★赤★
//     ②道順の 1行を 消す ……………… ★赤★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'uriage.html'), 'utf8');

test('★★① 札の 名前に「高速代・橋代を 入れる」と 書いてある★★', async () => {
  // ★振る舞いで 見る★＝画面に 出る 字（openText）そのもの
  //   ★札は 2つ 在ります★
  //     ・車ごと の 中 …「日ごと ▾」→ ★shiftLine＝ここに 入れる 欄が 在る★
  //     ・日ごと の 中 …「車ごと ▾」→ carLine（入れる 欄は 無い）
  //   ⇒ ★入れる 欄に 繋がる 方（shiftLine の 札）だけ★ を 見る
  const re = /openText:\s*'([^']*)'[\s\S]{0,120}?detail:\s*[^\n]*?(\w+)\)\.join/g;
  const fuda = {};
  let m;
  while ((m = re.exec(SRC))) fuda[m[2]] = m[1];
  // eslint-disable-next-line no-console
  console.log('★札の 名前★ ' + JSON.stringify(fuda));
  const ji = fuda.shiftLine || '';
  expect(ji, '★入れる欄に 繋がる 札が 読めません（形が 変わりました）★').toBeTruthy();
  expect(ji, '★開かないと 何が 在るか 分かりません★').toContain('高速代');
  expect(ji, '★開かないと 何が 在るか 分かりません★').toContain('橋代');
});

// ★画面を 開かずに 実物の 中身で 見る★
//   （事務所の 画面は ログインが 無いと login.html へ 飛ぶので、
//     ★見たいのは 置き場所と 字★＝実物の HTML を そのまま 読む方が 確か）
test('★★② 実費を 入れる 所が 紙の 表の すぐ下に 書いてある★★', async () => {
  const t = SRC.indexOf('id="kamiTbl"');
  const n = SRC.indexOf('id="jippiNote"');
  // eslint-disable-next-line no-console
  console.log('★置き場所★ 紙の表=' + t + ' / 道順=' + n);
  expect(n, '★実費の 道順が ありません★').toBeGreaterThan(0);
  expect(n, '★紙の 表より 上に 在ります（順番が 逆）★').toBeGreaterThan(t);
  const ji = SRC.slice(n, n + 400).replace(/\s+/g, '');
  expect(ji, '★高速代・橋代と 書いていません★').toContain('高速代');
  expect(ji, '★高速代・橋代と 書いていません★').toContain('橋代');
  // ★★道順は「入力タブ」を 指す★★ 2026-09-06（司さん「入力するなら入力タブつくれよ」）
  //   ★前★「下の 札を 開け」と 書いていた ⇒ ★開かないと 打てない のは 同じ★だった
  expect(ji, '★入力タブを 指していません★').toContain('実費入力');
});

test('★★③ 入れる 欄そのものは 前から 在る（消していない）★★', async () => {
  // ★直しで 中身を 消していない事★＝3つの 欄が そのまま 在る
  ['toll_yen', 'bridge_yen', 'other_yen'].forEach(function (f) {
    expect(SRC.indexOf('data-f="' + f + '"'), '★' + f + ' の 欄が 消えています★').toBeGreaterThan(
      0
    );
  });
});

// ★★入力タブ★★ 2026-09-06（司さん「入力するなら入力タブつくれよ」）
//   ★札の 名前を 変えただけでは 足りませんでした★＝開かないと 打てない のは 同じ。
//   ⇒ ★車ごと／日ごと の 横に「実費を 入れる」を 足し、日ごとに 1行 そのまま 打てる★
//   ★入れる 先も 保存の 仕方も 前と 同じ★（data-sid / data-f / saveEdit）
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①segIn のボタンを 消す ………… ★赤★
//     ②入力タブの 中で bindYen() を 呼ばない … ★赤★（打っても 保存に 行かない）
test('★★④ 入力タブが 在り、開かずに 打てる★★', async () => {
  // ★ボタンが 3つ 在るか★（実物の 中身で 見る）
  ['segCar', 'segDay', 'segIn'].forEach(function (id) {
    expect(SRC.indexOf('id="' + id + '"'), '★' + id + ' が ありません★').toBeGreaterThan(0);
  });
  // ★入力タブの 中で 3つの 欄を 作っているか★
  const i = SRC.indexOf("MODE === 'in'");
  expect(i, '★入力タブの 中身が ありません★').toBeGreaterThan(0);
  const naka = SRC.slice(i, i + 3000);
  // ★★中身を 変えました（黙って 数だけ 動かさない）★★ 2026-09-06
  //   ★前★ toll_yen / bridge_yen / other_yen を 直に 書いていた（★3つ 固定★）
  //   ★今★ ★会社が 決めた 一覧（RAW.kinds）から 欄を 作る★
  //     （司さん「この項目ってユーザーは自由に決めれるん？」→「ウ」）
  expect(naka.indexOf('RAW.kinds'), '★一覧から 欄を 作っていません★').toBeGreaterThan(0);
  expect(naka.indexOf('k.kind_id'), '★名前ごとの 欄に なっていません★').toBeGreaterThan(0);
  // ★打った物が 保存に 行くか★＝bindYen を 呼んでいる
  expect(naka.indexOf('bindYen()'), '★打っても 保存に 行きません★').toBeGreaterThan(0);
  // ★保存の 決まりは 1か所だけ★（2か所に 書かない）
  expect(
    (SRC.match(/saveEdit\(i\.getAttribute/g) || []).length,
    '★保存の 決まりが 2か所に 在ります★'
  ).toBe(1);
});

// ★★足した 名前が 入力タブに 出る★★ 2026-09-06（司さん「自由に 足せる ように」→「ウ」）
//   ★前は 高速代・橋代・その他の 3つ 固定★（倉庫の 列が 3本）
//   ⇒ 会社が 決めた 一覧（dk_expense_kinds）から 見出しも 欄も 作る。
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①一覧を 読まない（RAW.kinds を 使わない）… ★赤★
test('★★⑤ 会社が 足した 名前が 入力タブに 出る★★', async ({ page }) => {
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
      started_at: '2026-09-02T10:00:00Z',
      ended_at: '2026-09-02T18:00:00Z',
      fare_total_yen: 18800,
      trip_count: 9,
      actual_total_m: 54700,
      total_distance_m: 124700,
    },
  ];
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: 'c1', name: 'ZERO代行' };
  const stub =
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
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: stub,
    })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/uriage.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2400);
  await page.click('#segIn');
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    head: [...document.querySelectorAll('#kamiHead th')].map((x) => x.textContent.trim()),
    hako: document.querySelectorAll('#kamiBody input.yen').length,
  }));
  // eslint-disable-next-line no-console
  console.log('★入力タブの 見出し★ ' + JSON.stringify(r));
  expect(r.head.join(','), '★足した 名前が 出ていません★').toContain('駐車場代');
  expect(r.head.join(','), '★使わない 印の 物が 出ています★').not.toContain('使わない物');
  // ★日・車 ＋ 使う 名前 4つ★
  expect(r.head.length, '★見出しの 数が 合いません★').toBe(6);
  expect(r.hako, '★欄の 数が 合いません★').toBe(4);
});
