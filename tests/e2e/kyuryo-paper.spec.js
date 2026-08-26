// ★給料明細の紙(PDF)を 実際に組んで 数で測る見張り★ 2026-08-26
//
//   ▼なぜ ここに要るか
//     8/25 に出した紙は ★司さんに突き返された★（見切れ・字が小さい・空の行が4本）。
//     その時の見張りは ★ソースに その字が在るか★ しか見ておらず ★全部 緑★だった。
//     ⇒ この見張りは ★本物の画面を開き 本物の _buildPaperSheet を呼んで★
//       ★出来た紙の中を px で測る★。
//
//   ▼測る物（2026-08-26 指示役の訂正後）
//     ①合計の塊が 見出しの ★中心★（合計の箱の中心 − 表の中心 が ±1px）
//       ※8/26 に一度 ★右端に揃えて★ 司さんに突き返された（★中心が 司さんの決定★）
//     ①-b 左の項目（日付/金額/時間/売上n/時間（全台））が ★中央揃え★
//     ②一番小さい字が 9pt以上（板の12px＝紙の9pt）
//     ③一番右の枠線より 右に 字が 1pxも出ない（10日・11日・31日・62日で押す）
//     ④中身が空の売上行 0件
//     ⑤紙の金額を1つずつ足した数 ＝ 紙の合計の箱に描かれた字（★中の値で閉じない★）
//     ⑥項目の字が 欠けていない
//     ⑦絵にする所が返らない時 ★永久に待たない★
//
//   ▼期間は 最長62日ある（js/payroll-period.js:128 `days >= 1 && days <= 62`）。
//     1枚に入らない時は ★字を小さくせず 紙を分ける★。
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);

// ★ログインだけ差し替える★（描く所・組む所・数える所は 本物のまま通す）
//   dk-session.js は ★本物を読み込んだ後ろに 上書きを足す★＝
//   softList/newLoadState/showUnknownBar など 中の作りは 本物が動く。
async function openKyuryo(page, naosu) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const tsugi =
    moto +
    ';(function(){var F=' +
    JSON.stringify(naosu ? naosu(JSON.parse(JSON.stringify(FIX))) : FIX) +
    ';' +
    'var co={company_id:F.settings[0].company_id,name:"見張り用"};' +
    'function rows(p){' +
    ' if(p.indexOf("dk_employees")===0)return F.emps||[];' +
    ' if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[];' +
    ' if(p.indexOf("dk_sales_settings")===0)return [];' +
    ' if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[];' +
    ' if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[];' +
    ' return [];}' +
    'var S=window.DKSession;' +
    'S.ensure=function(){return Promise.resolve({token:"dummy"});};' +
    'S.goLogin=function(){};' +
    'S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};' +
    'S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};' +
    '})();';
  await page.route('**/js/dk-session.js*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsugi,
    })
  );
  await page.goto('/kyuryo.html');
  await page.waitForFunction(() => window.__paper && window.__paper.ninzu() > 0, null, {
    timeout: 20000,
  });
}

