// ============================================================
// ★★「PDFで見る」を 実際に 押して PDF の バイト列を 見る★★ 2026-09-25
//
//   ★司さん★「月で選んだら 項目別で その場で A4サイズPDFで 見せれるようにしろ」
//
//   ★「窓が 開いた」で 終わらせない★（[[feedback_print_new_window_not_media_print]]）
//   ⇒ ★PDF の バイト列★ を 見る：
//       %PDF- で 始まる／MediaBox が A4／★URL・ホスト名の 字が 入っていない★
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-25 実測 ＝ 下に 書く）★★
//     ①KamiPdf.dasu を 呼ばない ……………… ★赤★（PDF が 出ない）
//     ②A4 の 寸法を 変える ………………………★赤★（MediaBox が 合わない）
// ============================================================
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
// ★vendor/ の 相対の 道が 要る★＝about:blank だと 取りに 行けない。
//   ⇒ ★本物の 画面と 同じ 置き場★ から 開く（js/kami-pdf.js は 'vendor/…' と 書く）
//   ★逆斜線は pathToFileURL に 任せる★（自分で 書くと heredoc で 落ちる）
const URL_SHUKEI = require('url').pathToFileURL(path.join(ROOT, 'shukei.html')).href;

// ★紙を 組んで PDF に する所だけ★ を 実ブラウザで 通す
//   （画面ぜんぶを 動かすには ログインが 要る＝ここでは 部品を 直に 叩く）
test('★A4のPDFが 出る（バイト列で 見る）★', async ({ page }) => {
  // ★vendor/ の 相対の 道が 要る★＝about:blank だと 取りに 行けない。
  //   ⇒ ★本物の 画面と 同じ 置き場★ から 開く（js/kami-pdf.js は 'vendor/…' と 書く）
  await page.goto(URL_SHUKEI);
  for (const f of ['js/kami-kumu.js', 'js/kami-hyou.js', 'js/kami-shukei.js', 'js/kami-pdf.js']) {
    await page.addScriptTag({ path: path.join(ROOT, f) });
  }
  // vendor は 押した時に 読む＝この 試験でも 同じ 道を 通す
  await page.route('**/vendor/*.js', (r) => r.continue());

  const out = await page.evaluate(async () => {
    const K = window.KamiShukei.kaisha(
      'ZERO代行',
      2026,
      9,
      { period_start_day: 1, period_days: 10, reserve_pool_rate: 0.05 },
      { deduct_toll: true, deduct_bridge: true, deduct_other: false },
      null,
      true
    );
    const tsuki = {
      salesTotal: 644000,
      expense: 0,
      invoice: 133500,
      denshi: 0,
      cash: 510500,
      payTotal: 0,
      periods: [
        { rangeLabel: '1〜10日', pay: 0 },
        { rangeLabel: '11〜20日', pay: 0 },
        { rangeLabel: '21日〜末日', pay: 0 },
      ],
      reserve: 32200,
      ownerShare: 611800,
    };
    const cars = [
      { name: '4987', uriage: 315900, jippi: 0 },
      { name: '1466', uriage: 282400, jippi: 0 },
      { name: '1173', uriage: 45700, jippi: 0 },
    ];
    const mai = window.KamiHyou.getsuji(K, window.KamiShukei.getsujiData(tsuki, cars));

    // ★window.open を 止めて blob を 掴む★（試験で 新しいタブを 開かない）
    let blob = null;
    const moto = URL.createObjectURL;
    URL.createObjectURL = function (b) {
      blob = b;
      return moto.call(URL, b);
    };
    window.open = () => ({});
    await window.KamiPdf.dasu(mai, 'test');
    URL.createObjectURL = moto;
    if (!blob) return { err: 'blob が 出来ていない' };
    const buf = new Uint8Array(await blob.arrayBuffer());
    let atama = '';
    for (let i = 0; i < 8; i++) atama += String.fromCharCode(buf[i]);
    // ★字の 中に URL/ホスト名が 混ざっていないか★（PDF の 生の バイト列で 見る）
    let zenbu = '';
    for (let i = 0; i < buf.length; i++) zenbu += String.fromCharCode(buf[i]);
    const box = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(zenbu);
    return {
      atama,
      size: buf.length,
      w: box ? Math.round(Number(box[1])) : 0,
      h: box ? Math.round(Number(box[2])) : 0,
      url: /https?:\/\//.test(zenbu),
      host: zenbu.indexOf('localhost') >= 0 || zenbu.indexOf('vercel.app') >= 0,
    };
  });

  // eslint-disable-next-line no-console
  console.log('★PDF★ ' + JSON.stringify(out));
  expect(out.err, '★PDF が 出来ていません★').toBeUndefined();
  expect(out.atama.slice(0, 5), '★PDF では ありません★').toBe('%PDF-');
  expect(out.size, '★中身が 空です★').toBeGreaterThan(5000);
  // ★A4縦 595×842pt★
  expect(out.w, '★紙の 幅が A4縦 では ありません★').toBe(595);
  expect(out.h, '★紙の 高さが A4縦 では ありません★').toBe(842);
  // ★足跡が 出ていない★（window.print なら URL と 日付が 必ず 入る）
  expect(out.url, '★PDF の 中に URL が 入っています★').toBe(false);
  expect(out.host, '★PDF の 中に ホスト名が 入っています★').toBe(false);
});

