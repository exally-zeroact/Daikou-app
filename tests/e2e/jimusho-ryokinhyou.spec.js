// tests/e2e/jimusho-ryokinhyou.spec.js
// ★★事務所の 料金表画面★★ 2026-08-31（別件③ 2026-08-30 積み分）
//
//   ★なぜ 要るか★
//     実測（2026-08-30）… 事務所側に 料金表の 画面は ★0箇所★だった。
//     料金を 変える 手が ★運転する人の 端末だけ★＝★置き場が 間違っていた★。
//
//   ★ここで 見る事（★字を 読むだけに しない★）★
//     ①倉庫の 値が ★入れる所に 出ている★
//     ②★お金の 計算を この画面に 書き写していない★
//       （見本表は ★まだ 付けていません★＝ meter.js を 事務所に 出すのは 禁止・
//         写すのも 禁止。正しい 直し方は 計算を 別ファイルに 出す事＝司さん待ち）
//     ③★★保存しても 触っていない 設定が 消えない★★
//       ＝割増・段階・車種・待ち が 入った 料金表で「最初の料金」だけ 変えて 保存し、
//         ★実際に 出て行った 中身★を 捕まえて 中を 見る。
//       （これが 一番 危ない所。事務所で 保存したら 割増が 消えた、は 起こさない）
//     ④★読めなかった時に「既定です」と 見せない★（人が 上書きしてしまう）
//     ⑤変えていない 時は ★保存を 押せない★
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// ★倉庫に 入っている 事に する 料金表★
//   ★基本の5つ 以外★（割増・段階・車種・待ち）を わざと 入れてある
const SOUKO = {
  version: 2,
  base_fare: 1300,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: 420,
  rounding: 10,
  // ★形は 本物に 合わせる★（js/meter.js calcFare が 読む キー）
  //   ★2026-08-31 実測★… 作り物の 形（upto_m/fare）だと tier が 全部 飛ばされ、
  //   ★10kmでも 1,300円★に なりました（黙って 基本料金だけ 返る）。
  //   ⇒ 見本の 絵を 開いて 気づきました（数字は 全部 緑のままだった）。
  tiersEnabled: true,
  tiers: [{ from_m: 1000, to_m: null, add_distance_m: 420, add_fare: 100 }],
  vehiclesEnabled: true,
  vehicles: [{ id: 'wagon', name: 'ワゴン', multiplier: 1.2, addon: 0 }],
  zonesEnabled: false,
  autoSurcharges: {
    night: { enabled: true, from: 22, to: 5, rate: 1.25 },
    weekend: { enabled: true, rate: 1.1 },
    winter: { enabled: false, from: '12-15', to: '03-15', rate: 1.1 },
  },
  wait: { enabled: true, freeMins: 3, ratePerMin: 120 },
};

const COMPANY_ID = '11111111-2222-3333-4444-555555555555';

// ★ログインだけ 差し替える★（読む・書く・描く・数える は 本物のまま）
async function login(page) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const tsugi =
    moto +
    ';(function(){var co={company_id:' +
    JSON.stringify(COMPANY_ID) +
    ',name:"見張り用"};' +
    'var S=window.DKSession;' +
    'S.ensure=function(){return Promise.resolve({access_token:"dummy"});};' +
    'S.goLogin=function(){};S.logout=function(){};' +
    'S.uidOf=function(){return "uid-mihari";};' +
    'S.rememberedCompanyId=function(){return co.company_id;};' +
    'S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){' +
    'return Promise.resolve([co]);}});};' +
    '})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: tsugi })
  );
}

// ★倉庫（PostgREST）を 差し替える★／出て行った 中身は okutta に 溜める
async function souko(page, opts) {
  opts = opts || {};
  const okutta = [];
  await page.route('**/dk_fare_config*', async (r) => {
    const req = r.request();
    if (req.method() === 'GET') {
      if (opts.yomenai) return r.fulfill({ status: 500, body: '{}' });
      const rows = opts.kara
        ? []
        : [
            {
              config: SOUKO,
              updated_at: '2026-08-20T02:03:04.000Z',
              // ★倉庫に 入っている 形★（事務所から 変えた時は 'jimusho:' が 付く）
              updated_by: 'jimusho:uid-mihari',
            },
          ];
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(rows),
      });
    }
    okutta.push({ url: req.url(), body: req.postData() });
    return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  return okutta;
}

