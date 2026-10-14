// ============================================================
// 給料明細は 期間（10日・11日）が 1枚で 終わる＝字の 大きさを 自動で 合わせる 2026-10-14
//
//   司さん「給料明細もなんで2つに分かれるんどぼけ １枚で終わるように自動調整しろってゆうとったろが」
//   司さんの 絵：10日 の 期間が「1/2枚目（9日）」「2/2枚目（1日）」に 分かれた（3台・5桁の 売上）
//   前は 字を 15px に 決め打ちし、入らない 日を 次の 紙へ 送っていた。
//   ⇒ 入るまで 字を 小さく（下限 13px＝PDF で 9.09pt）。13px でも 入らない 時だけ 分ける。
//
//   ★わざと壊して 赤に なるのを 見た（2026-10-14 実測）★
//     字の 大きさを 合わせる 前の kyuryo.html に 戻す ⇒ 赤（10日 が 2枚・15px のまま）
//     直した 後 ⇒ 緑（1枚・14px）
// ============================================================
const { test, expect } = require('@playwright/test');
const { openKyuryo } = require('./kyuryo-harness');

test('10日・11日の 期間（3台・5桁の 売上・毎日 働く）は 明細 1枚・字は 9pt 以上・はみ出さない', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  // 司さんの iPhone は この 機械より 字の 幅が 広い（同じ 10日・3台で 9日＋1日 に 分かれた）。
  //   この 機械の 字体では 15px でも 入って しまい 見張りが 空回り する（2026-10-14 実測）。
  //   ⇒ 測る 字の 幅を 2割 広く して、iPhone と 同じ「15px では 入らない」形を 作る
  await page.addInitScript(() => {
    const moto = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function (t) {
      const m = moto.call(this, t);
      return { width: m.width * 1.2 };
    };
  });
  await openKyuryo(page, (f) => {
    const ym = f.shifts[0].started_at.slice(0, 7);
    const co = f.settings[0].company_id;
    const cars = f.labels.filter((l) => l.company_id === co).map((l) => l.device_id);
    while (cars.length < 3) {
      const id = '00000000-0000-4000-9000-0000000002' + String(cars.length).padStart(2, '0');
      f.labels.push({
        company_id: co,
        device_id: id,
        label: '車' + (cars.length + 1),
        sort_order: 9,
      });
      cars.push(id);
    }
    const y = Number(ym.slice(0, 4));
    const m = Number(ym.slice(5, 7));
    const matsu = new Date(y, m, 0).getDate();
    const emp = f.emps.find((e) => e.active !== false).employee_id;
    f.shifts = [];
    f.workHours = [];
    f.manualDays = [];
    f.edits = [];
    for (let d = 1; d <= matsu; d++) {
      const dd = ym + '-' + String(d).padStart(2, '0');
      cars.slice(0, 3).forEach((dev, i) => {
        f.shifts.push({
          shift_id:
            '00000000-0000-4000-a000-0' + String(d).padStart(3, '0') + String(i).padStart(8, '0'),
          device_id: dev,
          started_at: dd + ' 09:00:00+00',
          ended_at: dd + ' 17:15:00+00',
          elapsed_sec: 8.25 * 3600,
          fare_total_yen: 28700 + d * 10 + i,
          trip_count: 9,
        });
      });
      f.workHours.push({
        company_id: co,
        work_date: dd,
        employee_id: emp,
        device_id: cars[0],
        hours: 9.25,
      });
    }
    return f;
  });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const P = window.__paper;
    const out = [];
    for (let ei = 0; ei < P.ninzu(); ei++) {
      if (!P.hi(ei)) continue;
      const els = P.sheets(ei);
      out.push({
        hi: P.hi(ei),
        mai: els.length,
        font: els.map((el) => Number(el.getAttribute('data-font-px'))),
        sub: els.map((el) => Number(el.getAttribute('data-sub-px'))),
        haba: els.map((el) => {
          el.style.position = 'absolute';
          el.style.left = '0';
          document.body.appendChild(el);
          const w = el.scrollWidth - el.clientWidth;
          el.remove();
          return w;
        }),
      });
    }
    return out;
  });
  // eslint-disable-next-line no-console
  console.log('明細 ' + JSON.stringify(r));
  expect(r.length, '明細を 作れる 人が 居ない（見張りが 空回り）').toBeGreaterThan(0);
  for (const x of r) {
    expect(x.hi).toBeGreaterThanOrEqual(10);
    expect(x.mai, x.hi + '日の 期間が ' + x.mai + '枚に 分かれた').toBe(1);
    // 板 → PDF の 倍率（js/kami-egaku.js の bai）で 9pt 以上か（本文も 2行目も）
    const BAI = Math.min((842 - 40) / 1123, (595 - 40) / 794);
    x.font
      .concat(x.sub)
      .forEach((fp) =>
        expect(fp * BAI, '字が PDF で 9pt より 小さい（' + fp + 'px）').toBeGreaterThanOrEqual(9)
      );
    x.haba.forEach((w) => expect(w, '右に はみ出した').toBeLessThanOrEqual(0));
  }
  expect(err).toEqual([]);
});
