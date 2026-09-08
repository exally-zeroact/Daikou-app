// ============================================================
// ★★司さんの 指摘 11件（2026-09-08）★★
//
//   実機の 写真を もらって 出た 分。★1件ずつ 見張ります★。
//   （⑤⑥⑦⑧⑨⑩⑪ は 別の 見張りに 在る ので、ここは ①②③④）
//     ①入力 … 日付が 二重（欄と 下の 字）        → ★下の 字を 消す★
//     ②入力 … 「（円）」は ラベルでなく ★欄の 中★
//     ③入力 … 走った 記録が 無い 日に 高速代を どこに 入れる？
//     ④会社設定 … 「並び 10/20/30」が 分からない → ★▲▼★
//     ⑤⑥⑦ 料金表 → tests/e2e/jimusho-footer.spec.js
//     ⑧ 電子決済の 入力 → tests/e2e/denshi-higoto.spec.js
//     ⑨⑩⑪ 月ごとの 表 → tests/e2e/shukei-hyou-3mai.spec.js
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-08 実測 ＝ 下に 書く）★★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const NYU = fs.readFileSync(path.join(ROOT, 'nyuryoku.html'), 'utf8');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');

function stub(shifts) {
  const moto = fs.readFileSync(path.join(ROOT, 'js', 'dk-session.js'), 'utf8');
  const D = {
    co: { company_id: 'c1', name: 'ZERO代行' },
    SH: shifts || [],
    K: [{ kind_id: 'toll', label: '高速代', sort_order: 10, active: true }],
  };
  return (
    moto +
    ';(function(){var D=' +
    JSON.stringify(D) +
    ';var S=window.DKSession;window.__okutta=[];' +
    'function rows(p){ if(p.indexOf("dk_expense_kinds")===0)return D.K;' +
    ' if(p.indexOf("dk_device_labels")===0)return [{company_id:"c1",device_id:"d1",label:"4987",sort_order:1}];' +
    ' if(p.indexOf("dk_shifts")===0){ var qq=decodeURIComponent(p); var iso=qq.match(/\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z?/g)||[]; if(iso.length<2)return D.SH; var f=+new Date(iso[0]), t=+new Date(iso[1]); return D.SH.filter(function(x){var d=+new Date(x.started_at); return d>=f&&d<t;});} return [];}' +
    'S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return D.co.company_id;};S.pickCompany=function(){return {mode:"one",company:D.co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([D.co]);}});};' +
    'S.rest=function(s,p,o){ if(o&&o.method)window.__okutta.push({saki:p,method:o.method,body:o.body}); return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page, gamen, shifts) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: stub(shifts),
    })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  // ★会社設定は DKSession を 通さず 自分で fetch する★ ので 通信を 差し替える
  await page.route('**/rest/v1/**', (r) => {
    const u = r.request().url();
    let body = '[]';
    if (u.indexOf('dk_expense_kinds') >= 0) {
      body = JSON.stringify([
        { company_id: 'c1', kind_id: 'toll', label: '高速代', sort_order: 10, active: true },
        { company_id: 'c1', kind_id: 'bridge', label: '橋代', sort_order: 20, active: true },
      ]);
    } else if (u.indexOf('dk_companies') >= 0) {
      body = JSON.stringify([{ company_id: 'c1', name: 'ZERO代行' }]);
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: body });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/' + gamen, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
}

test('★★① 日付は 1つだけ（曜日は 残す）★★', async ({ page }) => {
  await hiraku(page, 'nyuryoku.html');
  const r = await page.evaluate(() => {
    const hon = document.body.innerText;
    return {
      // ★下の「2026年9月3日（木）」の 行は 消した★
      furui: !!document.getElementById('hiJi'),
      hi: (document.getElementById('hiSel') || {}).value || '',
      youbi: (document.getElementById('hiYoubi') || {}).textContent || '',
      // ★年月日を 2回 書いていない★
      nendo: (hon.match(/\d{4}年\d{1,2}月\d{1,2}日/g) || []).length,
    };
  });
  // eslint-disable-next-line no-console
  console.log('★日付★ ' + JSON.stringify(r));
  expect(r.furui, '★消したはずの 日付の 行が 残っています★').toBe(false);
  expect(r.hi, '★日付の 欄が 空です★').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(r.youbi, '★曜日が 出ていません★').toMatch(/[日月火水木金土]/);
  expect(r.nendo, '★年月日が 2か所に 出ています（二重）★').toBe(0);
});

