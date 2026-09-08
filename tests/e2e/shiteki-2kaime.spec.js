// ============================================================
// ★★司さんの 指摘（2026-09-08・2回目）★★
//
//   ★司さんの言葉★
//     「日付選んどんやけん入力するとこ出しとけや」
//       → tests/e2e/jimusho-shiteki-11ken.spec.js ③③-2
//     「月ごとの窓はスクロールせんようにって言うたことないか？」
//       → ★ここ★（上の 3枚は 直したが ★下の「売上」「距離」を 直していなかった★）
//     「赤丸の所は窓で分とけやぼけ」
//       → ★ここ★（料金表の 2つの 表を 別々の 窓に）
//     「ほんでなんで22kmまでしかないんど」
//       → ★ここ★（22km 打ち切りを やめる）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-08 実測 ＝ 下に 書く）★★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FIX = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = FIX.settings[0].company_id;

function stub(shashu) {
  const moto = fs.readFileSync(path.join(ROOT, 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: 'ZERO代行' };
  return (
    moto +
    ';(function(){var F=' +
    JSON.stringify(FIX) +
    ';var co=' +
    JSON.stringify(co) +
    ';var RY=' +
    JSON.stringify([{ config: shashu ? CFG_SHASHU : CFG, updated_at: '2026-09-05T10:00:00Z' }]) +
    ';' +
    'function rows(p){ if(p.indexOf("dk_fare_config")===0)return RY;' +
    ' if(p.indexOf("dk_employees")===0)return F.emps||[]; if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
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

// ★車種ごとの 料金を 使う 見本★（司さん「車ごとやのに選ぶとこすらない」）
const CFG_SHASHU = {
  base_fare: 1300,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: 420,
  rounding: 10,
  vehiclesEnabled: true,
  vehicles: [
    { id: 'v1', name: '普通車', multiplier: 1, addon: 0, default: true },
    { id: 'v2', name: 'ワゴン', multiplier: 1.2, addon: 500 },
  ],
  autoSurcharges: {
    night: { enabled: false, from: 22, to: 5, rate: 1.2 },
    weekend: { enabled: false, rate: 1.1 },
  },
};

const CFG = {
  base_fare: 1300,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: 420,
  rounding: 10,
  autoSurcharges: {
    night: { enabled: true, from: 22, to: 5, rate: 1.2 },
    weekend: { enabled: true, rate: 1.1 },
  },
};

async function hiraku(page, gamen, shashu) {
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: stub(shashu),
    })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
  await page.route('**/rest/v1/**', (r) => {
    const u = r.request().url();
    let body = '[]';
    if (u.indexOf('dk_fare_config') >= 0) {
      body = JSON.stringify([
        { config: shashu ? CFG_SHASHU : CFG, updated_at: '2026-09-05T10:00:00Z' },
      ]);
    } else if (u.indexOf('dk_companies') >= 0) {
      body = JSON.stringify([{ company_id: CO, name: 'ZERO代行' }]);
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: body });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/' + gamen, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2300);
}

test('★★① 売上・距離も 月ごと／年間は スクロール 0★★', async ({ page }) => {
  await hiraku(page, 'shukei.html');
  const r = await page.evaluate(() => {
    const out = [];
    const shirabe = (id, mode) => {
      const t = document.getElementById(id);
      if (!t) return out.push({ id: id, mode: mode, aru: false });
      const hako = t.parentElement;
      out.push({
        id: id,
        mode: mode,
        aru: true,
        gyou: t.querySelectorAll('tbody tr').length,
        suberu: Math.max(0, hako.scrollHeight - hako.clientHeight),
        // ★丸ごと 出す 印★（日ごとは 付かない＝窓の まま）
        marugoto: hako.classList.contains('marugoto'),
      });
    };
    // ★売上★
    document.querySelector('[data-uri="month"]').click();
    shirabe('uriTbl', 'uri-month');
    document.querySelector('[data-uri="year"]').click();
    shirabe('uriTbl', 'uri-year');
    document.querySelector('[data-uri="day"]').click();
    shirabe('uriTbl', 'uri-day');
    // ★距離★
    document.querySelector('[data-kyori="month"]').click();
    shirabe('kyoriTbl', 'kyori-month');
    document.querySelector('[data-kyori="day"]').click();
    shirabe('kyoriTbl', 'kyori-day');
    return out;
  });
  // eslint-disable-next-line no-console
  console.log('★売上・距離★ ' + JSON.stringify(r));
  r.forEach((x) => {
    expect(x.aru, '★' + x.id + ' が ありません★').toBe(true);
  });
  // ★月ごと・年間は すべらない★
  r.filter((x) => x.mode.indexOf('day') < 0).forEach((x) => {
    expect(x.suberu, '★' + x.mode + ' が まだ スクロールが 要ります★').toBe(0);
  });
  // ★月ごと・年間には 丸ごとの 印が 付く★
  r.filter((x) => x.mode.indexOf('day') < 0).forEach((x) => {
    expect(x.marugoto, '★' + x.mode + ' が 丸ごとに なっていません★').toBe(true);
  });
  // ★日ごと（31行 出る 事が ある）は 窓の まま★＝丸ごとは 画面に 入らない
  //   ★行の 数では 見ません★＝見本の 月に 記録が 無いと 1行しか 出ない（2026-09-08 実測）
  const hi = r.filter((x) => x.mode.indexOf('day') >= 0);
  expect(hi.length, '★日ごとを 見ていません★').toBe(2);
  hi.forEach((x) => {
    expect(x.marugoto, '★' + x.mode + ' が 窓で なくなっています★').toBe(false);
  });
});

test('★★② 料金表の 2つの 表は 別々の 窓★★', async ({ page }) => {
  await hiraku(page, 'ryokinhyou.html');
  const r = await page.evaluate(() => {
    const ima = document.getElementById('imaTbl');
    const km = document.getElementById('kmTbl');
    const w = document.documentElement.clientWidth;
    const f = (t) => {
      if (!t) return { aru: false };
      const hako = t.parentElement;
      const st = getComputedStyle(hako);
      return {
        aru: true,
        mado: hako.className,
        yokoMado: st.overflowX === 'auto' || st.overflowX === 'scroll',
        tateMado: st.overflowY === 'auto' || st.overflowY === 'scroll',
        // ★入れ物が 画面から はみ出していない★
        hamidashi: Math.round(hako.getBoundingClientRect().right) > w + 1,
      };
    };
    return {
      ima: f(ima),
      km: f(km),
      // ★上の 表は 4列 全部 在る★（「それ以降」を 削っていない）
      imaTh: [...document.querySelectorAll('#imaHead th')].map((x) => x.textContent.trim()),
      yoko: document.documentElement.scrollWidth - w,
    };
  });
  // eslint-disable-next-line no-console
  console.log('★料金表の 窓★ ' + JSON.stringify(r));
  expect(r.ima.aru, '★上の 表が ありません★').toBe(true);
  expect(r.km.aru, '★何キロで いくらの 表が ありません★').toBe(true);
  expect(r.ima.mado, '★上の 表が 窓に 入っていません★').toContain('mado');
  expect(r.km.mado, '★下の 表が 窓に 入っていません★').toContain('mado');
  // ★★横に すべらせるのは 間違いでした★★ 2026-09-08
  //   司さんは 前に「横に すべらせるな」と 言っています（見張りも 在った）。
  //   ⇒ ★折り返して 収める★。横に すべる 箱は 作らない。
  expect(r.ima.yokoMado, '★横に すべる 箱を 作っています★').toBe(false);
  expect(r.km.tateMado, '★下の 表が 縦に すべりません★').toBe(true);
  expect(r.imaTh, '★上の 表の 列が 違います★').toEqual(['区分', 'いくら', 'どこまで', 'それ以降']);
  expect(r.ima.hamidashi, '★上の 窓が 画面から はみ出しています★').toBe(false);
  expect(r.km.hamidashi, '★下の 窓が 画面から はみ出しています★').toBe(false);
  expect(r.yoko, '★ページが 横に すべります★').toBeLessThanOrEqual(0);
});

// ★★会社設定の 窓の 中（狭い 幅）でも 4列 出る★★ 2026-09-08
//   ★見切れていた 本当の 訳★＝窓の 中は ★328px★＝画面(390px)より 狭い。
//   ⇒ ★その 狭い 幅で 測る★（画面の 幅で 測っても 見つからない）
test('★★②-2 狭い 窓の 幅でも 4列 切れない★★', async ({ page }) => {
  await hiraku(page, 'ryokinhyou.html?embed=1');
  // ★会社設定の 窓と 同じ 幅★（実測 328px）
  await page.setViewportSize({ width: 328, height: 700 });
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const t = document.getElementById('imaTbl');
    const hako = t.parentElement;
    const w = document.documentElement.clientWidth;
    const kire = [];
    t.querySelectorAll('th, td').forEach((c) => {
      // ★字が ますに 収まっているか★（はみ出して 隠れていないか）
      if (c.scrollWidth > c.clientWidth + 1) kire.push(c.textContent.trim());
    });
    return {
      haba: w,
      hyou: Math.round(t.getBoundingClientRect().width),
      hako: Math.round(hako.getBoundingClientRect().width),
      suberu: Math.max(0, hako.scrollWidth - hako.clientWidth),
      kire: kire,
      retsu: t.querySelectorAll('thead th').length,
    };
  });
  // eslint-disable-next-line no-console
  console.log('★狭い 窓★ ' + JSON.stringify(r));
  expect(r.retsu, '★4列 出ていません★').toBe(4);
  expect(r.kire, '★ますから はみ出して 隠れている 字が あります★').toEqual([]);
  expect(r.suberu, '★横に すべります★').toBe(0);
  expect(r.hyou, '★表が 窓より 広い★').toBeLessThanOrEqual(r.hako + 1);
});

