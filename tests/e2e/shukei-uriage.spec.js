// ============================================================
// ★★月次集計の「売上」（年間／月ごと／日ごと × 全体／車ごと）★★ 2026-09-05（司さん）
//
//   ★司さんの言葉★
//     「★売上は 車ごととか 全体とか 日別や 月別や 年別で 分けれとんか？★」
//     「★ないといかんやろ★」
//
//   ★実測（直す前）★
//     売上表 …… 車ごと／日ごと は 在る／★月別・年別は 無い★／全体だけの 切り替えも 無い
//     月次集計 … 売上は ★月ごと（12ヶ月）だけ★／★車ごとは 無い★
//   ⇒ ★距離と 同じ 形★を 売上にも 付けた（同じ 場所・同じ 押し方）
//
//   ★数え方は 元と 同じ★
//     ctx.byDate[日付][車] の sales − expense（★実費を 引いた後★）
//     ＝ js/getsuji-agg.js:105 と 同じ 式 ⇒ ★元の 表と 食い違わない★
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-05 実測）★★
//     ①実費を 引かない（sales だけ 足す）… ★赤★（元の 表と 合わない）
//     ②車ごとの 合計を 出さない ………… ★赤★
//     ③切り替えの 印（色）を 付けない … ★赤★
//     戻した後 … ★緑★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);

// ★見本を 差し替えられる★（台数を 増やした 見本で 測る為）
function tsukuru(MIHON) {
  const F0 = MIHON || FIX;
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: F0.settings[0].company_id, name: '見張り用' };
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(F0) +
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
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(),
    })
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#uriTbl').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1500);
}

function yomu(page) {
  return page.evaluate(() => ({
    head: [...document.querySelectorAll('#uriHead th')].map((x) => x.textContent.trim()),
    rows: [...document.querySelectorAll('#uriBody tr')].map((tr) =>
      [...tr.children].map((td) => td.textContent.trim())
    ),
  }));
}
const gou = (r) => r.rows[r.rows.length - 1];

test('★売上を 年／月／日 × 全体／車ごと で 分けられる★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page);

  // ★★元の 表（月ごと）の 数字★★＝これと 食い違ったら 数え方が 壊れている
  const moto = await page.evaluate(() =>
    [...document.querySelectorAll('#tbody tr')]
      .map((tr) => [tr.children[0].textContent.trim(), tr.children[1].textContent.trim()])
      .filter((x) => x[1] && x[1] !== '—')
  );
  console.log('★元の 表（月ごと）★ ' + JSON.stringify(moto));
  expect(moto.length, '★見本に 売上が ありません★').toBeGreaterThan(1);
  const motoGou = moto[moto.length - 1][1];

  // ①月ごと × 全体（出だし）
  let r = await yomu(page);
  console.log('★月×全体★ ' + JSON.stringify(r.head) + ' 合計 ' + JSON.stringify(gou(r)));
  expect(r.head, '★見出しが 違います★').toEqual(['月', '売上']);
  expect(r.rows.length, '★12ヶ月ぶん 出ていません★').toBe(13);
  expect(gou(r)[1], '★合計が 元の 表と 違います★').toBe(motoGou);

  // ②月ごと × 車ごと
  await page.locator('[data-uriwake="kuruma"]').click();
  await page.waitForTimeout(500);
  r = await yomu(page);
  console.log('★月×車ごと★ ' + JSON.stringify(r.head) + ' 合計 ' + JSON.stringify(gou(r)));
  expect(r.head.length, '★車の 列が ありません★').toBeGreaterThan(2);
  // ★★合計は「月」の 隣（2列目）★★ 2026-09-05（甲）
  //   ★前は 右端★でした。20台で 表が 1,612px＝箱の 5倍に なり
  //   ★右端の 合計は 画面に 出て こない★ので 左へ 移しました。
  expect(r.head[1], '★合計が「月」の 隣に ありません★').toBe('合計');
  expect(r.head.slice(2).join(','), '★端末IDが そのまま 出ています★').not.toMatch(
    /[0-9a-f]{8}-[0-9a-f]{4}/
  );
  // ★車ごとを 足すと 全体と 同じ★
  expect(gou(r)[1], '★車ごとの 合計が 全体と 違います★').toBe(motoGou);

  // ③年間 × 車ごと
  await page.locator('[data-uri="year"]').click();
  await page.waitForTimeout(500);
  r = await yomu(page);
  console.log('★年×車ごと★ ' + JSON.stringify(r.rows));
  expect(r.head[0], '★見出しが 年に なっていません★').toBe('年');
  expect(gou(r)[1], '★年の 合計が 違います★').toBe(motoGou);

  // ④日ごと × 全体（★1ヶ月ぶんだけ★＝距離と 同じ 決まり）
  await page.locator('[data-uriwake="zentai"]').click();
  await page.waitForTimeout(400);
  await page.locator('#tbody tr[data-m="8"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-uri="day"]').click();
  await page.waitForTimeout(500);
  r = await yomu(page);
  console.log('★日×全体（8月）★ ' + JSON.stringify(r.head) + ' … ' + JSON.stringify(r.rows));
  expect(r.head[0], '★見出しに 月が 出ていません★').toBe('8月の 日');
  expect(gou(r)[1], '★日ごとの 合計が 月ごとと 違います★').toBe(motoGou);

  expect(err, '★画面が 落ちました★').toEqual([]);
  await page.locator('#uriTbl').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: 'C:/Users/zeroa/dk-tokei-2026-09-02/tokei/shot-uriage-hako.png',
  });
});

