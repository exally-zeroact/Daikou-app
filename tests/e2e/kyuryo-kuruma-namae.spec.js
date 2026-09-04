// ============================================================
// ★★名前を 付けた 車は 走っていなくても 名前で 出る★★ 2026-09-04（司さん）
//
//   ★司さんの言葉★「★なんで 1173って 登録しとるやつが 反映されてないんど★」
//
//   ★実測（本番の 倉庫）★
//     ZERO代行の 端末 4台 … 1173 / 1466 / 4987 / （名前なし）
//     ★1173（22849fdb）は 登録ずみ★／最後に 走ったのは ★2026-08-03★
//     ⇒ 9月の 明細を 開くと 9月の 記録しか 読まない
//     ⇒ 名前の 元に 入らず ★「車」と 出ていた★（絵で 確認）
//
//   ★元★ kyuryo.html の _carNames() が
//         ★走った 記録（shifts / workHours）の 端末しか 渡していなかった★
//         js/car-name.js の nameMap の 決まりは ★「その会社の端末ID全部」★
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-04 実測）★★
//     ①車名の 元から labels を 外す（元の 形に 戻す）… ★赤★
//     ②選ぶ欄を 数えない（0個に する）… ★赤★
//     戻した後 … ★緑★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);

// ★本物と 同じ 形★ … 3台 走っている ／ ★1台は 登録だけで 走っていない★
const HASHITTA = 'dev-hashitta-1111';
const HASHITTA2 = 'dev-hashitta-2222';
const NORANAI = 'dev-noranai-3333';
const NANASHI = 'dev-nanashi-4444';
const LABELS = [
  { company_id: FIX.settings[0].company_id, device_id: HASHITTA, label: '1466' },
  { company_id: FIX.settings[0].company_id, device_id: HASHITTA2, label: '4987' },
  { company_id: FIX.settings[0].company_id, device_id: NORANAI, label: '1173' },
  { company_id: FIX.settings[0].company_id, device_id: NANASHI, label: '' },
];

test('★登録した 車は 走っていなくても 名前で 出る★', async ({ page }) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: FIX.settings[0].company_id, name: '見張り用' };
  // ★走った 記録には 1173 と 名無しを 入れない★（本物と 同じ 形）
  const shifts = (FIX.shifts || []).map(function (s, i) {
    return Object.assign({}, s, { device_id: i % 2 === 0 ? HASHITTA : HASHITTA2 });
  });
  // ★時数の 記録も 同じ 2台に そろえる★（本物と 同じ 形に する＝余計な 車を 作らない）
  const workHours = (FIX.workHours || []).map(function (w, i) {
    return Object.assign({}, w, { device_id: i % 2 === 0 ? HASHITTA : HASHITTA2 });
  });
  const t =
    moto +
    ';(function(){var F=' +
    JSON.stringify(
      Object.assign({}, FIX, { labels: LABELS, shifts: shifts, workHours: workHours })
    ) +
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
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};})();';
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: t })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/kyuryo.html');
  await page.waitForTimeout(1800);
  await page.locator('.tab[data-tab="set"]').click();
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const sel = document.getElementById('ownerDev');
    return {
      kazu: sel ? sel.options.length : 0,
      ji: sel ? [...sel.options].map((o) => o.textContent.trim()) : [],
    };
  });
  console.log('★自分の車の 選ぶ欄★ ' + JSON.stringify(r));
  expect(r.kazu, '★選ぶ欄を 数えられていません★').toBeGreaterThan(3);
  // ★走っていない 1173 が 名前で 出ている事★（ここが 本題）
  expect(r.ji, '★登録した 1173 が 名前で 出ていません★').toContain('1173');
  expect(r.ji, '★走った 1466 が 出ていません★').toContain('1466');
  expect(r.ji, '★走った 4987 が 出ていません★').toContain('4987');
  // ★名前を 付けていない 車は 「車1」の ような 仮名★（UUID は 出さない）
  // ★番号なしの ただの「車」を 出さない★
  //   ＝★選ぶ欄に 出す 車と 名前の 元が ずれている印★（前は 2つ 出ていた）
  expect(
    r.ji.filter((x) => x === '車'),
    '★番号なしの「車」が 出ています（元が ずれています）★'
  ).toEqual([]);
  const uuid = r.ji.filter((x) => /dev-|[0-9a-f]{8}-[0-9a-f]{4}/.test(x));
  expect(uuid, '★端末IDが そのまま 出ています★').toEqual([]);
  expect(err, '★画面が 落ちました★').toEqual([]);
  await page.screenshot({
    path: 'C:/Users/zeroa/dk-tokei-2026-09-02/tokei/shot-kuruma-namae.png',
  });
});