test('★A4横の 紙も 出る（売上表）★', async ({ page }) => {
  // ★vendor/ の 相対の 道が 要る★＝about:blank だと 取りに 行けない。
  //   ⇒ ★本物の 画面と 同じ 置き場★ から 開く（js/kami-pdf.js は 'vendor/…' と 書く）
  await page.goto(URL_SHUKEI);
  for (const f of ['js/kami-kumu.js', 'js/kami-hyou.js', 'js/kami-shukei.js', 'js/kami-pdf.js']) {
    await page.addScriptTag({ path: path.join(ROOT, f) });
  }
  const out = await page.evaluate(async () => {
    const K = window.KamiShukei.kaisha('ZERO代行', 2026, 9, null, {}, null, true);
    const mai = window.KamiHyou.uriageTsuki(K, {
      uriage: 644000,
      keihi: 0,
      seikyu: 133500,
      denshi: 0,
      genkin: 510500,
      cars: [{ name: '4987', uriage: 315900, jippi: 0, genkin: 250500, seikyu: 65400, denshi: 0 }],
      hi: {},
    });
    let blob = null;
    const moto = URL.createObjectURL;
    URL.createObjectURL = function (b) {
      blob = b;
      return moto.call(URL, b);
    };
    window.open = () => ({});
    await window.KamiPdf.dasu(mai, 'test2');
    URL.createObjectURL = moto;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let zenbu = '';
    for (let i = 0; i < buf.length; i++) zenbu += String.fromCharCode(buf[i]);
    const box = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(zenbu);
    return { w: box ? Math.round(Number(box[1])) : 0, h: box ? Math.round(Number(box[2])) : 0 };
  });
  // eslint-disable-next-line no-console
  console.log('★A4横★ ' + JSON.stringify(out));
  expect(out.w, '★A4横の 幅★').toBe(842);
  expect(out.h, '★A4横の 高さ★').toBe(595);
});

// ★回数・距離（A4横）も 出る★ 2026-09-25（売上表の 画面から）
test('★回数・距離の 紙も 出る★', async ({ page }) => {
  await page.goto(URL_SHUKEI);
  for (const f of ['js/kami-kumu.js', 'js/kami-hyou.js', 'js/kami-pdf.js']) {
    await page.addScriptTag({ path: path.join(ROOT, f) });
  }
  const out = await page.evaluate(async () => {
    const K = {
      name: 'ZERO代行',
      year: 2026,
      month: 9,
      settings: null,
      kinds: [{ label: '高速代', hiku: true }],
      denshi: false,
    };
    const mai = window.KamiHyou.soukouTsuki(K, {
      cars: [{ name: '4987', kaisuu: 130, jissha: 712.7, sou: 1588.8 }],
      hi: { 1: { kaisuu: 6, jissha: 31.0, sou: 74.3 } },
      kaisuu: 130,
      jissha: 712.7,
      sou: 1588.8,
    });
    let blob = null;
    const moto = URL.createObjectURL;
    URL.createObjectURL = function (b) {
      blob = b;
      return moto.call(URL, b);
    };
    window.open = () => ({});
    await window.KamiPdf.dasu(mai, 'soukou');
    URL.createObjectURL = moto;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let zenbu = '';
    for (let i = 0; i < buf.length; i++) zenbu += String.fromCharCode(buf[i]);
    const box = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(zenbu);
    return {
      size: buf.length,
      w: box ? Math.round(Number(box[1])) : 0,
      h: box ? Math.round(Number(box[2])) : 0,
      url: /https?:\/\//.test(zenbu),
    };
  });
  // eslint-disable-next-line no-console
  console.log('★回数・距離★ ' + JSON.stringify(out));
  expect(out.w).toBe(842);
  expect(out.h).toBe(595);
  expect(out.url, '★PDF に URL が 入っています★').toBe(false);
});

