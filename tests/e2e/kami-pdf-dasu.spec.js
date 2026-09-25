// ============================================================
// ★★「PDFで見る」を 実際に 押して ★出た PDF の 中身★ を 見る★★ 2026-09-25／26
//
//   ★司さん★「月で選んだら 項目別で その場で A4サイズPDFで 見せれるようにしろ」
//             「PDFの見せ方や作り方は 既存の 代行請求書や Kyually や Rakunally と
//               一緒にして 変なものが 出んようにしたんか？」
//             「★なんで完成形があるのに確かめてやらんのど★」
//
//   ★「窓が 開いた」で 終わらせない★（[[feedback_print_new_window_not_media_print]]）
//
//   ★★2026-09-26 に 作り方を 変えた★★
//     ★前★ html2canvas で ★絵にして★ jsPDF に 貼っていた。
//        実測 1枚 224,518〜567,182B／日ごと 2枚で 1,134,363B
//        ＝司さんの 線「ええとこ200kBぐらい」を ★9種 全部 超えていた★。
//     ★後★ 代行請求書・Rakually と 同じ ★pdf-lib で 本物の 字を 描く★
//        ＋ lib/font-slim.js で 字体を 軽くする（道具は 4repo と 同じバイト）
//        実測 1枚 78,974〜88,146B
//
//   ★測り方も 変えた★
//     pdf-lib は ★中身を 固めて いる★ので 生の バイトを 字で 探しても 見えない
//     （前の jsPDF は PDF 1.3・生のままで 見えていた）。
//     ⇒ ★pdf-lib で 読み直して 中を 数える★（下の __toru）
// ============================================================
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
// ★★file:// では 字体が 取れない★★ 2026-09-26
//   紙は vendor/fonts/….ttf を fetch する。file:// は fetch が 使えない
//   （実測：URL scheme "file" is not supported）⇒ ★本番と 同じ http★ で 開く。
const URL_SHUKEI = '/shukei.html';

async function kamiShikomu(page) {
  await page.goto(URL_SHUKEI, { waitUntil: 'domcontentloaded' });
  for (const f of ['js/kami-kumu.js', 'js/kami-hyou.js', 'js/kami-shukei.js', 'js/kami-pdf.js']) {
    await page.addScriptTag({ path: path.join(ROOT, f) });
  }

  // ★★PDF を 解いて 中を 数える 道具★★
  //   ・紙の 寸法 …… pdf-lib で 読み直した 本物の 値
  //   ・絵を 貼っていないか … /Subtype /Image の 物が 1つも 無い事
  //   ・字を 描いているか … /Type /Font が 在る事
  //   ・足跡 ………… どこにも http:// が 無い事（window.print なら 必ず 入る）
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
      let atama = '';
      for (let i = 0; i < 5; i++) atama += String.fromCharCode(buf[i]);

      const doc = await window.PDFLib.PDFDocument.load(buf);
      const box = doc.getPages().map(function (pg) {
        const z = pg.getSize();
        return [Math.round(z.width), Math.round(z.height)];
      });
      let e = 0;
      let ji = 0;
      let url = false;
      doc.context.enumerateIndirectObjects().forEach(function (pair) {
        const t = String(pair[1]);
        if (/\/Subtype\s*\/Image/.test(t)) e++;
        if (/\/Type\s*\/Font/.test(t)) ji++;
        if (/https?:\/\//.test(t)) url = true;
      });
      const si = window.PdfSlim ? window.PdfSlim.lastInfo() : null;
      return {
        mai: r.mai,
        size: buf.length,
        per: Math.round(buf.length / r.mai),
        atama: atama,
        box: box,
        e: e,
        ji: ji,
        url: url,
        jitai: si && si.ato,
        marugoto: si && si.marugoto,
      };
    };
  });
}

// ★どの 紙も 必ず 通る 門★（1か所に まとめる＝新しい 紙を 足しても 同じ 縛り）
function mon(out, na, box) {
  expect(out.atama, '★' + na + '：PDF では ありません★').toBe('%PDF-');
  expect(out.box, '★' + na + '：紙の 寸法が 違います★').toEqual(box);
  expect(out.ji, '★' + na + '：字体が 入っていません（字を 描いていない）★').toBeGreaterThan(0);
  expect(out.e, '★' + na + '：絵を 貼っています（html2canvas に 戻った）★').toBe(0);
  expect(out.marugoto, '★' + na + '：字体を 丸ごと 埋めています★').toBe(false);
  expect(out.url, '★' + na + '：PDF に URL が 入っています★').toBe(false);
  // ★司さん 2026-09-05「ええとこ200kBぐらいのもんやろが」★
  expect(out.per, '★' + na + '：1枚 200kB を 超えています（' + out.per + 'B）★').toBeLessThan(
    200000
  );
}