// ★出来た紙の中を px で測る★
async function hakaru(page, ei) {
  return await page.evaluate((ei) => {
    const m = window.__paper.maisu(ei);
    const hi = window.__paper.hi(ei);
    const out = {
      maisu: m.n,
      per: m.per,
      hi,
      zure: 0,
      hamidashi: 0,
      hamidashiDoko: '',
      minPt: 999,
      karaUriage: 0,
      kake: 0,
      hidariYose: 0,
      hidariYoseDoko: '',
      tashita: 0,
      goukeiNoJi: null,
    };
    for (let i = 0; i < m.n; i++) {
      const from = i * m.per;
      const to = Math.min(hi, from + m.per);
      const sh = window.__paper.build(ei, from, to, i + 1, m.n);
      document.body.appendChild(sh);
      const R = (el) => el.getBoundingClientRect();
      const table = sh.querySelector('table');
      const head = sh.querySelector('div');
      const sums = [...head.children].find((c) => c.textContent.indexOf('合計') === 0);
      const tR = R(table);
      // ★中心どうしで測る★（右端で測ると 右に貼り付いた形が 緑になる）
      const sR = R(sums);
      out.zure = Math.max(out.zure, Math.abs((sR.left + sR.right) / 2 - (tR.left + tR.right) / 2));

      // ★項目の字が 中央に在るか★＝字そのもの（テキストノード）で測る
      const jiRect = (el) => {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let L = Infinity;
        let Rr = -Infinity;
        let n;
        while ((n = w.nextNode())) {
          if (!n.nodeValue.trim()) continue;
          const rg2 = document.createRange();
          rg2.selectNodeContents(n);
          const r2 = rg2.getBoundingClientRect();
          L = Math.min(L, r2.left);
          Rr = Math.max(Rr, r2.right);
        }
        return { left: L, right: Rr };
      };
      sh.querySelectorAll('tbody th').forEach((th) => {
        const c = R(th);
        const ji = jiRect(th);
        if (!isFinite(ji.left)) return;
        const zure = Math.abs(ji.left - c.left - (c.right - ji.right));
        if (zure > out.hidariYose) {
          out.hidariYose = zure;
          out.hidariYoseDoko = th.textContent.trim();
        }
      });
      if (sh.getAttribute('data-label-kake') === '1') out.kake++;

      sh.querySelectorAll('th,td').forEach((c) => {
        const cR = R(c);
        const rg = document.createRange();
        rg.selectNodeContents(c);
        for (const r of rg.getClientRects()) {
          const over = Math.max(r.right - tR.right, r.right - cR.right);
          if (over > out.hamidashi) {
            out.hamidashi = over;
            out.hamidashiDoko = c.textContent.trim();
          }
        }
      });

      sh.querySelectorAll('*').forEach((el) => {
        if (!el.textContent.trim()) return;
        const f = parseFloat(getComputedStyle(el).fontSize);
        if (f && f * 0.75 < out.minPt) out.minPt = f * 0.75;
      });

      const trs = [...sh.querySelectorAll('tbody tr')];
      out.karaUriage += trs.filter((tr) => {
        if (!tr.querySelector('th').textContent.trim().startsWith('売上')) return false;
        return [...tr.querySelectorAll('td')].every((td) => !td.textContent.trim());
      }).length;

      const kin = trs.find((tr) => tr.querySelector('th').textContent.trim().startsWith('金額'));
      [...kin.querySelectorAll('td')].forEach((td) => {
        out.tashita += parseInt(td.textContent.replace(/[^0-9]/g, ''), 10) || 0;
      });

      if (i === 0) {
        // ★箱の字は 1つずつ読む★（つなげて読むと ¥18,500 と 18.5時間 が「1850018」になる）
        const ji = [...sums.querySelectorAll('span')].map((x) => x.textContent.trim());
        const g = (ji.find((t) => t.indexOf('¥') === 0) || '').match(/¥([\d,]+)/);
        out.goukeiNoJi = g ? Number(g[1].replace(/,/g, '')) : null;
      }
      sh.remove();
    }
    return out;
  }, ei);
}

