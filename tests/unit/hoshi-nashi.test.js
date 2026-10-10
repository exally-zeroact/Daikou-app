'use strict';
// ============================================================
// ★★お客さんの 画面に 出る 字に ★ を 出さない★★ 2026-10-10（司さん「対立でやれ」）
//   何を・どこを 見るかは tests/tools/hoshi-kazoeru.js の 頭に 書いた。
//   ★上限を 付けず 0本★（上限は「下げれば 通る」と「減らす 途中の 数が 天井に なる」で 死ぬ）。
//   ★白名簿 なし★＝注記の 外は console も throw も 全部 0本。
//
//   ★直す 前の 数（2026-10-10 origin/main 4907e46fc）★
//     JS の 字の 塊 39個（9ファイル）＋ HTML の 本文 5行 ＋ manifest 2本 ＝ 46 → 0
//   ★0本で 緑に しない★＝下の 下限（ファイル数・inline script・字の塊）を 割ったら 赤
// ============================================================
const { HOSHI, jsWoMiru, htmlWoMiru, zenbuKazoeru } = require('../tools/hoshi-kazoeru.js');
const path = require('path');
const { execFileSync } = require('child_process');

const k = zenbuKazoeru();
console.log(
  `[hoshi-nashi] 範囲=${k.hani.length}（js ${k.js}・html ${k.html}・manifest ${k.json}）inline script=${k.inlineScript} 字の塊=${k.katamari} ★=${k.hoshi.length}`
);

