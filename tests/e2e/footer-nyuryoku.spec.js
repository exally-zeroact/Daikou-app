// ============================================================
// ★★入力は 下の 帯（フッター）の 1枚★★ 2026-09-07
//
//   ★司さんの言葉★「フッターに作れってこやろがぼけ」
//
//   ★私が 2回 外した★
//     ①月次集計の 中に 付けた …………… 違う
//     ②売上表の 中の 札に した ………… 違う
//     ③★下の 帯の「入力」（nyuryoku.html）★ … これ
//
//   ★見張る 事★
//     ①下の 帯に「入力」が 在る（★全部の 事務所の 画面で 同じ★）
//     ②その 画面で 押すと 入力へ 行く／入力に 居る 時は 印が 付く
//     ③★売上表には もう 打つ 所が 無い★（2か所に しない）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-07 実測）★★
//     ①帯から「入力」を 外す ………………… ★赤 2本★
//     ②売上表が 部品を 読むのを やめる … ★赤 1本★
//     戻した後 … ★緑 4本★
//
//   ★★見張りが 弱かった（先に 直した）★★
//     はじめ ②で ★緑のまま★だった＝説明の 中の 字を 数えていた。
//     ⇒ ★<script src> そのもの★を 見るように 直してから もう一度 壊した。
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function stub() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: 'c1', name: 'ZERO代行' };
  return (
    moto +
    ';(function(){var co=' +
    JSON.stringify(co) +
    ';var S=window.DKSession;' +
    'S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve([]);}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve([]);};})();'
  );
}

async function hiraku(page, gamen) {
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
  await page.goto('/' + gamen, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
}

const GAMEN = ['shukei.html', 'uriage.html', 'nyuryoku.html', 'kyuryo.html', 'ryokinhyou.html'];

test('★★① 全部の 事務所の 画面の 帯に「入力」が 在る★★', async ({ page }) => {
  const dame = [];
  for (const g of GAMEN) {
    await hiraku(page, g);
    const r = await page.evaluate(() => {
      const f = document.getElementById('dkFooter');
      if (!f) return { aru: false };
      const b = [...f.querySelectorAll('[data-dkgo]')];
      const n = b.find((x) => x.getAttribute('data-dkgo') === 'nyuryoku.html');
      return {
        aru: !!n,
        ji: n ? (n.textContent || '').trim() : '',
        // ★今 居る 所だけ 印が 付く★
        ima: n ? n.className.indexOf('on') >= 0 : false,
        kazu: b.length,
      };
    });
    // eslint-disable-next-line no-console
    console.log('★' + g + '★ ' + JSON.stringify(r));
    if (!r.aru || r.ji.indexOf('入力') < 0) dame.push(g + ':' + JSON.stringify(r));
    // ★入力の 画面では 印が 付く／他では 付かない★
    if ((g === 'nyuryoku.html') !== r.ima) dame.push(g + ' 印:' + JSON.stringify(r));
  }
  expect(dame, '★帯の「入力」が おかしい 画面が あります★').toEqual([]);
});

test('★★② 帯の「入力」を 押すと 入力の 画面へ 行く★★', async ({ page }) => {
  await hiraku(page, 'uriage.html');
  await page.click('#dkFooter [data-dkgo="nyuryoku.html"]');
  await page.waitForTimeout(1600);
  const url = page.url();
  // eslint-disable-next-line no-console
  console.log('★行き先★ ' + url);
  expect(url, '★入力の 画面へ 行きません★').toContain('nyuryoku.html');
  const r = await page.evaluate(() => ({
    fuda: (document.querySelector('.tag') || {}).textContent || '',
    // ★★2026-09-08★★ 表を やめました（司さん「はみ出てたりぐちゃぐちゃ」）
    //   ⇒ 見るのは ★日を 選ぶ 所★と ★PayPay の 欄★（打つ 画面の 印）
    hyou: !!document.getElementById('hiSel') && !!document.getElementById('ppYen'),
  }));
  expect(r.fuda, '★入力の 画面では ありません★').toContain('入力');
  expect(r.hyou, '★打つ 所が ありません★').toBe(true);
});

test('★★③ 売上表には もう 打つ 所が 無い（2か所に しない）★★', async () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'uriage.html'), 'utf8');
  expect(SRC.indexOf('data-ppd'), '★売上表に PayPay の 欄が 残っています★').toBe(-1);
  expect(SRC.indexOf('dk_day_extras'), '★売上表が PayPay の 棚を 触っています★').toBe(-1);
  expect(SRC.indexOf('id="segIn"'), '★売上表に 入力の 札が 残っています★').toBe(-1);
  // ★道順は 残す★（探さなくて よい ように）
  expect(SRC.indexOf('下の 帯'), '★どこで 打つかが 書いてありません★').toBeGreaterThan(0);
});

test('★★④ 実費の 決まりは 1か所（js/jippi-hozon.js）★★', async () => {
  const U = fs.readFileSync(path.join(__dirname, '..', '..', 'uriage.html'), 'utf8');
  const N = fs.readFileSync(path.join(__dirname, '..', '..', 'nyuryoku.html'), 'utf8');
  // ★2枚とも 同じ 部品を 読んでいる★
  //   ★★字が 在るだけでは 駄目★★ 2026-09-07（実測）
  //     はじめ indexOf('js/jippi-hozon.js') で 見ていたが、
  //     ★説明の 中にも 同じ 字が 在る★ので
  //     ★部品を 読むのを やめても 緑のまま★だった（わざと壊して 気づいた）。
  //   ⇒ ★<script src="…"> そのもの★を 見る。
  const YOMU = /<script[^>]+src=["']js\/jippi-hozon\.js["']/;
  ['uriage.html', 'nyuryoku.html'].forEach((f, i) => {
    expect(YOMU.test([U, N][i]), '★' + f + ' が 部品を 読んでいません★').toBe(true);
  });
  // ★倉庫の 名前を 直に 書いていない★＝決まりが 2か所に 散らない
  [U, N].forEach((h, i) => {
    expect(
      h.indexOf('dk_shift_edits?on_conflict'),
      '★' + i + '枚目が 保存の 決まりを 自分で 書いています★'
    ).toBe(-1);
  });
});
