// ============================================================
// ★★隣の 県の 町の 形しか 読めて いない 間も 地名を 空に しない★★ 2026-10-24（対立役 止2）
//   前の 作り＝「覆って いるか」を 束の 外枠（県の bbox）で 決めた。東京の 外枠は 小笠原まで 含み 神奈川を まるごと 覆う
//   ⇒ 神奈川の 町の 形が 届く 前に 神奈川で 押すと、細かい 点も やり直しも 飛ばし 空の まま（神奈川の 正解 200点中 199点 null）
//   見る 事：東京の 形＋神奈川の 細かい 点 だけ ⇒ 神奈川の 点は ①空に ならない（細かい 点の 市・町）
//            ②神奈川の 形が 届いたら 形で 引いた 正しい 地名（正解と 同じ）
//   わざと壊す：_townCovers を 束の 外枠で 決める 形に 戻す ⇒ ① 赤
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SEIKAI = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'chimei-seikai.json'), 'utf8')
);
const yomu = (sb, f) =>
  new Function('window', fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'))(sb);

function loadBusiness() {
  const p = path.join(ROOT, 'js', 'business.js');
  delete require.cache[require.resolve(p)];
  return require(p);
}

describe('隣の 県の 形しか 無い 間も 空に しない', () => {
  afterEach(() => {
    delete global.window;
  });
  it('東京の 形＋神奈川の 細かい 点 ⇒ 神奈川の 点の 大半に 名前・形が 届けば 正解', () => {
    const sb = {};
    yomu(sb, 'town-polygons-tokyo.js');
    yomu(sb, 'addresses-fine-kanagawa.js');
    global.window = sb;
    const B = loadBusiness();
    const pts = SEIKAI.perPref.kanagawa;
    let kara = 0;
    for (const [lat, lng] of pts) if (!B.__addressFormatter.chimeiAt(lat, lng)) kara++;
    // 細かい 点は 500m 以内の 物だけ 使う＝山の 中 等は 空も ある（前は 199/200 が 空）
    expect(kara, '★隣の 県の 形しか 無い 時に 空が 多い★ ' + kara).toBeLessThan(pts.length / 2);
    yomu(sb, 'town-polygons-kanagawa.js');
    const chigau = pts.filter(([lat, lng, s]) => {
      const r = B.__addressFormatter.chimeiAt(lat, lng);
      return !r || r.s !== s;
    });
    expect(chigau.length).toBe(0);
  }, 60000);
  // 神奈川 以外の 46都道府県（隣の 県の 大きい 町の 升が 神奈川に 掛かる 形＝対立役 2回目 止B の 再現）
  //   わざと壊す：_addrTick に「升に 町が 在れば やめる」を 戻す ⇒ 赤
  it('神奈川 以外の 46都道府県の 形と 神奈川の 細かい 点 ⇒ 代行の 地名は 神奈川の 形が 届いたら 1つも 空に 残らない', () => {
    const sb = {};
    for (const f of fs.readdirSync(path.join(ROOT, 'data')))
      if (/^town-polygons-.*\.js$/.test(f) && f !== 'town-polygons-kanagawa.js') yomu(sb, f);
    yomu(sb, 'addresses-fine-kanagawa.js');
    global.window = sb;
    const B = loadBusiness();
    B.start();
    const pts = SEIKAI.perPref.kanagawa;
    for (const [lat, lng] of pts) {
      B.onTripStart(lat, lng, 5);
      B.onTripEnd(1000, 2000, Date.now());
    }
    // 神奈川の 形が 届く 前にも やり直しは 2秒ごとに 回る
    B.__addressFormatter.addrTick();
    yomu(sb, 'town-polygons-kanagawa.js');
    B.__addressFormatter.addrTick();
    const kara = B.getState().trips.filter((t) => !t.start_address).length;
    expect(kara, '★神奈川の 形が 届いても 空の まま 残った★').toBe(0);
  }, 180000);
});