// ============================================================
// ★★台数が 多い時でも「月」と「合計」が 見える★★ 2026-09-05（指示役の 裁定＝甲）
//
//   ★実測（直す前・スマホ 390px・箱 320px）★
//      5台 … 表 517px ／ 10台 … 891px ／ ★20台 … 1,612px＝箱の 5倍★
//   ⇒ ★右へ すべらせると「月」も「合計」も 流れて 行き、何月の 何か 分からない★
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-05 実測）★★
//     ①貼り付け（position: sticky）を やめる … ★赤★（20台で 月が 左端から 消えた）
//     ②合計を 右端に 戻す ………………………… ★赤★（見出しの 2列目が 車の 名前に なる）
//     ③右に 在る合図（影）を 出さない ……… ★赤★
// ============================================================
function fuyasu(n) {
  const F = JSON.parse(JSON.stringify(FIX));
  const CO2 = FIX.settings[0].company_id;
  F.labels = [];
  F.shifts = [];
  for (let i = 1; i <= n; i++) {
    const id = 'car' + (1000 + i);
    F.labels.push({ company_id: CO2, device_id: id, label: '車' + (1000 + i) + '号' });
    for (let m = 1; m <= 12; m++) {
      const mm = (m < 10 ? '0' : '') + m;
      F.shifts.push({
        shift_id: 's' + id + mm,
        company_id: CO2,
        device_id: id,
        started_at: '2026-' + mm + '-10T10:00:00+09:00',
        ended_at: '2026-' + mm + '-10T18:00:00+09:00',
        elapsed_sec: 28800,
        fare_total_yen: 12000 + i * 500 + m * 100,
        trip_count: 8,
        actual_total_m: 40000,
        total_distance_m: 90000,
      });
    }
  }
  return F;
}