test('★★② 単位「円」は 欄の 中★★', async ({ page }) => {
  // ★車ごとの 実費の 欄も 出す★（走った 記録を 積む）
  await hiraku(page, 'nyuryoku.html', [
    { shift_id: 's1', device_id: 'd1', started_at: '2026-09-20T10:00:00+09:00' },
  ]);
  await page.fill('#hiSel', '2026-09-20');
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    const lab = [...document.querySelectorAll('.flabel')].map((x) => x.textContent.trim());
    const en = document.querySelector('.fen .en');
    const inp = document.getElementById('denshiYen');
    if (!en || !inp) return { aru: false, lab: lab };
    const eb = en.getBoundingClientRect();
    const ib = inp.getBoundingClientRect();
    return {
      aru: true,
      lab: lab,
      ji: en.textContent.trim(),
      // ★欄の 中に 重なっている★
      naka: eb.left > ib.left && eb.right <= ib.right + 1,
    };
  });
  // eslint-disable-next-line no-console
  console.log('★円★ ' + JSON.stringify(r));
  expect(r.aru, '★「円」が ありません★').toBe(true);
  expect(r.ji, '★「円」の 字が 違います★').toBe('円');
  expect(r.naka, '★「円」が 欄の 外に 在ります★').toBe(true);
  expect(r.lab.join(','), '★ラベルに（円）が 残っています★').not.toContain('（円）');
  // ★★実費の 欄も 同じ★★ 2026-09-08
  //   ★電子決済だけ 直して 車ごとの 実費を 残していました★（1か所で 終わりに しない）
  //   ⇒ ★全部の 欄★について「円が 欄の 中に 在る」事を 場所で 見る。
  const zenbu = await page.evaluate(() => {
    const out = { ran: 0, naka: 0, lab: [] };
    document.querySelectorAll('.frow').forEach((row) => {
      const inp = row.querySelector('input[type=number]');
      if (!inp) return;
      out.ran++;
      const en = row.querySelector('.fen .en');
      if (en) {
        const eb = en.getBoundingClientRect();
        const ib = inp.getBoundingClientRect();
        if (eb.left > ib.left && eb.right <= ib.right + 1) out.naka++;
      }
      const l = row.querySelector('.flabel');
      if (l) out.lab.push(l.textContent.trim());
    });
    return out;
  });
  // eslint-disable-next-line no-console
  console.log('★欄と 円★ ' + JSON.stringify(zenbu));
  expect(zenbu.ran, '★打つ 欄が ありません★').toBeGreaterThan(1);
  expect(zenbu.naka, '★円が 欄の 外の 物が あります★').toBe(zenbu.ran);
  expect(zenbu.lab.join(','), '★ラベルに（円）が 残っています★').not.toContain('（円）');
});

// ★★2026-09-08（2回目）★★ 司さん「日付選んどんやけん入力するとこ出しとけや」
//   ★前★ 走っていない 日は ★欄が 1つも 出なかった★（訳を 書いただけ）
//   ★今★ ★会社の 車を 全部 出して 打てる★（手で 入れた 1日ぶん＝dk_manual_days）
//         ★売上は 0 の まま★＝走っていない 日に 売上は 立ちません。
test('★★③ 走った 記録が 無い 日でも 入れる 所が 出る★★', async ({ page }) => {
  await hiraku(page, 'nyuryoku.html', [
    { shift_id: 's1', device_id: 'd1', started_at: '2026-09-20T10:00:00+09:00' },
  ]);
  await page.fill('#hiSel', '2026-09-03');
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({
    msg: (document.getElementById('msg') || {}).textContent || '',
    btn: (document.getElementById('hashittaHi') || {}).style.display,
    ji: (document.getElementById('btnLastRun') || {}).textContent || '',
    // ★打てる 欄が 出ている★（手で 入れた 1日ぶん）
    ran: document.querySelectorAll('#shaList [data-dev]').length,
    sha: [...document.querySelectorAll('#shaList .sha-na')].map((x) => x.textContent.trim()),
  }));
  // eslint-disable-next-line no-console
  console.log('★記録が 無い 日★ ' + JSON.stringify(r));
  expect(r.ran, '★走っていない 日に 打つ 欄が 出ていません★').toBeGreaterThan(0);
  expect(r.sha.length, '★会社の 車が 出ていません★').toBeGreaterThan(0);
  expect(r.msg, '★売上が 増えない 事が 書いてありません★').toContain('売上は 増えません');
  expect(r.btn, '★走った 日へ 飛ぶ ボタンが 出ていません★').not.toBe('none');
  expect(r.ji, '★飛び先の 日が 書いてありません★').toContain('9/20');
});