describe('客の 字に ★ が 無い', () => {
  it('★ は 0本（場所を 全部 出す）', () => {
    expect(k.hoshi).toEqual([]);
  });
  it('読めない js・script が 無い（読めないと 中の ★ を 見落とす）', () => {
    expect(k.yomenai).toEqual([]);
  });
  it('html の src が repo に 無い ファイルを 指していない', () => {
    expect(k.nakuSrc).toEqual([]);
  });
  it('JS の 字で 名指しされた repo の js は 全部 範囲の 中（読み込まれるのに 見ていない js を 作らない）', () => {
    expect(k.minaiSrc).toEqual([]);
  });
  it('見る 範囲が 痩せていない（0本で 緑に しない）', () => {
    expect(k.js).toBeGreaterThanOrEqual(55);
    expect(k.html).toBeGreaterThanOrEqual(20);
    expect(k.json).toBeGreaterThanOrEqual(2);
    expect(k.inlineScript).toBeGreaterThanOrEqual(25);
    expect(k.katamari).toBeGreaterThanOrEqual(10000);
  });
  it('一番 守りたい 物が 範囲に 入っている（名指し）', () => {
    for (const f of [
      'index.html',
      'kyuryo.html',
      'ryokinhyou.html',
      'nyuryoku.html',
      'dashboard.html',
      'shukei.html',
      'uriage.html',
      'js/obd-client.js',
      'js/fare-config-store.js',
      'manifest.json',
      'office-manifest.json',
      'sw.js',
      // html から 読まれて 客に 配られる＝scripts/ に 在っても 見る
      'scripts/zeroact-test-commons/observability/sentry-config.js',
    ]) {
      expect(k.hani).toContain(f);
    }
  });
  it('お客さんの 画面ごとに 痩せていない（全体の 下限では 1本 抜けても 黙る＝ファイルごとに 見る）', () => {
    // 2026-10-10 の 数の 8割（対立役：shukei 465・ryokinhyou 396・uriage 237 は 全体の 下限では 抜けても 黙った）
    const KAGEN = {
      'index.html': 2680,
      'kyuryo.html': 1240,
      'shukei.html': 370,
      'ryokinhyou.html': 310,
      'dashboard.html': 280,
      'uriage.html': 190,
      'nyuryoku.html': 150,
      'shindan.html': 90,
      'login.html': 80,
      'js/obd-client.js': 230,
      'js/meter.js': 130,
      'js/fare-config-store.js': 70,
    };
    const yase = Object.keys(KAGEN).filter((f) => !(k.kotoni[f] >= KAGEN[f]));
    expect(yase.map((f) => `${f} ${k.kotoni[f]} < ${KAGEN[f]}`)).toEqual([]);
  });
  it('html が 読むのに 見ない 物は 名簿の 通り（名前の 形で 外す ので、新しい 物は ここで 止める）', () => {
    // data/＝本物の 名前（下）・*.min.js＝借り物（QR・暗号）。自前の 物を x.min.js や data/ に 置くと 見なくなる＝ここで 赤
    // html の src と JS の 字（data-registry・sw.js の 先取り・el.src=…）の 両方から 集める（対立役 B）
    expect(k.sotoSrc).toEqual([
      'data/addresses-coarse-jp.js',
      'data/addresses-fine-jp.js',
      'data/airports-jp.js',
      'data/coarse-jp.js',
      'data/coastline-jp.js',
      'data/dem-jp.js',
      'data/emergency-medical-jp.js',
      'data/faults-jp.js',
      'data/hazard-cliff-jp.js',
      'data/highways-jp.js',
      'data/hiking-trails-jp.js',
      'data/michinoeki-jp.js',
      'data/misc-jp.js',
      'data/night-clinics-jp.js',
      'data/peaks-jp.js',
      'data/ports-jp.js',
      'data/pref-borders-jp.js',
      'data/railways-jp.js',
      'data/road-graph-backbone-jp.js',
      'data/shelters-jp.js',
      'data/stations-jp.js',
      'data/waterways-jp.js',
      'js/qrcode.min.js',
      'js/tweetnacl.min.js',
      'vendor/fontkit.umd.min.js',
      'vendor/pdf-lib.min.js',
    ]);
  });
  it('data/ を 外す 訳が 生きている（本物の 店の 名前に ★ が 在る＝消すと 名前が 変わる）', () => {
    // 1店の 名前に 頼らない＝data/ の js の どれかに ★ が 在れば 良い（今 14本）
    const ROOT = path.join(__dirname, '..', '..');
    const dataJs = execFileSync('git', ['ls-files', 'data/*.js'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    expect(dataJs.length).toBeGreaterThan(0);
    // data/ は 大きい（全部 読むと 40秒）＝git grep で 名前だけ 取る
    const hoshiAri = execFileSync('git', ['grep', '-l', '★', '--', 'data/*.js'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
    expect(hoshiAri.length).toBeGreaterThan(0);
    expect(k.hani.some((f) => f.startsWith('data/'))).toBe(false);
  });
});

// ★門の 歯★＝緑で 通り抜ける 形を 作って、全部 赤に なる 事を 見る（対立役 2026-10-10 の W 型）
describe('門の 歯（作った 入力で 赤に なるか）', () => {
  const jsAka = (s) => jsWoMiru(s).hoshi.length;
  const htmlAka = (s) => htmlWoMiru(s).hoshi.length;

  it('JS：字の ★・逃がし・template・数から 作る 形 は 赤', () => {
    expect(jsAka("el.textContent = '★注意★';")).toBe(1);
    expect(jsAka('throw new Error("\\u2605 だめ");')).toBe(1);
    expect(jsAka('x = "\\u{2605}";')).toBe(1);
    expect(jsAka('x = `合計 ${n} ★`;')).toBe(1);
    expect(jsAka('el.innerHTML = "&#9733;";')).toBe(1);
    expect(jsAka('el.innerHTML = "&#09733";')).toBe(1);
    expect(jsAka('el.innerHTML = "&#x02605;";')).toBe(1);
    expect(jsAka('el.innerHTML = "&starf;";')).toBe(1);
    expect(jsAka('s.textContent = String.fromCharCode(9733);')).toBe(1);
    expect(jsAka('s.textContent = String.fromCodePoint(0X2605);')).toBe(1);
    expect(jsAka("x = decodeURIComponent('%E2%98%85');")).toBe(1);
    expect(jsAka('st.textContent = ".a::before{content:\\"\\\\2605\\"}";')).toBe(1);
  });
  it('JS：注記の 中だけなら 緑・正規表現の バッククォートで 飲み込まない', () => {
    expect(jsAka('// ★経緯★\n/* ★ */ var a = 1;')).toBe(0);
    expect(jsAka("var r = /`/; var b = 'ふつう'; // ★\nvar c = '★';")).toBe(1);
    expect(jsAka('var a = b++ / 2; var s = "★";')).toBe(1);
  });
  it('JS：読めない 字は 黙らない', () => {
    expect(jsWoMiru("var s = 'とじない;").yomenai).toBeTruthy();
  });
  it('HTML：本文・隠れた 所・属性・実体参照 は 赤', () => {
    expect(htmlAka('<p>★注意★</p>')).toBe(1);
    expect(htmlAka('<div hidden style="display:none">★</div>')).toBe(1);
    expect(htmlAka('<input placeholder="★名前">')).toBe(1);
    expect(htmlAka('<p>&#9733;</p>')).toBe(1);
    expect(htmlAka('<p>&#9733 あ</p>')).toBe(1);
    expect(htmlAka('<p>&bigstar;</p>')).toBe(1);
    expect(htmlAka('<style>.x::before{content:"\\2605"}</style>')).toBe(1);
    expect(htmlAka('<template><b>★</b></template>')).toBe(1);
    expect(htmlAka('<script>el.textContent="★";</script>')).toBe(1);
    expect(htmlAka('<script type="application/ld+json">{"name":"★"}</script>')).toBe(1);
  });
  it('HTML：注記・CSS の 注記 だけなら 緑', () => {
    expect(htmlAka('<!-- ★経緯★ --><p>ふつう</p>')).toBe(0);
    expect(htmlAka('<div style="color:red; /* ★経緯★ */">あ</div>')).toBe(0);
    expect(htmlAka('<style>/* ★ */ .a{color:red}</style>')).toBe(0);
    expect(htmlAka('<script>// ★経緯\nvar a=1;</script>')).toBe(0);
  });
  it('HTML：注記の 中の「<script>」で 本物の script src を 飲み込まない（index.html の 形）', () => {
    const r = htmlWoMiru(
      '<!-- 古い <script> ロードは削除 --><script src="data/x.js"></script><p>★</p><script>var a=1;</script>'
    );
    expect(r.src).toEqual(['data/x.js']);
    expect(r.hoshi.length).toBe(1);
    expect(r.inlineScript).toBe(1);
    expect(r.yomenai).toEqual([]);
  });
  // 本番前の 対立役（2026-10-10）が 示した 緑で 通る 形
  it('HTML：注記の 閉じ方（<!--> ・ <!---> ・ --!>）で 本文を 飲み込まない', () => {
    expect(htmlAka('<!-->★<p>x</p><!-- y -->')).toBe(1);
    expect(htmlAka('<!--->★<p>x</p><!-- y -->')).toBe(1);
    expect(htmlAka('<!-- x --!>★<!-- y -->')).toBe(1);
  });
  it('HTML：字の 箱（textarea・title）の 中は 注記に 見えても 字＝赤', () => {
    expect(htmlAka('<textarea><!-- ★ --></textarea>')).toBe(1);
    expect(htmlAka('<title><!--★--></title>')).toBe(1);
    expect(htmlAka('<textarea>ふつう</textarea><p>あ</p>')).toBe(0);
  });
  it('HTML：同じ 属性が 2つ・on 属性の 数 9733・%u2605・正規表現の 字 は 赤', () => {
    expect(htmlAka('<input placeholder="★名前" placeholder="名前">')).toBe(1);
    expect(
      htmlAka('<button onclick="this.textContent=String.fromCharCode(9733)">あ</button>')
    ).toBe(1);
    expect(
      htmlAka('<button onclick="this.textContent=String.fromCodePoint(0x2605)">あ</button>')
    ).toBe(1);
    expect(htmlAka('<script>el.textContent=unescape("%u2605")</script>')).toBe(1);
    expect(jsAka('el.textContent = /★/.source;')).toBe(1);
  });
  // 本番前の 対立役 2回目（2026-10-10）の A・C
  it('HTML：字の 箱の 閉じタグが 崩れた 形でも 閉じる・閉じなければ 読めない（後ろを 黙って 飲み込まない）', () => {
    expect(
      htmlAka('<textarea></textarea/><script>t.textContent=String.fromCharCode(9733)</script>')
    ).toBe(1);
    expect(htmlWoMiru('<textarea></textarea foo><script src="scripts/x.js"></script>').src).toEqual(
      ['scripts/x.js']
    );
    expect(htmlWoMiru('<textarea>あ<script>var a=1;</script>').yomenai.length).toBe(1);
  });
  it('HTML：on 属性が 読めない 時は 黙らない・srcdoc・javascript: も 見る', () => {
    expect(
      htmlAka(
        '<button onclick="this.title=&#39;a&#39;;this.textContent=String.fromCharCode(9733)">あ</button>'
      )
    ).toBe(1);
    expect(htmlWoMiru('<button onclick="var s = \'とじない">あ</button>').yomenai.length).toBe(1);
    expect(htmlAka('<iframe srcdoc="&lt;p&gt;&amp;#9733;&lt;/p&gt;"></iframe>')).toBe(1);
    expect(htmlAka('<iframe srcdoc="&lt;p&gt;&amp;starf;&lt;/p&gt;"></iframe>')).toBe(1);
    expect(
      htmlAka('<a href="javascript:void(this.textContent=String.fromCharCode(9733))">あ</a>')
    ).toBe(1);
    expect(htmlAka('<a href="javascript:void(0)" onclick="go()">あ</a>')).toBe(0);
  });
  it('探す 形が 普通の 字を 拾わない', () => {
    expect(HOSHI.test('&#97330; \\u26050 料金 ☆ 2605円')).toBe(false);
  });
});