test('★月次集計＝A4縦 1枚★', async ({ page }) => {
  await kamiShikomu(page);
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
    return await window.__toru(
      window.KamiHyou.getsuji(K, window.KamiShukei.getsujiData(tsuki, cars)),
      'getsuji'
    );
  });
  // eslint-disable-next-line no-console
  console.log('★月次集計★ ' + JSON.stringify(out));
  mon(out, '月次集計', [[595, 842]]);
});

test('★売上表（月ごと）＝A4横 1枚★', async ({ page }) => {
  await kamiShikomu(page);
  const out = await page.evaluate(async () => {
    const K = window.KamiShukei.kaisha('ZERO代行', 2026, 9, null, {}, null, true);
    return await window.__toru(
      window.KamiHyou.uriageTsuki(K, {
        uriage: 644000,
        keihi: 0,
        seikyu: 133500,
        denshi: 0,
        genkin: 510500,
        cars: [{ name: '4987', uriage: 315900, jippi: 0 }],
        hi: {},
      }),
      'uriage'
    );
  });
  // eslint-disable-next-line no-console
  console.log('★売上表（月）★ ' + JSON.stringify(out));
  mon(out, '売上表（月）', [[842, 595]]);
});

test('★回数・距離（月ごと）＝A4横 1枚★', async ({ page }) => {
  await kamiShikomu(page);
  const out = await page.evaluate(async () => {
    const K = {
      name: 'ZERO代行',
      year: 2026,
      month: 9,
      settings: null,
      kinds: [{ label: '高速代', hiku: true }],
      denshi: false,
    };
    return await window.__toru(
      window.KamiHyou.soukouTsuki(K, {
        cars: [{ name: '4987', kaisuu: 130, jissha: 712.7, sou: 1588.8 }],
        hi: { 1: { kaisuu: 6, jissha: 31.0, sou: 74.3 } },
        kaisuu: 130,
        jissha: 712.7,
        sou: 1588.8,
      }),
      'soukou'
    );
  });
  // eslint-disable-next-line no-console
  console.log('★回数・距離★ ' + JSON.stringify(out));
  mon(out, '回数・距離', [[842, 595]]);
});

// ============================================================
// ★★給料表＝日付が ★上★ で 前半／後半★★ 2026-09-25（司さん 差し戻し）
//   「上に日付持ってきて前半後半やなかったか？」
//   「時間の方も金額のように前半後半に分けて」
//   「両方日付の横に曜日（月、火など）も入れて ★日曜の列は背景を薄い赤に★」
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-25 実測・1つずつ 手で）★★
//     ①HITO_1MAI を 20 に する ……… ★赤★（1組に なる）
//     ②期間の 名前の 受け取りを 外す … ★赤★（9/11 ~ 9/20 が 出ない）
// ============================================================
test('★給料表（月ごと・個別）＝どちらも A4横★', async ({ page }) => {
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
  mon(out.a, '給料（月ごと）', [[842, 595]]);
  // ★個別も 日付を 上に 並べる★＝15〜16列 並ぶので A4横
  mon(out.b, '給料（個別）', [[842, 595]]);
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
    for (let i = 1; i <= 10; i++) hito.push({ name: '人' + i, hi: hi, hiJikan: hi.map(() => 8) });
    return await window.__toru(window.KamiHyou.kyuryoHi(K, { hito: hito }), 'kyu-hi');
  });

  // eslint-disable-next-line no-console
  console.log('★給料日ごと★ ' + JSON.stringify(out));
  // ★1組＝金額の 紙 ＋ 時間の 紙★。10人＝2組＝4枚。
  expect(out.mai, '★十人なら 2組 ×（金額・時間）＝4枚★').toBe(4);
  mon(out, '給料（日ごと）', [
    [842, 595],
    [842, 595],
    [842, 595],
    [842, 595],
  ]);
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
