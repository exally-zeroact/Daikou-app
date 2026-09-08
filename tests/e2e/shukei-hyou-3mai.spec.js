// ============================================================
// ★★月ごとの 表＝3枚・窓の 中・式が 読める★★ 2026-09-08
//
//   ★司さんの言葉★
//     「売上も距離もやけど月ごとの12ヶ月が窓ないでスクロールせんでええ縦幅に合わせろや」
//     「お金に至ってはなぜ会社に残るお金が給料を引いた額やないんど」
//     「売上になんで給料があるんど」
//
//   ★何が 悪かったか（実測 2026-09-08・司さんの 実機の 写真）★
//     ①12ヶ月の 表が ★窓に 入っていない★ ⇒ ページが 伸びて 上が 見切れる
//     ②★売上の 表に 給料の 列★が 在った（売上の 表なのに）
//     ③「会社に残る分」だけ ぽつんと 在って ★何を 引いた 額か 読めない★
//        （式は 合っていた。勤務時数が ★0件★なので 給料が 0 で
//          「引いていない」ように 見えていた ＝ 2026-09-08 本番で 実測）
//
//   ★直し★
//     ①表ごとに ★高さの 決まった 窓★（見出しは 貼り付く）
//     ②表を ★3枚★に 分ける
//         売上 …… 月／売上／経費／未収／現金
//         給料 …… 月／締めの 回ごと／合計
//         会社に残る分 … 月／★売上／− 給料／− 積立金★／答え
//     ③給料が 0 の 時は ★その 訳を 画面に 書く★
//
//   ★★2026-09-08（2回目）★★ 司さん「12ヶ月をスクロールせんでええように見せろや」
//     ★窓（230px）に 入れた だけでは 足りなかった★＝中身 297px ＝ 窓の 中で すべる
//     ⇒ ①窓を やめて ★12ヶ月＋合計を 丸ごと★ 出す（スクロール 0）
//       ②3枚を ★札で 切り替え★＝一度に 1枚だけ ⇒ ページも 伸びない
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-08 実測 ＝ 下に 書く）★★
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = FIX.settings[0].company_id;

function stub() {
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
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
}

test('★★① 12ヶ月は スクロール 0 で 全部 見える★★', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(() => {
    const out = [];
    const seg = { tbl: 'segUri', tbl3: 'segKyu', tbl2: 'segNokori' };
    Object.keys(seg).forEach((id) => {
      const b = document.getElementById(seg[id]);
      if (b) b.click();
      const t = document.getElementById(id);
      if (!t) return out.push({ id: id, aru: false });
      const oya = t.parentElement;
      const st = getComputedStyle(oya);
      out.push({
        id: id,
        aru: true,
        // ★12ヶ月＋見出し＋合計＝14行 全部 在る★
        gyou: t.querySelectorAll('tbody tr').length,
        // ★中で スクロールしない★（中身が 入れ物に 収まっている）
        suberu: Math.max(0, oya.scrollHeight - oya.clientHeight),
        mado: st.overflowY === 'auto' || st.overflowY === 'scroll',
        takasa: Math.round(t.getBoundingClientRect().height),
      });
    });
    const su = document.getElementById('segUri');
    if (su) su.click();
    return { hyou: out, gamen: window.innerHeight };
  });
  // eslint-disable-next-line no-console
  console.log('★12ヶ月の 表★ ' + JSON.stringify(r));
  r.hyou.forEach((x) => {
    expect(x.aru, '★' + x.id + ' の 表が ありません★').toBe(true);
    expect(x.gyou, '★' + x.id + ' に 12ヶ月＋合計が 出ていません★').toBe(13);
    expect(x.suberu, '★' + x.id + ' は まだ スクロールが 要ります★').toBe(0);
    expect(x.mado, '★' + x.id + ' が 窓の ままです（丸ごと 出す）★').toBe(false);
    expect(x.takasa, '★' + x.id + ' が 画面より 高い★').toBeLessThan(r.gamen);
  });
});