for (const dai of [5, 10, 20]) {
  test('★' + dai + '台でも「月」と「合計」が 見える★', async ({ page }) => {
    const F = fuyasu(dai);
    await page.route('**/js/dk-session.js*', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: tsukuru(F),
      })
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#uriTbl').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.locator('[data-uri="month"]').click();
    await page.locator('[data-uriwake="kuruma"]').click();
    await page.waitForTimeout(600);

    const r = await page.evaluate(() => {
      const t = document.getElementById('uriTbl');
      const box = t.closest('.kyori-sc');
      const th = [...t.querySelectorAll('thead th')];
      const yomu = () => {
        const b = box.getBoundingClientRect();
        // ★箱の 左端で 見えている 見出しは 何か★（貼り付いていないと 車の 名前に なる）
        const a1 = document.elementFromPoint(
          Math.round(b.left + 6),
          Math.round(th[0].getBoundingClientRect().top + 8)
        );
        return {
          hidari: a1 ? (a1.closest('th') || a1).textContent.trim().slice(0, 6) : null,
          tsukiX: Math.round(th[0].getBoundingClientRect().left - b.left),
          gouX: Math.round(th[1].getBoundingClientRect().left - b.left),
        };
      };
      const mae = yomu();
      // ★右端まで すべらせる★（合図は scroll の 報せで 付け外しするので 自分で 鳴らす）
      box.scrollLeft = 99999;
      box.dispatchEvent(new Event('scroll'));
      const ato = yomu();
      const kage = box.classList.contains('migi-aru');
      box.scrollLeft = 0;
      box.dispatchEvent(new Event('scroll'));
      return {
        retsu: th.length,
        midashi2: th[1] ? th[1].textContent.trim() : null,
        hyouHaba: Math.round(t.getBoundingClientRect().width),
        hakoHaba: Math.round(box.getBoundingClientRect().width),
        yokoSuberu: t.scrollWidth > box.clientWidth + 1,
        mae,
        ato,
        kageMigiHashi: kage,
        kageIma: box.classList.contains('migi-aru'),
      };
    });
    console.log('★' + dai + '台★ ' + JSON.stringify(r));

    // ★0を 見て 緑に しない★
    // ★月＋合計＋車の 数★（見本には 売上0の 端末も 1つ 混ざる＝以上で 見る）
    expect(r.retsu, '★車の 列が 出ていません★').toBeGreaterThanOrEqual(dai + 2);
    expect(r.yokoSuberu, '★横に すべりません＝見本が 効いていません★').toBe(true);
    // ★本題① 合計は「月」の 隣★
    expect(r.midashi2, '★合計が「月」の 隣に ありません★').toBe('合計');
    // ★本題② 右まで すべらせても 左の 2列は 動かない★
    expect(r.ato.tsukiX, '★すべらせると「月」が 左端から ずれました★').toBe(r.mae.tsukiX);
    expect(r.ato.gouX, '★すべらせると「合計」が ずれました★').toBe(r.mae.gouX);
    expect(r.ato.hidari, '★左端に 見えているのが「月」では ありません★').toBe('月');
    // ★本題③ 右に まだ 在る間だけ 合図を 出す★
    expect(r.kageIma, '★右に まだ 在るのに 合図が 出ていません★').toBe(true);
    expect(r.kageMigiHashi, '★右端まで すべったのに 合図が 残っています＝嘘の 合図★').toBe(false);

    // ★★印が 付いただけでは 足りない＝★絵に 描かれているか★を 見る★★ 2026-09-05
    //   ★実際に あった★＝最初 ::after で 描こうとして 箱の 高さが 決まらず
    //   ★高さ0＝何も 描かれなかった★のに ★印は 付くので 見張りは 緑だった★
    //   （数字は 全部 緑・絵を 開いて はじめて 気づいた）
    //   ⇒ ★同じ 所を 2枚 撮って 中身が 違う事★を 見る
    const box = page.locator('#uriTbl').locator('xpath=ancestor::div[contains(@class,"kyori-sc")]');
    const ari = await box.screenshot();
    await page.evaluate(() => {
      document.getElementById('uriTbl').closest('.kyori-sc').classList.remove('migi-aru');
    });
    const nashi = await box.screenshot();
    await page.evaluate(() => {
      document.getElementById('uriTbl').closest('.kyori-sc').classList.add('migi-aru');
    });
    expect(ari.length, '★絵が 撮れていません★').toBeGreaterThan(500);
    expect(
      Buffer.compare(ari, nashi) !== 0,
      '★合図の 印は 付くのに 絵は 1点も 変わりません＝何も 描かれていません★'
    ).toBe(true);
  });
}