test.describe('★給料明細の紙(PDF)★', () => {
  test('★本物の10日ぶん … 4つの数を測る★', async ({ page }) => {
    await openKyuryo(page);
    const n = await page.evaluate(() => window.__paper.ninzu());
    expect(n, '★明細が1枚も出ていない★').toBeGreaterThan(0);
    for (let ei = 0; ei < n; ei++) {
      const r = await hakaru(page, ei);
      expect(
        r.zure,
        `★${ei}人め：合計の塊が 中心に無い（中心から ${r.zure}px ずれている）★`
      ).toBeLessThanOrEqual(1);
      expect(
        r.hidariYose,
        `★${ei}人め：項目「${r.hidariYoseDoko}」が 中央揃えでない（${r.hidariYose}px 寄っている）★`
      ).toBeLessThanOrEqual(1);
      expect(r.minPt, `★${ei}人め：一番小さい字が ${r.minPt}pt★`).toBeGreaterThanOrEqual(9);
      expect(
        r.hamidashi,
        `★${ei}人め：枠線より右に「${r.hamidashiDoko}」が ${r.hamidashi}px 出ている★`
      ).toBeLessThanOrEqual(0.5);
      expect(r.karaUriage, `★${ei}人め：中身が空の売上行が ${r.karaUriage}本★`).toBe(0);
      expect(r.kake, `★${ei}人め：項目の字が欠けている★`).toBe(0);
      // ★紙の字どうしで検算する（中の値で閉じない）★
      expect(r.tashita, `★${ei}人め：紙の金額を足した数と 紙の合計の字が 食い違う★`).toBe(
        r.goukeiNoJi
      );
    }
  });

  for (const days of [11, 31, 62]) {
    test(`★${days}日ある期間 … 字を小さくせず 紙を分ける★`, async ({ page }) => {
      await openKyuryo(page);
      await page.evaluate((days) => {
        const emp = window.__paper.emp(0);
        const src = emp.cells.slice();
        while (emp.cells.length < days) {
          const c = JSON.parse(JSON.stringify(src[emp.cells.length % src.length]));
          const d = new Date(2026, 7, 1 + emp.cells.length);
          c.date =
            d.getFullYear() +
            '-' +
            String(d.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(d.getDate()).padStart(2, '0');
          emp.cells.push(c);
        }
        emp.cells.length = days;
      }, days);
      const r = await hakaru(page, 0);
      expect(r.hi, '★日を増やせていない★').toBe(days);
      expect(r.minPt, `★一番小さい字が ${r.minPt}pt★`).toBeGreaterThanOrEqual(9);
      expect(
        r.hamidashi,
        `★枠線より右に「${r.hamidashiDoko}」が ${r.hamidashi}px 出ている★`
      ).toBeLessThanOrEqual(0.5);
      expect(r.zure, `★合計の塊が 中心から ${r.zure}px ずれている★`).toBeLessThanOrEqual(1);
      expect(
        r.hidariYose,
        `★項目「${r.hidariYoseDoko}」が 中央揃えでない（${r.hidariYose}px）★`
      ).toBeLessThanOrEqual(1);
      expect(r.karaUriage, '★中身が空の売上行が在る★').toBe(0);
      expect(r.maisu * r.per, `★${days}日ぶんが 紙に載り切っていない★`).toBeGreaterThanOrEqual(
        days
      );
    });
  }

  test('★絵にする所が返らない時 永久に待たない★', async ({ page }) => {
    test.setTimeout(60000);
    await openKyuryo(page);
    const r = await page.evaluate(async () => {
      const ms = window.__paper.timeoutMs();
      window.html2canvas = function () {
        return new Promise(function () {});
      }; // ★永久に返らない★
      const mae = document.querySelectorAll('[data-paper]').length;
      const t0 = performance.now();
      window.printOne(0);
      const msg = await new Promise((ok) => {
        const t = setInterval(() => {
          const e = document.getElementById('err');
          if (e && !e.hidden && e.textContent.trim()) {
            clearInterval(t);
            ok(e.textContent.trim());
          }
          if (performance.now() - t0 > ms + 15000) {
            clearInterval(t);
            ok(null);
          }
        }, 100);
      });
      return {
        byo: (performance.now() - t0) / 1000,
        msg,
        nokori: document.querySelectorAll('[data-paper]').length - mae,
        ms,
      };
    });
    expect(r.msg, '★何秒たっても 何も知らせない★').toBeTruthy();
    expect(r.byo, `★${r.byo}秒 かかった★`).toBeLessThan(r.ms / 1000 + 10);
    expect(r.nokori, '★組んだ板が 画面に残っている★').toBe(0);
    // ★中の言葉を客に見せない／嘘を出さない★
    expect(r.msg, '★時間切れなのに「道具が読めない」と嘘を出す★').not.toContain('道具が読めません');
    expect(r.msg).not.toMatch(/html2canvas|jsPDF|Error/);
  });

  test('★車名が長くても 列を広げない（2行に折る・切ったら「…」）★', async ({ page }) => {
    await openKyuryo(page);
    const r = await page.evaluate(() => {
      const mae = window.__paper.build(0, 0, 10, 1, 1);
      document.body.appendChild(mae);
      const maeW = Number(mae.getAttribute('data-label-w'));
      const maeDay = Number(mae.getAttribute('data-day-w'));
      mae.remove();

      // ★実物より ずっと長い車名★を 入れて 同じ物を組み直す
      const nagai = '事務所の裏に置いてある予備の軽自動車（黒）8627号車';
      window.__paper.cars()[0].label = nagai;
      const ato = window.__paper.build(0, 0, 10, 1, 1);
      document.body.appendChild(ato);
      const th = [...ato.querySelectorAll('tbody tr')]
        .find((tr) => tr.querySelector('th').textContent.trim().startsWith('売上'))
        .querySelector('th');
      const sub = th.lastElementChild;
      const thR = th.getBoundingClientRect();
      const rg = document.createRange();
      rg.selectNodeContents(sub);
      const o = {
        maeW,
        maeDay,
        atoW: Number(ato.getAttribute('data-label-w')),
        atoDay: Number(ato.getAttribute('data-day-w')),
        deta: sub.textContent,
        nagai,
        gyou: Math.round(sub.scrollHeight / (parseFloat(getComputedStyle(sub).lineHeight) || 15)),
        kireta: sub.scrollHeight > sub.clientHeight + 1,
        hamideta: Math.max(0, rg.getBoundingClientRect().right - thR.right),
        thTakasa: thR.height,
      };
      ato.remove();
      return o;
    });
    // ★列は 1pxも広がらない★（広がると 日付の列が痩せて 日付や金額が欠ける）
    expect(r.atoW, `★車名で 項目の列が ${r.maeW}→${r.atoW}px に広がった★`).toBe(r.maeW);
    expect(r.atoDay, `★車名で 日付の列が ${r.maeDay}→${r.atoDay}px に痩せた★`).toBe(r.maeDay);
    // ★列の外に はみ出さない★
    expect(r.hamideta, `★車名が 列から ${r.hamideta}px はみ出した★`).toBeLessThanOrEqual(0.5);
    // ★2行に折る★（行の高さ50pxに収まる）
    expect(r.gyou, `★車名が ${r.gyou}行になった（2行まで）★`).toBeLessThanOrEqual(2);
    expect(r.thTakasa, `★行が ${r.thTakasa}px に伸びた★`).toBeLessThanOrEqual(51);
    // ★黙って消さない★＝切ったなら「…」が付く
    expect(r.kireta, '★2行に収まらないのに 中で切れている（切ったと分からない）★').toBe(false);
    expect(r.deta.length, '★車名が 何も出ていない★').toBeGreaterThan(0);
    if (r.deta !== r.nagai) {
      expect(r.deta.endsWith('…'), `★切ったのに「…」が無い（出た字：${r.deta}）★`).toBe(true);
    }
  });

  // ★最低保証で出した日の 金額は 赤★ 2026-08-26（司さん）
  //   ★割り算で当てず エンジンの usedFloor を使う★（js/daiko-payroll.js:169）
  //   ここは ★倉庫の行を本物のエンジンに通して★ 歩合が勝つ日を作り、色を測る。
  const iro = (page, ei) =>
    page.evaluate((ei) => {
      const sh = window.__paper.build(ei, 0, window.__paper.hi(ei), 1, 1);
      document.body.appendChild(sh);
      const trs = [...sh.querySelectorAll('tbody tr')];
      const yomu = (lbl) => {
        const tr = trs.find((x) => x.querySelector('th').textContent.trim().startsWith(lbl));
        return [...tr.querySelectorAll('td')]
          .map((td, i) => ({
            i,
            ji: td.textContent.trim(),
            iro: getComputedStyle(td).color,
          }))
          .filter((x) => x.ji);
      };
      const kin = yomu('金額');
      const ji = yomu('時間');
      const cells = window.__paper.emp(ei).cells.filter((c) => c.pay !== null);
      const o = {
        kin,
        ji,
        floor: cells.map((c) => !!c.usedFloor),
        pay: cells.map((c) => c.pay),
        wari: cells.map((c) => (c.hours ? Number((c.pay / c.hours).toFixed(2)) : null)),
      };
      sh.remove();
      return o;
    }, ei);

  const AKA = 'rgb(224, 72, 61)'; // #e0483d = --danger
  const KURO = 'rgb(51, 51, 51)'; // #333333 = 読ませる字（薄い黒）

  test('★最低保証で出した日の 金額は 赤★（本物の倉庫の行）', async ({ page }) => {
    await openKyuryo(page);
    const r = await iro(page, 0);
    expect(r.floor.length, '★働いた日が 1日も無い★').toBeGreaterThan(0);
    expect(r.floor.every(Boolean), '★この試験の前提（全部 保証の日）が 崩れた★').toBe(true);
    r.kin.forEach((x, i) => {
      expect(x.iro, `★${x.ji}円（÷時間=${r.wari[i]}）は 最低保証で出た日なのに 赤くない★`).toBe(
        AKA
      );
    });
    // ★時間の欄まで赤くしない★
    r.ji.forEach((x) => {
      expect(x.iro, `★時間「${x.ji}」まで 赤くしている★`).toBe(KURO);
    });
  });

  test('★歩合で出した日は 赤くしない★（売上を上げて 歩合を勝たせる）', async ({ page }) => {
    // ★倉庫の行の 売上だけを 上げる★＝計算は 本物のエンジンが やり直す
    await openKyuryo(page, (f) => {
      f.shifts = f.shifts.map((s) => ({
        ...s,
        fare_total_yen: Number(s.fare_total_yen || 0) * 8,
      }));
      return f;
    });
    const r = await iro(page, 0);
    expect(r.floor.length, '★働いた日が 1日も無い★').toBeGreaterThan(0);
    expect(
      r.floor.some((v) => v === false),
      `★売上を8倍にしても 歩合が勝たない（usedFloor=${JSON.stringify(r.floor)}）★`
    ).toBe(true);
    r.kin.forEach((x, i) => {
      if (r.floor[i]) return;
      expect(x.iro, `★${x.ji}円（÷時間=${r.wari[i]}）は 歩合で出た日なのに 赤い★`).toBe(KURO);
    });
  });

  test('★0円の日は 赤くしない★（決め方が入っていないだけ）', async ({ page }) => {
    // ★歩合も最低保証も 入っていない会社★（本物の倉庫でも 実際に在った形）
    await openKyuryo(page, (f) => {
      f.settings[0].roles = {};
      f.emps = f.emps.map((e) => ({ ...e, pay_rate: null, pay_floor: null }));
      return f;
    });
    const r = await iro(page, 0);
    expect(
      r.pay.every((v) => v === 0),
      `★0円になっていない（${JSON.stringify(r.pay)}）★`
    ).toBe(true);
    r.kin.forEach((x) => {
      expect(x.iro, `★0円の日「${x.ji}」まで 赤くしている★`).toBe(KURO);
    });
  });
});