test('★★③ 何キロで いくらが 22km で 止まらない★★', async ({ page }) => {
  await hiraku(page, 'ryokinhyou.html');
  const r = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#kmBody tr')];
    const yomu = (t) => Number(String(t || '').replace(/[^\d.]/g, ''));
    const owari = tr.length ? tr[tr.length - 1].children[0].textContent.trim() : '';
    return {
      gyou: tr.length,
      owari: owari,
      km: yomu(owari),
      saigo: tr.length ? tr[tr.length - 1].children[1].textContent.trim() : '',
    };
  });
  // eslint-disable-next-line no-console
  console.log('★何キロまで★ ' + JSON.stringify(r));
  expect(r.gyou, '★行が 少なすぎます★').toBeGreaterThan(100);
  expect(r.km, '★まだ 22km で 止まっています★').toBeGreaterThan(50);
  expect(r.saigo, '★最後の 金額が 出ていません★').toContain('円');
});

// ★★車種を 選べる／使っていない 時も その事を 出す★★ 2026-09-08
//   ★司さん★「なぜ車ごとやのに選ぶとこすらない？そもそも見せとけよ」
//   ★仕組みは 前から 在りました★（config.vehicles / vehiclesEnabled ＝ 倍率・加算）
//   ⇒ 見る 所にも 選ぶ 所にも 出していなかった。
test('★★④ 車種ごとの 料金が 使われている 時は 選べる★★', async ({ page }) => {
  await hiraku(page, 'ryokinhyou.html', true);
  const mae = await page.evaluate(() => ({
    mieru: (document.getElementById('shashuHako') || {}).style.display,
    erabi: [...document.querySelectorAll('#shashuSel option')].map((x) => x.textContent.trim()),
    hajime: (document.querySelector('#kmBody tr td:nth-child(2)') || {}).textContent,
  }));
  // eslint-disable-next-line no-console
  console.log('★車種（前）★ ' + JSON.stringify(mae));
  expect(mae.mieru, '★車種を 選ぶ 所が 出ていません★').not.toBe('none');
  expect(mae.erabi.join(','), '★車種が 出ていません★').toContain('ワゴン');

  // ★★選ぶと 額が その車の 物に なる★★（倍率 1.2 ＋ 加算 500）
  await page.selectOption('#shashuSel', 'v2');
  await page.waitForTimeout(500);
  const ato = await page.evaluate(() => ({
    hajime: (document.querySelector('#kmBody tr td:nth-child(2)') || {}).textContent,
    note: (document.getElementById('shashuNote') || {}).textContent || '',
  }));
  // eslint-disable-next-line no-console
  console.log('★車種（後）★ ' + JSON.stringify(ato));
  const kazu = (t) => Number(String(t).replace(/[^\d]/g, '')) || 0;
  expect(kazu(mae.hajime), '★素の 最初の 額が 出ていません★').toBe(1300);
  // ★1,300 × 1.2 ＋ 500 ＝ 2,060★（10円 まるめ）
  expect(kazu(ato.hajime), '★車種の 倍率・加算が 効いていません★').toBe(2060);
  expect(ato.note, '★選んだ 車種の 中身が 書いてありません★').toContain('ワゴン');
});