async function hiraku(page) {
  // ★★2026-09-05 料金表は「見るだけ」に なりました★★（司さん
  //   「会社の設定で 料金 触るようにしろや」）
  //   ★決めるのは ?henshu=1★（会社設定 →「料金」チップから 来る 道）
  await page.goto('/ryokinhyou.html?henshu=1');
  await page.waitForSelector('#honbun:not([style*="display: none"])', { timeout: 15000 });
}

test('★① 倉庫の 値が 入れる所に 出る★', async ({ page }) => {
  await login(page);
  await souko(page);
  await hiraku(page);
  const v = await page.evaluate(() => ({
    base: document.getElementById('fBase').value,
    baseM: document.getElementById('fBaseM').value,
    add: document.getElementById('fAdd').value,
    addM: document.getElementById('fAddM').value,
    round: document.getElementById('fRound').value,
  }));
  expect(v, '★倉庫の 値が 出ていません★').toEqual({
    base: '1300',
    baseM: '1000',
    add: '100',
    addM: '420',
    round: '10',
  });
});

test('★★② お金の 計算を 写さず、メーターと 同じ ファイルを 呼ぶ★★', async ({ page }) => {
  await login(page);
  await souko(page);
  await hiraku(page);

  const yomu = await page.evaluate(() =>
    Array.prototype.slice
      .call(document.querySelectorAll('script[src]'))
      .map((e) => e.getAttribute('src'))
  );
  // ★メーターの 中身は 事務所に 出さない★（2026-08-02 の 事故）
  expect(yomu, '★メーターの 中身を 読み込んでいます★').not.toContain('js/meter.js');
  // ★計算は 借りる（写さない）★
  expect(yomu, '★料金の 計算を 読み込んでいません★').toContain('js/fare-calc.js');
  const src = await page.evaluate(() => document.documentElement.innerHTML);
  expect(
    /add_distance_m\s*\)?\s*[*/]/.test(src),
    '★お金の 計算を 書き写しています（2か所に なると ずれます）★'
  ).toBe(false);

  // ★★見本の 金額が 部品と 1円も 違わない★★
  //   ★★行数を 決め打ちに しない★★ 2026-09-04
  //     司さん「料金表ももっと細かく見せろ」で ★7行 → 60行★ に なり、
  //     ★この見張りが 正しく 赤に なった★（直す物が 在る 赤では ない）。
  //   ⇒ 見るのは ★「何行 出たか」では なく「出た 距離の 金額が 部品と 同じか」★
  //     （行数を 書くと ★細かくする たびに 赤★＝見張りが 邪魔に なる）
  const r = await page.evaluate(() => {
    const rows = Array.prototype.slice.call(document.querySelectorAll('#mihon tr'));
    // 1列目の「◯.◯◯◯ km」から ★m★ を 取り出す（画面が 出している 距離 そのもの）
    const m = rows.map((tr) => Math.round(parseFloat(tr.children[0].textContent) * 1000));
    const gamen = rows.map((tr) => tr.children[1].textContent.replace(/[^0-9]/g, ''));
    return { m: m, gamen: gamen, n: rows.length };
  });
  // ★1行も 出ていない＝空で 緑に しない★
  expect(r.n, '★見本の 行が ありません★').toBeGreaterThan(5);
  const buhin = await page.evaluate(
    (arg) => {
      const now = new Date();
      // ★js/fare-calc.js は const 宣言＝window には 付かない★ので 裸の名前で 呼ぶ
      /* global FareCalc */
      return arg.m.map((mm) => String(FareCalc.keisan(mm, arg.cfg, null, new Set(), 0, now)));
    },
    { cfg: SOUKO, m: r.m }
  );
  expect(r.gamen, '★画面の 金額が 部品と 違います★').toEqual(buhin);
});