// ★★一度に 1枚だけ★★ 2026-09-08（3枚 並べると ページが 伸びる）
test('★★①-2 月ごとの 表は 一度に 1枚だけ★★', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(() => {
    const mieru = () =>
      [...document.querySelectorAll('[data-tsuki]')].filter((d) => d.offsetHeight > 0).length;
    const out = { hajime: mieru(), oshita: [] };
    ['segKyu', 'segNokori', 'segUri'].forEach((id) => {
      const b = document.getElementById(id);
      if (b) b.click();
      out.oshita.push(mieru());
    });
    return out;
  });
  // eslint-disable-next-line no-console
  console.log('★出ている 枚数★ ' + JSON.stringify(r));
  expect(r.hajime, '★はじめから 2枚 以上 出ています★').toBe(1);
  r.oshita.forEach((n) => expect(n, '★押した後に 2枚 以上 出ています★').toBe(1));
});

test('★★② 売上の 表に 給料は 無い／給料は 給料の 表★★', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(() => ({
    uri: [...document.querySelectorAll('#thead th')].map((x) => x.textContent.trim()),
    kyu: [...document.querySelectorAll('#thead3 th')].map((x) => x.textContent.trim()),
    nokori: [...document.querySelectorAll('#thead2 th')].map((x) => x.textContent.trim()),
  }));
  // eslint-disable-next-line no-console
  console.log('★見出し★ ' + JSON.stringify(r));
  expect(r.uri.join(','), '★売上の 表に 給料が 在ります★').not.toContain('給料');
  expect(r.uri, '★売上の 表の 列が 違います★').toEqual(['月', '売上', '経費', '未収', '現金']);
  expect(r.kyu[0], '★給料の 表が ありません★').toBe('月');
  expect(r.kyu[r.kyu.length - 1], '★給料の 合計が ありません★').toBe('合計');
});

test('★★③ 会社に残る分＝売上 − 給料 − 積立金 が 読める★★', async ({ page }) => {
  await hiraku(page);
  const r = await page.evaluate(() => {
    const th = [...document.querySelectorAll('#thead2 th')].map((x) => x.textContent.trim());
    // ★数字が 入っている 月の 行で 式を 確かめる★
    const gyou = [...document.querySelectorAll('#tbody2 tr')]
      .map((tr) => [...tr.children].map((td) => td.textContent.trim()))
      .filter((x) => x[1] && x[1] !== '—');
    return { th: th, gyou: gyou, note: (document.getElementById('kyuryoNote') || {}).textContent };
  });
  // eslint-disable-next-line no-console
  console.log('★会社に残る分★ ' + JSON.stringify({ th: r.th, gyou: r.gyou.slice(0, 3) }));
  expect(r.th, '★式の 列に なっていません★').toEqual([
    '月',
    '売上',
    '− 給料',
    '− 積立金',
    '会社に残る分',
  ]);
  expect(r.gyou.length, '★数字の 行が ありません★').toBeGreaterThan(0);
  // ★出ている 数字だけで 式が 合う★
  const kazu = (s) => Number(String(s).replace(/[^\d-]/g, '')) || 0;
  r.gyou.forEach((g) => {
    const uri = kazu(g[1]);
    const kyu = kazu(g[2]);
    const tsumi = kazu(g[3]);
    const nokori = kazu(g[4]);
    expect(
      uri - kyu - tsumi,
      '★' + g[0] + '：売上 − 給料 − 積立金 が 会社に残る分に なっていません★'
    ).toBe(nokori);
  });
  // ★給料が 0 なら その 訳を 書く★（司さん「なぜ給料を引いた額やないんど」）
  const kyuGoukei = r.gyou.reduce((a, g) => a + kazu(g[2]), 0);
  if (kyuGoukei === 0) {
    expect(r.note, '★給料が 0 の 訳が 書いてありません★').toContain('勤務時数');
  }
});
