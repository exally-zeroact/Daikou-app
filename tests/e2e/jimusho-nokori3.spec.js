// ============================================================
// ★★司さんの 指摘の 残り 3つ★★ 2026-09-06
//
//   ★①「明細の期間のやり方がまったく理解できない」★
//     ★前★「何日から」「払い方」「日数」が ★同じ 重さで 3つ 並んでいた★
//       ⇒ どれが どれに 効くか 見えない（月3回なら 2つとも 使わないのに 出ていた）
//     ★今★ ★払い方を 一番 上に★ ⇒ ★選んだ 物に 要る 欄だけ★ 出す ＋ 今の 区切りを 字で 出す
//
//   ★②「なぜここにも明細に出すチェック欄がある」★
//     ★別物でした★ … 車の表＝★会社ぜんぶ★／従業員の表＝★その人だけ★
//     ⇒ ★消さずに 名前で 分かるように した★（中身は 変えていない）
//
//   ★③「全ページで戻るボタンすらない」★
//     ⇒ 下の 帯と ★同じ 1か所（js/jimusho-footer.js）★に 置く
//       ＝画面ごとに 手書きしない（バラバラに ならない）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     ①kikanDashiwake() を 呼ばない ………… ★赤★
//     ②見出しの 但し書きを 消す …………… ★赤★
//     ③戻るを 出さない …………………… ★赤★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = FIX.settings[0].company_id;

function sess() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: 'ZERO代行' };
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
    'var S=window.DKSession;S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p,o){return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page, ura) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: sess(),
    })
  );
  // ★外（本番の 倉庫）へ 出さない★（2026-09-06 の 決まり）
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('about:blank');
  await page.goto('/kyuryo.html' + (ura || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2400);
}

test('★★① 払い方で 要る 欄だけ 出る★★（10-07 締めの 形に 作り直し）', async ({ page }) => {
  await hiraku(page, '?henshu=1#set');
  const yomu = () =>
    page.evaluate(() => {
      const mie = (id) => !!(document.getElementById(id) || {}).offsetHeight;
      return {
        mode: (document.getElementById('pMode') || {}).value || '',
        hi: mie('pShimeHiRow'),
        narabe: mie('pNarabeRow'),
        youbi: mie('pYoubiRow'),
        nazuke: mie('pNazukeRow'),
        // 2026-10-24 区切りの 一覧（#pMsg）は やめた（司さん「締め日の下の区切りの説明書きいらん」）＝保存の 下の 確かめの 字を 見る
        msg: (document.getElementById('pSetsumei') || {}).textContent || '',
      };
    });

  // ★月3回★＝区切りは 決まっている ⇒ 欄は 出さない・何月分も 要らない
  await page.selectOption('#pMode', 'thirds');
  await page.waitForTimeout(200);
  const a = await yomu();
  // eslint-disable-next-line no-console
  console.log('★月3回★ ' + JSON.stringify(a));
  expect([a.hi, a.narabe, a.youbi, a.nazuke], '★月3回なのに 欄が 出ています★').toEqual([
    false,
    false,
    false,
    false,
  ]);
  expect(a.msg, '★今の 区切りが 書いてありません★').toContain('1日〜10日／11日〜20日／21日〜末日');

  // ★月1回（何日かで 締める）★＝「何日に 締める」＋（月を またぐので）「何月分」
  await page.selectOption('#pMode', 'tsuki1');
  await page.fill('#pShimeHi', '20');
  await page.waitForTimeout(200);
  const b = await yomu();
  // eslint-disable-next-line no-console
  console.log('★20日締め★ ' + JSON.stringify(b));
  expect(b.hi, '★「何日に 締める」が 出ていません★').toBe(true);
  expect(b.nazuke, '★月を またぐのに「何月分」が 出ていません★').toBe(true);
  expect(b.msg, '★何月分が 決まっていないのに 区切りを 出した★').toContain('決まっていません');

  // ★週1回★＝曜日＋何月分
  await page.selectOption('#pMode', 'shuu');
  await page.selectOption('#pNazuke', 'shime');
  await page.waitForTimeout(200);
  const c = await yomu();
  // eslint-disable-next-line no-console
  console.log('★週★ ' + JSON.stringify(c));
  expect([c.hi, c.youbi, c.nazuke]).toEqual([false, true, true]);
  expect(c.msg, '★区切りが 書いてありません★').toContain('月曜〜日曜の1週ごと');

  // ★毎日★＝欄は 何も 要らない
  await page.selectOption('#pMode', 'hi');
  await page.waitForTimeout(200);
  const d = await yomu();
  expect([d.hi, d.narabe, d.youbi, d.nazuke]).toEqual([false, false, false, false]);
  expect(d.msg).toContain('1日ごと');
});

test('★★② 明細に出す の 2か所が 名前で 分かる★★', async () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'kyuryo.html'), 'utf8');
  // ★消していない事★（2つとも 在る）＝別物なので 両方 要る
  expect(SRC.indexOf('明細に出す車'), '★人ごとの 側が ありません★').toBeGreaterThan(0);
  // ★どちらに 効くかが 書いてある事★
  expect(SRC.indexOf('会社ぜんぶ'), '★会社ぜんぶ と 書いていません★').toBeGreaterThan(0);
  expect(SRC.indexOf('この人だけ'), '★この人だけ と 書いていません★').toBeGreaterThan(0);
});

// ★★見張りの 中身を 逆に しました（黙って 数だけ 動かさない）★★ 2026-11-04
//   ★前★ 2026-09-06「全ページで戻るボタンすらない」＝6画面の 頭に「← 戻る」が 在る事を 見ていた
//   ★司さん 11-04★「左上に意味わからん戻るボタンもあるし」＝history.back() で「前に 見た 画面」へ 戻るだけ・帯と 食い違う
//   ★今★ 頭の 戻るも「← 会社設定へ 戻る」も 無い・移るのは 下の 帯（飲み屋 Castally と 同じ）
test('★★③ どの 画面にも 戻るは 無く、下の 帯は 在る★★', async ({ page }) => {
  const GAMEN = [
    'kyuryo.html',
    'kyuryo.html?henshu=1#kuruma',
    'kyuryo.html?henshu=1#emp',
    'uriage.html',
    'shukei.html',
    'nyuryoku.html',
    'ryokinhyou.html',
    'ryokinhyou.html?henshu=1',
    'dashboard.html',
  ];
  const dame = [];
  for (const g of GAMEN) {
    await page.route('**/js/dk-session.js*', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: sess(),
      })
    );
    await page.route('**/auth/v1/**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
    );
    await page.route('**/rest/v1/**', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/' + g, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const r = await page.evaluate(() => ({
      // ★押せる 物だけ 見る★（script の 中の 字を 数えない）
      modoru: [...document.querySelectorAll('button, a')]
        .filter((x) => x.offsetHeight > 0 && /戻る/.test(x.textContent || ''))
        .map((x) => (x.textContent || '').trim()),
      foot: !!(document.getElementById('dkFooter') || {}).offsetHeight,
    }));
    // eslint-disable-next-line no-console
    console.log('★' + g + '★ ' + JSON.stringify(r));
    if (r.modoru.length || !r.foot) dame.push(g + ':' + JSON.stringify(r));
  }
  expect(dame, '★戻るが 残っている／帯が 無い 画面が あります★').toEqual([]);
});
