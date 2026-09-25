'use strict';
// ============================================================
// ★★紙 9種 ＝ ★実際に 組ませて 中身を 見る★★★ 2026-09-25
//
//   ★字を 読むだけの 見張りに しない★（2026-09-18 の 教訓）
//   ＝本物の 部品を 呼んで ★出来た 紙の 中の 字と 数★ を 数える。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-25 実測 ＝ 下に 書く）★★
//     ①売上表に 回数の 列を 戻す ………………… ★赤★
//     ②月次集計から 請求書の 行を 消す ………… ★赤★
//     ③給料 日ごとを 1枚 20人に する ………… ★赤★
// ============================================================

// ★DOM が 要る（K.ita が document.createElement を 使う）★
//   ★jsdom は 入れない★＝この repo は environment:'node' で 揃っている（vitest.config.js:15）。
//   借り物を 1本 増やすより ★要る所だけ 自前で 用意する★（innerHTML から
//   textContent / querySelectorAll が 取れれば 足りる）。
const { parseHTML } = require('./_kami-dom.js');
global.document = {
  createElement() {
    const el = { className: '', _html: '' };
    Object.defineProperty(el, 'innerHTML', {
      get() {
        return el._html;
      },
      set(v) {
        el._html = String(v);
        Object.assign(el, parseHTML(el._html));
      },
    });
    return el;
  },
};
const K = require('../../js/kami-kumu.js');
global.KamiKumu = K;
const H = require('../../js/kami-hyou.js');

const KAISHA = {
  name: 'ZERO代行',
  year: 2026,
  month: 9,
  settings: { period_start_day: 1, period_days: 10, reserve_pool_rate: 0.05 },
  kinds: [
    { label: '高速代', hiku: true },
    { label: '橋代', hiku: true },
    { label: 'ガソリン', hiku: false },
  ],
  denshi: true,
};
const CARS = [
  {
    name: '4987',
    uriage: 315900,
    jippi: 0,
    genkin: 250500,
    seikyu: 65400,
    denshi: 0,
    kaisuu: 130,
    jissha: 712.7,
    sou: 1588.8,
  },
  {
    name: '1466',
    uriage: 282400,
    jippi: 0,
    genkin: 223900,
    seikyu: 58500,
    denshi: 0,
    kaisuu: 108,
    jissha: 675.6,
    sou: 1540.2,
  },
  {
    name: '1173',
    uriage: 45700,
    jippi: 0,
    genkin: 36300,
    seikyu: 9400,
    denshi: 0,
    kaisuu: 22,
    jissha: 90.6,
    sou: 219.3,
  },
];
const D = {
  uriage: 644000,
  keihi: 0,
  seikyu: 133500,
  denshi: 0,
  genkin: 510500,
  kyuryo: 0,
  kyuryoKikan: [0, 0, 0],
  tsumitate: 32200,
  nokori: 611800,
  cars: CARS,
  kaisuu: 260,
  jissha: 1478.9,
  sou: 3348.3,
  hi: {},
};

const ji = (mai) => mai.map((x) => x.el.textContent).join('\n');

describe('★①月次集計★', () => {
  const mai = H.getsuji(KAISHA, D);
  const s = ji(mai);
  it('★1枚・A4縦★', () => {
    expect(mai.length).toBe(1);
    expect(mai[0].muki).toBe('tate');
  });
  it('★★請求書の 行が 在る（司さん「請求書の列がないやないか」）★★', () => {
    expect(s).toContain('請求書');
    expect(s).toContain('133,500');
  });
  it('★電子決済の 行も 在る★', () => {
    expect(s).toContain('電子決済');
  });
  it('★積立の 率が 会社設定から 出る（5%）★', () => {
    expect(s).toContain('積立金（5%）');
    expect(s).toContain('32,200');
  });
  it('★給料の 区切りが 会社設定から★', () => {
    expect(s).toContain('1〜10日');
    expect(s).toContain('21日〜末日');
  });
  it('★★車ごとに 回数・距離を 出さない（別の 紙）★★', () => {
    const kuruma = mai[0].el.querySelectorAll('h2');
    const midashi = [...kuruma].map((x) => x.textContent).join('|');
    expect(midashi).toContain('④ 車ごと');
    // 車ごとの 表の 見出しに 回数/km が 無い事
    const t = [...mai[0].el.querySelectorAll('table')].pop();
    const th = [...t.querySelectorAll('th')].map((x) => x.textContent).join(',');
    expect(th, '★車ごとに 回数・距離が 戻っています★').not.toContain('回数');
    expect(th).not.toContain('km');
  });
});