test('★押した ボタンが 色で 分かる★', async ({ page }) => {
  await hiraku(page);
  const iro = async (na) =>
    page.evaluate((a) => {
      const b = [...document.querySelectorAll('[' + a + ']')];
      const on = b.filter((x) => x.hasAttribute('aria-current'));
      return {
        on: on.length,
        onIro: on.map((x) => getComputedStyle(x).backgroundColor),
        hoka: b
          .filter((x) => !x.hasAttribute('aria-current'))
          .map((x) => getComputedStyle(x).backgroundColor),
      };
    }, na);
  for (const na of ['data-uri', 'data-uriwake']) {
    const r = await iro(na);
    console.log('★' + na + '★ ' + JSON.stringify(r));
    expect(r.on, '★選ばれている 物が 1つでは ありません（' + na + '）★').toBe(1);
    expect(
      r.hoka.filter((x) => x === r.onIro[0]),
      '★選ばれている 物と 同じ 色が あります（見分けが つきません）★'
    ).toEqual([]);
  }
});

// ★★実費（高速代など）を 引いているか★★ 2026-09-05
//   ★上の 見本は 実費 0★なので「引かない」に 壊しても 気づけません
//   ⇒ ★実費が 入った 見本★で 別に 押します
//   ★★わざと壊して 赤に なる事を 見た★★ … 実費を 引かない ⇒ ★赤★
test('★実費を 引いた 後の 売上か★', async ({ page }) => {
  const JIPPI = 3000;
  const F2 = JSON.parse(JSON.stringify(FIX));
  // ★1本目の 勤務に 高速代を 付ける★
  F2.edits = [{ shift_id: F2.shifts[0].shift_id, toll_yen: JIPPI }];
  F2.salesSettings = { deduct_toll: true, deduct_bridge: true, deduct_other: false };
  const moto2 = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: F2.settings[0].company_id, name: '見張り用' };
  const body =
    moto2 +
    ';(function(){var F=' +
    JSON.stringify(F2) +
    ';var co=' +
    JSON.stringify(co) +
    ';' +
    'function rows(p){ if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[]; if(p.indexOf("dk_sales_settings")===0)return F.salesSettings?[F.salesSettings]:[];' +
    ' if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[]; if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[]; return [];}' +
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({token:"d"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: body })
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#uriTbl').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1500);
  const r = await yomu(page);
  const moto = await page.evaluate(() =>
    [...document.querySelectorAll('#tbody tr')]
      .map((tr) => [tr.children[0].textContent.trim(), tr.children[1].textContent.trim()])
      .filter((x) => x[1] && x[1] !== '—')
  );
  console.log(
    '★実費 ' +
      JIPPI +
      '円 入りの 見本★ 元 ' +
      JSON.stringify(moto) +
      ' ／ 売上の箱 ' +
      JSON.stringify(gou(r))
  );
  // ★元の 表も 実費を 引いている★ので 両方 同じに なる
  expect(gou(r)[1], '★実費を 引いていません（元の 表と 違います）★').toBe(moto[moto.length - 1][1]);
  // ★実費が 本当に 効いている 見本か★（0円なら 壊しても 気づけない）
  const hiku = await page.evaluate(() => {
    let g = 0;
    const by = (window.CTX && window.CTX.byDate) || {};
    Object.keys(by).forEach((d) => Object.keys(by[d]).forEach((v) => (g += by[d][v].expense || 0)));
    return g;
  });
  console.log('★見本の 実費 合計★ ' + hiku + '円');
});