test('★★③ 保存しても 触っていない 設定が 1つも 消えない★★', async ({ page }) => {
  await login(page);
  const okutta = await souko(page);
  await hiraku(page);

  await page.fill('#fBase', '1500');
  await page.waitForTimeout(150);
  await page.click('#btnSave');
  await page.waitForTimeout(600);

  const hozon = okutta.filter((o) => o.body && o.body.indexOf('"config"') >= 0);
  expect(hozon.length, '★保存が 送られていません★').toBeGreaterThan(0);
  const sent = JSON.parse(hozon[0].body).config;

  expect(sent.base_fare, '★変えた値が 入っていません★').toBe(1500);
  // ★触っていない 物★
  expect(sent.tiersEnabled, '★段階の 設定が 消えました★').toBe(true);
  expect(sent.tiers, '★段階の 中身が 消えました★').toEqual(SOUKO.tiers);
  expect(sent.vehiclesEnabled, '★車種の 設定が 消えました★').toBe(true);
  expect(sent.vehicles, '★車種の 中身が 消えました★').toEqual(SOUKO.vehicles);
  expect(sent.autoSurcharges, '★割増の 設定が 消えました★').toEqual(SOUKO.autoSurcharges);
  expect(sent.wait, '★待ち時間の 設定が 消えました★').toEqual(SOUKO.wait);
});

test('★④ 読めなかった時に「既定です」と 見せない★', async ({ page }) => {
  await login(page);
  await souko(page, { yomenai: true });
  // ★★2026-09-05 料金表は「見るだけ」に なりました★★（司さん
  //   「会社の設定で 料金 触るようにしろや」）
  //   ★決めるのは ?henshu=1★（会社設定 →「料金」チップから 来る 道）
  await page.goto('/ryokinhyou.html?henshu=1');
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => ({
    honbun: getComputedStyle(document.getElementById('honbun')).display,
    msg: document.getElementById('msg').textContent,
  }));
  expect(m.honbun, '★読めていないのに 入力欄を 見せています★').toBe('none');
  expect(m.msg, '★読めなかった事を 言っていません★').toContain('読めませんでした');
});

test('★⑤ 変えていない 時は 保存を 押せない★', async ({ page }) => {
  await login(page);
  await souko(page);
  await hiraku(page);
  expect(
    await page.getAttribute('#btnSave', 'disabled'),
    '★何も 変えていないのに 保存が 押せます★'
  ).not.toBeNull();
  await page.fill('#fAdd', '120');
  await page.waitForTimeout(150);
  expect(
    await page.getAttribute('#btnSave', 'disabled'),
    '★変えたのに 保存が 押せません★'
  ).toBeNull();
});

// ★★⑥⑦ は 指示役の 差し戻し（2026-08-31）で 足した★★
//   ⑥ uid（英数字の 羅列）を 画面にも 倉庫にも 出さない
//      （司さん「訳分からんやつ消せ」と 同じ形。指示役「誰か 分かりません」）
//   ⑦ 日付の 書き方が メーターと 同じ（部品の 1か所 _hiduke を 通す）
//      ★元は この画面が 自分で toLocaleString して「2026/08/20 11:03」★
//      メーター側は 「8月20日 11:03」＝★同じアプリの 中で 2通り★だった。
//      「2つの 札で 別々に 書くと すぐ 食い違う」は ★自分で 部品に 書いた事★を 破っていた。

test('★★⑥ uid を 画面にも 倉庫にも 出さない★★', async ({ page }) => {
  await login(page); // ★証(JWT)は 見張り用の 作り物（uid-mihari）★
  const okutta = await souko(page);
  await hiraku(page);

  const moji = await page.textContent('#itsuno');
  expect(moji.indexOf('uid-mihari'), '★画面に uid が そのまま 出ています★').toBe(-1);
  expect(moji, '★誰かを 言っていません★').toContain('最後に変えた人');

  await page.fill('#fBase', '1500');
  await page.waitForTimeout(150);
  await page.click('#btnSave');
  await page.waitForTimeout(600);
  const hozon = okutta.filter((o) => o.body && o.body.indexOf('"config"') >= 0);
  expect(hozon.length, '★保存が 送られていません★').toBeGreaterThan(0);
  const dare = JSON.parse(hozon[0].body).updated_by;
  if (dare != null) {
    // ★裸の uid を 倉庫に 残さない★（メール か 'jimusho:' 付き の どちらか）
    expect(
      String(dare).indexOf('jimusho:') === 0 || String(dare).indexOf('@') > 0,
      '★倉庫に 裸の uid を 書いています（' + dare + '）★'
    ).toBe(true);
  }
});