describe('★②売上表（月ごと）＝お金の 欄だけ★', () => {
  const mai = H.uriageTsuki(KAISHA, D);
  const el = mai[0].el;
  it('★A4横★', () => expect(mai[0].muki).toBe('yoko'));
  it('★★回数・距離・1回あたりを 出さない★★', () => {
    const th = [...el.querySelectorAll('th')].map((x) => x.textContent).join(',');
    expect(th, '★回数が 戻っています★').not.toContain('回数');
    expect(th, '★距離が 戻っています★').not.toContain('km');
    expect(th).not.toContain('1回あたり');
  });
  it('★現金／請求書／電子決済／経費 が 揃っている★', () => {
    const th = [...el.querySelectorAll('th')].map((x) => x.textContent).join(',');
    ['売上', '現金', '請求書', '電子決済', '経費'].forEach((w) => expect(th).toContain(w));
  });
  it('★日曜の 升目だけ 塗る（9/6 は 日曜）★', () => {
    expect(el.querySelectorAll('.nichi').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('.doyo').length, '★土曜に 色が 付いています★').toBe(0);
  });
  it('★曜日が 出る★', () => {
    expect(el.querySelectorAll('.yb').length).toBeGreaterThan(0);
  });
  it('★★金額は 円のまま（千円に しない）★★', () => {
    expect(el.textContent).toContain('644,000');
    expect(el.textContent).toContain('133,500');
  });
});

describe('★③売上表（年ごと）★', () => {
  const mai = H.uriageNen(KAISHA, {
    tsuki: {
      8: { uriage: 766300, genkin: 613200, seikyu: 153100, denshi: 0, keihi: 0 },
      9: { uriage: 644000, genkin: 510500, seikyu: 133500, denshi: 0, keihi: 0 },
    },
    total: { uriage: 1410300, genkin: 1123700, seikyu: 286600, denshi: 0, keihi: 0 },
  });
  const s = ji(mai);
  it('★12か月 全部 行が 在る★', () => {
    for (let i = 1; i <= 12; i++) expect(s).toContain(i + '月');
  });
  it('★入っていない 月は 横棒★', () => expect(s).toContain('—'));
  it('★請求書の 列が 在る★', () => {
    expect(s).toContain('請求書');
    expect(s).toContain('286,600');
  });
});

describe('★④⑤回数・距離（別の 紙）★', () => {
  it('★月ごと＝回数・実車・総走行・迎え戻り★', () => {
    const s = ji(H.soukouTsuki(KAISHA, D));
    ['回数', '実車 km', '総走行 km', '迎え・戻り km'].forEach((w) => expect(s).toContain(w));
    expect(s, '★お金が 混ざっています★').not.toContain('請求書');
  });
  it('★迎え・戻り＝総走行 − 実車★', () => {
    const s = ji(H.soukouTsuki(KAISHA, D));
    expect(s).toContain('1,869.4'); // 3348.3 − 1478.9
  });
  it('★年ごとも 出る★', () => {
    const s = ji(
      H.soukouNen(KAISHA, {
        tsuki: { 9: { kaisuu: 260, jissha: 1478.9, sou: 3348.3 } },
        total: { kaisuu: 260, jissha: 1478.9, sou: 3348.3 },
      })
    );
    expect(s).toContain('回数・距離（年ごと）');
  });
});

const HITO = (nin) =>
  Array.from({ length: nin }, (_, i) => ({
    name: '従業員' + (i + 1),
    kikan: [90000, 85000, 95000],
    jikan: 240,
    hi: Array.from({ length: 30 }, () => 9300),
  }));

