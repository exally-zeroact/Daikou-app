// ============================================================
// ★★入力（フッターの「入力」）＝1日ぶんだけ 打つ★★ 2026-09-08
//
//   ★司さんの言葉★
//     「入力タブは」→「★フッターに作れってこやろがぼけ★」
//     「★なんなんどはみ出てたりぐちゃぐちゃになんど★
//       ★他のアプリは入力どやってしよんどぼけ★」
//     （前の 指示）「カレンダーで日付選んでできるようにしろ その日だけ見せてスッキリさせろ」
//
//   ★何が 悪かったか（実測 2026-09-08・司さんの 実機の 写真）★
//     ★表（table）に 日の 帯を 混ぜた★
//       ・table-layout:fixed の ますの 中で display:flex を 使った
//       ・⇒ 列が 合わず 電子決済 の 欄が 隣の 列に はみ出し、
//         その 行だけ ますが 足りず ★見た目が ぐちゃぐちゃ★に なった。
//
//   ★直し（自分で 考えず 他の アプリに 合わせた）★
//     ★飲み屋（Castally）nomiya-uriage.html の 入力と 同じ 形★
//       ＝ .frow（★ラベルを 上・欄を 下★に 縦）／.finput／type="date"
//       ＝ 代行請求書アプリも 同じ 部品の 名前
//     ★表は 使わない★＝どんな 幅でも 折り返さない・はみ出さない
//     ★1日ぶんだけ★ 出す（日を 選ぶ ＋ 前の日／次の日）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-08 実測）★★
//     ①欄を 画面より 広く する（前と 同じ 壊れ方）… ★赤★
//        ＝横に 106px すべり、欄が 5つ はみ出た（司さんの 写真と 同じ 事）
//     ②前に 入れた 電子決済 を 読まない ………… ★赤 2本★
//     ③前の日 ボタンが 動かない ………………… ★赤★
//     戻した後 … ★緑 5本★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const KINDS = [
  { kind_id: 'toll', label: '高速代', sort_order: 10, active: true },
  { kind_id: 'bridge', label: '橋代', sort_order: 20, active: true },
];
const HI = '2026-09-02';
const SH = [
  { shift_id: 's1', device_id: 'd1', started_at: HI + 'T10:00:00+09:00' },
  { shift_id: 's2', device_id: 'd2', started_at: HI + 'T11:00:00+09:00' },
];
const DENSHI_HI = [{ company_id: 'c1', pay_date: HI, denshi_yen: 3200 }];
const ED = [
  { shift_id: 's1', company_id: 'c1', toll_yen: 1200, bridge_yen: 300, other_yen: 0, expenses: {} },
];
const LABELS = [
  { company_id: 'c1', device_id: 'd1', label: '4987', sort_order: 1 },
  { company_id: 'c1', device_id: 'd2', label: '1234', sort_order: 2 },
];

// ★打った 物が どこへ 行ったか 数える★（本物の 倉庫には 出しません）
function stub() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const naka = {
    co: { company_id: 'c1', name: 'ZERO代行' },
    K: KINDS,
    SH: SH,
    DENSHI_HI: DENSHI_HI,
    ED: ED,
    L: LABELS,
    HI: HI,
  };
  return (
    moto +
    ';(function(){var D=' +
    JSON.stringify(naka) +
    ';var S=window.DKSession;window.__okutta=[];' +
    'function rows(p){' +
    ' if(p.indexOf("dk_expense_kinds")===0)return D.K;' +
    ' if(p.indexOf("dk_shifts")===0)return (p.indexOf(D.HI)>=0?D.SH:[]);' +
    ' if(p.indexOf("dk_day_extras")===0)return (p.indexOf(D.HI)>=0?D.DENSHI_HI:[]);' +
    ' if(p.indexOf("dk_shift_edits")===0)return D.ED;' +
    ' if(p.indexOf("dk_device_labels")===0)return D.L; return [];}' +
    'S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return D.co.company_id;};S.pickCompany=function(){return {mode:"one",company:D.co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([D.co]);}});};' +
    'S.rest=function(s,p,o){ if(o&&o.method)window.__okutta.push({saki:p,method:o.method,body:o.body});' +
    ' return Promise.resolve({ok:true,status:200,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();'
  );
}

async function hiraku(page) {
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
  await page.fill('#hiSel', HI);
  await page.dispatchEvent('#hiSel', 'change');
  await page.waitForTimeout(1200);
}

test('★★① その日ぶんだけ 出る（電子決済 と 車ごとの 実費）★★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await hiraku(page);
  const r = await page.evaluate(() => ({
    // ★★日付は 欄が 出す★★ 2026-09-08（司さん「赤丸の日付いらんことないか？」）
    //   ⇒ 見るのは ★欄の 値★＋★曜日★（下の 行は 消しました）
    hi:
      ((document.getElementById('hiSel') || {}).value || '') +
      ((document.getElementById('hiYoubi') || {}).textContent || ''),
    pp: (document.getElementById('denshiYen') || {}).value,
    sha: [...document.querySelectorAll('#shaList .sha-na')].map((x) => x.textContent.trim()),
    ran: [...document.querySelectorAll('#shaList [data-sid]')].map((x) => ({
      f: x.getAttribute('data-f'),
      v: x.value,
    })),
    // ★表は 使っていない★（はみ出しの もと）
    hyou: document.querySelectorAll('#shaList table').length,
  }));
  // eslint-disable-next-line no-console
  console.log('★入力★ ' + JSON.stringify(r));
  expect(r.hi, '★選んだ 日が 出ていません★').toContain('2026-09-02');
  expect(r.pp, '★前に 入れた 3,200 が 出ていません★').toBe('3200');
  expect(r.sha, '★その日 走った 車が 出ていません★').toEqual(['4987', '1234']);
  expect(r.ran.length, '★車2台 × 実費2つ ＝ 4つの 欄★').toBe(4);
  expect(r.ran[0], '★1台目の 高速代 1,200 が 出ていません★').toEqual({ f: 'toll', v: '1200' });
  expect(r.hyou, '★表を 使っています（はみ出しの もと）★').toBe(0);
  expect(err, '★画面が 落ちています★').toEqual([]);
});

