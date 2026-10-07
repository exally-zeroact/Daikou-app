// ============================================================
// ★★見張り：明細の 紙は 車が 多くても 下が 切れない★★ 2026-10-07
//
//   司さん「前からある2つもやれ」（対立役：車 9台＋内わけ 1行 で 紙の 下が 切れた）
//   ★直し★ 字も 行の 高さも 変えず、車の 行が 入らない 時は 次の 紙へ（売上n の 番号は 続き）
//           入るかは ★組んだ 紙の 高さを 測って★ 決める（見積もりは 内わけが 折り返すと 外れた）
//   ★物差し★
//     PDF の 紙（__paper.sheets）も 事務所の 画面の 紙（.kami-mado）も 高さ ≦ 794px（A4横の 板）
//     画面の 紙の 枚数 ＝ PDF の 枚数（10-07 対立役：画面は 日だけで 分けて いて 下が 切れた）
//     売上1〜N が 日の 分け（maisu.n）と 同じ 回数ずつ 出る（重なり・抜けを 数える）
//
//   ★★わざと壊して 赤に なるのを 見た（2026-10-07 実測）★★
//     _maisu の 車の 分け方を 外す（carN を 1 に する）⇒ ★赤★（高さが 794 を 越える）
//     測るのを やめて 前の 見積もり（内わけ×26px）に 戻す ⇒ ★赤★（手当・控除 6件 で 越える）
//     事務所の 画面を 日だけで 分ける 前の 形に 戻す ⇒ ★赤★（枚数と 高さ）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

function kuruma(f, dai) {
  for (let i = f.labels.length; i < dai; i++) {
    f.labels.push({
      company_id: f.labels[0].company_id,
      device_id: '00000000-0000-4000-9000-0000000001' + String(i).padStart(2, '0'),
      label: '車' + (i + 1),
      sort_order: i + 1,
    });
  }
}

const BAAI = [
  {
    na: '車 12台 ＋ 手当 1件',
    dai: 12,
    adj: [['teate', 'ガソリン代', 500]],
  },
  {
    // ★対立役 10-07 の 形★（内わけが 折り返して 見積もりより 高く なった）
    na: '車 9台 ＋ 1回・1km の 行 ＋ 手当・控除 6件',
    dai: 9,
    adj: [
      ['teate', 'ガソリン代', 500],
      ['teate', '携帯電話代', 3000],
      ['teate', '深夜手当', 2000],
      ['koujo', '前借り', 10000],
      ['koujo', '制服代', 4500],
      ['koujo', '事故の 弁償', 20000],
    ],
  },
];

for (const b of BAAI) {
  test('★' + b.na + ' でも 明細の 紙は 切れない（PDF も 画面も）★', async ({ page }) => {
    const err = [];
    page.on('pageerror', (e) => err.push(e.message));
    await page.setViewportSize({ width: 1280, height: 900 });
    await openKyuryo(page, (f) => {
      kuruma(f, b.dai);
      const w = f.workHours[0];
      f.adjustments = b.adj.map((a, i) => ({
        adj_id: 'a' + i,
        employee_id: w.employee_id,
        work_date: w.work_date,
        kind: a[0],
        label: a[1],
        yen: a[2],
      }));
      f.settings[0].pay_extra = { kaisu: 100, kasanAto: true };
      return f;
    });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const P = window.__paper;
      const out = [];
      for (let ei = 0; ei < P.ninzu(); ei++) {
        const els = P.sheets(ei);
        const uri = {};
        const takasa = els.map((el) => {
          el.style.position = 'absolute';
          el.style.left = '0';
          el.style.top = '0';
          document.body.appendChild(el);
          const h = el.scrollHeight;
          el.querySelectorAll('th').forEach((th) => {
            // ★1行目（売上n）だけ 読む★（2行目の 車の 名前を 番号に くっつけない）
            const d = th.querySelector('div');
            const m = /^売上(\d+)$/.exec(((d && d.textContent) || '').trim());
            if (m) uri[m[1]] = (uri[m[1]] || 0) + 1;
          });
          el.remove();
          return h;
        });
        // ★事務所の 画面の 紙★
        const mado = document.querySelector('#slips .kami-mado[data-ei="' + ei + '"]');
        const gamen = mado
          ? Array.from(mado.querySelectorAll('.hn-kami-waku')).map(
              (w) => w.firstElementChild.scrollHeight
            )
          : null;
        out.push({
          ei: ei,
          mai: els.length,
          hiWake: P.maisu(ei).n,
          takasa: takasa,
          uri: uri,
          gamen: gamen,
        });
      }
      return out;
    });
    // eslint-disable-next-line no-console
    console.log('★紙★ ' + JSON.stringify(r));
    expect(r.length, '★人が 居ない★').toBeGreaterThan(0);
    let wakareta = 0;
    r.forEach((x) => {
      if (x.mai > x.hiWake) wakareta++;
      x.takasa.forEach((h, i) => {
        expect(
          h,
          '★' + x.ei + '人目 PDF ' + (i + 1) + '枚目 ' + h + 'px が 794 を 越える★'
        ).toBeLessThanOrEqual(794);
      });
      expect(x.gamen, '★' + x.ei + '人目 画面の 紙が 無い★').not.toBeNull();
      expect(x.gamen.length, '★' + x.ei + '人目 画面の 枚数 ≠ PDF の 枚数★').toBe(x.mai);
      x.gamen.forEach((h, i) => {
        expect(
          h,
          '★' + x.ei + '人目 画面 ' + (i + 1) + '枚目 ' + h + 'px が 794 を 越える★'
        ).toBeLessThanOrEqual(794);
      });
      // ★売上1〜N が ちょうど 日の 分けの 回数ずつ★
      const hazu = {};
      for (let n = 1; n <= b.dai; n++) hazu[n] = x.hiWake;
      expect(x.uri, '★売上n の 抜け・重なり★').toEqual(hazu);
    });
    // ★本当に 車で 分けた 場合を 見ている★（分けずに 済んだ なら この 見張りは 空回り）
    expect(wakareta, '★車で 分けた 人が 0＝空回り★').toBeGreaterThan(0);
    expect(err, '★画面が 落ちた★').toEqual([]);
  });
}