describe('★⑥⑦⑧⑨給料表★', () => {
  it('★月ごと（全体）＝期間は 会社設定から★', () => {
    const s = ji(H.kyuryoTsuki(KAISHA, { hito: HITO(4) }));
    expect(s).toContain('1〜10日');
    expect(s).toContain('21日〜末日');
    expect(s, '★1時間あたりを 出しています★').not.toContain('1時間あたり');
  });
  it('★7日ごとの 会社は 5期に なる★', () => {
    const k7 = Object.assign({}, KAISHA, {
      month: 1,
      settings: { period_start_day: 1, period_days: 7 },
    });
    const s = ji(H.kyuryoTsuki(k7, { hito: HITO(4) }));
    expect(s).toContain('29日〜末日');
  });
  it('★★日ごと＝1枚 9人まで／10人以上は 枚が 増える★★', () => {
    expect(H.kyuryoHi(KAISHA, { hito: HITO(9) }).length).toBe(1);
    expect(H.kyuryoHi(KAISHA, { hito: HITO(10) }).length).toBe(2);
    expect(H.kyuryoHi(KAISHA, { hito: HITO(20) }).length).toBe(3);
  });
  it('★★枚が 分かれても 向きは 全部 同じ★★', () => {
    const mai = H.kyuryoHi(KAISHA, { hito: HITO(20) });
    const muki = mai.map((x) => x.muki);
    expect(new Set(muki).size, '★枚ごとに 向きが 違います★').toBe(1);
  });
  it('★枚が 分かれたら「小計」／1枚なら「合計」★', () => {
    expect(ji(H.kyuryoHi(KAISHA, { hito: HITO(20) }))).toContain('小計');
    expect(ji(H.kyuryoHi(KAISHA, { hito: HITO(4) }))).toContain('合計');
  });
  it('★年ごと＝12か月 × 人★', () => {
    const s = ji(
      H.kyuryoNen(KAISHA, { hito: HITO(3), tsuki: { 9: { 従業員1: 100000 } }, zen: 100000 })
    );
    expect(s).toContain('従業員1');
    expect(s).toContain('12月');
  });
  it('★個別＝1人の 1か月（日まで）★', () => {
    const s = ji(H.kyuryoKojin(KAISHA, { hito: HITO(1)[0] }));
    expect(s).toContain('従業員1');
    expect(s).toContain('払う回ごと');
    expect(s).toContain('日ごと');
  });
});

describe('★⑩どの 紙も 会社ごとに 変わる★', () => {
  it('★実費が 4本・電子決済なし・積立8.5%の 会社でも 出る★', () => {
    const k2 = {
      name: '株式会社 なんでも運転代行サービス 松山営業所',
      year: 2026,
      month: 1,
      settings: { period_start_day: 1, period_days: 7, reserve_pool_rate: 0.085 },
      kinds: [
        { label: '高速代', hiku: true },
        { label: '橋代', hiku: true },
        { label: '駐車場代', hiku: true },
        { label: 'ガソリン', hiku: false },
      ],
      denshi: false,
    };
    const s = ji(H.getsuji(k2, Object.assign({}, D, { tsumitate: 409700 })));
    expect(s).toContain('株式会社 なんでも運転代行サービス 松山営業所');
    expect(s).toContain('高速代・橋代・駐車場代');
    expect(s).toContain('積立金（8.5%）');
    expect(s).toContain('使っていません'); // 電子決済
  });
  it('★車が 12台でも 落ちない（2列に 割る）★', () => {
    const cars12 = Array.from({ length: 12 }, (_, i) => ({
      name: '車' + (i + 1),
      uriage: 1,
      jippi: 0,
      kaisuu: 1,
      jissha: 1,
      sou: 2,
    }));
    const mai = H.getsuji(KAISHA, Object.assign({}, D, { cars: cars12 }));
    expect(mai[0].el.querySelectorAll('.nibun').length).toBeGreaterThan(0);
  });
});