test('★★② 横に はみ出さない（司さんの「ぐちゃぐちゃ」）★★', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const deta = [];
    document.querySelectorAll('input, .sha, .card, .hibar, .frow').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.width === 0) return;
      if (b.right > w + 1 || b.left < -1) {
        deta.push((el.id || el.className) + ' ' + Math.round(b.left) + '〜' + Math.round(b.right));
      }
    });
    return {
      haba: w,
      yoko: document.documentElement.scrollWidth - w, // ★横に すべる 量★
      deta: deta,
    };
  });
  // eslint-disable-next-line no-console
  console.log('★はみ出し★ ' + JSON.stringify(r));
  expect(r.deta, '★画面から はみ出している 物が あります★').toEqual([]);
  expect(r.yoko, '★横に すべります★').toBeLessThanOrEqual(0);
});

test('★★③ 打つと 日ごとの 棚へ 行く（元データは 触らない）★★', async ({ page }) => {
  await hiraku(page);
  await page.fill('#denshiYen', '4500');
  await page.dispatchEvent('#denshiYen', 'change');
  await page.waitForTimeout(500);
  const okutta = await page.evaluate(() => window.__okutta || []);
  // eslint-disable-next-line no-console
  console.log('★送った 先★ ' + JSON.stringify(okutta.map((x) => x.saki)));
  const pp = okutta.filter((x) => x.saki.indexOf('dk_day_extras') === 0);
  expect(pp.length, '★日ごとの 棚へ 行っていません★').toBe(1);
  const body = JSON.parse(pp[0].body);
  expect(body.pay_date, '★日が 違います★').toBe(HI);
  expect(body.denshi_yen, '★打った 額が 違います★').toBe(4500);
  expect(body.company_id, '★会社が 入っていません★').toBe('c1');
  expect(
    okutta.filter((x) => /dk_shifts|dk_trips|dk_work_hours|dk_employees/.test(x.saki)).length,
    '★元データに 書いています★'
  ).toBe(0);
});

test('★★④ 実費は 前と 同じ 所へ 行く★★', async ({ page }) => {
  await hiraku(page);
  const kou = page.locator('#shaList [data-sid="s2"][data-f="toll"]');
  await kou.fill('800');
  await kou.dispatchEvent('change');
  await page.waitForTimeout(500);
  const okutta = await page.evaluate(() => window.__okutta || []);
  const ed = okutta.filter((x) => x.saki.indexOf('dk_shift_edits') === 0);
  // eslint-disable-next-line no-console
  console.log('★実費の 送り先★ ' + JSON.stringify(ed.map((x) => JSON.parse(x.body))));
  expect(ed.length, '★実費が 保存に 行っていません★').toBe(1);
  expect(JSON.parse(ed[0].body).toll_yen, '★高速代が 入っていません★').toBe(800);
  expect(
    okutta.filter((x) => x.saki.indexOf('dk_day_extras') === 0).length,
    '★実費を 打ったのに 電子決済 の 棚へ 行っています★'
  ).toBe(0);
});

test('★★⑤ 前の日／次の日 で 動く★★', async ({ page }) => {
  await hiraku(page);
  await page.click('#prevD');
  await page.waitForTimeout(900);
  const a = await page.evaluate(() => ({
    // ★★日付は 欄が 出す★★ 2026-09-08（司さん「赤丸の日付いらんことないか？」）
    //   ⇒ 見るのは ★欄の 値★＋★曜日★（下の 行は 消しました）
    hi:
      ((document.getElementById('hiSel') || {}).value || '') +
      ((document.getElementById('hiYoubi') || {}).textContent || ''),
    pp: (document.getElementById('denshiYen') || {}).value,
    msg: (document.getElementById('msg') || {}).textContent || '',
  }));
  // eslint-disable-next-line no-console
  console.log('★前の日★ ' + JSON.stringify(a));
  expect(a.hi, '★前の日に 動いていません★').toContain('2026-09-01');
  expect(a.pp, '★別の 日の 電子決済 が 残っています★').toBe('');
  expect(a.msg, '★記録が 無い 日に 何も 言っていません★').toContain('記録が ありません');

  await page.click('#nextD');
  await page.waitForTimeout(900);
  const b = await page.evaluate(() => ({
    // ★★日付は 欄が 出す★★ 2026-09-08（司さん「赤丸の日付いらんことないか？」）
    //   ⇒ 見るのは ★欄の 値★＋★曜日★（下の 行は 消しました）
    hi:
      ((document.getElementById('hiSel') || {}).value || '') +
      ((document.getElementById('hiYoubi') || {}).textContent || ''),
    pp: (document.getElementById('denshiYen') || {}).value,
  }));
  // eslint-disable-next-line no-console
  console.log('★次の日★ ' + JSON.stringify(b));
  expect(b.hi, '★戻っていません★').toContain('2026-09-02');
  expect(b.pp, '★戻った 日の 電子決済 が 出ていません★').toBe('3200');
});