test('★★⑦ 日付の 書き方が 部品と 同じ（自分で 組んでいない）★★', async ({ page }) => {
  await login(page);
  await souko(page);
  await hiraku(page);
  const moji = await page.textContent('#itsuno');
  expect(/[0-9]+月[0-9]+日/.test(moji), '★日本語の 日付に なっていません★').toBe(true);
  expect(moji.indexOf('/'), '★機械の 書き方（2026/08/20）が 出ています★').toBe(-1);

  // ★同じ物を 部品に 直接 聞いて 突き合わせる★（画面が 自前で 組んでいない事）
  const buhin = await page.evaluate(() =>
    window.FareConfigStore.fudaKaeta(
      { updated_at: '2026-08-20T02:03:04.000Z', updated_by: 'jimusho:uid-mihari' },
      null
    )
  );
  expect(moji, '★部品が 作る 1行と 違います（自分で 組んでいます）★').toBe(buhin);
});

// ★★⑧⑨ は 司さんの 2026-09-01「事務所からだけにしたんやないんか」で 足した★★
//   ★料金表(倉庫)の 中身を 事務所で 全部 直せる★事を 見ます。
//   （追加料金・値引きは ★料金表では なく 端末ごとの localStorage★なので ここには 出ません）

test('★★⑧ 料金表の 中身が 全部 事務所で 直せる★★', async ({ page }) => {
  await login(page);
  await souko(page);
  await hiraku(page);
  const aru = await page.evaluate(() => {
    const m = (s) => !!document.querySelector(s);
    return {
      tiers: m('#fTiersOn') && m('#btnTierAdd'),
      sur: m('#surList') && m('#btnSurAdd'),
      auto: m('#fNightOn') && m('#fWeekOn') && m('#fWinOn'),
      veh: m('#fVehOn') && m('#btnVehAdd'),
      wait: m('#fWaitOn') && m('#fWaitFree') && m('#fWaitRate'),
      minmax: m('#fMin') && m('#fMax'),
    };
  });
  Object.keys(aru).forEach((k) => {
    expect(aru[k], '★' + k + ' を 事務所で 直せません★').toBe(true);
  });

  // ★倉庫の 中身が 画面に 出ている★（作り話の 既定を 出していない）
  const v = await page.evaluate(() => ({
    night: document.getElementById('fNightRate').value,
    waitFree: document.getElementById('fWaitFree').value,
    tiers: document.querySelectorAll('#tiersList .kumi').length,
    veh: document.querySelectorAll('#vehList .kumi').length,
  }));
  expect(v.night, '★深夜の 倍率が 倉庫の 値では ありません★').toBe('1.25');
  expect(v.waitFree, '★待ちの 無料分が 倉庫の 値では ありません★').toBe('3');
  expect(v.tiers, '★段階が 出ていません★').toBe(1);
  expect(v.veh, '★車種が 出ていません★').toBe(1);
});

test('★★⑨ 割増を 直して 保存すると その通り 送られる（他は 消えない）★★', async ({ page }) => {
  await login(page);
  const okutta = await souko(page);
  await hiraku(page);

  await page.fill('#fNightRate', '1.5');
  await page.fill('#fWaitRate', '150');
  await page.waitForTimeout(200);
  await page.click('#btnSave');
  await page.waitForTimeout(600);

  const hozon = okutta.filter((o) => o.body && o.body.indexOf('"config"') >= 0);
  expect(hozon.length, '★保存が 送られていません★').toBeGreaterThan(0);
  const sent = JSON.parse(hozon[0].body).config;
  expect(sent.autoSurcharges.night.rate, '★深夜の 倍率が 送られていません★').toBe(1.5);
  expect(sent.wait.ratePerMin, '★待ちの 単価が 送られていません★').toBe(150);
  // ★触っていない 物は そのまま★
  expect(sent.tiers, '★段階が 消えました★').toEqual(SOUKO.tiers);
  expect(sent.vehicles, '★車種が 消えました★').toEqual(SOUKO.vehicles);
  expect(sent.base_fare, '★基本の 料金が 変わりました★').toBe(SOUKO.base_fare);
});