// ============================================================
// ★★給料表の 紙も PDF に なる★★ 2026-09-25
//   ★司さん★「給料表も月毎、年ごと、個別全体で分けて見れるようにしとけ」
//             「給料表は月の日まで個別で見れるやつも作れよ」
//
//   ★ここで 見るのは 3つ★
//     ①月ごと（全体）は A4横・個別は A4縦で 出る
//     ②★日ごとで 10人に なったら 2枚に 分かれ 向きが 揃う★
//     ③★画面が 出した 期間の 名前が そのまま 紙に 出る★（紙は 区切り直さない）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-25 実測）★★
//     ①HITO_1MAI を 20 に する ………… ★赤★（1枚に なる）
//     ②namae を 見ないように 戻す …… ★赤★（期間の 名前が 出ない）
// ============================================================
async function kamiShikomu(page) {
  await page.goto(URL_SHUKEI);
  for (const f of ['js/kami-kumu.js', 'js/kami-hyou.js', 'js/kami-pdf.js']) {
    await page.addScriptTag({ path: path.join(ROOT, f) });
  }
  // ★紙 → PDF の バイト列を 返す 道具を 画面側に 置く★
  await page.evaluate(() => {
    window.__toru = async function (mai, na) {
      let blob = null;
      const moto = URL.createObjectURL;
      URL.createObjectURL = function (b) {
        blob = b;
        return moto.call(URL, b);
      };
      window.open = () => ({});
      const r = await window.KamiPdf.dasu(mai, na);
      URL.createObjectURL = moto;
      const buf = new Uint8Array(await blob.arrayBuffer());
      let zenbu = '';
      for (let i = 0; i < buf.length; i++) zenbu += String.fromCharCode(buf[i]);
      const box = [];
      const re = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/g;
      let m;
      while ((m = re.exec(zenbu))) box.push([Math.round(+m[1]), Math.round(+m[2])]);
      return { mai: r.mai, size: buf.length, box, url: /https?:\/\//.test(zenbu) };
    };
  });
}

test('★給料表（月ごと・個別）の 紙も 出る★', async ({ page }) => {
  await kamiShikomu(page);
  const out = await page.evaluate(async () => {
    const K = {
      name: 'ZERO代行',
      year: 2026,
      month: 9,
      settings: { period_start_day: 1, period_days: 10 },
      kinds: [],
      denshi: false,
    };
    // ★画面（PayrollPeriod）が 出した 期間の 名前を そのまま 渡す★
    const namae = ['9/1 ~ 9/10', '9/11 ~ 9/20', '9/21 ~ 9/30'];
    const hi = [];
    for (let d = 1; d <= 30; d++) hi.push(d % 3 === 0 ? 0 : 10400);
    const hiJikan = hi.map((v) => (v ? 8.5 : 0));
    const hito = [
      { name: '山田', kikan: [104000, 93600, 104000], jikan: 76.5, hi: hi, hiJikan: hiJikan },
      { name: '鈴木', kikan: [88000, 91000, 99000], jikan: 70, hi: hi, hiJikan: hiJikan },
    ];
    const a = await window.__toru(
      window.KamiHyou.kyuryoTsuki(K, { namae: namae, hito: hito }),
      'kyu-tsuki'
    );
    const b = await window.__toru(
      window.KamiHyou.kyuryoKojin(K, { namae: namae, hito: hito[0] }),
      'kyu-kojin'
    );
    const ji = window.KamiHyou.kyuryoTsuki(K, { namae: namae, hito: hito })[0].el.textContent;
    return {
      a: a,
      b: b,
      namaeDeta: ji.indexOf('9/11 ~ 9/20') >= 0,
      en: ji.indexOf('104,000') >= 0,
    };
  });

  // eslint-disable-next-line no-console
  console.log('★給料月ごと★ ' + JSON.stringify(out.a));
  // eslint-disable-next-line no-console
  console.log('★給料個別★ ' + JSON.stringify(out.b));
  expect(out.a.box, '★月ごとは A4横 1枚★').toEqual([[842, 595]]);
  // ★個別も 日付を 上に 並べる★＝15〜16列 並ぶので A4横
  expect(out.b.box, '★個別は A4横 1枚★').toEqual([[842, 595]]);
  expect(out.a.url, '★PDF に URL が 入っています★').toBe(false);
  expect(out.b.url, '★PDF に URL が 入っています★').toBe(false);
  expect(out.namaeDeta, '★画面が 出した 期間の 名前が 紙に 出ていません★').toBe(true);
  // 司さん「そのままでやれや銀行やないんど」＝円のまま
  expect(out.en, '★金額が 円のまま では ありません★').toBe(true);
});

test('★給料表（日ごと）は 10人で 4枚に 分かれ 向きが 揃う★', async ({ page }) => {
  await kamiShikomu(page);
  const out = await page.evaluate(async () => {
    const K = {
      name: 'ZERO代行',
      year: 2026,
      month: 9,
      settings: null,
      kinds: [],
      denshi: false,
    };
    const hi = [];
    for (let d = 1; d <= 30; d++) hi.push(d % 4 === 0 ? 0 : 9600);
    const hito = [];
    for (let i = 1; i <= 10; i++) hito.push({ name: '人' + i, hi: hi });
    return await window.__toru(window.KamiHyou.kyuryoHi(K, { hito: hito }), 'kyu-hi');
  });

  // eslint-disable-next-line no-console
  console.log('★給料日ごと★ ' + JSON.stringify(out));
  // ★司さん 2026-09-25★「上に日付持ってきて前半後半」に 組み直したので
  //   1組＝★金額の 紙 ➕ 時間の 紙★。10人＝2組＝★４枚★。
  expect(out.mai, '★十人なら 2組 ×（金額・時間）＝4枚★').toBe(4);
  expect(out.box.length, '★PDF の 頁数★').toBe(4);
  expect(new Set(out.box.map((x) => x.join('x'))).size, '★枚で 向きが 違っています★').toBe(1);
  expect(out.box[0], '★A4横★').toEqual([842, 595]);
  expect(out.url, '★PDF に URL が 入っています★').toBe(false);
});

// ============================================================
// ★★列の 幅は ★実際に 出た 絵★ で 数える★★ 2026-09-25
//
//   ★司さん★「なんで金額の列も自動調整にしとんど 勝手なことすんなぼけ
//             ／前半後半で収まるように固定しとけや
//             ★自動調整は名前しか言うてなかろが★」
//
//   ★なぜ 単体の 試験では 足りないか★
//     単体は `<col style="width:NNpx">` の ★字★ しか 読めない。
//     ⇒ ここは ★本物の ブラウザで 出た 幅★ を 数える。
//     ★これが 見つけた 本物の 穴（2026-09-25）★
//       31日の 月 ＋ 長い 名前だと 日の 列が 53px。overflow:hidden だったので
//       ★「108,000」が 黙って 切られていた★（12マス）。⇒ 折り返す ように 直した。
//
//   ★★わざと壊して 見た（2026-09-25 実測・1つずつ 手で）★★
//     ①colgroup と 表の 幅を 外す … ★赤★
//        「前半 59px ／ 後半 62px で 違います」＋ 長い 名前で 1マス 切れた
//     ②名前の 幅を 決め打ち(100px) … ★赤★（tests/unit/kami-hyou.test.js の 方）
//     ③table-layout を auto に 戻す … ★緑のまま★＝★この 門では 見分けが つかない★
//        （colgroup が 最小幅に なり、数は 折り返すので 結局 同じ 幅に なる）
//        ⇒ ★守っているのは「出た 幅が 揃っているか」であって 決まりの 字では ない★
// ============================================================
test('★日の 列は 全部 同じ 幅／広がるのは 名前の 列だけ★', async ({ page }) => {
  await kamiShikomu(page);
  await page.setViewportSize({ width: 1123, height: 794 });

  const hakaru = async (namae) =>
    await page.evaluate((na) => {
      const K = {
        name: 'ZERO代行',
        year: 2026,
        month: 10, // ★31日の 月＝前半16日・後半15日★（一番 きつい）
        settings: null,
        kinds: [],
        denshi: false,
      };
      const hi = [];
      const hj = [];
      for (let d = 1; d <= 31; d++) {
        hi.push(d % 4 === 0 ? 0 : 108000);
        hj.push(d % 4 === 0 ? 0 : 12.5);
      }
      const hito = na.map((x) => ({ name: x, hi: hi, hiJikan: hj }));
      const x = window.KamiHyou.kyuryoHi(K, { hito: hito })[0];
      x.el.style.cssText =
        'position:absolute;left:0;top:0;width:1123px;height:794px;background:#fff';
      document.body.appendChild(x.el);
      const r0 = x.el.getBoundingClientRect();
      let hami = 0;
      x.el.querySelectorAll('*').forEach((e) => {
        const r = e.getBoundingClientRect();
        if (!r.width && !r.height) return;
        if (r.right > r0.left + 1123 + 1 || r.bottom > r0.top + 794 + 1) hami++;
      });
      const hyou = [...x.el.querySelectorAll('.hiyoko table')].map((t) => {
        const w = [...t.querySelector('thead tr').children].map((e) =>
          Math.round(e.getBoundingClientRect().width)
        );
        const days = w.slice(1, -1);
        let kire = 0;
        t.querySelectorAll('tbody td').forEach((e) => {
          if (e.scrollWidth > e.clientWidth + 1) kire++;
        });
        return {
          na: w[0],
          hi: days[0],
          chigai: Math.max(...days) - Math.min(...days),
          kazu: days.length,
          kire: kire,
        };
      });
      x.el.parentNode.removeChild(x.el);
      return { hami: hami, hyou: hyou };
    }, namae);

  const mijika = await hakaru(['林', '上', '西']);
  const naga = await hakaru(['東海林 けんいちろう', '上', '西']);
  // eslint-disable-next-line no-console
  console.log('★短い名前★ ' + JSON.stringify(mijika));
  // eslint-disable-next-line no-console
  console.log('★長い名前★ ' + JSON.stringify(naga));

  [mijika, naga].forEach((r, i) => {
    const na = i ? '長い名前' : '短い名前';
    expect(r.hami, '★' + na + '：紙から はみ出しています★').toBe(0);
    expect(r.hyou.length, '★' + na + '：前半／後半の 2つに なっていません★').toBe(2);
    expect(r.hyou[0].kazu, '★前半は 16日★').toBe(16);
    expect(r.hyou[1].kazu, '★後半は 15日★').toBe(15);
    r.hyou.forEach((t, j) => {
      expect(
        t.chigai,
        '★' + na + '：' + (j ? '後半' : '前半') + 'の 日の 列が 中身で バラついています★'
      ).toBe(0);
      expect(t.kire, '★' + na + '：字が 切れています★').toBe(0);
    });
    expect(r.hyou[0].hi, '★' + na + '：前半と 後半で 日の 列の 幅が 違います★').toBe(r.hyou[1].hi);
    expect(r.hyou[0].na, '★' + na + '：前半と 後半で 名前の 列の 幅が 違います★').toBe(
      r.hyou[1].na
    );
  });

  // ★広がるのは 名前の 列だけ★
  expect(naga.hyou[0].na > mijika.hyou[0].na, '★名前が 長いのに 列が 広がっていません★').toBe(true);
});