// ★★使っていない 時も『在る』事を 出す★★ 2026-09-08（司さん「そもそも見せとけよ」）
test('★★⑤ 車種を 使っていない 時は その事を 書く★★', async ({ page }) => {
  await hiraku(page, 'ryokinhyou.html', false);
  const r = await page.evaluate(() => ({
    mieru: (document.getElementById('shashuHako') || {}).style.display,
    note: (document.getElementById('shashuNote') || {}).textContent || '',
  }));
  // eslint-disable-next-line no-console
  console.log('★車種を 使っていない★ ' + JSON.stringify(r));
  expect(r.mieru, '★使っていないのに 選び が 出ています★').toBe('none');
  expect(r.note, '★使っていない事が 書いてありません★').toContain('使っていません');
  expect(r.note, '★どこで 足すかが 書いてありません★').toContain('料金を 決める');
});

// ★★「最後に 変えた 人」は 出さない★★ 2026-09-08（司さん「いらん」）
test('★★⑥ 最後に 変えた 人を 出さない★★', async ({ page }) => {
  await hiraku(page, 'ryokinhyou.html');
  const r = await page.evaluate(() => ({
    aru: !!document.getElementById('itsuno'),
    ji: document.body.innerText.indexOf('最後に 変えた 人'),
    ji2: document.body.innerText.indexOf('最後に変えた人'),
  }));
  // eslint-disable-next-line no-console
  console.log('★最後に 変えた 人★ ' + JSON.stringify(r));
  expect(r.aru, '★消したはずの 入れ物が 残っています★').toBe(false);
  expect(r.ji, '★「最後に 変えた 人」が 出ています★').toBe(-1);
  expect(r.ji2, '★「最後に変えた人」が 出ています★').toBe(-1);
});

// ★★会社設定の 料金＝開いたら すぐ 料金が 見える★★ 2026-09-08
//   ★司さん★「赤丸のところは上の塊の説明を除けてそこでええやろ」
test('★★⑦ 会社設定の 料金は 説明を やめて 表を 上に★★', async ({ page }) => {
  await hiraku(page, 'dashboard.html');
  await page.locator('[data-chip="ryokin"]').click();
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const pane = document.querySelector('[data-pane="ryokin"]');
    const mado = document.getElementById('ryokinMado');
    return {
      card: pane ? pane.querySelectorAll('.card').length : 0,
      setsumei: pane ? pane.innerText.indexOf('ここで 決めます') : -1,
      ue: mado ? Math.round(mado.getBoundingClientRect().top) : -1,
      gamen: window.innerHeight,
    };
  });
  // eslint-disable-next-line no-console
  console.log('★料金の 中身★ ' + JSON.stringify(r));
  expect(r.card, '★カードが 2枚の ままです（1枚に まとめる）★').toBe(1);
  expect(r.setsumei, '★説明が 残っています★').toBe(-1);
  expect(r.ue, '★料金の 窓が 画面の 外に あります★').toBeLessThan(r.gamen);
});