// ★★打った 分は 手で 入れた 1日ぶんへ 行く★★ 2026-09-08
test('★★③-2 打つと dk_manual_days へ 行く（売上は 0 の まま）★★', async ({ page }) => {
  await hiraku(page, 'nyuryoku.html', [
    { shift_id: 's1', device_id: 'd1', started_at: '2026-09-20T10:00:00+09:00' },
  ]);
  await page.fill('#hiSel', '2026-09-03');
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(1500);
  const kou = page.locator('#shaList [data-dev]').first();
  await kou.fill('1500');
  await kou.dispatchEvent('change');
  await page.waitForTimeout(600);
  const okutta = await page.evaluate(() => window.__okutta || []);
  // eslint-disable-next-line no-console
  console.log('★送った 先★ ' + JSON.stringify(okutta.map((x) => x.saki)));
  const md = okutta.filter((x) => x.saki.indexOf('dk_manual_days') === 0);
  expect(md.length, '★手で 入れた 1日ぶんへ 行っていません★').toBe(1);
  const body = JSON.parse(md[0].body);
  expect(body.work_date, '★日が 違います★').toBe('2026-09-03');
  expect(body.toll_yen, '★打った 額が 入っていません★').toBe(1500);
  expect(body.sales_yen, '★売上を 立てています★').toBe(0);
  expect(
    okutta.filter((x) => /dk_shifts|dk_trips/.test(x.saki)).length,
    '★元データに 書いています★'
  ).toBe(0);
});

test('★★④ 実費の 順番は ▲▼（数字を 見せない）★★', async ({ page }) => {
  await hiraku(page, 'dashboard.html');
  await page.locator('[data-chip="jippi"]').click();
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({
    th: [...document.querySelectorAll('#jippiTbl thead th')].map((x) => x.textContent.trim()),
    ue: document.querySelectorAll('#jippiBody [data-ue]').length,
    shita: document.querySelectorAll('#jippiBody [data-shita]').length,
    // ★並びの 数字を 打つ 欄は 無い★
    suji: document.querySelectorAll('#jippiBody [data-f="sort_order"]').length,
  }));
  // eslint-disable-next-line no-console
  console.log('★実費の 順番★ ' + JSON.stringify(r));
  expect(r.th.join(','), '★「並び」の 字が 残っています★').not.toContain('並び');
  expect(r.th.join(','), '★「順番」の 見出しが ありません★').toContain('順番');
  expect(r.suji, '★並びの 数字を 打つ 欄が 残っています★').toBe(0);
  expect(r.ue, '★▲が ありません★').toBeGreaterThan(0);
  expect(r.shita, '★▼が ありません★').toBeGreaterThan(0);
});

test('★★⑤ 実費の 道順が「入力」を 指している★★', async () => {
  // ★売上表の「実費入力」は もう 在りません★（下の 帯の「入力」に なった）
  expect(DASH, '★古い 道順が 残っています★').not.toContain('売上表 →「実費入力」');
  expect(DASH, '★どこに 出るかが 書いてありません★').toContain('下の 帯の「入力」');
  expect(NYU, '★入力の 画面が 実費の 一覧を 使っていません★').toContain('dk_expense_kinds');
});
